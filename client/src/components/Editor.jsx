import { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Annotation } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'

// This annotation is attached to every transaction that originates from a
// remote EDIT or SYNC message.  The update listener checks for it and skips
// sending the change back to the server, preventing an infinite echo loop:
//
//   Local keystroke → onChange → server → broadcastExcept → peers apply with
//   RemoteAnnotation → update listener sees annotation → does NOT call onChange
//
// Without this guard every applied remote edit would itself look like a local
// edit and get re-broadcast, bouncing between all clients forever.
const RemoteAnnotation = Annotation.define()

export default function Editor({ onLocalChange, onReady }) {
  const containerRef = useRef(null)

  // Keep a stable ref to the onLocalChange callback so the EditorView closure
  // created on mount always calls the latest version without needing to
  // reconstruct the entire editor when the prop changes.
  const onLocalChangeRef = useRef(onLocalChange)
  useEffect(() => { onLocalChangeRef.current = onLocalChange }, [onLocalChange])

  useEffect(() => {
    const view = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          javascript(),
          oneDark,

          // Make the editor fill the parent container vertically.
          EditorView.theme({
            '&':           { height: '100%', fontSize: '14px' },
            '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, monospace' },
          }),

          // The update listener fires on every transaction (keystrokes,
          // remote patches, cursor moves, etc.).  We only care about doc changes
          // that were NOT caused by a remote edit.
          EditorView.updateListener.of(update => {
            if (!update.docChanged) return
            const isRemote = update.transactions.some(tr => tr.annotation(RemoteAnnotation))
            if (isRemote) return
            // Local edit — send full document text to server.
            onLocalChangeRef.current?.(update.state.doc.toString())
          }),
        ],
      }),
      parent: containerRef.current,
    })

    // Expose a function that App.jsx can call to apply a remote document update.
    // We pass it up via the onReady callback so App doesn't need to reach into
    // the editor's internals directly.
    onReady?.((newContent) => {
      const current = view.state.doc.toString()
      if (current === newContent) return   // nothing changed, skip the dispatch
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: newContent },
        annotations: RemoteAnnotation.of(true),  // mark as remote so listener ignores it
      })
    })

    return () => view.destroy()
  }, []) // mount once — the view manages its own internal state after that

  return (
    <div ref={containerRef} className="h-full overflow-hidden" />
  )
}
