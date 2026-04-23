import { useEffect, useRef } from 'react'

/**
 * OutputPanel — terminal-styled scrolling div that streams RUN_OUTPUT lines.
 *
 * Props:
 *   lines          — array of { text: string } objects (each line of output)
 *   runInProgress  — boolean — shows spinner when true
 *   open           — controlled open/close state
 *   height         — pixel height when open
 *   onToggle       — called when header is clicked
 */
export default function OutputPanel({ lines, runInProgress, open, height, onToggle }) {
  const endRef = useRef(null)

  // Auto-scroll to bottom whenever a new line arrives.
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, open])

  return (
    <div
      style={{ height: open ? height : 36 }}
      className="flex-shrink-0 bg-gray-950 border-t border-gray-800 flex flex-col overflow-hidden"
    >
      {/* ── Header — click to toggle ── */}
      <button
        onClick={onToggle}
        className="flex items-center gap-3 px-4 w-full flex-shrink-0 h-9 hover:bg-gray-900/60 transition-colors text-left"
      >
        <svg
          className={`w-3.5 h-3.5 text-gray-500 transition-transform duration-200 ${open ? 'rotate-0' : 'rotate-180'}`}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>

        <span className="text-xs text-gray-400 uppercase tracking-widest">Output</span>

        {runInProgress && (
          <span className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="inline-block w-3 h-3 border-2 border-gray-600 border-t-green-400 rounded-full animate-spin" />
            Running…
          </span>
        )}

        {!runInProgress && lines.length > 0 && (
          <span className="text-xs text-gray-600">{lines.length} line{lines.length !== 1 ? 's' : ''}</span>
        )}
      </button>

      {/* ── Terminal output area — only rendered when open ── */}
      {open && (
        <div className="flex-1 overflow-y-auto bg-black/70 font-mono text-xs leading-relaxed p-3">
          {lines.length === 0 ? (
            <span className="text-gray-700">
              {runInProgress ? 'Running…' : 'No output yet — click Run to execute'}
            </span>
          ) : (
            lines.map((line, i) => (
              <div
                key={i}
                // stderr lines (compiler errors, runtime exceptions) in red,
                // stdout in the default green terminal colour.
                className={line.isError ? 'text-red-400' : 'text-green-300'}
              >
                {line.text || ' ' /* non-breaking space for blank lines */}
              </div>
            ))
          )}
          {/* Sentinel div — scrolled into view on new output */}
          <div ref={endRef} />
        </div>
      )}
    </div>
  )
}
