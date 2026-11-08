import { createHash } from 'node:crypto'
import { HybridSearch } from './search/hybrid'
import { join } from 'node:path'
import type { LocalLlm } from './local-llm'
import type { Memory } from './brain'
import type { LayaService } from './laya'

// ── Local RAG: semantic search over memory via llama.cpp embeddings ──
// mem0-style memory layer, but fully local: chunks of every memory file are
// embedded by the bundled embedding model and stored as vectors in a SQLite
// hybrid index. Chat queries embed the question and inject the top-k chunks into
// the system context — the brain "remembers" semantically, not just by recency.

interface Chunk {
  key: string        // hash of file+offset+text
  file: string
  offset: number
  text: string
  vec?: number[]
  stale?: boolean    // file declares valido_ate/expires in the past
}

interface Index {
  modelId?: string
  chunks: Chunk[]
}

const CHUNK_SIZE = 900
const CHUNK_OVERLAP = 150
const MAX_CHUNKS = 6000
const SEARCH_K = 6

// Order matters: on MAX_CHUNKS truncation the most durable/valuable
// sources survive — entities & long-term first, raw logs last.
const INDEX_DIRS = [
  'entities', 'long-term', 'notes', 'tasks', 'daily', 'skills', 'crm',
  'insights', 'summaries', 'sleep', 'review',
  'short-term', 'medium-term', 'agents', 'inbox', 'meetings'
]
const SKIP_FILES = new Set(['INDEX.md'])

export class RagService {
  private searchDb: Promise<HybridSearch>
  private index: Index = { chunks: [] }
  private embedding = false

  constructor(private localLlm: LocalLlm, memory: Memory, stateDir: string) {
    this.searchDb = HybridSearch.open(join(stateDir, 'memory-search.sqlite'), join(stateDir, 'memory-embeddings.json'))
    this.memory = memory
    void this.searchDb.then(db => { this.index = { modelId: db.modelId, chunks: db.chunks() } }).catch(error => console.warn('[rag] index load failed', error))
  }

  private memory: Memory
  private laya: LayaService | null = null

  setLaya(l: LayaService) { this.laya = l }

  private async save() {
    const db = await this.searchDb
    db.replace(this.index.chunks)
    db.modelId = this.index.modelId
    db.save()
  }

  get stats() {
    return {
      available: this.localLlm.isEmbedModelDownloaded(),
      running: this.localLlm.embedReady,
      modelId: this.localLlm.embedModelId ?? null,
      chunks: this.index.chunks.length,
      embedded: this.index.chunks.filter(c => c.vec).length
    }
  }

  // Rebuild the chunk list from memory files (cheap — no embeddings).
  // Vectors are kept per chunk-hash, so unchanged text never re-embeds.
  private async ensureChunks(): Promise<number> {
    await this.searchDb
    const byKey = new Map(this.index.chunks.map(c => [c.key, c]))
    const next: Chunk[] = []
    let truncated = false
    for (const dir of INDEX_DIRS) {
      const files = this.memory.list(dir)
      for (const f of files) {
        if (SKIP_FILES.has(f)) continue
        const content = this.memory.read(`${dir}/${f}`) ?? ''
        if (!content.trim()) continue
        const stale = isStale(content)
        for (const chunk of chunkText(content)) {
          if (next.length >= MAX_CHUNKS) { truncated = true; break }
          const file = `${dir}/${f}`
          const key = createHash('sha256').update(`${file}:${chunk.offset}:${chunk.text}`).digest('hex')
          const prev = byKey.get(key)
          next.push({ key, file, offset: chunk.offset, text: chunk.text, vec: prev?.vec, stale })
        }
        if (truncated) break
      }
      if (truncated) break
    }
    this.index.chunks = next
    await this.save()
    return next.length
  }

  // Embed any chunks missing vectors. Safe to call repeatedly.
  async embedPending(): Promise<number> {
    await this.searchDb
    if (this.embedding || !this.localLlm.embedReady) return 0
    if (this.index.modelId !== this.localLlm.embedModelId) {
      this.index.chunks.forEach(c => { c.vec = undefined })
      this.index.modelId = this.localLlm.embedModelId
    }
    const pending = this.index.chunks.filter(c => !c.vec)
    if (!pending.length) return 0
    this.embedding = true
    let done = 0
    try {
      for (let i = 0; i < pending.length; i += 32) {
        const batch = pending.slice(i, i + 32)
        const vecs = await this.localLlm.embed(batch.map(c => c.text))
        if (!vecs) break
        batch.forEach((c, j) => { c.vec = vecs[j] })
        done += batch.length
        await this.save()
      }
    } finally {
      this.embedding = false
    }
    return done
  }

