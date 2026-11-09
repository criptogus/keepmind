import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHmac, randomBytes } from 'node:crypto'
import { join, dirname } from 'node:path'
import type { Store } from '../store'
import type { Memory } from './brain'
import * as github from './github'
import { ensureRepoScaffold, exportBrainConfig } from './scaffold'

// ── GitSync: keeps local memory/ and the GitHub repo continuously in sync ──
//
// The GitHub repo is the source of truth: external AIs (Claude, Codex,
// Grok…) write memory there, and this app both pushes every local write
// (debounced) and pulls remote changes on an interval + before each chat.
//
// Conflict policy: last-writer-wins per file.
//   - Local writes mark the path "dirty" → pushed on next flush.
//   - Pull skips dirty paths (local version wins until pushed).
//   - Remote files whose blob sha changed since last sync are downloaded
//     and written locally (quietly — they don't re-dirty).
//   - Files deleted remotely are removed locally (unless dirty).

interface SyncState {
  sha: Record<string, string>   // relPath -> last seen git blob sha
  encryptionEnabled?: boolean
  plainSha?: Record<string, string> // relPath -> last seen sha on the plaintext remote path (obfuscation on)
  lastPull?: string
  lastPush?: string
}

const PULL_INTERVAL_MS = 60_000
const PUSH_DEBOUNCE_MS = 2_500
const PUSH_MIN_INTERVAL_MS = 5_000
// Text formats worth mirroring — skips images/binaries/attachments on vault imports
const TEXT_FILE_RE = /\.(md|markdown|txt|json|canvas|csv|org|base)$/i

export class GitSync {
  private memory: Memory
  private store: Store
  private stateDir: string
  private stateFile: string
  private state: SyncState = { sha: {} }
  private pathKey: Buffer | null = null
  private pathKeyLoaded = false
  private dirty = new Set<string>()
  private pushTimer: NodeJS.Timeout | null = null
  private pullTimer: NodeJS.Timeout | null = null
  private pushing = false
  private pulling = false
  private lastPushAt = 0
  private error: string | null = null
  private listeners = new Set<(s: SyncStatus) => void>()

  constructor(store: Store, memory: Memory, stateDir: string) {
    this.store = store
    this.memory = memory
    this.stateDir = stateDir
    this.stateFile = join(stateDir, 'sync-state.json')
    this.loadState()
  }

  // ── public API ──

  onStatus(cb: (s: SyncStatus) => void) {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  status(): SyncStatus {
    const gh = this.store.get().github
    return {
      connected: !!(gh.accessToken && (gh.repoOwner || gh.repoUrl)),
      pending: this.dirty.size,
      lastPull: this.state.lastPull ?? null,
      lastPush: this.state.lastPush ?? null,
      syncing: this.pushing || this.pulling,
      error: this.error
    }
  }

  private emit() {
    const s = this.status()
    for (const cb of this.listeners) cb(s)
  }

  // Called by Memory on every local write/append
  markDirty(relPath: string) {
    if (!this.connected()) return
    this.dirty.add(relPath)
    this.schedulePush()
    this.emit()
  }

  private scaffoldDone = false

  // Public so connect flows can trigger it right after repo creation
  async maybeScaffold() { return this.ensureScaffold() }

  start() {
    // Periodic pull — remote AIs may have written memory
    this.pullTimer = setInterval(() => { void this.pull() }, PULL_INTERVAL_MS)
    // First pull shortly after boot
    setTimeout(() => { void this.pull() }, 8_000)
    // One-time: push agent-onboarding files (AGENTS.md, .mcp.json, MCP server)
    // into the repo root so Codex/Claude/Grok discover the memory automatically
    setTimeout(() => { void this.ensureScaffold() }, 20_000)
  }

  private async ensureScaffold() {
    if (this.scaffoldDone || !this.connected()) return
    this.scaffoldDone = true
    try {
      const pushed = await ensureRepoScaffold(this.store.get().github)
      if (pushed.length) console.log(`[sync] repo scaffold pushed: ${pushed.join(', ')}`)
      // keepmind.json — sanitized brain-as-code snapshot at repo root
      await exportBrainConfig(this.store.get().github, this.store.get())
    } catch (e) {
      this.scaffoldDone = false // retry on next start
      console.warn('[sync] scaffold failed:', e)
    }
  }

  stop() {
    if (this.pullTimer) clearInterval(this.pullTimer)
    if (this.pushTimer) clearTimeout(this.pushTimer)
  }

  async syncNow(): Promise<SyncStatus> {
    this.error = null
    await this.pull()
    await this.pushDirty()
    if (this.error) throw new Error(this.error)
    return this.status()
  }

  // Pull remote changes if due (>25s since last pull). Used before chat
  // so the brain always answers with the freshest shared memory.
  private lastPullAttempt = 0
  async pullIfDue(): Promise<void> {
    if (Date.now() - this.lastPullAttempt < 25_000) return
    this.lastPullAttempt = Date.now()
    await this.pull()
  }

  // ── internals ──

  private connected(): boolean {
    const gh = this.store.get().github
    return !!(gh.accessToken && (gh.repoOwner || gh.repoUrl))
  }

  private schedulePush() {
    if (this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      void this.pushDirty()
    }, PUSH_DEBOUNCE_MS)
  }

