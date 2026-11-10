// Optional OpenAI embedding rerank over hybrid search hits (v0.4).

export async function embedQuery(apiKey, text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) })
  })
  if (!res.ok) return null
  const data = await res.json()
  return data.data?.[0]?.embedding ?? null
}

function dot(a, b) {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

export async function rerankWithEmbeddings(hits, query, readSnippet, apiKey) {
  if (!apiKey || hits.length < 2) return { hits, semantic: false }
  const qVec = await embedQuery(apiKey, query)
  if (!qVec) return { hits, semantic: false }
  const scored = []
  for (const row of hits.slice(0, 8)) {
    const text = readSnippet(row.file)
    const v = await embedQuery(apiKey, text.slice(0, 6000))
    if (!v) continue
    scored.push({ row, score: dot(qVec, v) })
  }
  if (!scored.length) return { hits, semantic: false }
  scored.sort((a, b) => b.score - a.score)
  return { hits: scored.map(s => s.row), semantic: true }
}
