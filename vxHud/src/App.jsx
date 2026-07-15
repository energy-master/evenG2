import { useEffect, useRef, useState, useCallback } from 'react'
import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import { openDeepgram, closeDeepgram } from './deepgram.js'
import { askOpenClaw, chunkText } from './openclaw.js'

const HEADING_ID = 1
const RESP1_ID = 2
const RESP2_ID = 3
const SPEED_ID = 4
const RESPONSE_CHARS = 40
const STORAGE_KEY = 'vxhud.deepgramKey'
const BALL_FLASH_MS = 500
const GPS_INTERVAL_MS = 500
const FIX_HISTORY_SIZE = 4
const MPS_TO_MPH = 2.23694
const MIN_DISTANCE_M = 1
const TAPE_COLS = 41
const TAPE_CENTER = 20

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const φ1 = toRad(lat1)
  const φ2 = toRad(lat2)
  const Δφ = toRad(lat2 - lat1)
  const Δλ = toRad(lon2 - lon1)
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180
  const φ1 = toRad(lat1)
  const φ2 = toRad(lat2)
  const Δλ = toRad(lon2 - lon1)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}

function fmtHeadingDeg(h) {
  const n = ((h % 360) + 360) % 360
  return `${n.toFixed(2).padStart(6, '0')}°`
}

function tapeChars(heading) {
  const iH = Math.round(heading)
  const chars = Array(TAPE_COLS).fill(' ')
  for (let c = 0; c < TAPE_COLS; c++) {
    const deg = (((iH + (c - TAPE_CENTER)) % 360) + 360) % 360
    if (deg % 10 === 0 && c >= 1 && c <= TAPE_COLS - 2) {
      const s = String(deg).padStart(3, '0')
      chars[c - 1] = s[0]
      chars[c] = s[1]
      chars[c + 1] = s[2]
    }
  }
  for (let c = 0; c < TAPE_COLS; c++) {
    if (chars[c] !== ' ') continue
    const deg = (((iH + (c - TAPE_CENTER)) % 360) + 360) % 360
    if (deg % 5 === 0) chars[c] = "'"
  }
  return chars.join('')
}

function buildHeading(ballVisible, heading) {
  const ball = ballVisible ? '●' : ' '
  let tape = ' '.repeat(TAPE_COLS)
  if (heading != null) {
    const chars = tapeChars(heading).split('')
    chars[TAPE_CENTER] = '▲'
    tape = chars.join('')
  }
  return new TextContainerProperty({
    xPosition: 4,
    yPosition: 8,
    width: 572,
    height: 32,
    containerID: HEADING_ID,
    containerName: 'vxhud-heading',
    content: `${ball}   ${tape}`,
    isEventCapture: 1,
  })
}

function buildResponseLine(id, name, y, content) {
  return new TextContainerProperty({
    xPosition: 4,
    yPosition: y,
    width: 572,
    height: 32,
    containerID: id,
    containerName: name,
    content: content || ' ',
    isEventCapture: 0,
  })
}

function pickStep(maxMph) {
  if (maxMph < 5) return 1
  if (maxMph < 15) return 2
  if (maxMph < 40) return 5
  if (maxMph < 100) return 10
  return 20
}

function formatSpeedLine(mph, step) {
  const iMph = Math.round(mph)
  const b1 = Math.floor((iMph - 1) / step) * step
  const a1 = Math.floor(iMph / step) * step + step
  const below = [b1, b1 - step, b1 - 2 * step, b1 - 3 * step]
  const above = [a1, a1 + step, a1 + 2 * step, a1 + 3 * step]
  const width = Math.max(2, String(Math.max(a1 + 3 * step, 0)).length)
  const fmt = (v) => (v >= 0 ? String(v).padStart(width, ' ') : ' '.repeat(width))
  const box = `[${iMph}]`
  const leftValues = below.slice().reverse().map(fmt).join('  ')
  const rightValues = above.map(fmt).join('  ')
  const left = `${leftValues} `
  const right = ` ${rightValues}`
  const leftPad = Math.max(0, TAPE_CENTER - Math.floor(box.length / 2) - left.length)
  return ' '.repeat(leftPad) + left + box + right
}

