package com.codereview;

import org.java_websocket.WebSocket;

import java.util.HashMap;
import java.util.Map;

/**
 * Global registry that maps room codes (e.g. "abc123") to Room objects.
 *
 * There is exactly one RoomManager instance for the lifetime of the server
 * process.  All access is synchronized so concurrent WebSocket callbacks
 * (which run on separate threads) cannot race when creating or destroying rooms.
 */
public class RoomManager {

    // room code -> Room
    private final Map<String, Room> rooms = new HashMap<>();

    /**
     * Return the Room for the given code, creating one if it does not exist.
     */
    public synchronized Room getOrCreateRoom(String roomCode) {
        return rooms.computeIfAbsent(roomCode, Room::new);
    }

    /**
     * Look up the room a given WebSocket connection belongs to by scanning all
     * rooms.  Returns null if the connection is not currently in any room
     * (e.g. it closed before sending USER_JOIN).
     */
    public synchronized Room getRoomForConnection(WebSocket conn) {
        for (Room room : rooms.values()) {
            // Each Room keeps its own connection map; we delegate the lookup.
            if (room.getUserIds() != null && containsConnection(room, conn)) {
                return room;
            }
        }
        return null;
    }

    /**
     * Remove a room from the registry if it is now empty, freeing memory.
     */
    public synchronized void removeRoomIfEmpty(String roomCode) {
        Room room = rooms.get(roomCode);
        if (room != null && room.isEmpty()) {
            rooms.remove(roomCode);
            System.out.println("[RoomManager] Room '" + roomCode + "' is empty, removed from registry.");
        }
    }

    // --- private helpers ---

    /**
     * Ask the room whether a particular WebSocket is registered in it.
     * We expose getUserIds() from Room for display, but to check membership we
     * remove the connection and see if we got a userId back (then re-add if so).
     * Simpler: Room exposes a contains() check.
     *
     * NOTE: Room.removeConnection returns the userId; we use a dedicated check
     * method added to Room instead to avoid side-effects here.
     */
    private boolean containsConnection(Room room, WebSocket conn) {
        // Delegate to the room; Room already synchronizes internally.
        return room.containsConnection(conn);
    }
}
