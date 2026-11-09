import type { Memory } from './brain'
import { redactSecrets } from './redact'

// Vault skills live wherever the vault keeps them: canonical SKILL.md
// packages anywhere in the tree, plus native skills/*.md. Suggestions,
// search and reviews come from superagentskill.com's public MCP — read-only,
// no auth. A review only runs when the person asks for one.

const ENDPOINT = 'https://superagentskill.com/api/public/mcp'
const KINDS = ['skill', 'playbook', 'soul', 'guardrail'] as const
type SkillKind = (typeof KINDS)[number]

async function mcpCall(method: string, params: unknown): Promise<any> {
  let res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
  })
  if (res.status === 429) {
    await new Promise(r => setTimeout(r, 2500))
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
    })
  }
  if (!res.ok) throw new Error(`registry MCP ${res.status}`)
  const text = await res.text()
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue
    try {
      const j = JSON.parse(line.slice(5).trim())
      if (j?.result !== undefined) return j.result
      if (j?.error) throw new Error(j.error.message ?? 'registry error')
    } catch (e) {
      if (e instanceof Error && e.message !== 'registry error' && !(e instanceof SyntaxError)) throw e
      if (e instanceof Error && e.message === 'registry error') throw e
    }
  }
  try { return JSON.parse(text)?.result ?? null } catch { return null }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<any> {
  const r = await mcpCall('tools/call', { name, arguments: args })
  if (r?.structuredContent && typeof r.structuredContent === 'object') return r.structuredContent
  const txt = r?.content?.[0]?.text
  if (!txt) return null
  try { return JSON.parse(txt) } catch { return { text: txt } }
}

export interface VaultSkill {
  file: string
  path: string
  group: string
  segment: string
  title: string
  ageDays: number
  uses: number
  mentions: number
  kind: string
  slug: string
  excerpt: string
  category: string
}

export interface SkillSuggestion {
  slug: string
  name: string
  description: string
  type: string
  installs: number
  alreadyHave: boolean
}

export interface SakPillar {
  name: string
  score: number | null
  rationale: string
}

export interface SakNote {
  path: string
  at: string
  score: number | null
  formatScore: number | null
  substanceScore: number | null
  rationale: string
  actions: string[]
  pillars: SakPillar[]
}

export interface EvolutionHint {
  path: string
  title: string
  segment: string
  kind: 'use' | 'idle' | 'note' | 'duplicate' | 'threat'
  sentence: string
  paths?: string[]
}

export type ThreatStatus = 'clean' | 'review' | 'blocked' | 'unavailable'

export interface ThreatFinding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  title: string
  detail: string
}

export interface SkillThreat {
  path: string
  slug: string
  at: string
  status: ThreatStatus
  score: number | null
  findingsCritical: number
  findingsPublic: number
  injection: string | null
  summary: string
  findings: ThreatFinding[]
}

export interface SkillTrustReport {
  slug: string
  score: number | null
  summary: string
  findingsCritical: number
  findingsPublic: number
  findings: ThreatFinding[]
  status: ThreatStatus
}

export interface SkillSegment {
  id: string
  count: number
}

export interface SkillCategory {
  id: string
  label: string
  count: number
}

export interface SkillsSnapshot {
  items: VaultSkill[]
  suggestions: SkillSuggestion[]
  hints: EvolutionHint[]
  notes: SakNote[]
  segments: SkillSegment[]
  categories: SkillCategory[]
  threats: SkillThreat[]
}

function num(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : null
}

function kindOf(raw: string): SkillKind {
  const k = raw.trim().toLowerCase()
  return (KINDS as readonly string[]).includes(k) ? k as SkillKind : 'skill'
}

const SKILL_CATEGORIES: { id: string; label: string; keywords: string[] }[] = [
  { id: 'cybersec', label: 'Cybersec', keywords: ['cyber', 'cybersec', 'security', 'segurança', 'seguranca', 'vuln', 'pentest', 'owasp', 'threat', 'malware', 'jailbreak'] },
  { id: 'automation', label: 'Automation', keywords: ['automation', 'automação', 'automacao', 'composio', 'zapier', 'n8n', 'workflow', 'cron', 'integrat'] },
  { id: 'development', label: 'Development', keywords: ['develop', 'desenvolvimento', 'code', 'coding', 'debug', 'typescript', 'python', 'refactor', 'git', 'api', 'software', 'programming'] },
  { id: 'marketing', label: 'Marketing', keywords: ['marketing', 'campaign', 'ads', 'seo', 'copy', 'brand', 'social', 'growth', 'newsletter'] },
  { id: 'research', label: 'Research', keywords: ['research', 'pesquisa', 'investig', 'study', 'estudo'] },
  { id: 'writing', label: 'Writing', keywords: ['writing', 'escrita', 'editor', 'prose', 'blog', 'draft'] },
  { id: 'product', label: 'Product', keywords: ['product', 'produto', 'roadmap', 'prd', 'user story'] },
  { id: 'sales', label: 'Sales', keywords: ['sales', 'vendas', 'crm', 'outbound', 'lead', 'pipeline'] },
  { id: 'operations', label: 'Operations', keywords: ['operations', 'operações', 'operacoes', 'incident', 'runbook', 'oncall', 'sre'] },
  { id: 'other', label: 'Other', keywords: [] }
]

