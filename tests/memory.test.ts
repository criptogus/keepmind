import { afterEach, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Memory } from '../src/main/services/brain/memory-store'
import { chat } from '../src/main/services/llm'
import { Brain } from '../src/main/services/brain'
import type { Store } from '../src/main/store'
vi.mock('../src/main/services/llm', () => ({ chat: vi.fn(async () => ({ text: 'Weekly decisions and lessons.' })), chatStream: vi.fn() }))
const dirs: string[] = []
afterEach(() => { dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); vi.useRealTimers() })
function directory() { const dir = mkdtempSync(join(tmpdir(), 'km-memory-')); dirs.push(dir); return dir }
it('scaffolds tiers and handles writes, appends, quiet sync and removal', () => {
  const dir = directory(), memory = new Memory(dir, null)
  for (const sub of ['short-term', 'medium-term', 'long-term', 'sleep', 'entities', 'crm/people', 'ops']) expect(existsSync(join(dir, sub))).toBe(true)
  const dirty = vi.fn(); memory.onWrite = dirty
  memory.write('short-term/2020-01-01.md', 'raw')
  memory.append('long-term/facts.md', 'durable')
  memory.quietWrite('medium-term/2020-W01.md', 'weekly')
  expect(dirty.mock.calls.map(x => x[0])).toEqual(['short-term/2020-01-01.md', 'long-term/facts.md'])
  expect(memory.shortTermFiles()).toEqual(['2020-01-01.md'])
  expect(memory.mediumTermFiles()).toEqual(['2020-W01.md'])
  expect(memory.read('long-term/facts.md')).toContain('durable')
  memory.quietRemove('medium-term/2020-W01.md')
  expect(memory.mediumTermFiles()).toEqual([])
  expect(() => memory.write('../outside.md', 'bad')).toThrow()
})
it('consolidates old short-term logs into a weekly digest and preserves recent logs and long-term facts', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T12:00:00Z'))
  const dir = directory()
  const store = { memoryDir: dir, get: () => ({ github: {}, ai: { provider: 'local' } }) } as unknown as Store
  class TestBrain extends Brain { consolidate() { return this.consolidateShortTerm() } }
  const brain = new TestBrain(store, null), memory = brain.getMemory()
  memory.write('short-term/2026-10-01.md', 'Old decisions')
  memory.write('short-term/2026-11-08.md', 'Recent events')
  memory.write('long-term/facts.md', 'Keep durable facts')
  expect(await brain.consolidate()).toBe(1)
  expect(memory.read('short-term/2026-10-01.md')).toBeNull()
  expect(memory.read('short-term/2026-11-08.md')).toContain('Recent events')
  expect(memory.read('medium-term/2026-W40.md')).toContain('Weekly decisions and lessons.')
  expect(memory.read('long-term/facts.md')).toContain('Keep durable facts')
  expect(await brain.consolidate()).toBe(0)
})
it('sleep extracts durable facts, lessons and skills without deleting recent working memory', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T12:00:00Z'))
  const dir = directory()
  const store = { memoryDir: dir, get: () => ({ github: {}, ai: { provider: 'local' } }) } as unknown as Store
  const brain = new Brain(store, null), memory = brain.getMemory()
  memory.write('short-term/2026-11-08.md', 'prefers tea; verify invoices before paying')
  memory.write('long-term/facts.md', '- existing durable fact\n')
  vi.mocked(chat).mockResolvedValueOnce({ text: '### 1. Working\nVerified invoices.' })
    .mockResolvedValueOnce({ text: '===FACTS===\n- prefers tea\n===LESSONS===\n- verify invoices\n===SKILLS===\n- check totals before payment' })
  await brain.sleep()
  expect(memory.read('long-term/facts.md')).toContain('existing durable fact')
  expect(memory.read('long-term/facts.md')).toContain('prefers tea')
  expect(memory.read('long-term/lessons.md')).toContain('verify invoices')
  expect(memory.read('long-term/skills.md')).toContain('check totals before payment')
  expect(memory.read('short-term/2026-11-08.md')).toContain('prefers tea')
  expect(memory.read('sleep/2026-11-08.md')).toContain('Verified invoices')
})
it('filters the nightly corpus by active space and requires explicit grants', () => {
  const dir = directory(), store = { memoryDir: dir, get: () => ({ github: {}, ai: { provider: 'local' } }) } as unknown as Store
  class TestBrain extends Brain { corpus() { return this.recentCorpus() } }
  const brain = new TestBrain(store, null), memory = brain.getMemory()
  memory.currentSpace = 'company-x'; memory.write('short-term/company.md', 'Company-only planning')
  memory.currentSpace = 'personal'; memory.write('short-term/personal.md', 'Personal-only planning')
  expect(brain.corpus()).toContain('Personal-only'); expect(brain.corpus()).not.toContain('Company-only')
  memory.grants = ['company-x']; expect(brain.corpus()).toContain('Company-only')
})
it('keeps same-day sleep reports and durable output paths distinct across spaces', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T12:00:00Z'))
  const dir = directory(), store = { memoryDir: dir, get: () => ({ github: {}, ai: { provider: 'local' } }) } as unknown as Store
  const brain = new Brain(store, null), memory = brain.getMemory()
  vi.mocked(chat).mockImplementation(async (_cfg, messages) => ({ text: messages.some(m => m.content.includes('Company activity')) ? 'Company report' : 'Personal report' }))
  memory.write('short-term/2026-11-08.md', 'Personal activity'); await brain.sleep()
  memory.currentSpace = 'company-x'
  memory.write(memory.scopePath('short-term/2026-11-08.md'), 'Company activity'); await brain.sleep()
  expect(memory.read(memory.scopePath('sleep/2026-11-08.md'))).toContain('Company report')
  expect(memory.read('sleep/2026-11-08.md')).toBeNull()
  memory.currentSpace = 'personal'; expect(memory.read('sleep/2026-11-08.md')).toContain('Personal report')
})
