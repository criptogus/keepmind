import { afterEach, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RagService } from '../src/main/services/rag'
import { Memory } from '../src/main/services/brain'
import type { LocalLlm } from '../src/main/services/local-llm'
const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })))
it.each([false, true])('recalls keywords when embedReady=%s, even if embedding fails', async embedReady => {
  const dir = mkdtempSync(join(tmpdir(), 'km-rag-')); dirs.push(dir)
  const memory = new Memory(join(dir, 'memory'), null)
  memory.write('notes/budget.md', '# Project budget\nThe project budget is forty dollars. We should review expenses next week.')
  const model = { embedReady, embed: vi.fn(async () => { throw new Error('model offline') }), isEmbedModelDownloaded: () => false } as unknown as LocalLlm
  const rag = new RagService(model, memory, dir)
  expect(await rag.search('budget')).toContain('forty dollars')
  expect(rag.stats.chunks).toBe(1)
})
