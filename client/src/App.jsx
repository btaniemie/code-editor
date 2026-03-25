import { useState, useRef, useCallback } from 'react'
import JoinScreen from './components/JoinScreen'
import UserList from './components/UserList'
import Editor from './components/Editor'

const SERVER_URL = 'ws://localhost:8080'

export default function App() {
  const [session, setSession] = useState(null)   // { userId, roomCode } once joined
  const [users,   setUsers]   = useState([])
  const [status,  setStatus]  = useState('')

  // WebSocket connection — stored in a ref so changes to the socket don't
  // trigger re-renders.
  const wsRef = useRef(null)

  // applyRemoteEdit is a function exposed by Editor via its onReady callback.
  // Calling it patches the CodeMirror document with a remote annotation so
  // the editor's own update listener ignores the change and does not re-send it.
  const applyRemoteRef = useRef(null)

  // If a SYNC or EDIT message arrives before the Editor has mounted and called
  // onReady, we park the content here and flush it as soon as onReady fires.
  const pendingContentRef = useRef(null)

  // ------------------------------------------------------------------
  // handleJoin — opens the WebSocket and sends USER_JOIN
  // ------------------------------------------------------------------
  const handleJoin = useCallback((userId, roomCode) => {
    const ws = new WebSocket(SERVER_URL)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'USER_JOIN', userId, roomCode }))
      setStatus('Connected')
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      handleMessage(msg, userId, roomCode)
    }

    ws.onclose = () => setStatus('Disconnected')
    ws.onerror = () => setStatus('Connection error')
  }, [])

  // ------------------------------------------------------------------
  // handleMessage — client-side message router
  // ------------------------------------------------------------------
  function handleMessage(msg, userId, roomCode) {
    switch (msg.type) {

      case 'USER_JOIN':
        // Server echoes USER_JOIN to everyone including the sender.
        // First time we receive this it means our join was accepted —
        // transition from the join screen to the room view.
        setUsers(msg.users)
        setSession({ userId, roomCode })
        break

      case 'USER_LEAVE':
        setUsers(msg.users)
        break

      case 'SYNC':
        // Server sends SYNC privately to a new joiner with the current
        // document so they start in sync with the rest of the room.
        applyOrQueue(msg.document)
        break

      case 'EDIT':
        // Another user made a change — apply it to our CodeMirror instance.
        // The RemoteAnnotation inside applyRemoteRef prevents the editor's
        // update listener from re-broadcasting this back to the server.
        applyOrQueue(msg.content)
        break

      default:
        console.log('Unknown message type:', msg.type)
    }
  }

  // Apply a remote document update if the editor is ready, otherwise park it
  // so onEditorReady can flush it the moment the editor mounts.
  function applyOrQueue(content) {
    if (applyRemoteRef.current) {
      applyRemoteRef.current(content)
    } else {
      pendingContentRef.current = content
    }
  }

  // ------------------------------------------------------------------
  // onEditorReady — called by Editor once CodeMirror is fully initialized.
  // Stores the apply function and immediately flushes any queued content.
  // ------------------------------------------------------------------
  const onEditorReady = useCallback((applyFn) => {
    applyRemoteRef.current = applyFn
    if (pendingContentRef.current !== null) {
      applyFn(pendingContentRef.current)
      pendingContentRef.current = null
    }
  }, [])

  // ------------------------------------------------------------------
  // onLocalChange — called by Editor on every local keystroke.
  // Sends the full document text to the server as an EDIT message.
  // ------------------------------------------------------------------
  const onLocalChange = useCallback((content) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({
      type:    'EDIT',
      userId:  session?.userId,
      content,
    }))
  }, [session?.userId])

  // ------------------------------------------------------------------
  // handleLeave
  // ------------------------------------------------------------------
  const handleLeave = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'USER_LEAVE' }))
      wsRef.current.close()
      wsRef.current = null
    }
    applyRemoteRef.current  = null
    pendingContentRef.current = null
    setSession(null)
    setUsers([])
    setStatus('')
  }, [])

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
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

      {/* Editor — fills all remaining space */}
      <main className="flex-1 overflow-hidden">
        <Editor onLocalChange={onLocalChange} onReady={onEditorReady} />
      </main>
    </div>
  )
}
