import { afterEach, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HybridSearch, type SearchChunk } from '../src/main/services/search/hybrid'
const dirs: string[] = []
const databases: HybridSearch[] = []
afterEach(() => { databases.splice(0).forEach(d => d.close()); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })) })
const chunk = (key: string, text: string, vec?: number[]): SearchChunk => ({ key, text, file: `notes/${key}.md`, offset: 0, vec })
it('BM25 favors rare keywords and supports Unicode without vectors', async () => {
  const db = await HybridSearch.open(); databases.push(db)
  db.replace([chunk('a', 'project budget budget orçamento'), chunk('b', 'project lunch'), chunk('c', 'project timeline')])
  expect(db.search('budget')[0].c.key).toBe('a')
  expect(db.search('orçamento')[0].c.key).toBe('a')
  expect(db.search('nonexistent')).toEqual([])
  expect(db.search("'; DROP TABLE chunks; --")).toEqual([])
  expect(db.chunks()).toHaveLength(3)
})
it('fuses BM25 and cosine ranks, and ignores mismatched vectors', async () => {
  const db = await HybridSearch.open(); databases.push(db)
  db.replace([chunk('both', 'budget', [1, 0]), chunk('lexical', 'budget budget budget', [0, 1]), chunk('semantic', 'finance', [0.99, 0.01]), chunk('wrong-model', 'unrelated', [1, 0, 0])])
  expect(db.search('budget', [1, 0])[0].c.key).toBe('both')
  expect(db.search('budget', [1, 0]).map(x => x.c.key)).not.toContain('wrong-model')
})
it('persists SQLite vector BLOBs, removes obsolete postings, and migrates JSON once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-search-')); dirs.push(dir)
  const file = join(dir, 'search.sqlite'), legacy = join(dir, 'memory-embeddings.json')
  writeFileSync(legacy, JSON.stringify({ modelId: 'old-model', chunks: [chunk('old', 'legacy memory', [0.25, 0.75])] }))
  const first = await HybridSearch.open(file, legacy)
  expect(first.modelId).toBe('old-model')
  expect(first.chunks()[0].vec).toEqual([0.25, 0.75])
  expect(readFileSync(file).subarray(0, 15).toString()).toBe('SQLite format 3')
  first.replace([chunk('new', 'replacement', [1, 0])]); first.save(); first.close()
  const reopened = await HybridSearch.open(file, legacy); databases.push(reopened)
  expect(reopened.search('legacy')).toEqual([])
  expect(reopened.search('replacement')[0].c.key).toBe('new')
  expect(reopened.chunks()[0].vec).toEqual([1, 0])
})
it('rolls back failed updates', async () => {
  const db = await HybridSearch.open(); databases.push(db)
  db.replace([chunk('original', 'durable')])
  expect(() => db.replace([chunk('duplicate', 'one'), chunk('duplicate', 'two')])).toThrow()
  expect(db.search('durable')[0].c.key).toBe('original')
})
it('encrypts restricted text/vectors and HMAC postings while enforcing search spaces', async () => {
  const { SpaceKeys, InMemorySecretStore } = await import('../src/main/services/security/keys')
  const { keys } = await SpaceKeys.setup('synthetic test', new InMemorySecretStore())
  const dir = mkdtempSync(join(tmpdir(), 'km-sec-index-')); dirs.push(dir)
  const file = join(dir, 'search.sqlite'), db = await HybridSearch.open(file, undefined, () => keys); databases.push(db)
  db.replace([{ ...chunk('s', 'uniquesensitiveterm', [0.3, 0.7]), class: 'sensitive', space: 'company-x' }, chunk('p', 'ordinary')]); db.save()
  const disk = readFileSync(file)
  expect(disk.includes(Buffer.from('uniquesensitiveterm'))).toBe(false)
  expect(db.search('uniquesensitiveterm')).toEqual([])
  expect(db.search('uniquesensitiveterm', undefined, 6, { space: 'company-x' })[0].c.key).toBe('s')
  expect(db.search('uniquesensitiveterm', undefined, 6, { space: 'personal', grants: ['company-x'] })[0].c.vec).toEqual([0.3, 0.7])
})
it('preserves other spaces on scoped refresh and searches encryptAll data after disabling the option', async () => {
  const { SpaceKeys, InMemorySecretStore } = await import('../src/main/services/security/keys')
  const { keys } = await SpaceKeys.setup('test', new InMemorySecretStore()); let encryptAll = true
  const db = await HybridSearch.open(undefined, undefined, () => keys, () => encryptAll); databases.push(db)
  db.replace([{ ...chunk('p', 'garden soil'), space: 'personal' }, { ...chunk('c', 'companyword'), space: 'company-x' }])
  encryptAll = false
  expect(db.search('garden')[0].c.key).toBe('p')
  db.replace([{ ...chunk('new', 'fresh garden'), space: 'personal' }], { space: 'personal' })
  expect(db.search('companyword', undefined, 6, { space: 'company-x' })[0].c.key).toBe('c')
  expect(db.search('companyword')).toEqual([])
})
