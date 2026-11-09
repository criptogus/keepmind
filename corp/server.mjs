// KeepMind Corp — corporate second brain (web) + organization governance.
// Same KeepMind UI at /brain/ with policy enforcement; admins use /admin/.

import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CORP_VERSION, ROLES, PROVIDERS, AUTONOMY,
  can, hashPassword, verifyPassword, userIdFromEmail,
  resolveInside,   canReadFile, canWriteFile, normalizePolicy,
  clampTeamAutonomy, scanText, scanVault, publicScan, redactSecrets, walkMarkdown,
  defaultOrg, readJson, writeJsonAtomic, ensureVaultShape, appendAudit, readAudit,
  verifyRs256
} from './lib.mjs'
import { createOidc, oidcFromEnv } from './oidc.mjs'
import { mountBrainApi } from './brain-api.mjs'
import { ensureUserBrain } from './memory-layout.mjs'

const CORP_ROOT = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(CORP_ROOT, 'public')
const BRAIN_DIR = path.join(CORP_ROOT, 'brain-dist')
const SESSION_MS = 12 * 60 * 60 * 1000
const MAX_BODY = 64 * 1024
const STATIC = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/login.js': 'login.js',
  '/login.css': 'login.css',
  '/admin': 'admin.html',
  '/admin/': 'admin.html',
  '/admin.html': 'admin.html',
  '/admin-app.js': 'admin-app.js',
  '/app.css': 'app.css'
}

