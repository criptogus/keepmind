import { ipcMain, shell, BrowserWindow } from 'electron'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Store } from './store'
import { Brain } from './services/brain'
import { McpManager } from './services/mcp'
import { LocalLlm, LOCAL_MODELS } from './services/local-llm'
import * as llm from './services/llm'
import * as github from './services/github'

export function registerIpc(store: Store, brain: Brain, mcp: McpManager | null, localLlm: LocalLlm | null) {
  // ── Config ──
  ipcMain.handle('config:get', () => store.get())
  ipcMain.handle('config:set', (_e, patch: any) => store.set(patch))
  ipcMain.handle('config:updateAi', (_e, patch: any) => store.updateAi(patch))
  ipcMain.handle('config:updateLocalLlm', (_e, patch: any) => store.updateLocalLlm(patch))
  ipcMain.handle('config:updateGithub', (_e, patch: any) => store.updateGithub(patch))
  ipcMain.handle('config:updateMcp', (_e, id: string, patch: any) => store.updateMcpServer(id, patch))
  ipcMain.handle('config:addAgent', (_e, agent: any) => store.addAgent(agent))
  ipcMain.handle('config:removeAgent', (_e, id: string) => store.removeAgent(id))

  // ── AI providers ──
  ipcMain.handle('ai:providers', () => llm.listProviders())
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
    currentModelDownloaded: localLlm ? localLlm.isModelDownloaded() : false
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

  // ── Brain ──
  ipcMain.handle('brain:chat', async (e, agentId: string, message: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return brain.chat(agentId, message, (t) => {
      win?.webContents.send('brain:delta', t)
    })
  })
  ipcMain.handle('brain:insights', async () => brain.generateInsights())
  ipcMain.handle('brain:dailySummary', async () => brain.dailySummary())
  ipcMain.handle('brain:listInsights', () => brain.listInsights())
  ipcMain.handle('brain:listSummaries', () => brain.listSummaries())
  ipcMain.handle('brain:listMemory', () => {
    const memDir = store.memoryDir
    return collectMd(memDir).map(rel => ({ path: rel, content: readFileSync(join(memDir, rel), 'utf8').slice(0, 4000) }))
  })

  // ── Window ──
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
