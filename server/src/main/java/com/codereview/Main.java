package com.codereview;

/**
 * Entry point. Reads an optional port argument, starts the WebSocket server,
 * and blocks until the process is killed.
 *
 *   java -jar target/codereview-server.jar          # default port 8080
 *   java -jar target/codereview-server.jar 9000     # custom port
 */
public class Main {

    private static final int DEFAULT_PORT = 8080;

    public static void main(String[] args) throws InterruptedException {
        int port = DEFAULT_PORT;
        String portEnv = System.getenv("PORT");
        if (portEnv != null && !portEnv.isBlank()) {
            try {
                port = Integer.parseInt(portEnv.trim());
            } catch (NumberFormatException e) {
                System.err.println("Invalid PORT env var '" + portEnv + "', using default " + DEFAULT_PORT);
            }
        } else if (args.length > 0) {
            try {
                port = Integer.parseInt(args[0]);
            } catch (NumberFormatException e) {
                System.err.println("Invalid port '" + args[0] + "', using default " + DEFAULT_PORT);
            }
        }

        CodeReviewServer server = new CodeReviewServer(port);
        server.start();   // spawns the TCP accept loop on a background thread

        System.out.println("[Main] Server started. Press Ctrl+C to stop.");

        // Keep the main thread alive so the JVM does not exit.
        // The server's accept loop runs on its own daemon thread.
        Thread.currentThread().join();
    }
}
