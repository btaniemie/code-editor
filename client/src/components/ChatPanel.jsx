import { useState, useRef, useEffect } from 'react'

// Same palette and hash as UserList.jsx and Editor.jsx so a given username
// always maps to the same color everywhere in the UI.
const USER_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#fb923c', '#4ade80', '#818cf8',
]

function colorForUser(userId) {
  let hash = 0
  for (let i = 0; i < userId.length; i++)
    hash = (hash * 31 + userId.charCodeAt(i)) & 0xffffffff
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length]
}

/**
 * ChatPanel — right sidebar showing the room chat.
 *
 * Props:
 *   chat          — array of { userId, text, timestamp, replyTo, system? }
 *   currentUserId — used to style the sender's own messages differently
 *   onSendChat    — called with (text) when the user submits a message
 */
export default function ChatPanel({ chat, currentUserId, onSendChat, width, onClose }) {
  const [input, setInput] = useState('')
  const bottomRef         = useRef(null)

  // True while the last non-system message contains @ai and no AI reply has followed it yet
  const lastNonSystem   = [...chat].reverse().find(m => m.userId !== 'system')
  const aiIsTyping      = lastNonSystem
    && lastNonSystem.userId !== 'ai'
    && lastNonSystem.text?.toLowerCase().includes('@ai')

  // Auto-scroll to the latest message whenever chat updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat, aiIsTyping])

  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    onSendChat(text)
    setInput('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <aside style={{ width }} className="flex-shrink-0 bg-gray-900 border-l border-gray-800 flex flex-col">

      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <p className="text-xs text-gray-400 uppercase tracking-widest">
          Chat
          {chat.filter(m => !m.system && m.userId !== 'system').length > 0 && (
            <span className="ml-1 text-gray-600 normal-case">
              ({chat.filter(m => !m.system && m.userId !== 'system').length})
            </span>
          )}
        </p>
        <button
          onClick={onClose}
          className="text-gray-600 hover:text-gray-400 transition-colors"
          title="Close panel"
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
        {chat.length === 0 && (
          <p className="text-xs text-gray-600 text-center mt-8">
            No messages yet. Say something!
          </p>
        )}

        {chat.map((msg, i) => {
          // System messages (join/leave) — centered italic line
          if (msg.system || msg.userId === 'system') {
            return (
              <p key={i} className="text-[10px] text-gray-600 text-center italic py-0.5">
                {msg.text}
              </p>
            )
          }

          // AI response bubble — distinct violet style, left-aligned
          if (msg.userId === 'ai') {
            return (
              <div key={i} className="flex flex-col items-start">
                <span className="flex items-center gap-1 text-[10px] text-violet-400 mb-0.5 px-1">
                  {/* Simple sparkle icon */}
                  <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  AI
                </span>
                <div className="max-w-[88%] px-2.5 py-1.5 rounded rounded-tl-sm text-xs leading-relaxed break-words bg-violet-900/50 text-violet-100 border border-violet-700/40">
                  {msg.text}
                </div>
              </div>
            )
          }

          // Regular user bubble
          const isMine = msg.userId === currentUserId

          return (
            <div key={i} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
              <span
                className="text-[10px] mb-0.5 px-1"
                style={{ color: isMine ? '#6b7280' : colorForUser(msg.userId) }}
              >
                {isMine ? 'You' : msg.userId}
              </span>
              <div
                className={`max-w-[88%] px-2.5 py-1.5 rounded text-xs leading-relaxed break-words
                  ${isMine
                    ? 'bg-emerald-800/60 text-emerald-100 rounded-tr-sm'
                    : 'bg-gray-800 text-gray-200 rounded-tl-sm'
                  }`}
              >
                {msg.text}
              </div>
            </div>
          )
        })}

        {/* AI typing indicator — shown while waiting for a response */}
        {aiIsTyping && (
          <div className="flex flex-col items-start">
            <span className="flex items-center gap-1 text-[10px] text-violet-400 mb-0.5 px-1">
              <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              AI
            </span>
            <div className="px-3 py-2 rounded rounded-tl-sm bg-violet-900/30 border border-violet-700/30 flex gap-1 items-center">
              <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}

        {/* Sentinel for auto-scroll */}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="px-3 py-3 border-t border-gray-800 flex gap-2">
        <input
          type="text"
          className="flex-1 bg-gray-800 text-gray-100 text-xs rounded px-2.5 py-1.5 outline-none
                     focus:ring-1 focus:ring-emerald-600 placeholder-gray-600 min-w-0"
          placeholder="Message… (type @ai to ask the AI)"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim()}
          className="bg-emerald-800 hover:bg-emerald-700 disabled:bg-gray-800
                     disabled:text-gray-600 text-emerald-100 text-xs rounded
                     px-3 py-1.5 transition-colors flex-shrink-0"
        >
          Send
        </button>
      </div>
    </aside>
  )
}
