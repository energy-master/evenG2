const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen'

export function openDeepgram(apiKey, { onTranscript, onError, onClose } = {}) {
  const params = new URLSearchParams({
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    punctuate: 'true',
    smart_format: 'true',
    model: 'nova-2',
  })
  const url = `${DEEPGRAM_URL}?${params.toString()}`
  const ws = new WebSocket(url, ['token', apiKey])
  ws.binaryType = 'arraybuffer'

  return new Promise((resolve, reject) => {
    let opened = false
    const openTimeout = setTimeout(() => {
      if (!opened) {
        try { ws.close() } catch {}
        reject(new Error('Deepgram WebSocket open timeout (10s)'))
      }
    }, 10000)

    ws.onopen = () => {
      opened = true
      clearTimeout(openTimeout)
      resolve(ws)
    }
    ws.onerror = (e) => {
      if (!opened) {
        clearTimeout(openTimeout)
        reject(new Error('Deepgram WebSocket error before open (bad key or network)'))
      } else {
        onError?.(e)
      }
    }
    ws.onclose = (e) => onClose?.(e)
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'Results') onTranscript?.(msg)
        else if (msg.type === 'Metadata') onTranscript?.(msg)
      } catch {}
    }
  })
}

export function closeDeepgram(ws) {
  if (!ws) return
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'CloseStream' }))
    }
  } catch {}
  try { ws.close() } catch {}
}
