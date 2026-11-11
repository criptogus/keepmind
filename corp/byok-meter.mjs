import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

// Rough list prices (USD per 1M tokens) for estimates — not billing truth.
const RATES = {
  openai: { in: 0.15, out: 0.6, model: 'gpt-4o-mini' },
  anthropic: { in: 3, out: 15, model: 'claude-sonnet (est.)' },
  gemini: { in: 0.1, out: 0.4, model: 'gemini-flash (est.)' },
  grok: { in: 2, out: 10, model: 'grok (est.)' }
}

function logFile(vault) {
  return path.join(vault, 'ops', 'byok-usage.jsonl')
}

export function estimateTokens(chars) {
  return Math.max(1, Math.ceil(String(chars || '').length / 4))
}

export function recordByokUsage(vault, { provider, promptChars, completionChars, op = 'chat' }) {
  const rates = RATES[provider]
  if (!rates) return
  const promptTokens = estimateTokens(promptChars)
  const completionTokens = estimateTokens(completionChars)
  const estUsd =
    (promptTokens * rates.in + completionTokens * rates.out) / 1_000_000
  const file = logFile(vault)
  mkdirSync(path.dirname(file), { recursive: true })
  appendFileSync(
    file,
    `${JSON.stringify({
      ts: new Date().toISOString(),
      provider,
      op,
      promptTokens,
      completionTokens,
      estUsd: Math.round(estUsd * 1e6) / 1e6,
      model: rates.model
    })}\n`
  )
}

export function byokReport(vault, days = 30) {
  const file = logFile(vault)
  if (!existsSync(file)) {
    return { days, providers: {}, totalEstUsd: 0, rows: 0, note: 'No BYOK usage logged yet.' }
  }
  const cutoff = Date.now() - Math.max(1, Math.min(365, days)) * 86400_000
  const byProvider = {}
  let total = 0
  let rows = 0
  for (const line of readFileSync(file, 'utf8').trim().split('\n')) {
    if (!line) continue
    let row
    try { row = JSON.parse(line) } catch { continue }
    if (Date.parse(row.ts) < cutoff) continue
    rows += 1
    const p = row.provider || 'unknown'
    if (!byProvider[p]) {
      byProvider[p] = { promptTokens: 0, completionTokens: 0, estUsd: 0, calls: 0, model: row.model }
    }
    byProvider[p].promptTokens += row.promptTokens || 0
    byProvider[p].completionTokens += row.completionTokens || 0
    byProvider[p].estUsd += row.estUsd || 0
    byProvider[p].calls += 1
    total += row.estUsd || 0
  }
  for (const p of Object.keys(byProvider)) {
    byProvider[p].estUsd = Math.round(byProvider[p].estUsd * 1e4) / 1e4
  }
  return {
    days,
    providers: byProvider,
    totalEstUsd: Math.round(total * 1e4) / 1e4,
    rows,
    rates: RATES,
    disclaimer: 'Estimates from token heuristics; verify in provider billing console.'
  }
}
