import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

// ── Laya: fast System-1 decision engine (vendored laya-ts, Apache-2.0) ──
//
// Non-autoregressive typed decisions — choice / score / yes-no — in a
// single forward pass (~33ms), fully local via ONNX Runtime. Used for the
// brain's quick decisions: reranking retrieved memories, triaging captures,
// dedup checks, routing — the cheap "reflexes" that don't need the LLM.
//
// Model: int8 ONNX export of convaiinnovations/laya (English checkpoint),
// ~520MB downloaded on demand to <userData>/laya/. If the model isn't
// installed every method returns null and callers fall back gracefully.

// HF repo hosting a split-ONNX export (encoder/head + external .data).
// File names inside the .onnx reference the *_q8.onnx.data names, so we
// keep the data files as-is and only rename the graph files.
const MODEL_REPO = 'nvkudva/laya-onnx-q8'
const MODEL_REVISION = 'main'
const MODEL_FILES: [string, string][] = [
  ['v1/encoder_q8.onnx', 'encoder.onnx'],
  ['v1/encoder_q8.onnx.data', 'encoder_q8.onnx.data'],
  ['v1/head_q8.onnx', 'head.onnx'],
  ['v1/head_q8.onnx.data', 'head_q8.onnx.data'],
  ['v1/rl_agent_config.json', 'rl_agent_config.json'],
  ['v1/tokenizer.json', 'tokenizer.json'],
  ['v1/tokenizer_config.json', 'tokenizer_config.json']
]

type LayaAgent = {
  predict: (state: string, questions: Record<string, unknown>) => Promise<any>
  systemOne?: (state: string, questions: Record<string, unknown>, opts?: any) => Promise<any>
}

export interface LayaStatus {
  available: boolean   // onnxruntime + model present
  loaded: boolean      // agent instantiated
  modelDir: string
  downloaded: boolean  // all files present
  error?: string
}

export class LayaService {
  private agent: LayaAgent | null = null
  private loading: Promise<LayaAgent | null> | null = null
  private statusError: string | null = null
  private modelDir: string

  constructor() {
    this.modelDir = join(app.getPath('userData'), 'laya')
  }

  status(): LayaStatus {
    const downloaded = existsSync(join(this.modelDir, 'encoder.onnx')) &&
      existsSync(join(this.modelDir, 'head.onnx')) &&
      existsSync(join(this.modelDir, 'rl_agent_config.json'))
    return {
      available: downloaded,
      loaded: !!this.agent,
      modelDir: this.modelDir,
      downloaded,
      error: this.statusError ?? undefined
    }
  }

  private async getAgent(): Promise<LayaAgent | null> {
    if (this.agent) return this.agent
    if (!this.status().downloaded) return null
    if (!this.loading) {
      this.loading = (async () => {
        try {
          const mod = await import('../vendor/laya/index.js')
          const agent = await mod.Agent.load(this.modelDir)
          this.agent = agent as LayaAgent
          return this.agent
        } catch (e) {
          this.statusError = e instanceof Error ? e.message : String(e)
          return null
        } finally {
          this.loading = null
        }
      })()
    }
    return this.loading
  }

  // Drop the loaded agent (e.g. before deleting the model files).
  unload() {
    this.agent = null
    this.loading = null
  }

  // ── Download ──

  async download(onProgress?: (done: number, total: number, file: string) => void): Promise<void> {
    mkdirSync(this.modelDir, { recursive: true })
    const totalBytes = MODEL_FILES.reduce((n, [src]) => n + expectedSize(src), 0)
    let done = 0
    for (const [src, dest] of MODEL_FILES) {
      const destPath = join(this.modelDir, dest)
      const size = await this.downloadFile(src, destPath)
      done += size
      onProgress?.(done, totalBytes, dest)
    }
    // verify the two graph files are non-trivial
    for (const f of ['encoder.onnx', 'head.onnx']) {
      const p = join(this.modelDir, f)
      if (!existsSync(p)) throw new Error(`download incomplete: ${f} missing`)
    }
  }

  private async downloadFile(src: string, destPath: string): Promise<number> {
    // skip if already fully downloaded (size match via HEAD)
    const url = `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${src}`
    const head = await fetch(url, { method: 'HEAD', redirect: 'follow' })
    const expected = Number(head.headers.get('content-length') ?? 0)
    if (existsSync(destPath) && expected > 0) {
      const { statSync } = await import('node:fs')
      if (statSync(destPath).size === expected) return expected
    }
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(`download failed ${src}: HTTP ${res.status}`)
    const tmp = `${destPath}.part`
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tmp))
    const { renameSync } = await import('node:fs')
    renameSync(tmp, destPath)
    return expected || 0
  }

  // ── Decisions ──

  // Generic typed decision. Returns null when the engine isn't available.
  async decide(state: string, questions: Record<string, unknown>): Promise<any | null> {
    const agent = await this.getAgent()
    if (!agent) return null
    try {
      return await agent.predict(state.slice(0, 4000), questions)
    } catch {
      return null
    }
  }

  // Convenience: pick one of N options. Returns { choice, confidence } | null.
  async choose(state: string, question: string, options: Record<string, string>): Promise<{ choice: string; confidence: number } | null> {
    const out = await this.decide(state, {
      pick: { type: 'choice', instructions: question, criteria: options }
    })
    const a = out?.answers?.pick
    if (!a?.choice) return null
    return { choice: a.choice, confidence: a.answer_confidence ?? a.confidence ?? 0 }
  }

  // Convenience: rate on an ordered scale. Returns index | null.
  async score(state: string, question: string, levels: string[]): Promise<{ score: number; confidence: number } | null> {
    const out = await this.decide(state, {
      rate: { type: 'score', instructions: question, criteria: levels }
    })
    const a = out?.answers?.rate
    if (a?.score == null) return null
    return { score: a.score, confidence: a.answer_confidence ?? a.confidence ?? 0 }
  }

  // Convenience: yes/no probability. Returns P(yes) 0..1 | null.
  async yesNo(state: string, question: string): Promise<number | null> {
    const out = await this.decide(state, {
      ans: { type: 'noul', instructions: question }
    })
    const a = out?.answers?.ans
    const p = a?.noul ?? a?.probability ?? a?.score
    return typeof p === 'number' ? p : null
  }
}

// Rough expected sizes for progress display (bytes) — only used for the
// progress bar; actual bytes come from each download.
function expectedSize(src: string): number {
  if (src.includes('encoder_q8.onnx.data')) return 468_000_000
  if (src.includes('head_q8.onnx.data')) return 53_000_000
  if (src.includes('encoder_q8.onnx')) return 2_900_000
  if (src.includes('tokenizer.json')) return 3_600_000
  return 1_000
}

export function layaFingerprint(agent: unknown): string {
  return createHash('sha1').update(String(agent)).digest('hex').slice(0, 8)
}