function buildSpeed(mph, step) {
  return new TextContainerProperty({
    xPosition: 4,
    yPosition: 248,
    width: 572,
    height: 32,
    containerID: SPEED_ID,
    containerName: 'vxhud-speed',
    content: formatSpeedLine(mph, step),
    isEventCapture: 0,
  })
}

function pageContainers({ ballVisible, heading, mph, maxMph, responseChunks, responsePage }) {
  const step = pickStep(maxMph)
  const total = responseChunks?.length ?? 0
  const maxPage = Math.max(0, total - 2)
  const idx = Math.min(Math.max(0, responsePage), maxPage)
  const line1 = responseChunks?.[idx] ?? ''
  const line2 = responseChunks?.[idx + 1] ?? ''
  return [
    buildHeading(ballVisible, heading),
    buildResponseLine(RESP1_ID, 'vxhud-resp1', 110, line1),
    buildResponseLine(RESP2_ID, 'vxhud-resp2', 150, line2),
    buildSpeed(mph, step),
  ]
}

export function App() {
  const [ready, setReady] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [testPrompt, setTestPrompt] = useState('hello from vxhud')
  const [showKey, setShowKey] = useState(false)
  const [running, setRunning] = useState(false)
  const [wsState, setWsState] = useState('idle')
  const [finalText, setFinalText] = useState('')
  const [interim, setInterim] = useState('')
  const [bytesSent, setBytesSent] = useState(0)
  const [lastError, setLastError] = useState(null)
  const [gps, setGps] = useState(null)
  const [gpsErr, setGpsErr] = useState(null)
  const [gpsCount, setGpsCount] = useState(0)
  const [derivedHeading, setDerivedHeading] = useState(null)
  const [derivedMph, setDerivedMph] = useState(0)
  const [maxMph, setMaxMph] = useState(0)
  const [responseChunks, setResponseChunks] = useState([])
  const [responsePage, setResponsePage] = useState(0)
  const [responseStatus, setResponseStatus] = useState('idle')
  const [responseErr, setResponseErr] = useState(null)

  const bridgeRef = useRef(null)
  const wsRef = useRef(null)
  const handlerRef = useRef({ running: false, wsState: 'idle', start: null, stop: null })
  const fixHistoryRef = useRef([])
  const finalTextRef = useRef('')
  finalTextRef.current = finalText
  const stateRef = useRef({ gps: null, gpsErr: null, heading: null, mph: 0 })
  stateRef.current = { gps, gpsErr, heading: derivedHeading, mph: derivedMph, maxMph, responseChunks, responsePage }

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

  const sendToOpenClaw = useCallback(async (prompt) => {
    const url = import.meta.env.VITE_OPENCLAW_URL
    const token = import.meta.env.VITE_OPENCLAW_TOKEN
    const session = import.meta.env.VITE_OPENCLAW_SESSION
    if (!url || !token) {
      setResponseErr('missing VITE_OPENCLAW_URL or VITE_OPENCLAW_TOKEN')
      setResponseChunks(['no gateway configured'])
      setResponsePage(0)
      setResponseStatus('error')
      return
    }
    setResponseErr(null)
    setResponseStatus('sending')
    setResponseChunks(['thinking...'])
    setResponsePage(0)
    try {
      const text = await askOpenClaw({ url, token, session, prompt })
      const chunks = chunkText(text, RESPONSE_CHARS)
      setResponseChunks(chunks.length ? chunks : ['(empty)'])
      setResponsePage(0)
      setResponseStatus('done')
    } catch (e) {
      const msg = String(e?.message ?? e)
      setResponseErr(msg)
      setResponseChunks([`err ${msg.slice(0, RESPONSE_CHARS - 10)}`])
      setResponsePage(0)
      setResponseStatus('error')
    }
  }, [])

  const stop = useCallback(async () => {
    const transcript = finalTextRef.current.trim()
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
    if (transcript) sendToOpenClaw(transcript)
  }, [sendToOpenClaw])

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
          containerTotalNum: 4,
          textObject: pageContainers({ ballVisible: false, heading: null, mph: 0, maxMph: 0, responseChunks: [], responsePage: 0 }),
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
        const t =
          event.textEvent?.eventType ??
          event.listEvent?.eventType ??
          event.sysEvent?.eventType
        const isTap = t === OsEventTypeList.CLICK_EVENT || t === undefined
        const isScrollUp = t === OsEventTypeList.SCROLL_TOP_EVENT
        const isScrollDown = t === OsEventTypeList.SCROLL_BOTTOM_EVENT
        if (isScrollUp) {
          setResponsePage((p) => Math.max(0, p - 1))
        } else if (isScrollDown) {
          const total = stateRef.current.responseChunks?.length ?? 0
          setResponsePage((p) => Math.min(Math.max(total - 2, 0), p + 1))
        } else if (isTap) {
          const h = handlerRef.current
          if (h.running) {
            h.stop?.()
          } else if (h.wsState !== 'connecting') {
            const s = stateRef.current
            bridgeRef.current?.rebuildPageContainer(
              new RebuildPageContainer({
                containerTotalNum: 4,
                textObject: pageContainers({
                  ballVisible: true,
                  heading: s.heading,
                  mph: s.mph,
                  maxMph: s.maxMph,
                  responseChunks: s.responseChunks,
                  responsePage: s.responsePage,
                }),
              }),
            ).catch(() => {})
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
    if (!ready) return
    if (import.meta.env.VITE_ENABLE_GPS === 'false') {
      setGpsErr('gps disabled via VITE_ENABLE_GPS=false')
      return
    }
    if (!('geolocation' in navigator)) {
      setGpsErr('geolocation not available in this WebView')
      return
    }
    const poll = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: lat, longitude: lon, accuracy } = pos.coords
          const timestamp = pos.timestamp
          setGps({ lat, lon, accuracy, timestamp })
          setGpsErr(null)
          setGpsCount((c) => c + 1)
          const history = fixHistoryRef.current
          history.push({ lat, lon, timestamp })
          while (history.length > FIX_HISTORY_SIZE) history.shift()
          if (history.length >= 2) {
            const first = history[0]
            const last = history[history.length - 1]
            const dtSec = (last.timestamp - first.timestamp) / 1000
            const dist = haversineMeters(first.lat, first.lon, last.lat, last.lon)
            if (dtSec > 0 && dist >= MIN_DISTANCE_M) {
              const mph = (dist / dtSec) * MPS_TO_MPH
              setDerivedMph(mph)
              setMaxMph((m) => Math.max(m, mph))
              setDerivedHeading(bearingDeg(first.lat, first.lon, last.lat, last.lon))
            } else {
              setDerivedMph(0)
            }
          }
        },
        (err) => {
          setGpsErr(`${err.code}: ${err.message}`)
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      )
    }

    let intervalId = null
    const start = () => {
      if (intervalId != null) clearInterval(intervalId)
      poll()
      intervalId = setInterval(poll, GPS_INTERVAL_MS)
    }
    const stop = () => {
      if (intervalId != null) { clearInterval(intervalId); intervalId = null }
    }

    let wakeLock = null
    const acquireWakeLock = async () => {
      if ('wakeLock' in navigator) {
        try { wakeLock = await navigator.wakeLock.request('screen') } catch {}
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        fixHistoryRef.current = []
        start()
        acquireWakeLock()
      } else {
        stop()
      }
    }

    start()
    acquireWakeLock()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      if (wakeLock) { try { wakeLock.release() } catch {} }
    }
  }, [ready])

  useEffect(() => {
    const bridge = bridgeRef.current
    if (!bridge || !ready) return

    const render = (visible) => {
      bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: 4,
          textObject: pageContainers({ ballVisible: visible, heading: derivedHeading, mph: derivedMph, maxMph, responseChunks, responsePage }),
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
  }, [ready, running, gps, gpsErr, derivedHeading, derivedMph, maxMph, responseChunks, responsePage])

  const wsTag = {
    idle: <span className="tag idle">idle</span>,
    connecting: <span className="tag live">connecting…</span>,
    open: <span className="tag ok">open</span>,
    closed: <span className="tag idle">closed</span>,
    error: <span className="tag err">error</span>,
  }[wsState]

  return (
    <main>
      <h1>vxHud</h1>
      <p className="sub">
        Bridge {ready ? <span className="tag ok">ready</span> : <span className="tag idle">waiting…</span>}
        {' · '}Deepgram {wsTag}
        {' · '}mic {running ? <span className="tag ok">on</span> : <span className="tag idle">off</span>}
        {' — tap the glasses pad to toggle dictation.'}
      </p>

      <div className="gps">
        {gps ? (
          <>
            <div className="coord">{gps.lat.toFixed(6)}, {gps.lon.toFixed(6)}</div>
            <div className="meta">
              ±{Math.round(gps.accuracy)}m · fix #{gpsCount} · {new Date(gps.timestamp).toLocaleTimeString()}
            </div>
          </>
        ) : gpsErr ? (
          <>
            <div className="coord">GPS unavailable</div>
            <div className="meta err">{gpsErr}</div>
          </>
        ) : (
          <div className="coord">Acquiring GPS…</div>
        )}
      </div>

      <div className="gps">
        <div className="coord">
          {derivedHeading != null ? fmtHeadingDeg(derivedHeading) : '—°'}
          {' · '}
          {derivedMph.toFixed(2)} mph
        </div>
        <div className="meta">
          derived between GPS fixes (needs ≥{MIN_DISTANCE_M} m movement between polls to update)
        </div>
      </div>

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

      <div className="gps">
        <div className="coord">
          OpenClaw {responseStatus === 'idle' ? <span className="tag idle">idle</span>
            : responseStatus === 'sending' ? <span className="tag live">sending…</span>
            : responseStatus === 'done' ? <span className="tag ok">done</span>
            : <span className="tag err">error</span>}
          {responseChunks.length > 0 && <span className="sub"> · page {responsePage + 1}/{responseChunks.length}</span>}
        </div>
        <div className="row" style={{ marginTop: '0.5rem' }}>
          <input
            type="text"
            value={testPrompt}
            onChange={(e) => setTestPrompt(e.target.value)}
            placeholder="test prompt (bypasses mic)"
            disabled={responseStatus === 'sending'}
            onKeyDown={(e) => { if (e.key === 'Enter' && testPrompt.trim()) sendToOpenClaw(testPrompt.trim()) }}
          />
          <button
            onClick={() => sendToOpenClaw(testPrompt.trim())}
            disabled={!testPrompt.trim() || responseStatus === 'sending'}
          >
            Send
          </button>
        </div>
        <div className="meta">
          <div className="row">
            <button disabled={responsePage === 0} onClick={() => setResponsePage((p) => Math.max(0, p - 1))}>◀ prev</button>
            <button disabled={responsePage >= Math.max(0, responseChunks.length - 2)} onClick={() => setResponsePage((p) => Math.min(Math.max(0, responseChunks.length - 2), p + 1))}>next ▶</button>
          </div>
          {responseErr && <div className="err">{responseErr}</div>}
          <pre style={{ whiteSpace: 'pre-wrap', margin: '0.5rem 0 0' }}>{responseChunks.join('\n')}</pre>
        </div>
      </div>

      <div className="diag">
        <div><span className="k">ws state</span><span>{wsState}</span></div>
        <div><span className="k">bytes sent</span><span>{bytesSent.toLocaleString()}</span></div>
        <div><span className="k">final chars</span><span>{finalText.length}</span></div>
        <div><span className="k">interim chars</span><span>{interim.length}</span></div>
        <div><span className="k">gps fixes</span><span>{gpsCount}</span></div>
        <div><span className="k">last gps ts</span><span>{gps ? new Date(gps.timestamp).toISOString() : '—'}</span></div>
      </div>
    </main>
  )
}
