import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export type CorpServerHandle = { port: number; baseUrl: string; stop: () => void }

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address()
      if (!addr || typeof addr === 'string') {
        s.close(); reject(new Error('No port'))
        return
      }
      const port = addr.port
      s.close(() => resolve(port))
    })
    s.on('error', reject)
  })
}

async function waitHealth(baseUrl: string, ms = 30_000): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const res = await fetch(`${baseUrl}/api/health`)
      if (res.ok) return
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('KeepMind Corp server did not start')
}

export async function startEmbeddedCorpServer(log: (m: string) => void): Promise<CorpServerHandle> {
  const port = await freePort()
  const dataDir = join(app.getPath('userData'), 'keepmind-corp', 'data')
  const vault = join(dataDir, 'vault')
  const corpRoot = app.isPackaged
    ? join(process.resourcesPath, 'corp')
    : join(app.getAppPath(), 'corp')
  const serverPath = join(corpRoot, 'server.mjs')
  if (!existsSync(serverPath)) throw new Error(`Corp server missing at ${serverPath}`)

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    KEEPMIND_CORP_HOST: '127.0.0.1',
    KEEPMIND_CORP_PORT: String(port),
    KEEPMIND_CORP_DATA: dataDir,
    KEEPMIND_VAULT: vault,
    KEEPMIND_CORP_ORG_NAME: process.env.KEEPMIND_CORP_ORG_NAME || 'KeepMind Corp'
  }

  let child: ChildProcess | null = spawn(process.execPath, [serverPath], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })

  child.stdout?.on('data', (c: Buffer) => log(String(c).trim()))
  child.stderr?.on('data', (c: Buffer) => log(String(c).trim()))
  child.on('exit', (code, signal) => {
    if (code !== null && code !== 0) log(`corp server exited ${code}`)
    else if (signal) log(`corp server signal ${signal}`)
    child = null
  })

  const baseUrl = `http://127.0.0.1:${port}`
  await waitHealth(baseUrl)

  return {
    port,
    baseUrl,
    stop: () => {
      if (!child) return
      child.kill('SIGTERM')
      child = null
    }
  }
}
