import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
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
  lastPull?: string
  lastPush?: string
}

const PULL_INTERVAL_MS = 60_000
const PUSH_DEBOUNCE_MS = 2_500
const PUSH_MIN_INTERVAL_MS = 5_000

export class GitSync {
  private memory: Memory
  private store: Store
  private stateFile: string
  private state: SyncState = { sha: {} }
  private dirty = new Set<string>()
  private pushTimer: NodeJS.Timeout | null = null
  private pullTimer: NodeJS.Timeout | null = null
  private pushing = false
  private pulling = false
  private lastPushAt = 0
  private listeners = new Set<(s: SyncStatus) => void>()

  constructor(store: Store, memory: Memory, stateDir: string) {
    this.store = store
    this.memory = memory
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
      syncing: this.pushing || this.pulling
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
    await this.pull()
    await this.pushDirty()
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
    const batch = [...this.dirty]
    try {
      for (const rel of batch) {
        const content = this.memory.read(rel)
        if (content == null) {
          // local deletion → propagate to GitHub
          try { await github.deleteMemoryFile(gh, rel) } catch { /* may already be gone */ }
          delete this.state.sha[rel]
          this.dirty.delete(rel)
          continue
        }
        await github.pushFile(gh, `memory/${rel}`, content, 'sync: keepmind update')
        this.dirty.delete(rel)
        this.lastPushAt = Date.now()
      }
      this.state.lastPush = new Date().toISOString()
      this.saveState()
    } catch (e) {
      console.warn('[sync] push failed:', e)
      // keep dirty entries — will retry on next write/interval
    } finally {
      this.pushing = false
      this.emit()
      if (this.dirty.size > 0) this.schedulePush()
    }
  }

  private async pull(): Promise<void> {
    if (this.pulling || !this.connected()) return
    this.pulling = true
    this.lastPullAttempt = Date.now()
    this.emit()
    const gh = this.store.get().github
    try {
      const remote = await github.listTree(gh, 'memory/')
      const remoteMap = new Map(remote.map(r => [r.path, r.sha]))

      // 1) Remote files that are new or changed → download & write locally
      for (const { path: rel, sha } of remote) {
        if (this.dirty.has(rel)) continue // local write wins until pushed
        if (this.state.sha[rel] === sha) continue // unchanged
        const file = await github.fetchMemoryFile(gh, rel)
        if (!file) continue
        try {
          this.memory.quietWrite(rel, file.content)
          this.state.sha[rel] = file.sha
        } catch (e) {
          console.warn(`[sync] skipped unsafe remote path ${rel}:`, e)
        }
      }

      // 2) Remote deletions → remove locally (unless dirty)
      for (const rel of Object.keys(this.state.sha)) {
        if (!remoteMap.has(rel) && !this.dirty.has(rel)) {
          try { this.memory.quietRemove(rel) } catch { /* unsafe path — skip */ }
          delete this.state.sha[rel]
        }
      }

      // 3) Local files never seen remotely and not dirty → push them
      //    (covers files written while GitHub was offline/disconnected)
      const localFiles = this.memory.allRelFiles()
      for (const rel of localFiles) {
        if (!remoteMap.has(rel) && !this.dirty.has(rel) && !this.state.sha[rel]) {
          this.dirty.add(rel)
        }
      }
      if (this.dirty.size > 0) void this.pushDirty()

      this.state.lastPull = new Date().toISOString()
      this.saveState()
    } catch (e) {
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
}
