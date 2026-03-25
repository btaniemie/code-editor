import { useState, useRef, useCallback } from 'react'
import JoinScreen    from './components/JoinScreen'
import UserList      from './components/UserList'
import Editor        from './components/Editor'
import CommentsPanel from './components/CommentsPanel'

const SERVER_URL = 'ws://localhost:8080'

export default function App() {
  const [session,          setSession]          = useState(null)  // { userId, roomCode }
  const [users,            setUsers]            = useState([])
  const [status,           setStatus]           = useState('')
  const [comments,         setComments]         = useState([])    // AI comment list for panel
  const [reviewInProgress, setReviewInProgress] = useState(false)

  // WebSocket — ref so socket identity changes don't trigger re-renders
  const wsRef = useRef(null)

  // Imperative handles into the CodeMirror editor.
  // Stored as refs so calling them never triggers a React re-render.
  const applyEditRef     = useRef(null)
  const applyCursorRef   = useRef(null)
  const removeCursorRef  = useRef(null)
  const addCommentRef    = useRef(null)   // Phase 2
  const clearCommentsRef = useRef(null)  // Phase 2

  // Content that arrived before the editor was mounted — flushed in onEditorReady.
  const pendingEditRef     = useRef(null)
  const pendingCursorsRef  = useRef(null)
  const pendingCommentsRef = useRef(null) // Comment[] from SYNC before editor mounted

  // ── WebSocket connection ────────────────────────────────────────────────

  const handleJoin = useCallback((userId, roomCode) => {
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

      // SYNC is sent to a newly joined client with full room state.
      // Apply document, cursors, and any previously generated AI comments.
      case 'SYNC': {
        if (applyEditRef.current) {
          applyEditRef.current(msg.document)
        } else {
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
              addCommentRef.current(c.line, c.text, c.severity, c.category)
          } else {
            pendingCommentsRef.current = msg.comments
          }
        }
        break
      }

      case 'EDIT':
        // Remote edit — push into CodeMirror without re-broadcasting
        applyEditRef.current?.(msg.content)
        break

      case 'CURSOR':
        applyCursorRef.current?.(msg.userId, msg.pos)
        break

      // ── Phase 2: review pipeline ──────────────────────────────────────

      case 'REVIEW_START':
        // Clear stale comments in both the panel and the editor gutter
        setReviewInProgress(true)
        setComments([])
        clearCommentsRef.current?.()
        break

      case 'AI_COMMENT': {
        const c = { line: msg.line, text: msg.text, severity: msg.severity, category: msg.category }
        // Update panel (React state) and editor gutter (CodeMirror state) separately
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

      default:
        console.log('Unknown message type:', msg.type)
    }
  }

  // ── Editor ready callback ───────────────────────────────────────────────
  // Called once CodeMirror has mounted.  Captures all imperative handles and
  // flushes any content that arrived before the editor was ready.

  const onEditorReady = useCallback(({
    applyEdit, applyCursor, removeCursor, addComment, clearComments,
  }) => {
    applyEditRef.current     = applyEdit
    applyCursorRef.current   = applyCursor
    removeCursorRef.current  = removeCursor
    addCommentRef.current    = addComment
    clearCommentsRef.current = clearComments

    if (pendingEditRef.current !== null) {
      applyEdit(pendingEditRef.current)
      pendingEditRef.current = null
    }
    if (pendingCursorsRef.current !== null) {
      for (const [uid, pos] of Object.entries(pendingCursorsRef.current))
        applyCursor(uid, pos)
      pendingCursorsRef.current = null
    }
    if (pendingCommentsRef.current !== null) {
      clearComments()
      for (const c of pendingCommentsRef.current)
        addComment(c.line, c.text, c.severity, c.category)
      pendingCommentsRef.current = null
    }
  }, [])

  // ── Outbound message senders ────────────────────────────────────────────

  const onLocalChange = useCallback((content) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'EDIT', userId: session?.userId, content }))
  }, [session?.userId])

  const onCursorMove = useCallback((pos) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'CURSOR', userId: session?.userId, pos }))
  }, [session?.userId])

  const handleRequestReview = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({
      type:     'REVIEW_REQUEST',
      userId:   session?.userId,
      language: 'javascript',
    }))
  }, [session?.userId])

  const handleLeave = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'USER_LEAVE' }))
      wsRef.current.close()
      wsRef.current = null
    }
    applyEditRef.current     = null
    applyCursorRef.current   = null
    removeCursorRef.current  = null
    addCommentRef.current    = null
    clearCommentsRef.current = null
    pendingEditRef.current     = null
    pendingCursorsRef.current  = null
    pendingCommentsRef.current = null
    setSession(null)
    setUsers([])
    setStatus('')
    setComments([])
    setReviewInProgress(false)
  }, [])

  // ── Render ──────────────────────────────────────────────────────────────

  if (!session) {
    return <JoinScreen onJoin={handleJoin} />
  }

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">

      {/* Left sidebar — room info, user list, connection status */}
      <aside className="w-56 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-4 py-3 border-b border-gray-800">
          <p className="text-xs text-gray-400 uppercase tracking-widest">Room</p>
          <p className="text-lg font-mono font-bold text-emerald-400">{session.roomCode}</p>
        </div>

        <UserList users={users} currentUserId={session.userId} />

        <div className="mt-auto px-4 py-3 border-t border-gray-800 space-y-2">
          <p className="text-xs text-gray-500 truncate">{status}</p>
          <button
            onClick={handleLeave}
            className="w-full text-sm bg-gray-800 hover:bg-red-900 text-gray-300 hover:text-red-200 rounded px-3 py-1.5 transition-colors"
          >
            Leave room
          </button>
        </div>
      </aside>

      {/* Shared editor — takes all remaining horizontal space */}
      <main className="flex-1 overflow-hidden">
        <Editor
          onLocalChange={onLocalChange}
          onCursorMove={onCursorMove}
          onReady={onEditorReady}
        />
      </main>

      {/* Right panel — AI review button + comment list */}
      <CommentsPanel
        comments={comments}
        reviewInProgress={reviewInProgress}
        onRequestReview={handleRequestReview}
      />
    </div>
  )
}
