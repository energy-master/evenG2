import { useEffect, useRef, useState, useCallback } from 'react'
import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import { getTextWidth, measureTextWrap } from '@evenrealities/pretext'

const CANVAS_WIDTH = 576
const CANVAS_HEIGHT = 288
const CONTAINER_ID = 1
const CONTAINER_NAME = 'probe-display'
const PAGE_COUNT = 4

function buildCenteredText(text) {
  const width = getTextWidth(text)
  const { height } = measureTextWrap(text, CANVAS_WIDTH)
  return new TextContainerProperty({
    xPosition: Math.max(0, Math.floor((CANVAS_WIDTH - width) / 2)),
    yPosition: Math.max(0, Math.floor((CANVAS_HEIGHT - height) / 2)),
    width: Math.min(CANVAS_WIDTH, width + 4),
    height: Math.min(CANVAS_HEIGHT, height + 4),
    containerID: CONTAINER_ID,
    containerName: CONTAINER_NAME,
    content: text,
    isEventCapture: 1,
  })
}

function pageText(page, { user, device, status, mic, audioBytes }) {
  const idx = `${page + 1}/${PAGE_COUNT}`
  if (page === 0) {
    if (!user) return `${idx} USER (none)`
    return `${idx} USER ${user.name || '?'} (${user.country || '?'})`
  }
  if (page === 1) {
    if (!device) return `${idx} DEVICE (none)`
    const sn = (device.sn || '').slice(-6) || '?'
    return `${idx} DEVICE ${device.model || '?'} sn:${sn}`
  }
  if (page === 2) {
    if (!status) return `${idx} STATUS (none)`
    const bat = status.batteryLevel ?? '?'
    const flags = [
      status.isWearing ? 'worn' : null,
      status.isCharging ? 'chg' : null,
      status.isInCase ? 'case' : null,
    ].filter(Boolean).join(' ') || 'idle'
    return `${idx} STATUS bat ${bat}% ${flags}`
  }
  return `${idx} MIC ${mic ? 'on' : 'off'} rx ${(audioBytes / 1024).toFixed(1)}kb`
}

