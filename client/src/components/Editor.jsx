import { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Annotation, StateField, StateEffect } from '@codemirror/state'
import { keymap, Decoration, WidgetType } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'

const CURSOR_COLORS = [
  '#6366f1', // indigo-500
  '#10b981', // emerald-500
  '#f43f5e', // rose-500
  '#f59e0b', // amber-500
  '#0ea5e9', // sky-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
]

function colorForUser(userId) {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) & 0xffffffff
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length]
}

// CodeMirror renders this as an inline element at the cursor's character offset
// draws a thin colored vertical bar (the caret) and a name label above it
class RemoteCursorWidget extends WidgetType {
  constructor(userId, color) {
    super()
    this.userId = userId
    this.color  = color
  }

  toDOM() {
    const wrap = document.createElement('span')
    wrap.setAttribute('aria-hidden', 'true')
    wrap.style.cssText = `
      display: inline-block;
      width: 2px;
      height: 1em;
      background: ${this.color};
      vertical-align: text-bottom;
      position: relative;
      margin-left: -1px;
      pointer-events: none;
    `

    // username label — hidden by default, visible on hover
    const label = document.createElement('span')
    label.textContent = this.userId
    label.style.cssText = `
      position: absolute;
      bottom: 100%; left: 0;
      background: ${this.color};
      color: #fff;
      font-size: 11px;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-weight: 500;
      padding: 1px 5px;
      border-radius: 3px 3px 3px 0;
      white-space: nowrap;
      pointer-events: none;
      user-select: none;
      line-height: 1.6;
      opacity: 0;
      transition: opacity 0.1s ease;
    `

    wrap.addEventListener('mouseenter', () => { label.style.opacity = '1' })
    wrap.addEventListener('mouseleave', () => { label.style.opacity = '0' })

    // allow pointer events on the wrap so hover is detectable
    wrap.style.pointerEvents = 'auto'

    wrap.appendChild(label)
    return wrap
  }

  eq(other) {
    return this.userId === other.userId && this.color === other.color
  }

  ignoreEvent() { return true }
}

// StateEffect is how you push external data into CodeMirror's state machine
// StateField stores the current map of userId -> character offset and derives
// the DecorationSet (the actual rendered widgets) from it

const setCursorEffect    = StateEffect.define() // payload: { userId, pos }
const removeCursorEffect = StateEffect.define() // payload: userId string

const remoteCursorField = StateField.define({
  create: () => new Map(),

  update(cursors, tr) {
    let next = cursors

    // when the document changes, map every stored character offset through the
    // change set so cursors stay anchored to the right position even after
    // insertions or deletions happen before them
    if (tr.docChanged) {
      next = new Map()
      for (const [userId, pos] of cursors) {
        next.set(userId, tr.changes.mapPos(pos))
      }
    }

    // apply any cursor effects dispatched from App.jsx
    if (tr.effects.length > 0) {
      if (next === cursors) next = new Map(cursors)
      for (const effect of tr.effects) {
        if (effect.is(setCursorEffect)) {
          next.set(effect.value.userId, effect.value.pos)
        } else if (effect.is(removeCursorEffect)) {
          next.delete(effect.value)
        }
      }
    }

    return next
  },

  // CodeMirror calls this whenever the field value changes and uses the result
  // to paint the widgets into the editor DOM
  provide: field => EditorView.decorations.from(field, cursors => {
    const specs = []
    for (const [userId, pos] of cursors) {
      specs.push(
        Decoration.widget({
          widget: new RemoteCursorWidget(userId, colorForUser(userId)),
          side: 1, // render the widget just after the character at `pos`
        }).range(pos)
      )
    }
    if (!specs.length) return Decoration.none
    // DecorationSet requires specs sorted by position
    return Decoration.set(specs.sort((a, b) => a.from - b.from))
  }),
})

// Attached to every dispatch triggered by a server EDIT/SYNC so the update
// listener can distinguish remote changes from local keystrokes and not
// re-broadcast them (which would create an infinite echo loop).
const RemoteAnnotation = Annotation.define()

export default function Editor({ onLocalChange, onCursorMove, onReady }) {
  const containerRef = useRef(null)

  // Stable refs so the EditorView closure created on mount always calls the
  // latest prop values without needing to reconstruct the editor.
  const onLocalChangeRef = useRef(onLocalChange)
  const onCursorMoveRef  = useRef(onCursorMove)
  useEffect(() => { onLocalChangeRef.current = onLocalChange }, [onLocalChange])
  useEffect(() => { onCursorMoveRef.current  = onCursorMove  }, [onCursorMove])

  useEffect(() => {
    const view = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          javascript(),
          oneDark,
          remoteCursorField,

          EditorView.theme({
            '&':            { height: '100%', fontSize: '14px' },
            '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, monospace' },
          }),

          EditorView.updateListener.of(update => {
            // ── Local document change → send EDIT to server ──
            if (update.docChanged) {
              const isRemote = update.transactions.some(tr => tr.annotation(RemoteAnnotation))
              if (!isRemote) {
                onLocalChangeRef.current?.(update.state.doc.toString())
              }
            }

            // Cursor / selection moved -> send CURSOR to server ──
            // We send the raw character offset (head) so the receiving client
            // can place the widget at the exact position, not just the line start.
            if (update.selectionSet) {
              const pos = update.state.selection.main.head
              onCursorMoveRef.current?.(pos)
            }
          }),
        ],
      }),
      parent: containerRef.current,
    })

    // Pass three functions up to App.jsx via onReady so it can push remote
    // updates into the editor without going through React state (which would
    // cause unnecessary re-renders and lose CodeMirror's internal state)
    onReady?.({
      // apply a full document replacement from a remote EDIT or SYNC.
      applyEdit: (newContent) => {
        if (view.state.doc.toString() === newContent) return
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: newContent },
          annotations: RemoteAnnotation.of(true),
        })
      },

      // render another user's cursor at the given character offset
      applyCursor: (userId, pos) => {
        const clamped = Math.max(0, Math.min(pos, view.state.doc.length))
        view.dispatch({ effects: setCursorEffect.of({ userId, pos: clamped }) })
      },

      // remove a user's cursor widget when they leave the room
      removeCursor: (userId) => {
        view.dispatch({ effects: removeCursorEffect.of(userId) })
      },
    })

    return () => view.destroy()
  }, []) // mount once

  return <div ref={containerRef} className="h-full overflow-hidden" />
}
