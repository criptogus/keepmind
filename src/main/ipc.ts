import { ipcMain, shell, BrowserWindow, app } from 'electron'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Store, type Automation } from './store'
import { Brain } from './services/brain'
import { McpManager } from './services/mcp'
import { LocalLlm, LOCAL_MODELS, EMBED_MODELS } from './services/local-llm'
import { GitSync } from './services/sync'
import { AutomationScheduler, parseNaturalSchedule } from './services/automations'
import { AuthService } from './services/auth'
import { googleLogin } from './services/google-auth'
import type { RagService } from './services/rag'
import type { Planner } from './services/planner'
import * as llm from './services/llm'
import * as github from './services/github'
import { checkForUpdates, installUpdate, updaterStatus } from './services/updater'
import { listModels, deleteModel } from './services/models'
import { exportBrainConfig } from './services/scaffold'
import { isPlainObject, stripForbiddenKeys } from './safe-path'
import type { McpServerConfig } from './store'
import type { HookServer } from './services/hooks'

// ── IPC input validation ──
// Renderer is sandboxed, but a compromised renderer (XSS, malicious
// synced content) could still invoke these handlers. Validate shape and
// whitelist keys so patches can't smuggle arbitrary config or prototype
// pollution. Custom MCP commands remain user-authorized by design.

const AI_PROVIDERS = new Set(['local', 'anthropic', 'claude-oauth', 'openai', 'codex', 'gemini', 'grok', 'ollama'])
const MCP_KINDS = new Set(['whatsapp', 'telegram', 'postgres', 'custom'])
const CONFIG_SET_KEYS = new Set(['mcpServers', 'onboardingDone'])
const MCP_PATCH_KEYS = new Set(['id', 'name', 'kind', 'enabled', 'command', 'args', 'env', 'sessionDir', 'permission'])
const MCP_PERMISSIONS = new Set(['allow', 'ask', 'block'])
const AUTOMATION_PATCH_KEYS = new Set(['name', 'instruction', 'kind', 'schedule', 'time', 'everyMinutes', 'weekday', 'enabled', 'mode'])
const AUTOMATION_KINDS = new Set(['brain', 'sleep', 'summary', 'librarian', 'evolve', 'enrich', 'review', 'security', 'skills', 'triage'])
const AUTOMATION_SCHEDULES = new Set(['daily', 'interval', 'weekly'])

function bad(field: string): never {
  throw new Error(`invalid IPC payload: ${field}`)
}

function optStr(v: any, field: string, max = 8192): void {
  if (v !== undefined && (typeof v !== 'string' || v.length > max)) bad(field)
}

function reqStr(v: any, field: string, max = 8192): void {
  if (typeof v !== 'string' || !v.length || v.length > max) bad(field)
}

function validateMcpServerShape(s: any, partial: boolean): void {
  if (!isPlainObject(s)) bad('mcp server')
  if (partial) {
    for (const k of Object.keys(s)) if (!MCP_PATCH_KEYS.has(k)) bad(`mcp.${k}`)
  }
  if (!partial || s.id !== undefined) reqStr(s.id, 'mcp.id', 128)
  if (!partial || s.name !== undefined) reqStr(s.name, 'mcp.name', 256)
  if (!partial || s.kind !== undefined) {
    if (!MCP_KINDS.has(s.kind)) bad('mcp.kind')
  }
  if (s.enabled !== undefined && typeof s.enabled !== 'boolean') bad('mcp.enabled')
  if (s.permission !== undefined && !MCP_PERMISSIONS.has(s.permission)) bad('mcp.permission')
  optStr(s.command, 'mcp.command')
  optStr(s.sessionDir, 'mcp.sessionDir', 1024)
  if (s.args !== undefined) {
    if (!Array.isArray(s.args) || s.args.length > 64 || s.args.some((a: any) => typeof a !== 'string' || a.length > 2048)) bad('mcp.args')
  }
  if (s.env !== undefined) {
    if (!isPlainObject(s.env)) bad('mcp.env')
    const entries = Object.entries(s.env)
    if (entries.length > 64) bad('mcp.env size')
    for (const [k, v] of entries) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof v !== 'string' || v.length > 8192) bad('mcp.env entry')
    }
  }
}

