// Explicitly local fictional demonstration. Never reads/decrypts real notes.
import { cpSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Memory } from '../src/main/services/brain/memory-store'
import { SpaceKeys } from '../src/main/services/security/keys'
import { DerivedLearnings } from '../src/main/services/derived-learnings'

async function main() {
  const base = '/workspace/keepmind-test', state = join(base, 'state2')
  const backup = join(base, `state2-pre-general-learnings-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  if (existsSync(join(state, 'derived-learnings.box'))) throw new Error('Demo requires unused learning registry')
  // Full safe backup precedes every state mutation and secret load.
  cpSync(state, backup, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
  const manifest = (root: string) => {
    const rows: string[] = []
    const walk = (dir: string) => { for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && e.name.endsWith('.md')) rows.push(p + ':' + createHash('sha256').update(readFileSync(p)).digest('hex'))
    } }
    walk(root); return rows.sort()
  }
  const before = manifest(join(base, 'data/memory'))
  const configPath = join(state, 'security/memory-keys.json'), config = JSON.parse(readFileSync(configPath, 'utf8'))
  const secrets = { put() {}, get(): string { throw new Error('Unavailable') }, remove() {} }
  const keys = await SpaceKeys.unlock(config, secrets, { passphrase: readFileSync(join(base, 'TEST-PASSPHRASE.txt'), 'utf8').replace(/\r?\n$/, '') })
  try {
    const root = join(base, 'general-learnings-demo-memory')
    const memory = new Memory(root, null); memory.keys = keys; memory.currentSpace = 'demo-general-learnings'
    keys.createSpace('demo-other-owner-scope')
    memory.write('notes/DEMO-fictional-source.md', 'DEMO FICTIONAL: Zephyr company Ada met in November 2031 during a unique merger.')
    const service = new DerivedLearnings(root, state, keys, { owner: true, spaces: [memory.currentSpace], approval: true })
    const draft = service.suggest('notes/DEMO-fictional-source.md', 'Separate proposals from final review.', 'DEMO ONLY private fictional reflection', 'DEMO hypothesis; incentives can still conflict.')
    let denied = false
    try { new DerivedLearnings(root, state, keys, { owner: true, spaces: [memory.currentSpace] }).promote(draft.id, draft.approvalDigest) } catch { denied = true }
    service.promote(draft.id, draft.approvalDigest)
    const other = new DerivedLearnings(root, state, keys, { owner: true, spaces: ['demo-other-owner-scope'] })
    const results = other.list('proposals', false)
    const redacted = !/provenance|source|Zephyr|Ada|2031/.test(JSON.stringify(results))
    memory.write('notes/DEMO-fictional-source.md', 'DEMO FICTIONAL edited: Zephyr company Ada November 2031 unique merger.')
    const changed = service.sourceDetails(draft.id).sourceChanged
    const activeAfterEdit = service.list('', false).length
    const risky = service.checkPublic(draft.id, 'Ada at Zephyr in November 2031 during a unique merger.')
    const clean = service.checkPublic(draft.id, 'Separate proposals from final review.')
    service.markSourceWrong(draft.id)
    const afterWrong = service.list('', false).length
    memory.remove('notes/DEMO-fictional-source.md')
    const afterDelete = service.list('', false).length
    const deleted = service.sourceDetails(draft.id).sourceDeleted
    writeFileSync(configPath, JSON.stringify({ ...keys.config, encryptAll: config.encryptAll, allowPlaintext: config.allowPlaintext }), { mode: 0o600 })
    const after = manifest(join(base, 'data/memory'))
    const report = { backup, fictionalLearnings: 1, approvalWithoutExplicitCapabilityDenied: denied, explicitApproval: true, ownerOtherScopeResults: results.length, provenanceRedacted: redacted, sourceChanged: changed, activeAfterEdit, risky, clean, activeAfterWrong: afterWrong, activeAfterDeletion: afterDelete, sourceDeleted: deleted, realNoteCountBefore: before.length, realNoteCountAfter: after.length, realCiphertextsUnchanged: JSON.stringify(before) === JSON.stringify(after), sync: 'OFF: Memory constructed with null GitHub configuration; no sync process started', demoSourceRemoved: true, retainedLearning: 'DEMO ONLY; suspended' }
    writeFileSync(join(base, 'general-learnings-demo-evidence.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
    console.log(JSON.stringify(report, null, 2))
  } finally { keys.lock() }
}
main().catch(() => { console.error('Local fictional demo failed; no details disclosed.'); process.exitCode = 1 })
