import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalLlm } from './local-llm'
import type { Memory } from './brain'

// ── Local RAG: semantic search over memory via llama.cpp embeddings ──
// mem0-style memory layer, but fully local: chunks of every memory file are
// embedded by the bundled embedding model and stored as vectors in a JSON
// index. Chat queries embed the question and inject the top-k chunks into
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
  private indexFile: string
  private index: Index = { chunks: [] }
  private indexing = false
  private embedding = false

  constructor(private localLlm: LocalLlm, memory: Memory, stateDir: string) {
    this.indexFile = join(stateDir, 'memory-embeddings.json')
    this.memory = memory
    this.load()
  }

  private memory: Memory

  private load() {
    try {
      if (existsSync(this.indexFile)) this.index = JSON.parse(readFileSync(this.indexFile, 'utf8'))
    } catch { /* fresh index */ }
  }

  private save() {
    try {
      mkdirSync(join(this.indexFile, '..'), { recursive: true })
      writeFileSync(this.indexFile, JSON.stringify(this.index), 'utf8')
    } catch { /* non-fatal */ }
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
          const key = createHash('sha1').update(`${file}:${chunk.offset}:${chunk.text.slice(0, 80)}`).digest('hex').slice(0, 16)
          const prev = byKey.get(key)
          next.push({ key, file, offset: chunk.offset, text: chunk.text, vec: prev?.vec, stale: stale || prev?.stale })
        }
        if (truncated) break
      }
      if (truncated) break
    }
    this.index.chunks = next
    this.save()
    return next.length
  }

  // Embed any chunks missing vectors. Safe to call repeatedly.
  async embedPending(): Promise<number> {
    if (this.embedding || !this.localLlm.embedReady) return 0
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
        this.save()
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
    if (!this.localLlm.embedReady) return ''
    try {
      // lazy chunk refresh at most every 60s
      if (Date.now() - this.lastChunkScan > 60_000) {
        this.lastChunkScan = Date.now()
        void this.ensureChunks().then(() => this.embedPending()).catch(() => {})
      }
      const qv = await this.localLlm.embed([query])
      if (!qv?.[0]) return ''
      const q = qv[0]
      const qTerms = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length > 2)
      const scored = this.index.chunks
        .filter(c => c.vec && c.vec.length === q.length)
        .map(c => {
          const vec = cosine(q, c.vec!)
          // hybrid: vector similarity + lexical overlap (BM25-ish), stale demoted
          const lower = c.text.toLowerCase()
          const hits = qTerms.reduce((n, t) => n + (lower.includes(t) ? 1 : 0), 0)
          const lex = qTerms.length ? hits / qTerms.length : 0
          const stalePenalty = c.stale ? 0.55 : 1
          return { c, s: (vec * 0.7 + lex * 0.3) * stalePenalty, vec, lex }
        })
        .sort((a, b) => b.s - a.s)
        .slice(0, SEARCH_K)
      const good = scored.filter(x => x.s > 0.3)
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

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}