function validateAiPatch(p: any): void {
  if (!isPlainObject(p)) bad('ai patch')
  for (const k of Object.keys(p)) if (!['provider', 'apiKey', 'model', 'baseUrl'].includes(k)) bad(`ai.${k}`)
  if (p.provider !== undefined && !AI_PROVIDERS.has(p.provider)) bad('ai.provider')
  optStr(p.apiKey, 'ai.apiKey', 512)
  optStr(p.model, 'ai.model', 256)
  optStr(p.baseUrl, 'ai.baseUrl', 512)
}

function validateGithubPatch(p: any): void {
  if (!isPlainObject(p)) bad('github patch')
  for (const k of Object.keys(p)) {
    if (!['accessToken', 'refreshToken', 'login', 'repoOwner', 'repoName', 'repoUrl', 'defaultBranch', 'syncRoot'].includes(k)) bad(`github.${k}`)
  }
  for (const k of Object.keys(p)) optStr(p[k], `github.${k}`, 2048)
}

function validateLocalLlmPatch(p: any): void {
  if (!isPlainObject(p)) bad('localLlm patch')
  for (const k of Object.keys(p)) {
    if (!['modelId', 'modelPath', 'embedModelId'].includes(k)) {
      if (k === 'port') {
        if (typeof p.port !== 'number' || !Number.isInteger(p.port) || p.port < 1 || p.port > 65535) bad('localLlm.port')
      } else if (k === 'downloadedBytes' || k === 'totalBytes') {
        if (typeof p[k] !== 'number' || !Number.isFinite(p[k]) || p[k] < 0) bad(`localLlm.${k}`)
      } else bad(`localLlm.${k}`)
    } else optStr(p[k], `localLlm.${k}`, 1024)
  }
}

function validateAutomationPatch(p: any): void {
  if (!isPlainObject(p)) bad('automation patch')
  for (const k of Object.keys(p)) if (!AUTOMATION_PATCH_KEYS.has(k)) bad(`automation.${k}`)
  optStr(p.name, 'automation.name', 256)
  optStr(p.instruction, 'automation.instruction', 8192)
  if (p.kind !== undefined && !AUTOMATION_KINDS.has(p.kind)) bad('automation.kind')
  if (p.schedule !== undefined && !AUTOMATION_SCHEDULES.has(p.schedule)) bad('automation.schedule')
  optStr(p.time, 'automation.time', 16)
  if (p.everyMinutes !== undefined && (typeof p.everyMinutes !== 'number' || p.everyMinutes < 1 || p.everyMinutes > 10080)) bad('automation.everyMinutes')
  if (p.weekday !== undefined && (typeof p.weekday !== 'number' || p.weekday < 0 || p.weekday > 6)) bad('automation.weekday')
  if (p.enabled !== undefined && typeof p.enabled !== 'boolean') bad('automation.enabled')
  if (p.mode !== undefined && p.mode !== 'auto' && p.mode !== 'approval') bad('automation.mode')
}

