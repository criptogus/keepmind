import { existsSync, statSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { LOCAL_MODELS, EMBED_MODELS, type LocalLlm } from './local-llm'
import type { LayaService } from './laya'

// ── Model inventory: everything KeepMind downloads onto disk ──
// chat GGUFs, embedding GGUFs, the llama-server runtime binary and the
// Laya ONNX decision engine. Powers the Settings → Models manager:
// see sizes, what's active, and reclaim disk space.

export interface ModelEntry {
  key: string            // 'chat:qwen2.5-3b' | 'embed:bge-small' | 'runtime:llama-server' | 'decision:laya'
  kind: 'chat' | 'embed' | 'runtime' | 'decision'
  label: string
  detail?: string
  sizeBytes: number
  downloaded: boolean
  active: boolean        // configured / in use by the brain
  running?: boolean      // server process currently up
  path: string
}

function dirSize(dir: string): number {
  let total = 0
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) total += dirSize(p)
      else if (e.isFile()) total += statSync(p).size
    }
  } catch { /* noop */ }
  return total
}

function fileSize(p: string): number {
  try { return statSync(p).size } catch { return 0 }
}

export function listModels(localLlm: LocalLlm, laya: LayaService | null): ModelEntry[] {
  const out: ModelEntry[] = []
  const cfg = (localLlm as any).cfg ?? {}

  // ── chat models ──
  const chatDir = join((localLlm as any).modelsDir ?? join(app.getPath('userData'), 'local-llm', 'models'))
  const activeChat = cfg.modelId ?? LOCAL_MODELS[1]?.id
  for (const m of LOCAL_MODELS) {
    const p = join(chatDir, `${m.id}.gguf`)
    const size = fileSize(p)
    out.push({
      key: `chat:${m.id}`, kind: 'chat', label: m.label, detail: m.description,
      sizeBytes: size, downloaded: size > 100_000_000,
      active: activeChat === m.id, running: activeChat === m.id && localLlm.isRunning,
      path: p
    })
  }

  // ── embedding models ──
  const activeEmbed = cfg.embedModelId ?? EMBED_MODELS[0]?.id
  for (const m of EMBED_MODELS) {
    const p = join(chatDir, `embed-${m.id}.gguf`)
    const size = fileSize(p)
    out.push({
      key: `embed:${m.id}`, kind: 'embed', label: `${m.label} (embeddings)`, detail: `${m.dims} dims · powers semantic search`,
      sizeBytes: size, downloaded: size > 10_000_000,
      active: activeEmbed === m.id, running: activeEmbed === m.id && localLlm.embedReady,
      path: p
    })
  }

  // ── llama.cpp runtime binary ──
  const bin = localLlm.getServerBinary()
  const binPath = bin || join(app.getPath('userData'), 'local-llm', 'bin')
  out.push({
    key: 'runtime:llama-server', kind: 'runtime', label: 'llama.cpp server',
    detail: 'Local inference engine — required by chat + embedding models',
    sizeBytes: bin ? fileSize(bin) : 0, downloaded: !!bin,
    active: localLlm.isRunning || localLlm.embedReady,
    running: localLlm.isRunning || localLlm.embedReady,
    path: binPath
  })

  // ── Laya decision engine ──
  const layaDir = join(app.getPath('userData'), 'laya')
  const st = laya?.status()
  out.push({
    key: 'decision:laya', kind: 'decision', label: 'Laya decision engine',
    detail: 'ONNX "System 1" — fast inbox triage, dedup, RAG rerank (~33ms decisions)',
    sizeBytes: dirSize(layaDir), downloaded: !!st?.downloaded,
    active: !!st?.downloaded, running: !!st?.loaded,
    path: layaDir
  })

  return out
}

export interface DeleteResult { key: string; freedBytes: number; warnings: string[] }

export async function deleteModel(
  localLlm: LocalLlm,
  laya: LayaService | null,
  key: string
): Promise<DeleteResult> {
  const warnings: string[] = []
  let freed = 0

  if (key.startsWith('chat:')) {
    const id = key.slice(5)
    const p = localLlm.getModelPath(id)
    freed = fileSize(p)
    if (existsSync(p)) unlinkSync(p)
    const cfg = (localLlm as any).cfg ?? {}
    if ((cfg.modelId ?? LOCAL_MODELS[1]?.id) === id) {
      ;(localLlm as any).store?.updateLocalLlm?.({ modelId: undefined })
      warnings.push('was the active chat model — provider falls back to default')
      await localLlm.stop()
    }
  } else if (key.startsWith('embed:')) {
    const id = key.slice(6)
    const p = localLlm.getEmbedModelPath(id)
    freed = fileSize(p)
    if (existsSync(p)) unlinkSync(p)
    const cfg = (localLlm as any).cfg ?? {}
    if ((cfg.embedModelId ?? EMBED_MODELS[0]?.id) === id) {
      ;(localLlm as any).store?.updateLocalLlm?.({ embedModelId: undefined })
      warnings.push('was the active embedding model — RAG falls back to default')
      await localLlm.stop()
    }
  } else if (key === 'runtime:llama-server') {
    const bin = localLlm.getServerBinary()
    if (bin) { freed = fileSize(bin); unlinkSync(bin) }
    const zip = join(app.getPath('userData'), 'local-llm', 'bin', 'llama-server.zip')
    if (existsSync(zip)) { freed += fileSize(zip); unlinkSync(zip) }
    await localLlm.stop()
    warnings.push('llama-server removed — models will re-download it on next use')
  } else if (key === 'decision:laya') {
    const dir = join(app.getPath('userData'), 'laya')
    freed = dirSize(dir)
    laya?.unload()
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  } else {
    throw new Error(`Unknown model key: ${key}`)
  }

  return { key, freedBytes: freed, warnings }
}
