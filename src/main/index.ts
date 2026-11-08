import { randomUUID } from 'node:crypto'
import { configureEgressContext, type Consent } from './services/security/egress'
import { RefreshScheduler } from './services/ingest/scheduler'
import { SecuritySession, diskSecretStore } from './services/security/session'
import { app, BrowserWindow, shell, ipcMain, safeStorage } from 'electron'
import { join } from 'node:path'
import { Store } from './store'
import { Brain } from './services/brain'
import { McpManager } from './services/mcp'
import { LocalLlm } from './services/local-llm'
import { GitSync } from './services/sync'
import { AutomationScheduler } from './services/automations'
import { AuthService } from './services/auth'
import { RagService } from './services/rag'
import { LayaService } from './services/laya'
import { Planner } from './services/planner'
import { registerIpc, pushMcpLog } from './ipc'
import { initUpdater } from './services/updater'

let mainWindow: BrowserWindow | null = null
let store: Store
let brain: Brain
let mcp: McpManager | null = null
let localLlmGlobal: LocalLlm | null = null
let gitSyncGlobal: GitSync | null = null
let refreshSchedulerGlobal: RefreshScheduler | null = null
let autoSchedulerGlobal: AutomationScheduler | null = null

// Headless mode: services only (GitHub sync, MCP, LLM, automations) — no window.
// For VPS / bot VMs: `xvfb-run -a env SECOND_BRAIN_HEADLESS=1 second-brain`
const HEADLESS = process.env.SECOND_BRAIN_HEADLESS === '1' || process.argv.includes('--headless')

