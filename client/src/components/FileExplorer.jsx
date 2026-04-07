import { useState } from 'react'

function fileIcon(name) {
  if (name.endsWith('.js') || name.endsWith('.jsx')) return (
    <span style={{ color: '#f7df1e', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>JS</span>
  )
  if (name.endsWith('.py')) return (
    <span style={{ color: '#3776ab', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>PY</span>
  )
  if (name.endsWith('.java')) return (
    <span style={{ color: '#e76f00', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>JV</span>
  )
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return (
    <span style={{ color: '#3178c6', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>TS</span>
  )
  if (name.endsWith('.html')) return (
    <span style={{ color: '#e34c26', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>HT</span>
  )
  if (name.endsWith('.css')) return (
    <span style={{ color: '#264de4', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>CS</span>
  )
  return (
    <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>{'  '}</span>
  )
}

export default function FileExplorer({ files, activeFile, onFileSelect, onFileCreate, onFileDelete, onFileRename }) {
  const [creating,    setCreating]    = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [renaming,    setRenaming]    = useState(null)   // filename being renamed
  const [renameValue, setRenameValue] = useState('')

  const fileNames = Object.keys(files).sort()

  const submitCreate = (e) => {
    e?.preventDefault()
    const name = newFileName.trim()
    if (name && !files[name]) onFileCreate(name)
    setNewFileName('')
    setCreating(false)
  }

  const submitRename = (e) => {
    e?.preventDefault()
    const newName = renameValue.trim()
    if (newName && newName !== renaming) onFileRename(renaming, newName)
    setRenaming(null)
  }

  return (
    <div className="flex flex-col overflow-hidden" style={{ minHeight: 0, flex: '1 1 0' }}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between flex-shrink-0">
        <span className="text-xs text-gray-500 uppercase tracking-widest font-medium">Explorer</span>
        <button
          onClick={() => { setCreating(true); setNewFileName('') }}
          className="text-gray-500 hover:text-emerald-400 transition-colors"
          title="New file"
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v4h4a1 1 0 010 2h-4v4a1 1 0 01-2 0v-4H5a1 1 0 010-2h4V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* New file input */}
        {creating && (
          <form onSubmit={submitCreate} className="px-2 py-1">
            <input
              autoFocus
              value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
              onBlur={() => { if (!newFileName.trim()) setCreating(false) }}
              onKeyDown={e => { if (e.key === 'Escape') setCreating(false) }}
              placeholder="filename.js"
              className="w-full bg-gray-800 text-gray-200 text-xs rounded px-2 py-1
                         border border-emerald-600 outline-none font-mono"
            />
          </form>
        )}

        {/* File entries */}
        {fileNames.map(name => (
          <div
            key={name}
            onClick={() => renaming !== name && onFileSelect(name)}
            className={`group flex items-center gap-2 px-3 py-1 cursor-pointer select-none
              ${activeFile === name
                ? 'bg-gray-700/50 text-gray-100'
                : 'text-gray-400 hover:bg-gray-800/40 hover:text-gray-200'}
              transition-colors`}
          >
            {/* File type badge */}
            <span className="flex-shrink-0 w-5 flex items-center justify-center">
              {fileIcon(name)}
            </span>

            {/* Name or rename input */}
            {renaming === name ? (
              <form
                onSubmit={submitRename}
                className="flex-1 min-w-0"
                onClick={e => e.stopPropagation()}
              >
                <input
                  autoFocus
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={submitRename}
                  onKeyDown={e => { if (e.key === 'Escape') setRenaming(null) }}
                  className="w-full bg-gray-800 text-gray-200 text-xs rounded px-1
                             border border-emerald-600 outline-none font-mono"
                />
              </form>
            ) : (
              <span className="flex-1 truncate text-xs font-mono">{name}</span>
            )}

            {/* Hover actions */}
            <div className="flex-shrink-0 hidden group-hover:flex items-center gap-1 ml-auto">
              <button
                onClick={e => {
                  e.stopPropagation()
                  setRenaming(name)
                  setRenameValue(name)
                }}
                className="text-gray-600 hover:text-gray-300 transition-colors p-0.5"
                title="Rename"
              >
                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
              </button>
              {fileNames.length > 1 && (
                <button
                  onClick={e => { e.stopPropagation(); onFileDelete(name) }}
                  className="text-gray-600 hover:text-red-400 transition-colors p-0.5"
                  title="Delete"
                >
                  <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}

        {fileNames.length === 0 && !creating && (
          <p className="px-3 py-4 text-xs text-gray-600 text-center">No files yet</p>
        )}
      </div>
    </div>
  )
}
