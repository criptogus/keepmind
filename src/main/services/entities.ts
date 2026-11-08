import type { Memory } from './brain'

// ── Entity layer: one Markdown page per recurring person/project/topic ──
//
// Inspired by knowledge-graph second brains (Basic Memory, second-brain-os):
// entities are the nodes; [[wikilinks]] are the edges. Pages live in
// memory/entities/ so they sync to GitHub and are readable by any agent.
// Extraction is heuristic + optional LLM cleanup — no vector DB needed.

const STOP = new Set([
  // english
  'the','a','an','and','or','of','to','in','on','for','with','is','are','was','were','be','been',
  'it','its','this','that','you','your','we','our','they','their','he','she','i','me','my','not',
  'do','does','did','have','has','had','will','would','can','could','should','about','as','at',
  'by','from','into','over','after','before','between','under','then','than','when','where','why',
  'how','all','any','both','each','more','most','other','some','such','only','own','same','so',
  'too','very','just','also','what','which','who','whom','these','those','am','if','but','out',
  // time
  'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
  'january','february','march','april','may','june','july','august','september','october',
  'november','december','today','tomorrow','yesterday','week','month','year','daily','weekly',
  // product / tech noise
  'second','brain','github','markdown','mcp','json','html','css','api','pdf','todo','note',
  'llm','ai','app','app','user','users','file','files','data','memory','agent','agents'
])

const ENTITY_RE = /\b([A-Z][\p{L}\p{N}]*(?:[\s-][A-Z][\p{L}\p{N}]*){0,3})\b/gu
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g

function slug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

interface EntityHit { name: string; files: Set<string>; count: number }

// Backlinks: which memory files explicitly link to each entity via [[Name]].
// Returns Map<entity-slug, Set<file>>. Scans the whole memory tree once.
function computeBacklinks(memory: Memory): Map<string, Set<string>> {
  const links = new Map<string, Set<string>>()
  for (const rel of memory.allRelFiles()) {
    if (rel.startsWith('entities/')) continue // entity pages don't count as sources
    const content = memory.read(rel)
    if (!content) continue
    for (const m of content.matchAll(WIKILINK_RE)) {
      const target = m[1].split('|')[0].trim()
      const key = slug(target)
      if (!key) continue
      if (!links.has(key)) links.set(key, new Set())
      links.get(key)!.add(rel)
    }
  }
  return links
}

// Scan recent memory for capitalized entity candidates + existing [[links]]
function extractCandidates(memory: Memory): Map<string, EntityHit> {
  const hits = new Map<string, EntityHit>()
  const bump = (name: string, file: string) => {
    const clean = name.trim()
    if (clean.length < 3 || clean.split(/\s+/).every(w => STOP.has(w.toLowerCase()))) return
    const key = clean.toLowerCase()
    if (!hits.has(key)) hits.set(key, { name: clean, files: new Set(), count: 0 })
    const h = hits.get(key)!
    h.files.add(file)
    h.count++
  }

  const files: string[] = []
  // recent short-term logs
  for (const f of memory.shortTermFiles().slice(-7)) files.push(`short-term/${f}`)
  for (const f of memory.list(memory.scopePath('inbox')).slice(-5)) files.push(`inbox/${f}`)
  // notes + tasks titles
  for (const f of memory.list(memory.scopePath('notes'))) files.push(`notes/${f}`)
  for (const f of memory.list(memory.scopePath('tasks')).slice(0, 30)) files.push(`tasks/${f}`)
  // existing entity pages (keep them alive even if quiet this week)
  for (const f of memory.list(memory.scopePath('entities'))) files.push(`entities/${f}`)

  for (const rel of files) {
    const content = memory.read(memory.scopePath(rel))
    if (!content) continue
    for (const m of content.matchAll(WIKILINK_RE)) bump(m[1], rel)
    for (const m of content.matchAll(ENTITY_RE)) bump(m[1], rel)
  }
  return hits
}

// Optional LLM pass: ask for the canonical entity list + one-line descriptions.
// Returns Map<lowercase name, description> or empty on failure.
async function llmDescribe(
  candidates: string[],
  complete: (prompt: string) => Promise<string>
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!candidates.length) return out
  try {
    const prompt = `From this list of entity candidates extracted from a personal knowledge base, return ONLY lines in the exact format "Name | one-line description (max 15 words)". Skip generic words, keep real people, projects, companies, products, places. No commentary, no markdown.\n\nCandidates:\n${candidates.slice(0, 40).join('\n')}`
    const res = await complete(prompt)
    for (const line of res.split('\n')) {
      const [name, desc] = line.split('|').map(s => s.trim())
      if (name && desc) out.set(name.toLowerCase(), desc)
    }
  } catch { /* heuristic-only mode */ }
  return out
}

export interface EntityRefreshResult { created: number; updated: number; total: number }

export async function refreshEntities(
  memory: Memory,
  complete?: (prompt: string) => Promise<string>
): Promise<EntityRefreshResult> {
  const hits = extractCandidates(memory)
  // keep entities seen >=2 times OR already having a page
  const kept = [...hits.values()]
    .filter(h => h.count >= 2 || memory.read(memory.scopePath(`entities/${slug(h.name)}.md`)) != null)
    .sort((a, b) => b.count - a.count)
    .slice(0, 60)

  const descriptions = complete
    ? await llmDescribe(kept.map(k => k.name), complete)
    : new Map<string, string>()

  const backlinks = computeBacklinks(memory)
  const today = new Date().toISOString().slice(0, 10)
  let created = 0, updated = 0

  for (const h of kept) {
    const file = `entities/${slug(h.name)}.md`
    const existed = memory.read(memory.scopePath(file)) != null
    const desc = descriptions.get(h.name.toLowerCase())
    const sources = [...h.files].sort().slice(0, 25)
    const linkedFrom = [...(backlinks.get(slug(h.name)) ?? [])]
      .filter(f => f !== file).sort().slice(0, 25)
    const body = [
      `# ${h.name}\n`,
      `> entity · first seen ${today} · mentioned ${h.count}× in scanned memory\n`,
      desc ? `\n${desc}\n` : '',
      `\n## Sources\n`,
      ...sources.map(s => `- ${s}`),
      linkedFrom.length ? `\n## Linked from\n` + linkedFrom.map(s => `- ${s}`).join('\n') + '\n' : '',
      `\n## Notes\n\n_(agents and the user can add durable context here)_\n`
    ].join('\n')
    memory.write(memory.scopePath(file), body)
    existed ? updated++ : created++
  }

  // index catalog
  const index = [
    '# Entities\n',
    `_auto-generated ${today} — ${kept.length} entities, sorted by mentions_\n`,
    '',
    ...kept.map(h => `- [[${h.name}]] — ${h.count} mentions`)
  ].join('\n')
  memory.write(memory.scopePath('entities/index.md'), index + '\n')

  return { created, updated, total: kept.length }
}
