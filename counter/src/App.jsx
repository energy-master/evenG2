import { useEffect, useRef, useState } from 'react'
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
const CONTAINER_NAME = 'counter-display'

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

export function App() {
  const [count, setCount] = useState(0)
  const [ready, setReady] = useState(false)
  const bridgeRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    let unsubscribe

    ;(async () => {
      const bridge = await waitForEvenAppBridge()
      if (cancelled) return
      bridgeRef.current = bridge

      await bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({
          containerTotalNum: 1,
          textObject: [buildCenteredText('Count: 0')],
        }),
      )

      unsubscribe = bridge.onEvenHubEvent((event) => {
        const t =
          event.textEvent?.eventType ??
          event.listEvent?.eventType ??
          event.sysEvent?.eventType
        if (t === OsEventTypeList.CLICK_EVENT || t === undefined) {
          setCount((c) => c + 1)
        }
      })

      setReady(true)
    })()

    return () => {
      cancelled = true
      if (unsubscribe) unsubscribe()
    }
  }, [])

  useEffect(() => {
    const bridge = bridgeRef.current
    if (!bridge || !ready) return
    bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 1,
        textObject: [buildCenteredText(`Count: ${count}`)],
      }),
    )
  }, [count, ready])

  return (
    <main>
      <h1>Counter</h1>
      <p className="count">{count}</p>
      <button onClick={() => setCount((c) => c + 1)}>Tap</button>
      <p className="hint">
        In the simulator, use the ring/temple tap control to increment.
        The browser button is a dev fallback.
      </p>
    </main>
  )
}
