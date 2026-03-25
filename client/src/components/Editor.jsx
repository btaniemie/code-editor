import { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Annotation, StateField, StateEffect, RangeSetBuilder } from '@codemirror/state'
import { keymap, Decoration, WidgetType, gutter, GutterMarker } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'

// ── Shared helpers ────────────────────────────────────────────────────────

const CURSOR_COLORS = [
  '#6366f1', '#10b981', '#f43f5e', '#f59e0b',
  '#0ea5e9', '#8b5cf6', '#ec4899', '#14b8a6',
]

function colorForUser(userId) {
  let hash = 0
  for (let i = 0; i < userId.length; i++)
    hash = (hash * 31 + userId.charCodeAt(i)) & 0xffffffff
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length]
}

function severityColor(severity) {
  if (severity === 'critical') return '#ef4444'
  if (severity === 'warning')  return '#f59e0b'
  return '#3b82f6' // info
}

// ── Remote cursor infrastructure (Phase 1, unchanged) ────────────────────

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
      display: inline-block; width: 2px; height: 1em;
      background: ${this.color}; vertical-align: text-bottom;
      position: relative; margin-left: -1px; pointer-events: auto;
    `
    const label = document.createElement('span')
    label.textContent = this.userId
    label.style.cssText = `
      position: absolute; bottom: 100%; left: 0;
      background: ${this.color}; color: #fff;
      font-size: 11px; font-family: ui-sans-serif, system-ui, sans-serif;
      font-weight: 500; padding: 1px 5px; border-radius: 3px 3px 3px 0;
      white-space: nowrap; pointer-events: none; user-select: none;
      line-height: 1.6; opacity: 0; transition: opacity 0.1s ease;
    `
    wrap.addEventListener('mouseenter', () => { label.style.opacity = '1' })
    wrap.addEventListener('mouseleave', () => { label.style.opacity = '0' })
    wrap.appendChild(label)
    return wrap
  }

  eq(other) { return this.userId === other.userId && this.color === other.color }
  ignoreEvent() { return true }
}

const setCursorEffect    = StateEffect.define() // payload: { userId, pos }
const removeCursorEffect = StateEffect.define() // payload: userId string

const remoteCursorField = StateField.define({
  create: () => new Map(),

  update(cursors, tr) {
    let next = cursors
    if (tr.docChanged) {
      next = new Map()
      for (const [userId, pos] of cursors)
        next.set(userId, tr.changes.mapPos(pos))
    }
    if (tr.effects.length > 0) {
      if (next === cursors) next = new Map(cursors)
      for (const e of tr.effects) {
        if (e.is(setCursorEffect))         next.set(e.value.userId, e.value.pos)
        else if (e.is(removeCursorEffect)) next.delete(e.value)
      }
    }
    return next
  },

  provide: field => EditorView.decorations.from(field, cursors => {
    const specs = []
    for (const [userId, pos] of cursors)
      specs.push(Decoration.widget({
        widget: new RemoteCursorWidget(userId, colorForUser(userId)),
        side: 1,
      }).range(pos))
    if (!specs.length) return Decoration.none
    return Decoration.set(specs.sort((a, b) => a.from - b.from))
  }),
})

const RemoteAnnotation = Annotation.define()

// ── AI comment gutter (Phase 2) ───────────────────────────────────────────
//
// StateField holds a Map<lineNumber (1-based), Comment[]>.
// A custom gutter extension reads this field on every update and renders
// a colored dot on lines that have comments.  Clicking a dot opens an
// inline popup with the full text, severity, and category for that line.

const addCommentEffect    = StateEffect.define() // payload: { line, text, severity, category }
const clearCommentsEffect = StateEffect.define()

// commentField stores comment data keyed by 1-based line number.
// It does NOT remap positions on document changes — comments are anchored
// to the line they were generated for.
const commentField = StateField.define({
  create: () => new Map(),

  update(map, tr) {
    let next = map
    for (const e of tr.effects) {
      if (e.is(addCommentEffect)) {
        if (next === map) next = new Map(map)
        const { line, text, severity, category } = e.value
        const existing = next.get(line) ?? []
        next.set(line, [...existing, { text, severity, category }])
      } else if (e.is(clearCommentsEffect)) {
        next = new Map()
      }
    }
    return next
  },
})

// CommentGutterMarker renders a severity-colored dot in the gutter.
// Clicking opens a popup with full comment details (text + badges).
class CommentGutterMarker extends GutterMarker {
  constructor(comments) {
    super()
    this.comments = comments
  }

  eq(other) {
    return (
      this.comments.length === other.comments.length &&
      this.comments.every((c, i) =>
        c.text === other.comments[i].text && c.severity === other.comments[i].severity
      )
    )
  }

  toDOM() {
    // Dominant severity determines the dot color
    const rank = { critical: 2, warning: 1, info: 0 }
    const dominant = this.comments.reduce((a, b) =>
      (rank[b.severity] ?? 0) > (rank[a.severity] ?? 0) ? b : a
    )
    const dotColor = severityColor(dominant.severity)

    const wrap = document.createElement('div')
    wrap.style.cssText =
      'position:relative;display:flex;align-items:center;justify-content:center;' +
      'width:100%;height:100%;cursor:pointer;'

    const dot = document.createElement('div')
    dot.style.cssText =
      `width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0;`

    // Popup (hidden until dot is clicked)
    const popup = document.createElement('div')
    popup.style.cssText =
      `display:none;position:absolute;left:22px;top:0;z-index:200;` +
      `background:#1e293b;border:1px solid ${dotColor}44;border-radius:6px;` +
      `padding:10px 12px;min-width:240px;max-width:340px;` +
      `box-shadow:0 4px 16px rgba(0,0,0,.5);` +
      `font-family:ui-sans-serif,system-ui,sans-serif;font-size:12px;` +
      `color:#e2e8f0;line-height:1.5;`

    this.comments.forEach((c, i) => {
      if (i > 0) {
        const sep = document.createElement('div')
        sep.style.cssText = 'border-top:1px solid #334155;margin:8px 0;'
        popup.appendChild(sep)
      }

      const header = document.createElement('div')
      header.style.cssText = 'display:flex;gap:5px;margin-bottom:5px;'

      const sev = document.createElement('span')
      sev.textContent = c.severity
      const sc = severityColor(c.severity)
      sev.style.cssText =
        `background:${sc}22;color:${sc};border:1px solid ${sc}55;` +
        `border-radius:3px;padding:0 5px;` +
        `font-size:10px;font-weight:700;text-transform:uppercase;` +
        `letter-spacing:.05em;line-height:1.8;`

      const cat = document.createElement('span')
      cat.textContent = c.category
      cat.style.cssText =
        'background:#334155;color:#94a3b8;border-radius:3px;' +
        'padding:0 5px;font-size:10px;font-weight:500;line-height:1.8;'

      header.appendChild(sev)
      header.appendChild(cat)

      const text = document.createElement('div')
      text.textContent = c.text
      text.style.color = '#cbd5e1'

      popup.appendChild(header)
      popup.appendChild(text)
    })

    let open = false
    wrap.addEventListener('click', e => {
      e.stopPropagation()
      open = !open
      popup.style.display = open ? 'block' : 'none'
      if (open) {
        // Auto-close when anything else is clicked.
        // { once: true } prevents listener accumulation.
        document.addEventListener('click', () => {
          open = false
          popup.style.display = 'none'
        }, { once: true })
      }
    })

    wrap.appendChild(dot)
    wrap.appendChild(popup)
    return wrap
  }
}