export function createCorp(opts = {}) {
  const env = opts.env ?? process.env
  const dataDir = opts.dataDir ?? env.KEEPMIND_CORP_DATA ?? path.join(process.cwd(), 'corp', 'data')
  const vault = opts.vault ?? env.KEEPMIND_VAULT ?? path.join(dataDir, 'vault')
  mkdirSync(dataDir, { recursive: true })
  ensureVaultShape(vault)
  const orgFile = path.join(dataDir, 'org.json')
  const sessionFile = path.join(dataDir, 'sessions.json')
  const org = loadOrg(orgFile, env.KEEPMIND_CORP_ORG_NAME || 'KeepMind Corp')
  const sessions = new Map(Object.entries(readJson(sessionFile, {})))
  const failures = new Map()
  const oidcConfig = opts.oidc === undefined ? oidcFromEnv(env) : opts.oidc
  const oidc = oidcConfig ? createOidc(oidcConfig, opts.fetchImpl ?? globalThis.fetch) : null
  const secureCookie = env.KEEPMIND_CORP_SECURE === '1'

  const brainApi = mountBrainApi({ vault, getOrg: () => org, audit: (user, op, extra) => audit(user, op, extra) })

  ensureOwner(env)
  persistOrg()

  function persistOrg() {
    writeJsonAtomic(orgFile, org)
    const policyFile = path.join(vault, 'ops', 'corp-policy.json')
    writeJsonAtomic(policyFile, {
      edition: 'keepmind-corp',
      version: CORP_VERSION,
      org: org.name,
      policy: org.policy,
      teams: org.teams,
      agents: org.agents.map(agent => ({ id: agent.id, name: agent.name, enabled: agent.enabled, teamId: agent.teamId }))
    })
  }

  function persistSessions() {
    const live = {}
    const now = Date.now()
    for (const [token, row] of sessions) {
      if (row.exp > now) live[token] = row
      else sessions.delete(token)
    }
    writeJsonAtomic(sessionFile, live)
  }

  function ensureOwner(source) {
    if (org.users.some(user => user.role === 'owner')) return
    const email = String(source.KEEPMIND_CORP_OWNER_EMAIL || '').trim().toLowerCase()
    const password = String(source.KEEPMIND_CORP_OWNER_PASSWORD || '')
    if (!email || !password) return
    if (!validEmail(email) || password.length < 12) {
      console.error('KeepMind Corp owner bootstrap needs a valid email and a password of at least 12 characters.')
      return
    }
    addUser({ email, name: 'Owner', role: 'owner', teamId: 'everyone', password })
  }

  function addUser({ email, name, role, teamId, password, oidcSub }) {
    const id = userIdFromEmail(email, new Set(org.users.map(user => user.id)))
    const secret = password ? hashPassword(password) : null
    const user = {
      id,
      email,
      name: String(name || email).slice(0, 80),
      role,
      teamId: org.teams.some(team => team.id === teamId) ? teamId : 'everyone',
      disabled: false,
      oidcSub: oidcSub || null,
      passwordSalt: secret?.salt ?? null,
      passwordHash: secret?.hash ?? null
    }
    org.users.push(user)
    ensureUserBrain(vault, id, user.name)
    return user
  }

  function publicUser(user) {
    return { id: user.id, email: user.email, name: user.name, role: user.role, teamId: user.teamId, disabled: !!user.disabled }
  }

  function userFromToken(token) {
    if (!token) return null
    const row = sessions.get(token)
    if (!row || row.exp < Date.now()) {
      sessions.delete(token)
      return null
    }
    const user = org.users.find(item => item.id === row.userId && !item.disabled)
    return user ?? null
  }

  function openSession(user) {
    const token = randomBytes(32).toString('hex')
    sessions.set(token, { userId: user.id, exp: Date.now() + SESSION_MS })
    persistSessions()
    return token
  }

  function cookie(token) {
    const parts = [`kmcorp=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${Math.floor(SESSION_MS / 1000)}`]
    if (secureCookie) parts.push('Secure')
    return parts.join('; ')
  }

  function clearCookie() {
    return 'kmcorp=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
  }

  function audit(actor, op, extra = {}) {
    appendAudit(vault, { actor: actor?.email ?? 'system', role: actor?.role ?? 'system', op, ...extra })
  }

  async function handle(req, res) {
    try {
      const url = new URL(req.url || '/', 'http://corp.local')
      if (STATIC[url.pathname] && (req.method === 'GET' || req.method === 'HEAD')) {
        return sendFile(res, STATIC[url.pathname], req.method === 'HEAD')
      }
      const tokenEarly = readCookie(req, 'kmcorp')
      const userEarly = userFromToken(tokenEarly)
      if (url.pathname === '/brain' || url.pathname.startsWith('/brain/')) {
        if (!userEarly) {
          res.writeHead(302, { Location: '/' })
          res.end()
          return
        }
        return serveBrainApp(res, url, req.method === 'HEAD')
      }
      if (url.pathname === '/favicon.ico') {
        res.writeHead(204)
        res.end()
        return
      }
      if (url.pathname === '/api/health' && req.method === 'GET') {
        return send(res, 200, { ok: true, edition: 'keepmind-corp', version: CORP_VERSION })
      }
      if (url.pathname === '/api/meta' && req.method === 'GET') {
        return send(res, 200, {
          ok: true,
          edition: 'keepmind-corp',
          version: CORP_VERSION,
          org: org.name,
          oidc: !!oidc,
          setupRequired: !org.users.some(user => user.role === 'owner'),
          providers: PROVIDERS,
          autonomy: AUTONOMY,
          roles: ROLES
        })
      }
      if (url.pathname === '/api/oidc/start' && req.method === 'GET') return await oidcStart(res)
      if (url.pathname === '/api/oidc/callback' && req.method === 'GET') return await oidcCallback(url, res)
      const token = readCookie(req, 'kmcorp')
      const user = userFromToken(token)
      if (url.pathname === '/api/session' && req.method === 'GET') {
        return send(res, 200, { ok: true, user: user ? publicUser(user) : null })
      }
      if (url.pathname === '/api/login' && req.method === 'POST') return await login(req, res)
      if (url.pathname === '/api/logout' && req.method === 'POST') return logout(req, token, res)
      if (!user) return send(res, 401, { ok: false, error: 'unauthorized' })
      if (!sameOriginMutation(req)) return send(res, 403, { ok: false, error: 'forbidden' })
      if (await brainApi(req, res, url, user)) return
      return await authed(req, res, url, user)
    } catch (err) {
      const code = err.code || 'server_error'
      const status = STATUS[code] ?? 500
      if (status === 500) console.error(err)
      return send(res, status, { ok: false, error: code, message: status === 500 ? 'Something went wrong.' : err.message })
    }
  }

  async function login(req, res) {
    const body = await readBody(req)
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    const key = `${clientIp(req)}|${email}`
    const now = Date.now()
    const prior = failures.get(key) || []
    const recent = prior.filter(ts => now - ts < 10 * 60 * 1000)
    if (recent.length >= 8) return send(res, 429, { ok: false, error: 'rate_limited' })
    const user = org.users.find(item => item.email === email && !item.disabled)
    if (!user?.passwordHash || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      recent.push(now)
      failures.set(key, recent)
      audit(null, 'login_failed', { email })
      return send(res, 401, { ok: false, error: 'bad_login' })
    }
    failures.delete(key)
    ensureUserBrain(vault, user.id, user.name)
    const issued = openSession(user)
    audit(user, 'login')
    res.setHeader('Set-Cookie', cookie(issued))
    return send(res, 200, { ok: true, user: publicUser(user) })
  }

  function logout(req, token, res) {
    if (!sameOriginMutation(req)) return send(res, 403, { ok: false, error: 'forbidden' })
    if (token) sessions.delete(token)
    persistSessions()
    res.setHeader('Set-Cookie', clearCookie())
    return send(res, 200, { ok: true })
  }

  async function oidcStart(res) {
    if (!oidc) return send(res, 404, { ok: false, error: 'oidc_off' })
    const location = await oidc.start()
    res.writeHead(302, { Location: location })
    res.end()
  }

  async function oidcCallback(url, res) {
    if (!oidc) return send(res, 404, { ok: false, error: 'oidc_off' })
    const state = url.searchParams.get('state') || ''
    const code = url.searchParams.get('code') || ''
    const pending = oidc.take(state)
    if (!pending || !code) return send(res, 400, { ok: false, error: 'bad_token', message: 'Sign-in session expired.' })
    const exchanged = await oidc.exchange(code, pending.verifier)
    const payload = verifyRs256(exchanged.idToken, {
      issuer: oidc.config.issuer,
      audience: oidc.config.clientId,
      jwks: exchanged.jwks
    })
    const email = String(payload.email || '').trim().toLowerCase()
    if (!validEmail(email)) return send(res, 400, { ok: false, error: 'bad_user', message: 'The identity token has no email.' })
    const groups = Array.isArray(payload.groups) ? payload.groups.map(String) : []
    const ssoAdmin = groups.includes(oidc.config.adminGroup)
    let user = org.users.find(item => item.oidcSub === payload.sub || item.email === email)
    if (!user) {
      user = addUser({
        email,
        name: payload.name || email,
        role: ssoAdmin ? 'admin' : 'member',
        teamId: 'everyone',
        oidcSub: String(payload.sub || '')
      })
      persistOrg()
      audit(user, 'member_joined', { via: 'oidc' })
    } else if (user.disabled) {
      return send(res, 403, { ok: false, error: 'forbidden' })
    } else {
      user.oidcSub = String(payload.sub || user.oidcSub || '')
      if (ssoAdmin && user.role === 'member') user.role = 'admin'
      persistOrg()
    }
    const issued = openSession(user)
    audit(user, 'login', { via: 'oidc' })
    ensureUserBrain(vault, user.id, user.name)
    res.writeHead(302, { Location: '/brain/', 'Set-Cookie': cookie(issued) })
    res.end()
  }

  async function authed(req, res, url, user) {
    if (url.pathname === '/api/me' && req.method === 'GET') {
      return send(res, 200, { ok: true, user: publicUser(user), org: org.name })
    }
    if (url.pathname === '/api/overview' && req.method === 'GET') return overview(res, user)
    if (url.pathname === '/api/policy' && req.method === 'GET') {
      if (!can(user.role, 'policy.read')) return send(res, 403, { ok: false, error: 'forbidden' })
      return send(res, 200, { ok: true, policy: org.policy })
    }
    if (url.pathname === '/api/policy' && req.method === 'PUT') return writePolicy(req, res, user)
    if (url.pathname === '/api/teams' && req.method === 'GET') {
      return send(res, 200, { ok: true, teams: org.teams, ceiling: org.policy.autonomyCeiling })
    }
    if (url.pathname === '/api/teams' && req.method === 'PUT') return writeTeams(req, res, user)
    if (url.pathname === '/api/members' && req.method === 'GET') {
      if (!can(user.role, 'members.read')) return send(res, 403, { ok: false, error: 'forbidden' })
      return send(res, 200, { ok: true, members: org.users.map(publicUser) })
    }
    if (url.pathname === '/api/members' && req.method === 'POST') return createMember(req, res, user)
    if (url.pathname.startsWith('/api/members/') && req.method === 'PATCH') {
      return patchMember(req, res, user, decodeURIComponent(url.pathname.slice('/api/members/'.length)))
    }
    if (url.pathname === '/api/agents' && req.method === 'GET') {
      return send(res, 200, { ok: true, agents: org.agents })
    }
    if (url.pathname === '/api/agents' && req.method === 'PUT') return writeAgents(req, res, user)
    if (url.pathname === '/api/audit' && req.method === 'GET') {
      if (!can(user.role, 'audit.read')) return send(res, 403, { ok: false, error: 'forbidden' })
      const limit = Number(url.searchParams.get('limit') || 50)
      return send(res, 200, { ok: true, entries: readAudit(vault, limit) })
    }
    if (url.pathname === '/api/scan' && req.method === 'GET') {
      if (!can(user.role, 'scan.read')) return send(res, 403, { ok: false, error: 'forbidden' })
      return send(res, 200, { ok: true, scan: publicScan(scanVault(vault), can(user.role, 'scan.paths')) })
    }
    if (url.pathname === '/api/files' && req.method === 'GET') return listFiles(res, user)
    if (url.pathname === '/api/files/preview' && req.method === 'GET') {
      return previewFile(res, user, url.searchParams.get('path') || '')
    }
    if (url.pathname === '/api/files' && req.method === 'POST') return writeFile(req, res, user)
    return send(res, 404, { ok: false, error: 'not_found' })
  }

  function overview(res, user) {
    const scan = can(user.role, 'scan.read')
      ? publicScan(scanVault(vault), can(user.role, 'scan.paths'))
      : null
    const entries = can(user.role, 'audit.read') ? readAudit(vault, 8) : []
    return send(res, 200, {
      ok: true,
      org: org.name,
      user: publicUser(user),
      policy: org.policy,
      teams: org.teams,
      agents: org.agents,
      scan,
      audit: entries,
      memory: 'partitioned'
    })
  }

  async function writePolicy(req, res, user) {
    if (!can(user.role, 'policy.write')) return send(res, 403, { ok: false, error: 'forbidden' })
    const body = await readBody(req)
    org.policy = normalizePolicy(body, org.policy)
    for (const team of org.teams) {
      if (AUTONOMY.indexOf(team.autonomy) > AUTONOMY.indexOf(org.policy.autonomyCeiling)) {
        team.autonomy = org.policy.autonomyCeiling
      }
    }
    persistOrg()
    audit(user, 'policy_update', { providers: org.policy.providers, ceiling: org.policy.autonomyCeiling })
    return send(res, 200, { ok: true, policy: org.policy, teams: org.teams })
  }

  async function writeTeams(req, res, user) {
    if (!can(user.role, 'teams.write')) return send(res, 403, { ok: false, error: 'forbidden' })
    const body = await readBody(req)
    const incoming = Array.isArray(body.teams) ? body.teams : null
    if (!incoming) {
      const err = new Error('Teams must be a list.')
      err.code = 'bad_policy'
      throw err
    }
    const next = []
    const seen = new Set()
    for (const team of incoming) {
      const id = String(team.id || '').trim()
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id) || seen.has(id)) {
        const err = new Error('Each team needs a unique id of letters, numbers and dashes.')
        err.code = 'bad_policy'
        throw err
      }
      seen.add(id)
      next.push({
        id,
        name: String(team.name || id).slice(0, 80),
        autonomy: clampTeamAutonomy(team.autonomy, org.policy.autonomyCeiling)
      })
    }
    if (!next.some(team => team.id === 'everyone')) {
      next.unshift({ id: 'everyone', name: 'Everyone', autonomy: 'supervised' })
    }
    org.teams = next
    for (const member of org.users) {
      if (!org.teams.some(team => team.id === member.teamId)) member.teamId = 'everyone'
    }
    persistOrg()
    audit(user, 'teams_update', { teams: org.teams.map(team => team.id) })
    return send(res, 200, { ok: true, teams: org.teams })
  }

  async function createMember(req, res, user) {
    if (!can(user.role, 'members.write')) return send(res, 403, { ok: false, error: 'forbidden' })
    const body = await readBody(req)
    const email = String(body.email || '').trim().toLowerCase()
    const role = body.role || 'member'
    const password = String(body.password || '')
    if (!validEmail(email) || org.users.some(item => item.email === email)) {
      const err = new Error('Use a new, valid email.')
      err.code = 'bad_user'
      throw err
    }
    if (!ROLES.includes(role)) {
      const err = new Error('Unknown role.')
      err.code = 'bad_user'
      throw err
    }
    if (role === 'owner' && !can(user.role, 'owner.grant')) {
      return send(res, 403, { ok: false, error: 'forbidden' })
    }
    if (password.length < 12) {
      const err = new Error('Passwords need at least 12 characters.')
      err.code = 'bad_user'
      throw err
    }
    const created = addUser({ email, name: body.name, role, teamId: body.teamId || 'everyone', password })
    persistOrg()
    audit(user, 'member_create', { email, role })
    return send(res, 201, { ok: true, member: publicUser(created) })
  }

  async function patchMember(req, res, user, id) {
    if (!can(user.role, 'members.write')) return send(res, 403, { ok: false, error: 'forbidden' })
    const target = org.users.find(item => item.id === id)
    if (!target) return send(res, 404, { ok: false, error: 'not_found' })
    const body = await readBody(req)
    if (body.role && body.role !== target.role) {
      if (!ROLES.includes(body.role)) {
        const err = new Error('Unknown role.')
        err.code = 'bad_user'
        throw err
      }
      if ((body.role === 'owner' || target.role === 'owner') && !can(user.role, 'owner.grant')) {
        return send(res, 403, { ok: false, error: 'forbidden' })
      }
      if (target.role === 'owner' && body.role !== 'owner') {
        const owners = org.users.filter(item => item.role === 'owner' && !item.disabled)
        if (owners.length <= 1) {
          const err = new Error('The last owner stays an owner.')
          err.code = 'last_owner'
          throw err
        }
      }
      target.role = body.role
    }
    if (typeof body.disabled === 'boolean') {
      if (target.role === 'owner' && body.disabled) {
        const owners = org.users.filter(item => item.role === 'owner' && !item.disabled && item.id !== target.id)
        if (owners.length === 0) {
          const err = new Error('The last owner stays an owner.')
          err.code = 'last_owner'
          throw err
        }
      }
      target.disabled = body.disabled
    }
    if (body.teamId && org.teams.some(team => team.id === body.teamId)) target.teamId = body.teamId
    if (body.name) target.name = String(body.name).slice(0, 80)
    persistOrg()
    audit(user, 'member_update', { id: target.id, role: target.role, disabled: !!target.disabled })
    return send(res, 200, { ok: true, member: publicUser(target) })
  }

  async function writeAgents(req, res, user) {
    if (!can(user.role, 'agents.write')) return send(res, 403, { ok: false, error: 'forbidden' })
    const body = await readBody(req)
    const incoming = Array.isArray(body.agents) ? body.agents : null
    if (!incoming) {
      const err = new Error('Agents must be a list.')
      err.code = 'bad_policy'
      throw err
    }
    const next = []
    const seen = new Set()
    for (const agent of incoming) {
      const id = String(agent.id || '').trim()
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id) || seen.has(id)) {
        const err = new Error('Each agent needs a unique id.')
        err.code = 'bad_policy'
        throw err
      }
      seen.add(id)
      const teamId = org.teams.some(team => team.id === agent.teamId) ? agent.teamId : 'everyone'
      next.push({ id, name: String(agent.name || id).slice(0, 80), enabled: !!agent.enabled, teamId })
    }
    org.agents = next
    persistOrg()
    audit(user, 'agents_update', { enabled: next.filter(agent => agent.enabled).map(agent => agent.id) })
    return send(res, 200, { ok: true, agents: org.agents })
  }

  function listFiles(res, user) {
    const files = scanVaultList().filter(file => canReadFile(user.role, user.id, file.path))
    return send(res, 200, { ok: true, files })
  }

  function previewFile(res, user, rel) {
    const located = resolveInside(vault, rel)
    if (!located) return send(res, 400, { ok: false, error: 'bad_path' })
    if (!canReadFile(user.role, user.id, located.rel)) return send(res, 403, { ok: false, error: 'forbidden' })
    if (!existsSync(located.abs)) return send(res, 404, { ok: false, error: 'not_found' })
    const raw = readFileSync(located.abs, 'utf8')
    if (raw.startsWith('KMS1\n')) return send(res, 200, { ok: true, path: located.rel, encrypted: true, text: '' })
    return send(res, 200, { ok: true, path: located.rel, encrypted: false, text: redactSecrets(raw).slice(0, 8000) })
  }

  async function writeFile(req, res, user) {
    const body = await readBody(req)
    const located = resolveInside(vault, String(body.path || ''))
    if (!located) return send(res, 400, { ok: false, error: 'bad_path' })
    if (!canWriteFile(user.role, user.id, located.rel)) return send(res, 403, { ok: false, error: 'forbidden' })
    const text = String(body.text ?? '')
    if (text.length > MAX_BODY) return send(res, 400, { ok: false, error: 'bad_path', message: 'Note is too large.' })
    const found = scanText(located.rel, text)
    if (found.secrets.length > 0) {
      audit(user, 'write_blocked', { path: located.rel, label: found.secrets[0].label })
      return send(res, 400, { ok: false, error: 'secret_blocked', message: 'That note contains a credential. It was not saved.' })
    }
    mkdirSync(path.dirname(located.abs), { recursive: true })
    writeFileSync(located.abs, text)
    audit(user, 'write', { path: located.rel })
    return send(res, 200, { ok: true, path: located.rel })
  }

  function scanVaultList() {
    return walkMarkdown(vault).map(file => {
      let encrypted = false
      try {
        const head = readFileSync(file.abs, 'utf8').slice(0, 5)
        encrypted = head === 'KMS1\n'
      } catch { encrypted = false }
      return { path: file.rel, encrypted }
    })
  }

  return { handle, org, vault, dataDir }
}

