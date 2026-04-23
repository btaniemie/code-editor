package com.codereview;

import com.google.gson.Gson;
import com.google.gson.JsonObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Executes code by writing the room's file tree to a temporary directory,
 * then spawning a child process via ProcessBuilder and streaming each line of
 * stdout/stderr back to the room over WebSocket as RUN_OUTPUT frames.
 *
 * Networking note: this class bridges two I/O streams —
 *   (1) the child process's stdout/stderr pipe (OS-level I/O)
 *   (2) the room's WebSocket connections (TCP + WebSocket application layer)
 * A dedicated reader thread drains the process pipe while the execution thread
 * waits on process.waitFor() with a hard timeout, ensuring we never block
 * indefinitely if the child hangs.
 */
public class ExecutionManager {

    private static final int TIMEOUT_SECONDS = 10;
    private final Gson gson = new Gson();

    /**
     * Writes files to a temp directory, runs the appropriate command for the
     * given language, and broadcasts output lines to the room.
     * Runs entirely on a daemon thread; returns immediately to the caller.
     *
     * @param files      snapshot of the room's file tree (path -> content)
     * @param activeFile entry-point file path (used to determine class/module name)
     * @param language   "java" | "python" | "javascript"
     * @param room       the room whose WebSocket connections receive the output
     */
    public void execute(Map<String, String> files, String activeFile, String language, Room room) {
        Thread execThread = new Thread(() -> {
            Path tempDir = null;
            try {
                // ── 1. Write the room's file tree to a temp directory ──────────
                // Files.createTempDirectory creates a unique dir under the OS
                // temp path (e.g. /tmp/codelab-run-12345678).
                tempDir = Files.createTempDirectory("codelab-run-");

                for (Map.Entry<String, String> entry : files.entrySet()) {
                    Path dest = tempDir.resolve(entry.getKey());
                    // createDirectories is a no-op if the path already exists,
                    // so nested paths like "src/Main.java" work safely.
                    Files.createDirectories(dest.getParent());
                    Files.writeString(dest, entry.getValue());
                }

                System.out.println("[ExecutionManager] Wrote " + files.size()
                        + " file(s) to " + tempDir);

                // ── 2. Compile (Java only) ─────────────────────────────────────
                if ("java".equals(language)) {
                    List<String> compileCmd = buildJavacCommand(tempDir);
                    System.out.println("[ExecutionManager] Compiling: " + compileCmd);
                    broadcast(room, runOutput("$ " + String.join(" ", compileCmd)));

                    int compileExit = runProcess(compileCmd, tempDir, room);
                    if (compileExit == -1) return; // timed out — RUN_TIMEOUT already broadcast
                    if (compileExit != 0) {
                        // Compilation errors were already streamed; signal completion.
                        broadcast(room, runDone());
                        return;
                    }
                }

                // ── 3. Run ────────────────────────────────────────────────────
                if (activeFile == null || activeFile.isBlank()) {
                    broadcast(room, runError("No active file selected. Click a file in the tree before running."));
                    broadcast(room, runDone());
                    return;
                }

                List<String> runCmd = buildRunCommand(language, activeFile);
                if (runCmd == null) {
                    broadcast(room, runError("Unsupported language: " + language));
                    broadcast(room, runDone());
                    return;
                }

                System.out.println("[ExecutionManager] Running: " + runCmd);
                broadcast(room, runOutput("$ " + String.join(" ", runCmd)));

                int exit = runProcess(runCmd, tempDir, room);
                if (exit != -1) {
                    broadcast(room, runDone());
                }
                // If exit == -1 (timeout), RUN_TIMEOUT was already broadcast inside runProcess.

            } catch (Exception e) {
                System.err.println("[ExecutionManager] Unexpected error: " + e.getMessage());
                broadcast(room, runError("Execution failed: " + e.getMessage()));
                broadcast(room, runDone());
            } finally {
                room.endExecution();
                // ── 4. Clean up temp directory ─────────────────────────────────
                if (tempDir != null) deleteDir(tempDir);
            }
        });

        execThread.setDaemon(true);
        execThread.setName("exec-" + room.getRoomCode());
        execThread.start();
    }

    // ── Process runner ────────────────────────────────────────────────────────

