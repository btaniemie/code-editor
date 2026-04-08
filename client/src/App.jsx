import { useState, useRef, useCallback, useEffect } from 'react'
import JoinScreen    from './components/JoinScreen'
import UserList      from './components/UserList'
import Editor        from './components/Editor'
import CommentsPanel from './components/CommentsPanel'
import ChatPanel     from './components/ChatPanel'
import FileExplorer  from './components/FileExplorer'
import TabBar        from './components/TabBar'
import Terminal      from './components/Terminal'

const SERVER_URL = 'ws://localhost:8080'

const LANGUAGES = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python',     label: 'Python'     },
  { value: 'java',       label: 'Java'       },
]

// ── Reusable SVG icons ─────────────────────────────────────────────────────

function ChevronLeft()  {
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

// ── Drag-to-resize handle ──────────────────────────────────────────────────

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

// ── Collapsed panel strip ──────────────────────────────────────────────────

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

// ── Main App ───────────────────────────────────────────────────────────────

export default function App() {
  const [session,          setSession]          = useState(null)
  const [users,            setUsers]            = useState([])
  const [status,           setStatus]           = useState('')
  const [comments,         setComments]         = useState([])
  const [reviewInProgress, setReviewInProgress] = useState(false)
  const [chat,             setChat]             = useState([])
  const [language,         setLanguage]         = useState('javascript')

  // ── Multi-file state ─────────────────────────────────────────────────────
  // files: { [filename]: content }  — all files in the room
  // openTabs: filename[]            — currently open editor tabs
  // activeFile: filename            — file shown in the CodeMirror editor
  const [files,      setFiles]      = useState({ 'main.js': '' })
  const [openTabs,   setOpenTabs]   = useState(['main.js'])
  const [activeFile, setActiveFile] = useState('main.js')

  // Keep a ref so onLocalChange (which closes over session) always sees the
  // current activeFile without needing to be re-created on every file switch.
  const activeFileRef = useRef('main.js')
  useEffect(() => { activeFileRef.current = activeFile }, [activeFile])

  // ── Panel open/close ─────────────────────────────────────────────────────
  const [leftOpen,   setLeftOpen]   = useState(true)
  const [rightOpen,  setRightOpen]  = useState(true)
  const [bottomOpen, setBottomOpen] = useState(true)
  const [bottomTab,  setBottomTab]  = useState('terminal') // 'terminal' | 'problems'

  // ── Panel dimensions ─────────────────────────────────────────────────────
  const [leftWidth,    setLeftWidth]    = useState(224)
  const [rightWidth,   setRightWidth]   = useState(288)
  const [bottomHeight, setBottomHeight] = useState(220)

  const wsRef = useRef(null)

  // ── Imperative CodeMirror handles ─────────────────────────────────────────
  const applyEditRef         = useRef(null)
  const applyCursorRef       = useRef(null)
  const removeCursorRef      = useRef(null)
  const addCommentRef        = useRef(null)
  const clearCommentsRef     = useRef(null)
  const setEditorLanguageRef = useRef(null)

  // ── Imperative Terminal handles ───────────────────────────────────────────
  const writeTerminalRef = useRef(null)
  const fitTerminalRef   = useRef(null)
  const focusTerminalRef = useRef(null)

  // ── Pending refs (messages that arrived before editor mounted) ────────────
  const pendingEditRef     = useRef(null)
  const pendingCursorsRef  = useRef(null)
  const pendingCommentsRef = useRef(null)
  const pendingLanguageRef = useRef(null)

  // Guard: do not send EDIT before the initial SYNC is applied.
  const syncReceivedRef = useRef(false)

  // ── WebSocket connection ──────────────────────────────────────────────────

  const connectWS = useCallback((userId, roomCode) => {
    const ws = new WebSocket(SERVER_URL)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'USER_JOIN', userId, roomCode }))
      setStatus('Connected')
    }
    ws.onmessage = (event) => {
      handleMessage(JSON.parse(event.data), userId, roomCode)
    }
    ws.onclose = () => setStatus('Disconnected')
    ws.onerror = () => setStatus('Connection error')
  }, [])

  const handleJoin = useCallback((userId, roomCode) => {
    connectWS(userId, roomCode)
  }, [connectWS])

  // ── Reconnect ──────────────────────────────────────────────────────────────

  const handleReconnect = useCallback(() => {
    if (!session) return
    if (wsRef.current) wsRef.current.close()
    syncReceivedRef.current = false
    setComments([])
    setChat([])
    setReviewInProgress(false)
    clearCommentsRef.current?.()
    connectWS(session.userId, session.roomCode)
  }, [session, connectWS])

  // ── File switching ─────────────────────────────────────────────────────────
  //
  // When the user clicks a file in the explorer or a tab, we:
  //   1. Open the tab if it isn't already open.
  //   2. Set it as the active file.
  //   3. Load that file's content into the CodeMirror editor via applyEdit.
  //
  // We do NOT send EDIT here — the editor content change is remote-applied so
  // the update listener won't fire the local-change callback.

  const switchToFile = useCallback((filename) => {
    setOpenTabs(prev => prev.includes(filename) ? prev : [...prev, filename])
    setActiveFile(filename)
    // Update the ref immediately so onLocalChange sends EDIT to the correct
    // file even if the user types before the useEffect below has a chance to run.
    activeFileRef.current = filename
  }, [])

  // Apply editor content whenever activeFile changes.
  // We use a ref to always read the latest files map.
  const filesRef = useRef(files)
  useEffect(() => { filesRef.current = files }, [files])

  useEffect(() => {
    if (applyEditRef.current) {
      applyEditRef.current(filesRef.current[activeFile] ?? '')
    }
  }, [activeFile])

  // ── Client-side message router ─────────────────────────────────────────────

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

      // SYNC — full room state sent to newly-joining client.
      // Now includes `files` map instead of a single `document` string.
      case 'SYNC': {
        // Initialise file system from server state.
        const serverFiles = msg.files ?? {}
        const hasFiles    = Object.keys(serverFiles).length > 0

        if (hasFiles) {
          setFiles(prev => ({ ...prev, ...serverFiles }))
          const firstFile = Object.keys(serverFiles)[0]

          // Populate editor with the active (first) file.
          if (applyEditRef.current) {
            applyEditRef.current(serverFiles[firstFile] ?? '')
            syncReceivedRef.current = true
          } else {
            pendingEditRef.current = serverFiles[firstFile] ?? ''
          }

          setActiveFile(firstFile)
          setOpenTabs([firstFile])
          activeFileRef.current = firstFile
        } else if (msg.document != null) {
          // Legacy fallback: server sent a single `document` field.
          const legacyContent = msg.document
          setFiles({ 'main.js': legacyContent })
          if (applyEditRef.current) {
            applyEditRef.current(legacyContent)
            syncReceivedRef.current = true
          } else {
            pendingEditRef.current = legacyContent
          }
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
              addCommentRef.current(c.line, c.text, c.severity, c.category)
          } else {
            pendingCommentsRef.current = msg.comments
          }
        }

        if (msg.chat && msg.chat.length > 0) setChat(msg.chat)

        if (msg.language) {
          setLanguage(msg.language)
          if (setEditorLanguageRef.current) {
            setEditorLanguageRef.current(msg.language)
          } else {
            pendingLanguageRef.current = msg.language
          }
        }
        break
      }

      // EDIT — another client changed a file.
      // Update the files map; if they changed the active file, also apply to editor.
      case 'EDIT': {
        const filename = msg.filename ?? 'main.js'
        const content  = msg.content
        setFiles(prev => ({ ...prev, [filename]: content }))
        if (filename === activeFileRef.current) {
          applyEditRef.current?.(content)
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

      // ── File system events ─────────────────────────────────────────────────
      case 'FILE_CREATE': {
        const { filename } = msg
        setFiles(prev => ({ ...prev, [filename]: '' }))
        break
      }

      case 'FILE_DELETE': {
        const { filename } = msg
        setFiles(prev => {
          const next = { ...prev }
          delete next[filename]
          return next
        })
        setOpenTabs(prev => {
          const remaining = prev.filter(t => t !== filename)
          if (activeFileRef.current === filename && remaining.length > 0) {
            const next = remaining[0]
            setActiveFile(next)
            activeFileRef.current = next
            setTimeout(() => applyEditRef.current?.(filesRef.current[next] ?? ''), 0)
          }
          return remaining
        })
        break
      }

      case 'FILE_RENAME': {
        const { oldName, newName } = msg
        setFiles(prev => {
          const next    = { ...prev }
          const content = next[oldName] ?? ''
          delete next[oldName]
          next[newName] = content
          return next
        })
        setOpenTabs(prev => prev.map(t => t === oldName ? newName : t))
        setActiveFile(prev => prev === oldName ? newName : prev)
        break
      }

      // ── Terminal output ────────────────────────────────────────────────────
      case 'TERMINAL_OUTPUT':
        writeTerminalRef.current?.(msg.data)
        break

      // ── AI review ─────────────────────────────────────────────────────────
      case 'REVIEW_START':
        setReviewInProgress(true)
        setComments([])
        clearCommentsRef.current?.()
        break

      case 'AI_COMMENT': {
        const c = { line: msg.line, text: msg.text, severity: msg.severity, category: msg.category }
        setComments(prev => [...prev, c])
        addCommentRef.current?.(msg.line, msg.text, msg.severity, msg.category)
        break
      }

      case 'REVIEW_DONE':
        setReviewInProgress(false)
        break

      case 'AI_ERROR':
        setReviewInProgress(false)
        setStatus('AI error: ' + msg.text)
        break

      // ── Chat ───────────────────────────────────────────────────────────────
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

      default:
        console.log('Unknown message type:', msg.type)
    }
  }

  // ── Editor ready callback ─────────────────────────────────────────────────

  const onEditorReady = useCallback(({
    applyEdit, applyCursor, removeCursor, addComment, clearComments, setLanguage: setLang,
  }) => {
    applyEditRef.current         = applyEdit
    applyCursorRef.current       = applyCursor
    removeCursorRef.current      = removeCursor
    addCommentRef.current        = addComment
    clearCommentsRef.current     = clearComments
    setEditorLanguageRef.current = setLang

    if (pendingEditRef.current !== null) {
      applyEdit(pendingEditRef.current)
      syncReceivedRef.current = true
    }
    if (pendingCursorsRef.current !== null) {
      for (const [uid, pos] of Object.entries(pendingCursorsRef.current))
        applyCursor(uid, pos)
    }
    if (pendingCommentsRef.current !== null) {
      clearComments()
      for (const c of pendingCommentsRef.current)
        addComment(c.line, c.text, c.severity, c.category)
    }
    if (pendingLanguageRef.current !== null) {
      setLang(pendingLanguageRef.current)
    }
  }, [])

  // ── Terminal ready callback ───────────────────────────────────────────────

  const onTerminalReady = useCallback(({ write, fit, focus }) => {
    writeTerminalRef.current  = write
    fitTerminalRef.current    = fit
    focusTerminalRef.current  = focus

    // Tell the server to start the shell process.
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'TERMINAL_OPEN' }))
    }
  }, [])

  // ── Outbound senders ──────────────────────────────────────────────────────

  const onLocalChange = useCallback((content) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    if (!syncReceivedRef.current) return
    // Also persist to local files state so switching tabs doesn't lose work.
    setFiles(prev => ({ ...prev, [activeFileRef.current]: content }))
    ws.send(JSON.stringify({
      type:     'EDIT',
      userId:   session?.userId,
      filename: activeFileRef.current,
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
    ws.send(JSON.stringify({
      type:     'REVIEW_REQUEST',
      userId:   session?.userId,
      filename: activeFileRef.current,
      language,
    }))
  }, [session?.userId, language])

  const handleSendChat = useCallback((text) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'CHAT', userId: session?.userId, text, replyTo: null }))
  }, [session?.userId])

  // ── File operations ───────────────────────────────────────────────────────

  const handleFileCreate = useCallback((filename) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'FILE_CREATE', userId: session?.userId, filename }))
    // Optimistically open the new file locally.
    setFiles(prev => ({ ...prev, [filename]: '' }))
    setOpenTabs(prev => [...prev, filename])
    setActiveFile(filename)
    activeFileRef.current = filename
  }, [session?.userId])

  const handleFileDelete = useCallback((filename) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'FILE_DELETE', userId: session?.userId, filename }))
    // Optimistically remove locally.
    setFiles(prev => {
      const next = { ...prev }
      delete next[filename]
      return next
    })
    setOpenTabs(prev => {
      const remaining = prev.filter(t => t !== filename)
      if (activeFileRef.current === filename && remaining.length > 0) {
        const next = remaining[0]
        setActiveFile(next)
        activeFileRef.current = next
        setTimeout(() => applyEditRef.current?.(filesRef.current[next] ?? ''), 0)
      }
      return remaining
    })
  }, [session?.userId])

  const handleFileRename = useCallback((oldName, newName) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'FILE_RENAME', userId: session?.userId, oldName, newName }))
    // Optimistically rename locally.
    setFiles(prev => {
      const next    = { ...prev }
      const content = next[oldName] ?? ''
      delete next[oldName]
      next[newName] = content
      return next
    })
    setOpenTabs(prev => prev.map(t => t === oldName ? newName : t))
    if (activeFileRef.current === oldName) {
      setActiveFile(newName)
      activeFileRef.current = newName
    }
  }, [session?.userId])

  const handleTabClose = useCallback((filename) => {
    setOpenTabs(prev => {
      if (prev.length <= 1) return prev // can't close last tab
      const remaining = prev.filter(t => t !== filename)
      if (activeFileRef.current === filename) {
        const next = remaining[0]
        setActiveFile(next)
        activeFileRef.current = next
        setTimeout(() => applyEditRef.current?.(filesRef.current[next] ?? ''), 0)
      }
      return remaining
    })
  }, [])

  // ── Leave ─────────────────────────────────────────────────────────────────

  const handleLeave = useCallback(() => {
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
    writeTerminalRef.current     = null
    fitTerminalRef.current       = null
    pendingEditRef.current       = null
    pendingCursorsRef.current    = null
    pendingCommentsRef.current   = null
    pendingLanguageRef.current   = null
    syncReceivedRef.current      = false
    setSession(null)
    setUsers([])
    setStatus('')
    setComments([])
    setReviewInProgress(false)
    setChat([])
    setLanguage('javascript')
    setFiles({ 'main.js': '' })
    setOpenTabs(['main.js'])
    setActiveFile('main.js')
    activeFileRef.current = 'main.js'
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────

  if (!session) return <JoinScreen onJoin={handleJoin} />

  const isDisconnected = status === 'Disconnected' || status === 'Connection error'

  // Bottom panel content height (subtract the 32px tab bar)
  const bottomContentHeight = Math.max(bottomHeight - 32, 60)

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">

      {/* ── Left sidebar ───────────────────────────────────────────────────── */}
      {leftOpen ? (
        <>
          <aside
            style={{ width: leftWidth }}
            className="flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col overflow-hidden"
          >
            {/* Room header + close */}
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

            {/* File Explorer — takes up the bulk of the sidebar */}
            <FileExplorer
              files={files}
              activeFile={activeFile}
              onFileSelect={switchToFile}
              onFileCreate={handleFileCreate}
              onFileDelete={handleFileDelete}
              onFileRename={handleFileRename}
            />

            {/* Divider */}
            <div className="border-t border-gray-800 flex-shrink-0" />

            {/* Users */}
            <UserList users={users} currentUserId={session.userId} />

            {/* Language selector */}
            <div className="px-4 py-3 border-t border-gray-800 flex-shrink-0">
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-1.5">Language</p>
              <select
                value={language}
                onChange={e => handleLanguageChange(e.target.value)}
                className="w-full bg-gray-800 text-gray-200 text-xs rounded px-2.5 py-1.5
                           border border-gray-700 outline-none focus:border-emerald-600 cursor-pointer"
              >
                {LANGUAGES.map(l => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>

            {/* Request Review */}
            <div className="px-4 pb-3 flex-shrink-0">
              <button
                onClick={handleRequestReview}
                disabled={reviewInProgress || isDisconnected}
                className={`w-full text-sm rounded px-3 py-2 font-medium transition-colors
                  ${reviewInProgress || isDisconnected
                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                    : 'bg-emerald-800 hover:bg-emerald-700 text-emerald-100 cursor-pointer'
                  }`}
              >
                {reviewInProgress ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block w-3 h-3 border-2 border-gray-500 border-t-emerald-400 rounded-full animate-spin" />
                    Reviewing…
                  </span>
                ) : 'Request AI Review'}
              </button>
            </div>

            {/* Status / reconnect / leave */}
            <div className="px-4 py-3 border-t border-gray-800 space-y-2 flex-shrink-0">
              <p className={`text-xs truncate ${isDisconnected ? 'text-red-400' : 'text-gray-500'}`}>
                {status}
              </p>
              {isDisconnected && (
                <button
                  onClick={handleReconnect}
                  className="w-full text-sm bg-emerald-900 hover:bg-emerald-800 text-emerald-300 rounded px-3 py-1.5 transition-colors"
                >
                  Reconnect
                </button>
              )}
              <button
                onClick={handleLeave}
                className="w-full text-sm bg-gray-800 hover:bg-red-900 text-gray-300 hover:text-red-200 rounded px-3 py-1.5 transition-colors"
              >
                Leave room
              </button>
            </div>
          </aside>

          <DragHandle direction="vertical" onMove={(x) => setLeftWidth(Math.max(160, Math.min(400, x)))} />
        </>
      ) : (
        <CollapsedStrip side="left" label="Explorer" onOpen={() => setLeftOpen(true)} />
      )}

      {/* ── Center column ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Tab bar */}
        <TabBar
          tabs={openTabs}
          activeFile={activeFile}
          onTabSelect={switchToFile}
          onTabClose={handleTabClose}
        />

        {/* Editor — fills remaining space above bottom panel */}
        <main className="flex-1 overflow-hidden min-h-0">
          <Editor
            onLocalChange={onLocalChange}
            onCursorMove={onCursorMove}
            onReady={onEditorReady}
            initialLanguage={language}
          />
        </main>

        {/* Bottom panel drag handle */}
        {bottomOpen && (
          <DragHandle
            direction="horizontal"
            onMove={(_, y) => setBottomHeight(Math.max(80, Math.min(600, window.innerHeight - y)))}
          />
        )}

        {/* Bottom panel: Terminal + AI Review tabs */}
        {bottomOpen && (
          <div style={{ height: bottomHeight }} className="flex flex-col flex-shrink-0 bg-gray-950 border-t border-gray-800">
            {/* Tab bar */}
            <div className="flex items-center border-b border-gray-800 flex-shrink-0" style={{ height: 32 }}>
              <button
                onClick={() => {
                  setBottomTab('terminal')
                  setTimeout(() => { fitTerminalRef.current?.(); focusTerminalRef.current?.() }, 50)
                }}
                className={`px-4 h-full text-xs uppercase tracking-widest transition-colors border-r border-gray-800
                  ${bottomTab === 'terminal'
                    ? 'text-emerald-400 border-t-2 border-t-emerald-500 bg-gray-900'
                    : 'text-gray-500 hover:text-gray-300'}`}
              >
                Terminal
              </button>
              <button
                onClick={() => setBottomTab('problems')}
                className={`px-4 h-full text-xs uppercase tracking-widest transition-colors border-r border-gray-800
                  ${bottomTab === 'problems'
                    ? 'text-emerald-400 border-t-2 border-t-emerald-500 bg-gray-900'
                    : 'text-gray-500 hover:text-gray-300'}`}
              >
                Problems {comments.length > 0 && `(${comments.length})`}
              </button>
              {/* Spacer + close */}
              <div className="flex-1" />
              <button
                onClick={() => setBottomOpen(false)}
                className="px-3 h-full text-gray-600 hover:text-gray-300 transition-colors"
                title="Close panel"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            {/* Panel content — both mounted, toggled via CSS so xterm stays alive */}
            <div className="flex-1 overflow-hidden relative">
              <div style={{ display: bottomTab === 'terminal' ? 'block' : 'none', height: '100%' }}>
                <Terminal
                  wsRef={wsRef}
                  onReady={onTerminalReady}
                />
              </div>
              <div style={{ display: bottomTab === 'problems' ? 'block' : 'none', height: '100%', overflowY: 'auto' }}>
                <CommentsPanel
                  comments={comments}
                  reviewInProgress={reviewInProgress}
                  open={true}
                  height={bottomContentHeight}
                  onToggle={() => {}}
                  embedded={true}
                />
              </div>
            </div>
          </div>
        )}

        {/* Reopen bottom panel strip when closed */}
        {!bottomOpen && (
          <div
            className="h-7 flex-shrink-0 bg-gray-950 border-t border-gray-800 flex items-center px-3 gap-2
                       cursor-pointer hover:bg-gray-900/60 transition-colors"
            onClick={() => setBottomOpen(true)}
          >
            <svg className="w-3.5 h-3.5 text-gray-600" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            <span className="text-xs text-gray-600 uppercase tracking-widest">Terminal / Problems</span>
          </div>
        )}
      </div>

      {/* ── Right sidebar ──────────────────────────────────────────────────── */}
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
