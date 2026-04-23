# CodeLab

A real-time collaborative code editor. Multiple users share a live browser-based workspace with a multi-file project tree, live cursors, AI-generated inline code review, a room chat with an AI assistant, live voice chat, and an integrated code runner that streams output back over WebSocket.

## Prerequisites

- Java 17+
- Maven 3.8+
- Node.js 18+
- Python 3 (for running Python files)

Check your versions:

```bash
java -version
mvn -version
node --version
python3 --version
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
4. Everyone in the room shares the same workspace in real time, with colored cursors showing where each user is

**File Tree** — the left sidebar shows a collapsible file tree. Click `+` to create a new file, hover a file to reveal rename (pencil) and delete (×) buttons. Clicking a file switches the editor to that file for all users in the room. Folders are created automatically from paths like `src/Main.java`.

**Code Runner** — click **Run** in the left sidebar to execute the current file. Output streams line-by-line into the Output panel at the bottom of the editor as it is produced. Supported languages: JavaScript (`node`), Python (`python3`), Java (`javac` + `java`). Execution is capped at 10 seconds; a timeout message is shown if the process hangs.

**AI Code Review** — use the language selector to set the language, then click **Request AI Review**. Comments stream in as colored gutter dots; click a dot to expand the full comment. The AI reviews the currently active file. The bottom panel shows all comments as scrollable cards and can be collapsed.

**Chat** — the right sidebar is a shared room chat. Type `@ai` anywhere in a message to ask the AI assistant a question; it responds with full awareness of the current code and any review comments. Use `@ai/private` to get a response that only you can see. Join/leave notifications appear automatically.

**Voice Chat** — press and hold the **Hold to Talk** button in the left sidebar to transmit your microphone audio to everyone else in the room. A pulsing red dot and "speaking" label appear next to the speaker's name in the user list. Requires microphone permission in the browser; works in Chrome and Edge.

**Speech-to-Text** — click the microphone icon next to the chat input to dictate a message. The transcript populates the input field in real time; edit it if needed and hit Send as normal. Powered by the browser's built-in Web Speech API (Chrome/Edge only).

**Panels** — all panels (left sidebar, bottom output/comments strip, right chat) can be resized by dragging their edges and closed/reopened with the chevron buttons.

## Project Structure

```
code-editor/
├── server/                           Java WebSocket server
│   ├── pom.xml
│   └── src/main/java/com/codereview/
│       ├── Main.java                 Entry point, starts server on port 8080
│       ├── CodeReviewServer.java     WebSocket lifecycle + message router
│       │                             Handles all opcodes listed below
│       ├── RoomManager.java          Maps room codes to Room instances
│       ├── Room.java                 Per-room state: file tree (Map<path,content>),
│       │                             active file, users, cursors, AI comments,
│       │                             chat history, language, execution lock
│       ├── ExecutionManager.java     Writes file tree to a temp directory,
│       │                             spawns a child process (node/python3/javac+java),
│       │                             streams stdout/stderr back as RUN_OUTPUT frames
│       └── GeminiClient.java         Outbound HTTPS calls to Gemini API
│                                     (code review and @ai chat responses)
│
└── client/                           React + Vite frontend
    ├── index.html
    ├── vite.config.js
    ├── tailwind.config.js
    └── src/
        ├── App.jsx                   Top-level state, WebSocket logic,
        │                             file tree state, resizable panel layout
        ├── hooks/
        │   └── useVoiceChat.js       MediaRecorder capture, binary frame
        │                             framing/parsing, MSE-based playback
        └── components/
            ├── JoinScreen.jsx        Username + room code form
            ├── Editor.jsx            CodeMirror 6 editor — live cursors,
            │                         AI comment gutter, dynamic language
            ├── FileTree.jsx          Collapsible file tree — create, rename,
            │                         delete, switch active file
            ├── UserList.jsx          Live user presence list with
            │                         speaking indicators
            ├── CommentsPanel.jsx     Collapsible bottom strip of AI review cards
            ├── OutputPanel.jsx       Terminal-styled panel streaming RUN_OUTPUT
            │                         lines with green stdout / red stderr
            └── ChatPanel.jsx         Room chat with AI response bubbles
                                      and speech-to-text dictation button
```

## Message Protocol

All client-server communication uses a custom application-layer protocol over WebSocket (TCP). Text frames carry UTF-8 JSON with a `type` field as an opcode. Binary frames carry raw audio data for voice chat.

### Text frames (JSON)

| Message | Direction | Description |
|---|---|---|
| `USER_JOIN` | both | User enters a room; server broadcasts updated user list |
| `USER_LEAVE` | client → server | User explicitly leaves; server broadcasts updated user list |
| `SYNC` | server → client | Full state snapshot sent privately to a newly joined user (file tree, active file, users, cursors, comments, chat history, language) |
| `EDIT` | both | Full content of one file after a local change; includes `filePath` to identify which file |
| `CURSOR` | both | Cursor position (character offset) after a move |
| `LANGUAGE_CHANGE` | both | User changed the room language; server stores it and broadcasts to update syntax highlighting |
| `FILE_CREATE` | both | New file added to the room's tree; broadcast to all so every file tree UI updates |
| `FILE_DELETE` | both | File removed from the room's tree; broadcast to all |
| `FILE_RENAME` | both | File renamed/moved; broadcast to all |
| `FILE_SWITCH` | both | Active file changed; broadcast to all others so their editors follow |
| `REVIEW_REQUEST` | client → server | Trigger an AI code review for the active file |
| `REVIEW_START` | server → clients | Review in progress; disables the button for all users |
| `AI_COMMENT` | server → clients | One inline comment from Gemini (line, text, severity, category, optional fix) |
| `REVIEW_DONE` | server → clients | Review complete; re-enables the button |
| `AI_ERROR` | server → clients | Gemini API error or timeout |
| `CHAT` | both | Chat message from a user or system notification (join/leave) |
| `AI_CHAT` | server → clients | Gemini's response to an `@ai` mention in chat |
| `VOICE_STATUS` | both | `{ userId, speaking: bool }` — notifies all clients when a user starts or stops transmitting audio |
| `RUN_REQUEST` | client → server | Execute the current file tree for the room's active language |
| `RUN_START` | server → clients | Execution started; shows spinner in the output panel |
| `RUN_OUTPUT` | server → clients | One line of stdout/stderr from the running process |
| `RUN_DONE` | server → clients | Process exited; hides spinner |
| `RUN_ERROR` | server → clients | Execution setup failed (e.g. no active file, unsupported language) |
| `RUN_TIMEOUT` | server → clients | Process was killed after the 10-second hard timeout |

### Binary frames

| Frame | Direction | Description |
|---|---|---|
| `VOICE_CHUNK` | both | Raw audio data prefixed with a 1-byte header encoding the sender's userId length, followed by the userId bytes, followed by the MediaRecorder audio payload. The server relays it to all other connections in the room without parsing. |

---

This is a final project created for COMP 352: Computer Networks.
