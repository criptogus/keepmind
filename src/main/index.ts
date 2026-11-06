import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { Store } from './store'
import { Brain } from './services/brain'
import { McpManager } from './services/mcp'
import { LocalLlm } from './services/local-llm'
import { registerIpc, pushMcpLog } from './ipc'

let mainWindow: BrowserWindow | null = null
let store: Store
let brain: Brain
let mcp: McpManager | null = null
let localLlmGlobal: LocalLlm | null = null

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
      sandbox: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  store = new Store()
  mcp = new McpManager(store.get().mcpServers, app.getPath('userData'))
  const localLlm = new LocalLlm(store)
  localLlmGlobal = localLlm
  brain = new Brain(store, mcp, localLlm)
  brain.setMcp(mcp)

  mcp.on('log', (m: any) => pushMcpLog(`[${m.serverId}] ${m.message}`))
  mcp.on('serverExit', (e: any) => pushMcpLog(`server ${e.serverId} exited (${e.code})`))

  registerIpc(store, brain, mcp, localLlm)
  createWindow()

  // Auto-start enabled MCP servers
  for (const s of store.get().mcpServers.filter(s => s.enabled)) {
    mcp.startServer(s).catch(e => pushMcpLog(`auto-start ${s.id} failed: ${e}`))
  }

  // Auto-start the bundled local LLM if it's the configured provider
  if (store.get().ai.provider === 'local' && localLlm.isModelDownloaded()) {
    localLlm.ensureRunning().catch(e => pushMcpLog(`local-llm start failed: ${e}`))
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  mcp?.stopAll()
  localLlmGlobal?.stop()
  if (process.platform !== 'darwin') app.quit()
})
