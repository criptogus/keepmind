import { execFile } from 'node:child_process'
import { accessSync, constants, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import type { Memory } from '../brain/memory-store'
import { frontmatter, policy } from '../security/classification'
import { PipelineStatus, type ErrorCode, type Receipt } from './status'
export interface CliRunner { available(command: string): boolean; run(command: string, args: string[], cwd: string): Promise<string> }
export class PathCliRunner implements CliRunner {
  available(command: string) {
    return (process.env.PATH ?? '').split(delimiter).some(dir => {
      try { accessSync(join(dir, command), constants.X_OK); return true } catch { return false }
    })
  }
  run(command: string, args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => execFile(command, args, { cwd, timeout: 30 * 60_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (error, stdout) => error ? reject(new Error('CLI_FAILED')) : resolve(stdout)))
  }
}
export interface VideoJob { platform: string; url: string; space: string }
export interface IndexReceipt { file: string; hash: string }
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
export function chooseThemes(memory: Memory, text: string): string[] {
  const tokens = words(text)
  const themes = memory.list('themes').map(file => {
    const body = memory.read(`themes/${file}`) ?? '', terms = words(body)
    return { name: file.slice(0, -3), score: [...terms].filter(t => tokens.has(t)).length }
  }).sort((a,b) => b.score - a.score || a.name.localeCompare(b.name))
  const matched = themes.filter(t => t.score > 0).slice(0, 3).map(t => t.name)
  if (matched.length) return matched
  const general = `general-${memory.currentSpace}`
  if (!memory.read(`themes/${general}.md`)) memory.write(`themes/${general}.md`, '# General\nCaptures awaiting a more specific theme.\n')
  return [general]
}
export class VideoPipeline {
  constructor(private memory: Memory, private status: PipelineStatus, private index: (file: string) => Promise<IndexReceipt>, private cli: CliRunner = new PathCliRunner()) {}
  ingest(job: VideoJob) { return this.memory.withScope(() => this.performIngest(job)) }
  private async performIngest(job: VideoJob): Promise<{ id: string; file: string; receipt: Receipt }> {
    const receipt: Receipt = { raw: false, note: false, index: false }
    this.status.register(job.platform); this.status.attempt(job.platform, 1)
    let stage: ErrorCode = 'CAPTURE_FAILED', work: string | undefined
    try {
      if (job.space !== this.memory.currentSpace) throw new Error('SPACE_DENIED')
      const url = new URL(job.url)
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || [...url.searchParams.keys()].some(k => !['v', 't'].includes(k))) throw new Error('INVALID_SOURCE')
      if (!this.memory.keys) { stage = 'LOCKED'; throw new Error('LOCKED') }
      if (!this.cli.available('yt-dlp') || !this.cli.available('faster-whisper')) { stage = 'CLI_MISSING'; throw new Error('CLI_MISSING') }
      // These external tools require on-disk media/transcript scratch. Until an
      // encrypted scratch backend exists, default encryption must fail before
      // capture rather than persist transient plaintext and delete it later.
      if (this.memory.encryptAll) { stage = 'ENCRYPTED_SCRATCH_REQUIRED'; throw new Error(stage) }
      work = mkdtempSync(join(tmpdir(), 'keepmind-ingest-'))
      const metadata = JSON.parse(await this.cli.run('yt-dlp', ['--no-playlist', '--no-progress', '--no-simulate', '--dump-json', '-f', 'bestaudio', '-o', 'source.%(ext)s', '--', url.toString()], work))
      if (typeof metadata.id !== 'string' || !/^[\w-]{1,120}$/.test(metadata.id)) throw new Error('INVALID_ID')
      const id = `${job.platform}:${metadata.id}`, filename = hash(`${job.space}:${id}`), base = `ingest/${filename}`
      const media = readdirSync(work).find(f => /^source\.[a-zA-Z0-9]+$/.test(f))
      if (!media) throw new Error('NO_MEDIA')
      stage = 'TRANSCRIBE_FAILED'
      await this.cli.run('faster-whisper', [join(work, media), '--output_dir', work, '--output_format', 'txt'], work)
      const transcript = readFileSync(join(work, 'source.txt'), 'utf8')
      if (!transcript.trim()) throw new Error('EMPTY_TRANSCRIPT')
      const title = String(metadata.title ?? id).replace(/[\r\n]/g, ' ')
      const note = `---\nid: ${JSON.stringify(id)}\nsource: ${JSON.stringify(url.toString())}\ntitle: ${JSON.stringify(title)}\nplatform: ${job.platform}\nvideo_id: ${JSON.stringify(metadata.id)}\nduration: ${Number(metadata.duration) || 0}\n---\n# ${title}\n\n## Transcript\n${transcript}\n`
      const p = policy(note, job.space)
      stage = 'DEPOSIT_FAILED'
      // Raw and intermediate text are always restricted, including public transcripts.
      this.memory.write(`${base}/raw.md`, frontmatter(note, { ...p, class: 'sensitive' }))
      receipt.raw = true
      this.memory.write(`${base}/draft.md`, frontmatter(note, { ...p, class: 'sensitive' }))
      const themes = chooseThemes(this.memory, title + '\n' + transcript)
      const curated = note.replace('---\n', `---\nthemes: ${JSON.stringify(themes)}\nstage: curated\n`)
      const file = `notes/video-${filename}.md`
      this.memory.write(file, frontmatter(curated, p)); receipt.note = true
      stage = 'INDEX_FAILED'
      const indexed = await this.index(file)
      const stored = this.memory.read(file)!
      if (indexed.file !== file || indexed.hash !== hash(stored)) throw new Error('INVALID_RECEIPT')
      receipt.index = true
      this.memory.write(`${base}/indexed.md`, frontmatter(`id: ${id}\nstage: indexed\nreceipt: ${indexed.hash}\n`, { class: 'internal', space: job.space }))
      this.status.finish(job.platform, receipt)
      return { id, file, receipt }
    } catch { this.status.finish(job.platform, receipt, stage, 1); throw new Error(stage ?? 'CAPTURE_FAILED') }
    finally { if (work) rmSync(work, { recursive: true, force: true }) }
  }
}
