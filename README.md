# CodeReview

A real-time collaborative code editor. Multiple users share a live browser-based editor with live cursors, and receive AI-generated code review feedback inline.

## Prerequisites

- Java 17+
- Maven 3.8+
- Node.js 18+

Check your versions:

```bash
java -version
mvn -version
node -version
```

## Running the Server

```bash
cd server
mvn package -q
java -jar target/codereview-server.jar
```

Expected output:
```
[Server] CodeReview WebSocket server listening on port 8080
[Server] Waiting for client connections...
```

Leave this terminal running. The server listens on `ws://localhost:8080`.

## Running the Client

Open a second terminal:

```bash
cd client
npm install
npm run dev
```

The client runs at `http://localhost:5173`.

## Using the App

1. Open `http://localhost:5173` in your browser
2. Enter a username and either:
   - Click **Create room** to generate a room code
   - Paste a room code and click **Join room**
3. Share the room code with others — open more browser tabs or send it to teammates
4. Everyone in the room shares the same editor in real time, with colored cursors showing where each user is

## Project Structure

```
code-editor/
├── server/                         Java WebSocket server
│   ├── pom.xml
│   └── src/main/java/com/codereview/
│       ├── Main.java               Entry point, starts server on port 8080
│       ├── CodeReviewServer.java   WebSocket lifecycle + message router
│       ├── RoomManager.java        Maps room codes to Room instances
│       └── Room.java               Per-room state: document, users, cursors
│
└── client/                         React + Vite frontend
    ├── index.html
    ├── vite.config.js
    ├── tailwind.config.js
    └── src/
        ├── App.jsx                 Top-level state, WebSocket logic
        └── components/
            ├── JoinScreen.jsx      Username + room code form
            ├── Editor.jsx          CodeMirror 6 editor with live cursors
            └── UserList.jsx        Live user presence sidebar
```

## Message Protocol

All client-server communication is JSON over WebSocket (TCP). Each message has a `type` field acting as an opcode:

| Message | Direction | Description |
|---|---|---|
| `USER_JOIN` | both | User enters a room; server broadcasts updated user list |
| `USER_LEAVE` | server → clients | User disconnected; server broadcasts updated user list |
| `SYNC` | server → client | Full state snapshot sent privately to a newly joined user |
| `EDIT` | both | Full document content after a local change |
| `CURSOR` | both | Cursor position (character offset) after a move |
| `REVIEW_REQUEST` | client → server | Trigger an AI code review |
| `REVIEW_START` | server → clients | Review in progress; disable the button for all users |
| `AI_COMMENT` | server → clients | One inline comment from Claude (line, text, severity, category) |
| `REVIEW_DONE` | server → clients | Review complete; re-enable the button |
| `AI_ERROR` | server → clients | Claude API error |
| `CHAT` | both | Chat message from a user |
| `AI_CHAT` | server → clients | Claude's response to an @ai mention |

---

This is a final project created for COMP 352.
