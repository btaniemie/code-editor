const SEVERITY_STYLES = {
  critical: 'bg-red-500/20 text-red-400 border border-red-500/40',
  warning:  'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40',
  info:     'bg-blue-500/20 text-blue-400 border border-blue-500/40',
}

const CATEGORY_STYLE = 'bg-gray-800 text-gray-500 border border-gray-700'

export default function CommentsPanel({ comments, reviewInProgress, onRequestReview }) {
  return (
    <aside className="w-72 flex-shrink-0 bg-gray-900 border-l border-gray-800 flex flex-col">

      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800">
        <p className="text-xs text-gray-400 uppercase tracking-widest">
          AI Review
          {comments.length > 0 && (
            <span className="ml-1 text-gray-600 normal-case">({comments.length})</span>
          )}
        </p>
      </div>

      {/* Request Review button */}
      <div className="px-4 py-3 border-b border-gray-800">
        <button
          onClick={onRequestReview}
          disabled={reviewInProgress}
          className={`w-full text-sm rounded px-3 py-2 font-medium transition-colors
            ${reviewInProgress
              ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
              : 'bg-emerald-800 hover:bg-emerald-700 text-emerald-100 cursor-pointer'
            }`}
        >
          {reviewInProgress ? (
            <span className="flex items-center justify-center gap-2">
              {/* CSS spinner — no library needed */}
              <span className="inline-block w-3 h-3 border-2 border-gray-500 border-t-emerald-400 rounded-full animate-spin" />
              Reviewing…
            </span>
          ) : (
            'Request Review'
          )}
        </button>
      </div>

      {/* Comment list */}
      <div className="flex-1 overflow-y-auto">
        {comments.length === 0 ? (
          <p className="px-4 py-8 text-xs text-gray-600 text-center">
            {reviewInProgress ? 'Waiting for comments…' : 'No comments yet.\nRequest a review to get started.'}
          </p>
        ) : (
          <ul className="divide-y divide-gray-800/60">
            {comments.map((c, i) => (
              <li key={i} className="px-4 py-3 hover:bg-gray-800/40 transition-colors">
                {/* Line + badges row */}
                <div className="flex items-center flex-wrap gap-1.5 mb-1.5">
                  <span className="text-xs font-mono text-gray-500">L{c.line}</span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${SEVERITY_STYLES[c.severity] ?? SEVERITY_STYLES.info}`}>
                    {c.severity}
                  </span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${CATEGORY_STYLE}`}>
                    {c.category}
                  </span>
                </div>
                {/* Comment text */}
                <p className="text-xs text-gray-300 leading-relaxed">{c.text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
