import { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Annotation, StateField, StateEffect, RangeSetBuilder, Compartment } from '@codemirror/state'
import { keymap, Decoration, WidgetType, gutter, GutterMarker } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { python }     from '@codemirror/lang-python'
import { java }       from '@codemirror/lang-java'
import { oneDark }    from '@codemirror/theme-one-dark'

// ── Language switching ────────────────────────────────────────────────────
// Compartment lets us hot-swap the language extension without rebuilding the
// entire editor state.  App.jsx calls setLanguage() via the onReady handle.

const languageConf = new Compartment()

function getLanguageExtension(lang) {
  if (lang === 'python') return python()
  if (lang === 'java')   return java()
  return javascript()  // default
}

// ── Shared helpers ────────────────────────────────────────────────────────

const CURSOR_COLORS = [
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
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length]
}

function severityColor(severity) {
  if (severity === 'critical') return '#ef4444'
  if (severity === 'warning')  return '#f59e0b'
  return '#3b82f6' // info
}

// ── Apply-fix bridge ──────────────────────────────────────────────────────
// The gutter marker's DOM is created at module scope (outside any component),
// so it cannot close over the EditorView instance directly.  We keep a
// module-level reference to the active view's apply-fix function and update
// it whenever the editor mounts or unmounts.  This is safe because only one
// Editor instance is active at a time in this application.
let _applyFixFn = null

// ── Remote cursor infrastructure ──────────────────────────────────────────

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

const setCursorEffect    = StateEffect.define()
const removeCursorEffect = StateEffect.define()

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

// ── AI comment gutter ─────────────────────────────────────────────────────

const addCommentEffect    = StateEffect.define()
const clearCommentsEffect = StateEffect.define()

// commentField stores Map<lineNum, Array<{text, severity, category, fix}>>
const commentField = StateField.define({
  create: () => new Map(),

  update(map, tr) {
    let next = map
    for (const e of tr.effects) {
      if (e.is(addCommentEffect)) {
        if (next === map) next = new Map(map)
        const { line, text, severity, category, fix } = e.value
        const existing = next.get(line) ?? []
        next.set(line, [...existing, { text, severity, category, fix: fix ?? null }])
      } else if (e.is(clearCommentsEffect)) {
        next = new Map()
      }
    }
    return next
  },
})

class CommentGutterMarker extends GutterMarker {
  // lineNum is the 1-based document line number, needed so the Apply Fix
  // button knows which line to replace when it calls _applyFixFn.
  constructor(comments, lineNum) {
    super()
    this.comments = comments
    this.lineNum  = lineNum
  }

  eq(other) {
    return (
      this.lineNum === other.lineNum &&
      this.comments.length === other.comments.length &&
      this.comments.every((c, i) =>
        c.text === other.comments[i].text && c.severity === other.comments[i].severity
      )
    )
  }

