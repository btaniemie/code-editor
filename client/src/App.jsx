import { useState, useRef, useCallback } from 'react'
import JoinScreen    from './components/JoinScreen'
import UserList      from './components/UserList'
import Editor        from './components/Editor'
import CommentsPanel from './components/CommentsPanel'
import ChatPanel     from './components/ChatPanel'

const SERVER_URL = 'ws://localhost:8080'

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

export default function App() {
  const [session,          setSession]          = useState(null)
  const [users,            setUsers]            = useState([])
  const [status,           setStatus]           = useState('')
  const [comments,         setComments]         = useState([])
  const [reviewInProgress, setReviewInProgress] = useState(false)
  const [chat,             setChat]             = useState([])
  const [language,         setLanguage]         = useState('javascript')

  // Panel open/close
  const [leftOpen,   setLeftOpen]   = useState(true)
  const [rightOpen,  setRightOpen]  = useState(true)
  const [bottomOpen, setBottomOpen] = useState(true)

  // Panel dimensions in pixels
  const [leftWidth,    setLeftWidth]    = useState(224)
  const [rightWidth,   setRightWidth]   = useState(288)
  const [bottomHeight, setBottomHeight] = useState(176)

  const wsRef = useRef(null)

  // Imperative CodeMirror handles
  const applyEditRef        = useRef(null)
  const applyCursorRef      = useRef(null)
  const removeCursorRef     = useRef(null)
  const addCommentRef       = useRef(null)
  const clearCommentsRef    = useRef(null)
  const setEditorLanguageRef = useRef(null)

  // Content that arrived before the editor mounted
  const pendingEditRef     = useRef(null)
  const pendingCursorsRef  = useRef(null)
  const pendingCommentsRef = useRef(null)
  const pendingLanguageRef = useRef(null)

  // Guard: prevents EDIT messages from being sent before the initial SYNC has
  // been received and applied to the local editor.  Without this guard, a new
  // joiner whose editor starts empty could send an EDIT that overwrites the
  // room's document for everyone.
  //
  // Set to true when:
  //   • SYNC is received and the document is applied via applyEditRef directly, OR
  //   • SYNC was queued as pending and is applied inside onEditorReady.
  // Reset to false on leave or reconnect so every new WebSocket session waits
  // for its own SYNC before it can write.
  const syncReceivedRef = useRef(false)

  // ── WebSocket connection ────────────────────────────────────────────────

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

  // ── Reconnect — reuse session, reset local state, open a fresh WebSocket ──

  const handleReconnect = useCallback(() => {
    if (!session) return
    if (wsRef.current) wsRef.current.close()
    // Reset sync guard so the reconnecting client waits for its fresh SYNC
    // before it can send EDIT messages on the new TCP connection.
    syncReceivedRef.current = false
    setComments([])
    setChat([])
    setReviewInProgress(false)
    clearCommentsRef.current?.()
    connectWS(session.userId, session.roomCode)
  }, [session, connectWS])

  // ── Client-side message router ──────────────────────────────────────────

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

      // SYNC is a unicast message sent by the server only to the newly-joining
      // client.  It carries the full authoritative room state so the joiner
      // starts in sync with everyone else.
      //
      // After applying (or staging) the document we mark syncReceivedRef=true
      // so that onLocalChange is allowed to send EDIT messages.  This prevents
      // the race where the new user types before their editor is populated and
      // their EDIT (containing only their few keystrokes) wipes the room doc.
      case 'SYNC': {
        if (applyEditRef.current) {
          // Editor already mounted — apply directly.
          applyEditRef.current(msg.document)
          syncReceivedRef.current = true
        } else {
          // Editor not mounted yet — stage for onEditorReady.
          // syncReceivedRef will be set there after the document is applied.
          pendingEditRef.current = msg.document
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

        if (msg.chat && msg.chat.length > 0) {
          setChat(msg.chat)
        }

        // Restore the room's language — updates both React state and CodeMirror
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

      case 'EDIT':
        applyEditRef.current?.(msg.content)
        break

      case 'CURSOR':
        applyCursorRef.current?.(msg.userId, msg.pos)
        break

      // A user changed the room's language — update highlighting for everyone
      case 'LANGUAGE_CHANGE':
        setLanguage(msg.language)
        setEditorLanguageRef.current?.(msg.language)
        break

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

      case 'CHAT': {
        const chatMsg = {
          userId:    msg.userId,
          text:      msg.text,
          timestamp: msg.timestamp,
          replyTo:   msg.replyTo ?? null,
          system:    msg.userId === 'system',
        }
        setChat(prev => [...prev, chatMsg])
        break
      }

      case 'AI_CHAT': {
        setChat(prev => [...prev, {
          userId: 'ai', text: msg.text, timestamp: msg.timestamp, replyTo: null,
        }])
        break
      }

      default:
        console.log('Unknown message type:', msg.type)
    }
  }

  // ── Editor ready callback ───────────────────────────────────────────────
  //
  // Called by Editor.jsx once the CodeMirror view is constructed and its
  // imperative handles are available.  We apply any state that arrived over
  // the WebSocket before the editor finished mounting.
  //
  // IMPORTANT — we intentionally do NOT clear the pending refs after applying
  // them.  React.StrictMode double-invokes effects in development:
  //   mount → cleanup (view destroyed) → remount
  // If we cleared pendingEditRef.current on the first invocation, the second
  // invocation (on the real, surviving view) would find null and leave the
  // editor blank.  Keeping the values means both invocations apply the same
  // content; the equality guard inside applyEdit makes the second apply a
  // no-op when the content is unchanged, so there is no visible duplication.
  // The pending refs are only truly cleared in handleLeave (session end).

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
      // Mark sync as received now that the document has been applied to the
      // editor.  From this point onLocalChange is allowed to send EDIT frames.
      syncReceivedRef.current = true
      // Intentionally NOT clearing pendingEditRef.current — see note above.
    }
    if (pendingCursorsRef.current !== null) {
      for (const [uid, pos] of Object.entries(pendingCursorsRef.current))
        applyCursor(uid, pos)
      // Intentionally NOT clearing — see note above.
    }
    if (pendingCommentsRef.current !== null) {
      clearComments()
      for (const c of pendingCommentsRef.current)
        addComment(c.line, c.text, c.severity, c.category, c.fix ?? null)
      // Intentionally NOT clearing — see note above.
    }
    if (pendingLanguageRef.current !== null) {
      setLang(pendingLanguageRef.current)
      // Intentionally NOT clearing — see note above.
    }
  }, [])

  // ── Outbound message senders ────────────────────────────────────────────

  const onLocalChange = useCallback((content) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    // Do not send EDIT until the initial SYNC has been received and its
    // document has been applied to our local editor.  Before that point our
    // editor is still empty; sending an EDIT now would broadcast empty (or
    // partially-typed) content to all other clients, wiping their documents.
    if (!syncReceivedRef.current) return
    ws.send(JSON.stringify({ type: 'EDIT', userId: session?.userId, content }))
  }, [session?.userId])

  const onCursorMove = useCallback((pos) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'CURSOR', userId: session?.userId, pos }))
  }, [session?.userId])

  // Language change: update locally immediately, then tell the server so all
  // other clients in the room get a LANGUAGE_CHANGE broadcast.
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
      language,          // send current room language, not hardcoded 'javascript'
    }))
  }, [session?.userId, language])

  const handleSendChat = useCallback((text) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'CHAT', userId: session?.userId, text, replyTo: null }))
  }, [session?.userId])

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
  }, [])

  // ── Render ──────────────────────────────────────────────────────────────

  if (!session) {
    return <JoinScreen onJoin={handleJoin} />
  }

  const isDisconnected = status === 'Disconnected' || status === 'Connection error'

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">

      {/* ── Left sidebar or collapsed strip ── */}
      {leftOpen ? (
        <>
          <aside
            style={{ width: leftWidth }}
            className="flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col overflow-hidden"
          >
            {/* Room header + close button */}
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

            <UserList users={users} currentUserId={session.userId} />

            {/* Language selector */}
            <div className="px-4 py-3 border-t border-gray-800 flex-shrink-0">
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-1.5">Language</p>
              <select
                value={language}
                onChange={e => handleLanguageChange(e.target.value)}
                className="w-full bg-gray-800 text-gray-200 text-xs rounded px-2.5 py-1.5
                           border border-gray-700 outline-none focus:border-emerald-600
                           cursor-pointer"
              >
                {LANGUAGES.map(l => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>

            {/* Request Review button */}
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
                ) : (
                  'Request AI Review'
                )}
              </button>
            </div>

            {/* Status + reconnect + leave */}
            <div className="px-4 py-3 border-t border-gray-800 space-y-2 flex-shrink-0 mt-auto">
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

          <DragHandle
            direction="vertical"
            onMove={(x) => setLeftWidth(Math.max(160, Math.min(360, x)))}
          />
        </>
      ) : (
        <CollapsedStrip side="left" label="Room" onOpen={() => setLeftOpen(true)} />
      )}

      {/* ── Center column — editor + AI comments strip ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <main className="flex-1 overflow-hidden min-h-0">
          <Editor
            onLocalChange={onLocalChange}
            onCursorMove={onCursorMove}
            onReady={onEditorReady}
            initialLanguage={language}
          />
        </main>

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

      {/* ── Right sidebar or collapsed strip ── */}
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
