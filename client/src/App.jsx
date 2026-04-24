import { useState, useRef, useCallback, useEffect } from 'react'
import JoinScreen    from './components/JoinScreen'
import UserList      from './components/UserList'
import Editor        from './components/Editor'
import CommentsPanel from './components/CommentsPanel'
import ChatPanel     from './components/ChatPanel'
import FileTree      from './components/FileTree'
import OutputPanel   from './components/OutputPanel'
import { useVoiceChat } from './hooks/useVoiceChat'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'ws://localhost:8080'

const LANGUAGES = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python',     label: 'Python'     },
  { value: 'java',       label: 'Java'       },
]

// ── Reusable SVG chevrons ───────────────────────────────────────────────────

function ChevronLeft() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
    </svg>
  )
}

// ── Drag-to-resize handle ───────────────────────────────────────────────────

function DragHandle({ direction, onMove }) {
  const startDrag = (e) => {
    e.preventDefault()
    document.body.style.cursor     = direction === 'vertical' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'

    const handleMove = (ev) => onMove(ev.clientX, ev.clientY)
    const handleUp   = () => {
      document.body.style.cursor     = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup',   handleUp)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup',   handleUp)
  }

  return direction === 'vertical' ? (
    <div
      onMouseDown={startDrag}
      className="w-1 flex-shrink-0 cursor-col-resize bg-gray-800 hover:bg-emerald-600/50 transition-colors"
    />
  ) : (
    <div
      onMouseDown={startDrag}
      className="h-1 flex-shrink-0 cursor-row-resize bg-gray-800 hover:bg-emerald-600/50 transition-colors"
    />
  )
}

// ── Collapsed panel strip ───────────────────────────────────────────────────

function CollapsedStrip({ side, label, onOpen }) {
  const isLeft = side === 'left'
  return (
    <div
      className={`w-9 flex-shrink-0 bg-gray-900 flex flex-col items-center py-2 gap-3 cursor-pointer
        hover:bg-gray-800/60 transition-colors
        ${isLeft ? 'border-r border-gray-800' : 'border-l border-gray-800'}`}
      onClick={onOpen}
      title={`Open ${label}`}
    >
      <span className="text-gray-600 hover:text-gray-400 transition-colors">
        {isLeft ? <ChevronRight /> : <ChevronLeft />}
      </span>
      <span
        className="text-[10px] text-gray-600 uppercase tracking-widest"
        style={{ writingMode: 'vertical-rl', transform: isLeft ? 'rotate(180deg)' : 'none' }}
      >
        {label}
      </span>
    </div>
  )
}

// ── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [session,          setSession]          = useState(null)
  const [users,            setUsers]            = useState([])
  const [status,           setStatus]           = useState('')
  const [comments,         setComments]         = useState([])
  const [reviewInProgress, setReviewInProgress] = useState(false)
  const [chat,             setChat]             = useState([])
  const [language,         setLanguage]         = useState('javascript')

  // ── File tree state ─────────────────────────────────────────────────────
  //
  // filesRef is the authoritative in-memory store of path->content.
  // Updated synchronously on local edits and incoming EDIT/SYNC frames so
  // file-switching can restore content without a React re-render round-trip.
  //
  // filePaths is the React state counterpart used only to re-render FileTree.
  // activeFile / activeFileRef mirror each other (state for rendering,
  // ref for use inside stale WebSocket-closure callbacks).
  const filesRef        = useRef({ 'main.js': '' })
  const [filePaths,    setFilePaths]    = useState(['main.js'])
  const [activeFile,   setActiveFile]   = useState('main.js')
  const activeFileRef  = useRef('main.js')

  // ── Run / output state ─────────────────────────────────────────────────
  const [outputLines,    setOutputLines]    = useState([])
  const [runInProgress,  setRunInProgress]  = useState(false)
  const [outputOpen,     setOutputOpen]     = useState(false)
  const [outputHeight,   setOutputHeight]   = useState(200)

  // ── Panel layout ───────────────────────────────────────────────────────
  const [leftOpen,   setLeftOpen]   = useState(true)
  const [rightOpen,  setRightOpen]  = useState(true)
  const [bottomOpen, setBottomOpen] = useState(true)
  const [leftWidth,    setLeftWidth]    = useState(224)
  const [rightWidth,   setRightWidth]   = useState(288)
  const [bottomHeight, setBottomHeight] = useState(176)

  const wsRef = useRef(null)

  // ── Voice chat ─────────────────────────────────────────────────────────
  const {
    isSpeaking, speakingUsers, micAvailable,
    onBinaryMessage, onVoiceStatus,
    startSpeaking, stopSpeaking, cleanup: voiceCleanup,
  } = useVoiceChat(wsRef)

  const onBinaryMessageRef = useRef(onBinaryMessage)
  useEffect(() => { onBinaryMessageRef.current = onBinaryMessage }, [onBinaryMessage])

  // ── Imperative CodeMirror handles ──────────────────────────────────────
  const applyEditRef        = useRef(null)
  const applyCursorRef      = useRef(null)
  const removeCursorRef     = useRef(null)
  const addCommentRef       = useRef(null)
  const clearCommentsRef    = useRef(null)
  const setEditorLanguageRef = useRef(null)

  // ── Pending state (arrived before editor mounted) ─────────────────────
  // Stores { files: {...}, activeFile: '...' } when SYNC arrives before Editor mounts.
  const pendingFilesRef    = useRef(null)
  const pendingCursorsRef  = useRef(null)
  const pendingCommentsRef = useRef(null)
  const pendingLanguageRef = useRef(null)

  // Prevents EDIT messages from being sent before the initial SYNC is applied.
  const syncReceivedRef = useRef(false)

  // ── Auto-switch away from a deleted active file ────────────────────────
  useEffect(() => {
    if (!session) return
    if (!(activeFile in filesRef.current) && filePaths.length > 0) {
      const first = filePaths[0]
      setActiveFile(first)
      activeFileRef.current = first
      applyEditRef.current?.(filesRef.current[first] ?? '')
    }
  }, [filePaths, activeFile, session])

  // ── WebSocket connection ───────────────────────────────────────────────

  const connectWS = useCallback((userId, roomCode) => {
    const ws = new WebSocket(SERVER_URL)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'USER_JOIN', userId, roomCode }))
      setStatus('Connected')
    }
    ws.onmessage = (event) => {
      if (event.data instanceof Blob) {
        event.data.arrayBuffer().then(buf => onBinaryMessageRef.current?.(buf))
        return
      }
      handleMessage(JSON.parse(event.data), userId, roomCode)
    }
    ws.onclose = () => setStatus('Disconnected')
    ws.onerror = () => setStatus('Connection error')
  }, []) // stable — all updates go through refs

  const handleJoin = useCallback((userId, roomCode) => {
    connectWS(userId, roomCode)
  }, [connectWS])

  // ── Reconnect ──────────────────────────────────────────────────────────

  const handleReconnect = useCallback(() => {
    if (!session) return
    if (wsRef.current) wsRef.current.close()
    syncReceivedRef.current  = false
    filesRef.current         = {}
    pendingFilesRef.current  = null
    setFilePaths([])
    setActiveFile('main.js')
    activeFileRef.current = 'main.js'
    setComments([])
    setChat([])
    setReviewInProgress(false)
    setOutputLines([])
    setRunInProgress(false)
    clearCommentsRef.current?.()
    connectWS(session.userId, session.roomCode)
  }, [session, connectWS])

  // ── Client-side message router ─────────────────────────────────────────
  //
  // NOTE: handleMessage lives inside the connectWS closure, so `userId` and
  // `roomCode` are captured at connection time (stable strings).
  // State reads happen through refs; state writes use stable setState fns.

  function handleMessage(msg, userId, roomCode) {
    switch (msg.type) {

      case 'USER_JOIN':
        setUsers(msg.users)
        setSession({ userId, roomCode })
        break

      case 'USER_LEAVE':
        setUsers(msg.users)
        removeCursorRef.current?.(msg.userId)
        break

      // ── SYNC: full room state sent to a newly-joining client ─────────
      // The SYNC message now carries a `files` map + `activeFile` instead
      // of a single `document` string, matching the updated server protocol.
      case 'SYNC': {
        const newFiles  = msg.files      ?? {}
        const newActive = msg.activeFile ?? Object.keys(newFiles)[0] ?? 'main.js'

        // Update the authoritative in-memory file store and React state.
        filesRef.current = { ...newFiles }
        setFilePaths(Object.keys(newFiles))
        setActiveFile(newActive)
        activeFileRef.current = newActive

        if (applyEditRef.current) {
          // Editor is already mounted — apply active file content directly.
          applyEditRef.current(newFiles[newActive] ?? '')
          syncReceivedRef.current = true
        } else {
          // Editor not mounted yet — stage for onEditorReady.
          pendingFilesRef.current = { files: newFiles, activeFile: newActive }
        }

        if (msg.cursors && Object.keys(msg.cursors).length > 0) {
          if (applyCursorRef.current) {
            for (const [uid, pos] of Object.entries(msg.cursors))
              applyCursorRef.current(uid, pos)
          } else {
            pendingCursorsRef.current = msg.cursors
          }
        }

        if (msg.comments && msg.comments.length > 0) {
          setComments(msg.comments)
          if (clearCommentsRef.current && addCommentRef.current) {
            clearCommentsRef.current()
            for (const c of msg.comments)
              addCommentRef.current(c.line, c.text, c.severity, c.category, c.fix ?? null)
          } else {
            pendingCommentsRef.current = msg.comments
          }
        }

        if (msg.chat && msg.chat.length > 0) setChat(msg.chat)

        if (msg.language) {
          setLanguage(msg.language)
          if (setEditorLanguageRef.current) setEditorLanguageRef.current(msg.language)
          else pendingLanguageRef.current = msg.language
        }
        break
      }

      // ── EDIT: another client changed a file ──────────────────────────
      // Update our in-memory cache. Only apply to the editor if the edited
      // file is the one currently viewed — other files are updated silently.
      case 'EDIT': {
        const fp = msg.filePath ?? activeFileRef.current
        filesRef.current[fp] = msg.content
        if (fp === activeFileRef.current) {
          applyEditRef.current?.(msg.content)
        }
        break
      }

      case 'CURSOR':
        applyCursorRef.current?.(msg.userId, msg.pos)
        break

      case 'LANGUAGE_CHANGE':
        setLanguage(msg.language)
        setEditorLanguageRef.current?.(msg.language)
        break

      // ── File tree events ─────────────────────────────────────────────
      case 'FILE_CREATE': {
        filesRef.current[msg.path] = msg.content ?? ''
        setFilePaths(prev => prev.includes(msg.path) ? prev : [...prev, msg.path])
        // Auto-switch to the new file for the user who created it.
        if (msg.userId === userId) {
          setActiveFile(msg.path)
          activeFileRef.current = msg.path
          applyEditRef.current?.(msg.content ?? '')
        }
        break
      }

      case 'FILE_DELETE': {
        delete filesRef.current[msg.path]
        setFilePaths(prev => prev.filter(p => p !== msg.path))
        // The useEffect above handles switching away if activeFile was deleted.
        break
      }

      case 'FILE_RENAME': {
        const content = filesRef.current[msg.oldPath] ?? ''
        filesRef.current[msg.newPath] = content
        delete filesRef.current[msg.oldPath]
        setFilePaths(prev => prev.map(p => p === msg.oldPath ? msg.newPath : p))
        if (activeFileRef.current === msg.oldPath) {
          setActiveFile(msg.newPath)
          activeFileRef.current = msg.newPath
        }
        break
      }

      case 'FILE_SWITCH': {
        // Another user switched files — follow them to the same file.
        setActiveFile(msg.path)
        activeFileRef.current = msg.path
        applyEditRef.current?.(filesRef.current[msg.path] ?? '')
        break
      }

      // ── AI review events ─────────────────────────────────────────────
      case 'REVIEW_START':
        setReviewInProgress(true)
        setComments([])
        clearCommentsRef.current?.()
        break

      case 'AI_COMMENT': {
        const c = { line: msg.line, text: msg.text, severity: msg.severity, category: msg.category, fix: msg.fix ?? null }
        setComments(prev => [...prev, c])
        addCommentRef.current?.(msg.line, msg.text, msg.severity, msg.category, msg.fix ?? null)
        break
      }

      case 'REVIEW_DONE':
        setReviewInProgress(false)
        break

      case 'AI_ERROR':
        setReviewInProgress(false)
        setStatus('AI error: ' + msg.text)
        break

      // ── Code execution events ────────────────────────────────────────
      // RUN_START: server started execution — all clients enter running state.
      case 'RUN_START':
        setOutputLines([])
        setRunInProgress(true)
        setOutputOpen(true)
        break

      // RUN_OUTPUT: one line from the child process stdout/stderr pipe,
      // streamed over WebSocket as it arrives (bridging process I/O and TCP).
      case 'RUN_OUTPUT':
        setOutputLines(prev => [...prev, { text: msg.line, isError: false }])
        break

      case 'RUN_DONE':
        setRunInProgress(false)
        break

      case 'RUN_ERROR':
        setOutputLines(prev => [...prev, { text: 'Error: ' + msg.text, isError: true }])
        setRunInProgress(false)
        break

      case 'RUN_TIMEOUT':
        setOutputLines(prev => [...prev, { text: msg.text, isError: true }])
        setRunInProgress(false)
        break

      // ── Chat ────────────────────────────────────────────────────────
      case 'CHAT': {
        setChat(prev => [...prev, {
          userId:    msg.userId,
          text:      msg.text,
          timestamp: msg.timestamp,
          replyTo:   msg.replyTo ?? null,
          system:    msg.userId === 'system',
          private:   msg.private ?? false,
        }])
        break
      }

      case 'AI_CHAT': {
        setChat(prev => [...prev, {
          userId: 'ai', text: msg.text, timestamp: msg.timestamp, replyTo: null,
          private: msg.private ?? false,
        }])
        break
      }

      case 'VOICE_STATUS':
        onVoiceStatus({ userId: msg.userId, speaking: msg.speaking })
        break

      default:
        console.log('Unknown message type:', msg.type)
    }
  }

  // ── Editor ready callback ──────────────────────────────────────────────
  //
  // Called by Editor.jsx once CodeMirror is constructed and imperative handles
  // are available.  Apply any state that arrived before the editor mounted.
  //
  // We intentionally do NOT clear the pending refs after applying them because
  // React StrictMode double-invokes effects: mount → cleanup → remount.
  // Keeping the values ensures the second (surviving) invocation also applies
  // the correct content.  The equality guard inside applyEdit makes the second
  // apply a no-op when content is unchanged.

  const onEditorReady = useCallback(({
    applyEdit, applyCursor, removeCursor, addComment, clearComments, setLanguage: setLang,
  }) => {
    applyEditRef.current         = applyEdit
    applyCursorRef.current       = applyCursor
    removeCursorRef.current      = removeCursor
    addCommentRef.current        = addComment
    clearCommentsRef.current     = clearComments
    setEditorLanguageRef.current = setLang

    if (pendingFilesRef.current !== null) {
      const { files: f, activeFile: af } = pendingFilesRef.current
      applyEdit(f[af] ?? '')
      syncReceivedRef.current = true
    }
    if (pendingCursorsRef.current !== null) {
      for (const [uid, pos] of Object.entries(pendingCursorsRef.current))
        applyCursor(uid, pos)
    }
    if (pendingCommentsRef.current !== null) {
      clearComments()
      for (const c of pendingCommentsRef.current)
        addComment(c.line, c.text, c.severity, c.category, c.fix ?? null)
    }
    if (pendingLanguageRef.current !== null) {
      setLang(pendingLanguageRef.current)
    }
  }, [])

  // ── Outbound message senders ───────────────────────────────────────────

  // EDIT: include filePath so the server routes the change to the correct file.
  const onLocalChange = useCallback((content) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    if (!syncReceivedRef.current) return
    // Keep our local cache in sync so file-switching restores the latest content.
    filesRef.current[activeFileRef.current] = content
    ws.send(JSON.stringify({
      type:     'EDIT',
      userId:   session?.userId,
      filePath: activeFileRef.current,
      content,
    }))
  }, [session?.userId])

  const onCursorMove = useCallback((pos) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'CURSOR', userId: session?.userId, pos }))
  }, [session?.userId])

  const handleLanguageChange = useCallback((lang) => {
    setLanguage(lang)
    setEditorLanguageRef.current?.(lang)
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'LANGUAGE_CHANGE', userId: session?.userId, language: lang }))
    }
  }, [session?.userId])

  const handleRequestReview = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'REVIEW_REQUEST', userId: session?.userId, language }))
  }, [session?.userId, language])

  const handleSendChat = useCallback((text) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'CHAT', userId: session?.userId, text, replyTo: null }))
  }, [session?.userId])

  // ── File tree operations ───────────────────────────────────────────────

  const handleFileCreate = useCallback((path) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'FILE_CREATE', userId: session?.userId, path, content: '' }))
  }, [session?.userId])

  const handleFileDelete = useCallback((path) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'FILE_DELETE', userId: session?.userId, path }))
  }, [session?.userId])

  const handleFileRename = useCallback((oldPath, newPath) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'FILE_RENAME', userId: session?.userId, oldPath, newPath }))
  }, [session?.userId])

  // FILE_SWITCH: switch locally first for instant feedback, then notify server
  // so it updates room.activeFile (for reviews) and broadcasts to other clients.
  const handleFileSwitch = useCallback((path) => {
    setActiveFile(path)
    activeFileRef.current = path
    applyEditRef.current?.(filesRef.current[path] ?? '')
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'FILE_SWITCH', userId: session?.userId, path }))
    }
  }, [session?.userId])

  // ── Code execution ─────────────────────────────────────────────────────
  //
  // Sends RUN_REQUEST to the server, which:
  //   1. Broadcasts RUN_START to all clients (sets running state here)
  //   2. Writes files to a temp dir (ProcessBuilder I/O)
  //   3. Streams stdout/stderr as RUN_OUTPUT frames over TCP/WebSocket

  const handleRunCode = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'RUN_REQUEST', userId: session?.userId }))
  }, [session?.userId])

  // ── Leave ──────────────────────────────────────────────────────────────

  const handleLeave = useCallback(() => {
    voiceCleanup()
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'USER_LEAVE' }))
      wsRef.current.close()
      wsRef.current = null
    }
    applyEditRef.current         = null
    applyCursorRef.current       = null
    removeCursorRef.current      = null
    addCommentRef.current        = null
    clearCommentsRef.current     = null
    setEditorLanguageRef.current = null
    pendingFilesRef.current      = null
    pendingCursorsRef.current    = null
    pendingCommentsRef.current   = null
    pendingLanguageRef.current   = null
    syncReceivedRef.current      = false
    filesRef.current             = { 'main.js': '' }
    activeFileRef.current        = 'main.js'
    setSession(null)
    setUsers([])
    setStatus('')
    setComments([])
    setReviewInProgress(false)
    setChat([])
    setLanguage('javascript')
    setFilePaths(['main.js'])
    setActiveFile('main.js')
    setOutputLines([])
    setRunInProgress(false)
  }, [voiceCleanup])

  // ── Render ─────────────────────────────────────────────────────────────

  if (!session) {
    return <JoinScreen onJoin={handleJoin} />
  }

  const isDisconnected = status === 'Disconnected' || status === 'Connection error'

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">

      {/* ── Left sidebar ── */}
      {leftOpen ? (
        <>
          <aside
            style={{ width: leftWidth }}
            className="flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col overflow-hidden"
          >
            {/* Room header */}
            <div className="px-4 py-3 border-b border-gray-800 flex-shrink-0 flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-xs text-gray-400 uppercase tracking-widest">Room</p>
                <p className="text-lg font-mono font-bold text-emerald-400 truncate">{session.roomCode}</p>
              </div>
              <button
                onClick={() => setLeftOpen(false)}
                className="text-gray-600 hover:text-gray-400 transition-colors mt-0.5 flex-shrink-0"
                title="Close panel"
              >
                <ChevronLeft />
              </button>
            </div>

            {/* ── File tree section ── */}
            <div
              className="border-b border-gray-800 flex-shrink-0 overflow-hidden"
              style={{ maxHeight: '38%', minHeight: 80 }}
            >
              <FileTree
                filePaths={filePaths}
                activeFile={activeFile}
                onFileSelect={handleFileSwitch}
                onFileCreate={handleFileCreate}
                onFileDelete={handleFileDelete}
                onFileRename={handleFileRename}
                isDisconnected={isDisconnected}
              />
            </div>

            <UserList users={users} currentUserId={session.userId} speakingUsers={speakingUsers} />

            {/* ── Tools section: language + run + review + voice ── */}
            <div className="px-3 py-3 border-t border-gray-800 flex-shrink-0 space-y-2 mt-auto">

              {/* Language selector */}
              <select
                value={language}
                onChange={e => handleLanguageChange(e.target.value)}
                className="w-full bg-gray-800 text-gray-200 text-xs rounded px-2 py-1.5
                           border border-gray-700 outline-none focus:border-emerald-600 cursor-pointer"
              >
                {LANGUAGES.map(l => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>

              {/* Push-to-Talk */}
              <button
                onMouseDown={() => startSpeaking(session.userId)}
                onMouseUp={() => stopSpeaking(session.userId)}
                onMouseLeave={() => { if (isSpeaking) stopSpeaking(session.userId) }}
                disabled={micAvailable === false || isDisconnected}
                className={`w-full text-xs rounded px-2 py-1.5 font-medium transition-colors select-none
                  ${isSpeaking
                    ? 'bg-red-700 text-white ring-1 ring-red-400'
                    : micAvailable === false || isDisconnected
                      ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                      : 'bg-gray-700 hover:bg-gray-600 text-gray-300 cursor-pointer'
                  }`}
              >
                {isSpeaking ? 'Speaking...' : micAvailable === false ? 'Mic unavailable' : 'Hold to Talk'}
              </button>

              {/* Run + AI Review side by side */}
              <div className="flex gap-2">
                <button
                  onClick={handleRunCode}
                  disabled={runInProgress || isDisconnected}
                  title="Run code"
                  className={`flex-1 text-xs rounded px-2 py-1.5 font-medium transition-colors flex items-center justify-center gap-1.5
                    ${runInProgress || isDisconnected
                      ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                      : 'bg-green-900 hover:bg-green-800 text-green-100 cursor-pointer'
                    }`}
                >
                  {runInProgress
                    ? <><span className="inline-block w-3 h-3 border-2 border-gray-500 border-t-green-400 rounded-full animate-spin" /> Running…</>
                    : <><svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg> Run</>
                  }
                </button>

                <button
                  onClick={handleRequestReview}
                  disabled={reviewInProgress || isDisconnected}
                  title="Request AI review"
                  className={`flex-1 text-xs rounded px-2 py-1.5 font-medium transition-colors flex items-center justify-center gap-1.5
                    ${reviewInProgress || isDisconnected
                      ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                      : 'bg-emerald-800 hover:bg-emerald-700 text-emerald-100 cursor-pointer'
                    }`}
                >
                  {reviewInProgress
                    ? <><span className="inline-block w-3 h-3 border-2 border-gray-500 border-t-emerald-400 rounded-full animate-spin" /> Review…</>
                    : <>
                        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                        AI Review
                      </>
                  }
                </button>
              </div>

              {/* Footer: status + reconnect + leave */}
              <div className="flex items-center gap-2 pt-1">
                {isDisconnected ? (
                  <button
                    onClick={handleReconnect}
                    className="flex-1 text-xs bg-emerald-900 hover:bg-emerald-800 text-emerald-300 rounded px-2 py-1.5 transition-colors"
                  >
                    Reconnect
                  </button>
                ) : (
                  <p className="flex-1 text-xs text-gray-600 truncate">{status}</p>
                )}
                <button
                  onClick={handleLeave}
                  title="Leave room"
                  className="flex-shrink-0 text-xs bg-gray-800 hover:bg-red-900/60 text-gray-500 hover:text-red-300 rounded px-2 py-1.5 transition-colors"
                >
                  Leave
                </button>
              </div>
            </div>
          </aside>

          <DragHandle
            direction="vertical"
            onMove={(x) => setLeftWidth(Math.max(160, Math.min(400, x)))}
          />
        </>
      ) : (
        <CollapsedStrip side="left" label="Room" onOpen={() => setLeftOpen(true)} />
      )}

      {/* ── Center column: editor + output + comments ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        <main className="flex-1 overflow-hidden min-h-0">
          <Editor
            onLocalChange={onLocalChange}
            onCursorMove={onCursorMove}
            onReady={onEditorReady}
            initialLanguage={language}
          />
        </main>

        {/* Output panel — streams RUN_OUTPUT frames as they arrive from the
            child process pipe over WebSocket (TCP application layer) */}
        {outputOpen && (
          <DragHandle
            direction="horizontal"
            onMove={(_, y) => setOutputHeight(Math.max(80, Math.min(450, window.innerHeight - y)))}
          />
        )}
        <OutputPanel
          lines={outputLines}
          runInProgress={runInProgress}
          open={outputOpen}
          height={outputHeight}
          onToggle={() => setOutputOpen(o => !o)}
        />

        {/* AI review comments panel */}
        {bottomOpen && (
          <DragHandle
            direction="horizontal"
            onMove={(_, y) => setBottomHeight(Math.max(80, Math.min(450, window.innerHeight - y)))}
          />
        )}
        <CommentsPanel
          comments={comments}
          reviewInProgress={reviewInProgress}
          open={bottomOpen}
          height={bottomHeight}
          onToggle={() => setBottomOpen(o => !o)}
        />
      </div>

      {/* ── Right sidebar ── */}
      {rightOpen ? (
        <>
          <DragHandle
            direction="vertical"
            onMove={(x) => setRightWidth(Math.max(200, Math.min(480, window.innerWidth - x)))}
          />
          <ChatPanel
            chat={chat}
            currentUserId={session.userId}
            onSendChat={handleSendChat}
            width={rightWidth}
            onClose={() => setRightOpen(false)}
          />
        </>
      ) : (
        <CollapsedStrip side="right" label="Chat" onOpen={() => setRightOpen(true)} />
      )}

    </div>
  )
}
