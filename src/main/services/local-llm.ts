import { spawn, ChildProcess, execFile } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, statSync, createReadStream } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { promisify } from 'node:util'
import type { LocalLlmConfig, Store } from '../store'

const execFileP = promisify(execFile)

// ── Bundled local LLM: llama.cpp `llama-server` + GGUF model ──
// Downloads the llama.cpp release binary for the current platform and a
// quantized instruct model from HuggingFace on first run, then serves an
// OpenAI-compatible API on 127.0.0.1:<port>/v1.

export interface LocalModel {
  id: string
  label: string
  sizeGB: number
  hfRepo: string
  hfFile: string
  description: string
}

export const LOCAL_MODELS: LocalModel[] = [
  {
    id: 'smollm2-1.7b',
    label: 'SmolLM2 1.7B',
    sizeGB: 1.1,
    hfRepo: 'HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF',
    hfFile: 'smollm2-1_7b-instruct-q4_k_m.gguf',
    description: 'Smallest option. Fast on any machine, good for chat and light tasks.'
  },
  {
    id: 'qwen2.5-3b',
    label: 'Qwen2.5 3B',
    sizeGB: 2.0,
    hfRepo: 'Qwen/Qwen2.5-3B-Instruct-GGUF',
    hfFile: 'qwen2.5-3b-instruct-q4_k_m.gguf',
    description: 'Recommended default. Strong multilingual + tool calling, ~8GB RAM.'
  },
  {
    id: 'llama3.2-3b',
    label: 'Llama 3.2 3B',
    sizeGB: 2.0,
    hfRepo: 'bartowski/Meta-Llama-3.2-3B-Instruct-GGUF',
    hfFile: 'Meta-Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    description: 'Meta\'s small model. Good reasoning for its size.'
  },
  {
    id: 'qwen2.5-7b',
    label: 'Qwen2.5 7B',
    sizeGB: 4.7,
    hfRepo: 'Qwen/Qwen2.5-7B-Instruct-GGUF',
    hfFile: 'qwen2.5-7b-instruct-q4_k_m.gguf',
    description: 'Best quality. Needs ~12GB RAM / Apple Silicon recommended.'
  }
]

const LLAMA_CPP_TAG = 'b5590' // pinned llama.cpp release; bump periodically

interface PlatformAsset { os: string; arch: string; name: string; url: string }

function platformAsset(): PlatformAsset {
  const p = process.platform
  const a = process.arch
  if (p === 'darwin' && a === 'arm64') {
    return {
      os: 'macos', arch: 'arm64', name: 'llama-server',
      url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_TAG}/llama-${LLAMA_CPP_TAG}-bin-macos-arm64.zip`
    }
  }
  if (p === 'darwin') {
    return {
      os: 'macos', arch: 'x64', name: 'llama-server',
      url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_TAG}/llama-${LLAMA_CPP_TAG}-bin-macos-x64.zip`
    }
  }
  if (p === 'win32') {
    const arch = a === 'arm64' ? 'arm64' : 'x64'
    return {
      os: 'win32', arch, name: 'llama-server.exe',
      url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_TAG}/llama-${LLAMA_CPP_TAG}-bin-win-${arch}.zip`
    }
  }
  // linux
  const arch = a === 'arm64' ? 'arm64' : 'x64'
  return {
    os: 'linux', arch, name: 'llama-server',
    url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_TAG}/llama-${LLAMA_CPP_TAG}-bin-ubuntu-${arch}.zip`
  }
}

export class LocalLlm {
  private store: Store
  private proc: ChildProcess | null = null
  private rootDir: string
  private modelsDir: string
  private binDir: string

  constructor(store: Store) {
    this.store = store
    this.rootDir = join(app.getPath('userData'), 'local-llm')
    this.modelsDir = join(this.rootDir, 'models')
    this.binDir = join(this.rootDir, 'bin')
    mkdirSync(this.modelsDir, { recursive: true })
    mkdirSync(this.binDir, { recursive: true })
  }

  private get cfg(): LocalLlmConfig { return this.store.get().localLlm }

  get modelCatalog() { return LOCAL_MODELS }

  getServerBinary(): string {
    const asset = platformAsset()
    const bin = join(this.binDir, asset.name)
    return existsSync(bin) ? bin : ''
  }

  getModelPath(modelId?: string): string {
    const id = modelId ?? this.cfg.modelId ?? LOCAL_MODELS[1].id
    return join(this.modelsDir, `${id}.gguf`)
  }

