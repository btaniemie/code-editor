package com.codereview;

import org.java_websocket.WebSocket;

import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
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

    public Room(String roomCode) {
        this.roomCode = roomCode;
    }

    public synchronized String getDocument() {
        return document;
    }

    public synchronized void setDocument(String doc) {
        this.document = doc;
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
