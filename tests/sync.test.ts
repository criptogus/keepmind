import { afterEach, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as github from '../src/main/services/github'
import { GitSync } from '../src/main/services/sync'
import { Memory } from '../src/main/services/brain'
import type { GitHubConfig, Store } from '../src/main/store'
const dirs: string[] = [], syncs: GitSync[] = []
afterEach(() => { syncs.splice(0).forEach(s => s.stop()); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); github.lockSync(); vi.unstubAllGlobals() })
function server() {
  const files = new Map<string, { content: string; sha: string }>()
  const writes: string[] = []
  let counter = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url), parts = parsed.pathname.split('/contents/'), path = decodeURIComponent(parts[1] ?? '')
    if (parsed.pathname.includes('/git/trees/')) return Response.json({ tree: [...files].filter(([p]) => p.startsWith('memory/')).map(([path, f]) => ({ type: 'blob', path, sha: f.sha })) })
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)); files.set(path, { content: Buffer.from(body.content, 'base64').toString('utf8'), sha: String(++counter) }); writes.push(path)
      return Response.json({ content: { sha: String(counter) } })
    }
    const file = files.get(path)
    return file ? Response.json({ content: Buffer.from(file.content).toString('base64'), sha: file.sha }) : new Response('', { status: 404 })
  }))
  return { files, writes }
}
const config = (): GitHubConfig => ({ accessToken: 'token', repoOwner: 'owner', repoName: 'repo', encryptionEnabled: true })
it('encrypts uploads, stores only a public salt/header and decrypts pulls', async () => {
  const remote = server(), cfg = config(); github.unlockSync('my private passphrase')
  const dir = mkdtempSync(join(tmpdir(), 'km-sync-')); dirs.push(dir)
  const mem = new Memory(join(dir, 'memory'), null); mem.write('notes/private.md', 'private fact 🧠')
  const store = { get: () => ({ github: cfg }) } as unknown as Store
  const sync = new GitSync(store, mem, dir); syncs.push(sync)
  await sync.syncNow()
  const ciphertext = remote.files.get('memory/notes/private.md')!.content
  expect(ciphertext).toMatch(/^KEEPMIND-ENCRYPTED:1\n/)
  expect(ciphertext).not.toContain('private fact')
  const header = remote.files.get('.keepmind/crypto.json')!.content
  expect(JSON.parse(header).kdf).toBe('argon2id13')
  expect(header).not.toContain('my private passphrase')
  mem.quietRemove('notes/private.md')
  await sync.syncNow()
  expect(mem.read('notes/private.md')).toBe('private fact 🧠')
  expect(remote.writes[0]).toBe('.keepmind/crypto.json')
})
it('refuses wrong passphrases, locked writes, and disabling encryption on an encrypted repository', async () => {
  const remote = server(), cfg = config()
  await expect(github.pushFile(cfg, 'memory/a.md', 'secret', 'test')).rejects.toThrow(/locked/)
  expect(remote.writes).toEqual([])
  github.unlockSync('correct passphrase'); await github.pushFile(cfg, 'memory/a.md', 'secret', 'test')
  const before = remote.files.get('memory/a.md')!.content
  github.unlockSync('wrong passphrase')
  await expect(github.fetchMemoryFile(cfg, 'a.md')).rejects.toThrow(/authentication failed/)
  await expect(github.pushFile(cfg, 'memory/a.md', 'overwrite', 'test')).rejects.toThrow(/authentication failed/)
  expect(remote.files.get('memory/a.md')!.content).toBe(before)
  await expect(github.pushFile({ ...cfg, encryptionEnabled: false }, 'memory/a.md', 'plaintext', 'test')).rejects.toThrow(/repository is encrypted/)
})
it('surfaces sync failures and preserves local data on a GitHub tree error', async () => {
  server(); vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
  const dir = mkdtempSync(join(tmpdir(), 'km-sync-')); dirs.push(dir)
  const mem = new Memory(join(dir, 'memory'), null); mem.write('notes/a.md', 'keep this')
  const sync = new GitSync({ get: () => ({ github: config() }) } as unknown as Store, mem, dir); syncs.push(sync)
  await expect(sync.syncNow()).rejects.toThrow(/503/)
  expect(sync.status().error).toContain('503')
  expect(mem.read('notes/a.md')).toBe('keep this')
})
it('migrates remote-only plaintext once, then refuses plaintext downgrades', async () => {
  const remote = server(), cfg = config(); github.unlockSync('migration passphrase')
  remote.files.set('memory/notes/legacy.md', { content: 'legacy private fact', sha: 'legacy' })
  const dir = mkdtempSync(join(tmpdir(), 'km-sync-')); dirs.push(dir)
  const mem = new Memory(join(dir, 'memory'), null)
  const sync = new GitSync({ get: () => ({ github: cfg }) } as unknown as Store, mem, dir); syncs.push(sync)
  await sync.syncNow()
  expect(mem.read('notes/legacy.md')).toBe('legacy private fact')
  expect(remote.files.get('memory/notes/legacy.md')!.content).toMatch(/^KEEPMIND-ENCRYPTED:1/)
  remote.files.set('memory/notes/legacy.md', { content: 'injected plaintext', sha: 'tampered' })
  await expect(sync.syncNow()).rejects.toThrow(/downgrade/)
  expect(mem.read('notes/legacy.md')).toBe('legacy private fact')
})
