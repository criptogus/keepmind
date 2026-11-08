import { expect, it } from 'vitest'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HybridSearch, type SearchChunk } from '../src/main/services/search/hybrid'
import { SpaceKeys, InMemorySecretStore } from '../src/main/services/security/keys'
// Explicit opt-in: a reproducible synthetic storage/latency measurement, not a
// timing assertion imposed on every shared CI runner.
it.skipIf(process.env.KEEPMIND_SEARCH_SCALE !== '1')('measures 11k files / 35k chunks with 768-dimensional vectors', async () => {
  const root = mkdtempSync(join(tmpdir(), 'km-scale-')), file = join(root, 'index.sqlite')
  const { keys } = await SpaceKeys.setup('synthetic-scale-fixture', new InMemorySecretStore())
  const db = await HybridSearch.open(file, undefined, () => keys)
  try {
    const chunks: SearchChunk[] = Array.from({ length: 35000 }, (_, i) => ({
      key: `chunk-${i}`, file: `notes/note-${i % 11000}.md`, offset: Math.floor(i / 11000) * 750,
      text: (`Synthetic project planning budget topic${i % 200} durable knowledge vector retrieval. `).repeat(10),
      vec: Array.from({ length: 768 }, (_, d) => Math.sin((i + 1) * (d + 1) * 0.37)),
      class: i % 10 === 0 ? 'sensitive' : 'internal', space: 'personal'
    }))
    db.replace(chunks); db.save()
    const elapsed: number[] = []
    for (const query of ['budget', 'topic12', 'planning', 'retrieval', 'nonexistent']) {
      const start = performance.now(), hits = db.search(query, chunks[123].vec, 10)
      elapsed.push(performance.now() - start)
      expect(new Set(hits.map(h => h.c.file)).size).toBe(hits.length)
    }
    const bytes = statSync(file).size
    console.info(JSON.stringify({ chunks: chunks.length, notes: 11000, dimensions: 768, sealedFraction: 1, bytes, queryMs: elapsed }))
    expect(bytes).toBeLessThan(250_000_000)
    expect(Math.max(...elapsed)).toBeLessThan(600)
  } finally { db.close(); rmSync(root, { recursive: true, force: true }) }
}, 120_000)
