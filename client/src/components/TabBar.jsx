function fileIcon(name) {
  if (name.endsWith('.js') || name.endsWith('.jsx')) return { label: 'JS', color: '#f7df1e' }
  if (name.endsWith('.py'))                           return { label: 'PY', color: '#3776ab' }
  if (name.endsWith('.java'))                         return { label: 'JV', color: '#e76f00' }
  if (name.endsWith('.ts') || name.endsWith('.tsx'))  return { label: 'TS', color: '#3178c6' }
  if (name.endsWith('.html'))                         return { label: 'HT', color: '#e34c26' }
  if (name.endsWith('.css'))                          return { label: 'CS', color: '#264de4' }
  return { label: '··', color: '#94a3b8' }
}

export default function TabBar({ tabs, activeFile, onTabSelect, onTabClose }) {
  if (!tabs || tabs.length === 0) return null

  return (
    <div
      className="flex bg-gray-950 border-b border-gray-800 overflow-x-auto flex-shrink-0"
      style={{ height: 35, scrollbarWidth: 'none' }}
    >
      {tabs.map(name => {
        const shortName = name.includes('/') ? name.split('/').pop() : name
        const icon      = fileIcon(shortName)
        const isActive  = name === activeFile
        return (
          <div
            key={name}
            onClick={() => onTabSelect(name)}
            title={name}
            style={{ maxWidth: 180 }}
            className={`group flex items-center gap-1.5 px-3 cursor-pointer border-r border-gray-800
              flex-shrink-0 select-none transition-colors
              ${isActive
                ? 'bg-gray-900 text-gray-100 border-t-2 border-t-emerald-500'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900/40 border-t-2 border-t-transparent'
              }`}
          >
            {/* Language badge */}
            <span
              className="flex-shrink-0 text-[10px] font-bold font-mono"
              style={{ color: icon.color }}
            >
              {icon.label}
            </span>

            {/* Filename (short) with full path as tooltip */}
            <span className="truncate text-xs font-mono">{shortName}</span>

            {/* Close button */}
            {tabs.length > 1 && (
              <button
                onClick={e => { e.stopPropagation(); onTabClose(name) }}
                className={`flex-shrink-0 rounded p-0.5 transition-colors
                  ${isActive
                    ? 'text-gray-500 hover:text-gray-200 hover:bg-gray-700'
                    : 'text-transparent group-hover:text-gray-600 hover:!text-gray-300'
                  }`}
              >
                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
