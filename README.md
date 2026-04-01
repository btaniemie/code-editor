# CodeLab

A real-time collaborative code editor. Multiple users share a live browser-based editor with live cursors, AI-generated inline code review comments, and a room chat with an AI assistant.

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

## Setup

The server requires a Gemini API key. Create a `.env` file inside the `server/` directory:

```
GEMINI_API_KEY=your_api_key_here
```

## Running the Server

```bash
cd server
source .env
mvn package -q
java -jar target/codereview-server.jar
```

Expected output:
```
[Server] GEMINI_API_KEY loaded (length=39, prefix=AIzaSy...)
[Main] Server started. Press Ctrl+C to stop.
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

**AI Code Review** — use the language selector in the left sidebar to set the language (JavaScript, Python, or Java), then click **Request AI Review**. Comments stream in as colored gutter dots; click a dot to expand the full comment. The bottom panel shows all comments as scrollable cards and can be collapsed.

**Chat** — the right sidebar is a shared room chat. Type `@ai` anywhere in a message to ask the AI assistant a question; it responds with full awareness of the current code and any review comments. Join/leave notifications appear automatically.

**Panels** — all three panels (left sidebar, bottom AI review strip, right chat) can be resized by dragging their edges and closed/reopened with the chevron buttons.

## Project Structure

```
code-editor/
├── server/                           Java WebSocket server
│   ├── pom.xml
│   └── src/main/java/com/codereview/
│       ├── Main.java                 Entry point, starts server on port 8080
│       ├── CodeReviewServer.java     WebSocket lifecycle + message router
│       ├── RoomManager.java          Maps room codes to Room instances
│       ├── Room.java                 Per-room state: document, users, cursors,
│       │                             AI comments, chat history, language
│       └── GeminiClient.java         Outbound HTTPS calls to Gemini API
│                                     (code review and @ai chat responses)
│
└── client/                           React + Vite frontend
    ├── index.html
    ├── vite.config.js
    ├── tailwind.config.js
    └── src/
        ├── App.jsx                   Top-level state, WebSocket logic,
        │                             resizable panel layout
        └── components/
            ├── JoinScreen.jsx        Username + room code form
            ├── Editor.jsx            CodeMirror 6 editor — live cursors,
            │                         AI comment gutter, dynamic language
            ├── UserList.jsx          Live user presence list
            ├── CommentsPanel.jsx     Collapsible bottom strip of AI review cards
            └── ChatPanel.jsx         Room chat with AI response bubbles
```

## Message Protocol

All client-server communication is JSON over WebSocket (TCP). Each message has a `type` field acting as an opcode:

| Message | Direction | Description |
|---|---|---|
| `USER_JOIN` | both | User enters a room; server broadcasts updated user list |
| `USER_LEAVE` | server → clients | User disconnected; server broadcasts updated user list |
| `SYNC` | server → client | Full state snapshot sent privately to a newly joined user (document, users, cursors, comments, chat history, language) |
| `EDIT` | both | Full document content after a local change |
| `CURSOR` | both | Cursor position (character offset) after a move |
| `LANGUAGE_CHANGE` | both | User changed the room language; server stores it and broadcasts to all clients to update syntax highlighting |
| `REVIEW_REQUEST` | client → server | Trigger an AI code review for the current language |
| `REVIEW_START` | server → clients | Review in progress; disables the button for all users |
| `AI_COMMENT` | server → clients | One inline comment from Gemini (line, text, severity, category) |
| `REVIEW_DONE` | server → clients | Review complete; re-enables the button |
| `AI_ERROR` | server → clients | Gemini API error or timeout |
| `CHAT` | both | Chat message from a user or system notification (join/leave) |
| `AI_CHAT` | server → clients | Gemini's response to an @ai mention in chat |

---

This is a final project created for COMP 352.