// Only web/mail links may leave the app — blocks file://, javascript:,
// custom protocol handlers and anything else a page might try to open.
function openExternalSafe(url: string) {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:' || u.protocol === 'mailto:') shell.openExternal(url)
  } catch { /* malformed url — ignore */ }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#030712',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  store = new Store()
  mcp = new McpManager(store.get().mcpServers, app.getPath('userData'))
  const localLlm = new LocalLlm(store)
  localLlmGlobal = localLlm
  brain = new Brain(store, mcp, localLlm)
  const securityDir = join(app.getPath('userData'), 'second-brain', 'security')
  const consents: Consent[] = []
  configureEgressContext(() => ({ space: brain.getMemory().currentSpace, spaces: [...brain.getMemory().readSpaces], class: brain.getMemory().classificationFloor, grants: consents, logFile: join(securityDir, 'egress.jsonl') }))
  ipcMain.handle('security:consent', (_e, provider: string) => {
    if (!['anthropic', 'claude-oauth', 'openai', 'codex', 'gemini', 'grok'].includes(provider)) throw new Error('Invalid cloud provider')
    const consent = { id: randomUUID(), provider, space: brain.getMemory().currentSpace, expiresAt: Date.now() + 15 * 60_000 }
    consents.push(consent); return consent
  })
  const security = new SecuritySession(brain.getMemory(), securityDir, diskSecretStore(join(securityDir, 'keychain'), safeStorage))
  if (security.status.configured) { try { await security.unlock() } catch { /* remains locked until explicit unlock */ } }
  ipcMain.handle('security:status', () => security.status)
  ipcMain.handle('security:setup', async (_e, passphrase: unknown) => {
    if (typeof passphrase !== 'string' || !passphrase || passphrase.length > 8192) throw new Error('Invalid passphrase')
    const result = await security.setup(passphrase)
    // Always deliver the one-time recovery key, even if index migration fails.
    try { (await rag.database()).save(); await startRefresh() }
    catch { pushMcpLog('Search index migration failed; retry after unlocking') }
    return result
  })
  ipcMain.handle('security:unlock', async (_e, credential: { passphrase?: string; recoveryKey?: string } | undefined) => {
    if (credential && (Object.keys(credential).some(k => !['passphrase', 'recoveryKey'].includes(k)) || Object.values(credential).some(v => typeof v !== 'string' || v.length > 8192))) throw new Error('Invalid credential')
    await security.unlock(credential); await startRefresh(); return security.status
  })
  ipcMain.handle('security:lock', () => { security.lock(); consents.splice(0); return security.status })
  ipcMain.handle('security:configure', async (_e, space: string, grants: string[], encryptAll: boolean) => {
    if (typeof space !== 'string' || !Array.isArray(grants) || grants.some(s => typeof s !== 'string') || typeof encryptAll !== 'boolean') throw new Error('Invalid security configuration')
    security.configure(space, grants, encryptAll); await rag.reindex(); return security.status
  })
  brain.setMcp(mcp)
  const gitSync = new GitSync(store, brain.getMemory(), join(app.getPath('userData'), 'second-brain'))
  brain.attachSync(gitSync)
  gitSyncGlobal = gitSync
  const autoScheduler = new AutomationScheduler(store, brain, (m) => pushMcpLog(`[auto] ${m}`))
  autoSchedulerGlobal = autoScheduler
  const auth = new AuthService(join(app.getPath('userData'), 'second-brain'))
  const rag = new RagService(localLlm, brain.getMemory(), join(app.getPath('userData'), 'second-brain'), {
    root: store.memoryDir,
    // The first local account owns this installation; other accounts receive no owner capability.
    isOwner: async () => (await auth.userByToken(store.get().auth.sessionToken))?.id === 1
  })
  brain.setRag(rag)
  const refreshDir = join(app.getPath('userData'), 'second-brain')
  let refresh: RefreshScheduler | undefined
  async function startRefresh() {
    if (refresh) return refresh
    const refreshDb = await rag.database()
    const configuredInterval = Number(process.env.KEEPMIND_REFRESH_INTERVAL_MS ?? 60000)
    refresh = new RefreshScheduler(brain!.getMemory(), refreshDb, refreshDir, configuredInterval)
    refreshSchedulerGlobal = refresh
    refresh.start()
    return refresh
  }
  if (security.status.unlocked) await startRefresh()
  ipcMain.handle('pipeline:status', () => refresh?.status.snapshot() ?? { locked: true })
  ipcMain.handle('pipeline:refresh', async () => (await startRefresh()).refresh())
  ipcMain.handle('pipeline:enqueue', async (_e, job: { platform: string; url: string; space: string }) => {
    if (!job || typeof job.url !== 'string' || job.url.length > 4096 || !/^[a-z0-9_-]{1,50}$/.test(job.platform) || typeof job.space !== 'string') throw new Error('Invalid ingestion job')
    const scheduler = await startRefresh()
    scheduler.enqueue(job); return { queued: true }
  })
  // Laya — fast System-1 decision engine (ONNX, local). Powers quick
  // decisions: memory classification, dedup gates, RAG reranking.
  const laya = new LayaService()
  brain.setLaya(laya)
  rag.setLaya(laya)

  mcp.on('log', (m: any) => pushMcpLog(`[${m.serverId}] ${m.message}`))
  mcp.on('serverExit', (e: any) => pushMcpLog(`server ${e.serverId} exited (${e.code})`))

  const planner = new Planner(brain.getMemory(), store, localLlm)
  registerIpc(store, brain, mcp, localLlm, gitSync, autoScheduler, auth, rag, planner, laya)
  initUpdater()
  if (!HEADLESS) createWindow()
  else console.log('[keepmind] headless mode — services only, no window')

  // Continuous GitHub sync — push local writes, pull remote memory
  gitSync.start()
  // Scheduled automations (natural-language crons)
  autoScheduler.start()

  // Semantic memory: start the embedding server if the model is already downloaded
  if (localLlm.isEmbedModelDownloaded()) {
    localLlm.ensureEmbedRunning()
      .then(ok => { if (ok) rag.reindex().catch(() => {}) })
      .catch(e => pushMcpLog(`embed server start failed: ${e}`))
  }

  // Auto-start enabled MCP servers
  for (const s of store.get().mcpServers.filter(s => s.enabled)) {
    mcp.startServer(s).catch(e => pushMcpLog(`auto-start ${s.id} failed: ${e}`))
  }

  // Auto-start the bundled local LLM if it's the configured provider
  if (store.get().ai.provider === 'local' && localLlm.isModelDownloaded()) {
    localLlm.ensureRunning().catch(e => pushMcpLog(`local-llm start failed: ${e}`))
  }

  // Auto-generate daily insights + summary once per day (best-effort, background)
  setTimeout(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10)
      const hasSummary = brain.listSummaries().some(s => s.date === today)
      if (!hasSummary && store.isConfigured) {
        await brain.generateInsights()
        await brain.dailySummary()
        pushMcpLog('auto: daily insights + summary generated')
      }
    } catch (e) {
      pushMcpLog(`auto-summary failed: ${e}`)
    }
  }, 45_000)

  if (HEADLESS) {
    const shutdown = () => {
      mcp?.stopAll(); localLlmGlobal?.stop(); gitSyncGlobal?.stop(); autoSchedulerGlobal?.stop()
      app.quit()
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && !HEADLESS) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (HEADLESS) return // services keep running until SIGTERM
  mcp?.stopAll()
  localLlmGlobal?.stop()
  gitSyncGlobal?.stop()
  autoSchedulerGlobal?.stop()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => refreshSchedulerGlobal?.stop())
