import { policy, restricted, maxClass, type Classification } from '../security/classification'
import type { SpaceKeys } from '../security/keys'
import Database from 'better-sqlite3-multiple-ciphers'
import { existsSync, readFileSync, mkdirSync, chmodSync, openSync, readSync, closeSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'

export interface SearchChunk { key: string; file: string; offset: number; text: string; vec?: number[]; stale?: boolean; encrypted?: boolean; space?: string; class?: Classification }
export interface SearchHit { c: SearchChunk; s: number }
type Scope = { space: string; grants?: string[] }
type Row = { rowid: number; hash: string; file: string; offset: number; text: string; vector: Buffer | null; stale: number; space: string; class: Classification; encrypted: number; digest: string }
const terms = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
const spacesFor = (scope: Scope) => [...new Set([scope.space, ...(scope.grants ?? [])])]
const placeholders = (values: unknown[]) => values.map(() => '?').join(',')
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2 }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}
// Eight deterministic random-hyperplane bands. Only bounded bucket candidates
// and lexical candidates undergo full-vector decoding and cosine reranking.
function bands(vec: number[]): string[] {
  return Array.from({ length: 8 }, (_, band) => {
    let code = 0
    for (let bit = 0; bit < 6; bit++) {
      let dot = 0
      for (let i = 0; i < vec.length; i++) {
        let h = Math.imul(i + 1, 0x45d9f3b) ^ Math.imul(band * 6 + bit + 1, 0x27d4eb2d)
        h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
        dot += (h & 1 ? 1 : -1) * vec[i]
      }
      if (dot >= 0) code |= 1 << bit
    }
    return `${vec.length}:${band}:${code}`
  })
}
export class HybridSearch {
  private encryptedDb = false
  private constructor(private db: Database.Database, private file?: string, private keys?: () => SpaceKeys | undefined, private encryptAll: () => boolean = () => true) {}
  private protect() {
    const keys = this.keys?.()
    if (this.encryptedDb) { if (!keys) throw new Error('Index locked'); keys.databaseKey() }
    if (keys && this.file && !this.encryptedDb) {
      this.db.pragma('wal_checkpoint(TRUNCATE)')
      this.db.pragma('journal_mode=DELETE')
      this.db.pragma("cipher='sqlcipher'")
      this.db.pragma(`rekey='${keys.databaseKey()}'`)
      this.encryptedDb = true
      this.db.pragma('journal_mode=WAL')
    }
    if (this.encryptAll() && !keys) throw new Error('Index locked')
  }
  static async open(file?: string, legacyFile?: string, keys?: () => SpaceKeys | undefined, encryptAll?: () => boolean): Promise<HybridSearch> {
    if (file) mkdirSync(dirname(file), { recursive: true })
    const existed = !!file && existsSync(file)
    let plaintext = false
    if (existed) {
      const fd = openSync(file!, 'r'), header = Buffer.alloc(16)
      try { readSync(fd, header, 0, 16, 0); plaintext = header.toString() === 'SQLite format 3\0' } finally { closeSync(fd) }
    }
    const db = new Database(file ?? ':memory:')
    const search = new HybridSearch(db, file, keys, encryptAll)
    try {
      db.pragma("cipher='sqlcipher'")
      if (existed && !plaintext) {
        const key = keys?.(); if (!key) throw new Error('Index locked')
        db.pragma(`key='${key.databaseKey()}'`); search.encryptedDb = true
      }
      db.pragma('schema_version') // Fail closed on wrong keys/corrupt files.
      db.pragma('secure_delete=ON')
      search.protect()
      db.pragma('journal_mode=WAL'); db.pragma('synchronous=NORMAL'); db.pragma('cache_size=-32768')
      if (file) chmodSync(file, 0o600)
      db.exec('BEGIN')
      const old = db.prepare("SELECT name FROM sqlite_master WHERE name='chunks'").get()
      let migrate: SearchChunk[] | undefined
      if (old && !(db.prepare('PRAGMA table_info(chunks)').all() as { name: string }[]).some(c => c.name === 'digest')) {
        migrate = (db.prepare('SELECT rowid,* FROM chunks').all() as Row[]).map(r => search.decode(r, true))
        db.exec('DROP TABLE IF EXISTS postings; DROP TABLE chunks;')
      }
      db.exec(`CREATE TABLE IF NOT EXISTS chunks (hash TEXT UNIQUE NOT NULL, file TEXT NOT NULL, offset INTEGER, text TEXT, vector BLOB, stale INTEGER, length INTEGER, space TEXT, class TEXT, encrypted INTEGER, digest TEXT);
        CREATE INDEX IF NOT EXISTS chunks_space ON chunks(space);
        CREATE TABLE IF NOT EXISTS chunk_candidates (rowid INTEGER PRIMARY KEY,hash TEXT UNIQUE,file TEXT,space TEXT,encrypted INTEGER,length INTEGER);
        CREATE INDEX IF NOT EXISTS candidates_space ON chunk_candidates(space);
        CREATE TABLE IF NOT EXISTS postings (term TEXT, hash TEXT, tf INTEGER, PRIMARY KEY(term,hash)) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS postings_hash ON postings(hash);
        CREATE TABLE IF NOT EXISTS vector_buckets (bucket TEXT, hash TEXT, PRIMARY KEY(bucket,hash)) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS buckets_hash ON vector_buckets(hash);
        CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(text, content='chunks', content_rowid='rowid', tokenize='unicode61 remove_diacritics 0');
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT);`)
      db.exec('INSERT OR IGNORE INTO chunk_candidates SELECT rowid,hash,file,space,encrypted,length FROM chunks')
      if (migrate) search.replace(migrate)
      if (!existed && legacyFile && existsSync(legacyFile)) {
        const legacy = JSON.parse(readFileSync(legacyFile, 'utf8'))
        search.replace(legacy.chunks ?? []); search.modelId = legacy.modelId
      }
      db.exec('COMMIT')
      return search
    } catch (error) { if (db.inTransaction) db.exec('ROLLBACK'); db.close(); throw error }
  }
  get modelId(): string | undefined { this.protect(); return (this.db.prepare("SELECT value FROM metadata WHERE key='modelId'").get() as { value: string } | undefined)?.value ?? undefined }
  set modelId(value: string | undefined) { this.protect(); this.db.prepare("INSERT OR REPLACE INTO metadata VALUES ('modelId', ?)").run(value ?? null) }
  private decode(row: Row, legacy = false): SearchChunk {
    let text = row.text, vec: number[] | undefined
    if (row.encrypted) {
      const keys = this.keys?.(); if (!keys) throw new Error('Index locked')
      const data = JSON.parse(keys.decrypt(text, row.space, `index:${row.hash}`)); text = data.text
      if (legacy) vec = data.vec
      else if (row.vector) {
        const blob = Buffer.from(keys.decrypt(row.vector.toString(), row.space, `vector:${row.hash}`), 'base64')
        vec = Array.from(new Float32Array(Uint8Array.from(blob).buffer))
      }
    } else {
      if (!legacy && restricted(policy(text).class)) throw new Error('Restricted plaintext index requires migration')
      if (row.vector) vec = Array.from(new Float32Array(Uint8Array.from(row.vector).buffer))
    }
    return { key: row.hash, file: row.file, offset: row.offset, text, vec, stale: !!row.stale, space: row.space ?? 'personal', class: row.class ?? 'internal', encrypted: !!row.encrypted }
  }
  chunks(scope?: Scope): SearchChunk[] {
    this.protect()
    const spaces = scope ? spacesFor(scope) : []
    return (this.db.prepare('SELECT rowid,* FROM chunks' + (scope ? ` WHERE space IN (${placeholders(spaces)})` : '')).all(...spaces) as Row[]).map(row => this.decode(row))
  }
  replace(chunks: SearchChunk[], scope?: Scope) {
    this.protect()
    const spaces = scope ? spacesFor(scope) : []
    const insert = this.db.prepare('INSERT INTO chunks (hash,file,offset,text,vector,stale,length,space,class,encrypted,digest) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    const posting = this.db.prepare('INSERT INTO postings VALUES (?,?,?)'), bucket = this.db.prepare('INSERT INTO vector_buckets VALUES (?,?)')
    const existing = this.db.prepare('SELECT rowid,hash,file,text,space,encrypted,digest FROM chunks WHERE hash=?')
    const insertCandidate = this.db.prepare('INSERT INTO chunk_candidates VALUES (?,?,?,?,?,?)')
    const ftsInsert = this.db.prepare('INSERT INTO chunk_fts(rowid,text) VALUES (?,?)')
    const remove = (r: Row) => {
      if (!r.encrypted) this.db.prepare("INSERT INTO chunk_fts(chunk_fts,rowid,text) VALUES ('delete',?,?)").run(r.rowid, r.text)
      this.db.prepare('DELETE FROM postings WHERE hash=?').run(r.hash)
      this.db.prepare('DELETE FROM vector_buckets WHERE hash=?').run(r.hash)
      this.db.prepare('DELETE FROM chunks WHERE hash=?').run(r.hash)
      this.db.prepare('DELETE FROM chunk_candidates WHERE hash=?').run(r.hash)
    }
    this.db.transaction(() => {
      const live = new Set<string>()
      for (const c of chunks) {
        if (live.has(c.key)) throw new Error('Duplicate chunk key'); live.add(c.key)
        const p = policy(c.text), space = c.space ?? p.space, classification = maxClass(c.class ?? 'public', p.class)
        if (scope && !spaces.includes(space)) throw new Error('Space access denied')
        const encrypted = restricted(classification) || this.encryptAll() || !!c.encrypted
        const keys = this.keys?.(); if (encrypted && !keys) throw new Error('Index locked')
        const fingerprint = JSON.stringify([c, space, classification, encrypted])
        if (encrypted) keys!.createSpace(space)
        const digest = encrypted ? keys!.token(`chunk:${fingerprint}`, space) : createHash('sha256').update(fingerprint).digest('hex')
        const old = existing.get(c.key) as Row | undefined
        if (old && scope && !spaces.includes(old.space)) throw new Error('Space access denied')
        if (old?.digest === digest) continue
        if (old) remove(old)
        const tokens = terms(c.text), vector = c.vec ? Buffer.from(new Float32Array(c.vec).buffer) : null
        const result = insert.run(c.key, c.file, c.offset, encrypted ? keys!.encrypt(JSON.stringify({ text: c.text }), space, `index:${c.key}`) : c.text,
          encrypted && vector ? Buffer.from(keys!.encrypt(vector.toString('base64'), space, `vector:${c.key}`)) : vector, c.stale ? 1 : 0, tokens.length, space, classification, +encrypted, digest)
        insertCandidate.run(result.lastInsertRowid, c.key, c.file, space, +encrypted, tokens.length)
        if (encrypted) {
          const counts = new Map<string, number>()
          for (const t of tokens) { const token = keys!.token(t, space); counts.set(token, (counts.get(token) ?? 0) + 1) }
          for (const [t, tf] of counts) posting.run(t, c.key, tf)
        } else ftsInsert.run(result.lastInsertRowid, c.text)
        if (c.vec) for (const b of bands(c.vec)) bucket.run(encrypted ? keys!.token(`vector:${b}`, space) : b, c.key)
      }
      const previous = this.db.prepare('SELECT rowid,hash,text,encrypted FROM chunks' + (scope ? ` WHERE space IN (${placeholders(spaces)})` : '')).all(...spaces) as Row[]
      for (const r of previous) if (!live.has(r.hash)) remove(r)
    })()
  }
  search(query: string, vector?: number[], limit = 6, scope: Scope = { space: 'personal' }): SearchHit[] {
    this.protect()
    if (!Number.isInteger(limit) || limit < 1) return []
    const spaces = spacesFor(scope), filter = `c.space IN (${placeholders(spaces)})`, cap = Math.max(256, Math.min(limit * 32, 2048))
    const lexical = new Map<string, number>(), candidates = new Map<string, Row>()
    const q = [...new Set(terms(query))].slice(0, 64)
    if (q.length) {
      const rows = this.db.prepare(`WITH matches AS MATERIALIZED (SELECT c.rowid,c.hash,c.file,bm25(chunk_fts) AS score FROM chunk_fts JOIN chunk_candidates c ON c.rowid=chunk_fts.rowid WHERE chunk_fts MATCH ? AND c.encrypted=0 AND ${filter}), best AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY file ORDER BY score,hash) AS position,ROW_NUMBER() OVER (ORDER BY score,hash) AS overall FROM matches) SELECT c.rowid,c.*,selected.score FROM (SELECT rowid,score FROM best WHERE position=1 OR overall<=? ORDER BY score LIMIT ?) AS selected JOIN chunks c ON c.rowid=selected.rowid ORDER BY selected.score`).all(q.map(t => `"${t}"`).join(' OR '), ...spaces, cap, cap * 2) as (Row & { score: number })[]
      for (const r of rows) { lexical.set(r.hash, -r.score); candidates.set(r.hash, r) }
      const keys = this.keys?.()
      if (keys) {
        const tokens = spaces.filter(s => keys.config.spaces[s]).flatMap(s => q.map(t => keys.token(t, s)))
        if (tokens.length) {
          const rows = this.db.prepare(`WITH matches AS (SELECT c.rowid,c.hash,c.file,SUM(p.tf * 2.2 / (p.tf + 1.2 * (0.25 + 0.75*c.length/100.0))) AS score FROM postings p JOIN chunk_candidates c ON c.hash=p.hash WHERE p.term IN (${placeholders(tokens)}) AND ${filter} GROUP BY c.rowid), best AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY file ORDER BY score DESC,hash) AS position,ROW_NUMBER() OVER (ORDER BY score DESC,hash) AS overall FROM matches) SELECT c.rowid,c.*,selected.score FROM (SELECT rowid,score FROM best WHERE position=1 OR overall<=? ORDER BY score DESC LIMIT ?) AS selected JOIN chunks c ON c.rowid=selected.rowid ORDER BY selected.score DESC`).all(...tokens, ...spaces, cap, cap * 2) as (Row & { score: number })[]
          for (const r of rows) { lexical.set(r.hash, r.score); candidates.set(r.hash, r) }
        }
      }
    }
    if (vector?.length) {
      const keys = this.keys?.(), signatures = bands(vector)
      const buckets = [...signatures, ...spaces.filter(s => keys?.config.spaces[s]).flatMap(s => signatures.map(b => keys!.token(`vector:${b}`, s)))]
      const rows = this.db.prepare(`WITH matches AS (SELECT c.rowid,c.hash,c.file,COUNT(*) AS matches FROM vector_buckets b JOIN chunk_candidates c ON c.hash=b.hash WHERE b.bucket IN (${placeholders(buckets)}) AND ${filter} GROUP BY c.rowid), best AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY file ORDER BY matches DESC,hash) AS position,ROW_NUMBER() OVER (ORDER BY matches DESC,hash) AS overall FROM matches) SELECT c.rowid,c.* FROM (SELECT rowid,matches,hash FROM best WHERE position=1 OR overall<=? ORDER BY matches DESC,hash LIMIT ?) AS selected JOIN chunks c ON c.rowid=selected.rowid ORDER BY selected.matches DESC,selected.hash`).all(...buckets, ...spaces, cap, cap * 2) as Row[]
      for (const r of rows) candidates.set(r.hash, r)
    }
    const ranks = new Map<string, number>()
    const fuse = (ids: string[]) => ids.forEach((id, rank) => ranks.set(id, (ranks.get(id) ?? 0) + 1 / (61 + rank)))
    fuse([...lexical].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id))
    const decoded = [...candidates.values()].map(r => this.decode(r))
    if (vector?.length) fuse(decoded.filter(c => c.vec?.length === vector.length).map(c => ({ key: c.key, s: cosine(vector, c.vec!) })).filter(c => c.s > 0).sort((a,b) => b.s - a.s || a.key.localeCompare(b.key)).map(c => c.key))
    const seen = new Set<string>()
    return decoded.filter(c => ranks.has(c.key)).map(c => ({ c, s: ranks.get(c.key)! * (c.stale ? 0.55 : 1) }))
      .sort((a,b) => b.s-a.s || a.c.key.localeCompare(b.c.key))
      .filter(hit => { if (seen.has(hit.c.file)) return false; seen.add(hit.c.file); return true }).slice(0, limit)
  }
  // SQLite commits each transaction; checkpointing never exports/rewrites the DB.
  save() { this.protect(); this.db.pragma('wal_checkpoint(PASSIVE)') }
  close() { this.db.close() }
}
