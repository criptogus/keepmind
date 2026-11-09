import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
export type PipelineState = 'unknown' | 'stale' | 'ok' | 'error'
export type ErrorCode = 'CLI_MISSING' | 'CAPTURE_FAILED' | 'TRANSCRIBE_FAILED' | 'DEPOSIT_FAILED' | 'INDEX_FAILED' | 'LOCKED' | 'ENCRYPTED_SCRATCH_REQUIRED' | null
export interface PipelineRow {
  platform: string; runner: string; schedule: string; timezone: string
  checked_at: string | null; last_attempt_at: string | null; last_capture_ok_at: string | null
  last_deposit_ok_at: string | null; last_index_ok_at: string | null
  backlog_count: number; error_code: ErrorCode; state: PipelineState
}
export interface Receipt { raw: boolean; note: boolean; index: boolean }
export const iso = (now: number) => new Date(now).toISOString().replace(/Z$/, '+00:00')
export class PipelineStatus {
  private rows: PipelineRow[] = []
  constructor(private file: string, private staleMs = 24 * 3600_000, private now: () => number = Date.now) {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      if (!Array.isArray(parsed)) throw new Error('Invalid pipeline status')
      for (const input of parsed) {
        this.register(input.platform, input.runner, input.schedule, input.timezone)
        const row = this.row(input.platform)
        for (const key of ['checked_at', 'last_attempt_at', 'last_capture_ok_at', 'last_deposit_ok_at', 'last_index_ok_at'] as const) {
          const value = input[key]
          if (value !== null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2}:\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)))) throw new Error('Invalid status date')
          row[key] = value
        }
        if (!Number.isSafeInteger(input.backlog_count) || input.backlog_count < 0 || ![null, 'CLI_MISSING', 'CAPTURE_FAILED', 'TRANSCRIBE_FAILED', 'DEPOSIT_FAILED', 'INDEX_FAILED', 'LOCKED', 'ENCRYPTED_SCRATCH_REQUIRED'].includes(input.error_code)) throw new Error('Invalid status receipt')
        row.backlog_count = input.backlog_count; row.error_code = input.error_code
      }
    }
  }
  register(platform: string, runner = 'yt-dlp+faster-whisper', schedule = 'manual', timezone = 'UTC') {
    if (typeof platform !== 'string' || typeof runner !== 'string' || typeof schedule !== 'string') throw new Error('Invalid pipeline configuration')
    if (!/^[a-z0-9_-]{1,50}$/.test(platform) || !/^[a-zA-Z0-9+_. -]{1,80}$/.test(runner) || !/^(manual|interval:[0-9]+)$/.test(schedule)) throw new Error('Invalid pipeline configuration')
    if (typeof timezone !== 'string' || timezone.length > 80) throw new Error('Invalid timezone')
    new Intl.DateTimeFormat('en', { timeZone: timezone })
    const existing = this.rows.find(r => r.platform === platform)
    if (existing) return
    this.rows.push({ platform, runner, schedule, timezone, checked_at: null, last_attempt_at: null, last_capture_ok_at: null, last_deposit_ok_at: null, last_index_ok_at: null, backlog_count: 0, error_code: null, state: 'unknown' })
  }
  private row(platform: string) { const row = this.rows.find(r => r.platform === platform); if (!row) throw new Error('Platform unregistered'); return row }
  attempt(platform: string, backlog: number) {
    const row = this.row(platform); row.last_attempt_at = iso(this.now()); row.backlog_count = Math.max(0, backlog); this.save()
  }
  finish(platform: string, receipt: Receipt, error: ErrorCode = null, backlog = 0) {
    const row = this.row(platform), ts = iso(this.now())
    if (receipt.raw) row.last_capture_ok_at = ts
    if (receipt.raw && receipt.note) row.last_deposit_ok_at = ts
    if (receipt.raw && receipt.note && receipt.index) row.last_index_ok_at = ts
    row.error_code = error ?? (receipt.raw && receipt.note && receipt.index ? null : 'INDEX_FAILED')
    row.state = row.error_code ? 'error' : 'ok'; row.backlog_count = Math.max(0, backlog); this.save()
  }
  queued(platform: string, count: number) { this.row(platform).backlog_count = Math.max(0, count); this.save() }
  backlog(platform: string, count: number) {
    const row = this.row(platform); row.backlog_count = Math.max(0, count)
    if (count > 0) { row.error_code ??= 'CAPTURE_FAILED'; row.state = 'error' }
    this.save()
  }
  snapshot(): PipelineRow[] {
    const now = this.now()
    return this.rows.map(row => ({ ...row, checked_at: iso(now), state: row.error_code ? 'error' : !row.last_index_ok_at ? 'unknown' : now - Date.parse(row.last_index_ok_at) > this.staleMs ? 'stale' : 'ok' }))
  }
  save() {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file + '.tmp', JSON.stringify(this.snapshot(), null, 2) + '\n', { mode: 0o600 }); renameSync(this.file + '.tmp', this.file)
  }
}
