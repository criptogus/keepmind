#!/usr/bin/env node
// keepmind-mcp — exposes a KeepMind memory directory over MCP (stdio).
//
// Zero dependencies, plain Node >= 18. Point it at any clone/copy of the
// memory repo and any MCP-capable agent (Claude, Codex, Grok, Gemini, custom
// bots) gets structured read/write/search access to the brain.
//
// Usage:
//   node tools/keepmind-mcp.mjs --dir /path/to/memory
//   SECOND_BRAIN_DIR=/path/to/memory npx keepmind-mcp
//
// Inside a cloned second-brain repo the default `./memory` just works.

import { createInterface } from 'node:readline'
import { readdirSync, readFileSync, writeFileSync, appendFileSync, statSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve, sep, dirname } from 'node:path'

// ── config ──

const args = process.argv.slice(2)
const dirArg = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : null
const ROOT = resolve(dirArg ?? process.env.SECOND_BRAIN_DIR ?? './memory')

function safe(rel) {
  const p = resolve(ROOT, String(rel ?? '').replace(/^\/+/, ''))
  if (p !== ROOT && !p.startsWith(ROOT + sep)) throw new Error(`path escapes memory root: ${rel}`)
  return p
}

function* walk(dir, prefix = '') {
  if (!existsSync(dir)) return
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) yield* walk(join(dir, e.name), rel)
    else if (e.name.endsWith('.md')) yield rel
  }
}

const allFiles = () => [...walk(ROOT)]

function readMem(rel) {
  const p = safe(rel)
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

function writeMem(rel, content, append = false) {
  const p = safe(rel)
  mkdirSync(dirname(p), { recursive: true })
  if (append) appendFileSync(p, content, 'utf8')
  else writeFileSync(p, content, 'utf8')
  return rel
}

// ── lexical search (BM25-ish, no deps) ──

const STOP = new Set(('the a an and or of to in on for with is are was were be been it its this that you your we our they their he she i me my not no do does did have has had will would can could should about as at by from into over after before between under again further then once here there when where why how all any both each few more most other some such only own same so than too very just also').split(' '))

function terms(text) {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,}/gu) ?? [])
    .filter(w => w.length > 2 && !STOP.has(w))
}

function search(query, limit = 8) {
  const qTerms = [...new Set(terms(query))]
  if (!qTerms.length) return 'empty query'
  const qSet = new Set(qTerms)
  const results = []
  for (const rel of allFiles()) {
    const content = readMem(rel)
    if (!content) continue
    const words = terms(content)
    if (!words.length) continue
    let score = 0
    const counts = new Map()
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1)
    for (const t of qTerms) {
      const c = counts.get(t) ?? 0
      if (c) score += Math.min(c, 5) * (t.length > 4 ? 2 : 1)
    }
    // phrase bonus
    const lower = content.toLowerCase()
    if (lower.includes(query.toLowerCase())) score += 10
    if (score <= 0) continue
    // snippet: first line containing a query term
    const lines = content.split('\n')
    const hit = lines.find(l => qTerms.some(t => l.toLowerCase().includes(t))) ?? lines[0] ?? ''
    results.push({ rel, score, snippet: hit.trim().slice(0, 220) })
  }
  results.sort((a, b) => b.score - a.score)
  if (!results.length) {
    // zero-hit = a knowledge gap. Log it so sleep/evolve cycles can see
    // what the brain fails to answer (inspired by vault evolve_lib gaps).
    try {
      writeMem('ops/search-gaps.md',
        `\n- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} — "${query.replace(/\n/g, ' ').slice(0, 120)}"\n`, true)
    } catch { /* non-fatal */ }
    return `no matches for "${query}"`
  }
  return results.slice(0, limit).map(r =>
    `## ${r.rel} (score ${r.score})\n${r.snippet}`).join('\n\n')
}

// ── tasks (memory/tasks/*.md — "# title" + "> status: …" meta line) ──

