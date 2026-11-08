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
  const db = await HybridSearch.open(undefined, undefined, undefined, () => false); databases.push(db)
  db.replace([chunk('a', 'project budget budget orçamento'), chunk('b', 'project lunch'), chunk('c', 'project timeline')])
  expect(db.search('budget')[0].c.key).toBe('a')
  expect(db.search('orçamento')[0].c.key).toBe('a')
  expect(db.search('nonexistent')).toEqual([])
  expect(db.search("'; DROP TABLE chunks; --")).toEqual([])
  expect(db.chunks()).toHaveLength(3)
})
it('fuses BM25 and cosine ranks, and ignores mismatched vectors', async () => {
  const db = await HybridSearch.open(undefined, undefined, undefined, () => false); databases.push(db)
  db.replace([chunk('both', 'budget', [1, 0]), chunk('lexical', 'budget budget budget', [0, 1]), chunk('semantic', 'finance', [0.99, 0.01]), chunk('wrong-model', 'unrelated', [1, 0, 0])])
  expect(db.search('budget', [1, 0])[0].c.key).toBe('both')
  expect(db.search('budget', [1, 0]).map(x => x.c.key)).not.toContain('wrong-model')
})
it('persists SQLite vector BLOBs, removes obsolete postings, and migrates JSON once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-search-')); dirs.push(dir)
  const file = join(dir, 'search.sqlite'), legacy = join(dir, 'memory-embeddings.json')
  writeFileSync(legacy, JSON.stringify({ modelId: 'old-model', chunks: [chunk('old', 'legacy memory', [0.25, 0.75])] }))
  const first = await HybridSearch.open(file, legacy, undefined, () => false)
  expect(first.modelId).toBe('old-model')
  expect(first.chunks()[0].vec).toEqual([0.25, 0.75])
  expect(readFileSync(file).subarray(0, 15).toString()).toBe('SQLite format 3')
  first.replace([chunk('new', 'replacement', [1, 0])]); first.save(); first.close()
  const reopened = await HybridSearch.open(file, legacy, undefined, () => false); databases.push(reopened)
  expect(reopened.search('legacy')).toEqual([])
  expect(reopened.search('replacement')[0].c.key).toBe('new')
  expect(reopened.chunks()[0].vec).toEqual([1, 0])
})
it('rolls back failed updates', async () => {
  const db = await HybridSearch.open(undefined, undefined, undefined, () => false); databases.push(db)
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
  expect(db.search('uniquesensitiveterm', undefined, 6, { space: 'personal', grants: ['company-x'] })[0].c.vec).toEqual(Array.from(new Float32Array([0.3, 0.7])))
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
it('encrypts the whole disk database and WAL, reopens with its master and rejects missing/wrong keys', async () => {
  const { SpaceKeys, InMemorySecretStore } = await import('../src/main/services/security/keys')
  const { keys } = await SpaceKeys.setup('synthetic', new InMemorySecretStore())
  const dir = mkdtempSync(join(tmpdir(), 'km-cipher-')); dirs.push(dir)
  const file = join(dir, 'index.sqlite')
  let db = await HybridSearch.open(file, undefined, () => keys)
  db.replace([chunk('plain', 'syntheticordinaryword', [1, 0])]); db.save()
  expect(readFileSync(file).includes(Buffer.from('syntheticordinaryword'))).toBe(false)
  expect(readFileSync(file).subarray(0, 15).toString()).not.toBe('SQLite format 3')
  db.close()
  await expect(HybridSearch.open(file)).rejects.toThrow('locked')
  const wrong = await SpaceKeys.setup('different', new InMemorySecretStore())
  await expect(HybridSearch.open(file, undefined, () => wrong.keys)).rejects.toThrow()
  db = await HybridSearch.open(file, undefined, () => keys); databases.push(db)
  expect(db.search('syntheticordinaryword')[0].c.key).toBe('plain')
})
it('migrates the old sql.js schema in place and encrypts it when keys are configured', async () => {
  const { default: Native } = await import('better-sqlite3-multiple-ciphers')
  const { SpaceKeys, InMemorySecretStore } = await import('../src/main/services/security/keys')
  const { keys } = await SpaceKeys.setup('synthetic', new InMemorySecretStore())
  const dir = mkdtempSync(join(tmpdir(), 'km-old-')); dirs.push(dir)
  const file = join(dir, 'index.sqlite'), old = new Native(file)
  old.exec(`CREATE TABLE chunks (hash TEXT PRIMARY KEY,file TEXT,offset INTEGER,text TEXT,vector BLOB,stale INTEGER,length INTEGER,space TEXT,class TEXT,encrypted INTEGER);
    CREATE TABLE postings (term TEXT,hash TEXT,tf INTEGER); CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT); INSERT INTO metadata VALUES ('modelId','legacy');`)
  old.prepare('INSERT INTO chunks VALUES (?,?,?,?,?,?,?,?,?,?)').run('old','notes/old.md',0,'syntheticmigratedword',Buffer.from(new Float32Array([1,0]).buffer),0,1,'personal','internal',0)
  old.close()
  const db = await HybridSearch.open(file, undefined, () => keys); databases.push(db)
  expect(db.modelId).toBe('legacy')
  expect(db.search('syntheticmigratedword')[0].c.vec).toEqual([1,0])
  db.save()
  expect(readFileSync(file).includes(Buffer.from('syntheticmigratedword'))).toBe(false)
})
it('returns the best chunk per file and fills k with distinct files even for a large note', async () => {
  const db = await HybridSearch.open(undefined, undefined, undefined, () => false); databases.push(db)
  db.replace([
    ...Array.from({ length: 300 }, (_, i) => ({ ...chunk(`large-${i}`, 'budget budget'), file: 'notes/large.md' })),
    chunk('other', 'budget project'), chunk('third', 'budget planning')
  ])
  const hits = db.search('budget', undefined, 3)
  expect(hits).toHaveLength(3)
  expect(new Set(hits.map(h => h.c.file)).size).toBe(3)
  expect(hits.find(h => h.c.file === 'notes/large.md')?.c.key).toBe('large-0')
})
it('denies a live disk connection after locking and upgrades an open plaintext database on setup', async () => {
  const { SpaceKeys, InMemorySecretStore } = await import('../src/main/services/security/keys')
  let keys: InstanceType<typeof SpaceKeys> | undefined
  const dir = mkdtempSync(join(tmpdir(), 'km-lock-index-')); dirs.push(dir)
  const file = join(dir, 'index.sqlite'), db = await HybridSearch.open(file, undefined, () => keys, () => false); databases.push(db)
  db.replace([chunk('p', 'syntheticupgrade')]); db.save()
  expect(readFileSync(file).includes(Buffer.from('syntheticupgrade'))).toBe(true)
  const setup = await SpaceKeys.setup('synthetic', new InMemorySecretStore()); keys = setup.keys
  db.save()
  expect(readFileSync(file).includes(Buffer.from('syntheticupgrade'))).toBe(false)
  keys.lock(); keys = undefined
  expect(() => db.search('syntheticupgrade')).toThrow('locked')
  expect(() => db.replace([])).toThrow('locked')
})
it('deduplicates sensitive lexical and semantic hits and preserves the best ranked chunk', async () => {
  const { SpaceKeys, InMemorySecretStore } = await import('../src/main/services/security/keys')
  const { keys } = await SpaceKeys.setup('synthetic', new InMemorySecretStore())
  const db = await HybridSearch.open(undefined, undefined, () => keys); databases.push(db)
  db.replace([
    { ...chunk('weak', 'budget general', [0, 1]), file: 'notes/shared.md', class: 'sensitive' },
    { ...chunk('best', 'budget budget', [1, 0]), file: 'notes/shared.md', class: 'sensitive' },
    { ...chunk('other', 'budget project', [0.8, 0.2]), class: 'sensitive' },
    { ...chunk('third', 'finance', [0.9, 0.1]), class: 'sensitive' }
  ])
  const hits = db.search('budget', [1, 0], 3)
  expect(hits).toHaveLength(3)
  expect(new Set(hits.map(h => h.c.file)).size).toBe(3)
  expect(hits.find(h => h.c.file === 'notes/shared.md')?.c.key).toBe('best')
})
it('leaves unchanged ciphertext untouched and commits changed chunks without replacing the database file', async () => {
  const { default: Native } = await import('better-sqlite3-multiple-ciphers')
  const { SpaceKeys, InMemorySecretStore } = await import('../src/main/services/security/keys')
  const { keys } = await SpaceKeys.setup('synthetic', new InMemorySecretStore())
  const dir = mkdtempSync(join(tmpdir(), 'km-incremental-')); dirs.push(dir)
  const file = join(dir, 'index.sqlite'), db = await HybridSearch.open(file, undefined, () => keys); databases.push(db)
  const chunks = [{ ...chunk('stable', 'stableword', [1, 0]), class: 'sensitive' as const }, chunk('changing', 'oldword')]
  db.replace(chunks)
  const observer = new Native(file)
  try {
    observer.pragma("cipher='sqlcipher'"); observer.pragma(`key='${keys.databaseKey()}'`)
    const before = observer.prepare("SELECT text FROM chunks WHERE hash='stable'").get()
    const version = observer.pragma('data_version', { simple: true })
    db.replace(chunks); db.save()
    expect(observer.pragma('data_version', { simple: true })).toBe(version)
    db.replace([chunks[0], chunk('changing', 'newword')]); db.save()
    expect(observer.prepare("SELECT text FROM chunks WHERE hash='stable'").get()).toEqual(before)
    expect(db.search('oldword')).toEqual([])
    expect(db.search('newword')[0].c.key).toBe('changing')
    expect(observer.prepare("SELECT COUNT(*) AS n FROM chunk_fts WHERE chunk_fts MATCH 'stableword'").get()).toEqual({ n: 0 })
    expect(observer.prepare("SELECT COUNT(*) AS n FROM postings WHERE term='stableword'").get()).toEqual({ n: 0 })
  } finally { observer.close() }
})
