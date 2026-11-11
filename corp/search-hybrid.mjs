const STOP = new Set('a o e de da do das dos em um uma para com por que na no nas nos'.split(' '))

export function tokenize(q) {
  return String(q || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP.has(t))
    .slice(0, 12)
}

export function scoreText(content, tokens) {
  if (!tokens.length) return 0
  const lower = content.toLowerCase()
  let score = 0
  for (const t of tokens) {
    let idx = 0
    let hits = 0
    while (hits < 8) {
      const i = lower.indexOf(t, idx)
      if (i < 0) break
      hits += 1
      score += 1 + (content.length - i) / content.length * 0.2
      idx = i + t.length
    }
  }
  return score
}

export function rankMemoryFiles(files, query, read) {
  const tokens = tokenize(query)
  if (!tokens.length) return []
  const hits = []
  for (const file of files) {
    try {
      const content = read(file)
      if (content.startsWith('KMS1\n')) continue
      const score = scoreText(content, tokens)
      if (score <= 0) continue
      const lower = content.toLowerCase()
      const needle = tokens[0]
      const i = lower.indexOf(needle)
      const snippet = i >= 0 ? content.slice(Math.max(0, i - 48), i + 96) : content.slice(0, 140)
      hits.push({ file, score, snippet })
    } catch { /* skip */ }
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, 20)
}