export function registerIpc(
  store: Store,
  brain: Brain,
  mcp: McpManager | null,
  localLlm: LocalLlm | null,
  sync: GitSync | null = null,
  automations: AutomationScheduler | null = null,
  auth: AuthService | null = null,
  rag: RagService | null = null,
  planner: Planner | null = null,
  laya: import('./services/laya').LayaService | null = null,
  hooks: HookServer | null = null
) {
  // ── Config ──
  ipcMain.handle('config:get', () => store.get())
  ipcMain.handle('config:set', (_e, patch: any) => {
    if (!isPlainObject(patch)) bad('config patch')
    for (const k of Object.keys(patch)) if (!CONFIG_SET_KEYS.has(k)) bad(`config.${k}`)
    if (patch.onboardingDone !== undefined && typeof patch.onboardingDone !== 'boolean') bad('onboardingDone')
    if (patch.mcpServers !== undefined) {
      if (!Array.isArray(patch.mcpServers) || patch.mcpServers.length > 32) bad('mcpServers')
      for (const s of patch.mcpServers) validateMcpServerShape(s, false)
    }
    return store.set(stripForbiddenKeys(patch))
  })
  ipcMain.handle('config:updateAi', (_e, patch: any) => { validateAiPatch(patch); return store.updateAi(stripForbiddenKeys(patch)) })
  ipcMain.handle('config:updateLocalLlm', (_e, patch: any) => { validateLocalLlmPatch(patch); return store.updateLocalLlm(stripForbiddenKeys(patch)) })
  ipcMain.handle('config:updateGithub', (_e, patch: any) => { validateGithubPatch(patch); return store.updateGithub(stripForbiddenKeys(patch)) })
  ipcMain.handle('config:updateMcp', (_e, id: string, patch: any) => {
    reqStr(id, 'mcp id', 128)
    validateMcpServerShape(patch, true)
    return store.updateMcpServer(id, stripForbiddenKeys(patch))
  })

  // ── AI providers ──
  ipcMain.handle('ai:providers', () => llm.listProviders())
  ipcMain.handle('ai:codexStatus', () => llm.codexStatus())
  ipcMain.handle('ai:test', async (e, provider: any) => {
    try {
      if (provider.provider === 'local' && localLlm) {
        const modelId = provider.model ?? store.get().localLlm.modelId ?? LOCAL_MODELS[1].id
        const ok = await localLlm.ensureReady(modelId)
        if (!ok) return { ok: false, error: 'Local model failed to start (download may be required)' }
      }
      const res = await llm.chat(provider, [
        { role: 'user', content: 'Reply with exactly: OK' }
      ], [], localLlm?.endpoint)
      return { ok: true, reply: res.text.slice(0, 100) }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  })

  // ── Local LLM (bundled llama.cpp) ──
  ipcMain.handle('localllm:status', () => ({
    catalog: LOCAL_MODELS,
    serverDownloaded: localLlm?.isServerDownloaded() ?? false,
    running: localLlm?.isRunning ?? false,
    endpoint: localLlm?.endpoint,
    config: store.get().localLlm,
    currentModelDownloaded: localLlm ? localLlm.isModelDownloaded() : false,
    embedCatalog: EMBED_MODELS
  }))
  ipcMain.handle('localllm:downloadServer', async (e) => {
    if (!localLlm) throw new Error('no local llm')
    const win = BrowserWindow.fromWebContents(e.sender)
    const bin = await localLlm.downloadServer((pct) => {
      win?.webContents.send('localllm:progress', { kind: 'server', pct })
    })
    return { ok: true, bin }
  })
  ipcMain.handle('localllm:downloadModel', async (e, modelId: string) => {
    if (!localLlm) throw new Error('no local llm')
    const win = BrowserWindow.fromWebContents(e.sender)
    const path = await localLlm.downloadModel(modelId, (dl, total) => {
      win?.webContents.send('localllm:progress', { kind: 'model', modelId, downloaded: dl, total })
    })
    return { ok: true, path }
  })
  ipcMain.handle('localllm:ensure', async (_e, modelId?: string) => {
    if (!localLlm) throw new Error('no local llm')
    const id = modelId ?? store.get().localLlm.modelId ?? LOCAL_MODELS[1].id
    await localLlm.ensureReady(id)
    return { ok: true, endpoint: localLlm.endpoint }
  })
  ipcMain.handle('localllm:stop', async () => { await localLlm?.stop(); return true })

  // ── GitHub OAuth device flow ──
  ipcMain.handle('github:startDeviceFlow', async () => {
    const dc = await github.startDeviceFlow()
    return dc
  })
  ipcMain.handle('github:pollDeviceFlow', async (_e, deviceCode: any) => {
    const res = await github.pollDeviceFlow(deviceCode)
    if (res.status === 'success') {
      store.updateGithub({ accessToken: res.accessToken })
      // fetch login
      try {
        const me = await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${res.accessToken}`, Accept: 'application/vnd.github+json' }
        }).then(r => r.json())
        store.updateGithub({ login: me.login })
      } catch { /* noop */ }
    }
    return res
  })
  ipcMain.handle('github:listRepos', async () => {
    const t = store.get().github.accessToken
    if (!t) return []
    try { return await github.listUserRepos(t) } catch { return [] }
  })
  ipcMain.handle('github:useRepo', async (_e, owner: string, repo: string) => {
    const t = store.get().github.accessToken
    if (!t) throw new Error('Not authenticated')
    const r = await github.getRepo(t, owner, repo)
    // Imported vaults usually have no memory/ subtree — mirror the whole repo
    // root instead so their existing layout becomes the brain. New repos and
    // vaults that already use memory/ keep the scoped prefix.
    const hasMemoryDir = (await github.listRepoFiles({ accessToken: t, repoOwner: owner, repoName: repo }, 'memory')).length > 0
    store.updateGithub({
      repoOwner: owner, repoName: repo,
      repoUrl: r.html_url, defaultBranch: r.default_branch,
      syncRoot: hasMemoryDir ? 'memory/' : ''
    })
    // teach agents the layout — only writes files the repo doesn't already have
    sync?.maybeScaffold().catch(() => {})
    return r
  })
  ipcMain.handle('github:createRepo', async (_e, name: string, description: string) => {
    const cfg = store.get().github
    if (!cfg.accessToken) throw new Error('Not authenticated')
    const repo = await github.createRepo(cfg.accessToken, name, description, true)
    const [owner] = repo.full_name.split('/')
    store.updateGithub({
      repoOwner: owner,
      repoName: repo.full_name.split('/')[1],
      repoUrl: repo.html_url,
      defaultBranch: repo.default_branch
    })
    // Push agent-onboarding files (AGENTS.md, .mcp.json, MCP server) into the repo
    sync?.maybeScaffold().catch(() => {})
    return repo
  })
  ipcMain.handle('github:pushMemory', async (_e, message: string) => {
    const gh = store.get().github
    if (!gh.accessToken || !gh.repoOwner) throw new Error('GitHub not connected')
    // push whole memory dir files via contents API
    const memDir = store.memoryDir
    const files = collectMd(memDir)
    for (const rel of files) {
      const content = readFileSync(join(memDir, rel), 'utf8')
      await github.pushFile(gh, `memory/${rel}`, content, message)
    }
    return { pushed: files.length }
  })

  // ── MCP ──
  ipcMain.handle('mcp:start', async (_e, id: string) => {
    const cfg = store.get().mcpServers.find(s => s.id === id)
    if (!cfg) throw new Error('Unknown server')
    if (!mcp) throw new Error('MCP manager not initialized')
    const tools = await mcp.startServer(cfg)
    return { tools: tools.map(t => t.name) }
  })
  ipcMain.handle('mcp:stop', async (_e, id: string) => {
    await mcp?.stopServer(id)
    return true
  })
  ipcMain.handle('mcp:status', () => ({
    running: mcp?.runningServers ?? [],
    allTools: mcp?.allTools().map(({ serverId, tool }) => ({ serverId, name: tool.name, description: tool.description })) ?? []
  }))
  ipcMain.handle('mcp:connectorQr', (_e, id: string) => {
    const srv = store.get().mcpServers.find(s => s.id === id)
    if (!srv) return null
    // legacy configs may lack sessionDir — fall back to the default locations
    const sessionDir = srv.sessionDir
      ?? (id === 'whatsapp' ? join(app.getPath('userData'), 'wa-session') : null)
      ?? (id === 'telegram' ? join(app.getPath('userData'), 'tg-session') : null)
    if (!sessionDir) return null
    const qrFile = join(sessionDir, 'qr.txt')
    if (!existsSync(qrFile)) return null
    const v = readFileSync(qrFile, 'utf8')
    if (v === 'CONNECTED') return { status: 'connected' }
    if (/^(LOGGED_OUT|ERROR|LOGIN_FAILED|QR_EXPIRED)$/.test(v)) return { status: 'error', code: v }
    return { status: 'qr', dataUrl: v }
  })
  ipcMain.handle('mcp:whatsappQr', () => {
    const qrFile = join(store.get().mcpServers.find(s => s.id === 'whatsapp')?.sessionDir ?? '', 'qr.txt')
    if (!existsSync(qrFile)) return null
    const v = readFileSync(qrFile, 'utf8')
    if (v === 'CONNECTED') return { status: 'connected' }
    if (v === 'LOGGED_OUT') return { status: 'logged_out' }
    return { status: 'qr', dataUrl: v }
  })
  ipcMain.handle('mcp:logs', () => mcpLogs)

  // ── GitHub sync (bidirectional) ──
  ipcMain.handle('sync:status', () => sync?.status() ?? { connected: false, pending: 0, lastPull: null, lastPush: null, syncing: false })
  ipcMain.handle('sync:now', async () => sync ? sync.syncNow() : null)

  // ── Automations ──
  ipcMain.handle('automation:list', () => store.get().automations)
  ipcMain.handle('automation:parse', (_e, text: string) => parseNaturalSchedule(text))
  ipcMain.handle('automation:create', (_e, input: { instruction: string } & Partial<Automation>) => {
    const parsed = parseNaturalSchedule(input.instruction)
    const auto: Automation = {
      id: `auto_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: input.name ?? parsed.name,
      instruction: input.instruction,
      kind: input.kind ?? parsed.kind,
      schedule: input.schedule ?? parsed.schedule,
      time: input.time ?? parsed.time,
      everyMinutes: input.everyMinutes ?? parsed.everyMinutes,
      weekday: input.weekday ?? parsed.weekday,
      enabled: input.enabled ?? true,
      createdAt: new Date().toISOString()
    }
    store.set({ automations: [...store.get().automations, auto] })
    return auto
  })
  ipcMain.handle('automation:update', (_e, id: string, patch: Partial<Automation>) => {
    reqStr(id, 'automation id', 128)
    validateAutomationPatch(patch)
    store.set({
      automations: store.get().automations.map(a => a.id === id ? { ...a, ...patch } : a)
    })
    return store.get().automations.find(a => a.id === id)
  })
  ipcMain.handle('automation:remove', (_e, id: string) => {
    store.set({ automations: store.get().automations.filter(a => a.id !== id) })
    return true
  })
  ipcMain.handle('automation:runNow', async (_e, id: string) => {
    const auto = store.get().automations.find(a => a.id === id)
    if (!auto) throw new Error('Unknown automation')
    // clicking "run now" IS the approval — bypass the approval queue
    if (automations) await automations.run(auto)
    store.set({
      automations: store.get().automations.map(a =>
        a.id === id ? { ...a, lastRunAt: new Date().toISOString() } : a)
    })
    return true
  })
  ipcMain.handle('automation:setWebhook', (_e, id: string, enabled: boolean) => {
    reqStr(id, 'automation id', 128)
    if (typeof enabled !== 'boolean') bad('webhook flag')
    const auto = automations?.setWebhook(id, enabled)
    if (!auto) throw new Error('Unknown automation')
    if (enabled) hooks?.ensureStarted()
    return {
      webhook: !!auto.webhook,
      url: auto.webhook && hooks ? `http://${hooks.host}:${hooks.port}/hook/${auto.id}` : null,
      token: auto.webhook ? auto.webhookToken : null
    }
  })
  ipcMain.handle('hooks:status', () => ({
    running: hooks?.running ?? false,
    host: hooks?.host ?? '127.0.0.1',
    port: hooks?.port ?? 4789,
    lan: !!store.get().hooks?.lan
  }))
  ipcMain.handle('hooks:setLan', (_e, lan: boolean) => {
    if (typeof lan !== 'boolean') bad('lan flag')
    store.set({ hooks: { lan } })
    hooks?.restart()
    return { lan }
  })
  ipcMain.handle('automation:pending', () => store.get().pendingApprovals)
  ipcMain.handle('automation:approve', async (_e, pendingId: string) => {
    const pending = store.get().pendingApprovals.find(p => p.id === pendingId)
    if (!pending) throw new Error('Unknown pending approval')
    const auto = store.get().automations.find(a => a.id === pending.automationId)
    store.set({ pendingApprovals: store.get().pendingApprovals.filter(p => p.id !== pendingId) })
    if (auto && automations) {
      await automations.run(auto)
      store.set({
        automations: store.get().automations.map(a =>
          a.id === auto.id ? { ...a, lastRunAt: new Date().toISOString() } : a)
      })
    }
    return true
  })
  ipcMain.handle('automation:reject', (_e, pendingId: string) => {
    store.set({ pendingApprovals: store.get().pendingApprovals.filter(p => p.id !== pendingId) })
    return true
  })

  // ── Brain ──
  ipcMain.handle('brain:chat', async (e, agentId: string, message: string) => {
    brain.setActivitySource('chat')
    const win = BrowserWindow.fromWebContents(e.sender)
    return brain.chat(agentId, message, (t) => {
      win?.webContents.send('brain:delta', t)
    })
  })
  ipcMain.handle('brain:insights', async () => { brain.setActivitySource('summary'); await brain.ensureProviderReady(); return brain.generateInsights() })
  ipcMain.handle('brain:dailySummary', async () => { brain.setActivitySource('summary'); await brain.ensureProviderReady(); return brain.dailySummary() })
  ipcMain.handle('brain:sleep', async () => { brain.setActivitySource('sleep'); await brain.ensureProviderReady(); return brain.sleep() })
  ipcMain.handle('brain:listSleep', () => brain.listSleepReports())
  ipcMain.handle('brain:memoryTiers', () => brain.memoryTierStats())
  ipcMain.handle('brain:listInsights', () => brain.listInsights())
  ipcMain.handle('brain:listSummaries', () => brain.listSummaries())
  ipcMain.handle('brain:listMemory', () => {
    const memDir = store.memoryDir
    return collectMd(memDir).map(rel => ({ path: rel, content: readFileSync(join(memDir, rel), 'utf8').slice(0, 1500) }))
  })
  ipcMain.handle('brain:graph', () => brain.memoryGraph())
  ipcMain.handle('brain:memoryFile', (_e, rel: string) => {
    if (typeof rel !== 'string' || rel.length > 500) return null
    return brain.readMemoryFile(rel)
  })
  ipcMain.handle('brain:exportConfig', async () => {
    const gh = store.get().github
    if (!gh.accessToken || !gh.repoOwner) throw new Error('GitHub not configured')
    await exportBrainConfig(gh, store.get())
    return true
  })
  ipcMain.handle('brain:activity', (_e, limit?: number) => brain.getMemory().activity(limit ?? 200))

  // ── Auth (local accounts + Google sign-in) ──
  ipcMain.handle('auth:state', async () => {
    if (!auth) return { needsSetup: false, user: null }
    const token = store.get().auth.sessionToken
    const user = await auth.userByToken(token)
    return { needsSetup: !(await auth.hasUsers()), user }
  })
  ipcMain.handle('auth:register', async (_e, email: string, password: string, name: string) => {
    if (!auth) throw new Error('auth unavailable')
    const user = await auth.register(email, password, name)
    const token = await auth.createSession(user.id)
    store.set({ auth: { ...store.get().auth, sessionToken: token } })
    return user
  })
  ipcMain.handle('auth:login', async (_e, email: string, password: string) => {
    if (!auth) throw new Error('auth unavailable')
    const user = await auth.verifyPassword(email, password)
    if (!user) throw new Error('Invalid email or password')
    const token = await auth.createSession(user.id)
    store.set({ auth: { ...store.get().auth, sessionToken: token } })
    return user
  })
  ipcMain.handle('auth:logout', async () => {
    const token = store.get().auth.sessionToken
    if (auth && token) await auth.deleteSession(token)
    store.set({ auth: { ...store.get().auth, sessionToken: undefined } })
    return true
  })
  ipcMain.handle('auth:googleLogin', async () => {
    if (!auth) throw new Error('auth unavailable')
    const a = store.get().auth
    const profile = await googleLogin({ clientId: a.googleClientId ?? '', clientSecret: a.googleClientSecret ?? '' })
    const user = await auth.upsertGoogle(profile)
    const token = await auth.createSession(user.id)
    store.set({ auth: { ...store.get().auth, sessionToken: token } })
    return user
  })
  ipcMain.handle('auth:setGoogleCreds', (_e, clientId: string, clientSecret: string) => {
    store.set({ auth: { ...store.get().auth, googleClientId: clientId || undefined, googleClientSecret: clientSecret || undefined } })
    return true
  })

  // ── Billing (Stripe Pro $19/mo) ──
  ipcMain.handle('billing:status', () => store.get().pro)
  ipcMain.handle('billing:setPaymentUrl', (_e, url: string) => {
    store.set({ pro: { ...store.get().pro, paymentUrl: url || undefined } })
    return true
  })
  ipcMain.handle('billing:activate', (_e, key: string) => {
    store.set({ pro: { ...store.get().pro, active: true, key: key || 'manual' } })
    return store.get().pro
  })

  // ── Semantic memory (local RAG) ──
  ipcMain.handle('rag:status', () => rag?.stats ?? { available: false, running: false, chunks: 0, embedded: 0 })
  ipcMain.handle('rag:setup', async (e, modelId: string) => {
    if (!localLlm) throw new Error('no local llm')
    const win = BrowserWindow.fromWebContents(e.sender)
    await localLlm.downloadEmbedModel(modelId, (dl, total) => {
      win?.webContents.send('localllm:progress', { kind: 'embed', downloaded: dl, total })
    })
    await localLlm.ensureEmbedRunning()
    if (rag) await rag.reindex()
    return rag?.stats ?? null
  })
  ipcMain.handle('rag:reindex', async () => rag ? rag.reindex() : null)

  // ── Model manager (disk inventory + delete) ──
  ipcMain.handle('models:list', () => {
    if (!localLlm) return []
    return listModels(localLlm, laya)
  })
  ipcMain.handle('models:delete', async (_e, key: string) => {
    if (!localLlm || typeof key !== 'string' || key.length > 80) throw new Error('invalid model key')
    const res = await deleteModel(localLlm, laya, key)
    pushMcpLog(`model deleted: ${key} (${(res.freedBytes / 1e6).toFixed(0)}MB)`)
    return res
  })

  // ── Laya decision engine (fast ONNX System-1) ──
  ipcMain.handle('laya:status', () => laya?.status() ?? { available: false, loaded: false, modelDir: '', downloaded: false })
  ipcMain.handle('laya:download', async (e) => {
    if (!laya) throw new Error('laya unavailable')
    const win = BrowserWindow.fromWebContents(e.sender)
    await laya.download((done, total, file) => {
      win?.webContents.send('laya:progress', { done, total, file })
    })
    return laya.status()
  })
  ipcMain.handle('laya:test', async () => {
    if (!laya) return null
    return laya.choose('The user prefers dark mode and concise answers.', 'What does the user prefer?', {
      dark: 'dark theme / dark mode',
      light: 'light theme',
      other: 'something else'
    })
  })

  // ── Window ──
  // ── Planner: notes / tasks / daily goals ──
  ipcMain.handle('notes:list', () => planner?.listNotes() ?? [])
  ipcMain.handle('notes:get', (_e, id: string) => planner?.getNote(id) ?? null)
  const ui = <T>(fn: () => T): T => { brain.setActivitySource('ui'); return fn() }
  ipcMain.handle('notes:save', (_e, id: string | null, title: string, body: string) => ui(() => planner?.saveNote(id, title, body)))
  ipcMain.handle('notes:delete', (_e, id: string) => ui(() => { planner?.deleteNote(id); return true }))

  ipcMain.handle('tasks:list', () => planner?.listTasks() ?? [])
  ipcMain.handle('tasks:add', (_e, title: string, opts?: any) => ui(() => planner?.addTask(title, opts)))
  ipcMain.handle('tasks:update', (_e, id: string, patch: any) => ui(() => planner?.updateTask(id, patch)))
  ipcMain.handle('tasks:toggle', (_e, id: string) => ui(() => planner?.toggleTask(id)))
  ipcMain.handle('tasks:delete', (_e, id: string) => ui(() => { planner?.deleteTask(id); return true }))

  ipcMain.handle('goals:get', (_e, date?: string) => planner?.getDailyGoals(date) ?? { date: '', items: [] })
  ipcMain.handle('goals:set', (_e, date: string, items: any[]) => ui(() => planner?.setDailyGoals(date, items)))
  ipcMain.handle('goals:add', (_e, date: string, text: string) => ui(() => planner?.addGoal(date, text)))
  ipcMain.handle('goals:toggle', (_e, date: string, index: number) => ui(() => planner?.toggleGoal(date, index)))
  ipcMain.handle('goals:remove', (_e, date: string, index: number) => ui(() => planner?.removeGoal(date, index)))
  ipcMain.handle('goals:suggest', async () => planner ? planner.suggestGoals() : [])

  // ── Auto-updater ──
  ipcMain.handle('updater:status', () => updaterStatus())
  ipcMain.handle('updater:check', () => checkForUpdates())
  ipcMain.handle('updater:install', () => installUpdate())

  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    try {
      const u = new URL(url)
      if (u.protocol === 'https:' || u.protocol === 'mailto:') return shell.openExternal(url)
    } catch { /* ignore */ }
    return false
  })
}

const mcpLogs: string[] = []
export function pushMcpLog(line: string) {
  mcpLogs.push(line)
  if (mcpLogs.length > 500) mcpLogs.shift()
}

function collectMd(dir: string, prefix = ''): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...collectMd(join(dir, e.name), rel))
    else if (e.name.endsWith('.md')) out.push(rel)
  }
  return out
}