  // Full pipeline: refresh chunks then embed what's missing.
  async reindex(): Promise<{ chunks: number; embedded: number }> {
    const chunks = await this.ensureChunks()
    const embedded = await this.embedPending()
    return { chunks, embedded }
  }

  // Semantic recall for a user message → formatted context block (or '').
  async search(query: string): Promise<string> {
    try {
      // lazy chunk refresh at most every 60s
      if (Date.now() - this.lastChunkScan > 60_000) {
        this.lastChunkScan = Date.now()
        await this.ensureChunks()
        void this.embedPending().catch(() => {})
      }
      const qv = this.localLlm.embedReady ? await this.localLlm.embed([query]).catch(() => null) : null
      const db = await this.searchDb
      const q = this.index.modelId === this.localLlm.embedModelId ? qv?.[0] : undefined
      const scored = db.search(query, q, SEARCH_K * 2)
      // Laya rerank (the vault's "Jev" slot): a calibrated yes/no relevance
      // verdict per candidate, blended with the hybrid score. ~33ms each,
      // only runs when the ONNX decision engine is installed.
      if (this.laya?.status().available && scored.length > 1) {
        const reranked = await Promise.all(scored.map(async x => {
          const p = await this.laya!.yesNo(
            `Query: ${query}\n\nCandidate memory:\n${x.c.text.slice(0, 700)}`,
            'Does this memory chunk contain information relevant to answering the query?'
          )
          return { ...x, laya: p }
        }))
        reranked.sort((a, b) => {
          const ra = (a.laya ?? 0.5) * 0.6 + a.s * 0.4
          const rb = (b.laya ?? 0.5) * 0.6 + b.s * 0.4
          return rb - ra
        })
        scored.length = 0
        scored.push(...reranked.slice(0, SEARCH_K))
      } else {
        scored.splice(SEARCH_K)
      }
      const good = scored.filter(x => x.s > 0)
      if (!good.length) return ''
      return good.map(x =>
        `### ${x.c.file}${x.c.stale ? ' ⚠ stale' : ''} (score ${x.s.toFixed(2)})\n${x.c.text.slice(0, 900)}`
      ).join('\n\n')
    } catch { return '' }
  }

  private lastChunkScan = 0
}

// A file is "stale" when its frontmatter declares an expiry date in the past
// (valido_ate / expires / review_after — inspired by vault note_validity).
const STALE_LINE = /^(valido_ate|expires|review_after|stale_after|valid_until)\s*:\s*['"]?(\d{4}-\d{2}-\d{2})/im
function isStale(content: string): boolean {
  if (!content.startsWith('---')) return false
  const end = content.indexOf('\n---', 3)
  const fm = end === -1 ? content.slice(0, 1500) : content.slice(0, end)
  const m = fm.match(STALE_LINE)
  return !!m && m[2] < new Date().toISOString().slice(0, 10)
}

function chunkText(text: string): { offset: number; text: string }[] {
  const clean = text.replace(/\r\n/g, '\n')
  // heading index for section-aware context prefixes
  const headings = [...clean.matchAll(/^#{1,3}\s+(.+?)\s*$/gm)]
  const chunks: { offset: number; text: string }[] = []
  let i = 0
  while (i < clean.length && chunks.length < 400) {
    let end = Math.min(i + CHUNK_SIZE, clean.length)
    // prefer breaking at paragraph/sentence boundary
    if (end < clean.length) {
      const window = clean.slice(i, end)
      const brk = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'))
      if (brk > CHUNK_SIZE * 0.5) end = i + brk + 1
    }
    let body = clean.slice(i, end).trim()
    // prefix nearest preceding heading so chunks keep section context
    const h = [...headings].reverse().find(x => (x.index ?? 0) < i)
    if (h && body && !body.startsWith('#')) body = `§ ${h[1]}\n${body}`
    chunks.push({ offset: i, text: body })
    i = end - CHUNK_OVERLAP > i ? end - CHUNK_OVERLAP : end
    if (end >= clean.length) break
  }
  return chunks.filter(c => c.text.length > 40)
}

