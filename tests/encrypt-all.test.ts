import { it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, renameSync, symlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Memory } from '../src/main/services/brain/memory-store'
import { SpaceKeys, InMemorySecretStore } from '../src/main/services/security/keys'
import { SecuritySession } from '../src/main/services/security/session'
import { HybridSearch } from '../src/main/services/search/hybrid'
import { RefreshScheduler } from '../src/main/services/ingest/scheduler'
import { createMemoryServer } from '../tools/keepmind-mcp.mjs'

it('defaults every class to encryption and rejects locked and unmigrated plaintext access', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-default-'))
  try {
    const memory = new Memory(dir, null)
    expect(memory.encryptAll).toBe(true)
    expect(() => memory.write('notes/locked.md', 'ordinary')).toThrow(/locked/)
    await expect(HybridSearch.open()).rejects.toThrow(/locked/)
    const { keys } = await SpaceKeys.setup('synthetic', new InMemorySecretStore()); memory.keys = keys
    for (const c of ['public', 'internal', 'sensitive', 'secret']) {
      memory.write(`notes/${c}.md`, `---\nclass: ${c}\n---\nsynthetic ${c} payload`)
      expect(readFileSync(join(dir, `notes/${c}.md`), 'utf8')).toMatch(/^KEEPMIND-ITEM:1/)
      expect(memory.read(`notes/${c}.md`)).toContain(`synthetic ${c} payload`)
    }
    writeFileSync(join(dir, 'notes/import.md'), 'ordinary imported text')
    expect(() => memory.read('notes/import.md')).toThrow(/migration/)
    expect(memory.protectExisting()).toBe(1)
    expect(memory.read('notes/import.md')).toContain('ordinary imported text')
    memory.keys = undefined
    expect(() => memory.read('notes/public.md')).toThrow(/locked/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

it('requires explicit false for legacy config plaintext and defaults missing settings to encryption', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-default-session-'))
  try {
    const secrets = new InMemorySecretStore(), memory = new Memory(join(dir, 'memory'), null)
    const session = new SecuritySession(memory, join(dir, 'security'), secrets)
    await session.setup('synthetic')
    const file = join(dir, 'security/memory-keys.json'), config = JSON.parse(readFileSync(file, 'utf8'))
    config.encryptAll = false; delete config.allowPlaintext; writeFileSync(file, JSON.stringify(config)); session.lock()
    await session.unlock({ passphrase: 'synthetic' }); expect(memory.encryptAll).toBe(true)
    session.configure('personal', [], false)
    memory.write('notes/public.md', 'ordinary opt-in text')
    expect(readFileSync(join(dir, 'memory/notes/public.md'), 'utf8')).toContain('ordinary opt-in text')
    session.lock(); await session.unlock({ passphrase: 'synthetic' }); expect(memory.encryptAll).toBe(false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

it('preserves binary attachment bytes and authenticates ownership and path without plaintext fallback', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-attachment-'))
  try {
    const memory = new Memory(dir, null), data = Buffer.from([0, 255, 254, 128, 1, 2])
    expect(() => memory.writeAttachment('attachments/binary.bin', data)).toThrow(/locked/)
    expect(() => memory.writeAttachment('notes/../ops/forged.bin', data)).toThrow(/path denied/)
    const { keys } = await SpaceKeys.setup('synthetic', new InMemorySecretStore()); memory.keys = keys
    memory.currentSpace = 'company-x'
    for (const c of ['public', 'internal', 'sensitive', 'secret'] as const) {
      memory.writeAttachment(`attachments/${c}.bin`, data, 'company-x', c)
      expect(memory.readAttachment(`attachments/${c}.bin`)).toEqual(data)
    }
    memory.currentSpace = 'company-y'
    expect(memory.readAttachment('attachments/public.bin')).toBeNull()
    memory.grants = ['company-x']; expect(memory.readAttachment('attachments/public.bin')).toEqual(data)
    renameSync(join(dir, 'attachments/public.bin'), join(dir, 'attachments/moved.bin'))
    expect(() => memory.readAttachment('attachments/moved.bin')).toThrow(/authentication/)
    writeFileSync(join(dir, 'attachments/import.bin'), data)
    expect(() => memory.readAttachment('attachments/import.bin')).toThrow(/migration/)
    expect(memory.protectAttachment('attachments/import.bin', 'company-y')).toBe(true)
    expect(memory.protectAttachment('attachments/import.bin', 'company-y')).toBe(false)
    expect(memory.readAttachment('attachments/import.bin')).toEqual(data)
    symlinkSync('/etc', join(dir, 'escape'))
    expect(() => memory.protectAttachment('escape/passwd', 'company-y')).toThrow(/Symlink/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

it('upgrades unchanged plaintext chunks when enabling encryption and retains other spaces', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-index-upgrade-'))
  let db: HybridSearch | undefined
  try {
    const memory = new Memory(join(dir, 'memory'), null, { allowPlaintext: true })
    const { keys } = await SpaceKeys.setup('synthetic', new InMemorySecretStore()); memory.keys = keys
    memory.write('notes/fact.md', 'synthetic ordinary searchable word')
    db = await HybridSearch.open(join(dir, 'index.sqlite'), undefined, () => keys, () => memory.encryptAll)
    const scheduler = new RefreshScheduler(memory, db, join(dir, 'state'))
    await scheduler.indexFiles(); expect(db.chunks()[0].encrypted).toBe(false)
    memory.encryptAll = true
    expect((await scheduler.indexFiles()).changed).toBe(0)
    expect(db.chunks().every(c => c.encrypted)).toBe(true)
    expect(db.search('searchable')).toHaveLength(1)
    expect(db.search('searchable', undefined, 10, { space: 'company-x' })).toEqual([])
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('MCP reads unlocked ciphertext only inside scope and enforces class, corruption and lock denials', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-mcp-encrypted-'))
  try {
    const memory = new Memory(dir, null)
    const { keys } = await SpaceKeys.setup('synthetic', new InMemorySecretStore()); memory.keys = keys
    memory.currentSpace = 'company-x'; memory.write('notes/allowed.md', 'synthetic searchable confidential text')
    memory.currentSpace = 'company-y'; memory.write('notes/foreign.md', 'foreign hidden text')
    writeFileSync(join(dir, 'notes/plain.md'), '---\nspace: company-x\n---\nplaintext hidden')
    const options = { keys, clientId: 'reader', clients: { reader: { spaces: ['company-x'], maxClass: 'internal' } } }
    const handle = createMemoryServer(dir, options)
    const read = (server: any, path: string) => server({ id: 1, method: 'tools/call', params: { name: 'read_note', arguments: { path } } }).result
    expect(read(handle, 'notes/allowed.md').content[0].text).toContain('confidential text')
    expect(read(handle, 'notes/foreign.md').content[0].text).not.toContain('hidden text')
    expect(read(handle, 'notes/plain.md').content[0].text).not.toContain('plaintext hidden')
    expect(handle({ id: 2, method: 'resources/list' }).result.resources).toHaveLength(1)
    const locked = createMemoryServer(dir, { ...options, keys: undefined })
    expect(read(locked, 'notes/allowed.md').isError).toBe(true)
    const lower = createMemoryServer(dir, { ...options, clients: { reader: { spaces: ['company-x'], maxClass: 'public' } } })
    expect(read(lower, 'notes/allowed.md').content[0].text).not.toContain('confidential text')
    const writerOptions = { ...options, clients: { reader: { spaces: ['company-x'], defaultSpace: 'company-x', maxClass: 'internal', write: true } } }
    const writer = createMemoryServer(dir, writerOptions)
    const write = (server: any, path: string) => server({ id: 3, method: 'tools/call', params: { name: 'sb_write', arguments: { path, content: 'synthetic encrypted output' } } }).result
    expect(write(writer, 'notes/encrypted-write.md').isError).toBeUndefined()
    expect(readFileSync(join(dir, 'notes/encrypted-write.md'), 'utf8')).toMatch(/^KEEPMIND-ITEM:1/)
    const brokenAudit = createMemoryServer(dir, { ...writerOptions, auditFile: dir })
    expect(write(brokenAudit, 'notes/audit-denied.md').isError).toBe(true)
    expect(existsSync(join(dir, 'notes/audit-denied.md'))).toBe(false)
    const raw = readFileSync(join(dir, 'notes/allowed.md'), 'utf8')
    writeFileSync(join(dir, 'notes/allowed.md'), raw.replace('company-x', 'company-y'))
    expect(read(handle, 'notes/allowed.md').content[0].text).not.toContain('confidential text')
    writeFileSync(join(dir, 'notes/allowed.md'), raw.slice(0, -12) + 'corrupt')
    expect(read(handle, 'notes/allowed.md').isError).toBe(true)
    const audit = readFileSync(join(dir, 'ops/mcp-reads.jsonl'), 'utf8')
    expect(audit).not.toContain('confidential'); expect(audit).not.toContain('notes/')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
