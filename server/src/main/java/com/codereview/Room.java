package com.codereview;

import com.google.gson.JsonObject;
import org.java_websocket.WebSocket;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Represents one collaborative room. Holds the set of active TCP connections
 * (each backed by a WebSocket frame over a real java.net.Socket) and maps each
 * connection to the userId that joined on it.
 *
 * All public methods are called from CodeReviewServer handler callbacks, which
 * org.java-websocket dispatches on a per-connection thread.  We synchronize on
 * `this` so concurrent join/leave events cannot corrupt the connection map.
 */
public class Room {

    private final String roomCode;

    // Maps each live WebSocket connection -> the userId that sent USER_JOIN on it.
    private final Map<WebSocket, String> connections = new HashMap<>();

    // ── File tree ─────────────────────────────────────────────────────────────
    // Maps file path (e.g. "src/Main.java") -> file content.
    // LinkedHashMap preserves insertion order for deterministic SYNC payloads.
    // Every EDIT message targets a specific path; every new joiner receives
    // the full map in SYNC so they start in sync with the room.
    private final Map<String, String> files = new LinkedHashMap<>();

    // The currently "active" (focused) file path.  Used as the review target
    // and as the document new joiners' editors open on.
    private String activeFile = "main.js";

    // Last known cursor position for each userId (char offset in active file).
    private final Map<String, Integer> cursors = new HashMap<>();

    // AI review comments accumulated for this room.
    private final List<JsonObject> comments = new ArrayList<>();

    // Chat message history for this room.
    private final List<JsonObject> chatHistory = new ArrayList<>();

    // Programming language for this room.
    private String language = "javascript";

    // Prevents two clients from triggering simultaneous reviews.
    private volatile boolean reviewInProgress = false;

    // Prevents concurrent code executions.
    private volatile boolean executionInProgress = false;

    public Room(String roomCode) {
        this.roomCode = roomCode;
        // Seed one default file so the room is never empty on first join.
        files.put("main.js", "");
    }

    // ── File tree ─────────────────────────────────────────────────────────────

    /** Returns a snapshot of the full file tree (path -> content). */
    public synchronized Map<String, String> getFiles() {
        return new LinkedHashMap<>(files);
    }

    /** Returns the content of one file, or "" if the path does not exist. */
    public synchronized String getFile(String path) {
        return files.getOrDefault(path, "");
    }

    /** Creates or overwrites a file. */
    public synchronized void setFile(String path, String content) {
        files.put(path, content);
    }

    /** Removes a file. No-op if the path does not exist. */
    public synchronized void deleteFile(String path) {
        files.remove(path);
    }

    /**
     * Renames (moves) a file.  Content is preserved; the old entry is removed.
     * No-op if oldPath does not exist.
     */
    public synchronized void renameFile(String oldPath, String newPath) {
        String content = files.remove(oldPath);
        if (content != null) {
            files.put(newPath, content);
        }
    }

    public synchronized String getActiveFile() {
        return activeFile;
    }

    public synchronized void setActiveFile(String path) {
        this.activeFile = path;
    }

    /**
     * Convenience: returns the content of the active file.
     * Used by the AI review snapshot so it sees what the room is focused on.
     */
    public synchronized String getDocument() {
        return files.getOrDefault(activeFile, "");
    }

    // ── Cursors ───────────────────────────────────────────────────────────────

    public synchronized void setCursor(String userId, int line) {
        cursors.put(userId, line);
    }

    public synchronized Map<String, Integer> getCursors() {
        return new HashMap<>(cursors);
    }

    public synchronized void removeCursor(String userId) {
        cursors.remove(userId);
    }

    // ── Connections ───────────────────────────────────────────────────────────

    public String getRoomCode() { return roomCode; }

    public synchronized void addConnection(WebSocket conn, String userId) {
        connections.put(conn, userId);
    }

    public synchronized String removeConnection(WebSocket conn) {
        return connections.remove(conn);
    }