function stringify(v) {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

export function App() {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState(null)
  const [userErr, setUserErr] = useState(null)
  const [device, setDevice] = useState(null)
  const [deviceErr, setDeviceErr] = useState(null)
  const [status, setStatus] = useState(null)
  const [events, setEvents] = useState([])
  const [mic, setMic] = useState(false)
  const [audioBytes, setAudioBytes] = useState(0)
  const [storage, setStorage] = useState({ wrote: null, read: null, err: null })
  const [page, setPage] = useState(0)

  const bridgeRef = useRef(null)
  const stateRef = useRef({ user, device, status, mic, audioBytes, page })
  stateRef.current = { user, device, status, mic, audioBytes, page }

  const pushEvent = useCallback((entry) => {
    setEvents((prev) => [entry, ...prev].slice(0, 8))
  }, [])

  const refreshUser = useCallback(async () => {
    const bridge = bridgeRef.current
    if (!bridge) return
    try {
      const info = await bridge.getUserInfo()
      setUser(info?.toJson ? info.toJson() : info)
      setUserErr(null)
    } catch (e) {
      setUserErr(String(e))
    }
  }, [])

  const refreshDevice = useCallback(async () => {
    const bridge = bridgeRef.current
    if (!bridge) return
    try {
      const info = await bridge.getDeviceInfo()
      setDevice(info?.toJson ? info.toJson() : info)
      setDeviceErr(null)
    } catch (e) {
      setDeviceErr(String(e))
    }
  }, [])

  const toggleMic = useCallback(async () => {
    const bridge = bridgeRef.current
    if (!bridge) return
    const next = !stateRef.current.mic
    try {
      const ok = await bridge.audioControl(next)
      setMic(Boolean(next && ok !== false))
      if (!next) setAudioBytes(0)
    } catch (e) {
      pushEvent({ kind: 'error', at: Date.now(), data: `audioControl: ${e}` })
    }
  }, [pushEvent])

  const storageRoundtrip = useCallback(async () => {
    const bridge = bridgeRef.current
    if (!bridge) return
    const value = `probe-${Date.now()}`
    try {
      await bridge.setLocalStorage('probe.lastWrite', value)
      const read = await bridge.getLocalStorage('probe.lastWrite')
      setStorage({ wrote: value, read, err: null })
    } catch (e) {
      setStorage({ wrote: value, read: null, err: String(e) })
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let unsubStatus, unsubEvent

    ;(async () => {
      const bridge = await waitForEvenAppBridge()
      if (cancelled) return
      bridgeRef.current = bridge

      await bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({
          containerTotalNum: 1,
          textObject: [buildCenteredText(pageText(0, stateRef.current))],
        }),
      )

      unsubStatus = bridge.onDeviceStatusChanged((s) => {
        setStatus(s?.toJson ? s.toJson() : s)
      })

      unsubEvent = bridge.onEvenHubEvent((event) => {
        const now = Date.now()
        if (event.audioEvent?.audioPcm) {
          const len = event.audioEvent.audioPcm.length ?? 0
          setAudioBytes((b) => b + len)
          pushEvent({ kind: 'audio', at: now, data: `+${len} bytes PCM` })
          return
        }
        const t =
          event.listEvent?.eventType ??
          event.textEvent?.eventType ??
          event.sysEvent?.eventType
        if (t === OsEventTypeList.CLICK_EVENT) {
          setPage((p) => (p + 1) % PAGE_COUNT)
        }
        pushEvent({ kind: 'hub', at: now, data: event.jsonData ?? event })
      })

      await Promise.all([refreshUser(), refreshDevice()])
      setReady(true)
    })()

    return () => {
      cancelled = true
      if (unsubStatus) unsubStatus()
      if (unsubEvent) unsubEvent()
    }
  }, [refreshUser, refreshDevice, pushEvent])

  useEffect(() => {
    const bridge = bridgeRef.current
    if (!bridge || !ready) return
    bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 1,
        textObject: [buildCenteredText(pageText(page, { user, device, status, mic, audioBytes }))],
      }),
    )
  }, [ready, page, user, device, status, mic, audioBytes])

  return (
    <main>
      <h1>Probe</h1>
      <p className="sub">
        Bridge {ready ? <span className="tag ok">ready</span> : <span className="tag idle">waiting…</span>}
        {' '}· glasses tap cycles page {page + 1}/{PAGE_COUNT} · browser button below mirrors that.
      </p>

      <div className="row">
        <button onClick={() => setPage((p) => (p + 1) % PAGE_COUNT)}>Next page (simulate tap)</button>
        <button onClick={refreshUser}>Refresh user</button>
        <button onClick={refreshDevice}>Refresh device</button>
        <button onClick={toggleMic}>{mic ? 'Stop mic' : 'Start mic'}</button>
        <button onClick={storageRoundtrip}>Storage roundtrip</button>
      </div>

      <section className="section">
        <h2>getUserInfo {userErr ? <span className="tag err">err</span> : user ? <span className="tag ok">ok</span> : <span className="tag idle">—</span>}</h2>
        <pre>{userErr ? userErr : stringify(user)}</pre>
      </section>

      <section className="section">
        <h2>getDeviceInfo {deviceErr ? <span className="tag err">err</span> : device ? <span className="tag ok">ok</span> : <span className="tag idle">—</span>}</h2>
        <pre>{deviceErr ? deviceErr : stringify(device)}</pre>
      </section>

      <section className="section">
        <h2>onDeviceStatusChanged (latest) {status ? <span className="tag ok">live</span> : <span className="tag idle">no events yet</span>}</h2>
        <pre>{stringify(status)}</pre>
      </section>

      <section className="section">
        <h2>audioControl · {mic ? <span className="tag ok">mic on</span> : <span className="tag idle">mic off</span>} · {audioBytes} bytes received</h2>
        <p className="sub">Toggle mic, then talk near the glasses. Bytes accumulate as PCM frames arrive.</p>
      </section>

      <section className="section">
        <h2>localStorage roundtrip {storage.err ? <span className="tag err">err</span> : storage.read ? <span className="tag ok">ok</span> : <span className="tag idle">—</span>}</h2>
        <pre>{stringify(storage)}</pre>
      </section>

      <section className="section">
        <h2>onEvenHubEvent (last {events.length})</h2>
        <div className="log">
          {events.length === 0 && <p className="sub">No events yet. Tap the glasses / simulator.</p>}
          {events.map((e, i) => (
            <pre key={i}>[{new Date(e.at).toISOString().slice(11, 19)}] {e.kind} {typeof e.data === 'string' ? e.data : stringify(e.data)}</pre>
          ))}
        </div>
      </section>
    </main>
  )
}
