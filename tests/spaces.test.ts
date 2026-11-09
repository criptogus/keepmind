import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli } from '../src/main/cli'
import { applySpaceMap, approvedSpaceMap, suggestSpaces } from '../src/main/services/security/space-map'
import { SpaceKeys, InMemorySecretStore } from '../src/main/services/security/keys'
import { Memory } from '../src/main/services/brain/memory-store'
import { HybridSearch } from '../src/main/services/search/hybrid'
const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })))
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'km-space-map-')); dirs.push(root)
  const state = join(root, '.keepmind'); mkdirSync(state); mkdirSync(join(root, 'notes'))
  writeFileSync(join(root, 'notes/board.md'), '---\nspace: board-x\nclass: internal\n---\nsynthetic boardword')
  writeFileSync(join(root, 'notes/company.md'), '---\nspace: company-x\nclass: internal\n---\nsynthetic companyword')
  writeFileSync(join(root, 'notes/other.md'), '---\nspace: board-y\nclass: internal\n---\nsynthetic otherword')
  return { root, state, configFile: join(state, 'space-map.json') }
}
it('suggests matching slugs as identifiers and counts only, without merging or approving', async () => {
  const { root, state } = fixture()
  expect(suggestSpaces(root, state)).toEqual([{ from: 'board-x', to: 'company-x', counts: { source: 1, target: 1 } }])
  expect(await runCli(['spaces', 'suggest', '--dir', root])).toEqual(suggestSpaces(root, state))
  expect(readFileSync(join(root, 'notes/board.md'), 'utf8')).toContain('space: board-x')
})
it('refuses absent, unapproved, missing timestamp, malformed and cyclic maps before writes', async () => {
  const { root, state, configFile } = fixture()
  expect(() => applySpaceMap(root, state, undefined, false)).toThrow('required')
  for (const config of [
    { aliases: { 'board-x': 'company-x' }, approved: false, approved_at: '2026-11-01T00:00:00Z' },
    { aliases: { 'board-x': 'company-x' }, approved: true },
    { aliases: { 'board-x': 'company-x', 'company-x': 'board-x' }, approved: true, approved_at: '2026-11-01T00:00:00Z' },
    { aliases: { '../bad': 'company-x' }, approved: true, approved_at: '2026-11-01T00:00:00Z' }
  ]) {
    writeFileSync(configFile, JSON.stringify(config))
    expect(() => approvedSpaceMap(configFile)).toThrow()
    await expect(runCli(['spaces', 'apply', '--dir', root, '--allow-plaintext'])).rejects.toThrow()
    expect(readFileSync(join(root, 'notes/board.md'), 'utf8')).toContain('space: board-x')
  }
})
it('applies only approved aliases, reindexes both spaces and remains idempotent', async () => {
  const { root, state, configFile } = fixture()
  writeFileSync(configFile, JSON.stringify({ aliases: { 'board-x': 'company-x' }, approved: true, approved_at: '2026-11-01T00:00:00Z' }))
  // Approval alone does not mutate notes: the apply command is explicit.
  expect(readFileSync(join(root, 'notes/board.md'), 'utf8')).toContain('space: board-x')
  expect(await runCli(['spaces', 'apply', '--dir', root, '--allow-plaintext'])).toEqual({ changed: 1 })
  expect(readFileSync(join(root, 'notes/board.md'), 'utf8')).toContain('space: company-x')
  expect(readFileSync(join(root, 'notes/other.md'), 'utf8')).toContain('space: board-y')
  expect(await runCli(['spaces', 'apply', '--dir', root, '--allow-plaintext'])).toEqual({ changed: 0 })
  const db = await HybridSearch.open(join(state, 'memory-search.sqlite'), undefined, undefined, () => false)
  try {
    expect(db.search('boardword', undefined, 6, { space: 'board-x' })).toEqual([])
    expect(db.search('boardword', undefined, 6, { space: 'company-x' })[0].c.file).toBe('notes/board.md')
  } finally { db.close() }
})
it('authenticates sealed source items and reencrypts under the approved target key', async () => {
  const { root, state, configFile } = fixture()
  const { keys } = await SpaceKeys.setup('synthetic', new InMemorySecretStore())
  const memory = new Memory(root, null); memory.keys = keys; memory.currentSpace = 'board-x'
  memory.write('notes/sealed.md', '---\nspace: board-x\nclass: sensitive\n---\nsynthetic restrictedword')
  writeFileSync(configFile, JSON.stringify({ aliases: { 'board-x': 'company-x' }, approved: true, approved_at: '2026-11-01T00:00:00Z' }))
  expect(() => applySpaceMap(root, state, undefined, false)).toThrow('locked')
  expect(readFileSync(join(root, 'notes/board.md'), 'utf8')).toContain('space: board-x')
  expect(applySpaceMap(root, state, keys, false).changed).toBe(2)
  memory.currentSpace = 'company-x'
  expect(memory.read('notes/sealed.md')).toContain('restrictedword')
  memory.currentSpace = 'board-x'
  expect(memory.read('notes/sealed.md')).toBeNull()
  expect(readFileSync(join(root, 'notes/sealed.md'), 'utf8')).not.toContain('restrictedword')
})
