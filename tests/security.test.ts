import { it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SpaceKeys, InMemorySecretStore, KeychainSecretStore } from '../src/main/services/security/keys'
import { classify, detections } from '../src/main/services/security/classification'
import { gate } from '../src/main/services/security/egress'
import { Memory } from '../src/main/services/brain/memory-store'
it('wraps space keys, recovers master, authenticates context, and fails closed', async () => {
  const secrets = new InMemorySecretStore(), { keys, recoveryKey } = await SpaceKeys.setup('test passphrase', secrets)
  keys.createSpace('personal'); const box = keys.encrypt('synthetic text', 'personal', 'note')
  expect(keys.decrypt(box, 'personal', 'note')).toBe('synthetic text')
  expect(() => keys.decrypt(box, 'personal', 'other')).toThrow()
  expect(() => keys.decrypt(box.slice(0, -5) + 'oops', 'personal', 'note')).toThrow()
  await expect(SpaceKeys.unlock(keys.config, secrets, { passphrase: 'wrong' })).rejects.toThrow()
  const recovered = await SpaceKeys.unlock(keys.config, secrets, { recoveryKey })
  expect(recovered.decrypt(box, 'personal', 'note')).toBe('synthetic text')
  const unavailable = new KeychainSecretStore({ isEncryptionAvailable: () => false } as any, {} as any)
  await expect(SpaceKeys.setup('test', unavailable)).rejects.toThrow(/keychain/)
  expect(() => unavailable.get('x')).toThrow(/keychain/)
})
it('detects supported PII and secret formats', () => {
  const pii = ['123.456.789-00', '12.345.678/0001-00', 'person@example.invalid', '+55 (11) 99999-0000']
  for (const text of pii) expect(classify(text)).toBe('sensitive')
  const tokens = ['sk-' + 'a'.repeat(24), 'ghp_' + 'b'.repeat(24), 'xoxb-' + 'c'.repeat(24), 'AKIA' + 'D'.repeat(16), 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.signature', '-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----']
  for (const text of tokens) expect(detections(text).some(d => d.secret)).toBe(true)
})
it('encrypts restricted memory, masks secrets, isolates spaces and refuses locked writes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-sec-'))
  try {
    const mem = new Memory(dir, null)
    expect(() => mem.write('notes/a.md', 'person@example.invalid')).toThrow(/locked/)
    const { keys } = await SpaceKeys.setup('test', new InMemorySecretStore()); mem.keys = keys
    const token = 'sk-' + 'z'.repeat(24)
    mem.write('notes/a.md', token)
    const disk = readFileSync(join(dir, 'notes/a.md'), 'utf8')
    expect(disk).not.toContain(token); expect(disk).not.toContain('keychain:')
    expect(mem.read('notes/a.md')).toContain('keychain:'); expect(mem.read('notes/a.md')).not.toContain(token)
    mem.currentSpace = 'company-x'; expect(mem.read('notes/a.md')).toBeNull()
    mem.grants = ['personal']; expect(mem.read('notes/a.md')).toContain('keychain:')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
it('blocks cloud without consent and redacts PII with consent, logging metadata only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-egress-')), logFile = join(dir, 'audit.jsonl')
  const messages = [{ content: 'person@example.invalid' }]
  try {
    expect(() => gate('cloud', false, messages, { logFile })).toThrow(/consent/)
    const result = gate('cloud', false, messages, { logFile, consent: { id: 'test-consent', space: 'personal', provider: 'cloud', expiresAt: Date.now() + 10000 } })
    expect(result[0].content).toContain('REDACTED'); expect(readFileSync(logFile, 'utf8')).not.toContain(messages[0].content)
    expect(gate('local', true, messages)).toEqual(messages)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
it('supports public declarations and explicit overrides without disabling detectors', async () => {
  const { policy } = await import('../src/main/services/security/classification')
  expect(policy('---\nclass: public\n---\nOpen documentation').class).toBe('public')
  expect(policy('---\nclass_override: secret\n---\nConfidential strategy').class).toBe('secret')
  expect(policy('---\nclass_override: public\n---\nperson@example.invalid').class).toBe('sensitive')
})
it('persists space wraps, unlocks after restart and carries classification to derived output', async () => {
  const { SecuritySession } = await import('../src/main/services/security/session')
  const dir = mkdtempSync(join(tmpdir(), 'km-session-')), secrets = new InMemorySecretStore()
  try {
    const memory = new Memory(join(dir, 'memory'), null), session = new SecuritySession(memory, join(dir, 'security'), secrets)
    const { recoveryKey } = await session.setup('test passphrase')
    memory.write('notes/private.md', '---\nclass: sensitive\n---\nConfidential strategy')
    expect(memory.read('notes/private.md')).toContain('Confidential')
    memory.write('notes/derived.md', 'A synthesized strategy')
    expect(readFileSync(join(dir, 'memory/notes/derived.md'), 'utf8')).not.toContain('synthesized')
    session.lock(); expect(() => memory.read('notes/private.md')).toThrow(/locked/)
    const restarted = new Memory(join(dir, 'memory'), null), restored = new SecuritySession(restarted, join(dir, 'security'), secrets)
    await restored.unlock({ recoveryKey })
    expect(restarted.read('notes/private.md')).toContain('Confidential')
    expect(readFileSync(join(dir, 'security/memory-keys.json'), 'utf8')).not.toContain(recoveryKey)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
it('gates actual chat and streaming dispatch before network calls and redacts tool descriptions', async () => {
  const { vi } = await import('vitest'), { chat, chatStream } = await import('../src/main/services/llm')
  const dir = mkdtempSync(join(tmpdir(), 'km-dispatch-')), logFile = join(dir, 'audit.jsonl')
  const fetch = vi.fn(async () => Response.json({ choices: [{ message: { content: 'ok' } }] }))
  vi.stubGlobal('fetch', fetch)
  try {
    const messages = [{ role: 'user' as const, content: '---\nclass: sensitive\n---\nconfidential strategy' }]
    const cfg = { provider: 'openai', apiKey: 'synthetic' }
    await expect(chat(cfg, messages, [], undefined, { logFile })).rejects.toThrow(/consent/)
    await expect(chatStream(cfg, messages, () => {}, undefined, { logFile })).rejects.toThrow(/consent/)
    expect(fetch).not.toHaveBeenCalled()
    await chat(cfg, [{ role: 'user', content: 'person@example.invalid' }], [{ name: 'test', description: 'person@example.invalid', parameters: {} }], undefined, { logFile, consent: { id: 'synthetic', provider: 'openai', space: 'personal', expiresAt: Date.now() + 10000 } })
    expect(String(fetch.mock.calls[0][1]?.body)).not.toContain('person@example.invalid')
  } finally { vi.unstubAllGlobals(); rmSync(dir, { recursive: true, force: true }) }
})
it('encryptAll upgrades existing scoped items and indexing migrates restricted imports', async () => {
  const { writeFileSync } = await import('node:fs')
  const { SecuritySession } = await import('../src/main/services/security/session')
  const dir = mkdtempSync(join(tmpdir(), 'km-upgrade-'))
  try {
    const memory = new Memory(join(dir, 'memory'), null), session = new SecuritySession(memory, join(dir, 'state'), new InMemorySecretStore())
    memory.write('notes/public.md', '---\nclass: public\n---\nOpen documentation')
    await session.setup('test')
    writeFileSync(join(dir, 'memory/notes/import.md'), 'person@example.invalid')
    expect(() => memory.read('notes/import.md')).toThrow(/migration/)
    session.configure('personal', [], true)
    expect(readFileSync(join(dir, 'memory/notes/public.md'), 'utf8')).not.toContain('Open documentation')
    expect(readFileSync(join(dir, 'memory/notes/import.md'), 'utf8')).not.toContain('person@example.invalid')
    expect(memory.read('notes/import.md')).toContain('person@example.invalid')
    expect(memory.protectExisting()).toBe(0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
it('keeps in-flight work in its original scope while the active space changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-async-space-'))
  try {
    const memory = new Memory(dir, null)
    let resume!: () => void
    const paused = new Promise<void>(resolve => { resume = resolve })
    const task = memory.withScope(async () => { await paused; memory.write('notes/original.md', 'Original scoped result'); return memory.currentSpace })
    memory.currentSpace = 'company-x'; resume()
    expect(await task).toBe('personal')
    expect(memory.read('notes/original.md')).toBeNull()
    memory.grants = ['personal']; expect(memory.read('notes/original.md')).toContain('space: personal')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
