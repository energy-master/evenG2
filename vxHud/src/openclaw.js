export async function askOpenClaw({ url, token, session, prompt, signal }) {
  const endpoint = url.replace(/\/$/, '') + '/v1/chat/completions'
  const body = {
    model: 'openclaw',
    messages: [{ role: 'user', content: prompt }],
    stream: false,
  }
  if (session) body.user = session
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`OpenClaw ${response.status}: ${text.slice(0, 200)}`)
  }
  const data = await response.json()
  console.log('[openclaw] raw response:', data)
  return data?.choices?.[0]?.message?.content ?? ''
}

export function chunkText(text, size = 38) {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const chunks = []
  const words = clean.split(' ')
  let current = ''
  for (const word of words) {
    if (word.length > size) {
      if (current) { chunks.push(current); current = '' }
      for (let i = 0; i < word.length; i += size) {
        chunks.push(word.slice(i, i + size))
      }
      continue
    }
    const next = current ? current + ' ' + word : word
    if (next.length <= size) {
      current = next
    } else {
      chunks.push(current)
      current = word
    }
  }
  if (current) chunks.push(current)
  return chunks
}
