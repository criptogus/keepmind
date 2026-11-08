import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { Memory } from './services/brain/memory-store'
import { HybridSearch } from './services/search/hybrid'
import { RefreshScheduler } from './services/ingest/scheduler'
import { SpaceKeys, type KeyConfig, type SecretStore } from './services/security/keys'
export async function runCli(args = process.argv.slice(2)) {
  const option = (name: string, fallback?: string) => { const i = args.indexOf(name); if (i < 0) return fallback; if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing option value'); return args[i + 1] }
  const command = args[0], root = resolve(command === 'index' ? args[1] ?? '.' : option('--dir', './memory')!)
  const space = option('--space', 'personal')!, state = resolve(option('--state', join(root, '.keepmind'))!)
  if (!['index', 'search', 'status', 'refresh'].includes(command)) throw new Error('Usage: keepmind-cli index <dir> | search <query> [--space name] | status | refresh [--dir dir] [--state dir] [--unlock-stdin]')
  const memory = new Memory(root, null); memory.currentSpace = space
  const configFile = join(state, 'security', 'memory-keys.json')
  if (args.includes('--unlock-stdin')) {
    if (!existsSync(configFile)) throw new Error('Configure memory encryption in the native application first')
    const config = JSON.parse(readFileSync(configFile, 'utf8')) as KeyConfig & { encryptAll?: boolean }
    // Node cannot use Electron safeStorage. Unwrap using explicit stdin credential;
    // refuse secret capture, which requires the native OS keychain service.
    const store: SecretStore = { put: id => { if (!id.startsWith('master:')) throw new Error('Native keychain required for secret capture') }, get: () => { throw new Error('Native keychain required') }, remove: () => { throw new Error('Native keychain required') } }
    memory.keys = await SpaceKeys.unlock(config, store, { passphrase: readFileSync(0, 'utf8').replace(/\r?\n$/, '') }); memory.encryptAll = !!config.encryptAll
    memory.onKeysChanged = () => {
      writeFileSync(configFile + '.tmp', JSON.stringify({ ...memory.keys!.config, encryptAll: memory.encryptAll }), { mode: 0o600 })
      renameSync(configFile + '.tmp', configFile)
    }
  }
  const db = await HybridSearch.open(join(state, 'memory-search.sqlite'), undefined, () => memory.keys, () => memory.encryptAll)
  try {
    const scheduler = new RefreshScheduler(memory, db, state)
    if (command === 'status') return scheduler.status.snapshot()
    if (command === 'index') return await scheduler.indexFiles()
    if (command === 'refresh') return await scheduler.refresh()
    if (!args[1] || args[1].startsWith('--')) throw new Error('Search query required')
    return db.search(args[1], undefined, 10, { space }).map(h => ({ file: h.c.file, score: h.s, text: h.c.text }))
  } finally { db.close(); memory.keys?.lock() }
}
