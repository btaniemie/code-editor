const SEVERITY_BORDER = {
  critical: 'border-red-500/50',
  warning:  'border-yellow-500/50',
  info:     'border-blue-500/50',
}

const SEVERITY_BADGE = {
  critical: 'bg-red-500/20 text-red-400',
  warning:  'bg-yellow-500/20 text-yellow-400',
  info:     'bg-blue-500/20 text-blue-400',
}

/**
 * CommentsPanel — bottom strip showing AI review comments as scrollable cards.
 *
 * Props:
 *   comments        — array of { line, text, severity, category }
 *   reviewInProgress — boolean
 *   open            — controlled by parent (App.jsx)
 *   height          — pixel height when open, controlled by drag handle in App.jsx
 *   onToggle        — called when the header is clicked
 */
export default function CommentsPanel({ comments, reviewInProgress, open, height, onToggle }) {
  return (
    <div
      style={{ height: open ? height : 36 }}
      className="flex-shrink-0 bg-gray-900 border-t border-gray-800 flex flex-col overflow-hidden"
    >
      {/* Header — click to toggle open/close */}
      <button
        onClick={onToggle}
        className="flex items-center gap-3 px-4 w-full flex-shrink-0 h-9 hover:bg-gray-800/50 transition-colors text-left"
      >
        {/* Chevron rotates when collapsed */}
        <svg
          className={`w-3.5 h-3.5 text-gray-500 transition-transform duration-200 ${open ? 'rotate-0' : 'rotate-180'}`}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>

        <span className="text-xs text-gray-400 uppercase tracking-widest">AI Review</span>

        {reviewInProgress && (
          <span className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="inline-block w-3 h-3 border-2 border-gray-600 border-t-emerald-400 rounded-full animate-spin" />
            Analyzing…
          </span>
        )}

        {!reviewInProgress && comments.length > 0 && (
          <span className="text-xs text-gray-600">
            {comments.length} comment{comments.length !== 1 ? 's' : ''}
          </span>
        )}
      </button>

      {/* Scrollable card list — only rendered when open */}
      {open && (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          {comments.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-xs text-gray-700">
                {reviewInProgress ? 'Waiting for comments…' : 'No review yet - use the button in the sidebar'}
              </p>
            </div>
          ) : (
            <div className="flex gap-2.5 px-4 py-2.5 h-full items-start">
              {comments.map((c, i) => (
                <div
                  key={i}
                  className={`flex-shrink-0 w-64 bg-gray-800/80 border-l-2 rounded p-2.5 flex flex-col gap-1.5
                    ${SEVERITY_BORDER[c.severity] ?? SEVERITY_BORDER.info}`}
                >
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-mono text-gray-500">L{c.line}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${SEVERITY_BADGE[c.severity] ?? SEVERITY_BADGE.info}`}>
                      {c.severity}
                    </span>
                    <span className="text-[10px] text-gray-500 bg-gray-700/60 px-1.5 py-0.5 rounded">
                      {c.category}
                    </span>
                  </div>
                  <p className="text-xs text-gray-300 leading-relaxed line-clamp-3">{c.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
