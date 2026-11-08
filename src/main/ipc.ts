import { ipcMain, shell, BrowserWindow } from 'electron'
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

export function registerIpc(
  store: Store,
  brain: Brain,
  mcp: McpManager | null,
  localLlm: LocalLlm | null,
  sync: GitSync | null = null,
  automations: AutomationScheduler | null = null,
  auth: AuthService | null = null,
  rag: RagService | null = null,
  planner: Planner | null = null
) {
  // ── Config ──
  ipcMain.handle('config:get', () => store.get())
  ipcMain.handle('config:set', (_e, patch: any) => store.set(patch))
  ipcMain.handle('config:updateAi', (_e, patch: any) => store.updateAi(patch))
  ipcMain.handle('config:updateLocalLlm', (_e, patch: any) => store.updateLocalLlm(patch))
  ipcMain.handle('config:updateGithub', (_e, patch: any) => store.updateGithub(patch))
  ipcMain.handle('config:updateMcp', (_e, id: string, patch: any) => store.updateMcpServer(id, patch))

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
    if (res) {
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
    if (automations) await automations.run(auto)
    store.set({
      automations: store.get().automations.map(a =>
        a.id === id ? { ...a, lastRunAt: new Date().toISOString() } : a)
    })
    return true
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
  ipcMain.handle('brain:insights', async () => { brain.setActivitySource('summary'); return brain.generateInsights() })
  ipcMain.handle('brain:dailySummary', async () => { brain.setActivitySource('summary'); return brain.dailySummary() })
  ipcMain.handle('brain:sleep', async () => { brain.setActivitySource('sleep'); return brain.sleep() })
  ipcMain.handle('brain:listSleep', () => brain.listSleepReports())
  ipcMain.handle('brain:memoryTiers', () => brain.memoryTierStats())
  ipcMain.handle('brain:listInsights', () => brain.listInsights())
  ipcMain.handle('brain:listSummaries', () => brain.listSummaries())
  ipcMain.handle('brain:listMemory', () => {
    const memDir = store.memoryDir
    return collectMd(memDir).map(rel => ({ path: rel, content: readFileSync(join(memDir, rel), 'utf8').slice(0, 4000) }))
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

  ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url))
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
