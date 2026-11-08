import { afterEach, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const electron = vi.hoisted(() => ({ directory: '', available: true, fail: false, backend: 'gnome_libsecret' }))
vi.mock('electron', () => ({
  app: { getPath: () => electron.directory },
  safeStorage: {
    isEncryptionAvailable: () => electron.available,
    getSelectedStorageBackend: () => electron.backend,
    encryptString: (value: string) => { if (electron.fail) throw new Error('keychain failed'); return Buffer.from('sealed-' + value) },
    decryptString: (value: Buffer) => value.toString().slice(7)
  }
}))
import { Store } from '../src/main/store'
afterEach(() => { rmSync(electron.directory, { recursive: true, force: true }); electron.available = true; electron.fail = false; electron.backend = 'gnome_libsecret' })
it.each(['unavailable', 'failure', 'basic_text'])('refuses to persist secrets when OS storage is %s', reason => {
  electron.directory = mkdtempSync(join(tmpdir(), 'km-store-'))
  const store = new Store(); store.set({ onboardingDone: true })
  const path = join(electron.directory, 'second-brain/config.json'), before = readFileSync(path, 'utf8')
  if (reason === 'unavailable') electron.available = false
  if (reason === 'failure') electron.fail = true
  if (reason === 'basic_text') electron.backend = 'basic_text'
  expect(() => store.updateGithub({ accessToken: 'secret-token' })).toThrow(/storage/i)
  expect(readFileSync(path, 'utf8')).toBe(before)
  expect(store.get().github.accessToken).toBeUndefined()
})
it('seals secrets and reloads through OS storage', () => {
  electron.directory = mkdtempSync(join(tmpdir(), 'km-store-'))
  const store = new Store(); store.updateGithub({ accessToken: 'private-token' })
  const persisted = readFileSync(join(electron.directory, 'second-brain/config.json'), 'utf8')
  expect(persisted).not.toContain('private-token')
  expect(new Store().get().github.accessToken).toBe('private-token')
})
