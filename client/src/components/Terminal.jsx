import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// Terminal wraps xterm.js and connects it to the shared WebSocket.
//
// Props:
//   wsRef   — ref to the live WebSocket (shared with App)
//   onReady — called with { write, fit } imperative handles so App can
//             forward TERMINAL_OUTPUT data and trigger re-fit on resize
export default function Terminal({ wsRef, onReady }) {
  const containerRef = useRef(null)

  useEffect(() => {
    const term = new XTerm({
      theme: {
        background:         '#030712',
        foreground:         '#d1d5db',
        cursor:             '#10b981',
        cursorAccent:       '#030712',
        selectionBackground: '#374151',
        black:   '#1f2937', brightBlack:   '#4b5563',
        red:     '#f87171', brightRed:     '#ef4444',
        green:   '#34d399', brightGreen:   '#10b981',
        yellow:  '#fbbf24', brightYellow:  '#f59e0b',
        blue:    '#60a5fa', brightBlue:    '#3b82f6',
        magenta: '#c084fc', brightMagenta: '#a855f7',
        cyan:    '#22d3ee', brightCyan:    '#06b6d4',
        white:   '#d1d5db', brightWhite:   '#f9fafb',
      },
      fontFamily:  '"JetBrains Mono", "Cascadia Code", ui-monospace, monospace',
      fontSize:    13,
      lineHeight:  1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      convertEol:  true,
      scrollback:  5000,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)

    // Focus the terminal so the user can type immediately.
    // Without this, xterm's hidden textarea won't capture keyboard events.
    term.focus()

    // Small delay so the DOM is fully laid out before fitting.
    requestAnimationFrame(() => { fitAddon.fit(); term.focus() })

    // Send user keystrokes to the server as TERMINAL_INPUT messages.
    term.onData(data => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'TERMINAL_INPUT', data }))
      }
    })

    // Expose write + fit + focus handles to App.jsx
    onReady?.({
      write: (data) => term.write(data),
      fit:   ()     => { try { fitAddon.fit() } catch (_) {} },
      focus: ()     => term.focus(),
    })

    // Re-fit whenever the container is resized (panel drag, window resize, etc.)
    const ro = new ResizeObserver(() => {
      try { fitAddon.fit() } catch (_) {}
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      term.dispose()
    }
  }, []) // mount once

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden"
      style={{ padding: '4px 8px', cursor: 'text' }}
    />
  )
}
