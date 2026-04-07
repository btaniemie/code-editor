package com.codereview;

import com.google.gson.JsonObject;
import org.java_websocket.WebSocket;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

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

    // Virtual file system: filename → content.
    // LinkedHashMap preserves insertion order so the first file is always the default.
    // All access is synchronized; callers receive defensive copies.
    private final Map<String, String> files = new LinkedHashMap<>();

    // Last known cursor character offset for each userId.
    private final Map<String, Integer> cursors = new HashMap<>();

    // AI review comments accumulated for this room.
    private final List<JsonObject> comments = new ArrayList<>();

    // Chat message history for this room.
    private final List<JsonObject> chatHistory = new ArrayList<>();

    // Programming language for syntax highlighting and Gemini prompts.
    private String language = "javascript";

    // Prevents two clients from triggering simultaneous reviews.
    private volatile boolean reviewInProgress = false;

    // ── Terminal process ──────────────────────────────────────────────────────

    private Process       terminalProcess = null;
    private OutputStream  terminalStdin   = null;

    public Room(String roomCode) {
        this.roomCode = roomCode;
        // Every new room starts with one default file.
        files.put("main.js", "");
    }

    // ── File system ───────────────────────────────────────────────────────────

    /** Creates a file with the given name if it does not already exist. */
    public synchronized boolean createFile(String filename) {
        if (files.containsKey(filename)) return false;
        files.put(filename, "");
        return true;
    }

    /**
     * Removes a file.  Returns false if the file did not exist or it is the
     * last remaining file (we always keep at least one).
     */
    public synchronized boolean deleteFile(String filename) {
        if (!files.containsKey(filename) || files.size() <= 1) return false;
        files.remove(filename);
        return true;
    }

    /**
     * Renames oldName to newName.  Returns false if the source does not exist
     * or the destination already exists.
     */
    public synchronized boolean renameFile(String oldName, String newName) {
        if (!files.containsKey(oldName) || files.containsKey(newName)) return false;
        String content = files.remove(oldName);
        files.put(newName, content);
        return true;
    }

    /** Returns a snapshot of all filename → content entries. */
    public synchronized Map<String, String> getFiles() {
        return new LinkedHashMap<>(files);
    }

    /** Returns the content of one file, or empty string if not found. */
    public synchronized String getFileContent(String filename) {
        return files.getOrDefault(filename, "");
    }

    /** Updates the content of one file (creates it if it doesn't exist). */
    public synchronized void setFileContent(String filename, String content) {
        files.put(filename, content);
    }

    /** Returns true if the file exists in this room. */
    public synchronized boolean hasFile(String filename) {
        return files.containsKey(filename);
    }

    /**
     * Returns the content of the first file (used by Gemini review when no
     * explicit filename is given by the client).
     */
    public synchronized String getDocument() {
        if (files.isEmpty()) return "";
        return files.values().iterator().next();
    }

    /**
     * Legacy setter — only kept so existing EDIT handler code that has not yet
     * been updated continues to compile.  New code should call setFileContent.
     */
    public synchronized void setDocument(String doc) {
        if (!files.isEmpty()) {
            String first = files.keySet().iterator().next();
            files.put(first, doc);
        }
    }

    // ── Connections ───────────────────────────────────────────────────────────

    public synchronized void addConnection(WebSocket conn, String userId) {
        connections.put(conn, userId);
    }

    public synchronized String removeConnection(WebSocket conn) {
        return connections.remove(conn);
    }

    public synchronized boolean isEmpty() {
        return connections.isEmpty();
    }

    public synchronized Collection<String> getUserIds() {
        return Collections.unmodifiableCollection(connections.values());
    }

    public synchronized boolean containsConnection(WebSocket conn) {
        return connections.containsKey(conn);
    }

    public String getRoomCode() { return roomCode; }

    // ── Cursors ───────────────────────────────────────────────────────────────

    public synchronized void setCursor(String userId, int pos) {
        cursors.put(userId, pos);
    }

    public synchronized Map<String, Integer> getCursors() {
        return new HashMap<>(cursors);
    }

    public synchronized void removeCursor(String userId) {
        cursors.remove(userId);
    }

    // ── Language ──────────────────────────────────────────────────────────────

    public synchronized String getLanguage() { return language; }

    public synchronized void setLanguage(String language) { this.language = language; }

    // ── AI review comments ────────────────────────────────────────────────────

    public synchronized void addComment(int line, String text, String severity, String category) {
        JsonObject comment = new JsonObject();
        comment.addProperty("line",     line);
        comment.addProperty("text",     text);
        comment.addProperty("severity", severity);
        comment.addProperty("category", category);
        comments.add(comment);
    }

    public synchronized List<JsonObject> getComments() {
        return new ArrayList<>(comments);
    }

    public synchronized void clearComments() {
        comments.clear();
    }

    // ── Chat history ──────────────────────────────────────────────────────────

    public synchronized void addChatMessage(String userId, String text, int replyTo) {
        JsonObject msg = new JsonObject();
        msg.addProperty("userId",    userId);
        msg.addProperty("text",      text);
        msg.addProperty("timestamp", System.currentTimeMillis());
        if (replyTo >= 0) {
            msg.addProperty("replyTo", replyTo);
        } else {
            msg.add("replyTo", null);
        }
        chatHistory.add(msg);
    }

    public synchronized List<JsonObject> getChatHistory() {
        return new ArrayList<>(chatHistory);
    }

    // ── Review lock ───────────────────────────────────────────────────────────

    public synchronized boolean startReview() {
        if (reviewInProgress) return false;
        reviewInProgress = true;
        return true;
    }

    public synchronized void endReview() {
        reviewInProgress = false;
    }

    // ── Terminal ──────────────────────────────────────────────────────────────

    /**
     * Spawns a /bin/bash process for this room if one is not already running.
     * The outputBroadcaster callback is invoked on every chunk of stdout/stderr
     * so the caller can broadcast it to all clients as TERMINAL_OUTPUT.
     */
    public synchronized void startTerminal(Consumer<String> outputBroadcaster) {
        if (terminalProcess != null && terminalProcess.isAlive()) return;

        try {
            // Run bash in interactive mode (-i).
            //
            // Why not `script -q /dev/null /bin/bash`?
            //   `script` calls tcgetattr() on its own stdin.  When stdin is a
            //   Java ProcessBuilder pipe (not a real TTY), tcgetattr() returns
            //   ENOTTY and `script` exits immediately — so bash never starts and
            //   every write to terminalStdin is silently dropped.
            //
            // With `-i`, bash is forced into interactive mode regardless of whether
            // stdin is a terminal.  It writes the PS1 prompt to stderr (which we
            // capture via redirectErrorStream) and reads commands line-by-line from
            // stdin.  Echo and readline are not available without a PTY, so the
            // client implements local echo instead (see Terminal.jsx).
            ProcessBuilder pb = new ProcessBuilder("/bin/bash", "-i");
            pb.redirectErrorStream(true);   // merge PS1 prompts (stderr) into stdout
            pb.environment().put("TERM", "xterm-256color");
            pb.environment().put("COLUMNS", "200");
            pb.environment().put("LINES",   "50");

            terminalProcess = pb.start();
            terminalStdin   = terminalProcess.getOutputStream();

            // Background thread: read process output and broadcast to clients.
            Thread reader = new Thread(() -> {
                byte[] buf = new byte[4096];
                try (var stream = terminalProcess.getInputStream()) {
                    int n;
                    while ((n = stream.read(buf)) != -1) {
                        String chunk = new String(buf, 0, n);
                        outputBroadcaster.accept(chunk);
                    }
                } catch (IOException e) {
                    // process ended — normal shutdown
                }
            });
            reader.setDaemon(true);
            reader.setName("terminal-out-" + roomCode);
            reader.start();

            System.out.println("[Terminal] Started /bin/bash for room '" + roomCode + "'.");
        } catch (IOException e) {
            System.err.println("[Terminal] Failed to start /bin/bash: " + e.getMessage());
        }
    }

    /** Returns true if the terminal process is running. */
    public synchronized boolean isTerminalRunning() {
        return terminalProcess != null && terminalProcess.isAlive();
    }

    /** Writes raw bytes to the terminal's stdin (user keystrokes from the client). */
    public synchronized void writeToTerminal(String data) {
        if (terminalStdin == null || terminalProcess == null || !terminalProcess.isAlive()) return;
        try {
            terminalStdin.write(data.getBytes());
            terminalStdin.flush();
        } catch (IOException e) {
            System.err.println("[Terminal] Write error: " + e.getMessage());
        }
    }

    /** Kills the terminal process (called when the room is destroyed). */
    public synchronized void stopTerminal() {
        if (terminalProcess != null) {
            terminalProcess.destroyForcibly();
            terminalProcess = null;
            terminalStdin   = null;
            System.out.println("[Terminal] Stopped for room '" + roomCode + "'.");
        }
    }

    // ── Broadcast helpers ─────────────────────────────────────────────────────

    public synchronized void broadcast(String json) {
        for (WebSocket conn : connections.keySet()) {
            if (conn.isOpen()) conn.send(json);
        }
    }

    public synchronized void broadcastExcept(WebSocket except, String json) {
        for (Map.Entry<WebSocket, String> entry : connections.entrySet()) {
            WebSocket conn = entry.getKey();
            if (conn != except && conn.isOpen()) conn.send(json);
        }
    }
}
