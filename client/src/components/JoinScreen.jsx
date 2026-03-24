import { useState } from 'react'

// Generates a random 6-character alphanumeric room code, e.g. "k7xm2q".
// Used when the user clicks "Create room" so they don't have to invent one.
function generateRoomCode() {
  return Math.random().toString(36).slice(2, 8)
}

export default function JoinScreen({ onJoin }) {
  const [userId, setUserId]     = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [error, setError]       = useState('')

  function validate() {
    if (!userId.trim()) return 'Enter a username.'
    if (!roomCode.trim()) return 'Enter a room code or click "Create room".'
    return null
  }

  function handleJoin(e) {
    e.preventDefault()
    const err = validate()
    if (err) { setError(err); return }
    setError('')
    onJoin(userId.trim(), roomCode.trim().toLowerCase())
  }

  function handleCreate() {
    if (!userId.trim()) { setError('Enter a username first.'); return }
    setError('')
    const code = generateRoomCode()
    setRoomCode(code)
    onJoin(userId.trim(), code)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm bg-gray-900 rounded-xl p-8 shadow-2xl border border-gray-800">
        {/* Logo / title */}
        <h1 className="text-2xl font-bold text-indigo-400 mb-1">CodeReview</h1>
        <p className="text-sm text-gray-400 mb-6">Real-time collaborative code review</p>

        <form onSubmit={handleJoin} className="space-y-4">
          {/* Username */}
          <div>
            <label className="block text-xs text-gray-400 mb-1 uppercase tracking-widest">
              Username
            </label>
            <input
              type="text"
              value={userId}
              onChange={e => setUserId(e.target.value)}
              placeholder="e.g. minh"
              maxLength={24}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Room code */}
          <div>
            <label className="block text-xs text-gray-400 mb-1 uppercase tracking-widest">
              Room code
            </label>
            <input
              type="text"
              value={roomCode}
              onChange={e => setRoomCode(e.target.value)}
              placeholder="e.g. abc123"
              maxLength={12}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          {/* Buttons */}
          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded px-4 py-2 transition-colors"
            >
              Join room
            </button>
            <button
              type="button"
              onClick={handleCreate}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-medium rounded px-4 py-2 transition-colors"
            >
              Create room
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
