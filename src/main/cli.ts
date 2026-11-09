import { DerivedLearnings } from './services/derived-learnings'
import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { suggestSpaces, applySpaceMap, approvedSpaceMap } from './services/security/space-map'
import { Memory } from './services/brain/memory-store'
import { HybridSearch } from './services/search/hybrid'
import { RefreshScheduler } from './services/ingest/scheduler'
import { SpaceKeys, type KeyConfig, type SecretStore } from './services/security/keys'
export async function runCli(args = process.argv.slice(2)) {
  const option = (name: string, fallback?: string) => { const i = args.indexOf(name); if (i < 0) return fallback; if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing option value'); return args[i + 1] }
  const command = args[0], root = resolve(command === 'index' ? args[1] ?? '.' : option('--dir', './memory')!)
  const space = option('--space', 'personal')!, state = resolve(option('--state', join(root, '.keepmind'))!)
  if (!['index', 'search', 'status', 'refresh', 'spaces', 'learnings'].includes(command)) throw new Error('Usage: keepmind-cli index <dir> | search <query> [--space name] | spaces suggest|apply | status | refresh [--dir dir] [--state dir] [--unlock-stdin] [--allow-plaintext]')
  if (command === 'spaces') {
    if (args[1] === 'suggest') return suggestSpaces(root, state)
    if (args[1] !== 'apply') throw new Error('Usage: spaces suggest|apply')
    approvedSpaceMap(join(state, 'space-map.json'))
  }
  const memory = new Memory(root, null, { allowPlaintext: args.includes('--allow-plaintext') }); memory.currentSpace = space
  const configFile = join(state, 'security', 'memory-keys.json')
  if (args.includes('--unlock-stdin')) {
    if (!existsSync(configFile)) throw new Error('Configure memory encryption in the native application first')
    const config = JSON.parse(readFileSync(configFile, 'utf8')) as KeyConfig & { encryptAll?: boolean; allowPlaintext?: boolean }
    // Node cannot use Electron safeStorage. Unwrap using explicit stdin credential;
    // refuse secret capture, which requires the native OS keychain service.
    const store: SecretStore = { put: id => { if (!id.startsWith('master:')) throw new Error('Native keychain required for secret capture') }, get: () => { throw new Error('Native keychain required') }, remove: () => { throw new Error('Native keychain required') } }
    memory.keys = await SpaceKeys.unlock(config, store, { passphrase: readFileSync(0, 'utf8').replace(/\r?\n$/, '') }); memory.encryptAll = !(config.allowPlaintext === true && config.encryptAll === false)
    memory.onKeysChanged = () => {
      writeFileSync(configFile + '.tmp', JSON.stringify({ ...memory.keys!.config, encryptAll: memory.encryptAll, allowPlaintext: !memory.encryptAll }), { mode: 0o600 })
      renameSync(configFile + '.tmp', configFile)
    }
  }
  if (existsSync(configFile) && !memory.keys) throw new Error('Index locked: use --unlock-stdin')
  if (command === 'learnings') {
    if (!memory.keys) throw new Error('Encrypted owner session required')
    const service = new DerivedLearnings(root, state, memory.keys, { owner: true, spaces: [space], approval: args.includes('--approve') }, memory.onKeysChanged ?? undefined)
    try {
      const id = option('--id', '')!
      switch (args[1]) {
        case 'suggest': return service.suggest(option('--source', '')!, option('--text', '')!, option('--purpose', '')!, option('--limits', '')!)
        case 'promote': return service.promote(id, option('--digest', '')!)
        case 'list': return service.list()
        case 'search': return service.list(option('--query', '')!, false)
        case 'mark-source-wrong': return service.markSourceWrong(id)
        case 'provenance': return service.sourceDetails(id)
        case 'check-public': return service.checkPublic(id, option('--text', '')!)
        default: throw new Error('Unknown learning action')
      }
    } finally { memory.keys.lock() }
  }
  const db = await HybridSearch.open(join(state, 'memory-search.sqlite'), undefined, () => memory.keys, () => memory.encryptAll)
  try {
    const scheduler = new RefreshScheduler(memory, db, state)
    if (command === 'spaces') {
      const result = applySpaceMap(root, state, memory.keys, memory.encryptAll, () => memory.onKeysChanged?.())
      memory.grants = result.spaces
      await scheduler.indexFiles()
      return { changed: result.changed }
    }
    if (command === 'status') return scheduler.status.snapshot()
    if (command === 'index') return await scheduler.indexFiles()
    if (command === 'refresh') return await scheduler.refresh()
    if (!args[1] || args[1].startsWith('--')) throw new Error('Search query required')
    return [...db.search(args[1], undefined, 10, { space }).map(h => ({ file: h.c.file, score: h.s, text: h.c.text })), ...(memory.keys ? new DerivedLearnings(root, state, memory.keys, { owner: true, spaces: [space] }).list(args[1], false) : [])]
  } finally { db.close(); memory.keys?.lock() }
}
