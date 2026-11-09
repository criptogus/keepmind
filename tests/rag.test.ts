import { afterEach, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { HybridSearch } from '../src/main/services/search/hybrid'
import { RagService } from '../src/main/services/rag'
import { Memory } from '../src/main/services/brain'
import type { LocalLlm } from '../src/main/services/local-llm'
const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })))
it.each([false, true])('recalls keywords when embedReady=%s, even if embedding fails', async embedReady => {
  const dir = mkdtempSync(join(tmpdir(), 'km-rag-')); dirs.push(dir)
  const memory = new Memory(join(dir, 'memory'), null, { allowPlaintext: true })
  memory.write('notes/budget.md', '# Project budget\nThe project budget is forty dollars. We should review expenses next week.')
  const model = { embedReady, embed: vi.fn(async () => { throw new Error('model offline') }), isEmbedModelDownloaded: () => false } as unknown as LocalLlm
  const rag = new RagService(model, memory, dir)
  expect(await rag.search('budget')).toContain('forty dollars')
  expect(rag.stats.chunks).toBe(1)
})
it('discards persisted vectors before attempting to embed with a new model', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-rag-')); dirs.push(dir)
  const memory = new Memory(join(dir, 'memory'), null, { allowPlaintext: true })
  memory.write('notes/budget.md', 'The project budget is forty dollars. Review expenses every week.')
  const embed = vi.fn(async () => [[1, 0]])
  const model = { embedReady: true, embedModelId: 'model-a', embed, isEmbedModelDownloaded: () => true }
  const rag = new RagService(model as unknown as LocalLlm, memory, dir)
  expect((await rag.reindex()).embedded).toBe(1)
  model.embedModelId = 'model-b'; embed.mockRejectedValueOnce(new Error('new model offline'))
  await expect(rag.reindex()).rejects.toThrow('new model offline')
  const db = await HybridSearch.open(join(dir, 'memory-search.sqlite'), undefined, undefined, () => false)
  try {
    expect(db.modelId).toBe('model-b')
    expect(db.chunks().every(c => c.vec === undefined)).toBe(true)
    expect(db.search('budget')[0].c.text).toContain('forty dollars')
  } finally { db.close() }
})
