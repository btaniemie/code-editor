package com.codereview;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonArray;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.net.InetSocketAddress;
import java.util.Collection;

/**
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

    private final RoomManager  roomManager = new RoomManager();
    private final Gson         gson        = new Gson();
    private final GeminiClient gemini;

    public CodeReviewServer(int port) {
        // Bind to all interfaces (0.0.0.0) on the given port.
        // org.java-websocket wraps java.net.ServerSocket under the hood.
        super(new InetSocketAddress(port));
        setReuseAddr(true);

        // Read the Gemini API key from the environment.
        // If missing, reviews will fail with AI_ERROR — server still starts.
        String apiKey = System.getenv("GEMINI_API_KEY");
        if (apiKey != null) apiKey = apiKey.trim(); // strip accidental whitespace/CRLF from .env
        if (apiKey == null || apiKey.isBlank()) {
            System.err.println("[Server] WARNING: GEMINI_API_KEY not set. Reviews will return AI_ERROR.");
            apiKey = "";
        } else {
            System.out.println("[Server] GEMINI_API_KEY loaded (length=" + apiKey.length()
                + ", prefix=" + apiKey.substring(0, Math.min(6, apiKey.length())) + "...)");
        }
        this.gemini = new GeminiClient(apiKey);
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

        // Message router
        switch (type) {
            case "USER_JOIN"      -> handleUserJoin(conn, msg);
            case "USER_LEAVE"     -> handleUserLeave(conn, msg);
            case "EDIT"           -> handleEdit(conn, msg);
            case "CURSOR"         -> handleCursor(conn, msg);
            case "REVIEW_REQUEST" -> handleReviewRequest(conn, msg);
            default               -> System.out.println("[onMessage] Unknown message type: " + type);
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

    // Message handlers

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

        // Send the current room state privately to just the new connection
        // (unicast, not broadcast) so they start in sync with everyone else.
        JsonObject sync = new JsonObject();
        sync.addProperty("type",     "SYNC");
        sync.addProperty("document", room.getDocument());
        sync.addProperty("language", room.getLanguage());
        sync.add("users",    gson.toJsonTree(users));
        sync.add("cursors",  gson.toJsonTree(room.getCursors()));
        sync.add("comments", gson.toJsonTree(room.getComments()));
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

        // Remove their cursor so it doesn't linger for other users.
        room.removeCursor(userId);

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

    /**
     * REVIEW_REQUEST  { "type": "REVIEW_REQUEST", "userId": "minh", "language": "python" }
     *
     * 1. Reject the request if a review is already in progress (atomic CAS via startReview()).
     * 2. Optionally update the room's language from the request.
     * 3. Clear previous comments and broadcast REVIEW_START to all clients.
     * 4. Snapshot the current document and launch a background thread that:
     *    a. Opens an outbound HTTPS connection to the Gemini API (secondary TCP stream).
     *    b. Parses the JSON array response.
     *    c. Stores each comment in room state and broadcasts AI_COMMENT to the room.
     *    d. Broadcasts REVIEW_DONE (or AI_ERROR on failure).
     *    e. Releases the review lock in a finally block.
     *
     * The background thread is a daemon so it does not prevent JVM shutdown.
     * It is named "review-<roomCode>" to make it visible in thread dumps.
     */
    private void handleReviewRequest(WebSocket conn, JsonObject msg) {
        Room room = roomManager.getRoomForConnection(conn);
        if (room == null) return;

        // Update language if the client included it
        if (msg.has("language") && !msg.get("language").getAsString().isBlank()) {
            room.setLanguage(msg.get("language").getAsString());
        }

        String userId = msg.has("userId") ? msg.get("userId").getAsString() : "unknown";

        // Atomic guard — only one review at a time per room
        if (!room.startReview()) {
            System.out.println("[handleReviewRequest] Review already in progress, ignoring request from '"
                    + userId + "'.");
            return;
        }

        System.out.println("[handleReviewRequest] '" + userId + "' triggered review in room '"
                + room.getRoomCode() + "' (language: " + room.getLanguage() + ").");

        // Clear stale comments and tell every client a review is starting
        room.clearComments();

        JsonObject start = new JsonObject();
        start.addProperty("type", "REVIEW_START");
        room.broadcast(gson.toJson(start));

        // Snapshot document state now — edits that arrive during the review
        // do not affect what Gemini sees, keeping the comments consistent.
        final String documentSnapshot = room.getDocument();
        final String language         = room.getLanguage();

        // Launch the Gemini API call on a dedicated background thread.
        // This secondary outbound TCP/HTTPS connection runs independently of
        // the WebSocket server's connection-handling threads.
        Thread reviewThread = new Thread(() -> {
            try {
                JsonArray comments = gemini.review(documentSnapshot, language);
                System.out.println("[reviewThread] Gemini returned " + comments.size() + " comment(s).");

                for (int i = 0; i < comments.size(); i++) {
                    JsonObject c = comments.get(i).getAsJsonObject();

                    int    line     = c.has("line")     ? c.get("line").getAsInt()        : 1;
                    String text     = c.has("text")     ? c.get("text").getAsString()     : "";
                    String severity = c.has("severity") ? c.get("severity").getAsString() : "info";
                    String category = c.has("category") ? c.get("category").getAsString() : "style";

                    // Persist so late-joining users receive it in SYNC
                    room.addComment(line, text, severity, category);

                    // Broadcast to every client in the room over their TCP connections
                    JsonObject aiComment = new JsonObject();
                    aiComment.addProperty("type",     "AI_COMMENT");
                    aiComment.addProperty("line",     line);
                    aiComment.addProperty("text",     text);
                    aiComment.addProperty("severity", severity);
                    aiComment.addProperty("category", category);
                    room.broadcast(gson.toJson(aiComment));
                }

                JsonObject done = new JsonObject();
                done.addProperty("type", "REVIEW_DONE");
                room.broadcast(gson.toJson(done));

            } catch (Exception e) {
                System.err.println("[reviewThread] Gemini API error: " + e.getMessage());

                JsonObject error = new JsonObject();
                error.addProperty("type", "AI_ERROR");
                error.addProperty("text", "Review failed: " + e.getMessage());
                room.broadcast(gson.toJson(error));

            } finally {
                // Always release the lock so future reviews can proceed
                room.endReview();
            }
        });

        reviewThread.setDaemon(true);
        reviewThread.setName("review-" + room.getRoomCode());
        reviewThread.start();
    }

    /**
     * CURSOR  { "type": "CURSOR", "userId": "minh", "line": 7 }
     *
     * Stores the user's last known cursor line in the room so new joiners
     * receive it in SYNC, then broadcasts to every other client so they can
     * render the colored cursor widget at the correct line.
     */
    private void handleCursor(WebSocket conn, JsonObject msg) {
        if (!msg.has("userId") || !msg.has("pos")) return;

        Room room = roomManager.getRoomForConnection(conn);
        if (room == null) return;

        String userId = msg.get("userId").getAsString();
        int    pos    = msg.get("pos").getAsInt();

        room.setCursor(userId, pos);

        JsonObject broadcast = new JsonObject();
        broadcast.addProperty("type",   "CURSOR");
        broadcast.addProperty("userId", userId);
        broadcast.addProperty("pos",    pos);

        room.broadcastExcept(conn, gson.toJson(broadcast));
    }
}