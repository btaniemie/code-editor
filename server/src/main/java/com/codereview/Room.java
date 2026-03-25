package com.codereview;

import com.google.gson.JsonObject;
import org.java_websocket.WebSocket;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
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
    // Using a plain HashMap protected by synchronized blocks so the locking is
    // explicit and visible to the reader (important for the course context).
    private final Map<WebSocket, String> connections = new HashMap<>();

    // Shared document content for this room.  Every EDIT message from any client
    // updates this field (synchronized); every new joiner receives it in SYNC.
    private String document = "";

    // Last known cursor line for each userId.  Ephemeral — sent to new joiners
    // in SYNC so they can see where everyone already is.
    private final Map<String, Integer> cursors = new HashMap<>();

    // AI review comments accumulated for this room.  Persisted so a user who
    // joins mid-session or after a review receives them in SYNC.
    private final List<JsonObject> comments = new ArrayList<>();

    // Programming language for this room — used to build the Gemini prompt and
    // to tell the client which CodeMirror language extension to activate.
    private String language = "javascript";

    // Prevents two clients from triggering simultaneous reviews.
    // Volatile so the background review thread's write is immediately visible
    // to the WebSocket handler threads without a full synchronized block.
    private volatile boolean reviewInProgress = false;

    public Room(String roomCode) {
        this.roomCode = roomCode;
    }

    public synchronized String getDocument() {
        return document;
    }

    public synchronized void setDocument(String doc) {
        this.document = doc;
    }

    public synchronized void setCursor(String userId, int line) {
        cursors.put(userId, line);
    }

    public synchronized Map<String, Integer> getCursors() {
        return new HashMap<>(cursors);
    }

    public synchronized void removeCursor(String userId) {
        cursors.remove(userId);
    }

    public String getRoomCode() {
        return roomCode;
    }

    /**
     * Register a new connection in this room.
     */
    public synchronized void addConnection(WebSocket conn, String userId) {
        connections.put(conn, userId);
    }

    /**
     * Remove a connection (called on disconnect or explicit USER_LEAVE).
     * Returns the userId that was on this connection, or null if unknown.
     */
    public synchronized String removeConnection(WebSocket conn) {
        return connections.remove(conn);
    }

    /**
     * Returns true if no connections remain (room can be garbage-collected).
     */
    public synchronized boolean isEmpty() {
        return connections.isEmpty();
    }

    /**
     * Returns a snapshot of all userIds currently in the room.
     */
    public synchronized Collection<String> getUserIds() {
        return Collections.unmodifiableCollection(connections.values());
    }

    /**
     * Returns true if the given connection is currently registered in this room.
     */
    public synchronized boolean containsConnection(WebSocket conn) {
        return connections.containsKey(conn);
    }

    // -------------------------------------------------------------------------
    // Language
    // -------------------------------------------------------------------------

    public synchronized String getLanguage() {
        return language;
    }

    public synchronized void setLanguage(String language) {
        this.language = language;
    }

    // -------------------------------------------------------------------------
    // AI review comments
    // -------------------------------------------------------------------------

    /**
     * Appends one AI comment to the room's persistent comment list.
     * Called from the background review thread after each Gemini response item.
     */
    public synchronized void addComment(int line, String text, String severity, String category) {
        JsonObject comment = new JsonObject();
        comment.addProperty("line",     line);
        comment.addProperty("text",     text);
        comment.addProperty("severity", severity);
        comment.addProperty("category", category);
        comments.add(comment);
    }

    /**
     * Returns a snapshot of all accumulated comments (safe to iterate outside lock).
     */
    public synchronized List<JsonObject> getComments() {
        return new ArrayList<>(comments);
    }

    /** Clears previous review results before starting a new review. */
    public synchronized void clearComments() {
        comments.clear();
    }

    // -------------------------------------------------------------------------
    // Review-in-progress guard
    // -------------------------------------------------------------------------

    /**
     * Atomically transitions reviewInProgress false -> true.
     * Returns true if the caller won the race and should proceed with the review;
     * false if a review is already running and this request should be dropped.
     */
    public synchronized boolean startReview() {
        if (reviewInProgress) return false;
        reviewInProgress = true;
        return true;
    }

    /** Called in the background thread's finally block to release the lock. */
    public synchronized void endReview() {
        reviewInProgress = false;
    }

    // -------------------------------------------------------------------------
    // Broadcast helpers
    // -------------------------------------------------------------------------

    /**
     * Send a JSON message to every open connection in this room.
     * Called "broadcast" to make the networking intent explicit.
     */
    public synchronized void broadcast(String json) {
        for (WebSocket conn : connections.keySet()) {
            if (conn.isOpen()) {
                conn.send(json);   // frames the payload as a WebSocket text frame over TCP
            }
        }
    }

    /**
     * Same as broadcast but skips one connection — used to avoid echoing a
     * message back to the sender.
     */
    public synchronized void broadcastExcept(WebSocket except, String json) {
        for (Map.Entry<WebSocket, String> entry : connections.entrySet()) {
            WebSocket conn = entry.getKey();
            if (conn != except && conn.isOpen()) {
                conn.send(json);
            }
        }
    }
}
