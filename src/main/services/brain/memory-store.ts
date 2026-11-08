import { AsyncLocalStorage } from 'node:async_hooks'
import { appendFileSync,existsSync,mkdirSync,readdirSync,readFileSync,renameSync,statSync,unlinkSync,writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveInside } from '../../safe-path'
import { randomUUID } from 'node:crypto'
import { policy, frontmatter, detections, restricted, allowedSpace, maxClass, type Classification } from '../security/classification'
import type { SpaceKeys } from '../security/keys'
import type { GitHubConfig } from '../../store'

export interface ActivityEntry {
  ts: number
  op: 'write' | 'append' | 'remove'
  path: string
  source: string // 'system' | 'ui' | 'chat' | 'sleep' | 'auto:<name>' | ...
}

export class Memory {
  // Called after every local write/append — used by GitSync to mark dirty paths
  onWrite: ((relPath: string) => void) | null = null
  // Who is writing right now — Brain methods set this so the activity
  // journal can attribute each change (sleep cycle, chat, ui, automation…)
  activitySource = 'system'
  private quiet = false
  private migrating = false
  private journal: ActivityEntry[] = []
  private journalFile: string
  private journalAppends = 0

  classificationFloor: Classification = 'public'
  readonly readSpaces = new Set<string>()
  private scope = new AsyncLocalStorage<{ space: string; grants: string[] }>()
  private activeSpace = 'personal'
  private activeGrants: string[] = []
  get currentSpace() { return this.scope.getStore()?.space ?? this.activeSpace }
  set currentSpace(value: string) { this.activeSpace = value }
  get grants() { return this.scope.getStore()?.grants ?? this.activeGrants }
  set grants(value: string[]) { this.activeGrants = value }
  withScope<T>(fn: () => T): T { return this.scope.run({ space: this.currentSpace, grants: [...this.grants] }, fn) }
  keys?: SpaceKeys
  encryptAll = false
  onKeysChanged: (() => void) | null = null

  constructor(private dir: string, private gh: GitHubConfig | (() => GitHubConfig) | null) {
    mkdirSync(this.dir, { recursive: true })
    this.journalFile = join(this.dir, 'ops', 'activity.jsonl')
    this.loadJournal()
    // Memory tiers — modeled on human memory:
    //   short-term  = raw daily logs (working memory, recent days)
    //   medium-term = weekly consolidations of older short-term logs
    //   long-term   = durable facts, lessons, skills (never forgotten)
    //   sleep       = nightly learning reports
    //   inbox       = legacy dir kept for backward compatibility
    for (const sub of ['short-term', 'medium-term', 'long-term', 'sleep', 'inbox', 'insights', 'summaries', 'agents', 'notes', 'tasks', 'daily', 'meetings', 'entities', 'review', 'skills', 'crm', 'crm/people', 'crm/companies', 'crm/interactions', 'ops']) {
      mkdirSync(join(this.dir, sub), { recursive: true })
    }
  }

  // Containment guard: every memory path must resolve inside the memory
  // dir — blocks `..` traversal from LLM tool args, sync filenames, etc.
  private path(...parts: string[]) {
    return resolveInside(this.dir, ...parts)
  }

  write(relative: string, content: string) {
    const p = this.path(relative)
    mkdirSync(join(p, '..'), { recursive: true })
    if (!this.migrating && existsSync(p) && this.read(relative) === null) throw new Error('Space access denied')
    const item = policy(content, this.currentSpace)
    item.class = maxClass(item.class, this.classificationFloor)
    if (!allowedSpace(item.space, this.currentSpace, this.grants)) throw new Error('Space access denied')
    const mustEncrypt = this.encryptAll || restricted(item.class)
    if (mustEncrypt && !this.keys) throw new Error('Memory locked: encryption keys required')
    for (const hit of detections(content).filter(h => h.secret)) {
      if (!this.keys) throw new Error('Secret store unavailable')
      const id = randomUUID()
      this.keys.secrets.put(id, hit.value)
      content = content.split(hit.value).join(`[MASKED] keychain:${id}`)
    }
    content = frontmatter(content, item)
    if (mustEncrypt) {
      this.keys!.createSpace(item.space)
      this.onKeysChanged?.()
      content = 'KEEPMIND-ITEM:1\n' + JSON.stringify({ space: item.space, box: this.keys!.encrypt(content, item.space, relative) })
    }
    const temp = p + '.tmp'
    writeFileSync(temp, content, { encoding: 'utf8', mode: 0o600 })
    renameSync(temp, p)
    if (!this.quiet) {
      this.onWrite?.(relative)
      this.journalPush('write', relative)
    }
  }

  append(relative: string, content: string) {
    this.write(relative, (this.read(relative) ?? '') + content)
  }

  // Activity journal — every local mutation is recorded to
  // ops/activity.jsonl (local-only, .jsonl so it never syncs to GitHub)
  // and kept in a ring buffer for the UI feed.
  private journalPush(op: ActivityEntry['op'], rel: string) {
    const entry: ActivityEntry = { ts: Date.now(), op, path: rel, source: this.activitySource }
    this.journal.push(entry)
    if (this.journal.length > 600) this.journal.splice(0, this.journal.length - 600)
    try {
      mkdirSync(join(this.dir, 'ops'), { recursive: true })
      appendFileSync(this.journalFile, JSON.stringify(entry) + '\n', 'utf8')
      // occasional rotation: keep the file bounded
      if (++this.journalAppends % 200 === 0 && existsSync(this.journalFile) && statSync(this.journalFile).size > 300_000) {
        const lines = readFileSync(this.journalFile, 'utf8').trim().split('\n')
        writeFileSync(this.journalFile, lines.slice(-2000).join('\n') + '\n', 'utf8')
      }
    } catch { /* journal is best-effort */ }
  }

