// Dated facts. Active text is what the prompt may trust. Proposals wait
// for the person. Archive keeps what used to be true, with an end date.

export type FactOrigin = 'user' | 'sleep' | 'chat' | 'mcp' | 'webhook' | 'agent' | 'legacy'
export type FactStatus = 'active' | 'archived' | 'proposal'

export interface Fact {
  id: string
  status: FactStatus
  since: string
  until: string
  source: string
  origin: FactOrigin
  supersedes: string
  supersededBy: string
  text: string
}

export interface FactDoc {
  legacy: string
  facts: Fact[]
}

const ORIGINS: FactOrigin[] = ['user', 'sleep', 'chat', 'mcp', 'webhook', 'agent', 'legacy']
const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export function localDay(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function factId(prefix: 'f' | 'p'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

function originOf(raw: string): FactOrigin {
  const o = raw.trim().toLowerCase()
  return (ORIGINS as string[]).includes(o) ? o as FactOrigin : 'legacy'
}

export function readFacts(raw: string): FactDoc {
  const text = raw.replace(/\r\n/g, '\n')
  if (!/^## (Ativos|Arquivo|Propostas|Legado)\s*$/m.test(text)) {
    return { legacy: text.trim(), facts: [] }
  }
  const legacy = (text.split(/^## Legado\s*$/m)[1] ?? '').split(/^## /m)[0] ?? ''
  const section = (name: string) => {
    const hit = text.split(new RegExp(`^## ${name}\\s*$`, 'm'))[1]
    if (!hit) return ''
    return hit.split(/^## /m)[0] ?? ''
  }
  const facts = [
    ...parseBlocks(section('Ativos'), 'active'),
    ...parseBlocks(section('Arquivo'), 'archived'),
    ...parseBlocks(section('Propostas'), 'proposal')
  ]
  return { legacy: legacy.trim(), facts }
}

function parseBlocks(section: string, status: FactStatus): Fact[] {
  return section.split(/^### /m).slice(1).map(part => {
    const nl = part.indexOf('\n')
    const id = (nl === -1 ? part : part.slice(0, nl)).trim()
    const body = nl === -1 ? '' : part.slice(nl + 1)
    const field = (name: string) => body.match(new RegExp(`^- ${name}:[ \\t]*(.*)$`, 'm'))?.[1]?.trim() ?? ''
    const prose = body
      .replace(/^- (since|until|source|origin|supersedes|superseded-by):.*$/gm, '')
      .trim()
    return {
      id,
      status,
      since: field('since'),
      until: field('until'),
      source: field('source'),
      origin: originOf(field('origin')),
      supersedes: field('supersedes'),
      supersededBy: field('superseded-by'),
      text: prose
    }
  }).filter(f => f.id.startsWith('f-') || f.id.startsWith('p-'))
}

function block(f: Fact): string {
  return [
    `### ${f.id}`,
    `- since: ${f.since}`,
    `- until: ${f.until}`,
    `- source: ${f.source}`,
    `- origin: ${f.origin}`,
    `- supersedes: ${f.supersedes}`,
    `- superseded-by: ${f.supersededBy}`,
    '',
    f.text.trim(),
    ''
  ].join('\n')
}

export function renderFacts(doc: FactDoc): string {
  const chunks = [
    '# Fatos',
    '',
    '## Legado',
    '',
    doc.legacy.trim(),
    '',
    '## Ativos',
    '',
    ...doc.facts.filter(f => f.status === 'active').map(block),
    '## Arquivo',
    '',
    ...doc.facts.filter(f => f.status === 'archived').map(block),
    '## Propostas',
    '',
    ...doc.facts.filter(f => f.status === 'proposal').map(block)
  ]
  return `${chunks.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

export function activeForPrompt(raw: string): string {
  const doc = readFacts(raw)
  const parts: string[] = []
  if (doc.legacy.trim()) parts.push(doc.legacy.trim())
  for (const f of doc.facts) {
    if (f.status !== 'active') continue
    parts.push(`- (${f.since || 'sem data'}) ${f.text}`)
  }
  return parts.join('\n\n')
}

export function factsAsOf(raw: string, day: string): Fact[] {
  return readFacts(raw).facts.filter(f => {
    if (f.status === 'proposal') return false
    if (!f.since || f.since > day) return false
    if (f.until && f.until <= day) return false
    return f.status === 'active' || f.status === 'archived'
  })
}

function ensure(raw: string): FactDoc {
  return readFacts(raw)
}

function pushFact(doc: FactDoc, fact: Fact) {
  doc.facts.push(fact)
}

export function addActive(raw: string, text: string, source: string, origin: FactOrigin, supersedes = ''): { raw: string; id: string } {
  const doc = ensure(raw)
  const today = localDay()
  const id = factId('f')
  if (supersedes) {
    const old = doc.facts.find(f => f.id === supersedes && f.status === 'active')
    if (old) {
      old.status = 'archived'
      old.until = today
      old.supersededBy = id
    }
  }
  pushFact(doc, {
    id, status: 'active', since: today, until: '', source, origin, supersedes, supersededBy: '', text: text.trim()
  })
  return { raw: renderFacts(doc), id }
}

export function addProposal(raw: string, text: string, source: string, origin: FactOrigin, supersedes = ''): { raw: string; id: string } {
  const doc = ensure(raw)
  const id = factId('p')
  pushFact(doc, {
    id, status: 'proposal', since: localDay(), until: '', source, origin, supersedes, supersededBy: '', text: text.trim()
  })
  return { raw: renderFacts(doc), id }
}

export function acceptProposal(raw: string, id: string): { raw: string; ok: boolean; text: string } {
  const doc = ensure(raw)
  const item = doc.facts.find(f => f.id === id && f.status === 'proposal')
  if (!item) return { raw, ok: false, text: '' }
  const today = localDay()
  item.status = 'active'
  item.id = item.id.startsWith('p-') ? `f-${item.id.slice(2)}` : item.id
  item.since = item.since || today
  if (item.supersedes) {
    const old = doc.facts.find(f => f.id === item.supersedes && f.status === 'active')
    if (old) {
      old.status = 'archived'
      old.until = today
      old.supersededBy = item.id
    }
  }
  return { raw: renderFacts(doc), ok: true, text: item.text }
}

export function discardProposal(raw: string, id: string): { raw: string; ok: boolean } {
  const doc = ensure(raw)
  const before = doc.facts.length
  doc.facts = doc.facts.filter(f => !(f.id === id && f.status === 'proposal'))
  return { raw: renderFacts(doc), ok: doc.facts.length !== before }
}

export function proposalsOf(raw: string): Fact[] {
  return readFacts(raw).facts.filter(f => f.status === 'proposal')
}

export function factById(raw: string, id: string): Fact | null {
  return readFacts(raw).facts.find(f => f.id === id) ?? null
}

// Dedupe only the undated legacy bullets. Structured blocks stay whole.
export function compactLegacy(raw: string): string {
  const doc = readFacts(raw)
  if (!doc.legacy.trim() && doc.facts.length === 0) return raw
  const seen = new Set<string>()
  const lines: string[] = []
  for (const line of doc.legacy.split('\n')) {
    const key = line.trim().toLowerCase()
    if (key.startsWith('- ') && seen.has(key)) continue
    if (key.startsWith('- ')) seen.add(key)
    lines.push(line)
  }
  const legacy = lines.join('\n').trim()
  if (legacy === doc.legacy.trim() && /^## Ativos/m.test(raw)) return raw
  doc.legacy = legacy
  return renderFacts(doc)
}

function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

export function parseAsOf(query: string, now = new Date()): string | null {
  const folded = fold(query)
  const temporal = /o que valia|valia em|valiam|na epoca|as of|no dia|na data/.test(folded)
  const iso = query.match(/\b(20\d{2}-\d{2}-\d{2})\b/)
  if (iso && temporal) return iso[1]
  const br = query.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/)
  if (br && temporal) {
    return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`
  }
  const month = folded.match(new RegExp(`\\b(${MONTHS.join('|')})(?:\\s+de\\s+(20\\d{2}))?`))
  if (!month || !temporal) return null
  const m = MONTHS.indexOf(month[1]) + 1
  let year = month[2] ? Number(month[2]) : now.getFullYear()
  if (!month[2] && m > now.getMonth() + 1) year -= 1
  const last = new Date(year, m, 0).getDate()
  return `${year}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

export function monthLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const name = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][(m || 1) - 1]
  return `${d} de ${name} de ${y}`
}
