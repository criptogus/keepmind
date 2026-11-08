import { policy, restricted, maxClass, type Classification } from '../security/classification'
import type { SpaceKeys } from '../security/keys'
import initSqlJs, { type Database } from 'sql.js'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'

export interface SearchChunk { key: string; file: string; offset: number; text: string; vec?: number[]; stale?: boolean; encrypted?: boolean; space?: string; class?: Classification }
export interface SearchHit { c: SearchChunk; s: number }
const terms = (text: string): string[] => text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2 }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

// sql.js ships FTS3, but no FTS5. BM25 is computed from SQLite postings,
// document lengths and document frequencies; vector ranks are fused with RRF.
export class HybridSearch {
  private constructor(private db: Database, private file?: string, private keys?: () => SpaceKeys | undefined, private encryptAll: () => boolean = () => false) {
    db.run(`PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS chunks (hash TEXT PRIMARY KEY, file TEXT, offset INTEGER, text TEXT, vector BLOB, stale INTEGER, length INTEGER);
      CREATE TABLE IF NOT EXISTS postings (term TEXT, hash TEXT, tf INTEGER, PRIMARY KEY(term, hash));
      CREATE INDEX IF NOT EXISTS postings_hash ON postings(hash);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT);`)
    const columns = db.exec('PRAGMA table_info(chunks)')[0].values.map(r => r[1])
    if (!columns.includes('space')) db.run("ALTER TABLE chunks ADD COLUMN space TEXT DEFAULT 'personal'; ALTER TABLE chunks ADD COLUMN class TEXT DEFAULT 'internal'; ALTER TABLE chunks ADD COLUMN encrypted INTEGER DEFAULT 0;")
  }
  static async open(file?: string, legacyFile?: string, keys?: () => SpaceKeys | undefined, encryptAll?: () => boolean): Promise<HybridSearch> {
    const SQL = await initSqlJs()
    const existed = !!file && existsSync(file)
    const search = new HybridSearch(new SQL.Database(existed ? readFileSync(file!) : undefined), file, keys, encryptAll)
    if (!existed && legacyFile && existsSync(legacyFile)) {
      const legacy = JSON.parse(readFileSync(legacyFile, 'utf8'))
      search.replace(legacy.chunks ?? [])
      search.modelId = legacy.modelId
      search.save()
    }
    return search
  }
  get modelId(): string | undefined { return this.db.exec("SELECT value FROM metadata WHERE key='modelId'")[0]?.values[0]?.[0] as string | undefined }
  set modelId(value: string | undefined) { this.db.run("INSERT OR REPLACE INTO metadata VALUES ('modelId', ?)", [value ?? null]) }
  chunks(scope?: { space: string; grants?: string[] }): SearchChunk[] {
    const spaces = scope ? [...new Set([scope.space, ...(scope.grants ?? [])])] : []
    const rows = this.db.exec('SELECT hash,file,offset,text,vector,stale,space,class,encrypted FROM chunks' + (scope ? ` WHERE space IN (${spaces.map(() => '?').join(',')})` : ''), spaces)[0]?.values ?? []
    return rows.map(row => {
      const space = row[6] as string, classification = row[7] as Classification
      if (row[8]) {
        const keys = this.keys?.(); if (!keys) throw new Error('Index locked')
        const data = JSON.parse(keys.decrypt(row[3] as string, space, `index:${row[0]}`))
        return { key: row[0] as string, file: row[1] as string, offset: row[2] as number, text: data.text as string, vec: data.vec as number[] | undefined, stale: !!row[5], space, class: classification, encrypted: !!row[8] }
      }
      if (restricted(policy(row[3] as string).class)) throw new Error('Restricted plaintext index requires migration')
      const blob = row[4] as Uint8Array | null
      // Copy: sql.js views need not have Float32 alignment.
      const vec = blob ? Array.from(new Float32Array(new Uint8Array(blob).buffer)) : undefined
      return { key: row[0] as string, file: row[1] as string, offset: row[2] as number, text: row[3] as string, vec, stale: !!row[5], space, class: classification, encrypted: !!row[8] }
    })
  }
  replace(chunks: SearchChunk[], scope?: { space: string; grants?: string[] }) {
    this.db.run('BEGIN')
    try {
      if (scope) {
        for (const space of new Set([scope.space, ...(scope.grants ?? [])])) {
          this.db.run('DELETE FROM postings WHERE hash IN (SELECT hash FROM chunks WHERE space=?)', [space])
          this.db.run('DELETE FROM chunks WHERE space=?', [space])
        }
      } else this.db.run('DELETE FROM postings; DELETE FROM chunks;')
      for (const c of chunks) {
        const p = policy(c.text), space = c.space ?? p.space, classification = maxClass(c.class ?? 'public', p.class)
        const encrypted = restricted(classification) || this.encryptAll() || !!c.encrypted
        const keys = this.keys?.()
        if (encrypted && !keys) throw new Error('Index locked')
        if (encrypted) keys!.createSpace(space)
        const tokens = terms(c.text).map(t => encrypted ? keys!.token(t, space) : t)
        this.db.run('INSERT INTO chunks VALUES (?,?,?,?,?,?,?,?,?,?)', [c.key, c.file, c.offset, encrypted ? keys!.encrypt(JSON.stringify({ text: c.text, vec: c.vec }), space, `index:${c.key}`) : c.text,
          !encrypted && c.vec ? new Uint8Array(new Float32Array(c.vec).buffer) : null, c.stale ? 1 : 0, tokens.length, space, classification, encrypted ? 1 : 0])
        const counts = new Map<string, number>()
        for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1)
        for (const [term, tf] of counts) this.db.run('INSERT INTO postings VALUES (?,?,?)', [term, c.key, tf])
      }
      this.db.run('COMMIT')
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }
  search(query: string, vector?: number[], limit = 6, scope: { space: string; grants?: string[] } = { space: 'personal' }): SearchHit[] {
    const chunks = this.chunks(scope)
    if (!chunks.length) return []
    const n = chunks.length, avg = chunks.reduce((sum, c) => sum + terms(c.text).length, 0) / n
    const lexical = new Map<string, number>()
    const accessible = new Set(chunks.map(c => c.key))
    const queryTerms = new Set(terms(query))
    for (const space of new Set(chunks.filter(c => restricted(c.class ?? 'internal') || this.encryptAll() || c.encrypted).map(c => c.space!))) {
      const keys = this.keys?.(); if (!keys) throw new Error('Index locked')
      for (const t of terms(query)) queryTerms.add(keys.token(t, space))
    }
    for (const term of queryTerms) {
      const rows = this.db.exec('SELECT p.hash,p.tf,c.length FROM postings p JOIN chunks c ON c.hash=p.hash WHERE term=?', [term])[0]?.values.filter(r => accessible.has(r[0] as string)) ?? []
      const idf = Math.log(1 + (n - rows.length + 0.5) / (rows.length + 0.5))
      for (const [hash, frequency, length] of rows) {
        const tf = frequency as number
        const score = idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * (length as number) / (avg || 1)))
        lexical.set(hash as string, (lexical.get(hash as string) ?? 0) + score)
      }
    }
    const ranks = new Map<string, number>()
    const fuse = (keys: string[]) => keys.forEach((key, rank) => ranks.set(key, (ranks.get(key) ?? 0) + 1 / (60 + rank + 1)))
    fuse([...lexical].sort((a,b) => b[1] - a[1]).map(([key]) => key))
    if (vector?.length) fuse(chunks.filter(c => c.vec?.length === vector.length)
      .map(c => ({ key: c.key, similarity: cosine(vector, c.vec!) })).filter(c => c.similarity > 0)
      .sort((a,b) => b.similarity - a.similarity).map(c => c.key))
    return chunks.filter(c => ranks.has(c.key)).map(c => ({ c, s: ranks.get(c.key)! * (c.stale ? 0.55 : 1) }))
      .sort((a,b) => b.s - a.s || a.c.key.localeCompare(b.c.key)).slice(0, limit)
  }
  save() {
    if (!this.file) return
    mkdirSync(dirname(this.file), { recursive: true })
    this.db.run('VACUUM')
    const temp = this.file + '.tmp'
    writeFileSync(temp, this.db.export(), { mode: 0o600 })
    renameSync(temp, this.file)
  }
  close() { this.db.close() }
}
