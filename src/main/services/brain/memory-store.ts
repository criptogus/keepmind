import { appendFileSync,existsSync,mkdirSync,readdirSync,readFileSync,statSync,unlinkSync,writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveInside } from '../../safe-path'
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
  private journal: ActivityEntry[] = []
  private journalFile: string
  private journalAppends = 0

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
    writeFileSync(p, content, 'utf8')
    if (!this.quiet) {
      this.onWrite?.(relative)
      this.journalPush('write', relative)
    }
  }

  append(relative: string, content: string) {
    const p = this.path(relative)
    mkdirSync(join(p, '..'), { recursive: true })
    appendFileSync(p, content, 'utf8')
    if (!this.quiet) {
      this.onWrite?.(relative)
      this.journalPush('append', relative)
    }
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
    return this.journal.slice(-limit).reverse()
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

  read(relative: string): string | null {
    const p = this.path(relative)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }

  remove(relative: string) {
    const p = this.path(relative)
    if (existsSync(p)) {
      unlinkSync(p)
      if (!this.quiet) {
        this.onWrite?.(relative)
        this.journalPush('remove', relative)
      }
    }
  }

  // Short-term files older than `days` are candidates for medium-term consolidation
  shortTermFiles(): string[] { return this.list('short-term').sort() }
  mediumTermFiles(): string[] { return this.list('medium-term').sort() }
  longTermFiles(): string[] { return this.list('long-term').sort() }

  list(dir: string): string[] {
    const p = this.path(dir)
    return existsSync(p) ? readdirSync(p).filter(f => f.endsWith('.md')) : []
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
      else if (e.name.endsWith('.md')) n++
    }
    return n
  }

  private allFiles(dir: string, prefix = ''): string[] {
    const out: string[] = []
    const p = this.path(dir)
    if (!existsSync(p)) return out
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) out.push(...this.allFiles(join(dir, e.name), rel))
      else if (e.name.endsWith('.md')) out.push(rel)
    }
    return out
  }
}

