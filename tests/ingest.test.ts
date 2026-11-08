import { it, expect, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Memory } from '../src/main/services/brain/memory-store'
import { SpaceKeys, InMemorySecretStore } from '../src/main/services/security/keys'
import { HybridSearch } from '../src/main/services/search/hybrid'
import { PipelineStatus } from '../src/main/services/ingest/status'
import { RefreshScheduler } from '../src/main/services/ingest/scheduler'
import type { CliRunner } from '../src/main/services/ingest/video'
it('only reports end-to-end success, and marks old receipts stale', () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-status-')); let now = Date.parse('2026-11-08T12:00:00Z')
  try {
    const status = new PipelineStatus(join(dir, 'pipeline.json'), 1000, () => now)
    status.register('youtube'); expect(status.snapshot()[0].state).toBe('unknown')
    status.attempt('youtube', 1); status.finish('youtube', { raw: true, note: true, index: false })
    expect(status.snapshot()[0].state).toBe('error'); expect(status.snapshot()[0].last_index_ok_at).toBeNull()
    status.finish('youtube', { raw: true, note: true, index: true })
    expect(status.snapshot()[0].state).toBe('ok'); expect(status.snapshot()[0].checked_at).toMatch(/\+00:00$/)
    now += 1001; expect(status.snapshot()[0].state).toBe('stale')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
it('ingests mocked social video through encrypted raw/draft, curated themes, and index receipt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-ingest-')); let db: HybridSearch | undefined
  try {
    const memory = new Memory(join(dir, 'memory'), null)
    memory.keys = (await SpaceKeys.setup('test', new InMemorySecretStore())).keys
    memory.write('themes/gardening.md', '# Gardening\nplants garden soil')
    const cli: CliRunner = { available: () => true, run: vi.fn(async (command, _args, cwd) => {
      if (command === 'yt-dlp') { writeFileSync(join(cwd, 'source.webm'), 'synthetic'); return JSON.stringify({ id: 'test-video', title: 'Garden plants', duration: 90 }) }
      writeFileSync(join(cwd, 'source.txt'), 'Plants need soil and water.'); return ''
    }) }
    db = await HybridSearch.open(join(dir, 'index.sqlite'), undefined, () => memory.keys)
    const scheduler = new RefreshScheduler(memory, db, dir, 1000, cli)
    const result = await scheduler.pipeline.ingest({ platform: 'youtube', url: 'https://video.example.invalid/watch?v=test-video', space: 'personal' })
    expect(result.id).toBe('youtube:test-video'); expect(result.receipt).toEqual({ raw: true, note: true, index: true })
    expect(memory.read(result.file)).toContain('themes: ["gardening"]')
    const rawFile = memory.allRelFiles().find(f => f.endsWith('/raw.md'))!
    expect(readFileSync(join(dir, 'memory', rawFile), 'utf8')).not.toContain('Plants')
    expect(scheduler.status.snapshot()[0].state).toBe('ok')
    expect(readFileSync(join(dir, 'status/pipeline.json'), 'utf8')).not.toContain('https:')
    expect(db.search('plants')[0]).toBeDefined()
    const bad = new RefreshScheduler(memory, db, join(dir, 'missing'), 1000, { available: () => false, run: async () => '' })
    await expect(bad.pipeline.ingest({ platform: 'social', url: 'https://video.example.invalid/test', space: 'personal' })).rejects.toThrow('CLI_MISSING')
    expect(bad.status.snapshot()[0].state).toBe('error')
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }) }
})
it('incrementally indexes changed files, removes deleted files, and coalesces refreshes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-refresh-')); let db: HybridSearch | undefined
  try {
    const memory = new Memory(join(dir, 'memory'), null)
    db = await HybridSearch.open(); const scheduler = new RefreshScheduler(memory, db, dir)
    memory.write('notes/a.md', 'alpha'); memory.write('notes/b.md', 'beta')
    expect((await scheduler.refresh()).changed).toBe(2)
    const replace = vi.spyOn(db, 'replace')
    expect((await scheduler.refresh()).changed).toBe(0); expect(replace).not.toHaveBeenCalled()
    memory.write('notes/a.md', 'gamma')
    const first = scheduler.refresh(), second = scheduler.refresh(); expect(first).toBe(second)
    expect((await first).changed).toBe(1); expect(db.search('alpha')).toEqual([])
    memory.remove('notes/b.md'); await scheduler.refresh(); expect(db.search('beta')).toEqual([])
    scheduler.start(); scheduler.stop()
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }) }
})
it('retains failed queued jobs and records only fixed metadata in status', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-queue-')); let db: HybridSearch | undefined
  try {
    const memory = new Memory(join(dir, 'memory'), null)
    memory.keys = (await SpaceKeys.setup('test', new InMemorySecretStore())).keys
    db = await HybridSearch.open(undefined, undefined, () => memory.keys)
    const scheduler = new RefreshScheduler(memory, db, dir, 1000, { available: () => false, run: async () => '' })
    scheduler.enqueue({ platform: 'youtube', url: 'https://video.example.invalid/watch?v=synthetic', space: 'personal' })
    expect(scheduler.status.snapshot()[0].last_attempt_at).toBeNull()
    await scheduler.refresh()
    expect(scheduler.status.snapshot()[0].backlog_count).toBe(1)
    expect(scheduler.status.snapshot()[0].error_code).toBe('CLI_MISSING')
    expect(readFileSync(join(dir, 'status/pipeline.json'), 'utf8')).not.toContain('video.example')
    expect(memory.read('ops/ingestion-queue-youtube.md')).toContain('synthetic')
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }) }
})
