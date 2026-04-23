package com.codereview;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonArray;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Collection;

/**
 * Extends org.java-websocket's WebSocketServer, which internally creates a
 * java.net.ServerSocket listening on the given port and accepts each incoming
 * TCP connection on its own thread.  Each accepted socket is upgraded to the
 * WebSocket protocol via the HTTP Upgrade handshake; after that our onMessage
 * callback is called for every WebSocket frame received over that TCP stream.
 *
 * Application-layer protocol: every text frame is a UTF-8 JSON object with a
 * "type" field acting as an opcode.  The router in onMessage reads that field
 * and dispatches to the appropriate handler method.
 *
 * Opcodes handled:
 *   USER_JOIN, USER_LEAVE, EDIT, CURSOR, LANGUAGE_CHANGE,
 *   REVIEW_REQUEST, CHAT, VOICE_STATUS,
 *   FILE_CREATE, FILE_DELETE, FILE_RENAME, FILE_SWITCH,
 *   RUN_REQUEST
 *
 * Opcodes broadcast by the server:
 *   USER_JOIN, USER_LEAVE, SYNC, EDIT, CURSOR, LANGUAGE_CHANGE,
 *   REVIEW_START, AI_COMMENT, REVIEW_DONE, AI_ERROR, CHAT, AI_CHAT,
 *   VOICE_STATUS, VOICE_CHUNK (binary),
 *   FILE_CREATE, FILE_DELETE, FILE_RENAME, FILE_SWITCH,
 *   RUN_START, RUN_OUTPUT, RUN_DONE, RUN_ERROR, RUN_TIMEOUT
 */
public class CodeReviewServer extends WebSocketServer {

    private final RoomManager       roomManager       = new RoomManager();
    private final Gson              gson              = new Gson();
    private final GeminiClient      gemini;
    private final ExecutionManager  executionManager  = new ExecutionManager();

    public CodeReviewServer(int port) {
        super(new InetSocketAddress(port));
        setReuseAddr(true);

        String apiKey = System.getenv("GEMINI_API_KEY");
        if (apiKey != null) apiKey = apiKey.trim();
        if (apiKey == null || apiKey.isBlank()) apiKey = loadApiKeyFromDotEnv();
        if (apiKey == null || apiKey.isBlank()) {
            System.err.println("[Server] WARNING: GEMINI_API_KEY not set. Reviews will return AI_ERROR.");
            apiKey = "";
        } else {
            System.out.println("[Server] GEMINI_API_KEY loaded (length=" + apiKey.length()
                    + ", prefix=" + apiKey.substring(0, Math.min(6, apiKey.length())) + "...)");
        }
        this.gemini = new GeminiClient(apiKey);
    }

