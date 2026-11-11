import { readAudit } from './lib.mjs'

export function auditExportNdjson(vault, { limit = 500, since } = {}) {
  const rows = readAudit(vault, limit)
  const sinceMs = since ? Date.parse(since) : 0
  const lines = []
  for (const row of rows) {
    if (sinceMs && Date.parse(row.ts) < sinceMs) continue
    lines.push(JSON.stringify(row))
  }
  return `${lines.join('\n')}\n`
}

export function auditExportCsv(vault, { limit = 500, since } = {}) {
  const rows = readAudit(vault, limit)
  const sinceMs = since ? Date.parse(since) : 0
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const out = ['ts,actor,role,op,detail']
  for (const row of rows) {
    if (sinceMs && Date.parse(row.ts) < sinceMs) continue
    const detail = JSON.stringify(row).slice(0, 500)
    out.push([esc(row.ts), esc(row.actor), esc(row.role), esc(row.op), esc(detail)].join(','))
  }
  return `${out.join('\n')}\n`
}