function unwrapScalar(raw: string): string {
  let t = raw.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) t = t.slice(1, -1)
  return t.replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\s+/g, ' ').trim()
}

function humanizeSlug(slug: string): string {
  const words = slug.replace(/[_]+/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
  if (!words) return slug
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function splitFrontMatter(content: string): { fm: string; body: string } {
  if (!content.startsWith('---')) return { fm: '', body: content }
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { fm: '', body: content }
  return { fm: match[1], body: content.slice(match[0].length) }
}

function frontDescription(fm: string): string {
  const lines = fm.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const found = lines[i].match(/^description:\s*(.*)$/)
    if (!found) continue
    const rest = found[1].trim()
    if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-') {
      const block: string[] = []
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() !== '' && !/^\s/.test(lines[j])) break
        block.push(lines[j].trim())
      }
      return unwrapScalar(block.join(' '))
    }
    return unwrapScalar(rest)
  }
  return ''
}

function firstProse(body: string): string {
  const lines = body.replace(/^#\s+.+(?:\r?\n)+/, '').split(/\r?\n/)
  const out: string[] = []
  let fence = false
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('```')) { fence = !fence; continue }
    if (fence || !t) {
      if (!fence && out.length) break
      continue
    }
    if (/^[#|>]/.test(t) || t.startsWith('|') || t.startsWith('<') || t.startsWith('{') || t.startsWith('[')) continue
    if (/^[-*]\s+[`{[]/.test(t)) continue
    const plain = t
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[`*_>#]/g, '')
      .trim()
    if (plain.length < 2) continue
    if ((plain.match(/[{}[\]]/g) ?? []).length >= 2) continue
    out.push(plain)
    if (out.join(' ').length > 220) break
  }
  return out.join(' ')
}

export function skillTitle(fm: string, body: string, rel: string): string {
  const base = rel.split('/').pop() ?? rel
  const folder = base.toLowerCase() === 'skill.md'
    ? (rel.split('/').slice(-2, -1)[0] ?? base)
    : base.replace(/\.md$/i, '')
  const raw = fm.match(/^name:\s*(.+)$/m)?.[1] ?? body.match(/^#\s+(.+)$/m)?.[1] ?? ''
  const cleaned = unwrapScalar(raw).replace(/[`*_>#]/g, '').trim()
  const noisy = !cleaned || cleaned.length > 72 || /[{}[\]<>]/.test(cleaned) || cleaned.toLowerCase() === 'skill'
  return (noisy ? humanizeSlug(folder) : cleaned).slice(0, 80)
}

export function readableExcerpt(fm: string, body: string): string {
  const prose = firstProse(body)
  const described = frontDescription(fm)
  const pick = prose || described || 'No text yet.'
  return pick.replace(/\s+/g, ' ').trim().slice(0, 220)
}

export function categoryOf(fm: string, title: string, excerpt: string, rel: string, slug: string): string {
  const declared = (fm.match(/^(?:category|categories|tags):\s*(.+)$/m)?.[1] ?? '').replace(/[[\]"']/g, ' ')
  const hay = `${declared} ${title} ${excerpt} ${rel} ${slug}`.toLowerCase()
  for (const cat of SKILL_CATEGORIES) {
    if (cat.id === 'other') continue
    if (cat.keywords.some(k => hay.includes(k))) return cat.id
  }
  return 'other'
}

export function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function segmentOf(group: string, source: string): string {
  if (/superagentskill/i.test(source)) return 'SuperagentSkill'
  if (group === 'keepmind') return 'KeepMind'
  return group || 'KeepMind'
}

function countNeedle(hay: string, needle: string): number {
  const n = needle.trim().toLowerCase()
  if (n.length < 5) return 0
  const re = new RegExp(`(?:^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`, 'g')
  return Math.min(hay.match(re)?.length ?? 0, 30)
}

function usageContext(memory: Memory): { writes: Map<string, number>; corpus: string } {
  const writes = new Map<string, number>()
  for (const entry of memory.activity(600)) {
    if (!entry.path) continue
    writes.set(entry.path, (writes.get(entry.path) ?? 0) + 1)
  }
  const chunks: string[] = []
  for (const f of memory.list('short-term').sort().slice(-6)) {
    chunks.push(memory.read(`short-term/${f}`) ?? '')
  }
  chunks.push(memory.read('long-term/skills.md') ?? '')
  return { writes, corpus: chunks.join('\n').toLowerCase().slice(-60_000) }
}

export function listVaultSkills(memory: Memory): VaultSkill[] {
  const now = Date.now()
  const { writes, corpus } = usageContext(memory)
  const out: VaultSkill[] = []
  const seen = new Set<string>()

  const push = (rel: string, group: string) => {
    if (seen.has(rel)) return
    if (rel.split('/').some(part => part.startsWith('_') || part.startsWith('.'))) return
    seen.add(rel)
    const content = memory.read(rel) ?? ''
    const { fm, body } = splitFrontMatter(content)
    const title = skillTitle(fm, body, rel)
    const source = fm.match(/^source:\s*(.+)$/m)?.[1]?.trim() ?? ''
    const slugFromSource = source.match(/superagentskill\.com\/([a-z0-9-]+)/i)?.[1]?.toLowerCase() ?? ''
    const flat = rel.startsWith('skills/') && !rel.slice('skills/'.length).includes('/')
    const slug = slugFromSource || (flat ? rel.slice('skills/'.length).replace(/\.md$/i, '') : '')
    const excerpt = readableExcerpt(fm, body)
    const mtime = memory.fileMtime(rel) ?? now
    const mentions = Math.max(countNeedle(corpus, title), slug ? countNeedle(corpus, slug) : 0)
    out.push({
      file: rel.split('/').pop()!,
      path: rel,
      group,
      segment: segmentOf(group, source),
      title,
      ageDays: Math.max(0, Math.floor((now - mtime) / 86_400_000)),
      uses: writes.get(rel) ?? 0,
      mentions,
      kind: kindOf(fm.match(/^type:\s*(.+)$/m)?.[1] ?? 'skill'),
      slug,
      excerpt,
      category: categoryOf(fm, title, excerpt, rel, slug)
    })
  }

  for (const rel of memory.allRelFiles()) {
    if (!rel.endsWith('.md')) continue
    const base = rel.split('/').pop()!
    if (base === 'SKILL.md') {
      const parts = rel.split('/')
      push(rel, parts.length >= 3 ? parts[parts.length - 3] : parts[0])
    } else if (rel.startsWith('skills/') && !rel.slice('skills/'.length).includes('/')) {
      push(rel, 'keepmind')
    }
  }
  return out.sort((a, b) => (b.uses + b.mentions) - (a.uses + a.mentions) || a.title.localeCompare(b.title))
}

export function loadSakNotes(memory: Memory): SakNote[] {
  const data = memory.readOpsJson<{ notes?: SakNote[] }>('sak-notes.json', { notes: [] })
  return Array.isArray(data.notes) ? data.notes : []
}

function saveSakNotes(memory: Memory, notes: SakNote[]) {
  memory.writeOpsJson('sak-notes.json', { notes: notes.slice(0, 80) })
}

function renderNotes(notes: SakNote[]): string {
  const lines = [
    '# Notas do SuperagentSkill',
    '',
    'Avaliações que você pediu. A evolução das skills lê este arquivo.',
    ''
  ]
  for (const n of notes) {
    lines.push(`## ${n.path}`, '')
    lines.push(`- quando: ${n.at.slice(0, 16).replace('T', ' ')}`)
    if (n.score != null) lines.push(`- nota: ${n.score}`)
    if (n.formatScore != null) lines.push(`- formato: ${n.formatScore}`)
    if (n.substanceScore != null) lines.push(`- substância: ${n.substanceScore}`)
    if (n.rationale) lines.push('', n.rationale)
    for (const p of n.pillars ?? []) {
      lines.push(`- ${p.name}: ${p.score ?? 's/n'}${p.rationale ? ` — ${p.rationale}` : ''}`)
    }
    if (n.actions.length) {
      lines.push('', 'Ações:')
      for (const a of n.actions) lines.push(`- ${a}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function pillarsOf(review: any): SakPillar[] {
  const raw = review?.substance?.pillars ?? review?.pillars
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 8).map((p: any) => ({
    name: String(p?.name ?? p?.pillar ?? p?.id ?? 'Pilar').slice(0, 80),
    score: num(p?.score),
    rationale: String(p?.rationale ?? '').slice(0, 280)
  })).filter((p: SakPillar) => p.name.trim().length > 0)
}

function parseReview(path: string, review: any): SakNote {
  const at = new Date().toISOString()
  if (review?.text && review.overall_score == null && review.verdict_score == null) {
    return {
      path, at, score: null, formatScore: null, substanceScore: null,
      rationale: String(review.text).slice(0, 800), actions: [], pillars: []
    }
  }
  const actionsRaw = Array.isArray(review?.top_actions) ? review.top_actions : []
  const actions = actionsRaw.slice(0, 4).map((a: any) => {
    if (typeof a === 'string') return a.slice(0, 240)
    return String(a?.action ?? a?.text ?? a?.title ?? a?.suggestion ?? '').slice(0, 240)
  }).filter(Boolean)
  return {
    path,
    at,
    score: num(review?.overall_score ?? review?.verdict_score),
    formatScore: num(review?.format_score ?? review?.structural_score),
    substanceScore: num(review?.substance_score ?? review?.substance?.score),
    rationale: String(review?.substance?.rationale ?? review?.rationale ?? '').slice(0, 800),
    actions,
    pillars: pillarsOf(review)
  }
}

export function evolutionHints(skills: VaultSkill[], notes: SakNote[], threats: SkillThreat[] = []): EvolutionHint[] {
  const hints: EvolutionHint[] = []
  for (const t of threats) {
    if (t.status !== 'blocked' && t.status !== 'review') continue
    const skill = skills.find(s => s.path === t.path)
    hints.push({
      path: t.path,
      title: skill?.title ?? t.path,
      segment: skill?.segment ?? 'KeepMind',
      kind: 'threat',
      sentence: t.status === 'blocked'
        ? `${skill?.title ?? t.path} foi recusada pelo SuperagentSkill. ${t.summary}`
        : `${skill?.title ?? t.path} tem um achado de robustez. ${t.summary}`
    })
  }
  const byTitle = new Map<string, VaultSkill[]>()
  for (const s of skills) {
    const key = titleKey(s.title)
    if (key.length < 4) continue
    const list = byTitle.get(key) ?? []
    list.push(s)
    byTitle.set(key, list)
  }
  for (const group of byTitle.values()) {
    if (group.length < 2) continue
    const names = group.map(s => s.path).join(' · ')
    hints.push({
      path: group[0].path,
      title: group[0].title,
      segment: group[0].segment,
      kind: 'duplicate',
      paths: group.map(s => s.path),
      sentence: `“${group[0].title}” is in ${group.length} files: ${names}.`
    })
  }
  const noted = new Map(notes.map(n => [n.path, n]))
  for (const s of skills) {
    const note = noted.get(s.path)
    const used = s.uses + s.mentions
    if (note && note.score != null && note.score < 75) {
      const action = note.actions[0] || note.rationale.slice(0, 180)
      hints.push({
        path: s.path, title: s.title, segment: s.segment, kind: 'note',
        sentence: `Nota ${note.score} no SuperagentSkill. Próximo passo: ${action || 'reescrever o trecho que a nota apontou.'}`
      })
    } else if (note && note.score != null && used >= 2) {
      hints.push({
        path: s.path, title: s.title, segment: s.segment, kind: 'use',
        sentence: `Nota ${note.score} e ${used} uso(s). Ela já se provou. Mude só o que a última nota pediu.`
      })
    } else if (used >= 3 && !note) {
      hints.push({
        path: s.path, title: s.title, segment: s.segment, kind: 'use',
        sentence: `Usada ${used} vezes e ainda sem nota. Avalie no SuperagentSkill antes de reescrever.`
      })
    } else if (used === 0 && s.ageDays >= 14) {
      hints.push({
        path: s.path, title: s.title, segment: s.segment, kind: 'idle',
        sentence: `Nenhum uso em ${s.ageDays} dias no segmento ${s.segment}. Ou ela não entra nas conversas, ou pode sair do cofre.`
      })
    }
  }
  return hints.slice(0, 24)
}

function segmentsOf(skills: VaultSkill[]): SkillSegment[] {
  const map = new Map<string, number>()
  for (const s of skills) map.set(s.segment, (map.get(s.segment) ?? 0) + 1)
  return [...map.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}

function categoriesOf(skills: VaultSkill[]): SkillCategory[] {
  return SKILL_CATEGORIES.map(cat => ({
    id: cat.id,
    label: cat.label,
    count: skills.filter(s => s.category === cat.id).length
  }))
}

export function keepSkillCopy(memory: Memory, keepPath: string): { kept: string; archived: string[] } {
  const skills = listVaultSkills(memory)
  const keep = skills.find(s => s.path === keepPath)
  if (!keep) throw new Error('That skill is not in the vault.')
  const group = skills.filter(s => titleKey(s.title) === titleKey(keep.title) && titleKey(keep.title).length >= 4)
  if (group.length < 2) throw new Error('There is no other skill with that name.')
  const stamp = new Date().toISOString().slice(0, 10)
  const archived: string[] = []
  for (const other of group) {
    if (other.path === keep.path) continue
    const raw = memory.read(other.path)
    if (raw == null) continue
    const slug = other.path.replace(/\.md$/i, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(-80)
    let dest = `skills/_arquivo/${stamp}-${slug}.md`
    let n = 2
    while (memory.read(dest) != null) {
      dest = `skills/_arquivo/${stamp}-${slug}-${n}.md`
      n++
    }
    memory.write(dest, `<!-- archived from ${other.path} on ${stamp}; kept ${keep.path} -->\n${raw}`)
    memory.remove(other.path)
    archived.push(other.path)
  }
  return { kept: keep.path, archived }
}

const SUGGESTION_QUERIES = [
  'memory', 'knowledge management', 'research', 'automation', 'writing', 'security audit'
]

function haveSet(memory: Memory): Set<string> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return new Set(
    listVaultSkills(memory).flatMap(s => [norm(s.title), s.slug].filter(Boolean))
  )
}

function mapSuggestions(have: Set<string>, raw: any): SkillSuggestion[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const items = raw?.items ?? raw?.results ?? []
  const out: SkillSuggestion[] = []
  for (const it of items) {
    const slug = String(it.slug ?? it.id ?? '').toLowerCase()
    if (!slug) continue
    const name = String(it.name ?? slug)
    out.push({
      slug,
      name,
      description: String(it.description ?? it.long_description ?? '').slice(0, 220),
      type: String(it.type ?? 'skill'),
      installs: Number(it.install_count ?? it.installs ?? 0) || 0,
      alreadyHave: have.has(slug) || have.has(norm(name))
    })
  }
  return out
}

export async function suggestSkills(memory: Memory): Promise<SkillSuggestion[]> {
  const have = haveSet(memory)
  const seen = new Set<string>()
  const out: SkillSuggestion[] = []
  const results = await Promise.allSettled(
    SUGGESTION_QUERIES.map(q => callTool('search_registry', { query: q, limit: 6 }))
  )
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value) continue
    for (const item of mapSuggestions(have, r.value)) {
      if (seen.has(item.slug)) continue
      seen.add(item.slug)
      out.push(item)
    }
  }
  return out.sort((a, b) => b.installs - a.installs).slice(0, 12)
}

export async function searchRegistry(memory: Memory, query: string, type?: string): Promise<SkillSuggestion[]> {
  const args: Record<string, unknown> = { query, limit: 12 }
  if (type && (KINDS as readonly string[]).includes(type)) args.type = type
  const raw = await callTool('search_registry', args)
  const have = haveSet(memory)
  const seen = new Set<string>()
  return mapSuggestions(have, raw).filter(item => {
    if (seen.has(item.slug)) return false
    seen.add(item.slug)
    return true
  })
}

export function loadSkillThreats(memory: Memory): SkillThreat[] {
  const data = memory.readOpsJson<{ threats?: SkillThreat[] }>('skill-threats.json', { threats: [] })
  return Array.isArray(data.threats) ? data.threats : []
}

function saveSkillThreats(memory: Memory, threats: SkillThreat[]) {
  memory.writeOpsJson('skill-threats.json', { threats: threats.slice(0, 40) })
}

export async function skillsSnapshot(memory: Memory): Promise<SkillsSnapshot> {
  const items = listVaultSkills(memory)
  const notes = loadSakNotes(memory)
  const threats = loadSkillThreats(memory)
  const hints = evolutionHints(items, notes, threats)
  const suggestions = await suggestSkills(memory).catch(() => [])
  return { items, suggestions, hints, notes, segments: segmentsOf(items), categories: categoriesOf(items), threats }
}

export async function reviewVaultSkill(memory: Memory, rel: string): Promise<SakNote> {
  const content = memory.read(rel)
  if (!content || content.trim().length < 20) {
    throw new Error('A skill está curta demais para o SuperagentSkill avaliar.')
  }
  const fm = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? rel.split('/').pop()!
  const review = await callTool('review_skill', {
    name: name.slice(0, 200),
    content: content.slice(0, 40_000),
    type: kindOf(fm.match(/^type:\s*(.+)$/m)?.[1] ?? 'skill'),
    language: 'pt',
    semantic_check: true
  })
  if (!review) throw new Error('O SuperagentSkill não devolveu uma nota.')
  const note = parseReview(rel, review)
  const notes = [note, ...loadSakNotes(memory).filter(n => n.path !== rel)]
  saveSakNotes(memory, notes)
  memory.write('insights/sak-latest.md', renderNotes(notes.slice(0, 12)))
  return note
}

function severityOf(raw: unknown): ThreatFinding['severity'] {
  const s = String(raw ?? '').toLowerCase()
  if (s === 'critical' || s === 'crit') return 'critical'
  if (s === 'high' || s === 'error') return 'high'
  if (s === 'medium' || s === 'moderate' || s === 'warning' || s === 'warn') return 'medium'
  if (s === 'low') return 'low'
  return 'info'
}

function asFindings(list: unknown): ThreatFinding[] {
  if (!Array.isArray(list)) return []
  return list.slice(0, 8).map((f: any) => {
    if (typeof f === 'string') return { severity: 'info' as const, title: f.slice(0, 160), detail: '' }
    return {
      severity: severityOf(f?.severity ?? f?.level),
      title: String(f?.title ?? f?.name ?? f?.id ?? f?.kind ?? 'Achado').slice(0, 160),
      detail: String(f?.detail ?? f?.summary ?? f?.description ?? f?.evidence ?? f?.message ?? '').slice(0, 400)
    }
  })
}

function statusFromCounts(critical: number, findings: number): ThreatStatus {
  if (critical > 0) return 'blocked'
  if (findings > 0) return 'review'
  return 'clean'
}

function worse(a: ThreatStatus, b: ThreatStatus): ThreatStatus {
  const rank: Record<ThreatStatus, number> = { blocked: 3, review: 2, unavailable: 1, clean: 0 }
  return rank[a] >= rank[b] ? a : b
}

export async function skillTrust(slug: string): Promise<SkillTrustReport> {
  const r = await callTool('get_skill_trust', { slug })
  if (!r || typeof r !== 'object') throw new Error('Sem relatório de confiança para este pacote.')
  const trust = r.trust && typeof r.trust === 'object' ? r.trust : r
  if (r.text && trust.trust_score == null && trust.findings_critical == null) {
    return {
      slug, score: null, findingsCritical: 0, findingsPublic: 0, findings: [],
      status: 'unavailable', summary: String(r.text).slice(0, 320)
    }
  }
  const findings = asFindings(r.findings ?? trust.findings)
  const findingsCritical = num(trust.findings_critical) ?? findings.filter(f => f.severity === 'critical').length
  const findingsPublic = num(trust.findings_public) ?? findings.length
  const score = num(trust.trust_score ?? r.trust_score ?? r.score)
  const rate = trust.lifetime?.success_rate ?? trust.success_rate
  const bits: string[] = []
  if (score != null) bits.push(`confiança ${score}`)
  if (typeof rate === 'number' && Number.isFinite(rate)) {
    bits.push(`sucesso ${Math.round(rate <= 1 ? rate * 100 : rate)}%`)
  }
  if (findingsCritical > 0) bits.push(`${findingsCritical} achado(s) crítico(s)`)
  else if (findingsPublic > 0) bits.push(`${findingsPublic} achado(s) de robustez`)
  else bits.push('nenhum achado público de robustez')
  const text = String(r.summary ?? trust.summary ?? '').slice(0, 280)
  return {
    slug,
    score,
    findingsCritical,
    findingsPublic,
    findings,
    status: statusFromCounts(findingsCritical, Math.max(findingsPublic, findings.length)),
    summary: [bits.join(' · '), text].filter(Boolean).join('. ')
  }
}

function verdictFlag(verdict: string): 'clean' | 'blocked' | 'review' | 'unknown' {
  const v = verdict.trim().toLowerCase()
  if (!v) return 'unknown'
  if (['fail', 'failed', 'block', 'blocked', 'reject', 'rejected', 'malicious'].includes(v)) return 'blocked'
  if (['pass', 'passed', 'clean', 'ok', 'allow', 'allowed', 'safe'].includes(v)) return 'clean'
  return 'review'
}

function injectionOf(node: any): { flag: 'clean' | 'blocked' | 'review' | 'unknown'; text: string } {
  const guard = node?.prompt_injection ?? node?.injection ?? node?.injection_guard ?? node?.guard ?? node?.promptInjection
  const src = guard && typeof guard === 'object' ? guard : null
  if (!src) return { flag: 'unknown', text: '' }
  const verdict = verdictFlag(String(src.verdict ?? src.status ?? src.result ?? ''))
  const allowed = src.allowed ?? src.safe ?? src.pass ?? src.passed
  const blocked = src.blocked ?? src.rejected ?? src.malicious
  const reasons = src.reasons ?? src.signals ?? src.issues ?? src.findings
  const reasonText = Array.isArray(reasons)
    ? reasons.map((x: any) => typeof x === 'string' ? x : String(x?.message ?? x?.title ?? '')).filter(Boolean).join(' · ').slice(0, 300)
    : ''
  if (blocked === true || verdict === 'blocked') {
    return { flag: 'blocked', text: reasonText || 'O guarda de injeção recusou o arquivo.' }
  }
  if (allowed === false) return { flag: 'blocked', text: reasonText || 'O guarda de injeção recusou o arquivo.' }
  if (allowed === true || verdict === 'clean') return { flag: 'clean', text: reasonText }
  if (verdict === 'review') return { flag: 'review', text: reasonText || 'O guarda devolveu um parecer sem veredito claro.' }
  return { flag: 'review', text: reasonText || 'O guarda devolveu um parecer sem veredito claro.' }
}

function fileRows(raw: any): any[] {
  if (!raw || typeof raw !== 'object') return []
  for (const key of ['files', 'results', 'items', 'file_results']) {
    if (Array.isArray(raw[key])) return raw[key]
  }
  if (raw.dry_run && typeof raw.dry_run === 'object') return fileRows(raw.dry_run)
  return []
}

function renderThreats(threats: SkillThreat[]): string {
  const lines = [
    '# Análise de skills maliciosas',
    '',
    'Parecer do SuperagentSkill: relatório de confiança do pacote publicado e guarda de prompt injection no arquivo local. O dry-run não publica o pacote.',
    ''
  ]
  for (const t of threats) {
    lines.push(`## ${t.path}`, '')
    lines.push(`- quando: ${t.at.slice(0, 16).replace('T', ' ')}`)
    lines.push(`- estado: ${t.status}`)
    if (t.slug) lines.push(`- pacote: ${t.slug}`)
    if (t.score != null) lines.push(`- confiança: ${t.score}`)
    if (t.injection) lines.push(`- injeção: ${t.injection}`)
    lines.push('', t.summary)
    for (const f of t.findings) lines.push(`- [${f.severity}] ${f.title}${f.detail ? ` — ${f.detail}` : ''}`)
    lines.push('')
  }
  return lines.join('\n')
}

export async function scanSkillThreats(memory: Memory): Promise<{ threats: SkillThreat[]; hints: EvolutionHint[] }> {
  const skills = listVaultSkills(memory).slice(0, 20)
  const at = new Date().toISOString()
  if (!skills.length) {
    const empty: SkillThreat[] = []
    saveSkillThreats(memory, empty)
    return { threats: empty, hints: evolutionHints([], loadSakNotes(memory), empty) }
  }

  const threats: SkillThreat[] = skills.map(s => ({
    path: s.path,
    slug: s.slug,
    at,
    status: 'clean' as ThreatStatus,
    score: null,
    findingsCritical: 0,
    findingsPublic: 0,
    injection: null,
    summary: '',
    findings: [] as ThreatFinding[]
  }))
  const byPath = new Map(threats.map(t => [t.path, t]))

  const slugged = skills.filter(s => s.slug)
  let cursor = 0
  const trustWorker = async () => {
    while (cursor < slugged.length) {
      const skill = slugged[cursor++]
      const row = byPath.get(skill.path)
      if (!row) continue
      try {
        const report = await skillTrust(skill.slug)
        row.score = report.score
        row.findingsCritical = report.findingsCritical
        row.findingsPublic = report.findingsPublic
        row.findings = report.findings
        row.status = worse(row.status, report.status)
        row.summary = report.summary
      } catch (e: any) {
        row.status = worse(row.status, 'unavailable')
        row.summary = e?.message ?? 'O relatório de confiança não respondeu.'
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, slugged.length) }, () => trustWorker()))

  for (let i = 0; i < skills.length; i += 10) {
    const batch = skills.slice(i, i + 10)
    const files: { name: string; type: SkillKind; content: string }[] = []
    for (const skill of batch) {
      const row = byPath.get(skill.path)
      const raw = memory.read(skill.path) ?? ''
      const hidden = redactSecrets(raw) !== raw
      if (hidden && row) {
        row.findings = [...row.findings, {
          severity: 'high',
          title: 'Segredo no arquivo',
          detail: 'O texto enviado ao SuperagentSkill foi ocultado. O segredo continua no cofre e precisa sair da skill.'
        }]
        row.status = worse(row.status, 'review')
      }
      const content = redactSecrets(raw).slice(0, 40_000)
      if (content.trim().length < 20) {
        if (row) {
          row.status = worse(row.status, 'unavailable')
          row.injection = 'Arquivo curto demais para o guarda de injeção.'
        }
        continue
      }
      files.push({ name: skill.path.slice(0, 200), type: kindOf(skill.kind), content })
    }
    if (!files.length) continue
    try {
      const raw = await callTool('upload_packages', { dry_run: true, files })
      if (!raw || raw.text) {
        const msg = String(raw?.text ?? 'O guarda de injeção não devolveu um parecer.')
        for (const file of files) {
          const row = byPath.get(file.name)
          if (!row) continue
          row.status = worse(row.status, 'unavailable')
          row.injection = msg.slice(0, 240)
        }
        continue
      }
      const rows = fileRows(raw)
      files.forEach((file, index) => {
        const row = byPath.get(file.name)
        if (!row) return
        const node = rows.find(r => String(r?.name ?? r?.filename ?? r?.file ?? '') === file.name) ?? rows[index]
        if (!node) {
          row.status = worse(row.status, 'unavailable')
          row.injection = 'O guarda não devolveu esta skill.'
          return
        }
        const verdict = injectionOf(node)
        if (verdict.flag === 'unknown') {
          row.injection = 'Sem veredito de injeção neste retorno.'
          return
        }
        row.injection = verdict.text || (verdict.flag === 'clean' ? 'Guarda de injeção: limpo.' : 'Guarda de injeção pediu revisão.')
        row.status = worse(row.status, verdict.flag === 'clean' ? 'clean' : verdict.flag)
        if (verdict.flag !== 'clean' && verdict.text) {
          row.findings = [...row.findings, { severity: verdict.flag === 'blocked' ? 'critical' : 'medium', title: 'Prompt injection', detail: verdict.text }]
        }
      })
    } catch (e: any) {
      const msg = e?.message ?? 'O guarda de injeção não respondeu.'
      for (const file of files) {
        const row = byPath.get(file.name)
        if (!row) continue
        row.status = worse(row.status, 'unavailable')
        row.injection = msg.slice(0, 240)
      }
    }
  }

  for (const row of threats) {
    if (!row.summary) {
      row.summary = row.injection || (row.status === 'clean'
        ? 'Nenhum achado de robustez e nenhum veredito de injeção preocupante.'
        : 'A análise não fechou um parecer.')
    }
  }

  saveSkillThreats(memory, threats)
  memory.write('insights/skill-threats.md', renderThreats(threats))
  const notes = loadSakNotes(memory)
  return { threats, hints: evolutionHints(listVaultSkills(memory), notes, threats) }
}

export async function installSkill(memory: Memory, slug: string): Promise<VaultSkill> {
  const report = await skillTrust(slug).catch(() => null)
  if (report?.status === 'blocked') {
    throw new Error(`O SuperagentSkill recusou "${slug}": ${report.summary}`)
  }
  const pkg = await callTool('get_package', { slug })
  if (!pkg || pkg.text) throw new Error(`Pacote "${slug}" não encontrado no SuperagentSkill.`)

  const meta = pkg.package ?? {}
  const ver = pkg.version ?? pkg.manifest ?? {}
  const name = String(meta.name ?? pkg.name ?? slug)
  const sections: string[] = []
  if (ver.system_prompt) sections.push(`## System prompt\n\n${ver.system_prompt}`)
  if (ver.rules) {
    const rules = Array.isArray(ver.rules) ? ver.rules : Object.entries(ver.rules).map(([k, v]) => `${k}: ${v}`)
    if (rules.length) sections.push(`## Rules\n\n${rules.map((r: any) => `- ${typeof r === 'string' ? r : JSON.stringify(r)}`).join('\n')}`)
  }
  if (ver.examples?.length) {
    sections.push(`## Examples\n\n${ver.examples.map((e: any) => typeof e === 'string' ? e : `### ${e.title ?? 'Example'}\n\n${e.content ?? e.input ?? ''}`).join('\n\n')}`)
  }
  if (meta.long_description) sections.push(`## About\n\n${meta.long_description}`)

  const body = `---
name: ${name}
source: superagentskill.com/${slug}
type: ${meta.type ?? pkg.type ?? 'skill'}
version: ${meta.latest_version ?? ver.version ?? ''}
installed: ${new Date().toISOString().slice(0, 10)}
---

# ${name}

${meta.description ?? pkg.description ?? ''}

${sections.join('\n\n')}
`
  const rel = `skills/${slug}.md`
  memory.write(rel, body)
  const installed = listVaultSkills(memory).find(s => s.path === rel)
  if (!installed) throw new Error('A skill foi gravada, mas não apareceu no cofre.')
  return installed
}
