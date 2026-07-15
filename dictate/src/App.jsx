import { useEffect, useRef, useState, useCallback } from 'react'
import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import { openDeepgram, closeDeepgram } from './deepgram.js'

const CONTAINER_ID = 1
const CONTAINER_NAME = 'dictate-display'
const STORAGE_KEY = 'dictate.deepgramKey'
const BALL_FLASH_MS = 500

function buildBall(visible) {
  const content = visible ? '●' : ' '
  return new TextContainerProperty({
    xPosition: 4,
    yPosition: 4,
    width: 40,
    height: 32,
    containerID: CONTAINER_ID,
    containerName: CONTAINER_NAME,
    content,
    isEventCapture: 1,
  })
}

export function App() {
  const [ready, setReady] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [running, setRunning] = useState(false)
  const [wsState, setWsState] = useState('idle')
  const [finalText, setFinalText] = useState('')
  const [interim, setInterim] = useState('')
  const [bytesSent, setBytesSent] = useState(0)
  const [lastError, setLastError] = useState(null)
  const [eventCount, setEventCount] = useState(0)
  const [lastEvent, setLastEvent] = useState(null)

  const bridgeRef = useRef(null)
  const wsRef = useRef(null)
  const handlerRef = useRef({ running: false, wsState: 'idle', start: null, stop: null })

  const handleTranscript = useCallback((msg) => {
    if (msg.type !== 'Results') return
    const alt = msg?.channel?.alternatives?.[0]
    const text = alt?.transcript ?? ''
    if (!text) return
    if (msg.is_final) {
      setFinalText((prev) => (prev ? prev + ' ' + text : text))
      setInterim('')
    } else {
      setInterim(text)
    }
  }, [])

  const stop = useCallback(async () => {
    setRunning(false)
    if (bridgeRef.current) {
      try { await bridgeRef.current.audioControl(false) } catch {}
    }
    if (wsRef.current) {
      closeDeepgram(wsRef.current)
      wsRef.current = null
    }
    setWsState('closed')
    setInterim('')
  }, [])

  const start = useCallback(async () => {
    if (!apiKey || !bridgeRef.current) return
    setFinalText('')
    setInterim('')
    setBytesSent(0)
    setLastError(null)
    setWsState('connecting')
    try {
      const ws = await openDeepgram(apiKey, {
        onTranscript: handleTranscript,
        onError: (e) => setLastError(`ws error: ${e?.message ?? e}`),
        onClose: (e) => setWsState(e?.wasClean ? 'closed' : 'error'),
      })
      wsRef.current = ws
      setWsState('open')

      const ok = await bridgeRef.current.audioControl(true)
      if (ok === false) throw new Error('audioControl(true) returned false')
      setRunning(true)
    } catch (e) {
      setLastError(String(e?.message ?? e))
      setWsState('error')
      await stop()
    }
  }, [apiKey, handleTranscript, stop])

  handlerRef.current = { running, wsState, start, stop }

  const saveKey = useCallback(async (value) => {
    setApiKey(value)
    if (!bridgeRef.current) return
    try {
      await bridgeRef.current.setLocalStorage(STORAGE_KEY, value)
    } catch (e) {
      setLastError(`save key: ${e}`)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let unsub
    ;(async () => {
      const bridge = await waitForEvenAppBridge()
      if (cancelled) return
      bridgeRef.current = bridge

      await bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({
          containerTotalNum: 1,
          textObject: [buildBall(false)],
        }),
      )

      let storedKey = ''
      try { storedKey = (await bridge.getLocalStorage(STORAGE_KEY)) || '' } catch {}
      const envKey = import.meta.env.VITE_DEEPGRAM_KEY || ''
      if (storedKey) setApiKey(storedKey)
      else if (envKey) setApiKey(envKey)

      unsub = bridge.onEvenHubEvent((event) => {
        const pcm = event.audioEvent?.audioPcm
        if (pcm) {
          const sock = wsRef.current
          if (sock && sock.readyState === WebSocket.OPEN) {
            sock.send(pcm)
            setBytesSent((b) => b + pcm.length)
          }
          return
        }
        const kind = event.textEvent ? 'textEvent'
          : event.listEvent ? 'listEvent'
          : event.sysEvent ? 'sysEvent'
          : 'unknown'
        const t =
          event.textEvent?.eventType ??
          event.listEvent?.eventType ??
          event.sysEvent?.eventType
        setEventCount((c) => c + 1)
        setLastEvent({ kind, eventType: t, json: event.jsonData ?? event })
        const isTap = t === OsEventTypeList.CLICK_EVENT || t === undefined
        if (isTap) {
          const h = handlerRef.current
          if (h.running) {
            h.stop?.()
          } else if (h.wsState !== 'connecting') {
            h.start?.()
          }
        }
      })

      setReady(true)
    })()
    return () => {
      cancelled = true
      if (unsub) unsub()
      if (wsRef.current) closeDeepgram(wsRef.current)
    }
  }, [])

  useEffect(() => {
    const bridge = bridgeRef.current
    if (!bridge || !ready) return

    const render = (visible) => {
      bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: 1,
          textObject: [buildBall(visible)],
        }),
      ).catch(() => {})
    }

    if (!running) {
      render(false)
      return
    }

    let visible = true
    render(true)
    const id = setInterval(() => {
      visible = !visible
      render(visible)
    }, BALL_FLASH_MS)
    return () => clearInterval(id)
  }, [ready, running])

  const wsTag = {
    idle: <span className="tag idle">idle</span>,
    connecting: <span className="tag live">connecting…</span>,
    open: <span className="tag ok">open</span>,
    closed: <span className="tag idle">closed</span>,
    error: <span className="tag err">error</span>,
  }[wsState]

  return (
    <main>
      <h1>Dictate</h1>
      <p className="sub">
        Bridge {ready ? <span className="tag ok">ready</span> : <span className="tag idle">waiting…</span>}
        {' · '}Deepgram {wsTag}
        {' · '}mic {running ? <span className="tag ok">on</span> : <span className="tag idle">off</span>}
        {' — tap the glasses pad to toggle.'}
      </p>

      <div className="row">
        <input
          type={showKey ? 'text' : 'password'}
          value={apiKey}
          placeholder="Deepgram API key"
          onChange={(e) => saveKey(e.target.value)}
          disabled={running}
        />
        <button onClick={() => setShowKey((s) => !s)}>{showKey ? 'Hide' : 'Show'}</button>
      </div>

      <div className="row">
        {!running ? (
          <button className="primary" onClick={start} disabled={!ready || !apiKey}>
            Start dictation
          </button>
        ) : (
          <button className="stop" onClick={stop}>Stop</button>
        )}
        <button onClick={() => { setFinalText(''); setInterim('') }} disabled={running}>
          Clear transcript
        </button>
      </div>

      {lastError && <p className="err">{lastError}</p>}

      <div className="transcript">
        {finalText}
        {interim && <span className="interim"> {interim}</span>}
        {!finalText && !interim && <span className="sub">(transcript will appear here)</span>}
      </div>

      <div className="diag">
        <div><span className="k">ws state</span><span>{wsState}</span></div>
        <div><span className="k">bytes sent</span><span>{bytesSent.toLocaleString()}</span></div>
        <div><span className="k">final chars</span><span>{finalText.length}</span></div>
        <div><span className="k">interim chars</span><span>{interim.length}</span></div>
        <div><span className="k">events received</span><span>{eventCount}</span></div>
        <div><span className="k">last event</span><span>{lastEvent ? `${lastEvent.kind} et=${lastEvent.eventType ?? 'none'}` : '—'}</span></div>
      </div>
      {lastEvent && (
        <pre className="diag" style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>
{JSON.stringify(lastEvent.json, null, 2)}
        </pre>
      )}
    </main>
  )
}
