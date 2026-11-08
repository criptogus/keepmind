import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveInside } from '../../safe-path'
import { KeychainSecretStore, SpaceKeys, type KeyConfig, type SafeStorage, type SecretStore } from './keys'
import type { Memory } from '../brain/memory-store'
export function diskSecretStore(dir: string, safeStorage: SafeStorage): SecretStore {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = (id: string) => { if (!/^[\w:-]+$/.test(id)) throw new Error('Invalid secret id'); return resolveInside(dir, id.replace(/:/g, '_') + '.box') }
  return new KeychainSecretStore(safeStorage, {
    read: id => existsSync(path(id)) ? readFileSync(path(id), 'utf8') : undefined,
    write: (id, value) => writeFileSync(path(id), value, { mode: 0o600 }),
    remove: id => { if (existsSync(path(id))) unlinkSync(path(id)) }
  })
}
export class SecuritySession {
  private file: string
  constructor(private memory: Memory, stateDir: string, private secrets: SecretStore) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 }); this.file = join(stateDir, 'memory-keys.json')
    memory.onKeysChanged = () => this.save()
  }
  private save() {
    if (!this.memory.keys) throw new Error('Memory locked')
    writeFileSync(this.file + '.tmp', JSON.stringify({ ...this.memory.keys.config, encryptAll: this.memory.encryptAll }), { mode: 0o600 })
    renameSync(this.file + '.tmp', this.file)
  }
  get status() { return { configured: existsSync(this.file), unlocked: !!this.memory.keys, space: this.memory.currentSpace, encryptAll: this.memory.encryptAll } }
  async setup(passphrase: string) {
    if (existsSync(this.file)) throw new Error('Encryption already configured')
    const { keys, recoveryKey } = await SpaceKeys.setup(passphrase, this.secrets)
    this.memory.keys = keys; keys.createSpace(this.memory.currentSpace); this.save()
    return { recoveryKey } // only this setup response ever exposes it
  }
  async unlock(credential?: { passphrase?: string; recoveryKey?: string }) {
    const config = JSON.parse(readFileSync(this.file, 'utf8')) as KeyConfig & { encryptAll?: boolean }
    this.memory.keys = await SpaceKeys.unlock(config, this.secrets, credential)
    this.memory.encryptAll = !!config.encryptAll
  }
  lock() { this.memory.keys?.lock(); this.memory.keys = undefined }
  configure(space: string, grants: string[] = [], encryptAll = this.memory.encryptAll) {
    if (![space, ...grants].every(s => /^[a-zA-Z0-9_-]{1,80}$/.test(s))) throw new Error('Invalid space')
    if (!this.memory.keys) throw new Error('Memory locked')
    this.memory.currentSpace = space; this.memory.grants = [...grants]; this.memory.encryptAll = encryptAll
    this.memory.keys.createSpace(space); this.save()
    this.memory.protectExisting()
  }
}