const STATUS = {
  shadow_key: 400,
  above_ceiling: 400,
  bad_policy: 400,
  bad_autonomy: 400,
  secret_blocked: 400,
  bad_path: 400,
  bad_user: 400,
  bad_token: 400,
  last_owner: 409,
  oidc_down: 502
}

function loadOrg(file, name) {
  const loaded = readJson(file, null)
  const base = defaultOrg(name)
  if (!loaded || !Array.isArray(loaded.users)) return base
  return {
    ...base,
    ...loaded,
    name: typeof loaded.name === 'string' ? loaded.name : base.name,
    users: loaded.users,
    teams: Array.isArray(loaded.teams) && loaded.teams.length ? loaded.teams : base.teams,
    agents: Array.isArray(loaded.agents) ? loaded.agents : base.agents,
    policy: { ...base.policy, ...(loaded.policy || {}), byokRequired: true, memberKeys: false }
  }
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function clientIp(req) {
  return req.socket?.remoteAddress || 'local'
}

function readCookie(req, name) {
  const header = req.headers.cookie || ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return ''
}

function sameOriginMutation(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true
  if (req.headers['x-keepmind-corp'] === '1') return true
  const origin = req.headers.origin
  if (!origin) return false
  try {
    const host = new URL(origin).host
    return host === req.headers.host
  } catch {
    return false
  }
}

function send(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  res.end(payload)
}

function serveBrainApp(res, url, head) {
  if (!existsSync(BRAIN_DIR)) {
    return send(res, 503, { ok: false, error: 'brain_not_built', message: 'Run npm run corp:build-brain, then reload.' })
  }
  const sub = url.pathname.replace(/^\/brain\/?/, '') || 'index.html'
  let file = path.join(BRAIN_DIR, sub)
  const root = path.resolve(BRAIN_DIR)
  if (!path.resolve(file).startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    file = path.join(BRAIN_DIR, 'index.html')
  }
  const ext = path.extname(file)
  const type = ext === '.css' ? 'text/css' : ext === '.js' ? 'text/javascript' : 'text/html'
  const body = readFileSync(file)
  const csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none';"
  res.writeHead(200, {
    'content-type': `${type}; charset=utf-8`,
    'content-security-policy': csp,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  })
  res.end(head ? undefined : body)
}

function sendFile(res, name, head) {
  const file = path.join(PUBLIC_DIR, name)
  const type = name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html'
  const body = readFileSync(file)
  res.writeHead(200, {
    'content-type': `${type}; charset=utf-8`,
    'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY'
  })
  res.end(head ? undefined : body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Body is too large.'), { code: 'bad_path' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (size === 0) return resolve({})
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(Object.assign(new Error('Body must be JSON.'), { code: 'bad_policy' })) }
    })
    req.on('error', reject)
  })
}

export function startFromEnv() {
  const env = process.env
  const host = env.KEEPMIND_CORP_HOST || '127.0.0.1'
  const port = Number(env.KEEPMIND_CORP_PORT || 8787)
  const corp = createCorp({ env })
  const server = createServer((req, res) => {
    corp.handle(req, res).catch(err => {
      console.error(err)
      if (!res.headersSent) send(res, 500, { ok: false, error: 'server_error', message: 'Something went wrong.' })
    })
  })
  server.listen(port, host, () => {
    console.log(`KeepMind Corp ${CORP_VERSION} on http://${host}:${port}`)
  })
  return server
}

const invoked = process.argv[1] && import.meta.url === pathToFile(process.argv[1])
if (invoked) startFromEnv()

function pathToFile(file) {
  return fileURLToPath(import.meta.url) === path.resolve(file) ? import.meta.url : ''
}