    // ── WebSocketServer lifecycle callbacks ───────────────────────────────────

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        System.out.println("[onOpen]  New TCP connection from "
                + conn.getRemoteSocketAddress()
                + "  (WebSocket upgrade complete)");
    }

    /**
     * Called when the TCP connection closes (client disconnect, browser tab
     * closed, or network drop).  Treated identically to USER_LEAVE.
     */
    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        System.out.println("[onClose] Connection closed from "
                + conn.getRemoteSocketAddress()
                + "  code=" + code + "  remote=" + remote);
        handleDisconnect(conn);
    }

    /**
     * Application-layer message router.  Every complete WebSocket text frame
     * arrives here; we parse the "type" opcode and dispatch accordingly.
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

        switch (type) {
            case "USER_JOIN"      -> handleUserJoin(conn, msg);
            case "USER_LEAVE"     -> handleUserLeave(conn, msg);
            case "EDIT"           -> handleEdit(conn, msg);
            case "CURSOR"         -> handleCursor(conn, msg);
            case "REVIEW_REQUEST" -> handleReviewRequest(conn, msg);
            case "CHAT"           -> handleChat(conn, msg);
            case "LANGUAGE_CHANGE"-> handleLanguageChange(conn, msg);
            case "VOICE_STATUS"   -> handleVoiceStatus(conn, msg);
            // ── File tree opcodes ───────────────────────────────────────────
            case "FILE_CREATE"    -> handleFileCreate(conn, msg);
            case "FILE_DELETE"    -> handleFileDelete(conn, msg);
            case "FILE_RENAME"    -> handleFileRename(conn, msg);
            case "FILE_SWITCH"    -> handleFileSwitch(conn, msg);
            // ── Code execution ──────────────────────────────────────────────
            case "RUN_REQUEST"    -> handleRunRequest(conn, msg);
            default               -> System.out.println("[onMessage] Unknown type: " + type);
        }
    }

    /**
     * Binary frames carry raw audio (VOICE_CHUNK).  We relay the ByteBuffer
     * to all other peers — no JSON parsing, minimal overhead.
     * org.java-websocket sends this as a binary frame (opcode 0x2) over TCP.
     */
    @Override
    public void onMessage(WebSocket conn, ByteBuffer message) {
        Room room = roomManager.getRoomForConnection(conn);
        if (room == null) {
            System.err.println("[onMessage/binary] Binary frame from unregistered connection — ignoring.");
            return;
        }
        room.broadcastBinaryExcept(conn, message);
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        String addr = (conn != null) ? conn.getRemoteSocketAddress().toString() : "unknown";
        System.err.println("[onError] Socket error from " + addr + ": " + ex.getMessage());
    }

    @Override
    public void onStart() {
        System.out.println("[Server] CodeReview WebSocket server listening on port " + getPort());
        System.out.println("[Server] Waiting for client connections...");
    }

    // ── Handler: USER_JOIN ────────────────────────────────────────────────────

    /**
     * USER_JOIN  { type, userId, roomCode }
     *
     * 1. Register (conn, userId) in the room.
     * 2. Broadcast USER_JOIN to all (so everyone updates their user list).
     * 3. Unicast SYNC to the new connection with full room state.
     * 4. Broadcast a system chat notification.
     *
     * The SYNC message now carries the full file tree (files map + activeFile)
     * instead of a single document string.
     */
    private void handleUserJoin(WebSocket conn, JsonObject msg) {
        if (!msg.has("userId") || !msg.has("roomCode")) {
            System.err.println("[handleUserJoin] Missing userId or roomCode.");
            return;
        }

        String userId   = msg.get("userId").getAsString().trim();
        String roomCode = msg.get("roomCode").getAsString().trim();

        if (userId.isEmpty() || roomCode.isEmpty()) return;

        Room room = roomManager.getOrCreateRoom(roomCode);
        room.addConnection(conn, userId);

        Collection<String> users = room.getUserIds();

        // Broadcast USER_JOIN so all clients refresh their user list.
        JsonObject joinBcast = new JsonObject();
        joinBcast.addProperty("type",     "USER_JOIN");
        joinBcast.addProperty("userId",   userId);
        joinBcast.addProperty("roomCode", roomCode);
        joinBcast.add("users", gson.toJsonTree(users));
        room.broadcast(gson.toJson(joinBcast));

        System.out.println("[handleUserJoin] '" + userId + "' joined room '" + roomCode
                + "' — room now has " + users.size() + " user(s).");

        // Unicast SYNC to the new joiner so they start in sync with everyone.
        // We send the full file tree (files + activeFile) instead of a single document.
        JsonObject sync = new JsonObject();
        sync.addProperty("type",       "SYNC");
        sync.add("files",    gson.toJsonTree(room.getFiles()));     // full file tree
        sync.addProperty("activeFile", room.getActiveFile());       // which file to open
        sync.addProperty("language",   room.getLanguage());
        sync.add("users",    gson.toJsonTree(users));
        sync.add("cursors",  gson.toJsonTree(room.getCursors()));
        sync.add("comments", gson.toJsonTree(room.getComments()));
        sync.add("chat",     gson.toJsonTree(room.getChatHistory()));
        conn.send(gson.toJson(sync));   // unicast — single TCP/WebSocket connection

        // System chat notification for the join event.
        String joinText = userId + " joined the room";
        room.addChatMessage("system", joinText, -1);

        JsonObject chatNotif = new JsonObject();
        chatNotif.addProperty("type",      "CHAT");
        chatNotif.addProperty("userId",    "system");
        chatNotif.addProperty("text",      joinText);
        chatNotif.addProperty("timestamp", System.currentTimeMillis());
        chatNotif.add("replyTo", null);
        room.broadcast(gson.toJson(chatNotif));
    }

    // ── Handler: EDIT ─────────────────────────────────────────────────────────

    /**
     * EDIT  { type, userId, filePath, content }
     *
     * Updates the content of the specified file in the room's file tree, then
     * broadcasts to all other clients (broadcastExcept avoids echoing to sender).
     *
     * Networking pattern: one-writer, N-1 readers over separate TCP connections.
     * The filePath field distinguishes which file in the tree is being edited.
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

        String content  = msg.get("content").getAsString();
        String userId   = msg.get("userId").getAsString();
        // filePath is required for the file tree; fall back to activeFile for
        // compatibility with any legacy client that omits it.
        String filePath = msg.has("filePath")
                ? msg.get("filePath").getAsString()
                : room.getActiveFile();

        // Persist the new content for this specific file in the room's file tree.
        room.setFile(filePath, content);

        // Forward to all other clients so they can update the same file in their tree.
        JsonObject fwd = new JsonObject();
        fwd.addProperty("type",     "EDIT");
        fwd.addProperty("userId",   userId);
        fwd.addProperty("filePath", filePath);
        fwd.addProperty("content",  content);

        room.broadcastExcept(conn, gson.toJson(fwd));
    }

    // ── Handler: USER_LEAVE / disconnect ──────────────────────────────────────

    private void handleUserLeave(WebSocket conn, JsonObject msg) {
        handleDisconnect(conn);
    }

    private void handleDisconnect(WebSocket conn) {
        Room room = roomManager.getRoomForConnection(conn);
        if (room == null) return;

        String userId = room.removeConnection(conn);
        if (userId == null) return;

        System.out.println("[handleDisconnect] '" + userId + "' left room '"
                + room.getRoomCode() + "'.");

        room.removeCursor(userId);

        String leaveText = userId + " left the room";
        room.addChatMessage("system", leaveText, -1);

        JsonObject chatNotif = new JsonObject();
        chatNotif.addProperty("type",      "CHAT");
        chatNotif.addProperty("userId",    "system");
        chatNotif.addProperty("text",      leaveText);
        chatNotif.addProperty("timestamp", System.currentTimeMillis());
        chatNotif.add("replyTo", null);
        room.broadcast(gson.toJson(chatNotif));

        Collection<String> remaining = room.getUserIds();

        JsonObject leaveBroadcast = new JsonObject();
        leaveBroadcast.addProperty("type",   "USER_LEAVE");
        leaveBroadcast.addProperty("userId", userId);
        leaveBroadcast.add("users", gson.toJsonTree(remaining));
        room.broadcast(gson.toJson(leaveBroadcast));

        roomManager.removeRoomIfEmpty(room.getRoomCode());
    }

    // ── Handler: FILE_CREATE ──────────────────────────────────────────────────

    /**
     * FILE_CREATE  { type, userId, path, content? }
     *
     * Adds a new file (or replaces an existing one) in the room's file tree,
     * then broadcasts the event to all clients so every file tree UI updates.
     *
     * Networking: broadcast to ALL connections (including sender) so the sender's
     * FILE_CREATE handler can auto-switch to the new file.
     */
    private void handleFileCreate(WebSocket conn, JsonObject msg) {
        if (!msg.has("path")) {
            System.err.println("[handleFileCreate] Missing path.");
            return;
        }

        Room room = roomManager.getRoomForConnection(conn);
        if (room == null) return;

        String path    = msg.get("path").getAsString().trim();
        String content = msg.has("content") ? msg.get("content").getAsString() : "";
        String userId  = msg.has("userId")  ? msg.get("userId").getAsString()  : "unknown";

        if (path.isEmpty()) return;

        room.setFile(path, content);

        System.out.println("[handleFileCreate] '" + userId + "' created file '"
                + path + "' in room '" + room.getRoomCode() + "'.");

        JsonObject bcast = new JsonObject();
        bcast.addProperty("type",    "FILE_CREATE");
        bcast.addProperty("userId",  userId);
        bcast.addProperty("path",    path);
        bcast.addProperty("content", content);
        room.broadcast(gson.toJson(bcast));   // all clients, including sender
    }

    // ── Handler: FILE_DELETE ──────────────────────────────────────────────────

    /**
     * FILE_DELETE  { type, userId, path }
     *
     * Removes a file from the room's tree and broadcasts the deletion so all
     * clients can remove it from their file trees and switch views if needed.
     */
    private void handleFileDelete(WebSocket conn, JsonObject msg) {
        if (!msg.has("path")) return;

        Room room = roomManager.getRoomForConnection(conn);
        if (room == null) return;

        String path   = msg.get("path").getAsString().trim();
        String userId = msg.has("userId") ? msg.get("userId").getAsString() : "unknown";

        room.deleteFile(path);

        // If the deleted file was the active file, point activeFile to the
        // first remaining file.  Only update if a next file actually exists —
        // leaving activeFile on a deleted path is harmless; setting it to ""
        // would cause the run command to receive an empty filename argument.
        if (path.equals(room.getActiveFile())) {
            room.getFiles().keySet().stream().findFirst().ifPresent(room::setActiveFile);
        }

        System.out.println("[handleFileDelete] '" + userId + "' deleted file '"
                + path + "' in room '" + room.getRoomCode() + "'.");

        JsonObject bcast = new JsonObject();
        bcast.addProperty("type",   "FILE_DELETE");
        bcast.addProperty("userId", userId);
        bcast.addProperty("path",   path);
        room.broadcast(gson.toJson(bcast));
    }

    // ── Handler: FILE_RENAME ──────────────────────────────────────────────────

    /**
     * FILE_RENAME  { type, userId, oldPath, newPath }
     *
     * Renames a file in the room's tree (content is preserved) and broadcasts
     * so all clients update their file tree and any open editor tabs.
     */
    private void handleFileRename(WebSocket conn, JsonObject msg) {
        if (!msg.has("oldPath") || !msg.has("newPath")) return;

        Room room = roomManager.getRoomForConnection(conn);
        if (room == null) return;

        String oldPath = msg.get("oldPath").getAsString().trim();
        String newPath = msg.get("newPath").getAsString().trim();
        String userId  = msg.has("userId") ? msg.get("userId").getAsString() : "unknown";

        if (oldPath.isEmpty() || newPath.isEmpty() || oldPath.equals(newPath)) return;

        room.renameFile(oldPath, newPath);

        if (oldPath.equals(room.getActiveFile())) {
            room.setActiveFile(newPath);
        }

        System.out.println("[handleFileRename] '" + userId + "' renamed '"
                + oldPath + "' -> '" + newPath + "' in room '" + room.getRoomCode() + "'.");

        JsonObject bcast = new JsonObject();
        bcast.addProperty("type",    "FILE_RENAME");
        bcast.addProperty("userId",  userId);
        bcast.addProperty("oldPath", oldPath);
        bcast.addProperty("newPath", newPath);
        room.broadcast(gson.toJson(bcast));
    }

    // ── Handler: FILE_SWITCH ──────────────────────────────────────────────────

    /**
     * FILE_SWITCH  { type, userId, path }
     *
     * Updates the room's active file and broadcasts the switch to all OTHER
     * clients so their editors follow along (standard collaborative navigation).
     * The sender has already switched locally, so we use broadcastExcept.
     */
    private void handleFileSwitch(WebSocket conn, JsonObject msg) {
        if (!msg.has("path")) return;

        Room room = roomManager.getRoomForConnection(conn);
        if (room == null) return;

        String path   = msg.get("path").getAsString().trim();
        String userId = msg.has("userId") ? msg.get("userId").getAsString() : "unknown";

        room.setActiveFile(path);

        System.out.println("[handleFileSwitch] '" + userId + "' switched to '"
                + path + "' in room '" + room.getRoomCode() + "'.");

        JsonObject bcast = new JsonObject();
        bcast.addProperty("type",   "FILE_SWITCH");
        bcast.addProperty("userId", userId);
        bcast.addProperty("path",   path);
        room.broadcastExcept(conn, gson.toJson(bcast));   // sender already switched
    }

    // ── Handler: RUN_REQUEST ──────────────────────────────────────────────────

    /**
     * RUN_REQUEST  { type, userId }
     *
     * 1. Acquire the execution lock (reject if already running).
     * 2. Broadcast RUN_START so all clients show the "Running…" indicator.
     * 3. Snapshot the current file tree and active file.
     * 4. Hand off to ExecutionManager which runs on a background thread,
     *    writing files to a temp dir and streaming output back as RUN_OUTPUT.
     *
     * Networking note: RUN_OUTPUT messages bridge two I/O streams:
     *   (a) the child process stdout/stderr pipe  (OS process I/O)
     *   (b) the room's WebSocket connections       (TCP application layer)
     * Each line from the process is broadcast over all active TCP connections.
     */
    private void handleRunRequest(WebSocket conn, JsonObject msg) {
        Room room = roomManager.getRoomForConnection(conn);
        if (room == null) return;

        String userId = msg.has("userId") ? msg.get("userId").getAsString() : "unknown";

        if (!room.startExecution()) {
            System.out.println("[handleRunRequest] Execution already in progress, ignoring request from '"
                    + userId + "'.");
            return;
        }

        System.out.println("[handleRunRequest] '" + userId + "' triggered run in room '"
                + room.getRoomCode() + "' (language: " + room.getLanguage() + ").");

        // Broadcast RUN_START so all clients enter running state.
        JsonObject start = new JsonObject();
        start.addProperty("type", "RUN_START");
        room.broadcast(gson.toJson(start));

        // Snapshot the file tree and active file now — edits that arrive
        // while the process runs do not affect what gets executed.
        executionManager.execute(
                room.getFiles(),
                room.getActiveFile(),
                room.getLanguage(),
                room
        );
    }

    // ── Handler: CURSOR ──────────────────────────────────────────────────────

    private void handleCursor(WebSocket conn, JsonObject msg) {
        if (!msg.has("userId") || !msg.has("pos")) return;

        Room room = roomManager.getRoomForConnection(conn);
        if (room == null) return;

        String userId = msg.get("userId").getAsString();
        int    pos    = msg.get("pos").getAsInt();

        room.setCursor(userId, pos);

        JsonObject bcast = new JsonObject();
        bcast.addProperty("type",   "CURSOR");
        bcast.addProperty("userId", userId);
        bcast.addProperty("pos",    pos);

        room.broadcastExcept(conn, gson.toJson(bcast));
    }

    // ── Handler: REVIEW_REQUEST ───────────────────────────────────────────────

    /**
     * REVIEW_REQUEST  { type, userId, language? }
     *
     * Reviews the active file (room.getDocument() returns active file content).
     * Runs the Gemini API call on a background thread that opens a secondary
     * outbound HTTPS/TCP connection independent of the WebSocket server threads.
     */
    private void handleReviewRequest(WebSocket conn, JsonObject msg) {
        Room room = roomManager.getRoomForConnection(conn);
        if (room == null) return;

        if (msg.has("language") && !msg.get("language").getAsString().isBlank()) {
            room.setLanguage(msg.get("language").getAsString());
        }

        String userId = msg.has("userId") ? msg.get("userId").getAsString() : "unknown";

        if (!room.startReview()) {
            System.out.println("[handleReviewRequest] Review already in progress, ignoring '"
                    + userId + "'.");
            return;
        }

        System.out.println("[handleReviewRequest] '" + userId + "' triggered review in room '"
                + room.getRoomCode() + "' (language: " + room.getLanguage() + ").");

        room.clearComments();

        JsonObject start = new JsonObject();
        start.addProperty("type", "REVIEW_START");
        room.broadcast(gson.toJson(start));

        // Snapshot active file content — reviews the file the room is focused on.
        final String documentSnapshot = room.getDocument();
        final String language         = room.getLanguage();

        Thread reviewThread = new Thread(() -> {
            try {
                JsonArray comments = gemini.review(documentSnapshot, language);
                System.out.println("[reviewThread] Gemini returned " + comments.size() + " comment(s).");

                if (room.isEmpty()) return;

                for (int i = 0; i < comments.size(); i++) {
                    JsonObject c = comments.get(i).getAsJsonObject();

                    int    line     = c.has("line")     ? c.get("line").getAsInt()        : 1;
                    String text     = c.has("text")     ? c.get("text").getAsString()     : "";
                    String severity = c.has("severity") ? c.get("severity").getAsString() : "info";
                    String category = c.has("category") ? c.get("category").getAsString() : "style";

                    Integer fixStartLine = null, fixEndLine = null;
                    String  fixText      = null;
                    if (c.has("fix") && !c.get("fix").isJsonNull() && c.get("fix").isJsonObject()) {
                        JsonObject fixObj = c.get("fix").getAsJsonObject();
                        fixStartLine = fixObj.has("startLine") ? fixObj.get("startLine").getAsInt() : null;
                        fixEndLine   = fixObj.has("endLine")   ? fixObj.get("endLine").getAsInt()   : null;
                        fixText      = fixObj.has("text")      ? fixObj.get("text").getAsString()   : null;
                    }

                    room.addComment(line, text, severity, category, fixStartLine, fixEndLine, fixText);

                    JsonObject aiComment = new JsonObject();
                    aiComment.addProperty("type",     "AI_COMMENT");
                    aiComment.addProperty("line",     line);
                    aiComment.addProperty("text",     text);
                    aiComment.addProperty("severity", severity);
                    aiComment.addProperty("category", category);
                    if (fixStartLine != null && fixEndLine != null && fixText != null) {
                        JsonObject fixBcast = new JsonObject();
                        fixBcast.addProperty("startLine", fixStartLine);
                        fixBcast.addProperty("endLine",   fixEndLine);
                        fixBcast.addProperty("text",      fixText);
                        aiComment.add("fix", fixBcast);
                    }
                    room.broadcast(gson.toJson(aiComment));
                }

                JsonObject done = new JsonObject();
                done.addProperty("type", "REVIEW_DONE");
                room.broadcast(gson.toJson(done));

            } catch (Exception e) {
                System.err.println("[reviewThread] Gemini API error: " + e.getMessage());

                String errText;
                if (e instanceof java.net.http.HttpTimeoutException) {
                    errText = "Review timed out after 30 s — please try again.";
                } else if (e instanceof InterruptedException) {
                    errText = "Review was interrupted.";
                } else {
                    errText = "Review failed: " + e.getMessage();
                }

                JsonObject error = new JsonObject();
                error.addProperty("type", "AI_ERROR");
                error.addProperty("text", errText);
                room.broadcast(gson.toJson(error));

            } finally {
                room.endReview();
            }
        });

        reviewThread.setDaemon(true);
        reviewThread.setName("review-" + room.getRoomCode());
        reviewThread.start();
    }

    // ── Handler: CHAT ─────────────────────────────────────────────────────────

    private void handleChat(WebSocket conn, JsonObject msg) {
        if (!msg.has("userId") || !msg.has("text")) {
            System.err.println("[handleChat] Missing userId or text.");
            return;
        }

        Room room = roomManager.getRoomForConnection(conn);
        if (room == null) {
            System.err.println("[handleChat] CHAT from connection not in any room.");
            return;
        }

        String userId  = msg.get("userId").getAsString();
        String text    = msg.get("text").getAsString().trim();
        int    replyTo = (msg.has("replyTo") && !msg.get("replyTo").isJsonNull())
                         ? msg.get("replyTo").getAsInt() : -1;

        if (text.isEmpty()) return;

        boolean isPrivate = text.toLowerCase().contains("@ai/private");
        long    timestamp = System.currentTimeMillis();

        if (isPrivate) {
            JsonObject selfMsg = new JsonObject();
            selfMsg.addProperty("type",      "CHAT");
            selfMsg.addProperty("userId",    userId);
            selfMsg.addProperty("text",      text);
            selfMsg.addProperty("timestamp", timestamp);
            selfMsg.add("replyTo", null);
            selfMsg.addProperty("private",   true);
            conn.send(gson.toJson(selfMsg));
        } else {
            room.addChatMessage(userId, text, replyTo);

            JsonObject bcast = new JsonObject();
            bcast.addProperty("type",      "CHAT");
            bcast.addProperty("userId",    userId);
            bcast.addProperty("text",      text);
            bcast.addProperty("timestamp", timestamp);
            if (replyTo >= 0) bcast.addProperty("replyTo", replyTo);
            else               bcast.add("replyTo", null);
            room.broadcast(gson.toJson(bcast));
        }

        if (text.toLowerCase().contains("@ai")) {
            final String              docSnapshot     = room.getDocument();
            final String              langSnapshot    = room.getLanguage();
            final java.util.List<JsonObject> commentSnapshot = room.getComments();
            final java.util.List<JsonObject> chatSnapshot    = room.getChatHistory();
            final String              question        = text;

            Thread aiThread = new Thread(() -> {
                try {
                    String aiResponse = gemini.chat(
                            docSnapshot, langSnapshot, commentSnapshot, chatSnapshot, question);

                    JsonObject aiChat = new JsonObject();
                    aiChat.addProperty("type",      "AI_CHAT");
                    aiChat.addProperty("text",      aiResponse);
                    aiChat.addProperty("timestamp", System.currentTimeMillis());

                    if (isPrivate) {
                        aiChat.addProperty("private", true);
                        if (conn.isOpen()) conn.send(gson.toJson(aiChat));
                    } else {
                        room.addChatMessage("ai", aiResponse, -1);
                        room.broadcast(gson.toJson(aiChat));
                    }

                } catch (Exception e) {
                    System.err.println("[aiChatThread] Gemini chat error: " + e.getMessage());
                    JsonObject error = new JsonObject();
                    error.addProperty("type", "AI_ERROR");
                    error.addProperty("text", "AI chat failed: " + e.getMessage());
                    if (isPrivate) { if (conn.isOpen()) conn.send(gson.toJson(error)); }
                    else           room.broadcast(gson.toJson(error));
                }
            });

            aiThread.setDaemon(true);
            aiThread.setName("ai-chat-" + room.getRoomCode());
            aiThread.start();
        }
    }

    // ── Handler: LANGUAGE_CHANGE ──────────────────────────────────────────────

    private void handleLanguageChange(WebSocket conn, JsonObject msg) {
        if (!msg.has("language")) return;

        Room room = roomManager.getRoomForConnection(conn);
        if (room == null) return;

        String language = msg.get("language").getAsString().trim();
        String userId   = msg.has("userId") ? msg.get("userId").getAsString() : "unknown";

        room.setLanguage(language);

        JsonObject bcast = new JsonObject();
        bcast.addProperty("type",     "LANGUAGE_CHANGE");
        bcast.addProperty("userId",   userId);
        bcast.addProperty("language", language);
        room.broadcast(gson.toJson(bcast));

        System.out.println("[handleLanguageChange] Room '" + room.getRoomCode()
                + "' language -> '" + language + "' (set by '" + userId + "').");
    }

    // ── Handler: VOICE_STATUS ─────────────────────────────────────────────────

    private void handleVoiceStatus(WebSocket conn, JsonObject msg) {
        if (!msg.has("userId") || !msg.has("speaking")) return;

        Room room = roomManager.getRoomForConnection(conn);
        if (room == null) return;

        JsonObject bcast = new JsonObject();
        bcast.addProperty("type",     "VOICE_STATUS");
        bcast.addProperty("userId",   msg.get("userId").getAsString());
        bcast.addProperty("speaking", msg.get("speaking").getAsBoolean());

        room.broadcastExcept(conn, gson.toJson(bcast));
    }

    // ── .env loader ───────────────────────────────────────────────────────────

    private static String loadApiKeyFromDotEnv() {
        try {
            java.nio.file.Path envFile = Paths.get(".env");
            if (!Files.exists(envFile)) return null;
            for (String line : Files.readAllLines(envFile)) {
                line = line.trim();
                if (line.startsWith("GEMINI_API_KEY=")) {
                    String value = line.substring("GEMINI_API_KEY=".length()).trim();
                    if (!value.isBlank()) {
                        System.out.println("[Server] Loaded GEMINI_API_KEY from .env file");
                        return value;
                    }
                }
            }
        } catch (Exception e) {
            System.err.println("[Server] Could not read .env file: " + e.getMessage());
        }
        return null;
    }
}
