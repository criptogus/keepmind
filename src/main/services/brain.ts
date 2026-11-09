import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, appendFileSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { resolveInside } from '../safe-path'
import { chat, chatLive, type ChatMessage, type ToolDefinition } from './llm'
import type { AiProviderConfig } from '../store'
import type { McpManager } from './mcp'
import type { LocalLlm } from './local-llm'
import type { AgentPersona } from '../store'
import * as github from './github'
import type { GitHubConfig, Store } from '../store'
import type { GitSync } from './sync'
import type { RagService } from './rag'
import type { LayaService } from './laya'
import { refreshEntities } from './entities'
import { SECRET_PATTERNS } from './redact'
import { evolutionHints, listVaultSkills, loadSakNotes, loadSkillThreats } from './skillsHub'
import { acceptProposal, activeForPrompt, addActive, addProposal, compactLegacy, discardProposal, factById, factsAsOf, monthLabel, parseAsOf, proposalsOf, readFacts, type FactOrigin } from './facts'
import { addEvalQuestion, readEval, scoreEval } from './evalset'

// Long-term files are append-only, so the durable signal is at the end.
// Reading the head drops everything the brain just learned.
function tail(text: string, max: number): string {
  if (text.length <= max) return text
  return `…\n${text.slice(-max)}`
}

export interface LedgerEntry {
  ts: number
  verb: 'processed' | 'discovered' | 'improved' | 'needs-you'
  sentence: string
  path?: string
}

export interface ChatResult {
  text: string
  memories: string[]
  saved: string[]
  steps: string[]
}

export interface JobEvent {
  phase: 'start' | 'done' | 'error'
  name: string
  summary?: string
}

