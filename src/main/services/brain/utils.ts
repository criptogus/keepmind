export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'note'
}

// Split inbox content into classifiable blocks: bullets and paragraphs,
// re-joining tiny fragments so each block carries enough context.
export function splitBlocks(content: string): string[] {
  const raw = content
    .split(/\n{2,}|(?<=\n)(?=- |• |\* |\d+\. )/)
    .map(s => s.trim())
    .filter(s => s.length > 10)
  const out: string[] = []
  let buf = ''
  for (const b of raw) {
    if (buf && (buf.length + b.length > 1100 || b.length < 40)) {
      out.push(buf); buf = ''
    }
    buf = buf ? `${buf}\n${b}` : b
    if (buf.length > 1100) { out.push(buf); buf = '' }
  }
  if (buf.trim()) out.push(buf)
  return out
}

// ISO-8601 week key like "2026-W45"
export function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = (date.getUTCDay() + 6) % 7 // Mon=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3) // Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const ftDay = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDay + 3)
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 864e5))
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