  private loadJournal() {
    try {
      if (!existsSync(this.journalFile)) return
      const lines = readFileSync(this.journalFile, 'utf8').trim().split('\n').slice(-600)
      for (const l of lines) {
        try { this.journal.push(JSON.parse(l)) } catch { /* skip bad lines */ }
      }
    } catch { /* noop */ }
  }

  activity(limit = 200): ActivityEntry[] {
    return this.journal.filter(e => { try { return this.read(e.path) !== null } catch { return false } }).slice(-limit).reverse()
  }

  // Writes/removes that must NOT trigger a sync push (used by GitSync.pull)
  quietWrite(relative: string, content: string) {
    this.quiet = true
    try { this.write(relative, content) } finally { this.quiet = false }
  }

  quietRemove(relative: string) {
    this.quiet = true
    try { this.remove(relative) } finally { this.quiet = false }
  }

  allRelFiles(): string[] { return this.allFiles('') }

  // Explicit migration boundary: classify imported plaintext before readers/indexers see it.
  // Existing ciphertext is left untouched, preserving incremental behavior.
  protectExisting(): number {
    if (!this.keys) throw new Error('Memory locked')
    let protectedCount = 0
    for (const rel of this.allFiles('', '', true)) {
      const text = readFileSync(this.path(rel), 'utf8')
      if (text.startsWith('KEEPMIND-ITEM:1\n')) continue
      const item = policy(text)
      if (!allowedSpace(item.space, this.currentSpace, this.grants) || (!this.encryptAll && !restricted(item.class))) continue
      this.migrating = true
      try { this.write(rel, text); protectedCount++ } finally { this.migrating = false }
    }
    return protectedCount
  }

  read(relative: string): string | null {
    const p = this.path(relative)
    if (!existsSync(p)) return null
    let text = readFileSync(p, 'utf8')
    const encrypted = text.startsWith('KEEPMIND-ITEM:1\n')
    if (encrypted) {
      const item = JSON.parse(text.slice('KEEPMIND-ITEM:1\n'.length))
      if (!allowedSpace(item.space, this.currentSpace, this.grants)) return null
      if (!this.keys) throw new Error('Memory locked')
      text = this.keys.decrypt(item.box, item.space, relative)
    }
    const item = policy(text)
    if (!allowedSpace(item.space, this.currentSpace, this.grants)) return null
    if (restricted(item.class) && !encrypted) throw new Error('Unencrypted restricted memory requires migration')
    this.classificationFloor = maxClass(this.classificationFloor, item.class)
    this.readSpaces.add(item.space)
    return text
  }

  remove(relative: string) {
    const p = this.path(relative)
    if (existsSync(p)) {
      if (this.read(relative) === null) throw new Error('Space access denied')
      unlinkSync(p)
      if (!this.quiet) {
        this.onWrite?.(relative)
        this.journalPush('remove', relative)
      }
    }
  }

  // Short-term files older than `days` are candidates for medium-term consolidation
  scopePath(relative: string) { return this.currentSpace === 'personal' || relative.startsWith('spaces/') ? relative : `spaces/${this.currentSpace}/${relative}` }

  shortTermFiles(): string[] { return this.list(this.scopePath('short-term')).sort() }
  mediumTermFiles(): string[] { return this.list(this.scopePath('medium-term')).sort() }
  longTermFiles(): string[] { return this.list(this.scopePath('long-term')).sort() }

  list(dir: string): string[] {
    const p = this.path(dir)
    return existsSync(p) ? readdirSync(p).filter(f => f.endsWith('.md') && this.read(`${dir}/${f}`) !== null) : []
  }

  async syncToGitHub(message: string) {
    const gh = typeof this.gh === 'function' ? this.gh() : this.gh
    if (!gh?.accessToken || !gh.repoOwner) return
    const github = await import('../github')
    // Push a digest of memory state — the repo is the durable backup
    const files = this.allFiles('')
    for (const rel of files.slice(0, 200)) {
      const content = this.read(rel)
      if (content != null) {
        try { await github.pushFile(gh, `memory/${rel}`, content, message) } catch { /* keep going */ }
      }
    }
  }

  countFiles(dir: string): number {
    const p = this.path(dir)
    if (!existsSync(p)) return 0
    let n = 0
    for (const e of readdirSync(p, { withFileTypes: true })) {
      if (e.isDirectory()) n += this.countFiles(join(dir, e.name))
      else if (e.name.endsWith('.md') && this.read(join(dir, e.name)) !== null) n++
    }
    return n
  }

  private allFiles(dir: string, prefix = '', raw = false): string[] {
    const out: string[] = []
    const p = this.path(dir)
    if (!existsSync(p)) return out
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) out.push(...this.allFiles(join(dir, e.name), rel, raw))
      else if (e.name.endsWith('.md') && (raw || this.read(rel) !== null)) out.push(rel)
    }
    return out
  }
}