function listTasks(status) {
  const dir = join(ROOT, 'tasks')
  if (!existsSync(dir)) return 'no tasks yet'
  const out = []
  for (const f of readdirSync(dir).filter(f => f.endsWith('.md'))) {
    const c = readMem(`tasks/${f}`) ?? ''
    const title = (c.split('\n').find(l => l.startsWith('# ')) ?? '# ').slice(2).trim()
    const meta = (c.split('\n').find(l => l.startsWith('> ')) ?? '').replace(/^>\s*/, '')
    const done = /status:\s*done/.test(meta)
    const due = meta.match(/due:\s*(\S+)/)?.[1] ?? ''
    const pri = meta.match(/priority:\s*(\S+)/)?.[1] ?? 'normal'
    if (status === 'open' && done) continue
    if (status === 'done' && !done) continue
    out.push(`${done ? '[x]' : '[ ]'} ${title}${pri !== 'normal' ? ` (${pri})` : ''}${due ? ` — due ${due}` : ''} · tasks/${f}`)
  }
  return out.length ? out.join('\n') : `no ${status ?? ''} tasks`
}

// ── structured query: filter tasks / notes / entities ──

function parseTaskMeta(c) {
  const title = (c.split('\n').find(l => l.startsWith('# ')) ?? '# ').slice(2).trim()
  const meta = (c.split('\n').find(l => l.startsWith('> ')) ?? '').replace(/^>\s*/, '')
  return {
    title, meta, done: /status:\s*done/.test(meta),
    due: meta.match(/due:\s*(\S+)/)?.[1] ?? '',
    pri: meta.match(/priority:\s*(\S+)/)?.[1] ?? 'normal'
  }
}