  private async pushDirty(): Promise<void> {
    if (this.pushing || !this.connected() || this.dirty.size === 0) return
    // respect GitHub rate limits — batch small writes
    if (Date.now() - this.lastPushAt < PUSH_MIN_INTERVAL_MS && this.dirty.size < 10) {
      this.schedulePush()
      return
    }
    this.pushing = true
    this.emit()
    const gh = this.store.get().github
    if (gh.encryptionEnabled && !this.state.encryptionEnabled) {
      for (const rel of this.memory.allRelFiles()) this.dirty.add(rel)
    }
    const batch = [...this.dirty]
    try {
      const obf = this.obfuscate
      const plainSha = (this.state.plainSha ??= {})
      for (const rel of batch) {
        const content = this.memory.read(rel)
        const remoteRel = this.remoteName(rel)
        if (content == null) {
          // local deletion → propagate to GitHub (both namespaces when obfuscating)
          try { await github.deleteMemoryFile(gh, remoteRel, this.syncRoot) } catch { /* may already be gone */ }
          if (obf && remoteRel !== rel) {
            try { await github.deleteMemoryFile(gh, rel, this.syncRoot) } catch { /* may already be gone */ }
          }
          delete this.state.sha[rel]
          delete plainSha[rel]
          this.dirty.delete(rel)
          continue
        }
        // Conflict guard: if the remote file moved since our last sync (or exists
        // untracked) while we hold unsynced local changes, preserve the remote
        // version under conflicts/ before overwriting — nothing is lost.
        const expected = this.state.sha[rel]
        const remote = await github.fetchMemoryFile(gh, remoteRel, this.syncRoot, !this.state.encryptionEnabled)
        if (remote && remote.sha !== expected) {
          this.memory.syncWrite(`conflicts/${rel}`, `<!-- remote version preserved ${new Date().toISOString()} — local version won the push -->\n\n${remote.content}`)
          this.dirty.add(`conflicts/${rel}`)
        }
        // Plaintext twin guard (obfuscation on): an external edit on the plain
        // remote path would be pulled later and revert this push. Absorb it now
        // — preserve the remote version and adopt its sha as the new baseline.
        if (obf && remoteRel !== rel) {
          const plain = await github.fetchMemoryFile(gh, rel, this.syncRoot, !this.state.encryptionEnabled)
          if (plain) {
            if (plainSha[rel] === undefined) plainSha[rel] = plain.sha
            else if (plain.sha !== plainSha[rel]) {
              this.memory.syncWrite(`conflicts/${rel}`, `<!-- remote plaintext version preserved ${new Date().toISOString()} — local version won the push -->\n\n${plain.content}`)
              this.dirty.add(`conflicts/${rel}`)
              plainSha[rel] = plain.sha
            }
          }
        }
        const newSha = await github.pushFile(gh, `${this.syncRoot}${remoteRel}`, content, 'sync: keepmind update')
        if (newSha) this.state.sha[rel] = newSha
        this.dirty.delete(rel)
        this.lastPushAt = Date.now()
      }
      this.state.encryptionEnabled = !!gh.encryptionEnabled
      this.state.lastPush = new Date().toISOString()
      this.saveState()
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
      console.warn('[sync] push failed:', e)
      // keep dirty entries — will retry on next write/interval
    } finally {
      this.pushing = false
      this.emit()
      if (this.dirty.size > 0) this.schedulePush()
    }
  }

  // Repo prefix mirrored into local memory/. 'memory/' for keepmind-native repos,
  // '' when an existing vault (Obsidian/PARA) is imported — its layout becomes ours.
  private get syncRoot(): string {
    return this.store.get().github.syncRoot ?? 'memory/'
  }

