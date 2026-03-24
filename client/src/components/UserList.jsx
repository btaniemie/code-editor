// Stable color palette — each username gets a consistent color derived from
// its characters so the same user always appears in the same color across all clients.
const COLORS = [
  'bg-indigo-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-amber-500',
  'bg-sky-500',
  'bg-violet-500',
  'bg-pink-500',
  'bg-teal-500',
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
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${colorForUser(userId)}`} />

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