// commentGutter reads commentField and builds a RangeSet<GutterMarker>
// sorted by document position so CodeMirror can efficiently render the column.
const commentGutter = gutter({
  class: 'cm-ai-comment-gutter',
  markers(view) {
    const map = view.state.field(commentField)
    const builder = new RangeSetBuilder()
    const sortedLines = [...map.keys()].sort((a, b) => a - b)
    for (const lineNum of sortedLines) {
      try {
        const docLine = view.state.doc.line(Math.min(lineNum, view.state.doc.lines))
        builder.add(docLine.from, docLine.from, new CommentGutterMarker(map.get(lineNum)))
      } catch (_) {
        // lineNum out of range after document edits — silently skip
      }
    }
    return builder.finish()
  },
})

// ── Editor component ──────────────────────────────────────────────────────

export default function Editor({ onLocalChange, onCursorMove, onReady }) {
  const containerRef     = useRef(null)
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
          commentField,
          commentGutter,

          EditorView.theme({
            '&':                     { height: '100%', fontSize: '14px' },
            '.cm-scroller':          { overflow: 'auto', fontFamily: 'ui-monospace, monospace' },
            '.cm-ai-comment-gutter': { width: '20px' },
          }),

          EditorView.updateListener.of(update => {
            // Local document change → broadcast EDIT
            if (update.docChanged) {
              const isRemote = update.transactions.some(tr => tr.annotation(RemoteAnnotation))
              if (!isRemote) onLocalChangeRef.current?.(update.state.doc.toString())
            }
            // Cursor move → broadcast CURSOR
            if (update.selectionSet) {
              onCursorMoveRef.current?.(update.state.selection.main.head)
            }
          }),
        ],
      }),
      parent: containerRef.current,
    })

    // Expose imperative handles to App.jsx via onReady so remote updates
    // can be pushed into CodeMirror without going through React state.
    onReady?.({
      applyEdit: (newContent) => {
        if (view.state.doc.toString() === newContent) return
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: newContent },
          annotations: RemoteAnnotation.of(true),
        })
      },
      applyCursor: (userId, pos) => {
        const clamped = Math.max(0, Math.min(pos, view.state.doc.length))
        view.dispatch({ effects: setCursorEffect.of({ userId, pos: clamped }) })
      },
      removeCursor: (userId) => {
        view.dispatch({ effects: removeCursorEffect.of(userId) })
      },
      // Phase 2 handles — called by App when AI_COMMENT / REVIEW_START arrive
      addComment: (line, text, severity, category) => {
        view.dispatch({ effects: addCommentEffect.of({ line, text, severity, category }) })
      },
      clearComments: () => {
        view.dispatch({ effects: clearCommentsEffect.of(null) })
      },
    })

    return () => view.destroy()
  }, []) // mount once — editor is imperative, not re-created on prop changes

  return <div ref={containerRef} className="h-full overflow-hidden" />
}