  // ── Path obfuscation (opt-in via github.obfuscatePaths) ──
  //
  // When enabled, our pushes go to opaque HMAC-derived names (h_<40hex>) so the
  // GitHub repo doesn't disclose the vault's folder structure. The HMAC key
  // lives only in the local state dir — remote hashed names can't be inverted
  // or forged by anyone else.
  //
  // Plaintext remote paths stay fully supported: external agents (Grok, Codex
  // bots…) keep writing notes/<name>.md and pulls still honor them. Files we
  // pushed before enabling remain as frozen plaintext twins; state.plainSha
  // records their sha so they aren't mistaken for external edits. An external
  // edit to a plaintext path is downloaded AND re-pushed into the hashed
  // namespace, converging both copies. Disabling re-pushes everything to
  // plaintext names (resyncAll) so no local edit is lost to a stale revert.

  private get obfuscate(): boolean {
    const gh = this.store.get().github
    return !!gh.obfuscatePaths && !gh.encryptionEnabled
  }

  private getPathKey(): Buffer | null {
    if (this.pathKeyLoaded) return this.pathKey
    this.pathKeyLoaded = true
    const file = join(this.stateDir, '.sync-pathkey')
    try {
      if (existsSync(file)) {
        const k = Buffer.from(readFileSync(file, 'utf8').trim(), 'hex')
        if (k.length === 32) this.pathKey = k
      }
    } catch { /* regenerate below */ }
    if (!this.pathKey) {
      this.pathKey = randomBytes(32)
      try { writeFileSync(file, this.pathKey.toString('hex'), { mode: 0o600 }) } catch { /* session-only key */ }
    }
    return this.pathKey
  }

  // Remote path (relative to syncRoot) for a local rel path.
  private remoteName(rel: string): string {
    if (!this.obfuscate) return rel
    const key = this.getPathKey()
    if (!key) return rel
    return 'h_' + createHmac('sha256', key).update(`path:${rel}`).digest('hex').slice(0, 40)
  }

  // Hashed remote name → local rel, for every path we could have pushed.
  private reverseNames(): Map<string, string> {
    const map = new Map<string, string>()
    if (!this.obfuscate) return map
    const known = new Set<string>([
      ...this.memory.allRelFiles(),
      ...Object.keys(this.state.sha),
      ...Object.keys(this.state.plainSha ?? {}),
      ...this.dirty
    ])
    for (const rel of known) {
      const rn = this.remoteName(rel)
      if (rn !== rel) map.set(rn, rel)
    }
    return map
  }

  // Called when obfuscation is switched OFF: mark every local file dirty so the
  // next push rewrites the plaintext remote names before a pull could download
  // the stale pre-obfuscation versions over newer local edits.
  resyncAll() {
    for (const rel of this.memory.allRelFiles()) this.dirty.add(rel)
    this.state.plainSha = {}
    this.emit()
    this.schedulePush()
  }

