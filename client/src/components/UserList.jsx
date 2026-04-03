const COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#fb923c', '#4ade80', '#818cf8',
]

function colorForUser(userId) {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) & 0xffffffff
  }
  return COLORS[Math.abs(hash) % COLORS.length]
}

export default function UserList({ users, currentUserId }) {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      <p className="text-xs text-gray-400 uppercase tracking-widest mb-3">
        Users ({users.length})
      </p>

      <ul className="space-y-2">
        {users.map(userId => (
          <li key={userId} className="flex items-center gap-2">
            {/* Colored avatar dot */}
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colorForUser(userId) }} />

            {/* Username */}
            <span className={`text-sm truncate ${userId === currentUserId ? 'text-white font-medium' : 'text-gray-300'}`}>
              {userId}
              {userId === currentUserId && (
                <span className="ml-1 text-xs text-gray-500">(you)</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
