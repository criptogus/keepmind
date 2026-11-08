import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Memory } from '../brain/memory-store'
import { HybridSearch, type SearchChunk } from '../search/hybrid'
import { policy, allowedSpace } from '../security/classification'
import { VideoPipeline, type CliRunner, type IndexReceipt, type VideoJob } from './video'
import { PipelineStatus } from './status'
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
export class RefreshScheduler {
  private timer?: NodeJS.Timeout
  private refreshing?: Promise<{ changed: number }>
  private hashes: Record<string, string> = {}
  readonly status: PipelineStatus
  readonly pipeline: VideoPipeline
  private hashFile: string
  constructor(private memory: Memory, private db: HybridSearch, private stateDir: string, readonly intervalMs = 60_000, cli?: CliRunner) {
    if (!Number.isFinite(intervalMs) || intervalMs < 1000) throw new Error('Invalid refresh interval')
    mkdirSync(stateDir, { recursive: true }); this.hashFile = join(stateDir, 'index-hashes.json')
    if (existsSync(this.hashFile)) this.hashes = JSON.parse(readFileSync(this.hashFile, 'utf8'))
    this.status = new PipelineStatus(join(stateDir, 'status', 'pipeline.json'), intervalMs * 3)
    this.pipeline = new VideoPipeline(memory, this.status, file => this.indexFile(file), cli)
  }
  private persistHashes() {
    writeFileSync(this.hashFile + '.tmp', JSON.stringify(this.hashes), { mode: 0o600 }); renameSync(this.hashFile + '.tmp', this.hashFile)
  }
  async indexFiles(): Promise<{ changed: number }> {
    if (this.memory.keys) this.memory.protectExisting()
    const scope = { space: this.memory.currentSpace, grants: this.memory.grants }
    const files = this.memory.allRelFiles().filter(f => !f.startsWith('ingest/') && !f.startsWith('ops/'))
    const previous = this.db.chunks(scope)
    const byFile = new Map<string, SearchChunk[]>()
    for (const chunk of previous) {
      const key = `${chunk.space}:${chunk.file}`, chunks = byFile.get(key) ?? []
      chunks.push(chunk); byFile.set(key, chunks)
    }
    const next: SearchChunk[] = [], live = new Set<string>()
    let changed = 0
    for (const file of files) {
      const text = this.memory.read(file); if (text === null) continue
      const p = policy(text), fileKey = `${p.space}:${file}`, hash = digest(text)
      live.add(fileKey)
      const old = byFile.get(fileKey) ?? []
      if (this.hashes[fileKey] === hash && old.length) { next.push(...old); continue }
      changed++
      for (let offset = 0; offset < text.length; offset += 750) {
        const part = text.slice(offset, offset + 900)
        next.push({ key: digest(`${fileKey}:${offset}:${hash}`), file, offset, text: part, ...p })
      }
    }
    const removed = previous.some(c => !live.has(`${c.space}:${c.file}`))
    if (changed || removed) {
      this.db.replace(next, scope); this.db.save()
      // Only acknowledge hashes after the SQLite save succeeds.
      for (const file of files) { const text = this.memory.read(file); if (text !== null) this.hashes[`${policy(text).space}:${file}`] = digest(text) }
      for (const key of Object.keys(this.hashes)) {
        const space = key.slice(0, key.indexOf(':'))
        if (allowedSpace(space, scope.space, scope.grants) && !live.has(key)) delete this.hashes[key]
      }
      this.persistHashes()
    }
    return { changed }
  }
  async indexFile(file: string): Promise<IndexReceipt> {
    await this.indexFiles()
    const text = this.memory.read(file)
    if (text === null || !this.db.chunks({ space: this.memory.currentSpace, grants: this.memory.grants }).some(c => c.file === file && c.space === policy(text).space)) throw new Error('INDEX_FAILED')
    return { file, hash: digest(text) }
  }
  enqueue(job: VideoJob) {
    if (job.space !== this.memory.currentSpace) throw new Error('Space access denied')
    this.status.register(job.platform, 'yt-dlp+faster-whisper', `interval:${this.intervalMs}`)
    const file = `ops/ingestion-queue-${job.platform}.md`
    const old = this.memory.read(file)
    const body = old?.replace(/^---\n[\s\S]*?\n---\n/, '')
    const jobs: VideoJob[] = body ? JSON.parse(body) : []
    if (!jobs.some(j => j.url === job.url && j.space === job.space)) jobs.push(job)
    // URLs and queue payloads are encrypted even for otherwise public videos.
    this.memory.write(file, `---\nclass: sensitive\nspace: ${job.space}\n---\n${JSON.stringify(jobs)}`)
    this.status.queued(job.platform, jobs.length)
  }
  refresh(): Promise<{ changed: number }> {
    if (this.refreshing) return this.refreshing
    this.refreshing = this.memory.withScope(() => this.performRefresh()).finally(() => { this.refreshing = undefined })
    return this.refreshing
  }
  private async performRefresh() {
    const indexed = await this.indexFiles()
    for (const file of this.memory.list('ops').filter(f => /^ingestion-queue-[a-z0-9_-]+\.md$/.test(f))) {
      const rel = `ops/${file}`, text = this.memory.read(rel)!
      const jobs: VideoJob[] = JSON.parse(text.replace(/^---\n[\s\S]*?\n---\n/, ''))
      const remaining: VideoJob[] = []
      for (const job of jobs) {
        if (job.space !== this.memory.currentSpace) { remaining.push(job); continue }
        try { await this.pipeline.ingest(job) } catch { remaining.push(job) }
      }
      const platform = file.slice('ingestion-queue-'.length, -3)
      this.status.backlog(platform, remaining.length)
      this.memory.write(rel, `---\nclass: sensitive\nspace: ${policy(text).space}\n---\n${JSON.stringify(remaining)}`)
    }
    this.status.save(); return indexed
  }
  start() { if (!this.timer) { this.timer = setInterval(() => { void this.refresh().catch(() => {}) }, this.intervalMs); this.timer.unref() } }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined }
}
