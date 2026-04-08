import { useState } from 'react'

// ── Language badge ─────────────────────────────────────────────────────────

function fileIcon(name) {
  if (name.endsWith('.js') || name.endsWith('.jsx'))
    return <span style={{ color: '#f7df1e', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>JS</span>
  if (name.endsWith('.py'))
    return <span style={{ color: '#3776ab', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>PY</span>
  if (name.endsWith('.java'))
    return <span style={{ color: '#e76f00', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>JV</span>
  if (name.endsWith('.ts') || name.endsWith('.tsx'))
    return <span style={{ color: '#3178c6', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>TS</span>
  if (name.endsWith('.html'))
    return <span style={{ color: '#e34c26', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>HT</span>
  if (name.endsWith('.css'))
    return <span style={{ color: '#264de4', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>CS</span>
  return <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>{'  '}</span>
}

// ── Tree builder ───────────────────────────────────────────────────────────
// Converts flat { 'src/main.js': '', 'app.py': '' } keys into a nested array:
//   [
//     { type:'folder', name:'src', path:'src', children:[
//       { type:'file', name:'main.js', path:'src/main.js' }
//     ]},
//     { type:'file', name:'app.py', path:'app.py' },
//   ]

function buildTree(filePaths) {
  const root = []

  for (const filePath of [...filePaths].sort()) {
    const parts    = filePath.split('/')
    let   children = root

    for (let i = 0; i < parts.length - 1; i++) {
      const folderPath = parts.slice(0, i + 1).join('/')
      let folder = children.find(n => n.type === 'folder' && n.path === folderPath)
      if (!folder) {
        folder = { type: 'folder', name: parts[i], path: folderPath, children: [] }
        children.push(folder)
      }
      children = folder.children
    }

    children.push({ type: 'file', name: parts[parts.length - 1], path: filePath })
  }

  return root
}

// Injects a virtual (empty) folder into the tree so a pending folder shows up
// before any files exist inside it. Safe to call when the folder already exists.
function injectPendingFolder(root, folderPath) {
  const parts = folderPath.split('/')
  let children = root
  for (let i = 0; i < parts.length; i++) {
    const path = parts.slice(0, i + 1).join('/')
    let node = children.find(n => n.type === 'folder' && n.path === path)
    if (!node) {
      node = { type: 'folder', name: parts[i], path, children: [] }
      children.push(node)
    }
    children = node.children
  }
}

// ── FileExplorer ───────────────────────────────────────────────────────────

export default function FileExplorer({ files, activeFile, onFileSelect, onFileCreate, onFileDelete, onFileRename }) {
  const [expanded,       setExpanded]       = useState(new Set())
  // creatingIn: null = closed | '' = root | 'src' = inside src/
  const [creatingIn,     setCreatingIn]     = useState(null)
  const [newFileName,    setNewFileName]    = useState('')
  // creatingFolder: null = closed | '' = root | 'src' = inside src/
  const [creatingFolder, setCreatingFolder] = useState(null)
  const [newFolderName,  setNewFolderName]  = useState('')
  // renaming: null = none | 'src/main.js' = that file
  const [renaming,       setRenaming]       = useState(null)
  const [renameValue,    setRenameValue]    = useState('')
  // pendingFolder: folder named by user but not yet containing any file
  const [pendingFolder,  setPendingFolder]  = useState(null)

  const filePaths = Object.keys(files)
  const tree      = buildTree(filePaths)
  // Inject the pending folder so it appears in the tree before a file is added.
  if (pendingFolder) injectPendingFolder(tree, pendingFolder)

  // ── Helpers ──────────────────────────────────────────────────────────────

  const toggleFolder = (path) =>
    setExpanded(prev => { const s = new Set(prev); s.has(path) ? s.delete(path) : s.add(path); return s })

  const openFileIn   = (folderPath) => { setCreatingIn(folderPath); setNewFileName('')   }
  const openFolderIn = (parentPath) => { setCreatingFolder(parentPath); setNewFolderName('') }

  const submitFile = (e, folderPath) => {
    e?.preventDefault()
    const name = newFileName.trim()
    if (name) {
      const full = folderPath ? `${folderPath}/${name}` : name
      if (!files[full]) onFileCreate(full)
    }
    setCreatingIn(null)
    setNewFileName('')
    setPendingFolder(null)  // folder now real (or cancelled)
  }

  const submitFolder = (e, parentPath) => {
    e?.preventDefault()
    const name = newFolderName.trim()
    if (name) {
      const full = parentPath ? `${parentPath}/${name}` : name
      // Mark this as the pending folder so injectPendingFolder adds it to the
      // tree immediately, then open the file input inside it.
      setPendingFolder(full)
      setExpanded(prev => new Set([...prev, full]))
      openFileIn(full)
    }
    setCreatingFolder(null)
    setNewFolderName('')
  }

  const submitRename = (filePath) => {
    const newName = renameValue.trim()
    if (newName) {
      const dir     = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/') + 1) : ''
      const newPath = dir + newName
      if (newPath !== filePath) onFileRename(filePath, newPath)
    }
    setRenaming(null)
  }

  // ── Recursive renderer ────────────────────────────────────────────────────

  const renderTree = (nodes, depth = 0) => {
    const pl = 8 + depth * 14   // left padding per level

    return nodes.map(node => {
      // ── Folder ──────────────────────────────────────────────────────────
      if (node.type === 'folder') {
        const isOpen = expanded.has(node.path)
        return (
          <div key={node.path}>
            {/* Folder row */}
            <div
              className="group flex items-center gap-1.5 py-1 pr-2 cursor-pointer
                         text-gray-400 hover:bg-gray-800/40 hover:text-gray-200 transition-colors"
              style={{ paddingLeft: pl }}
              onClick={() => toggleFolder(node.path)}
            >
              {/* Expand chevron */}
              <svg
                className={`w-3 h-3 flex-shrink-0 text-gray-600 transition-transform duration-150
                            ${isOpen ? 'rotate-90' : ''}`}
                viewBox="0 0 20 20" fill="currentColor"
              >
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
              </svg>

              {/* Folder icon */}
              <svg className="w-3.5 h-3.5 flex-shrink-0 text-yellow-500" viewBox="0 0 20 20" fill="currentColor">
                {isOpen
                  ? <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                  : <path fillRule="evenodd" d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" />
                }
              </svg>

              <span className="flex-1 text-xs font-mono truncate">{node.name}</span>

              {/* Hover actions */}
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  title="New file in folder"
                  onClick={e => {
                    e.stopPropagation()
                    setExpanded(prev => new Set([...prev, node.path]))
                    openFileIn(node.path)
                  }}
                  className="text-gray-600 hover:text-emerald-400 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 010 2h-5v5a1 1 0 01-2 0v-5H4a1 1 0 010-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                  </svg>
                </button>
                <button
                  title="New folder inside"
                  onClick={e => {
                    e.stopPropagation()
                    setExpanded(prev => new Set([...prev, node.path]))
                    openFolderIn(node.path)
                  }}
                  className="text-gray-600 hover:text-yellow-400 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v1H2V6z" />
                    <path fillRule="evenodd" d="M2 9h16v5a2 2 0 01-2 2H4a2 2 0 01-2-2V9zm8 1a1 1 0 00-1 1v1H8a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1v-1a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Children */}
            {isOpen && (
              <div>
                {renderTree(node.children, depth + 1)}

                {/* New file input inside this folder */}
                {creatingIn === node.path && (
                  <form
                    onSubmit={e => submitFile(e, node.path)}
                    style={{ paddingLeft: pl + 14, paddingRight: 8 }}
                    className="py-1"
                  >
                    <input
                      autoFocus
                      value={newFileName}
                      onChange={e => setNewFileName(e.target.value)}
                      onBlur={() => { if (!newFileName.trim()) { setCreatingIn(null); setPendingFolder(null) } }}
                      onKeyDown={e => { if (e.key === 'Escape') { setCreatingIn(null); setPendingFolder(null) } }}
                      placeholder="filename.js"
                      className="w-full bg-gray-800 text-gray-200 text-xs rounded px-2 py-1
                                 border border-emerald-600 outline-none font-mono"
                    />
                  </form>
                )}

                {/* New subfolder input inside this folder */}
                {creatingFolder === node.path && (
                  <form
                    onSubmit={e => submitFolder(e, node.path)}
                    style={{ paddingLeft: pl + 14, paddingRight: 8 }}
                    className="py-1"
                  >
                    <input
                      autoFocus
                      value={newFolderName}
                      onChange={e => setNewFolderName(e.target.value)}
                      onBlur={() => { if (!newFolderName.trim()) setCreatingFolder(null) }}
                      onKeyDown={e => { if (e.key === 'Escape') setCreatingFolder(null) }}
                      placeholder="folder-name"
                      className="w-full bg-gray-800 text-gray-200 text-xs rounded px-2 py-1
                                 border border-yellow-600 outline-none font-mono"
                    />
                  </form>
                )}
              </div>
            )}
          </div>
        )
      }

      // ── File ─────────────────────────────────────────────────────────────
      const isActive = node.path === activeFile
      return (
        <div
          key={node.path}
          onClick={() => renaming !== node.path && onFileSelect(node.path)}
          title={node.path}
          className={`group flex items-center gap-2 py-1 pr-2 cursor-pointer select-none transition-colors
            ${isActive
              ? 'bg-gray-700/50 text-gray-100'
              : 'text-gray-400 hover:bg-gray-800/40 hover:text-gray-200'
            }`}
          style={{ paddingLeft: pl }}
        >
          <span className="flex-shrink-0 w-5 flex items-center justify-center">
            {fileIcon(node.name)}
          </span>

          {renaming === node.path ? (
            <form
              className="flex-1 min-w-0"
              onSubmit={e => { e.preventDefault(); submitRename(node.path) }}
              onClick={e => e.stopPropagation()}
            >
              <input
                autoFocus
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={() => submitRename(node.path)}
                onKeyDown={e => { if (e.key === 'Escape') setRenaming(null) }}
                className="w-full bg-gray-800 text-gray-200 text-xs rounded px-1 py-0.5
                           border border-emerald-600 outline-none font-mono"
                onClick={e => e.stopPropagation()}
              />
            </form>
          ) : (
            <span className="flex-1 text-xs font-mono truncate">{node.name}</span>
          )}

          {renaming !== node.path && (
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <button
                title="Rename"
                onClick={e => { e.stopPropagation(); setRenaming(node.path); setRenameValue(node.name) }}
                className="text-gray-600 hover:text-gray-300 transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
              </button>
              {filePaths.length > 1 && (
                <button
                  title="Delete"
                  onClick={e => { e.stopPropagation(); onFileDelete(node.path) }}
                  className="text-gray-600 hover:text-red-400 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      )
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col overflow-hidden" style={{ minHeight: 0, flex: '1 1 0' }}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between flex-shrink-0">
        <span className="text-xs text-gray-500 uppercase tracking-widest font-medium">Explorer</span>
        <div className="flex items-center gap-2">
          {/* New file at root */}
          <button
            onClick={() => openFileIn('')}
            title="New file"
            className="text-gray-500 hover:text-emerald-400 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 010 2h-5v5a1 1 0 01-2 0v-5H4a1 1 0 010-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
          </button>
          {/* New folder at root */}
          <button
            onClick={() => openFolderIn('')}
            title="New folder"
            className="text-gray-500 hover:text-yellow-400 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v1H2V6z" />
              <path fillRule="evenodd" d="M2 9h16v5a2 2 0 01-2 2H4a2 2 0 01-2-2V9zm8 1a1 1 0 00-1 1v1H8a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1v-1a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* Root-level new folder input */}
        {creatingFolder === '' && (
          <form onSubmit={e => submitFolder(e, '')} className="px-2 py-1">
            <input
              autoFocus
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onBlur={() => { if (!newFolderName.trim()) setCreatingFolder(null) }}
              onKeyDown={e => { if (e.key === 'Escape') setCreatingFolder(null) }}
              placeholder="folder-name"
              className="w-full bg-gray-800 text-gray-200 text-xs rounded px-2 py-1
                         border border-yellow-600 outline-none font-mono"
            />
          </form>
        )}

        {/* Root-level new file input */}
        {creatingIn === '' && (
          <form onSubmit={e => submitFile(e, '')} className="px-2 py-1">
            <input
              autoFocus
              value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
              onBlur={() => { if (!newFileName.trim()) { setCreatingIn(null); setPendingFolder(null) } }}
              onKeyDown={e => { if (e.key === 'Escape') { setCreatingIn(null); setPendingFolder(null) } }}
              placeholder="filename.js"
              className="w-full bg-gray-800 text-gray-200 text-xs rounded px-2 py-1
                         border border-emerald-600 outline-none font-mono"
            />
          </form>
        )}

        {renderTree(tree)}
      </div>
    </div>
  )
}