  isModelDownloaded(modelId?: string): boolean {
    const p = this.getModelPath(modelId)
    return existsSync(p) && statSync(p).size > 100_000_000 // sanity: >100MB
  }

  isServerDownloaded(): boolean { return !!this.getServerBinary() }

  async downloadServer(onProgress?: (pct: number) => void): Promise<string> {
    const asset = platformAsset()
    const bin = join(this.binDir, asset.name)
    if (existsSync(bin)) return bin

    const zipPath = join(this.binDir, 'llama-server.zip')
    await download(asset.url, zipPath, onProgress)
    // unzip — use `unzip` on mac/linux, PowerShell on windows
    if (process.platform === 'win32') {
      await execFileP('powershell', ['-Command',
        `Expand-Archive -Path '${zipPath}' -DestinationPath '${this.binDir}' -Force`])
    } else {
      await execFileP('unzip', ['-o', zipPath, '-d', this.binDir])
    }
    // binaries may land in a subdir; find llama-server
    const found = findBinary(this.binDir, asset.name)
    if (!found) throw new Error('llama-server binary not found after unzip')
    if (found !== bin) {
      const { renameSync, chmodSync } = await import('node:fs')
      renameSync(found, bin)
      chmodSync(bin, 0o755)
    }
    return bin
  }

  async downloadModel(modelId: string, onProgress?: (downloaded: number, total: number) => void): Promise<string> {
    const model = LOCAL_MODELS.find(m => m.id === modelId)
    if (!model) throw new Error(`Unknown model: ${modelId}`)
    const dest = this.getModelPath(modelId)
    if (existsSync(dest) && statSync(dest).size > 100_000_000) return dest

    const url = `https://huggingface.co/${model.hfRepo}/resolve/main/${model.hfFile}`
    await download(url, dest, (pct, dl, total) => onProgress?.(dl, total ?? model.sizeGB * 1e9))
    this.store.updateLocalLlm({ modelId })
    return dest
  }

  async ensureReady(modelId: string): Promise<boolean> {
    if (!this.isServerDownloaded()) await this.downloadServer()
    if (!this.isModelDownloaded(modelId)) await this.downloadModel(modelId)
    return this.ensureRunning(modelId)
  }

  async ensureRunning(modelId?: string): Promise<boolean> {
    const id = modelId ?? this.cfg.modelId ?? LOCAL_MODELS[1].id
    const port = this.cfg.port ?? 8765
    // health check
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) })
      if (res.ok) return true
    } catch { /* not running */ }

    const bin = this.getServerBinary()
    const modelPath = this.getModelPath(id)
    if (!bin || !existsSync(modelPath)) return false

    this.proc = spawn(bin, [
      '-m', modelPath,
      '--port', String(port),
      '--host', '127.0.0.1',
      '-c', '8192',          // context
      '-ngl', '99',          // offload all layers to GPU if available
      '--jinja'              // enables tool-call chat template support
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    this.proc.stdout?.on('data', d => console.log('[llama-server]', d.toString().trim()))
    this.proc.stderr?.on('data', d => console.log('[llama-server:err]', d.toString().trim()))

    // wait for health
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 1000))
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })
        if (res.ok) {
          this.store.updateLocalLlm({ modelId: id, port })
          return true
        }
      } catch { /* keep waiting */ }
      if (this.proc.killed) return false
    }
    return false
  }

  async stop() {
    try { this.proc?.kill('SIGTERM') } catch { /* noop */ }
    this.proc = null
  }

  get isRunning(): boolean { return !!this.proc && !this.proc.killed }

  get endpoint(): string {
    const port = this.cfg.port ?? 8765
    return `http://127.0.0.1:${port}/v1`
  }
}

// ── helpers ──

async function download(url: string, dest: string, onProgress?: (pct: number, dl: number, total?: number) => void): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${url}`)
  const total = Number(res.headers.get('content-length') ?? 0) || undefined
  const file = createWriteStream(dest)
  const reader = res.body.getReader()
  let downloaded = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      file.write(Buffer.from(value))
      downloaded += value.length
      onProgress?.(total ? downloaded / total : 0, downloaded, total)
    }
  } finally {
    file.end()
    await new Promise<void>(res => file.on('finish', () => res()))
  }
}

function findBinary(dir: string, name: string, depth = 3): string {
  if (depth < 0) return ''
  for (const e of require('node:fs').readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      const found = findBinary(p, name, depth - 1)
      if (found) return found
    } else if (e.name === name || e.name === `${name}.exe`) {
      return p
    }
  }
  return ''
}
