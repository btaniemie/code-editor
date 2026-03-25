package com.codereview;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.net.InetSocketAddress;
import java.util.Collection;

/**
 * CodeReviewServer — the core networking component.
 *
 * Extends org.java-websocket's WebSocketServer, which internally creates a
 * java.net.ServerSocket listening on the given port and accepts each incoming
 * TCP connection on its own thread.  Each accepted socket is upgraded to the
 * WebSocket protocol via the HTTP Upgrade handshake; after that our onMessage
 * callback is called for every WebSocket frame received over that TCP stream.
 *
 * Application-layer protocol: every frame is a UTF-8 JSON object with a "type"
 * field acting as an opcode.  The router in onMessage reads that field and
 * dispatches to the appropriate handler method.
 */
public class CodeReviewServer extends WebSocketServer {

    private final RoomManager roomManager = new RoomManager();
    private final Gson gson = new Gson();

    public CodeReviewServer(int port) {
        // Bind to all interfaces (0.0.0.0) on the given port.
        // org.java-websocket wraps java.net.ServerSocket under the hood.
        super(new InetSocketAddress(port));
        setReuseAddr(true);
    }

    // -------------------------------------------------------------------------
    // WebSocketServer lifecycle callbacks
    // -------------------------------------------------------------------------

    /**
     * Called once the TCP connection is established AND the WebSocket HTTP
     * Upgrade handshake has completed successfully.  At this point we have a
     * live bidirectional stream but the client hasn't told us who they are yet
     * (USER_JOIN comes next).
     */
    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        System.out.println("[onOpen]  New TCP connection from "
                + conn.getRemoteSocketAddress()
                + "  (WebSocket upgrade complete)");
    }

    /**
     * Called when the TCP connection is closed — either because the client sent
     * a WebSocket close frame or the socket was dropped (network error, browser
     * tab closed, etc.).  We treat this the same as USER_LEAVE so the room
     * stays consistent even if the client never sent an explicit leave message.
     */
    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        System.out.println("[onClose] Connection closed from "
                + conn.getRemoteSocketAddress()
                + "  code=" + code + "  remote=" + remote);
        handleDisconnect(conn);
    }

    /**
     * Called for every complete WebSocket text frame received over the TCP
     * stream.  This is our application-layer message router: we parse the JSON,
     * read the "type" opcode, and dispatch to the right handler.
     */
    @Override
    public void onMessage(WebSocket conn, String rawJson) {
        System.out.println("[onMessage] " + conn.getRemoteSocketAddress() + " -> " + rawJson);

        JsonObject msg;
        try {
            msg = JsonParser.parseString(rawJson).getAsJsonObject();
        } catch (Exception e) {
            System.err.println("[onMessage] Malformed JSON, ignoring: " + rawJson);
            return;
        }

        if (!msg.has("type")) {
            System.err.println("[onMessage] Message missing 'type' field, ignoring.");
            return;
        }

        String type = msg.get("type").getAsString();

        // --- Message router ---
        switch (type) {
            case "USER_JOIN"  -> handleUserJoin(conn, msg);
            case "USER_LEAVE" -> handleUserLeave(conn, msg);
            case "EDIT"       -> handleEdit(conn, msg);
            default           -> System.out.println("[onMessage] Unknown message type: " + type);
        }
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        String addr = (conn != null) ? conn.getRemoteSocketAddress().toString() : "unknown";
        System.err.println("[onError] Socket error from " + addr + ": " + ex.getMessage());
        // org.java-websocket will call onClose after this for fatal errors.
    }

    @Override
    public void onStart() {
        System.out.println("[Server] CodeReview WebSocket server listening on port "
                + getPort());
        System.out.println("[Server] Waiting for client connections...");
    }

    // -------------------------------------------------------------------------
    // Message handlers
    // -------------------------------------------------------------------------

    /**
     * USER_JOIN  { "type": "USER_JOIN", "userId": "minh", "roomCode": "abc123" }
     *
     * 1. Validate required fields.
     * 2. Register (conn, userId) in the room.
     * 3. Broadcast USER_JOIN to everyone in the room (including the sender so
     *    the client knows the join was accepted).
     */
    private void handleUserJoin(WebSocket conn, JsonObject msg) {
        if (!msg.has("userId") || !msg.has("roomCode")) {
            System.err.println("[handleUserJoin] Missing userId or roomCode.");
            return;
        }

        String userId   = msg.get("userId").getAsString().trim();
        String roomCode = msg.get("roomCode").getAsString().trim();

        if (userId.isEmpty() || roomCode.isEmpty()) {
            System.err.println("[handleUserJoin] Empty userId or roomCode.");
            return;
        }

        Room room = roomManager.getOrCreateRoom(roomCode);
        room.addConnection(conn, userId);

        // Build the broadcast payload — same shape as the incoming message so
        // clients can use a single handler for join events.
        Collection<String> users = room.getUserIds();

        JsonObject broadcast = new JsonObject();
        broadcast.addProperty("type",     "USER_JOIN");
        broadcast.addProperty("userId",   userId);
        broadcast.addProperty("roomCode", roomCode);
        broadcast.add("users", gson.toJsonTree(users));

        String json = gson.toJson(broadcast);
        room.broadcast(json);   // sends to every WebSocket TCP connection in the room

        System.out.println("[handleUserJoin] '" + userId + "' joined room '" + roomCode
                + "' — room now has " + users.size() + " user(s).");

        // Send the current document state privately to just the new connection
        // so they start in sync with everyone else in the room.
        // This is a unicast (point-to-point) rather than a broadcast.
        JsonObject sync = new JsonObject();
        sync.addProperty("type",     "SYNC");
        sync.addProperty("document", room.getDocument());
        sync.add("users", gson.toJsonTree(users));
        conn.send(gson.toJson(sync));
    }

    /**
     * EDIT  { "type": "EDIT", "userId": "minh", "content": "<full document text>" }
     *
     * 1. Update the authoritative document stored in the room (synchronized).
     * 2. Broadcast to every client EXCEPT the sender — the sender already has
     *    the change locally and does not need an echo.
     *
     * Using broadcastExcept here is the standard fanout pattern for shared editors:
     * one writer, N-1 readers updated over their individual TCP connections.
     */
    private void handleEdit(WebSocket conn, JsonObject msg) {
        if (!msg.has("content") || !msg.has("userId")) {
            System.err.println("[handleEdit] Missing content or userId.");
            return;
        }

        Room room = roomManager.getRoomForConnection(conn);
        if (room == null) {
            System.err.println("[handleEdit] EDIT from connection not in any room.");
            return;
        }

        String content = msg.get("content").getAsString();
        String userId  = msg.get("userId").getAsString();

        // Persist the new document state in the room (thread-safe via synchronized).
        room.setDocument(content);

        // Forward to all other clients in the room over their TCP connections.
        JsonObject broadcast = new JsonObject();
        broadcast.addProperty("type",    "EDIT");
        broadcast.addProperty("userId",  userId);
        broadcast.addProperty("content", content);

        room.broadcastExcept(conn, gson.toJson(broadcast));
    }

    /**
     * USER_LEAVE  { "type": "USER_LEAVE", "userId": "minh" }
     *
     * Explicit leave message.  Delegates to handleDisconnect which also covers
     * the implicit case (TCP drop, browser close).
     */
    private void handleUserLeave(WebSocket conn, JsonObject msg) {
        handleDisconnect(conn);
    }

    /**
     * Common teardown path for both explicit USER_LEAVE and socket-level onClose.
     *
     * 1. Find which room this connection belongs to.
     * 2. Remove the connection and retrieve the userId.
     * 3. Broadcast USER_LEAVE to remaining users.
     * 4. Clean up the room if it is now empty.
     */
    private void handleDisconnect(WebSocket conn) {
        Room room = roomManager.getRoomForConnection(conn);
        if (room == null) {
            // Connection never completed USER_JOIN — nothing to clean up.
            return;
        }

        String userId = room.removeConnection(conn);
        if (userId == null) {
            return;
        }

        System.out.println("[handleDisconnect] '" + userId + "' left room '"
                + room.getRoomCode() + "'.");

        // Notify remaining users that someone left.
        Collection<String> remaining = room.getUserIds();

        JsonObject broadcast = new JsonObject();
        broadcast.addProperty("type",   "USER_LEAVE");
        broadcast.addProperty("userId", userId);
        broadcast.add("users", gson.toJsonTree(remaining));

        room.broadcast(gson.toJson(broadcast));

        // Remove the room from the registry if it is now empty.
        roomManager.removeRoomIfEmpty(room.getRoomCode());
    }
}