function queryMem(a = {}) {
  const kind = String(a.kind ?? 'tasks')
  const limit = Math.min(a.limit ?? 20, 100)
  const text = String(a.text ?? '').toLowerCase()
  const match = (s) => !text || String(s).toLowerCase().includes(text)

  if (kind === 'tasks') {
    const dir = join(ROOT, 'tasks')
    if (!existsSync(dir)) return 'no tasks yet'
    const out = []
    for (const f of readdirSync(dir).filter(f => f.endsWith('.md'))) {
      const c = readMem(`tasks/${f}`) ?? ''
      const t = parseTaskMeta(c)
      if (a.status === 'open' && t.done) continue
      if (a.status === 'done' && !t.done) continue
      if (a.priority && t.pri !== a.priority) continue
      if (a.dueBefore && t.due && t.due >= String(a.dueBefore)) continue
      if (a.dueAfter && t.due && t.due <= String(a.dueAfter)) continue
      if (a.overdue === true && (!t.due || t.done || t.due >= new Date().toISOString().slice(0, 10))) continue
      if (!match(t.title) && !match(c.slice(0, 400))) continue
      out.push(`${t.done ? '[x]' : '[ ]'} ${t.title} · ${t.pri}${t.due ? ` · due ${t.due}` : ''} · tasks/${f}`)
    }
    return out.length ? out.slice(0, limit).join('\n') : 'no matching tasks'
  }

  if (kind === 'notes') {
    const files = allFiles().filter(f => f.startsWith('notes/'))
    const out = []
    for (const f of files) {
      const c = readMem(f) ?? ''
      const title = (c.split('\n').find(l => l.startsWith('# ')) ?? f).slice(2).trim()
      const tags = [...c.matchAll(/#([\p{L}\p{N}_-]{2,})/gu)].map(m => m[1].toLowerCase())
      if (a.tag && !tags.includes(String(a.tag).toLowerCase().replace(/^#/, ''))) continue
      if (!match(title) && !match(c.slice(0, 800))) continue
      out.push(`${title} · ${f}${tags.length ? ` · #${[...new Set(tags)].slice(0, 5).join(' #')}` : ''}`)
    }
    return out.length ? out.slice(0, limit).join('\n') : 'no matching notes'
  }

  if (kind === 'crm') {
    const files = allFiles().filter(f => f.startsWith('crm/'))
    const out = []
    for (const f of files) {
      const c = readMem(f) ?? ''
      const title = (c.split('\n').find(l => l.startsWith('# ')) ?? f).slice(2).trim()
      const role = c.match(/^role:\s*(.+)$/m)?.[1]?.trim() ?? ''
      const company = c.match(/^company:\s*(.+)$/m)?.[1]?.trim() ?? ''
      if (!match(title) && !match(c.slice(0, 800))) continue
      out.push(`${title}${role ? ` · ${role}` : ''}${company ? ` @ ${company}` : ''} · ${f}`)
    }
    return out.length ? out.slice(0, limit).join('\n') : 'no matching crm entries'
  }

  if (kind === 'entities') {
    const idx = readMem('entities/index.md') ?? ''
    const rows = idx.split('\n').filter(l => l.includes('[['))
    const out = rows.filter(l => match(l)).map(l => l.replace(/^- /, '').trim())
    return out.length ? out.slice(0, limit).join('\n') : 'no matching entities'
  }

  if (kind === 'files' || kind === 'memory') {
    const dir = String(a.dir ?? '').replace(/\/$/, '')
    const out = allFiles()
      .filter(f => (!dir || f === dir || f.startsWith(dir + '/')) && match(readMem(f) ?? ''))
      .slice(0, limit)
    return out.length ? out.join('\n') : 'no matching files'
  }

  return `unknown kind "${kind}" — use tasks|notes|entities|files`
}

// ── tools ──

const TOOLS = [
  {
    name: 'sb_search',
    description: 'Search the second-brain memory (Markdown files) for a query. Returns matching files with snippets. Use this BEFORE answering questions about the user — their knowledge lives here.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'search terms' },
      limit: { type: 'number', description: 'max results (default 8)' }
    }, required: ['query'] }
  },
  {
    name: 'sb_read',
    description: 'Read a memory file by path relative to the memory root (e.g. "long-term/facts.md", "notes/x.md", "short-term/2026-01-01.md").',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  },
  {
    name: 'sb_write',
    description: 'Write (create or overwrite) a memory file. Use for notes/, long-term/, tasks/, daily/ etc. Path relative to memory root.',
    inputSchema: { type: 'object', properties: {
      path: { type: 'string' }, content: { type: 'string' }
    }, required: ['path', 'content'] }
  },
  {
    name: 'sb_append',
    description: 'Append content to a memory file (creates it if missing).',
    inputSchema: { type: 'object', properties: {
      path: { type: 'string' }, content: { type: 'string' }
    }, required: ['path', 'content'] }
  },
  {
    name: 'sb_remember',
    description: 'Save a durable fact/lesson/skill/note to long-term memory — the thing the brain should never forget. kind: fact|lesson|skill|note.',
    inputSchema: { type: 'object', properties: {
      content: { type: 'string', description: 'the thing to remember' },
      kind: { type: 'string', enum: ['fact', 'lesson', 'skill', 'note', 'decision'], description: 'default fact' }
    }, required: ['content'] }
  },
  {
    name: 'sb_recent',
    description: 'List memory files modified in the last N days (default 7), newest first — "what happened lately".',
    inputSchema: { type: 'object', properties: { days: { type: 'number' } } }
  },
  {
    name: 'sb_list',
    description: 'List Markdown files under a memory subdirectory (e.g. "notes", "tasks", "entities"). Empty dir = whole memory.',
    inputSchema: { type: 'object', properties: { dir: { type: 'string' } } }
  },
  {
    name: 'sb_tree',
    description: 'Full recursive listing of every memory file.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'sb_tasks',
    description: 'List tasks from memory/tasks/. status: open|done|all.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'done', 'all'] } } }
  },
  {
    name: 'sb_query',
    description: 'Structured query over memory. kind: tasks|notes|entities|files. Filters: text (substring), tag (notes), status/priority/dueBefore/dueAfter/overdue (tasks), dir (files), limit.',
    inputSchema: { type: 'object', properties: {
      kind: { type: 'string', enum: ['tasks', 'notes', 'entities', 'files', 'crm'] },
      text: { type: 'string' }, tag: { type: 'string' }, dir: { type: 'string' },
      status: { type: 'string' }, priority: { type: 'string' },
      dueBefore: { type: 'string', description: 'YYYY-MM-DD' },
      dueAfter: { type: 'string', description: 'YYYY-MM-DD' },
      overdue: { type: 'boolean' },
      limit: { type: 'number' }
    } }
  }
]

function callTool(name, a = {}) {
  switch (name) {
    case 'sb_search': return search(String(a.query ?? ''), a.limit ?? 8)
    case 'sb_read': {
      const c = readMem(String(a.path ?? ''))
      return c ?? `not found: ${a.path}`
    }
    case 'sb_write': return `wrote ${writeMem(String(a.path ?? ''), String(a.content ?? ''))}`
    case 'sb_append': return `appended to ${writeMem(String(a.path ?? ''), String(a.content ?? ''), true)}`
    case 'sb_remember': {
      const kind = ['fact', 'lesson', 'skill', 'note', 'decision'].includes(a.kind) ? a.kind : 'fact'
      const file = kind === 'note' ? `long-term/notes/${slug(String(a.content).split('\n')[0]).slice(0, 60)}.md`
        : kind === 'decision' ? 'long-term/decisions.md'
        : `long-term/${kind}s.md`
      const entry = kind === 'note'
        ? `# ${String(a.content).split('\n')[0]}\n\n${a.content}\n\n---\nsaved ${new Date().toISOString()}\n`
        : `\n- ${String(a.content).replace(/\n+/g, ' ').trim()}\n`
      return `remembered → ${writeMem(file, entry, kind !== 'note')}`
    }
    case 'sb_recent': {
      const days = a.days ?? 7
      const cutoff = Date.now() - days * 864e5
      const rows = allFiles()
        .map(rel => ({ rel, m: statSync(safe(rel)).mtimeMs }))
        .filter(r => r.m >= cutoff)
        .sort((x, y) => y.m - x.m)
      return rows.length ? rows.map(r => `${new Date(r.m).toISOString().slice(0, 10)}  ${r.rel}`).join('\n') : `nothing in the last ${days} days`
    }
    case 'sb_list': {
      const dir = String(a.dir ?? '')
      const files = allFiles().filter(f => !dir || f === dir || f.startsWith(dir.replace(/\/$/, '') + '/'))
      return files.length ? files.join('\n') : '(empty)'
    }
    case 'sb_tree': return allFiles().join('\n') || '(empty memory)'
    case 'sb_tasks': return listTasks(a.status && a.status !== 'all' ? a.status : undefined)
    case 'sb_query': return queryMem(a)
    default: throw new Error(`unknown tool: ${name}`)
  }
}

function slug(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'note'
}

// ── MCP stdio JSON-RPC ──

const PROTOCOL_VERSION = '2024-11-05'

function ok(id, result) { return { jsonrpc: '2.0', id, result } }
function err(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } } }

function handle(msg) {
  const { id, method, params } = msg
  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'keepmind', version: '1.0.0' }
    })
  }
  if (method === 'ping') return ok(id, {})
  if (method === 'tools/list') return ok(id, { tools: TOOLS })
  if (method === 'tools/call') {
    try {
      const text = callTool(params?.name, params?.arguments ?? {})
      return ok(id, { content: [{ type: 'text', text: String(text) }] })
    } catch (e) {
      return ok(id, { content: [{ type: 'text', text: `error: ${e.message}` }], isError: true })
    }
  }
  if (method === 'resources/list') {
    const resources = allFiles().slice(0, 500).map(rel => ({
      uri: `memory://${rel}`,
      name: rel,
      mimeType: 'text/markdown'
    }))
    return ok(id, { resources })
  }
  if (method === 'resources/read') {
    const uri = String(params?.uri ?? '')
    if (!uri.startsWith('memory://')) return err(id, -32602, 'unsupported uri')
    const rel = uri.slice('memory://'.length)
    const c = readMem(rel)
    if (c == null) return err(id, -32002, `not found: ${rel}`)
    return ok(id, { contents: [{ uri, mimeType: 'text/markdown', text: c }] })
  }
  if (id === undefined) return null // notification — no response
  return err(id, -32601, `method not found: ${method}`)
}

const rl = createInterface({ input: process.stdin, terminal: false })
rl.on('line', line => {
  const trimmed = line.trim()
  if (!trimmed) return
  let msg
  try { msg = JSON.parse(trimmed) } catch { return }
  const res = handle(msg)
  if (res) process.stdout.write(JSON.stringify(res) + '\n')
})

process.stderr.write(`[keepmind-mcp] serving memory at ${ROOT}\n`)
