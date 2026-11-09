import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import {
  resolveInside, canReadFile, canWriteFile, walkMarkdown, scanText, readAudit, autonomyRank, PROVIDERS
} from './lib.mjs'
import { userMemoryRoot, memoryRel, ensureUserBrain } from './memory-layout.mjs'

export function mountBrainApi({ vault, getOrg, audit }) {
  return async function brainApi(req, res, url, user) {
    if (!url.pathname.startsWith('/api/brain/')) return false
    const org = getOrg()
    ensureUserBrain(vault, user.id, user.name)
    const sub = url.pathname.slice('/api/brain/'.length)

  if (sub === 'config' && req.method === 'GET') {
    const team = org.teams.find(t => t.id === user.teamId) ?? org.teams[0]
    const providers = org.policy.providers.filter(p => PROVIDERS.includes(p))
    return json(res, 200, {
      onboardingDone: true,
      edition: 'keepmind-corp',
      autonomy: team.autonomy,
      ai: { provider: providers[0] ?? 'local', model: 'org-default' },
      localLlm: { modelId: 'qwen2.5-3b' },
      github: { repoUrl: null, login: org.name },
      mcpServers: org.agents.filter(a => a.enabled).map(a => ({ id: a.id, name: a.name, kind: a.id, enabled: true })),
      agents: [{ id: 'brain', name: 'KeepMind', emoji: '🧠', persona: 'Corporate second brain.', builtin: true }],
      automations: [],
      corp: {
        role: user.role,
        org: org.name,
        providers,
        byokRequired: org.policy.byokRequired,
        autonomyCeiling: org.policy.autonomyCeiling,
        teamAutonomy: team.autonomy,
        adminUrl: canAdmin(user) ? '/admin/' : null
      }
    })
  }

  if (sub === 'governance' && req.method === 'GET') {
    return json(res, 200, { policy: org.policy, team: user.teamId, role: user.role })
  }

  if (sub === 'ledger' && req.method === 'GET') {
    const limit = Number(url.searchParams.get('limit') || 40)
    const entries = readAudit(vault, limit).map(row => ({
      ts: row.ts,
      verb: ledgerVerb(row.op),
      sentence: ledgerSentence(row),
      path: row.path
    }))
    return json(res, 200, entries)
  }

  if (sub === 'health' && req.method === 'GET') {
    return json(res, 200, healthForUser(vault, user.id))
  }

  if (sub === 'graph' && req.method === 'GET') {
    return json(res, 200, graphForUser(vault, user))
  }

  if (sub === 'activity' && req.method === 'GET') {
    const limit = Number(url.searchParams.get('limit') || 30)
    return json(res, 200, readAudit(vault, limit).slice(0, limit))
  }

  if (sub === 'memory' && req.method === 'GET') {
    return json(res, 200, listMemory(vault, user))
  }

  if (sub === 'memory/file' && req.method === 'GET') {
    const rel = url.searchParams.get('path') || ''
    const abs = memoryPath(vault, user, rel)
    if (!abs) return json(res, 400, { error: 'bad_path' })
    if (!existsSync(abs)) return json(res, 404, { error: 'not_found' })
    const raw = readFileSync(abs, 'utf8')
    return json(res, 200, { path: rel, content: raw.startsWith('KMS1\n') ? '' : raw })
  }

  if (sub === 'search' && req.method === 'GET') {
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase()
    const hits = []
    for (const file of memoryFiles(vault, user)) {
      if (!q) break
      try {
        const content = readFileSync(file.abs, 'utf8')
        if (content.toLowerCase().includes(q)) {
          const i = content.toLowerCase().indexOf(q)
          hits.push({ path: file.rel.replace(/^people\/[^/]+\/memory\//, ''), title: file.rel, snippet: content.slice(Math.max(0, i - 40), i + 80) })
        }
      } catch { /* skip */ }
      if (hits.length >= 20) break
    }
    return json(res, 200, { hits, semantic: false, notice: 'Corporate web edition: text search over your vault partition.', asOf: null })
  }

  if (sub === 'facts' && req.method === 'GET') {
    return json(res, 200, [])
  }

  if (sub === 'briefing' && req.method === 'GET') {
    return json(res, 200, { text: `Good ${timeOfDay()}. Your corporate second brain is live. Policy ceiling: ${org.policy.autonomyCeiling}.` })
  }

  if (sub === 'policy' && req.method === 'GET') {
    return json(res, 200, { active: 'Organization policy applies. Personal API keys are blocked.', proposals: [] })
  }

  if (sub === 'eval' && req.method === 'GET') {
    return json(res, 200, { questions: [], last: null })
  }

  if (sub === 'list-sleep' && req.method === 'GET') {
    return json(res, 200, [])
  }

  if (sub === 'capture' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const text = String(body.text || '').trim()
    if (!text) return json(res, 400, { error: 'empty' })
    const day = new Date().toISOString().slice(0, 10)
    const rel = memoryRel(user.id, `inbox/${day}.md`)
    const abs = path.join(vault, ...rel.split('/'))
    const stamp = new Date().toISOString()
    const block = `\n\n## Capture ${stamp}\n${text}\n`
    if (existsSync(abs)) writeFileSync(abs, readFileSync(abs, 'utf8') + block)
    else writeFileSync(abs, `# ${day}\n${block}`)
    audit(user, 'capture', { path: rel })
    return json(res, 200, 'Saved to your inbox.')
  }

  if (sub === 'chat' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const message = String(body.message || '')
    const reply = [
      '**KeepMind Corp (web)**',
      '',
      `You asked: ${message.slice(0, 200)}`,
      '',
      'Full agentic chat on the org LLM ships next. Your memory, skills, and governance already live in this vault.'
    ].join('\n')
    return json(res, 200, { reply })
  }

  if (sub === 'config' && req.method === 'PATCH') {
    const body = await readJsonBody(req)
    if (body.autonomy) {
      const ceiling = org.policy.autonomyCeiling
      if (autonomyRank(body.autonomy) > autonomyRank(ceiling)) {
        return json(res, 400, { error: 'above_ceiling', message: `Autonomy cannot exceed ${ceiling}.` })
      }
    }
    if (body.apiKey || body.openaiKey || body.anthropicKey) {
      return json(res, 400, { error: 'shadow_key', message: 'Provider keys are organization-managed.' })
    }
    return json(res, 200, { ok: true })
  }

  return json(res, 404, { error: 'not_found' })
  }
}

function canAdmin(user) {
  return user.role === 'owner' || user.role === 'admin'
}

function memoryPath(vault, user, rel) {
    const full = memoryRel(user.id, rel)
    const located = resolveInside(vault, full)
    if (!located || !canReadFile(user.role, user.id, located.rel)) return null
    return located.abs
  }

function listMemory(vault, user) {
    return memoryFiles(vault, user).map(f => ({
      path: f.rel.replace(/^people\/[^/]+\/memory\//, ''),
      content: ''
    }))
  }

function memoryFiles(vault, user) {
  const root = userMemoryRoot(vault, user.id)
  const files = walkMarkdown(root)
  const shared = walkMarkdown(path.join(vault, 'shared', 'memory')).filter(f => canReadFile(user.role, user.id, `shared/memory/${f.rel}`))
  return [
    ...files.map(f => ({ rel: memoryRel(user.id, f.rel), abs: f.abs })),
    ...shared.map(f => ({ rel: `shared/memory/${f.rel}`, abs: f.abs }))
  ]
}

function healthForUser(vault, userId) {
  const root = userMemoryRoot(vault, userId)
  const files = walkMarkdown(root)
  const md = files.length
  const skills = files.filter(f => f.rel.startsWith('skills/')).length
  return {
    stats: {
      files: md,
      mdFiles: md,
      entities: files.filter(f => f.rel.startsWith('entities/')).length,
      writes7d: md,
      topSources: [{ source: 'inbox', count: files.filter(f => f.rel.startsWith('inbox/')).length }],
      automationsEnabled: 0,
      automationsTotal: 0,
      skills
    },
    recommendations: []
  }
}

function graphForUser(vault, user) {
  const nodes = []
  const links = []
  let n = 0
  for (const file of walkMarkdown(userMemoryRoot(vault, user.id))) {
    const id = file.rel
    nodes.push({ id, name: path.basename(file.rel, '.md'), group: file.rel.split('/')[0] ?? 'memory' })
    n++
    if (n > 80) break
  }
  return { nodes, links }
}

function ledgerVerb(op) {
  if (op === 'write' || op === 'capture') return 'processed'
  if (op === 'policy_update' || op === 'agents_update') return 'improved'
  if (op === 'write_blocked' || op === 'login_failed') return 'needs-you'
  return 'discovered'
}

function ledgerSentence(row) {
  if (row.op === 'write') return `Wrote ${row.path}.`
  if (row.op === 'capture') return `Captured a note in ${row.path}.`
  if (row.op === 'policy_update') return 'Organization policy changed.'
  if (row.op === 'agents_update') return 'Connected agents were updated.'
  if (row.op === 'login') return 'Signed in.'
  return `${row.op}${row.path ? `: ${row.path}` : ''}.`
}

function timeOfDay() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 18) return 'afternoon'
  return 'evening'
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
  return true
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', c => {
      size += c.length
      if (size > 65536) reject(new Error('too large'))
      else chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch { reject(new Error('bad json')) }
    })
    req.on('error', reject)
  })
}
