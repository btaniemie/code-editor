import { useState, useRef } from 'react'

// ── Tree builder ──────────────────────────────────────────────────────────────
//
// Converts a flat array of file paths into a nested tree.
// e.g. ["main.js", "src/App.jsx", "src/utils/helper.js"] ->
//   { main.js: { isFile:true, fullPath:"main.js", children:{} },
//     src:     { isFile:false, fullPath:"src",    children:{
//       App.jsx: {...},
//       utils:   { isFile:false, children:{ helper.js:{...} } }
//     }}}
function buildTree(filePaths) {
  const root = {}
  for (const fp of filePaths) {
    const parts = fp.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!node[part]) {
        node[part] = {
          children: {},
          isFile:   i === parts.length - 1,
          fullPath: parts.slice(0, i + 1).join('/'),
        }
      }
      node = node[part].children
    }
  }
  return root
}

// Sort tree entries: folders before files, then alphabetical within each group.
function sortedEntries(obj) {
  return Object.entries(obj).sort(([aName, aNode], [bName, bNode]) => {
    if (!aNode.isFile && bNode.isFile) return -1
    if (aNode.isFile && !bNode.isFile) return  1
    return aName.localeCompare(bName)
  })
}

// ── File / Folder icons ───────────────────────────────────────────────────────

function FileIcon() {
  return (
    <svg className="w-3 h-3 flex-shrink-0 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
    </svg>
  )
}

function FolderIcon({ open }) {
  return open ? (
    <svg className="w-3 h-3 flex-shrink-0 text-yellow-500/70" viewBox="0 0 20 20" fill="currentColor">
      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  ) : (
    <svg className="w-3 h-3 flex-shrink-0 text-yellow-600/70" viewBox="0 0 20 20" fill="currentColor">
      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  )
}

// ── TreeNode ──────────────────────────────────────────────────────────────────

function TreeNode({ name, node, depth, activeFile, onSelect, onDelete, onRename, renamingPath, setRenamingPath }) {
  const [expanded, setExpanded] = useState(true)
  const [renameVal, setRenameVal] = useState(name)
  const inputRef = useRef(null)
  const isRenaming = renamingPath === node.fullPath

  const indent = depth * 12 + 4

  if (node.isFile) {
    const isActive = node.fullPath === activeFile
    return (
      <div
        style={{ paddingLeft: indent }}
        className={`group flex items-center justify-between gap-1 py-0.5 pr-2 rounded-sm cursor-pointer select-none
          ${isActive ? 'bg-emerald-900/40 text-emerald-300' : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'}`}
        onClick={() => { if (!isRenaming) onSelect(node.fullPath) }}
      >
        {isRenaming ? (
          <input
            ref={inputRef}
            autoFocus
            value={renameVal}
            onChange={e => setRenameVal(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const trimmed = renameVal.trim()
                if (trimmed && trimmed !== name) onRename(node.fullPath, trimmed)
                setRenamingPath(null)
              }
              if (e.key === 'Escape') { setRenameVal(name); setRenamingPath(null) }
            }}
            onBlur={() => { setRenameVal(name); setRenamingPath(null) }}
            onClick={e => e.stopPropagation()}
            className="bg-gray-700 text-gray-100 px-1 rounded text-xs flex-1 outline-none border border-emerald-600/50"
          />
        ) : (
          <>
            <span className="flex items-center gap-1.5 min-w-0 flex-1">
              <FileIcon />
              <span className="truncate text-xs font-mono">{name}</span>
            </span>
            {/* Action buttons — shown on hover */}
            <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
              <button
                title="Rename"
                onClick={e => {
                  e.stopPropagation()
                  setRenameVal(name)
                  setRenamingPath(node.fullPath)
                }}
                className="p-0.5 rounded text-gray-600 hover:text-gray-300 transition-colors"
              >
                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
              </button>
              <button
                title="Delete"
                onClick={e => {
                  e.stopPropagation()
                  onDelete(node.fullPath)
                }}
                className="p-0.5 rounded text-gray-600 hover:text-red-400 transition-colors"
              >
                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  // ── Folder node ─────────────────────────────────────────────────────────────
  return (
    <div>
      <div
        style={{ paddingLeft: indent }}
        className="flex items-center gap-1.5 py-0.5 pr-2 cursor-pointer select-none text-gray-400 hover:text-gray-200"
        onClick={() => setExpanded(v => !v)}
      >
        <svg
          className="w-2.5 h-2.5 flex-shrink-0 transition-transform duration-100"
          style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
        </svg>
        <FolderIcon open={expanded} />
        <span className="text-xs font-mono">{name}</span>
      </div>

      {expanded && sortedEntries(node.children).map(([childName, childNode]) => (
        <TreeNode
          key={childNode.fullPath}
          name={childName}
          node={childNode}
          depth={depth + 1}
          activeFile={activeFile}
          onSelect={onSelect}
          onDelete={onDelete}
          onRename={onRename}
          renamingPath={renamingPath}
          setRenamingPath={setRenamingPath}
        />
      ))}
    </div>
  )
}

// ── FileTree component ────────────────────────────────────────────────────────

/**
 * Props:
 *   filePaths    — string[] of all file paths in the room
 *   activeFile   — currently viewed file path
 *   onFileSelect — (path) => void  — user clicked a file
 *   onFileCreate — (path) => void  — user confirmed new file name
 *   onFileDelete — (path) => void  — user clicked delete
 *   onFileRename — (oldPath, newPath) => void
 *   isDisconnected — boolean
 */
export default function FileTree({ filePaths, activeFile, onFileSelect, onFileCreate, onFileDelete, onFileRename, isDisconnected }) {
  const [creating, setCreating]     = useState(false)
  const [newName, setNewName]       = useState('')
  const [renamingPath, setRenamingPath] = useState(null)

  const tree = buildTree(filePaths)

  const commitCreate = () => {
    const trimmed = newName.trim()
    if (trimmed) onFileCreate(trimmed)
    setCreating(false)
    setNewName('')
  }

  return (
    <div className="flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 flex-shrink-0">
        <span className="text-[10px] text-gray-500 uppercase tracking-widest">Files</span>
        <button
          disabled={isDisconnected}
          onClick={() => { setCreating(true); setNewName('') }}
          title="New file"
          className="text-gray-600 hover:text-emerald-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Tree items */}
      <div className="overflow-y-auto flex-1 pb-1">
        {/* Inline new-file input at root level */}
        {creating && (
          <div className="flex items-center gap-1.5 px-3 py-0.5">
            <FileIcon />
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')  commitCreate()
                if (e.key === 'Escape') { setCreating(false); setNewName('') }
              }}
              onBlur={() => { setCreating(false); setNewName('') }}
              placeholder="filename.js"
              className="bg-gray-700 text-gray-100 px-1.5 py-0.5 rounded text-xs flex-1 outline-none border border-emerald-600/50 font-mono"
            />
          </div>
        )}

        {filePaths.length === 0 && !creating && (
          <p className="px-3 py-2 text-[10px] text-gray-700">No files — click + to create one</p>
        )}

        {sortedEntries(tree).map(([name, node]) => (
          <TreeNode
            key={node.fullPath}
            name={name}
            node={node}
            depth={0}
            activeFile={activeFile}
            onSelect={onFileSelect}
            onDelete={onFileDelete}
            onRename={onFileRename}
            renamingPath={renamingPath}
            setRenamingPath={setRenamingPath}
          />
        ))}
      </div>
    </div>
  )
}
