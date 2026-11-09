import type { Memory } from './brain'

// ── SkillsHub: the second brain's skill bank + registry suggestions ──
// Vault skills live in memory/skills/*.md (written by the evolve/skills
// crons or installed from the public registry). Suggestions come from
// superagentskill.com's public MCP endpoint — read-only, no auth.

const ENDPOINT = 'https://superagentskill.com/api/public/mcp'

async function mcpCall(method: string, params: unknown): Promise<any> {
  let res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
  })
  // registry rate-limits bursts — one patient retry
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
  // streamable-HTTP MCP responds as SSE: `event: message\ndata: {json}`
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue
    try {
      const j = JSON.parse(line.slice(5).trim())
      if (j?.result !== undefined) return j.result
      if (j?.error) throw new Error(j.error.message ?? 'registry error')
    } catch (e) {
      if (e instanceof Error && e.message === 'registry error') throw e
    }
  }
  try { return JSON.parse(text)?.result ?? null } catch { return null }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<any> {
  const r = await mcpCall('tools/call', { name, arguments: args })
  const txt = r?.content?.[0]?.text
  if (!txt) return null
  try { return JSON.parse(txt) } catch { return null }
}

export interface VaultSkill {
  file: string
  path: string
  group: string
  title: string
  ageDays: number
}

export interface SkillSuggestion {
  slug: string
  name: string
  description: string
  type: string
  installs: number
  alreadyHave: boolean
}

// Skills live wherever the vault keeps them: canonical `SKILL.md` agent
// packages anywhere in the tree (Hermes/Obsidian imports), plus native
// memory/skills/*.md written by KeepMind's own crons.
export function listVaultSkills(memory: Memory): VaultSkill[] {
  const now = Date.now()
  const out: VaultSkill[] = []
  const seen = new Set<string>()

  const push = (rel: string, group: string) => {
    if (seen.has(rel)) return
    seen.add(rel)
    const content = memory.read(rel) ?? ''
    const fm = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
    const title = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim()
      ?? content.match(/^#\s+(.+)$/m)?.[1]?.trim()
      ?? rel.split('/').filter(Boolean).pop()!.replace(/\.md$/i, '')
    const mtime = memory.fileMtime(rel) ?? now
    out.push({
      file: rel.split('/').pop()!,
      path: rel,
      group,
      title,
      ageDays: Math.floor((now - mtime) / 86_400_000)
    })
  }

  for (const rel of memory.allRelFiles()) {
    if (!rel.endsWith('.md')) continue
    const base = rel.split('/').pop()!
    if (base === 'SKILL.md') {
      // canonical agent skill package at <category>/<skill>/SKILL.md —
      // group by the category dir (grandparent), falling back to the
      // top-level vault area for flat layouts
      const parts = rel.split('/')
      push(rel, parts.length >= 3 ? parts[parts.length - 3] : parts[0])
    } else if (rel.startsWith('skills/') && !rel.slice(7).includes('/')) {
      push(rel, 'keepmind')
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

// Queries chosen to cover what a second brain actually needs — memory
// hygiene, research, automation, writing, security.
const SUGGESTION_QUERIES = [
  'memory', 'knowledge management', 'research', 'automation', 'writing', 'security audit'
]

export async function suggestSkills(memory: Memory): Promise<SkillSuggestion[]> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const have = new Set(
    listVaultSkills(memory).flatMap(s => [
      norm(s.title),
      // native skills/<slug>.md installs dedupe by slug
      ...(s.path.startsWith('skills/') ? [s.path.slice(7).replace(/\.md$/, '')] : [])
    ])
  )
  const seen = new Set<string>()
  const out: SkillSuggestion[] = []

  // query the registry in parallel, keep the best-installed unique hits
  const results = await Promise.allSettled(
    SUGGESTION_QUERIES.map(q => callTool('search_registry', { query: q, limit: 6 }))
  )
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value) continue
    const items = r.value.items ?? r.value.results ?? []
    for (const it of items) {
      const slug = String(it.slug ?? it.id ?? '').toLowerCase()
      if (!slug || seen.has(slug)) continue
      seen.add(slug)
      out.push({
        slug,
        name: String(it.name ?? slug),
        description: String(it.description ?? it.long_description ?? '').slice(0, 220),
        type: String(it.type ?? 'skill'),
        installs: Number(it.install_count ?? it.installs ?? 0),
        alreadyHave: have.has(slug) || have.has(norm(String(it.name ?? '')))
      })
    }
  }
  return out.sort((a, b) => b.installs - a.installs).slice(0, 12)
}

// Install a registry package as a vault skill page — it syncs to GitHub and
// becomes usable by every connected agent on next pull.
export async function installSkill(memory: Memory, slug: string): Promise<VaultSkill> {
  const pkg = await callTool('get_package', { slug })
  if (!pkg) throw new Error(`Package "${slug}" not found in registry`)

  // response shape: { package: {...meta}, version: { system_prompt, rules, examples } }
  const meta = pkg.package ?? {}
  const ver = pkg.version ?? pkg.manifest ?? {}
  const name = String(meta.name ?? pkg.name ?? slug)
  const sections: string[] = []
  if (ver.system_prompt) sections.push(`## System prompt\n\n${ver.system_prompt}`)
  if (ver.rules) {
    const rules = Array.isArray(ver.rules) ? ver.rules : Object.entries(ver.rules).map(([k, v]) => `${k}: ${v}`)
    if (rules.length) sections.push(`## Rules\n\n${rules.map((r: any) => `- ${typeof r === 'string' ? r : JSON.stringify(r)}`).join('\n')}`)
  }
  if (ver.examples?.length) sections.push(`## Examples\n\n${ver.examples.map((e: any) => typeof e === 'string' ? e : `### ${e.title ?? 'Example'}\n\n${e.content ?? e.input ?? ''}`).join('\n\n')}`)
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
  const file = `${slug}.md`
  const rel = `skills/${file}`
  memory.write(rel, body)
  return { file, path: rel, group: 'registry', title: name, ageDays: 0 }
}
