import { useState, useRef, useCallback } from 'react'
import JoinScreen from './components/JoinScreen'
import UserList from './components/UserList'
import Editor from './components/Editor'

const SERVER_URL = 'ws://localhost:8080'

export default function App() {
  const [session, setSession] = useState(null)  // { userId, roomCode } once joined
  const [users,   setUsers]   = useState([])
  const [status,  setStatus]  = useState('')

  // WebSocket — ref so socket changes don't trigger re-renders
  const wsRef = useRef(null)

  // Functions exposed by Editor once CodeMirror has mounted (via onReady)
  // Stored as refs for the same reason, calling them must not cause re-renders
  const applyEditRef    = useRef(null)
  const applyCursorRef  = useRef(null)
  const removeCursorRef = useRef(null)

  // Content/cursors that arrived before the editor mounted.  Flushed in
  // onEditorReady the moment the editor calls back with its apply functions
  const pendingEditRef    = useRef(null)
  const pendingCursorsRef = useRef(null) // { userId: line, ... } from SYNC

  const handleJoin = useCallback((userId, roomCode) => {
    const ws = new WebSocket(SERVER_URL)
    wsRef.current = ws

    ws.onopen  = () => {
      ws.send(JSON.stringify({ type: 'USER_JOIN', userId, roomCode }))
      setStatus('Connected')
    }
    ws.onmessage = (event) => {
      handleMessage(JSON.parse(event.data), userId, roomCode)
    }
    ws.onclose = () => setStatus('Disconnected')
    ws.onerror = () => setStatus('Connection error')
  }, [])

  // client-side message router
  function handleMessage(msg, userId, roomCode) {
    switch (msg.type) {

      case 'USER_JOIN':
        setUsers(msg.users)
        setSession({ userId, roomCode })
        break

      case 'USER_LEAVE':
        setUsers(msg.users)
        // remove the user's cursor who's just left
        removeCursorRef.current?.(msg.userId)
        break

      case 'SYNC':
        // apply the document — queue it if the editor isn't mounted yet
        if (applyEditRef.current) {
          applyEditRef.current(msg.document)
        } else {
          pendingEditRef.current = msg.document
        }
        // apply all known cursor positions from the room
        if (msg.cursors && Object.keys(msg.cursors).length > 0) {
          if (applyCursorRef.current) {
            for (const [uid, pos] of Object.entries(msg.cursors)) {
              applyCursorRef.current(uid, pos)
            }
          } else {
            pendingCursorsRef.current = msg.cursors
          }
        }
        break

      case 'EDIT':
        // another user's keystroke —> push into editor with RemoteAnnotation so our update listener doesn't re-broadcast it
        applyEditRef.current?.(msg.content)
        break

      case 'CURSOR':
        // another user moved their cursor —> render their widget
        applyCursorRef.current?.(msg.userId, msg.pos)
        break

      default:
        console.log('Unknown message type:', msg.type)
    }
  }

  // onEditorReady — called by Editor once CodeMirror is initialized.
  // Stores the three apply functions and flushes any queued content.
  const onEditorReady = useCallback(({ applyEdit, applyCursor, removeCursor }) => {
    applyEditRef.current    = applyEdit
    applyCursorRef.current  = applyCursor
    removeCursorRef.current = removeCursor

    // flush document queued before editor was mounted
    if (pendingEditRef.current !== null) {
      applyEdit(pendingEditRef.current)
      pendingEditRef.current = null
    }

    // flush cursors from SYNC that arrived before editor was mounted
    if (pendingCursorsRef.current !== null) {
      for (const [uid, pos] of Object.entries(pendingCursorsRef.current)) {
        applyCursor(uid, pos)
      }
      pendingCursorsRef.current = null
    }
  }, [])

  // onLocalChange - every local keystroke triggers this
  // sends the full document to the server as an EDIT message.
  const onLocalChange = useCallback((content) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'EDIT', userId: session?.userId, content }))
  }, [session?.userId])

  // onCursorMove — whenever the cursor or selection moves locally
  // sends a CURSOR message with the current 1-based line number
  const onCursorMove = useCallback((pos) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'CURSOR', userId: session?.userId, pos }))
  }, [session?.userId])

  const handleLeave = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'USER_LEAVE' }))
      wsRef.current.close()
      wsRef.current = null
    }
    applyEditRef.current    = null
    applyCursorRef.current  = null
    removeCursorRef.current = null
    pendingEditRef.current    = null
    pendingCursorsRef.current = null
    setSession(null)
    setUsers([])
    setStatus('')
  }, [])

  // render
  if (!session) {
    return <JoinScreen onJoin={handleJoin} />
  }

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-4 py-3 border-b border-gray-800">
          <p className="text-xs text-gray-400 uppercase tracking-widest">Room</p>
          <p className="text-lg font-mono font-bold text-indigo-400">{session.roomCode}</p>
        </div>

        <UserList users={users} currentUserId={session.userId} />

        <div className="mt-auto px-4 py-3 border-t border-gray-800 space-y-2">
          <p className="text-xs text-gray-500">{status}</p>
          <button
            onClick={handleLeave}
            className="w-full text-sm bg-gray-800 hover:bg-red-900 text-gray-300 hover:text-red-200 rounded px-3 py-1.5 transition-colors"
          >
            Leave room
          </button>
        </div>
      </aside>

      {/* Editor */}
      <main className="flex-1 overflow-hidden">
        <Editor
          onLocalChange={onLocalChange}
          onCursorMove={onCursorMove}
          onReady={onEditorReady}
        />
      </main>
    </div>
  )
}
