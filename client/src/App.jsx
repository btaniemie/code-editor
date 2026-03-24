import { useState, useRef, useCallback } from 'react'
import JoinScreen from './components/JoinScreen'
import UserList from './components/UserList'

const SERVER_URL = 'ws://localhost:8080'

export default function App() {
  // When `session` is null we show the join screen.
  // Once joined it holds { userId, roomCode } so the room view can display them.
  const [session, setSession] = useState(null)

  // Live list of userIds in the room, updated by USER_JOIN / USER_LEAVE messages.
  const [users, setUsers] = useState([])

  // Status line shown below the user list ("Connected", "Disconnected", etc.)
  const [status, setStatus] = useState('')

  // We keep the WebSocket in a ref, not state, because we don't want React to
  // re-render whenever the socket object changes — only the derived data matters.
  const wsRef = useRef(null)

  // ------------------------------------------------------------------
  // handleJoin — called by JoinScreen when the user submits the form.
  // Opens the WebSocket TCP connection and sends USER_JOIN.
  // ------------------------------------------------------------------
  const handleJoin = useCallback((userId, roomCode) => {
    // Native browser WebSocket API — no library, just TCP under the hood.
    const ws = new WebSocket(SERVER_URL)
    wsRef.current = ws

    ws.onopen = () => {
      // Connection is established; introduce ourselves to the server.
      ws.send(JSON.stringify({ type: 'USER_JOIN', userId, roomCode }))
      setStatus('Connected')
    }

    ws.onmessage = (event) => {
      // Every server message is a JSON object with a "type" opcode.
      const msg = JSON.parse(event.data)
      handleMessage(msg, userId, roomCode)
    }

    ws.onclose = () => {
      setStatus('Disconnected')
    }

    ws.onerror = (err) => {
      console.error('WebSocket error:', err)
      setStatus('Connection error')
    }
  }, [])

  // ------------------------------------------------------------------
  // handleMessage — client-side message router (mirrors server's switch).
  // We need userId and roomCode in scope to know when to transition to
  // the room view (first USER_JOIN that confirms our own join).
  // ------------------------------------------------------------------
  function handleMessage(msg, userId, roomCode) {
    switch (msg.type) {
      case 'USER_JOIN':
        // The server echoes USER_JOIN to everyone including the sender,
        // so the first time we receive it we know the join was accepted.
        // Transition from join screen to room view.
        setUsers(msg.users)
        setSession({ userId, roomCode })
        break

      case 'USER_LEAVE':
        setUsers(msg.users)
        break

      default:
        console.log('Unknown message type:', msg.type)
    }
  }

  // ------------------------------------------------------------------
  // handleLeave — lets the user manually leave the room.
  // ------------------------------------------------------------------
  const handleLeave = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'USER_LEAVE' }))
      wsRef.current.close()
      wsRef.current = null
    }
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
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        {/* Room header */}
        <div className="px-4 py-3 border-b border-gray-800">
          <p className="text-xs text-gray-400 uppercase tracking-widest">Room</p>
          <p className="text-lg font-mono font-bold text-indigo-400">{session.roomCode}</p>
        </div>

        {/* User list */}
        <UserList users={users} currentUserId={session.userId} />

        {/* Status + leave */}
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

      {/* Main content area — editor goes here in Step 3 */}
      <main className="flex-1 flex items-center justify-center text-gray-600 text-sm">
        Editor coming in Step 3
      </main>
    </div>
  )
}