  private async pull(): Promise<void> {
    if (this.pulling || !this.connected()) return
    this.pulling = true
    this.error = null
    this.lastPullAttempt = Date.now()
    this.emit()
    const gh = this.store.get().github
    const root = this.syncRoot
    try {
      if (gh.encryptionEnabled && !this.state.encryptionEnabled) {
        for (const rel of this.memory.allRelFiles()) this.dirty.add(rel)
      }
      const remote = await github.listTree(gh, root)
      const remoteMap = new Map(remote.map(r => [r.path, r.sha]))


      // Safety: an empty/suspiciously-small remote tree must never trigger
      // mass local deletion — a failed API call returns [] indistinguishable
      // from an empty repo, and we already wiped a 9.5k-file vault once.
      const tracked = Object.keys(this.state.sha).length
      if (remote.length === 0 && tracked > 0) {
        console.warn(`[sync] remote tree empty but ${tracked} files tracked — skipping pull to avoid data loss`)
        return
      }

      const obf = this.obfuscate
      const rev = this.reverseNames()
      const plainSha = (this.state.plainSha ??= {})

      // 1) Remote files that are new or changed → download & write locally.
      //    Two namespaces: hashed names (our pushes, canonical) and plaintext
      //    paths (external agents). Plaintext entries are diffed against
      //    plainSha — NOT state.sha, which tracks the hashed blob.
      for (const { path: rpath, sha } of remote) {
        let rel: string
        let canonical: boolean
        if (rpath.startsWith('h_')) {
          if (!obf) continue // orphaned opaque file from a previous mode
          const mapped = rev.get(rpath)
          if (!mapped) continue // opaque file we didn't push — can't map safely
          rel = mapped
          canonical = true
        } else {
          rel = rpath
          canonical = !obf
        }
        if (this.dirty.has(rel)) continue // local write wins until pushed
        if (!TEXT_FILE_RE.test(rel)) continue // skip binaries/attachments on vault import
        if (rel.split('/').slice(0, -1).some(s => s.startsWith('.'))) continue // skip .obsidian/ etc.

        if (canonical) {
          if (this.state.sha[rel] === sha && this.memory.read(rel) !== null) continue // unchanged and present
          const file = await github.fetchMemoryFile(gh, rpath, root, !this.state.encryptionEnabled)
          if (!file) continue
          try {
            this.memory.syncWrite(rel, file.content)
            this.state.sha[rel] = file.sha
            if (gh.encryptionEnabled && !this.state.encryptionEnabled) this.dirty.add(rel)
          } catch (e) {
            console.warn(`[sync] skipped unsafe remote path ${rel}:`, e)
          }
          continue
        }

        // Plaintext namespace while obfuscation is on.
        const baseline = plainSha[rel] ?? this.state.sha[rel]
        if (baseline === sha && this.memory.read(rel) !== null) { plainSha[rel] = sha; continue } // frozen twin / unchanged
        const file = await github.fetchMemoryFile(gh, rpath, root, !this.state.encryptionEnabled)
        if (!file) continue
        try {
          this.memory.syncWrite(rel, file.content)
          plainSha[rel] = file.sha
          // A tracked file edited through the plaintext path converges into the
          // hashed namespace on the next push; brand-new remote files stay
          // plaintext-only until their first local write.
          if (this.state.sha[rel] !== undefined && baseline !== sha) this.dirty.add(rel)
        } catch (e) {
          console.warn(`[sync] skipped unsafe remote path ${rel}:`, e)
        }
      }

      // 2) Remote deletions → remove locally (unless dirty).
      //    With obfuscation a file counts as deleted only when BOTH its hashed
      //    and plaintext remote names are gone. Guard: never delete more than
      //    half the tracked files in one pull — a truncated/wrong-prefix tree
      //    looks like mass deletion.
      let deletions = 0
      const trackedRels = new Set([...Object.keys(this.state.sha), ...Object.keys(plainSha)])
      for (const rel of trackedRels) {
        if (this.dirty.has(rel)) continue
        const gone = obf
          ? !remoteMap.has(this.remoteName(rel)) && !remoteMap.has(rel)
          : !remoteMap.has(rel)
        if (!gone) continue
        deletions++
        if (deletions > Math.max(10, tracked / 2)) {
          console.warn(`[sync] aborting pull: ${deletions} remote deletions exceeds safety threshold`)
          break
        }
        try { this.memory.syncRemove(rel) } catch { /* unsafe path — skip */ }
        delete this.state.sha[rel]
        delete plainSha[rel]
      }

      // 3) Local files never seen remotely and not dirty → push them
      //    (covers files written while GitHub was offline/disconnected)
      const localFiles = this.memory.allRelFiles()
      for (const rel of localFiles) {
        const seen = remoteMap.has(this.remoteName(rel)) || (obf && remoteMap.has(rel))
        if (!seen && !this.dirty.has(rel) && !this.state.sha[rel] && !plainSha[rel]) {
          this.dirty.add(rel)
        }
      }
      if (this.dirty.size > 0) await this.pushDirty()

      this.state.lastPull = new Date().toISOString()
      this.saveState()
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
      console.warn('[sync] pull failed:', e)
    } finally {
      this.pulling = false
      this.emit()
    }
  }

  private loadState() {
    try {
      if (existsSync(this.stateFile)) {
        this.state = { sha: {}, ...JSON.parse(readFileSync(this.stateFile, 'utf8')) }
      }
    } catch { /* fresh state */ }
  }

  private saveState() {
    try {
      mkdirSync(dirname(this.stateFile), { recursive: true })
      writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), 'utf8')
    } catch { /* non-fatal */ }
  }
}

export interface SyncStatus {
  connected: boolean
  pending: number
  lastPull: string | null
  lastPush: string | null
  syncing: boolean
  error: string | null
}