// ── Memory: markdown files in the local memory dir, mirrored to the GitHub repo ──

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
  // Live hook — fired on every journaled change so the UI can react in real time
  onJournal: ((entry: ActivityEntry) => void) | null = null
  private quiet = false
  private journal: ActivityEntry[] = []
  private journalFile: string
  private journalAppends = 0

  constructor(private dir: string, private gh: GitHubConfig | null) {
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
  private journalPush(op: ActivityEntry['op'], rel: string, source = this.activitySource) {
    const entry: ActivityEntry = { ts: Date.now(), op, path: rel, source }
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
    try { this.onJournal?.(entry) } catch { /* noop */ }
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

  // Local-only jsonl under ops/ (extension is not synced to GitHub).
  appendJsonl(name: string, obj: unknown) {
    try {
      mkdirSync(join(this.dir, 'ops'), { recursive: true })
      appendFileSync(join(this.dir, 'ops', name), JSON.stringify(obj) + '\n', 'utf8')
    } catch { /* best-effort */ }
  }

  readJsonl(name: string, limit = 40): unknown[] {
    try {
      const file = join(this.dir, 'ops', name)
      if (!existsSync(file)) return []
      const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).slice(-limit)
      const out: unknown[] = []
      for (const line of lines) {
        try { out.push(JSON.parse(line)) } catch { /* skip */ }
      }
      return out.reverse()
    } catch { return [] }
  }

  readOpsJson<T>(name: string, fallback: T): T {
    try {
      const file = join(this.dir, 'ops', name)
      if (!existsSync(file)) return fallback
      return JSON.parse(readFileSync(file, 'utf8')) as T
    } catch { return fallback }
  }

  writeOpsJson(name: string, data: unknown) {
    try {
      mkdirSync(join(this.dir, 'ops'), { recursive: true })
      writeFileSync(join(this.dir, 'ops', name), JSON.stringify(data), 'utf8')
    } catch { /* best-effort */ }
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

  // Remote-originated changes (GitSync pull): journaled so Activity shows
  // WHO/WHAT synced in — but never re-dirtied for push (already on GitHub).
  syncWrite(relative: string, content: string) {
    const p = this.path(relative)
    // skip no-op pulls — identical content doesn't churn the journal
    if (existsSync(p) && readFileSync(p, 'utf8') === content) return
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, content, 'utf8')
    this.journalPush('write', relative, 'sync')
  }

  syncRemove(relative: string) {
    const p = this.path(relative)
    if (existsSync(p)) {
      unlinkSync(p)
      this.journalPush('remove', relative, 'sync')
    }
  }

  allRelFiles(): string[] { return this.allFiles('') }

  read(relative: string): string | null {
    const p = this.path(relative)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }

  fileMtime(relative: string): number | null {
    try {
      const p = this.path(relative)
      return existsSync(p) ? statSync(p).mtimeMs : null
    } catch { return null }
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
    if (!this.gh?.accessToken || !this.gh.repoOwner) return
    // Push a digest of memory state — the repo is the durable backup
    const files = this.allFiles('')
    for (const rel of files.slice(0, 200)) {
      const content = this.read(rel)
      if (content != null) {
        try { await github.pushFile(this.gh, `memory/${rel}`, content, message) } catch { /* keep going */ }
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

// ── Brain: orchestrates chat, tools, memory and insights ──

export class Brain {
  private memory: Memory
  private store: Store
  private mcp: McpManager | null = null
  private localLlm: LocalLlm | null = null
  private gitSync: GitSync | null = null
  private rag: RagService | null = null
  private laya: LayaService | null = null

  constructor(store: Store, mcp: McpManager | null, localLlm: LocalLlm | null = null) {
    this.store = store
    this.mcp = mcp
    this.localLlm = localLlm
    this.memory = new Memory(store.memoryDir, store.get().github.accessToken ? store.get().github : null)
  }

  setMcp(mcp: McpManager) { this.mcp = mcp }
  setLocalLlm(l: LocalLlm) { this.localLlm = l }

  // Lazily ensure the bundled local model server is up before LLM calls.
  // The app auto-starts it at launch, but the server can crash or the app
  // may have started before the model finished downloading — without this,
  // nightly crons would silently fail on the 'local' provider.
  async ensureProviderReady(): Promise<void> {
    const cfg = this.store.get()
    if (cfg.ai.provider !== 'local' || !this.localLlm) return
    try {
      await this.localLlm.ensureRunning(cfg.localLlm.modelId)
    } catch (e) {
      console.warn('[brain] local provider not ready:', e)
    }
  }

  attachSync(sync: GitSync) {
    this.gitSync = sync
    this.memory.onWrite = (rel) => sync.markDirty(rel)
  }
  setRag(rag: RagService) { this.rag = rag }
  setLaya(l: LayaService) { this.laya = l }
  onJob: ((event: JobEvent) => void) | null = null
  private turnSaved: string[] = []
  private quarantined = false

  setQuarantine(on: boolean) { this.quarantined = on }

  getMemory() { return this.memory }

  note(verb: LedgerEntry['verb'], sentence: string, path?: string) {
    const entry: LedgerEntry = { ts: Date.now(), verb, sentence, path }
    this.memory.appendJsonl('ledger.jsonl', entry)
  }

  ledger(limit = 40): LedgerEntry[] {
    return this.memory.readJsonl('ledger.jsonl', limit) as LedgerEntry[]
  }

  private emitJob(event: JobEvent) {
    try { this.onJob?.(event) } catch { /* renderer gone */ }
  }
  setActivitySource(src: string) { this.memory.activitySource = src }

  private buildSystemContext(agent: AgentPersona, recall = ''): string {
    const cfg = this.store.get()
    const parts: string[] = [
      agent.persona,
      '',
      '## Connected sources',
      `- GitHub memory repo: ${cfg.github.repoUrl ?? 'not connected'}`,
      `- AI provider: ${cfg.ai.provider} (${cfg.ai.model ?? 'default'})`,
      `- MCP servers running: ${this.mcp?.runningServers.join(', ') || 'none'}`
    ]
    // ── Tiered memory context (like human memory) ──
    // Long-term: durable facts, lessons and skills — always injected.
    const facts = activeForPrompt(this.memory.read('long-term/facts.md') ?? '')
    if (facts) parts.push('', '## Long-term memory — facts & preferences', tail(facts, 3000))
    const skills = this.memory.read('long-term/skills.md')
    if (skills) parts.push('', '## Learned skills (from nightly sleep cycles)', tail(skills, 2500))
    const lessons = this.memory.read('long-term/lessons.md')
    if (lessons) parts.push('', '## Lessons learned', tail(lessons, 2000))
    const policy = this.memory.read('ops/policy.md')
    const activePolicy = (policy?.split('## Propostas')[0]?.split('## Ativo')[1] ?? '').trim()
    if (activePolicy && !/Sem instruções extras ainda/.test(activePolicy)) {
      parts.push('', '## Active brain policy (follow this)', tail(activePolicy, 1500))
    }
    // Medium-term: recent weekly consolidations.
    const medium = this.memory.mediumTermFiles().slice(-2)
    for (const f of medium) {
      const c = this.memory.read(`medium-term/${f}`)
      if (c) parts.push('', `### ${f}`, c.slice(0, 1500))
    }
    // Short-term: today's + yesterday's raw logs.
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
    for (const d of [yesterday, today]) {
      const c = this.memory.read(`short-term/${d}.md`) ?? this.memory.read(`inbox/${d}.md`)
      if (c) parts.push('', `## Short-term memory — ${d}`, c.slice(-4000))
    }
    const insights = this.memory.list('insights').slice(-5)
    for (const f of insights) {
      const c = this.memory.read(`insights/${f}`)
      if (c) parts.push('', `### ${f}`, c.slice(0, 1200))
    }
    // Semantic recall (local embeddings) — memories related to this message
    if (recall) parts.push('', '## Relevant memories (semantic search)', recall)
    return parts.join('\n')
  }

  private toolDefinitions(): ToolDefinition[] {
    const tools: ToolDefinition[] = [
      {
        name: 'save_memory',
        description: 'Save an important note/fact/insight to the user\'s long-term memory (stored in their GitHub repo).',
        parameters: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } }, required: ['title', 'content'] }
      },
      {
        name: 'get_memory',
        description: 'Read a memory file by path (e.g. inbox/digest.md, insights/2026-11-05.md).',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
      },
      {
        name: 'list_tasks',
        description: 'List open tasks from the planner (tasks/ dir) with id, title, due date and priority. Optionally filter by status.',
        parameters: { type: 'object', properties: { status: { type: 'string', description: 'open (default) or done or all' } } }
      },
      {
        name: 'add_task',
        description: 'Create a task in the planner. Returns the task id.',
        parameters: { type: 'object', properties: {
          title: { type: 'string' },
          due: { type: 'string', description: 'YYYY-MM-DD' },
          priority: { type: 'string', description: 'low|normal|high' }
        }, required: ['title'] }
      },
      {
        name: 'complete_task',
        description: 'Mark a task as done by id or title fragment.',
        parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
      }
    ]
    if (this.mcp) {
      for (const { serverId, tool } of this.mcp.allTools()) {
        tools.push({
          name: `mcp_${serverId}_${tool.name}`,
          description: `[${serverId}] ${tool.description}`,
          parameters: tool.inputSchema
        })
      }
    }
    return tools
  }

  private async execTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (name === 'save_memory') {
      const title = String(args.title ?? 'note')
      const content = String(args.content ?? '')
      // Laya fast decision: which long-term bucket does this belong to?
      // ~33ms local ONNX — no LLM round-trip for a routing decision.
      let kind = 'note'
      const verdict = await this.laya?.choose(
        `${title}\n\n${content.slice(0, 1500)}`,
        'What kind of long-term memory is this?',
        {
          fact: 'a durable fact, preference, or piece of knowledge about the user or their work',
          lesson: 'a lesson learned — something that went wrong and what to do differently',
          skill: 'a reusable procedure or skill — "how we do X"',
          decision: 'a decision that was made and its rationale',
          note: 'anything else worth keeping'
        }
      ).catch(() => null)
      if (verdict && verdict.confidence > 0.4) kind = verdict.choice
      if (kind === 'fact' || this.quarantined) {
        const origin: FactOrigin = this.quarantined ? 'webhook' : 'chat'
        const saved = this.proposeFact(`${title}\n\n${content}`.trim(), origin, kind === 'fact' ? 'conversa' : `conversa · ${kind}`)
        this.turnSaved.push('long-term/facts.md')
        return `Proposta ${saved} em long-term/facts.md. Ela só entra na memória ativa depois do aceite em Hoje.`
      }
      const file = kind === 'note'
        ? `long-term/notes/${slug(title)}.md`
        : `long-term/${kind}s.md` // lessons.md / skills.md / decisions.md
      this.memory.append(file, `\n\n## ${title}\n\n${content}\n`)
      this.turnSaved.push(file)
      return `Saved to memory/${file} (long-term · classified as ${kind})`
    }
    if (name === 'get_memory') {
      const c = this.memory.read(String(args.path ?? ''))
      return c ?? 'Not found'
    }
    if (name === 'list_tasks') {
      const status = String(args.status ?? 'open').toLowerCase()
      const tasks = this.readTasks().filter(t => status === 'all' || t.status === status)
      if (!tasks.length) return status === 'open' ? 'No open tasks.' : `No ${status} tasks.`
      return tasks.map(t =>
        `- [${t.status === 'done' ? 'x' : ' '}] ${t.id} · ${t.title}${t.due ? ` · due ${t.due}` : ''}${t.priority !== 'normal' ? ` · ${t.priority}` : ''}`
      ).join('\n')
    }
    if (name === 'add_task') {
      const title = String(args.title ?? '').trim()
      if (!title) return 'Task title required'
      const id = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${slug(title)}-${Math.random().toString(36).slice(2, 6)}`
      const priority = ['low', 'normal', 'high'].includes(String(args.priority)) ? String(args.priority) : 'normal'
      const due = /^\d{4}-\d{2}-\d{2}$/.test(String(args.due ?? '')) ? String(args.due) : ''
      this.memory.write(`tasks/${id}.md`,
        `# ${title}\n> status: open · priority: ${priority}${due ? ` · due: ${due}` : ''} · created: ${new Date().toISOString()}\n\n`)
      return `Task created: ${id} — "${title}"${due ? ` (due ${due})` : ''}`
    }
    if (name === 'complete_task') {
      const want = String(args.id ?? '').toLowerCase()
      const task = this.readTasks().find(t => t.id === want || t.title.toLowerCase().includes(want))
      if (!task) return `No task matching "${args.id}"`
      const p = `tasks/${task.file}`
      const c = this.memory.read(p) ?? ''
      this.memory.write(p, c.replace(/status:\s*open/i, 'status: done'))
      return `Completed: ${task.title}`
    }
    // MCP tool routing: mcp_<serverId>_<toolName>
    if (name.startsWith('mcp_') && this.mcp) {
      const rest = name.slice(4)
      const serverId = rest.split('_')[0]
      const toolName = rest.slice(serverId.length + 1)
      return this.mcp.callTool(serverId, toolName, args)
    }
    return `Unknown tool: ${name}`
  }

  private recentTurns(maxPairs = 6): ChatMessage[] {
    const today = new Date().toISOString().slice(0, 10)
    const raw = this.memory.read(`short-term/${today}.md`) ?? ''
    const chunks = raw.split(/\n## /).slice(-maxPairs)
    const msgs: ChatMessage[] = []
    for (const chunk of chunks) {
      const m = chunk.match(/\*\*You:\*\*\s*([\s\S]*?)\n\n\*\*[^*]+:\*\*\s*([\s\S]*)$/)
      if (!m) continue
      const user = m[1].trim().slice(0, 2000)
      const assistant = m[2].trim().slice(0, 2000)
      if (!user || !assistant) continue
      msgs.push({ role: 'user', content: user }, { role: 'assistant', content: assistant })
    }
    return msgs
  }

  async chat(agentId: string, userMessage: string, onDelta?: (t: string) => void, onStep?: (step: string) => void): Promise<ChatResult> {
    this.turnSaved = []
    const steps: string[] = []
    const step = (s: string) => { steps.push(s); onStep?.(s) }
    try {
      await this.ensureProviderReady()
      step('Lendo a memória mais recente do repositório.')
      await this.gitSync?.pullIfDue().catch(() => {})
      const recall = await this.rag?.search(userMessage).catch(() => '') ?? ''
      const memories = [...new Set([...recall.matchAll(/^###\s+(\S+)/gm)].map(m => m[1].replace(/\s.*/, '')))]
      if (memories.length) step(`Encontrei ${memories.length} memória(s): ${memories.slice(0, 4).join(', ')}.`)
      else step('Nenhuma memória semântica para esta pergunta.')
      const cfg = this.store.get()
      const agent = cfg.agents.find(a => a.id === agentId) ?? cfg.agents[0]
      const messages: ChatMessage[] = [
        { role: 'system', content: this.buildSystemContext(agent, recall) },
        ...this.recentTurns(),
        { role: 'user', content: userMessage }
      ]
      const tools = this.toolDefinitions()

      let finalText = ''
      for (let round = 0; round < 6; round++) {
        const res = await chatLive(cfg.ai as AiProviderConfig, messages, tools, (t) => {
          onDelta?.(t)
        }, this.localLlm?.endpoint)
        finalText = res.text
        if (!res.toolCalls?.length) break
        messages.push({ role: 'assistant', content: res.text || '(tool calls)' })
        for (const tc of res.toolCalls) {
          step(`Usei a ferramenta ${tc.name}.`)
          const result = await this.execTool(tc.name, tc.arguments)
          messages.push({ role: 'tool', name: tc.name, content: result })
        }
      }

      const day = new Date().toISOString().slice(0, 10)
      const rel = `short-term/${day}.md`
      this.memory.append(rel, `\n\n## ${new Date().toLocaleTimeString()} — ${agent.name}\n\n**You:** ${userMessage}\n\n**${agent.name}:** ${finalText}\n`)
      const saved = [...this.turnSaved]
      if (saved.length) this.note('discovered', `A conversa guardou ${saved.length} item(ns) na memória longa.`, saved[0])
      else this.note('processed', 'A conversa foi registrada no log de hoje.', rel)
      const result: ChatResult = { text: finalText, memories, saved, steps }
      return result
    } catch (e) {
      throw e
    }
  }

  async streamChat(agentId: string, userMessage: string): Promise<ChatResult> {
    return this.chat(agentId, userMessage)
  }

  // Recently touched vault notes across ALL directories — imported Obsidian
  // vaults keep content outside the KeepMind-native dirs, so insights and
  // summaries must look at real file activity, not just tasks/notes/.
  private recentVaultNotes(days = 14, cap = 200) {
    const cutoff = Date.now() - days * 864e5
    const recent: { path: string; title: string; dir: string; mtime: number }[] = []
    for (const f of this.memory.allRelFiles()) {
      if (!f.endsWith('.md')) continue
      if (f.split('/').slice(0, -1).some(s => s.startsWith('.'))) continue
      const mt = this.memory.fileMtime(f)
      if (mt == null || mt < cutoff) continue
      recent.push({ path: f, title: '', dir: f.split('/')[0] ?? '', mtime: mt })
    }
    recent.sort((a, b) => b.mtime - a.mtime)
    for (const n of recent.slice(0, cap)) {
      const c = this.memory.read(n.path)
      n.title = c?.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? n.path.split('/').pop()!.replace(/\.md$/, '')
    }
    return recent.slice(0, cap)
  }

  // Deterministic insight engine — no LLM tokens. Surfaces real signals:
  // overdue/due tasks, stale notes, search gaps, pending approvals,
  // activity stats. Facts beat hallucinated fluff for a memory product.
  private scriptedInsights(): string[] {
    const today = new Date().toISOString().slice(0, 10)
    const lines: string[] = []

    // tasks: parse meta lines for due dates
    const open: { title: string; due?: string; priority?: string }[] = []
    for (const f of this.memory.list('tasks')) {
      const c = this.memory.read(`tasks/${f}`) ?? ''
      const title = c.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? f.replace('.md', '')
      const meta = c.match(/^>\s*(.+)$/m)?.[1] ?? ''
      if (/status:\s*done/i.test(meta)) continue
      const due = meta.match(/due:\s*(\d{4}-\d{2}-\d{2})/)?.[1]
      const priority = meta.match(/priority:\s*(\w+)/i)?.[1]?.toLowerCase()
      open.push({ title, due, priority })
    }
    const overdue = open.filter(t => t.due && t.due < today)
    const dueToday = open.filter(t => t.due === today)
    if (overdue.length) lines.push(`⏰ ${overdue.length} task(s) overdue — oldest: "${overdue.sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))[0].title}"`)
    if (dueToday.length) lines.push(`📌 ${dueToday.length} task(s) due today`)
    const highOpen = open.filter(t => t.priority === 'high' && (!t.due || t.due >= today))
    if (highOpen.length) lines.push(`🔥 ${highOpen.length} high-priority task(s) still open`)

    // stale notes (frontmatter validity dates already used by RAG)
    let stale = 0
    for (const dir of ['notes', 'entities']) {
      for (const f of this.memory.list(dir)) {
        const c = this.memory.read(`${dir}/${f}`) ?? ''
        const fm = c.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
        const exp = fm.match(/(?:valido_ate|expires|review_after|stale_after|valid_until):\s*['"]?(\d{4}-\d{2}-\d{2})/i)?.[1]
        if (exp && exp < today) stale++
      }
    }
    if (stale) lines.push(`🕸️ ${stale} note(s) past their validity date — candidates for review or refresh`)

    // search gaps — unanswered queries the brain should learn
    const gaps = this.memory.read('ops/search-gaps.md') ?? ''
    const gapCount = (gaps.match(/^- /gm) ?? []).length
    if (gapCount) lines.push(`🔍 ${gapCount} unanswered search(es) logged — the gap-review automation can fill them`)

    // pending approvals
    const pending = this.store.get().pendingApprovals.length
    if (pending) lines.push(`⏳ ${pending} automation(s) waiting for your approval`)

    // activity today
    const act = this.memory.activity(500).filter(e => new Date(e.ts).toISOString().slice(0, 10) === today)
    if (act.length) {
      const byOp = act.reduce<Record<string, number>>((m, e) => ({ ...m, [e.op]: (m[e.op] ?? 0) + 1 }), {})
      lines.push(`✍️ ${act.length} memory change(s) today (${Object.entries(byOp).map(([k, v]) => `${v} ${k}`).join(', ')})`)
    }

    // entity graph size
    const entities = this.memory.list('entities').length
    if (entities) lines.push(`🕸️ Knowledge graph: ${entities} entity page(s) with backlinks`)

    // vault pulse — real activity across the whole imported brain
    const recent = this.recentVaultNotes(14)
    if (recent.length) {
      const byDir = recent.reduce<Record<string, number>>((m, n) => ({ ...m, [n.dir]: (m[n.dir] ?? 0) + 1 }), {})
      const topDirs = Object.entries(byDir).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d, c]) => `${d} (${c})`).join(', ')
      lines.push(`📡 ${recent.length} note(s) touched in the last 14 days — hottest areas: ${topDirs}`)
      const hot = recent.slice(0, 3).map(n => `"${n.title}"`).join(' · ')
      lines.push(`🧠 Most recent: ${hot}`)
    } else {
      const total = this.memory.allRelFiles().filter(f => f.endsWith('.md')).length
      if (total > 50) lines.push(`🗂️ Vault holds ${total} notes — no edits in the last 2 weeks`)
    }

    if (!lines.length) lines.push('🌱 Quiet day — no urgent signals. The brain kept consolidating in the background.')
    return lines.slice(0, 6)
  }

  async generateInsights(): Promise<string[]> {
    const lines = this.scriptedInsights()
    const day = new Date().toISOString().slice(0, 10)
    this.memory.write(`insights/${day}.md`, `# Insights — ${day}\n\n${lines.map(l => `- ${l}`).join('\n')}\n`)
    return lines
  }

  // Deterministic daily summary — counts, due items, carry-over. No LLM.
  async dailySummary(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10)
    const today = this.memory.read(`short-term/${day}.md`) ?? this.memory.read(`inbox/${day}.md`) ?? ''
    const sections = (today.match(/^##\s+.+$/gm) ?? []).length
    const bullets = (today.match(/^[-*]\s+/gm) ?? []).length

    const out = [`# Daily summary — ${day}`, '']
    if (today.trim()) {
      out.push(`- Captured ${sections} section(s), ${bullets} bullet(s) of activity`)
      const heads = [...today.matchAll(/^#{2,3}\s+(.+)$/gm)].map(m => m[1].trim()).slice(0, 5)
      if (heads.length) out.push(`- Topics: ${heads.join(' · ')}`)
    } else {
      out.push('- No short-term captures today')
    }

    // open loops: tasks due soonest
    const open: { title: string; due?: string; priority?: string }[] = []
    for (const f of this.memory.list('tasks')) {
      const c = this.memory.read(`tasks/${f}`) ?? ''
      const meta = c.match(/^>\s*(.+)$/m)?.[1] ?? ''
      if (/status:\s*done/i.test(meta)) continue
      open.push({
        title: c.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? f.replace('.md', ''),
        due: meta.match(/due:\s*(\d{4}-\d{2}-\d{2})/)?.[1],
        priority: meta.match(/priority:\s*(\w+)/i)?.[1]?.toLowerCase()
      })
    }
    const next = open.filter(t => !t.due || t.due >= day).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999')).slice(0, 3)
    if (next.length) out.push(`- Next up: ${next.map(t => `"${t.title}"${t.due ? ` (${t.due})` : ''}`).join(' · ')}`)
    const overdue = open.filter(t => t.due && t.due < day).length
    if (overdue) out.push(`- ⚠️ ${overdue} overdue task(s) still open`)

    const pending = this.store.get().pendingApprovals.length
    if (pending) out.push(`- ⏳ ${pending} automation(s) awaiting approval`)

    // vault pulse — activity across the whole imported brain, not just captures
    const recent = this.recentVaultNotes(7, 60)
    if (recent.length) {
      const todayCount = recent.filter(n => new Date(n.mtime).toISOString().slice(0, 10) === day).length
      const weekCount = recent.length
      out.push(`- Vault pulse: ${todayCount} note(s) touched today · ${weekCount} in the last 7 days`)
      const hot = recent.slice(0, 3).map(n => `"${n.title}"`).join(' · ')
      out.push(`- Recently active: ${hot}`)
    }

    const focus = next.find(t => t.priority === 'high') ?? next[0]
    out.push('', focus ? `**Suggested focus:** "${focus.title}"${focus.due ? ` — due ${focus.due}` : ''}.` : '**Suggested focus:** review open tasks in the planner.')

    const text = out.join('\n') + '\n'
    this.memory.write(`summaries/${day}.md`, text)
    this.note('processed', `Resumo de ${day} pronto.`, `summaries/${day}.md`)
    return text
  }

  // AI briefing for the Today screen — the LLM reads the user's actual state
  // (goals, open tasks, recent vault activity, latest insight) and writes a
  // personalized digest. Cached per day in summaries/ so it syncs and costs
  // tokens once. Pass force=true to regenerate.
  async briefing(force = false): Promise<string> {
    const day = new Date().toISOString().slice(0, 10)
    const cachePath = `summaries/briefing-${day}.md`
    const cached = this.memory.read(cachePath)
    if (cached?.trim() && !force) return cached

    const goalsRaw = this.memory.read(`daily/${day}.md`) ?? ''
    const goals = goalsRaw.replace(/^#\s*Goals.*$/m, '').replace(/_No goals yet\._/, '').trim()
    const openTasks = this.readTasks().filter(t => t.status === 'open')
    const tasksTxt = openTasks.slice(0, 15)
      .map(t => `- ${t.title}${t.due ? ` (due ${t.due})` : ''}${t.priority !== 'normal' ? ` [${t.priority}]` : ''}`).join('\n') || '(none)'
    const overdue = openTasks.filter(t => t.due && t.due < day).length
    const recent = this.recentVaultNotes(10, 12)
      .map(n => `- ${n.title} — ${n.dir}/`).join('\n') || '(no recent edits)'
    const insightFile = this.memory.list('insights').sort().pop()
    const insight = insightFile ? (this.memory.read(`insights/${insightFile}`) ?? '').slice(0, 1500) : '(none yet)'
    const vaultTotal = this.memory.allRelFiles().filter(f => f.endsWith('.md')).length

    const context = [
      `Today: ${day}`,
      `Vault size: ${vaultTotal} notes`,
      goals ? `## Today's goals\n${goals}` : '## Today\'s goals\n(none set — suggest some)',
      `## Open tasks (${openTasks.length}${overdue ? `, ${overdue} overdue` : ''})\n${tasksTxt}`,
      `## Recently active notes\n${recent}`,
      `## Latest insight report\n${insight}`
    ].join('\n\n')

    const res = await chat(this.store.get().ai as AiProviderConfig, [
      {
        role: 'system',
        content: `You are KeepMind — the user's persistent second brain. Write their daily briefing. Rules:
- Warm, direct, concise. The user's language.
- Structure: 2-3 sentence orientation → "Today" (what matters now: overdue/due tasks, goals) → "From your vault" (what recent notes suggest — themes, loose threads, things worth revisiting) → one concrete suggested focus.
- Ground EVERYTHING in the provided data — never invent tasks, notes or facts. If data is thin, say so briefly.
- Markdown, max ~250 words. No preamble.`
      },
      { role: 'user', content: context }
    ], [], this.localLlm?.endpoint)

    const text = `# Briefing — ${day}\n\n${res.text}\n`
    this.memory.write(cachePath, text)
    this.note('processed', `Briefing de ${day} escrito.`, cachePath)
    return text
  }

  // ── Sleep mode: nightly learning cycle ──
  // 1) Reads recent short-term memory + insights
  // 2) Answers the 5 learning questions and writes a sleep report
  // 3) Extracts durable facts / lessons / skills into long-term memory
  // 4) Consolidates old short-term logs into medium-term weekly files
  // 5) Syncs everything to the GitHub repo

  private recentCorpus(maxChars = 20000): string {
    const parts: string[] = []
    const short = this.memory.shortTermFiles().slice(-10)
    for (const f of short) {
      const c = this.memory.read(`short-term/${f}`)
      if (c) parts.push(`### ${f}\n${c}`)
    }
    // legacy inbox fallback
    for (const f of this.memory.list('inbox').slice(-5)) {
      const c = this.memory.read(`inbox/${f}`)
      if (c) parts.push(`### inbox/${f}\n${c}`)
    }
    const insights = this.memory.list('insights').slice(-5)
    for (const f of insights) {
      const c = this.memory.read(`insights/${f}`)
      if (c) parts.push(`### ${f}\n${c}`)
    }
    // knowledge gaps: searches that returned nothing (logged by MCP/RAG clients)
    const gaps = this.memory.read('ops/search-gaps.md')
    if (gaps) parts.push(`### ops/search-gaps.md (unanswered queries)\n${gaps.slice(-3000)}`)
    const corpus = parts.join('\n\n').slice(-maxChars)
    return corpus
  }

  async sleep(): Promise<{ report: string; consolidated: number; summary: string }> {
    const cfg = this.store.get()
    const day = new Date().toISOString().slice(0, 10)
    const corpus = this.recentCorpus()

    if (!corpus.trim()) {
      const report = `# Sleep cycle — ${day}\n\nNo memory activity to process yet. The brain sleeps peacefully. 💤\n`
      this.memory.write(`sleep/${day}.md`, report)
      const summary = `Sono de ${day}: nada novo para consolidar.`
      this.note('processed', summary, `sleep/${day}.md`)
      return { report, consolidated: 0, summary }
    }

    // 1) Nightly learning — the 5 questions
    const res = await chat(cfg.ai as AiProviderConfig, [
      {
        role: 'system',
        content: `You are the nightly learning cycle of a personal second brain. Review the day's memory below and answer these five questions honestly and concretely:

1. What are we doing that IS WORKING? (double down on these)
2. What IS working but could be IMPROVED?
3. What is NOT working that we need to get BETTER at?
4. What is NOT working that we need to STOP doing entirely?
5. What are we NOT doing that we NEED to START doing?

Rules:
- Ground every point in actual evidence from the memory. No generic advice.
- Be specific: name the activity, the person/project/context, and the concrete next step.
- Write in the user's language, markdown, sections per question with "### 1. Working" ... "### 5. Start".
- End with "### Tonight's commitments" — 3 max concrete actions for tomorrow.`
      },
      { role: 'user', content: `Memory to review:\n\n${corpus}` }
    ], [], this.localLlm?.endpoint)

    const report = `# Sleep cycle — ${day}\n\n_Generated ${new Date().toISOString()}_\n\n${res.text}\n`
    this.memory.write(`sleep/${day}.md`, report)

    // 2) Extract durable learnings → long-term memory (facts / lessons / skills)
    try {
      const learn = await chat(cfg.ai as AiProviderConfig, [
        {
          role: 'system',
          content: `You consolidate a second brain's nightly learning into durable memory. From the sleep report below, extract THREE sections using EXACT markers:

===FACTS===
(durable facts, preferences, decisions, people, projects worth remembering forever — append-only bullet lines, no dates needed)

===LESSONS===
(mistakes and corrections worth never repeating — what failed and why)

===SKILLS===
(repeatable workflows/processes that worked and should be reused — "how we do X well")

Only include genuinely durable items. Skip anything ephemeral. If a section is empty write "(none)". Write in the user's language.`
        },
        { role: 'user', content: report.slice(0, 16000) }
      ], [], this.localLlm?.endpoint)

      const grab = (marker: string, next: string) => {
        const m = learn.text.match(new RegExp(`${marker}([\\s\\S]*?)(?:${next}|$)`))
        return m?.[1]?.trim() ?? ''
      }
      const appendIf = async (file: string, section: string, body: string) => {
        const clean = body.split('\n').filter(l => l.trim() && l.trim() !== '(none)').join('\n')
        if (!clean) return
        // Laya semantic dedup: skip sections already captured in long-term
        const existing = this.memory.read(`long-term/${file}`) ?? ''
        if (await this.isSemanticDuplicate(clean, existing)) {
          console.log(`[brain] sleep: skipped duplicate ${file} section`)
          return
        }
        this.memory.append(`long-term/${file}`, `\n\n## ${day}\n\n${clean}\n`)
      }
      const factLines = grab('===FACTS===', '===LESSONS===')
        .split('\n')
        .map(l => l.replace(/^[-*•]\s*/, '').trim())
        .filter(l => l && l !== '(none)')
      let proposed = 0
      for (const line of factLines) {
        if (this.proposeFact(line, 'sleep', 'sono', false)) proposed++
      }
      if (proposed) this.note('needs-you', `${proposed} fato(s) do sono esperam você em Hoje.`, 'long-term/facts.md')
      await appendIf('lessons.md', '', grab('===LESSONS===', '===SKILLS==='))
      await appendIf('skills.md', '', grab('===SKILLS===', '$'))
    } catch (e) {
      console.warn('[brain] sleep: long-term extraction failed:', e)
    }

    // 3) Generate spaced-repetition flashcards from durable learnings
    try {
      const n = await this.generateFlashcards()
      if (n) console.log(`[brain] sleep: ${n} flashcard(s) added`)
    } catch (e) {
      console.warn('[brain] flashcard generation failed:', e)
    }

    // 4) Consolidate short-term logs older than 7 days into medium-term weekly files
    const consolidated = await this.consolidateShortTerm()

    // 4) Refresh the entity layer (knowledge graph in Markdown)
    try {
      const r = await refreshEntities(this.memory, this.entityCompleter())
      console.log(`[brain] entities refreshed: ${r.created} new, ${r.updated} updated, ${r.total} total`)
    } catch (e) {
      console.warn('[brain] entity refresh failed:', e)
    }

    // 5) Sync to GitHub — GitSync pushes dirty paths + pulls remote changes
    try {
      if (this.gitSync) await this.gitSync.syncNow()
      else await this.memory.syncToGitHub(`sleep cycle ${day}`)
    } catch { /* offline ok */ }

    // 6) Re-embed: the night just wrote facts/lessons/entities — make them
    //    semantically searchable immediately instead of waiting for lazy scan
    void this.rag?.reindex().catch(() => {})

    this.harvestGapQuestions()
    const scored = this.scoreQuestions(day)
    const summary = scored.total
      ? `Sono de ${day}: consolidou ${consolidated} log(s). Placar da avaliação: ${scored.hit} de ${scored.total}.`
      : `Sono de ${day}: consolidou ${consolidated} log(s) e gravou o relatório.`
    this.note('processed', summary, `sleep/${day}.md`)
    return { report: res.text, consolidated, summary }
  }

  private async consolidateShortTerm(): Promise<number> {
    const cutoff = Date.now() - 7 * 864e5
    const old = this.memory.shortTermFiles().filter(f => {
      const t = Date.parse(`${f.replace('.md', '')}T00:00:00Z`)
      return !isNaN(t) && t < cutoff
    })
    if (!old.length) return 0

    // group by ISO week
    const weeks = new Map<string, string[]>()
    for (const f of old) {
      const d = new Date(`${f.replace('.md', '')}T00:00:00Z`)
      const week = isoWeek(d)
      if (!weeks.has(week)) weeks.set(week, [])
      weeks.get(week)!.push(f)
    }

    let consolidated = 0
    for (const [week, files] of weeks) {
      const target = `medium-term/${week}.md`
      const existingWeek = this.memory.read(target)
      if (existingWeek) {
        // A previous pass already opened this week. Append days that are
        // not in the file yet — never delete a log that was not copied.
        const fresh = files.filter(f => !existingWeek.includes(`## ${f.replace('.md', '')}`))
        if (fresh.length) {
          const extra = fresh.map(f => {
            const day = f.replace('.md', '')
            const content = this.memory.read(`short-term/${f}`) ?? ''
            return `## ${day}\n\n${content.trim()}`
          })
          this.memory.append(target, `\n\n${extra.join('\n\n')}\n`)
        }
        for (const f of files) {
          const day = f.replace('.md', '')
          const merged = (this.memory.read(target) ?? '').includes(`## ${day}`)
          if (merged) this.memory.remove(`short-term/${f}`)
        }
        consolidated += files.length
        continue
      }
      // Scripted consolidation — lossless per-day digest, zero LLM tokens.
      // Medium-term memory keeps every capture organized by date; the RAG
      // index handles retrieval, so compression would only lose information.
      const parts = files.map(f => {
        const day = f.replace('.md', '')
        const content = this.memory.read(`short-term/${f}`) ?? ''
        const stats = `${(content.match(/^##\s+/gm) ?? []).length} sections · ${(content.match(/^[-*]\s+/gm) ?? []).length} bullets · ${content.length} chars`
        return `## ${day}\n\n_${stats}_\n\n${content.trim()}`
      })
      this.memory.write(target, `# Week ${week}\n\n${parts.join('\n\n')}\n`)
      for (const f of files) this.memory.remove(`short-term/${f}`)
      consolidated += files.length
    }
    return consolidated
  }

  // Single-shot LLM completion used by the entity layer (descriptions).
  private entityCompleter(): (prompt: string) => Promise<string> {
    return async (prompt: string) => {
      const cfg = this.store.get()
      const res = await chat(cfg.ai as AiProviderConfig, [
        { role: 'system', content: 'You extract structured data from text. Output only the requested lines — no commentary, no markdown.' },
        { role: 'user', content: prompt }
      ], [], this.localLlm?.endpoint)
      return res.text
    }
  }

  // ── Librarian: weekly vault hygiene ──
  // Consolidates old logs, dedupes long-term memory, refreshes entities,
  // and writes a report. Runs as a scheduled automation (kind: 'librarian').

  private dedupeLongTerm(): number {
    let removed = 0
    for (const file of ['lessons.md', 'skills.md']) {
      const rel = `long-term/${file}`
      const content = this.memory.read(rel)
      if (!content) continue
      const seen = new Set<string>()
      const out: string[] = []
      for (const line of content.split('\n')) {
        const t = line.trim()
        // dedupe bullet-like lines; keep headers/blank lines always
        if (/^[-*•]/.test(t) || /^\d+\./.test(t)) {
          const key = t.toLowerCase().replace(/\s+/g, ' ')
          if (seen.has(key)) { removed++; continue }
          seen.add(key)
        }
        out.push(line)
      }
      const next = out.join('\n')
      if (next !== content) this.memory.write(rel, next)
    }
    return removed
  }

  async librarian(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10)
    const consolidated = await this.consolidateShortTerm()
    const deduped = this.dedupeLongTerm()
    let entities = { created: 0, updated: 0, total: 0 }
    try {
      entities = await refreshEntities(this.memory, this.entityCompleter())
    } catch (e) {
      console.warn('[brain] librarian: entity refresh failed:', e)
    }
    try {
      if (this.gitSync) await this.gitSync.syncNow()
    } catch { /* offline ok */ }

    const report = [
      `# Librarian — ${day}`,
      '',
      `- consolidated ${consolidated} short-term log(s) into medium-term`,
      `- removed ${deduped} duplicate long-term line(s)`,
      `- entities: ${entities.created} new, ${entities.updated} updated (${entities.total} total)`,
      ''
    ].join('\n')
    this.memory.write(`insights/librarian-${day}.md`, report)
    this.note('improved', `Librarian de ${day}: ${consolidated} logs consolidados, ${deduped} duplicatas removidas, ${entities.created} entidades novas.`, `insights/librarian-${day}.md`)
    return report
  }

  // ── Evolve: meta-learning cycle ──
  // Reviews the brain's OWN outputs (sleep reports, insights, librarian runs)
  // and asks the LLM how the memory system itself should improve: which
  // questions to ask at night, which files to consolidate, which entities
  // need pages, which automations to add/remove. Writes an evolution report
  // and appends durable proposals to long-term/evolution.md.

  async evolve(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10)
    const stats = this.memoryTierStats()

    // Gather the brain's recent self-reports as evidence
    const corpusParts: string[] = [`Memory stats: ${JSON.stringify(stats)}`]
    for (const r of this.memory.list('sleep').sort().slice(-5)) {
      const c = this.memory.read(`sleep/${r}`)
      if (c) corpusParts.push(`### sleep/${r}\n${c.slice(0, 3000)}`)
    }
    for (const f of this.memory.list('insights').sort().slice(-5)) {
      const c = this.memory.read(`insights/${f}`)
      if (c) corpusParts.push(`### insights/${f}\n${c.slice(0, 2000)}`)
    }
    const gaps = this.memory.read('ops/search-gaps.md')
    if (gaps) corpusParts.push(`### unanswered queries (knowledge gaps)\n${gaps.slice(-3000)}`)
    const prior = this.memory.read('long-term/evolution.md')
    if (prior) corpusParts.push(`### prior evolution proposals\n${prior.slice(-4000)}`)
    const corpus = corpusParts.join('\n\n').slice(-24000)

    const res = await chat(this.store.get().ai as AiProviderConfig, [
      {
        role: 'system',
        content: `You are the self-improvement loop of a personal knowledge system called KeepMind. You do NOT review the user's day — you review the SYSTEM itself. From the sleep reports, insights and stats below, propose concrete upgrades to how the brain learns:

1. **Sleep questions** — are the 5 nightly questions surfacing the right signal? What's missing?
2. **Memory structure** — which tiers/files are bloated, empty, or need splitting?
3. **Entities** — which recurring themes lack a page? Which pages are stale?
4. **Automations** — which routines should run more/less often, or new ones to add?
5. **Retrieval** — what keeps getting re-asked that memory fails to surface?

Rules: ground every proposal in evidence from the reports. Be concrete and skeptical — kill weak proposals. Write in the user's language, markdown, max ~500 words.`
      },
      { role: 'user', content: corpus }
    ], [], this.localLlm?.endpoint)

    const report = `# Evolution — ${day}\n\n_Generated ${new Date().toISOString()} · stats: ${JSON.stringify(stats)}_\n\n${res.text}\n`
    this.memory.write(`insights/evolution-${day}.md`, report)
    this.memory.append('long-term/evolution.md', `\n\n## ${day}\n\n${res.text}\n`)
    this.ensurePolicy()
    const proposal = res.text.replace(/\s+/g, ' ').trim().slice(0, 420)
    this.memory.append('ops/policy.md', `\n- ${day}: ${proposal}\n`)
    this.note('improved', `Evolução de ${day} deixou uma proposta na política do cérebro.`, 'ops/policy.md')

    try {
      if (this.gitSync) await this.gitSync.syncNow()
      else await this.memory.syncToGitHub(`evolution ${day}`)
    } catch { /* offline ok */ }
    void this.rag?.reindex().catch(() => {})
    return res.text
  }

  // ── Enrich: note intelligence pass ──
  // Enriches recent notes missing frontmatter — summary, topic tags and
  // [[wikilinks]] to known entities, written as YAML frontmatter at the
  // top of the note (never rewrites user content).

  // Deterministic enrichment — extracts frontmatter with plain parsing,
  // no LLM tokens. Summary = first prose paragraph; tags/links = entity
  // matches + wikilinks found in the text.
  private enrichNote(rel: string, entityNames: string[]): boolean {
    const content = this.memory.read(rel) ?? ''
    if (!content.trim()) return false
    if (content.includes('## Enrichment')) return false
    const rawBody = content.replace(/^---\n[\s\S]*?\n---\n?/, '')
    const hash = fnv(rawBody)
    const had = /^---\n[\s\S]*?enriched:/m.test(content)
    const prevHash = content.match(/^body: ([0-9a-f]+)$/m)?.[1]
    // Notes enriched before hashes existed stay put. A later edit changes the hash and gets a new pass.
    if (had && (!prevHash || prevHash === hash)) return false

    const body = rawBody
      .replace(/```[\s\S]*?```/g, ' ')               // drop code blocks
      .replace(/^#{1,6}\s+.+$/gm, ' ')               // drop headings (title isn't summary)
      .replace(/^>\s.*$/gm, ' ')                     // drop meta/blockquote lines
      .replace(/[#>*_`\-[\]|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    // summary: first ~30 words of prose
    const summary = body.split(/(?<=[.!?])\s/)[0]?.slice(0, 220).trim() ?? ''

    // entity mentions (word-boundary, case-insensitive, len>3)
    const mentioned = entityNames.filter(n => n.length > 3 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(content))

    // wikilinks already in the note
    const wikilinks = [...content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(m => m[1].trim())
    const links = [...new Set([...mentioned, ...wikilinks])].slice(0, 8)

    // tags: mentioned entities lowercased + filename words
    const fileTags = rel.replace(/^notes\//, '').replace(/\.md$/, '').toLowerCase().split(/[-_\s]+/).filter(w => w.length > 2)
    const tags = [...new Set([...mentioned.map(n => n.toLowerCase()), ...fileTags])].slice(0, 6)

    if (!summary && !tags.length) return false

    const day = new Date().toISOString().slice(0, 10)
    const fmLines = ['---', `enriched: ${day}`, `body: ${hash}`]
    if (summary) fmLines.push(`summary: ${JSON.stringify(summary)}`)
    if (tags.length) fmLines.push(`tags: ${tags.join(', ')}`)
    if (links.length) fmLines.push(`links: ${links.map(l => `[[${l}]]`).join(', ')}`)
    fmLines.push('---', '')
    const fm = fmLines.join('\n')

    // replace existing frontmatter or prepend
    const existing = content.match(/^---\n[\s\S]*?\n---\n?/)
    const next = existing ? fm + content.slice(existing[0].length) : fm + content
    this.memory.write(rel, next)
    return true
  }

  async enrich(): Promise<{ enriched: number; report: string }> {
    const day = new Date().toISOString().slice(0, 10)
    const notes = this.memory.list('notes').sort().slice(-30)
    const entityIndex = this.memory.read('entities/index.md') ?? ''
    const entityNames = [...entityIndex.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(m => m[1].trim()).slice(0, 80)

    let enriched = 0
    const lines: string[] = []
    for (const f of notes) {
      // deterministic pass — no LLM budget needed, enrich everything scanned
      if (this.enrichNote(`notes/${f}`, entityNames)) {
        enriched++
        lines.push(`- \`${f}\` — enriched`)
      }
    }

    const report = [
      `# Note enrichment — ${day}`,
      '',
      `Enriched ${enriched} note(s).`,
      ...lines,
      ''
    ].join('\n')
    this.memory.write(`insights/enrich-${day}.md`, report)

    try {
      if (this.gitSync) await this.gitSync.syncNow()
    } catch { /* offline ok */ }
    void this.rag?.reindex().catch(() => {})
    this.note('improved', `Enriquecimento de ${day}: ${enriched} nota(s) ganharam resumo e ligações.`, `insights/enrich-${day}.md`)
    return { enriched, report }
  }

  // ── Spaced repetition: flashcards + review sessions ──
  // Sleep distills durable learnings into Q/A cards in review/cards.md.
  // The 'review' automation quizzes the brain against them nightly.

  private async generateFlashcards(): Promise<number> {
    // source: recent long-term learnings
    const src = [
      activeForPrompt(this.memory.read('long-term/facts.md') ?? ''),
      this.memory.read('long-term/lessons.md') ?? '',
      this.memory.read('long-term/skills.md') ?? ''
    ].join('\n').slice(-12000)
    if (src.trim().length < 200) return 0

    const res = await chat(this.store.get().ai as AiProviderConfig, [
      {
        role: 'system',
        content: `You create spaced-repetition flashcards from a knowledge base's durable learnings. Output UP TO 6 cards, each in EXACTLY this format:

Q: <question that tests recall of one specific fact/lesson/skill>
A: <one-line answer>

Rules: only cards with real retrieval value (decisions, procedures, corrections, preferences). Skip trivia. No numbering, no commentary, no markdown.`
      },
      { role: 'user', content: src }
    ], [], this.localLlm?.endpoint)

    const cards = [...res.text.matchAll(/^Q:\s*(.+)\nA:\s*(.+)$/gm)]
      .map(m => ({ q: m[1].trim(), a: m[2].trim() }))
      .filter(c => c.q.length > 10 && c.a.length > 3)
    if (!cards.length) return 0

    // dedupe against existing cards (normalized question)
    const existing = this.memory.read('review/cards.md') ?? ''
    const seen = new Set([...existing.matchAll(/^Q:\s*(.+)$/gm)].map(m => m[1].trim().toLowerCase()))
    const day = new Date().toISOString().slice(0, 10)
    const fresh = cards.filter(c => !seen.has(c.q.toLowerCase())).slice(0, 6)
    if (!fresh.length) return 0

    const block = `\n### ${day}\n\n` + fresh.map(c => `Q: ${c.q}\nA: ${c.a}`).join('\n\n') + '\n'
    this.memory.append('review/cards.md', block)
    return fresh.length
  }

  // The person grades cards on Today. This job only counts what is due.
  async review(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10)
    const due = this.dueCards(5)
    const sentence = due.length
      ? `${due.length} card(s) esperam sua revisão em Hoje.`
      : 'Nenhum card vencido para revisar.'
    const report = `# Revisão — ${day}\n\n${sentence}\n\nA nota é sua, na tela Hoje.\n`
    this.memory.write(`review/session-${day}.md`, report)
    this.note(due.length ? 'needs-you' : 'processed', sentence, 'review/cards.md')
    return sentence
  }

  compactLongTerm(): string {
    const budgets: Record<string, number> = {
      'facts.md': 12000,
      'lessons.md': 8000,
      'skills.md': 10000
    }
    let removed = 0
    let trimmed = 0
    for (const [file, budget] of Object.entries(budgets)) {
      const raw = this.memory.read(`long-term/${file}`)
      if (!raw) continue
      if (file === 'facts.md') {
        const next = compactLegacy(raw)
        if (next !== raw) {
          this.memory.write(`long-term/${file}`, next)
          trimmed++
        }
        continue
      }
      const seen = new Set<string>()
      const kept: string[] = []
      for (const line of raw.split('\n')) {
        const key = line.trim().toLowerCase()
        if (key.startsWith('- ') && seen.has(key)) { removed++; continue }
        if (key.startsWith('- ')) seen.add(key)
        kept.push(line)
      }
      let text = kept.join('\n').replace(/\n{3,}/g, '\n\n')
      if (text.length > budget) {
        text = `…\n${text.slice(-budget)}`
        trimmed++
      }
      if (text !== raw) this.memory.write(`long-term/${file}`, text.endsWith('\n') ? text : `${text}\n`)
    }
    const sentence = trimmed
      ? `Compactação: ${removed} linha(s) repetida(s) saíram e ${trimmed} arquivo(s) ficaram no orçamento do prompt.`
      : `Compactação: ${removed} linha(s) repetida(s) saíram da memória longa.`
    this.note('improved', sentence, 'long-term/facts.md')
    return sentence
  }

  escalateTasks(): string {
    const day = new Date().toISOString().slice(0, 10)
    const hits: string[] = []
    for (const f of this.memory.list('tasks')) {
      const content = this.memory.read(`tasks/${f}`) ?? ''
      if (!/status:\s*open/.test(content)) continue
      const title = (content.match(/^#\s+(.+)$/m)?.[1] ?? f).trim()
      const due = content.match(/due:\s*(\d{4}-\d{2}-\d{2})/)?.[1]
      const priority = content.match(/priority:\s*(high|normal|low)/)?.[1] ?? 'normal'
      if (priority === 'high') hits.push(`${title} (prioridade alta)`)
      else if (due && due < day) hits.push(`${title} (atrasada desde ${due})`)
    }
    const sentence = hits.length
      ? `${hits.length} tarefa(s) pedem atenção: ${hits.slice(0, 3).join('; ')}.`
      : 'Nenhuma tarefa atrasada ou de prioridade alta.'
    this.note(hits.length ? 'needs-you' : 'processed', sentence, hits.length ? 'tasks/' : undefined)
    return sentence
  }

  closeSearchGaps(): string {
    const raw = this.memory.read('ops/search-gaps.md') ?? ''
    if (!raw.trim()) {
      const sentence = 'Nenhuma lacuna de busca aberta.'
      this.note('processed', sentence, 'ops/search-gaps.md')
      return sentence
    }
    let closed = 0
    const next = raw.split('\n').map(line => {
      if (line.includes('→')) return line
      const q = line.match(/"([^"]+)"/)?.[1]
      if (!q) return line
      const hit = this.searchVault(q)[0]
      if (!hit) return line
      closed++
      this.rememberQuestion(q, hit.snippet || hit.title, 'gap')
      return `${line} → ${hit.path}`
    })
    if (closed) this.memory.write('ops/search-gaps.md', next.join('\n'))
    const open = next.filter(l => /"[^"]+"/.test(l) && !l.includes('→')).length
    const sentence = closed
      ? `Fechei ${closed} lacuna(s) de busca com arquivos da memória. ${open} continuam sem resposta.`
      : `${open} lacuna(s) de busca continuam sem arquivo correspondente.`
    this.note(closed ? 'improved' : 'processed', sentence, 'ops/search-gaps.md')
    return sentence
  }

  // ── Security audit: scan memory for leaked secrets ──
  // Deterministic pattern scan (no LLM needed) — reports file+line but
  // NEVER prints the secret value itself.

  async securityAudit(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10)
    const PATTERNS = SECRET_PATTERNS
    const hits: string[] = []
    for (const rel of this.memory.allRelFiles()) {
      const content = this.memory.read(rel)
      if (!content) continue
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        for (const [label, re] of PATTERNS) {
          re.lastIndex = 0 // /g patterns are stateful across .test() calls
          if (re.test(lines[i])) {
            // redact: show only the key name/context, never the value
            hits.push(`- \`${rel}:${i + 1}\` — ${label}`)
            break
          }
        }
      }
    }
    const report = hits.length
      ? [`# Security audit — ${day}`, '', `⚠️ **${hits.length} potential secret(s) found in memory:**`, '', ...hits.slice(0, 100), '', '_Values redacted — review and rotate/remove the exposed credentials._', '']
      : [`# Security audit — ${day}`, '', '✅ No secret patterns detected in memory files.', '']
    const text = report.join('\n')
    this.memory.write(`insights/security-${day}.md`, text)
    this.note(hits.length ? 'needs-you' : 'processed', hits.length ? `Auditoria achou ${hits.length} possível(is) segredo(s). O valor não foi exibido.` : `Auditoria de ${day} não achou segredos.`, `insights/security-${day}.md`)
    return text
  }

  // ── Skills evolution: review + consolidate procedural memory ──
  // Reviews long-term/skills.md and skills/*.md: dedupes, asks the LLM to
  // consolidate, and appends a dated review section with proposals.
  // Never deletes — everything becomes a reviewable proposal.

  async evolveSkills(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10)
    const skillsMd = this.memory.read('long-term/skills.md') ?? ''
    const skillFiles = this.memory.list('skills').sort()
    const skillDocs = skillFiles.map(f => `### skills/${f}\n${(this.memory.read(`skills/${f}`) ?? '').slice(0, 3000)}`)

    if (!skillsMd.trim() && !skillDocs.length) {
      const msg = `# Evolução de skills — ${day}\n\nAinda não há skills. Elas entram pelo sono, por \`sb_remember kind=skill\`, ou quando você instala um pacote do SuperagentSkill.\n`
      this.memory.write(`insights/skills-${day}.md`, msg)
      this.note('processed', 'Evolução de skills não tinha o que revisar.', `insights/skills-${day}.md`)
      return msg
    }

    let deduped = 0
    if (skillsMd.trim()) {
      const seen = new Set<string>()
      const out: string[] = []
      for (const line of skillsMd.split('\n')) {
        const t = line.trim()
        if (/^[-*•]/.test(t) || /^\d+\./.test(t)) {
          const key = t.toLowerCase().replace(/\s+/g, ' ')
          if (seen.has(key)) { deduped++; continue }
          seen.add(key)
        }
        out.push(line)
      }
      const next = out.join('\n')
      if (next !== skillsMd) this.memory.write('long-term/skills.md', next)
    }

    const vault = listVaultSkills(this.memory)
    const notes = loadSakNotes(this.memory)
    const threats = loadSkillThreats(this.memory)
    const hints = evolutionHints(vault, notes, threats)
    const guide = [
      'Segmentos e uso (gravações no diário + menções nos logs recentes):',
      ...vault.slice(0, 40).map(s => `- [${s.segment}] ${s.title} (${s.path}) · ${s.kind} · ${s.uses} gravações · ${s.mentions} menções · ${s.ageDays} dias`),
      '',
      'Notas do SuperagentSkill (só existem se a pessoa rodou a avaliação):',
      ...(notes.length
        ? notes.slice(0, 12).map(n => `- ${n.path}: nota ${n.score ?? 'sem número'} · ${n.rationale.slice(0, 240)} · ações: ${n.actions.join(' | ') || 'nenhuma'}`)
        : ['- Nenhuma nota ainda. Não invente pontuação.']),
      '',
      'Análise de skill maliciosa (confiança do pacote + guarda de injeção no arquivo):',
      ...(threats.length
        ? threats.slice(0, 12).map(t => `- ${t.path}: ${t.status} · ${t.summary}`)
        : ['- A análise ainda não rodou. Não invente achado.']),
      '',
      'Pistas já calculadas:',
      ...(hints.length ? hints.map(h => `- (${h.kind}) ${h.sentence}`) : ['- Sem pista determinística.'])
    ].join('\n')

    const corpus = [
      guide,
      skillsMd.slice(-6000),
      ...skillDocs.slice(0, 8)
    ].join('\n\n').slice(0, 20000)

    const res = await chat(this.store.get().ai as AiProviderConfig, [
      {
        role: 'system',
        content: `Você é o curador de habilidades do KeepMind. O texto junta a memória procedural, o uso real, as notas do SuperagentSkill e, se a pessoa tiver rodado, a análise de skill maliciosa.

Escreva um relatório curto, em português, com quatro blocos:

1. Segmentos — agrupe as skills por origem e diga o que cada grupo está fazendo.
2. Evoluir — para cada skill com uso ou com nota, uma melhoria concreta. Cite o número de usos ou a nota. Não invente pontuação.
3. Ameaças — o que a análise de robustez e de injeção pediu para tirar ou reescrever. Se a análise não rodou, diga isso. Não invente achado.
4. Aposentar — skills sem uso, e por quê.

Se não houver nota do SuperagentSkill, diga isso. Menos skills afiadas vencem uma lista vaga. No máximo 400 palavras.`
      },
      { role: 'user', content: corpus }
    ], [], this.localLlm?.endpoint)

    const hintLines = hints.length ? hints.map(h => `- ${h.sentence}`).join('\n') : '- Nenhuma pista além do texto.'
    const report = [
      `# Evolução de skills — ${day}`,
      '',
      `${vault.length} no cofre · ${notes.length} nota(s) do SuperagentSkill · ${deduped} duplicata(s) removida(s) de skills.md`,
      '',
      '## Pistas de uso e de nota',
      '',
      hintLines,
      '',
      res.text,
      ''
    ].join('\n')
    this.memory.write(`insights/skills-${day}.md`, report)
    this.memory.append('long-term/skills.md', `\n\n## Evolução ${day}\n\n${res.text}\n`)
    this.note('improved', `Evolução de skills: ${vault.length} no cofre, ${notes.length} nota(s) do SuperagentSkill.`, `insights/skills-${day}.md`)

    try {
      if (this.gitSync) await this.gitSync.syncNow()
    } catch { /* offline ok */ }
    void this.rag?.reindex().catch(() => {})
    return report
  }

  // ── Fast inbox triage (Laya System-1) ──
  // Splits untriaged inbox captures into blocks, classifies each with a
  // ~33ms local decision (no LLM), routes to the right memory dir, and
  // dedupes long-term writes semantically. Fully autonomous and cheap.

  async triageInbox(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10)
    if (!this.laya?.status().available) {
      const msg = '# Inbox triage — skipped\n\nLaya decision engine not installed (Settings → Decision engine).\n'
      this.memory.write(`insights/triage-${day}.md`, msg)
      return msg
    }

    const processed = new Set(
      (this.memory.read('ops/triaged-files.txt') ?? '').split('\n').map(s => s.trim()).filter(Boolean)
    )
    const pending = this.memory.list('inbox').filter(f => !processed.has(f)).sort()
    if (!pending.length) {
      const msg = '# Inbox triage — nothing new\n\nAll inbox files already triaged.\n'
      this.memory.write(`insights/triage-${day}.md`, msg)
      return msg
    }

    const DESTINATIONS = {
      note: 'a note worth keeping — reference material, ideas, reading',
      task: 'an action item or to-do for the user',
      fact: 'a durable fact, preference or knowledge worth long-term memory',
      lesson: 'a mistake or correction — what to do differently',
      skill: 'a reusable procedure — how to do X well',
      decision: 'a decision that was made, with its rationale',
      crm: 'information about a person, company or relationship',
      discard: 'noise, ephemeral chatter, or duplicates — not worth keeping'
    }

    const routed: Record<string, string[]> = {}
    const report: string[] = [`# Inbox triage — ${day}`, '', `_${pending.length} file(s) processed · Laya fast decisions_`, '']
    let blocksSeen = 0, kept = 0, dropped = 0, dups = 0

    for (const file of pending.slice(0, 10)) {
      const content = this.memory.read(`inbox/${file}`) ?? ''
      if (!content.trim()) { processed.add(file); continue }
      const blocks = splitBlocks(content).slice(0, 30)
      for (const block of blocks) {
        if (blocksSeen++ >= 60) break
        const text = block.replace(/\s+/g, ' ').trim().slice(0, 800)
        if (text.length < 25) continue
        const verdict: { choice: string; confidence: number } | null = await this.laya!.choose(text,
          'Where should this captured memory go in a second brain?', DESTINATIONS)
          .catch(() => null)
        const dest = verdict && verdict.confidence > 0.35 ? verdict.choice : 'note'
        if (dest === 'discard') { dropped++; continue }

        // semantic dedup gate for durable writes
        if (['fact', 'lesson', 'skill', 'decision'].includes(dest)) {
          const existing = this.memory.read(`long-term/${dest}s.md`)?.slice(-4000) ?? ''
          if (existing) {
            const p = await this.laya!.yesNo(
              `New item: ${text}\n\nExisting memory:\n${existing}`,
              'Is the new item already captured by the existing memory?'
            ).catch(() => null)
            if (p != null && p > 0.72) { dups++; continue }
          }
        }

        ;(routed[dest] ??= []).push(text)
        kept++
      }
      processed.add(file)
      report.push(`- \`inbox/${file}\` → triaged`)
    }

    // write routed content
    const prov = `> source: inbox triage ${day}\n\n`
    for (const [dest, items] of Object.entries(routed)) {
      if (dest === 'task') {
        for (const [i, t] of items.entries()) {
          const title = t.split(/[.\n]/)[0].slice(0, 80) || 'triage item'
          const id = `${day.replace(/-/g, '')}-triage-${i}-${Math.random().toString(36).slice(2, 5)}`
          this.memory.write(`tasks/${id}.md`,
            `# ${title}\n> status: open · priority: normal · created: ${new Date().toISOString()}\n\n${prov}${t}\n`)
        }
      } else if (dest === 'note') {
        this.memory.append(`notes/triage-${day}.md`,
          items.map(t => `## ${t.split(/[.\n]/)[0].slice(0, 70)}\n\n${prov}${t}\n`).join('\n'))
      } else if (dest === 'crm') {
        this.memory.append(`crm/interactions/triage-${day}.md`,
          `\n## ${day}\n\n` + items.map(t => `- ${t}`).join('\n') + '\n')
      } else if (dest === 'fact') {
        for (const item of items) this.proposeFact(item, 'agent', 'triagem', false)
        this.note('needs-you', `${items.length} fato(s) da triagem esperam você em Hoje.`, 'long-term/facts.md')
      } else {
        this.memory.append(`long-term/${dest}s.md`,
          `\n\n## ${day} (inbox triage)\n\n` + items.map(t => `- ${t}`).join('\n') + '\n')
      }
    }

    report.push('', `- ${blocksSeen} block(s) seen · ${kept} kept · ${dropped} discarded · ${dups} semantic duplicates skipped`)
    const text = report.join('\n') + '\n'
    this.memory.write(`insights/triage-${day}.md`, text)
    this.memory.write('ops/triaged-files.txt', [...processed].sort().join('\n') + '\n')

    try { if (this.gitSync) await this.gitSync.syncNow() } catch { /* offline ok */ }
    void this.rag?.reindex().catch(() => {})
    return text
  }

  // Semantic dedup gate: is `candidate` already captured in `existing`?
  // Used by sleep extraction and anywhere durable writes need a cheap check.
  async isSemanticDuplicate(candidate: string, existing: string): Promise<boolean> {
    if (!this.laya?.status().available || !existing.trim()) return false
    const p = await this.laya.yesNo(
      `New item: ${candidate.slice(0, 600)}\n\nExisting memory:\n${existing.slice(-4000)}`,
      'Is the new item already captured by the existing memory?'
    ).catch(() => null)
    return p != null && p > 0.72
  }

  listSleepReports(): { date: string; content: string }[] {
    return this.memory.list('sleep').sort().reverse().map(f => ({
      date: f.replace('.md', ''),
      content: this.memory.read(`sleep/${f}`) ?? ''
    }))
  }

  memoryTierStats() {
    return {
      shortTerm: this.memory.shortTermFiles().length,
      mediumTerm: this.memory.mediumTermFiles().length,
      longTerm: this.memory.countFiles('long-term'),
      sleepCycles: this.memory.list('sleep').length
    }
  }

  listInsights(): { date: string; content: string }[] {
    return this.memory.list('insights').sort().reverse().map(f => ({
      date: f.replace('.md', ''),
      content: this.memory.read(`insights/${f}`) ?? ''
    }))
  }

  listSummaries(): { date: string; content: string }[] {
    return this.memory.list('summaries').sort().reverse().map(f => ({
      date: f.replace('.md', ''),
      content: this.memory.read(`summaries/${f}`) ?? ''
    }))
  }

  readMemoryFile(rel: string): string | null {
    try { return this.memory.read(rel) } catch { return null }
  }

  // Planner tasks live in tasks/*.md — same meta-line format Planner writes.
  private readTasks() {
    return this.memory.list('tasks').map(f => {
      const c = this.memory.read(`tasks/${f}`) ?? ''
      const meta = c.match(/^>\s*(.+)$/m)?.[1] ?? ''
      return {
        file: f,
        id: f.replace(/\.md$/, ''),
        title: c.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? f.replace(/\.md$/, ''),
        status: /status:\s*done/i.test(meta) ? 'done' : 'open',
        priority: meta.match(/priority:\s*(\w+)/i)?.[1]?.toLowerCase() ?? 'normal',
        due: meta.match(/due:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? ''
      }
    })
  }

  // One-time import triage: extract markdown checkboxes `- [ ] …` from the
  // whole vault into planner tasks. Deduped by normalized text; runs once
  // (marker in ops/) after a whole-vault import.
  async triageVaultTasks() {
    const marker = 'ops/vault-tasks-triaged.md'
    if (this.memory.read(marker)) return { skipped: true }
    const seen = new Set<string>()
    const out: { title: string; src: string }[] = []
    const cbRe = /^\s*[-*+]\s+\[ \]\s+(.{3,200}?)\s*$/gm
    for (const f of this.memory.allRelFiles()) {
      if (!f.endsWith('.md')) continue
      const segs = f.split('/')
      if (segs[0] === 'tasks' || segs[0] === 'ops' || segs.slice(0, -1).some(s => s.startsWith('.'))) continue
      const c = this.memory.read(f)
      if (!c) continue
      for (const m of c.matchAll(cbRe)) {
        const title = m[1].replace(/\[\[([^\]|]+)\|?[^\]]*\]\]/g, '$1').trim()
        const key = title.toLowerCase()
        if (!key || seen.has(key)) continue
        seen.add(key)
        out.push({ title, src: f })
        if (out.length >= 400) break
      }
      if (out.length >= 400) break
    }
    for (const t of out) {
      const id = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${slug(t.title)}-${Math.random().toString(36).slice(2, 6)}`
      this.memory.write(`tasks/${id}.md`,
        `# ${t.title}\n> status: open · priority: normal · created: ${new Date().toISOString()}\n\n_source: ${t.src}_\n`)
    }
    this.memory.quietWrite(marker, `# Vault task triage\n\n_imported ${out.length} open checkbox items from vault markdown on ${new Date().toISOString()}_\n`)
    return { imported: out.length }
  }

  private ensurePolicy() {
    if (this.memory.read('ops/policy.md')) return
    this.memory.write('ops/policy.md', [
      '# Política do cérebro',
      '',
      '## Ativo',
      '',
      'Sem instruções extras ainda. Uma proposta aprovada passa a valer aqui e o sono seguinte lê este bloco.',
      '',
      '## Propostas',
      ''
    ].join('\n'))
  }

  policy(): { active: string; proposals: string[] } {
    this.ensurePolicy()
    const raw = this.memory.read('ops/policy.md') ?? ''
    const [head, tailPart] = raw.split('## Propostas')
    const active = (head.split('## Ativo')[1] ?? '').trim()
    const proposals = (tailPart ?? '').split('\n').map(l => l.trim()).filter(l => l.startsWith('- '))
    return { active, proposals }
  }

  applyLatestPolicy(): string {
    this.ensurePolicy()
    const raw = this.memory.read('ops/policy.md') ?? ''
    const tailPart = raw.split('## Propostas')[1]
    const proposals = (tailPart ?? '').split('\n').map(l => l.trim()).filter(l => l.startsWith('- '))
    const last = proposals.pop()
    if (!last) return 'Nenhuma proposta para aplicar.'
    const body = last.replace(/^- \d{4}-\d{2}-\d{2}:\s*/, '')
    const next = [
      '# Política do cérebro',
      '',
      '## Ativo',
      '',
      body,
      '',
      '## Propostas',
      '',
      ...proposals,
      ''
    ].join('\n')
    this.memory.write('ops/policy.md', next)
    this.note('improved', 'A política ativa do cérebro foi atualizada com a última proposta.', 'ops/policy.md')
    return 'Política ativa atualizada. O próximo sono vai seguir este texto.'
  }

  private factsRaw(): string {
    return this.memory.read('long-term/facts.md') ?? ''
  }

  private writeFacts(raw: string) {
    this.memory.write('long-term/facts.md', raw.endsWith('\n') ? raw : `${raw}\n`)
  }

  private proposeFact(text: string, origin: FactOrigin, source: string, announce = true): string {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (clean.length < 3) return ''
    const next = addProposal(this.factsRaw(), clean, source, origin)
    this.writeFacts(next.raw)
    if (announce) this.note('needs-you', 'Uma proposta de fato espera você em Hoje.', 'long-term/facts.md')
    return next.id
  }

  captureFact(text: string): string {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (clean.length < 3) return 'Escreva uma frase para guardar.'
    const next = addActive(this.factsRaw(), clean, 'atalho', 'user')
    this.writeFacts(next.raw)
    this.note('discovered', 'A frase capturada já vale como fato ativo.', 'long-term/facts.md')
    return 'Frase guardada. Ela já vale.'
  }

  correctFact(claim: string, correction: string): string {
    const nextText = correction.replace(/\s+/g, ' ').trim()
    const wrong = claim.replace(/\s+/g, ' ').trim()
    if (nextText.length < 3) return 'Escreva a correção.'
    const current = this.factsRaw()
    const needle = wrong.slice(0, 80).toLowerCase()
    const match = needle.length < 12 ? '' : (readFacts(current).facts.find(f =>
      f.status === 'active' && (f.text.toLowerCase().includes(needle.slice(0, 40)) || needle.includes(f.text.toLowerCase().slice(0, 40)))
    )?.id ?? '')
    const next = addActive(current, nextText, 'isto está errado', 'user', match)
    this.writeFacts(next.raw)
    const evalRaw = this.memory.read('ops/eval.md') ?? ''
    this.memory.write('ops/eval.md', addEvalQuestion(evalRaw, wrong.slice(0, 240) || 'Qual é a correção?', nextText, 'correction'))
    this.note('improved', 'A correção já vale. A resposta anterior saiu da memória ativa.', 'long-term/facts.md')
    return 'Correção gravada. Ela já vale, e a avaliação vai conferir isso no próximo sono.'
  }

  factQueue(): { id: string; text: string; since: string; origin: string; source: string; previous: string }[] {
    const raw = this.factsRaw()
    return proposalsOf(raw).map(p => ({
      id: p.id,
      text: p.text,
      since: p.since,
      origin: p.origin,
      source: p.source,
      previous: p.supersedes ? (factById(raw, p.supersedes)?.text ?? '') : ''
    }))
  }

  acceptFact(id: string): string {
    const next = acceptProposal(this.factsRaw(), id)
    if (!next.ok) return 'Essa proposta não está mais na fila.'
    this.writeFacts(next.raw)
    this.note('improved', 'Você aceitou um fato. Ele entra na memória ativa.', 'long-term/facts.md')
    return 'Fato aceito. O próximo prompt já pode usá-lo.'
  }

  discardFact(id: string): string {
    const next = discardProposal(this.factsRaw(), id)
    if (!next.ok) return 'Essa proposta não está mais na fila.'
    this.writeFacts(next.raw)
    this.note('processed', 'Você descartou uma proposta de fato.', 'long-term/facts.md')
    return 'Proposta descartada.'
  }

  private rememberQuestion(q: string, a: string, source: 'gap' | 'correction') {
    const raw = this.memory.read('ops/eval.md') ?? ''
    const next = addEvalQuestion(raw, q, a, source)
    if (next !== raw) this.memory.write('ops/eval.md', next)
  }

  private harvestGapQuestions() {
    const raw = this.memory.read('ops/search-gaps.md') ?? ''
    for (const line of raw.split('\n')) {
      if (!line.includes('→')) continue
      const q = line.match(/"([^"]+)"/)?.[1]
      const answer = line.split('→').slice(1).join('→').trim()
      if (q && answer) this.rememberQuestion(q, answer, 'gap')
    }
  }

  private scoreQuestions(day: string): { hit: number; total: number } {
    const raw = this.memory.read('ops/eval.md') ?? ''
    if (!raw.trim()) return { hit: 0, total: 0 }
    const corpus = [
      activeForPrompt(this.factsRaw()),
      this.memory.read('long-term/lessons.md') ?? ''
    ].join('\n')
    const scored = scoreEval(raw, corpus, day)
    this.memory.write('ops/eval.md', scored.raw)
    return { hit: scored.hit, total: scored.total }
  }

  evalStatus(): { questions: { q: string; source: string }[]; last: { day: string; hit: number; total: number } | null } {
    const doc = readEval(this.memory.read('ops/eval.md') ?? '')
    return {
      questions: doc.questions.map(item => ({ q: item.q, source: item.source })),
      last: doc.scores[doc.scores.length - 1] ?? null
    }
  }

  async hybridSearch(query: string): Promise<{
    hits: { path: string; title: string; snippet: string }[]
    semantic: boolean
    notice: string
    asOf: string | null
  }> {
    const asOf = parseAsOf(query)
    if (asOf) {
      const raw = this.factsRaw()
      const dated = factsAsOf(raw, asOf)
      const hits = dated.map(f => ({
        path: 'long-term/facts.md',
        title: f.text.split('\n')[0].slice(0, 80),
        snippet: `${f.since}${f.until ? ` até ${f.until}` : ' em diante'} · ${f.text}`
      }))
      const undated = readFacts(raw).legacy.trim() ? ' Texto sem data não entra nessa consulta.' : ''
      const notice = hits.length
        ? `O que valia em ${monthLabel(asOf)}.${undated}`
        : `Não há fato datado que valesse em ${monthLabel(asOf)}. Texto sem data não entra nessa consulta.`
      return { hits: hits.slice(0, 12), semantic: false, notice, asOf }
    }
    const lexical = this.searchVault(query)
    const ready = this.rag?.semanticReady() ?? false
    if (!ready) {
      return {
        hits: lexical,
        semantic: false,
        notice: lexical.length
          ? 'A busca semântica está parada. Estes resultados são só por texto.'
          : 'A busca semântica está parada. Nada casou por texto.',
        asOf: null
      }
    }
    const semanticHits = await this.rag?.semanticHits(query).catch(() => []) ?? []
    const seen = new Set(lexical.map(h => h.path))
    const hits = [...lexical]
    for (const hit of semanticHits) {
      if (seen.has(hit.path)) continue
      seen.add(hit.path)
      hits.push(hit)
      if (hits.length >= 12) break
    }
    return { hits, semantic: true, notice: '', asOf: null }
  }

  searchVault(query: string): { path: string; title: string; snippet: string }[] {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const hits: { path: string; title: string; snippet: string }[] = []
    for (const rel of this.memory.allRelFiles()) {
      if (!rel.endsWith('.md')) continue
      if (rel.startsWith('ops/')) continue
      const content = this.memory.read(rel) ?? ''
      const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? rel
      const hay = `${rel}\n${title}\n${content}`.toLowerCase()
      const at = hay.indexOf(q)
      if (at < 0) continue
      const snippet = content.replace(/\s+/g, ' ').slice(Math.max(0, at - 60), at + 140)
      hits.push({ path: rel, title, snippet })
      if (hits.length >= 12) break
    }
    return hits
  }

  private reviewState(): Record<string, { due: number; interval: number }> {
    return this.memory.readOpsJson('review-state.json', {} as Record<string, { due: number; interval: number }>)
  }

  dueCards(limit = 5): { q: string; a: string }[] {
    const raw = this.memory.read('review/cards.md') ?? ''
    const cards = [...raw.matchAll(/^Q:\s*(.+)\nA:\s*(.+)$/gm)]
      .map(m => ({ q: m[1].trim(), a: m[2].trim() }))
      .filter(c => c.q && c.a)
    const state = this.reviewState()
    const now = Date.now()
    return cards.filter(c => (state[c.q]?.due ?? 0) <= now).slice(0, limit)
  }

  gradeCard(question: string, rating: 'again' | 'hard' | 'good' | 'easy'): { due: number } {
    const state = this.reviewState()
    const prev = state[question] ?? { due: 0, interval: 0 }
    const day = 86_400_000
    let interval = prev.interval
    if (rating === 'again') interval = 0
    else if (rating === 'hard') interval = Math.max(1, interval || 1)
    else if (rating === 'good') interval = interval < 1 ? 1 : Math.round(interval * 2)
    else interval = interval < 1 ? 3 : Math.round(interval * 3)
    const due = Date.now() + Math.max(interval, rating === 'again' ? 0 : interval) * (rating === 'again' ? 60_000 : day)
    state[question] = { due: rating === 'again' ? Date.now() + 10 * 60_000 : due, interval }
    this.memory.writeOpsJson('review-state.json', state)
    this.note('processed', `Revisão marcada como ${rating}.`, 'review/cards.md')
    return { due: state[question].due }
  }

  // Wikilink graph of the whole vault — powers the 3D neural view.
  // Cached for 60s: scanning ~10k files is too slow per frame.
  private graphCache: { at: number; data: any } | null = null
  memoryGraph() {
    if (this.graphCache && Date.now() - this.graphCache.at < 60_000) return this.graphCache.data
    const files = this.memory.allRelFiles()
      .filter(f => f.endsWith('.md') && !f.split('/').slice(0, -1).some(s => s.startsWith('.')))
    const idOf = (f: string) => f.replace(/\.md$/, '')
    const byBase = new Map<string, string>()
    const nodes = new Map<string, { id: string; label: string; dir: string; links: number }>()
    for (const f of files) {
      const id = idOf(f)
      const base = f.split('/').pop()!.replace(/\.md$/, '')
      byBase.set(base.toLowerCase(), id)
      nodes.set(id, { id, label: base, dir: f.split('/')[0] ?? '', links: 0 })
    }
    const linkRe = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]|\]\(([^)\s]+?\.md)(?:#[^)\s]*)?[^)]*\)/g
    const edgeSet = new Set<string>()
    for (const f of files) {
      const src = idOf(f)
      const content = this.memory.read(f)
      if (!content) continue
      const dir = f.split('/').slice(0, -1).join('/')
      for (const m of content.matchAll(linkRe)) {
        let target = (m[1] ?? m[2] ?? '').split('#')[0]
        try { target = decodeURIComponent(target) } catch { /* keep raw */ }
        target = target.replace(/\.md$/, '').replace(/^\.\//, '')
        if (!target) continue
        let tid: string | undefined
        if (nodes.has(target)) tid = target
        else {
          const base = target.split('/').pop()!.toLowerCase()
          tid = byBase.get(base)
          if (!tid && dir) {
            const rel = `${dir}/${target}`
            if (nodes.has(rel)) tid = rel
          }
        }
        if (tid && tid !== src && nodes.has(tid)) {
          edgeSet.add(`${src}→${tid}`)
          const n = nodes.get(src)!
          n.links++
        }
      }
    }
    // Cap: keep the most-connected nodes so the 3D view stays interactive
    let nodeList = [...nodes.values()]
    if (nodeList.length > 800) {
      nodeList = nodeList.sort((a, b) => b.links - a.links).slice(0, 800)
    }
    const keep = new Set(nodeList.map(n => n.id))
    const links = [...edgeSet]
      .map(e => e.split('→'))
      .filter(([s, t]) => keep.has(s) && keep.has(t))
      .map(([s, t]) => [s, t])
    const data = { nodes: nodeList, links, totalFiles: files.length }
    this.graphCache = { at: Date.now(), data }
    return data
  }
}

function fnv(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'note'
}

// Split inbox content into classifiable blocks: bullets and paragraphs,
// re-joining tiny fragments so each block carries enough context.
function splitBlocks(content: string): string[] {
  const raw = content
    .split(/\n{2,}|(?<=\n)(?=- |• |\* |\d+\. )/)
    .map(s => s.trim())
    .filter(s => s.length > 10)
  const out: string[] = []
  let buf = ''
  for (const b of raw) {
    if (buf && (buf.length + b.length > 1100 || b.length < 40)) {
      out.push(buf); buf = ''
    }
    buf = buf ? `${buf}\n${b}` : b
    if (buf.length > 1100) { out.push(buf); buf = '' }
  }
  if (buf.trim()) out.push(buf)
  return out
}

// ISO-8601 week key like "2026-W45"
function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = (date.getUTCDay() + 6) % 7 // Mon=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3) // Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const ftDay = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDay + 3)
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 864e5))
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
