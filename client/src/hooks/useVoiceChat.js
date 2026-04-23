import { useRef, useState, useCallback, useEffect } from 'react'

/**
 * useVoiceChat — manages the full voice chat lifecycle:
 *   - Capture: getUserMedia → MediaRecorder → 100 ms binary chunks → WebSocket
 *   - Protocol: each binary frame is prefixed with a 1-byte userId length header
 *              so the receiver can identify the speaker without JSON overhead.
 *              Layout: [uint8: userIdLen][userIdLen bytes: userId UTF-8][audio data]
 *   - Playback: MediaSource Extensions (MSE) per speaker so the browser can
 *              stream-decode the WebM/Ogg chunks in order as they arrive over TCP.
 *
 * @param {React.MutableRefObject<WebSocket>} wsRef  shared WebSocket ref from App
 */
export function useVoiceChat(wsRef) {
  const [isSpeaking,    setIsSpeaking]    = useState(false)
  const [speakingUsers, setSpeakingUsers] = useState({})   // { userId: bool }
  const [micAvailable,  setMicAvailable]  = useState(null) // null=unknown

  const mediaRecorderRef = useRef(null)
  const streamRef        = useRef(null)

  // One MSE player per remote speaker.
  // Map<userId, { audio, mediaSource, sourceBuffer, pendingQueue }>
  const playersRef = useRef(new Map())

  // ── Playback (Consumer) ────────────────────────────────────────────────────

  /**
   * Returns the existing MSE player for userId, or creates a new one.
   * We use MediaSource so the browser handles the incremental WebM/Ogg
   * decoding — each successive chunk appended to the SourceBuffer is
   * decoded and played without gaps.
   */
  function getOrCreatePlayer(userId) {
    if (playersRef.current.has(userId)) return playersRef.current.get(userId)

    const audio       = new Audio()
    audio.autoplay    = true
    const mediaSource = new MediaSource()
    audio.src         = URL.createObjectURL(mediaSource)

    const player = {
      audio,
      mediaSource,
      sourceBuffer:  null,
      pendingQueue:  [],   // buffers that arrived before sourceopen
    }
    playersRef.current.set(userId, player)

    mediaSource.addEventListener('sourceopen', () => {
      // Pick the MIME type that matches what the sender's MediaRecorder produces.
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/ogg;codecs=opus'

      const sb = mediaSource.addSourceBuffer(mime)
      player.sourceBuffer = sb

      // Drain the queue whenever a pending append finishes.
      sb.addEventListener('updateend', () => {
        if (player.pendingQueue.length > 0 && !sb.updating) {
          sb.appendBuffer(player.pendingQueue.shift())
        }
      })

      // Flush anything that arrived before sourceopen fired.
      if (player.pendingQueue.length > 0 && !sb.updating) {
        sb.appendBuffer(player.pendingQueue.shift())
      }
    })

    return player
  }

  /**
   * Decode the binary frame header, look up (or create) the speaker's MSE
   * player, and append the audio payload to its SourceBuffer.
   *
   * Called by App.jsx whenever a binary WebSocket message arrives.
   */
  const onBinaryMessage = useCallback((arrayBuffer) => {
    const bytes = new Uint8Array(arrayBuffer)
    if (bytes.length < 2) return

    const userIdLen = bytes[0]
    if (bytes.length < 1 + userIdLen + 1) return   // need at least 1 byte of audio

    const userId   = new TextDecoder().decode(bytes.slice(1, 1 + userIdLen))
    const audioBuf = arrayBuffer.slice(1 + userIdLen)

    const player = getOrCreatePlayer(userId)
    const sb     = player.sourceBuffer

    if (sb && !sb.updating) {
      sb.appendBuffer(audioBuf)
    } else {
      // sourceopen hasn't fired yet, or a previous append is still in progress.
      player.pendingQueue.push(audioBuf)
    }
  }, []) // stable — only touches playersRef (a ref)

  /**
   * Handle an incoming VOICE_STATUS JSON message.
   * Updates the speakingUsers map used by the UI.
   * When a user stops speaking we tear down their MSE player after a short
   * delay to let the SourceBuffer drain the last queued chunk.
   */
  const onVoiceStatus = useCallback(({ userId, speaking }) => {
    setSpeakingUsers(prev => ({ ...prev, [userId]: speaking }))

    if (!speaking) {
      setTimeout(() => {
        const player = playersRef.current.get(userId)
        if (!player) return
        try {
          if (player.mediaSource.readyState === 'open') {
            player.mediaSource.endOfStream()
          }
        } catch (_) { /* already closed */ }
        URL.revokeObjectURL(player.audio.src)
        player.audio.src = ''
        playersRef.current.delete(userId)
      }, 1500)
    }
  }, [])

  // ── Capture (Producer) ────────────────────────────────────────────────────

  /**
   * Request mic access and start recording.
   * Each ondataavailable event fires every 100 ms and yields one Blob.
   * We prepend our custom binary header (userId) and send the whole thing
   * as a WebSocket binary frame — a single ws.send() call per timeslice.
   */
  const startSpeaking = useCallback(async (userId) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    if (mediaRecorderRef.current) return  // already transmitting

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      streamRef.current = stream
      setMicAvailable(true)

      // Negotiate the same MIME type we expect on the playback side.
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
          ? 'audio/ogg;codecs=opus'
          : ''

      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      mediaRecorderRef.current = recorder

      // Pre-encode the userId bytes once — reused for every chunk.
      const userIdBytes = new TextEncoder().encode(userId)

      recorder.ondataavailable = async (e) => {
        if (e.data.size === 0) return
        const currentWs = wsRef.current
        if (!currentWs || currentWs.readyState !== WebSocket.OPEN) return

        const audioBytes = await e.data.arrayBuffer()

        // Build the framed binary packet.
        // [uint8: userIdLen] [userId UTF-8] [raw audio]
        const packet = new Uint8Array(1 + userIdBytes.byteLength + audioBytes.byteLength)
        packet[0] = userIdBytes.byteLength
        packet.set(userIdBytes, 1)
        packet.set(new Uint8Array(audioBytes), 1 + userIdBytes.byteLength)
        currentWs.send(packet.buffer)
      }

      recorder.start(100)  // 100 ms timeslices → ~10 packets/sec per speaker
      setIsSpeaking(true)
      ws.send(JSON.stringify({ type: 'VOICE_STATUS', userId, speaking: true }))
    } catch (err) {
      console.warn('[VoiceChat] Mic unavailable:', err)
      setMicAvailable(false)
    }
  }, [wsRef])

  /**
   * Stop recording, release the mic track, and notify other clients.
   */
  const stopSpeaking = useCallback((userId) => {
    const ws = wsRef.current

    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    mediaRecorderRef.current = null

    const stream = streamRef.current
    if (stream) stream.getTracks().forEach(t => t.stop())
    streamRef.current = null

    setIsSpeaking(false)

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'VOICE_STATUS', userId, speaking: false }))
    }
  }, [wsRef])

  /**
   * Full teardown — called on room leave or component unmount.
   * Does NOT send a VOICE_STATUS message (connection may already be closed).
   */
  const cleanup = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    mediaRecorderRef.current = null

    const stream = streamRef.current
    if (stream) stream.getTracks().forEach(t => t.stop())
    streamRef.current = null

    setIsSpeaking(false)
    setSpeakingUsers({})

    for (const [, player] of playersRef.current) {
      try { URL.revokeObjectURL(player.audio.src); player.audio.src = '' } catch (_) {}
    }
    playersRef.current.clear()
  }, [])

  // Release all resources when the component unmounts.
  useEffect(() => () => cleanup(), [cleanup])

  return {
    isSpeaking,
    speakingUsers,
    micAvailable,
    onBinaryMessage,
    onVoiceStatus,
    startSpeaking,
    stopSpeaking,
    cleanup,
  }
}
