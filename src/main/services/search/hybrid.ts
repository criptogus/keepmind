import initSqlJs, { type Database } from 'sql.js'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'

export interface SearchChunk { key: string; file: string; offset: number; text: string; vec?: number[]; stale?: boolean }
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
  private constructor(private db: Database, private file?: string) {
    db.run(`CREATE TABLE IF NOT EXISTS chunks (hash TEXT PRIMARY KEY, file TEXT, offset INTEGER, text TEXT, vector BLOB, stale INTEGER, length INTEGER);
      CREATE TABLE IF NOT EXISTS postings (term TEXT, hash TEXT, tf INTEGER, PRIMARY KEY(term, hash));
      CREATE INDEX IF NOT EXISTS postings_hash ON postings(hash);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT);`)
  }
  static async open(file?: string, legacyFile?: string): Promise<HybridSearch> {
    const SQL = await initSqlJs()
    const existed = !!file && existsSync(file)
    const search = new HybridSearch(new SQL.Database(existed ? readFileSync(file!) : undefined), file)
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
  chunks(): SearchChunk[] {
    return (this.db.exec('SELECT hash,file,offset,text,vector,stale FROM chunks')[0]?.values ?? []).map(row => {
      const blob = row[4] as Uint8Array | null
      // Copy: sql.js views need not have Float32 alignment.
      const vec = blob ? Array.from(new Float32Array(new Uint8Array(blob).buffer)) : undefined
      return { key: row[0] as string, file: row[1] as string, offset: row[2] as number, text: row[3] as string, vec, stale: !!row[5] }
    })
  }
  replace(chunks: SearchChunk[]) {
    this.db.run('BEGIN')
    try {
      this.db.run('DELETE FROM postings; DELETE FROM chunks;')
      for (const c of chunks) {
        const tokens = terms(c.text)
        this.db.run('INSERT INTO chunks VALUES (?,?,?,?,?,?,?)', [c.key, c.file, c.offset, c.text,
          c.vec ? new Uint8Array(new Float32Array(c.vec).buffer) : null, c.stale ? 1 : 0, tokens.length])
        const counts = new Map<string, number>()
        for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1)
        for (const [term, tf] of counts) this.db.run('INSERT INTO postings VALUES (?,?,?)', [term, c.key, tf])
      }
      this.db.run('COMMIT')
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }
  search(query: string, vector?: number[], limit = 6): SearchHit[] {
    const chunks = this.chunks()
    if (!chunks.length) return []
    const [n, avg] = this.db.exec('SELECT COUNT(*), AVG(length) FROM chunks')[0].values[0] as number[]
    const lexical = new Map<string, number>()
    for (const term of new Set(terms(query))) {
      const rows = this.db.exec('SELECT p.hash,p.tf,c.length FROM postings p JOIN chunks c ON c.hash=p.hash WHERE term=?', [term])[0]?.values ?? []
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
    const temp = this.file + '.tmp'
    writeFileSync(temp, this.db.export(), { mode: 0o600 })
    renameSync(temp, this.file)
  }
  close() { this.db.close() }
}