    /**
     * Spawns the given command in workDir, streams every line of stdout+stderr
     * to the room as RUN_OUTPUT frames, then waits up to TIMEOUT_SECONDS.
     *
     * Stdout and stderr are merged (redirectErrorStream) so the ordering matches
     * what a developer would see in a local terminal.
     *
     * The reader runs on a separate thread so the `waitFor` timeout is
     * enforced independently of how much output the process produces.
     *
     * @return the process exit code, or -1 if the process timed out.
     */
    private int runProcess(List<String> command, Path workDir, Room room)
            throws IOException, InterruptedException {

        ProcessBuilder pb = new ProcessBuilder(command);
        pb.directory(workDir.toFile());
        // Merge stderr into stdout — one unified stream, same as a terminal.
        pb.redirectErrorStream(true);

        Process process = pb.start();

        // Drain the process's output pipe on a dedicated thread.
        // Without this, the pipe buffer can fill up and deadlock the child process.
        Thread reader = new Thread(() -> {
            try (BufferedReader br = new BufferedReader(
                    new InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = br.readLine()) != null) {
                    broadcast(room, runOutput(line));
                }
            } catch (IOException ignored) {
                // Process was killed or pipe was closed — normal on timeout.
            }
        });
        reader.setDaemon(true);
        reader.start();

        // Wait for the process to finish, or kill it after the timeout.
        boolean finished = process.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        if (!finished) {
            process.destroyForcibly();
            reader.interrupt();
            broadcast(room, runTimeout());
            System.out.println("[ExecutionManager] Process killed after "
                    + TIMEOUT_SECONDS + "s timeout.");
            return -1;
        }

        // Give the reader thread up to 1 s to flush any remaining buffered lines.
        reader.join(1000);

        return process.exitValue();
    }

    // ── Command builders ──────────────────────────────────────────────────────

    /**
     * Returns the compile command for Java: javac -d . <all .java files>.
     * The -d . flag places .class files in workDir root so `java <ClassName>`
     * can find them regardless of where the source file lived.
     */
    private List<String> buildJavacCommand(Path tempDir) throws IOException {
        List<String> cmd = new ArrayList<>();
        cmd.add("javac");
        cmd.add("-d");
        cmd.add(".");   // output .class files to tempDir root
        Files.walk(tempDir)
                .filter(p -> p.toString().endsWith(".java") && Files.isRegularFile(p))
                .forEach(p -> cmd.add(tempDir.relativize(p).toString()));
        return cmd;
    }

    /**
     * Returns the run command for the given language.
     * Java: java -cp . <ClassName>  (stripped from activeFile)
     * Python: python3 <activeFile>
     * JavaScript: node <activeFile>
     */
    private List<String> buildRunCommand(String language, String activeFile) {
        return switch (language) {
            case "python"     -> List.of("python3", activeFile);
            case "javascript" -> List.of("node", activeFile);
            case "java" -> {
                // Derive class name: "src/Main.java" -> "Main"
                String name = activeFile;
                if (name.contains("/")) name = name.substring(name.lastIndexOf('/') + 1);
                if (name.endsWith(".java")) name = name.substring(0, name.length() - 5);
                // -cp . ensures Java looks for class files in tempDir root.
                yield List.of("java", "-cp", ".", name);
            }
            default -> null;
        };
    }

    // ── Message builders ──────────────────────────────────────────────────────

    private String runOutput(String line) {
        JsonObject msg = new JsonObject();
        msg.addProperty("type", "RUN_OUTPUT");
        msg.addProperty("line", line);
        return gson.toJson(msg);
    }

    private String runDone() {
        JsonObject msg = new JsonObject();
        msg.addProperty("type", "RUN_DONE");
        return gson.toJson(msg);
    }

    private String runError(String text) {
        JsonObject msg = new JsonObject();
        msg.addProperty("type", "RUN_ERROR");
        msg.addProperty("text", text);
        return gson.toJson(msg);
    }

    private String runTimeout() {
        JsonObject msg = new JsonObject();
        msg.addProperty("type", "RUN_TIMEOUT");
        msg.addProperty("text", "Execution timed out after " + TIMEOUT_SECONDS + " seconds.");
        return gson.toJson(msg);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private void broadcast(Room room, String json) {
        if (!room.isEmpty()) room.broadcast(json);
    }

    /** Recursively deletes a directory tree. Called in finally to free temp storage. */
    private void deleteDir(Path dir) {
        try {
            Files.walk(dir)
                    .sorted(java.util.Comparator.reverseOrder())
                    .forEach(path -> {
                        try { Files.delete(path); } catch (IOException ignored) {}
                    });
        } catch (IOException e) {
            System.err.println("[ExecutionManager] Failed to clean up " + dir + ": " + e.getMessage());
        }
    }
}