    public synchronized boolean isEmpty() { return connections.isEmpty(); }

    public synchronized Collection<String> getUserIds() {
        return Collections.unmodifiableCollection(connections.values());
    }

    public synchronized boolean containsConnection(WebSocket conn) {
        return connections.containsKey(conn);
    }

    // ── Language ──────────────────────────────────────────────────────────────

    public synchronized String getLanguage() { return language; }

    public synchronized void setLanguage(String language) { this.language = language; }

    // ── AI review comments ────────────────────────────────────────────────────

    public synchronized void addComment(int line, String text, String severity, String category,
                                        Integer fixStartLine, Integer fixEndLine, String fixText) {
        JsonObject comment = new JsonObject();
        comment.addProperty("line",     line);
        comment.addProperty("text",     text);
        comment.addProperty("severity", severity);
        comment.addProperty("category", category);
        if (fixStartLine != null && fixEndLine != null && fixText != null) {
            JsonObject fix = new JsonObject();
            fix.addProperty("startLine", fixStartLine);
            fix.addProperty("endLine",   fixEndLine);
            fix.addProperty("text",      fixText);
            comment.add("fix", fix);
        }
        comments.add(comment);
    }

    public synchronized List<JsonObject> getComments() { return new ArrayList<>(comments); }

    public synchronized void clearComments() { comments.clear(); }

    // ── Chat history ──────────────────────────────────────────────────────────

    public synchronized void addChatMessage(String userId, String text, int replyTo) {
        JsonObject msg = new JsonObject();
        msg.addProperty("userId",    userId);
        msg.addProperty("text",      text);
        msg.addProperty("timestamp", System.currentTimeMillis());
        if (replyTo >= 0) msg.addProperty("replyTo", replyTo);
        else              msg.add("replyTo", null);
        chatHistory.add(msg);
    }

    public synchronized List<JsonObject> getChatHistory() { return new ArrayList<>(chatHistory); }

    // ── Review guard ──────────────────────────────────────────────────────────

    /** Atomically acquires the review lock. Returns false if a review is already running. */
    public synchronized boolean startReview() {
        if (reviewInProgress) return false;
        reviewInProgress = true;
        return true;
    }

    public synchronized void endReview() { reviewInProgress = false; }

    // ── Execution guard ───────────────────────────────────────────────────────

    /** Atomically acquires the execution lock. Returns false if already running. */
    public synchronized boolean startExecution() {
        if (executionInProgress) return false;
        executionInProgress = true;
        return true;
    }

    public synchronized void endExecution() { executionInProgress = false; }

    // ── Broadcast helpers ─────────────────────────────────────────────────────

    /**
     * Send a JSON message to every open connection in this room.
     * Each send() frames the payload as a WebSocket text frame (opcode 0x1) over TCP.
     */
    public synchronized void broadcast(String json) {
        for (WebSocket conn : connections.keySet()) {
            if (conn.isOpen()) conn.send(json);
        }
    }

    /**
     * Same as broadcast but skips one connection — used to avoid echoing a
     * message back to the sender (standard fanout pattern: one writer, N-1 readers).
     */
    public synchronized void broadcastExcept(WebSocket except, String json) {
        for (Map.Entry<WebSocket, String> entry : connections.entrySet()) {
            WebSocket conn = entry.getKey();
            if (conn != except && conn.isOpen()) conn.send(json);
        }
    }

    /**
     * Broadcast a binary WebSocket frame (raw audio) to all peers except the sender.
     * Binary frames use opcode 0x2 vs text frames (opcode 0x1).
     * Buffer is duplicated per recipient so each send() gets independent position/limit.
     */
    public synchronized void broadcastBinaryExcept(WebSocket except, ByteBuffer data) {
        for (WebSocket conn : connections.keySet()) {
            if (conn != except && conn.isOpen()) conn.send(data.duplicate());
        }
    }
}