  toDOM() {
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

      // ── severity + category badges ──────────────────────────────────────
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

      // ── comment text ────────────────────────────────────────────────────
      const text = document.createElement('div')
      text.textContent = c.text
      text.style.color = '#cbd5e1'

      popup.appendChild(header)
      popup.appendChild(text)

      // ── Apply Fix section (only when AI provided a single-line fix) ─────
      if (c.fix != null && c.fix.trim() !== '') {
        const fixSection = document.createElement('div')
        fixSection.style.cssText = 'margin-top:8px;'

        const fixLabel = document.createElement('div')
        fixLabel.textContent = 'Suggested fix:'
        fixLabel.style.cssText =
          'font-size:10px;color:#64748b;text-transform:uppercase;' +
          'letter-spacing:0.05em;margin-bottom:3px;'

        // Show the fix code so the user knows what will be applied
        const fixCode = document.createElement('pre')
        fixCode.textContent = c.fix
        fixCode.style.cssText =
          'font-family:ui-monospace,monospace;font-size:11px;color:#7dd3fc;' +
          'background:#0f172a;padding:5px 8px;border-radius:4px;' +
          'margin:0 0 6px;overflow-x:auto;white-space:pre;' +
          'border:1px solid #1e3a5f;'

        const fixBtn = document.createElement('button')
        fixBtn.textContent = 'Apply Fix'
        fixBtn.style.cssText =
          'display:block;width:100%;background:#166534;color:#86efac;' +
          'border:1px solid #166534;border-radius:4px;padding:4px 8px;' +
          'font-size:11px;cursor:pointer;font-family:inherit;text-align:center;'

        fixBtn.addEventListener('mouseenter', () => { fixBtn.style.background = '#15803d' })
        fixBtn.addEventListener('mouseleave', () => { fixBtn.style.background = '#166534' })

        // Capture loop variables so the closure is correct across iterations.
        const capturedLine = this.lineNum
        const capturedFix  = c.fix
        fixBtn.addEventListener('click', (e) => {
          e.stopPropagation()           // don't bubble to the dot-toggle listener
          _applyFixFn?.(capturedLine, capturedFix)
          popup.style.display = 'none'
          open = false                  // eslint-disable-line no-use-before-define
        })

        fixSection.appendChild(fixLabel)
        fixSection.appendChild(fixCode)
        fixSection.appendChild(fixBtn)
        popup.appendChild(fixSection)
      }
    })

    let open = false
    wrap.addEventListener('click', e => {
      e.stopPropagation()
      open = !open
      popup.style.display = open ? 'block' : 'none'
      if (open) {
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

const commentGutter = gutter({
  class: 'cm-ai-comment-gutter',
  markers(view) {
    const map = view.state.field(commentField)
    const builder = new RangeSetBuilder()
    const sortedLines = [...map.keys()].sort((a, b) => a - b)
    for (const lineNum of sortedLines) {
      try {
        const docLine = view.state.doc.line(Math.min(lineNum, view.state.doc.lines))
        // Pass lineNum so the Apply Fix button knows which line to replace.
        builder.add(docLine.from, docLine.from, new CommentGutterMarker(map.get(lineNum), lineNum))
      } catch (_) {
        // lineNum out of range after document edits — skip
      }
    }
    return builder.finish()
  },
})

// ── Editor component ──────────────────────────────────────────────────────

export default function Editor({ onLocalChange, onCursorMove, onReady, initialLanguage = 'javascript' }) {
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
          languageConf.of(getLanguageExtension(initialLanguage)),
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
            if (update.docChanged) {
              const isRemote = update.transactions.some(tr => tr.annotation(RemoteAnnotation))
              if (!isRemote) onLocalChangeRef.current?.(update.state.doc.toString())
            }
            if (update.selectionSet) {
              onCursorMoveRef.current?.(update.state.selection.main.head)
            }
          }),
        ],
      }),
      parent: containerRef.current,
    })

    // Wire up the module-level apply-fix bridge so gutter buttons can dispatch
    // edits to this view without needing a direct closure.
    _applyFixFn = (lineNum, fixText) => {
      try {
        const line = view.state.doc.line(
          Math.max(1, Math.min(lineNum, view.state.doc.lines))
        )
        // Dispatch WITHOUT RemoteAnnotation so the updateListener treats this
        // as a local change and calls onLocalChange → sends EDIT to the server
        // → server broadcasts to all other clients.
        view.dispatch({ changes: { from: line.from, to: line.to, insert: fixText } })
      } catch (e) {
        console.error('[applyFix] Failed to apply fix at line', lineNum, e)
      }
    }

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
      addComment: (line, text, severity, category, fix = null) => {
        view.dispatch({ effects: addCommentEffect.of({ line, text, severity, category, fix }) })
      },
      clearComments: () => {
        view.dispatch({ effects: clearCommentsEffect.of(null) })
      },
      // Dynamically reconfigure the language extension via the Compartment.
      setLanguage: (lang) => {
        view.dispatch({
          effects: languageConf.reconfigure(getLanguageExtension(lang))
        })
      },
    })

    return () => {
      _applyFixFn = null   // prevent stale view reference between StrictMode cycles
      view.destroy()
    }
  }, []) // mount once — all updates go through imperative handles

  return <div ref={containerRef} className="h-full overflow-hidden" />
}
