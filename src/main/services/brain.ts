import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, appendFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { chat, chatStream, type ChatMessage, type ToolDefinition } from './llm'
import type { AiProviderConfig } from '../store'
import type { McpManager } from './mcp'
import type { LocalLlm } from './local-llm'
import type { AgentPersona } from '../store'
import * as github from './github'
import type { GitHubConfig, Store } from '../store'
import type { GitSync } from './sync'
import type { RagService } from './rag'

// ── Memory: markdown files in the local memory dir, mirrored to the GitHub repo ──

export class Memory {
  // Called after every local write/append — used by GitSync to mark dirty paths
  onWrite: ((relPath: string) => void) | null = null
  private quiet = false

  constructor(private dir: string, private gh: GitHubConfig | null) {
    mkdirSync(this.dir, { recursive: true })
    // Memory tiers — modeled on human memory:
    //   short-term  = raw daily logs (working memory, recent days)
    //   medium-term = weekly consolidations of older short-term logs
    //   long-term   = durable facts, lessons, skills (never forgotten)
    //   sleep       = nightly learning reports
    //   inbox       = legacy dir kept for backward compatibility
    for (const sub of ['short-term', 'medium-term', 'long-term', 'sleep', 'inbox', 'insights', 'summaries', 'agents']) {
      mkdirSync(join(this.dir, sub), { recursive: true })
    }
  }

  private path(...parts: string[]) { return join(this.dir, ...parts) }

  write(relative: string, content: string) {
    const p = this.path(relative)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, content, 'utf8')
    if (!this.quiet) this.onWrite?.(relative)
  }

  append(relative: string, content: string) {
    const p = this.path(relative)
    mkdirSync(join(p, '..'), { recursive: true })
    appendFileSync(p, content, 'utf8')
    if (!this.quiet) this.onWrite?.(relative)
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
    if (existsSync(p)) unlinkSync(p)
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

  constructor(store: Store, mcp: McpManager | null, localLlm: LocalLlm | null = null) {
    this.store = store
    this.mcp = mcp
    this.localLlm = localLlm
    this.memory = new Memory(store.memoryDir, store.get().github.accessToken ? store.get().github : null)
  }

  setMcp(mcp: McpManager) { this.mcp = mcp }
  setLocalLlm(l: LocalLlm) { this.localLlm = l }
  attachSync(sync: GitSync) {
    this.gitSync = sync
    this.memory.onWrite = (rel) => sync.markDirty(rel)
  }
  setRag(rag: RagService) { this.rag = rag }

  getMemory() { return this.memory }

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
    const facts = this.memory.read('long-term/facts.md')
    if (facts) parts.push('', '## Long-term memory — facts & preferences', facts.slice(0, 3000))
    const skills = this.memory.read('long-term/skills.md')
    if (skills) parts.push('', '## Learned skills (from nightly sleep cycles)', skills.slice(0, 2500))
    const lessons = this.memory.read('long-term/lessons.md')
    if (lessons) parts.push('', '## Lessons learned', lessons.slice(0, 2000))
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
      const file = `long-term/notes/${slug(title)}.md`
      this.memory.write(file, `# ${title}\n\n${content}\n\n---\nsaved ${new Date().toISOString()}\n`)
      return `Saved to memory/${file} (long-term)`
    }
    if (name === 'get_memory') {
      const c = this.memory.read(String(args.path ?? ''))
      return c ?? 'Not found'
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

  async chat(agentId: string, userMessage: string, onDelta?: (t: string) => void): Promise<string> {
    // Pull freshest shared memory before answering (rate-limited internally)
    await this.gitSync?.pullIfDue().catch(() => {})
    // Semantic recall over memory (no-op if embeddings aren't set up)
    const recall = await this.rag?.search(userMessage).catch(() => '') ?? ''
    const cfg = this.store.get()
    const agent = cfg.agents.find(a => a.id === agentId) ?? cfg.agents[0]
    const messages: ChatMessage[] = [
      { role: 'system', content: this.buildSystemContext(agent, recall) },
      { role: 'user', content: userMessage }
    ]
    const tools = this.toolDefinitions()

    // Agentic loop: call LLM -> execute tool calls -> repeat (max 6 rounds)
    let finalText = ''
    for (let round = 0; round < 6; round++) {
      const res = await chat(cfg.ai as AiProviderConfig, messages, tools, this.localLlm?.endpoint)
      finalText = res.text
      if (!res.toolCalls?.length) break

      // Append assistant turn with tool calls
      messages.push({ role: 'assistant', content: res.text || '(tool calls)' })
      for (const tc of res.toolCalls) {
        const result = await this.execTool(tc.name, tc.arguments)
        messages.push({ role: 'tool', name: tc.name, content: result })
      }
    }

    if (onDelta) {
      // Stream the final answer for UX
      const words = finalText.split(/(\s+)/)
      for (const w of words) { onDelta(w); await new Promise(r => setTimeout(r, 10)) }
    }

    // Persist exchange to short-term memory (raw daily log)
    const day = new Date().toISOString().slice(0, 10)
    this.memory.append(`short-term/${day}.md`, `\n\n## ${new Date().toLocaleTimeString()} — ${agent.name}\n\n**You:** ${userMessage}\n\n**${agent.name}:** ${finalText}\n`)
    return finalText
  }

  async streamChat(agentId: string, userMessage: string): Promise<string> {
    // Non-tool streaming path for snappy UX; falls back inside chat() for tool use
    return this.chat(agentId, userMessage)
  }

  async generateInsights(): Promise<string[]> {
    const cfg = this.store.get()
    const memoryFiles = [...this.memory.shortTermFiles(), ...this.memory.list('inbox')].slice(-10)
    const corpus = memoryFiles.map(f => {
      const dir = this.memory.read(`short-term/${f}`) != null ? 'short-term' : 'inbox'
      return this.memory.read(`${dir}/${f}`) ?? ''
    }).join('\n---\n').slice(-12000)
    if (!corpus.trim()) return []

    const res = await chat(cfg.ai as AiProviderConfig, [
      {
        role: 'system',
        content: 'You are an insight engine for a personal second brain. From the memory below, produce 3-5 concise, actionable insights (what to do, what matters, patterns). One per line, starting with an emoji. Max 30 words each. Respond in the user\'s language.'
      },
      { role: 'user', content: corpus }
    ], [], this.localLlm?.endpoint)
    const lines = res.text.split('\n').map(l => l.trim()).filter(Boolean)
    const day = new Date().toISOString().slice(0, 10)
    this.memory.write(`insights/${day}.md`, `# Insights — ${day}\n\n${lines.map(l => `- ${l}`).join('\n')}\n`)
    return lines
  }

  async dailySummary(): Promise<string> {
    const cfg = this.store.get()
    const day = new Date().toISOString().slice(0, 10)
    const today = this.memory.read(`short-term/${day}.md`) ?? this.memory.read(`inbox/${day}.md`) ?? '(no activity today)'
    const res = await chat(cfg.ai as AiProviderConfig, [
      {
        role: 'system',
        content: 'You write a warm, concise daily summary of a person\'s digital life. 5-8 bullet points max. Highlight what mattered, what\'s pending, one suggested focus for tomorrow. Plain language.'
      },
      { role: 'user', content: `Today\'s activity:\n${today.slice(-8000)}` }
    ], [], this.localLlm?.endpoint)
    this.memory.write(`summaries/${day}.md`, `# Daily summary — ${day}\n\n${res.text}\n`)
    return res.text
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
    const corpus = parts.join('\n\n').slice(-maxChars)
    return corpus
  }

  async sleep(): Promise<{ report: string; consolidated: number }> {
    const cfg = this.store.get()
    const day = new Date().toISOString().slice(0, 10)
    const corpus = this.recentCorpus()

    if (!corpus.trim()) {
      const report = `# Sleep cycle — ${day}\n\nNo memory activity to process yet. The brain sleeps peacefully. 💤\n`
      this.memory.write(`sleep/${day}.md`, report)
      return { report, consolidated: 0 }
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
      const appendIf = (file: string, section: string, body: string) => {
        const clean = body.split('\n').filter(l => l.trim() && l.trim() !== '(none)').join('\n')
        if (!clean) return
        this.memory.append(`long-term/${file}`, `\n\n## ${day}\n\n${clean}\n`)
      }
      appendIf('facts.md', '', grab('===FACTS===', '===LESSONS==='))
      appendIf('lessons.md', '', grab('===LESSONS===', '===SKILLS==='))
      appendIf('skills.md', '', grab('===SKILLS===', '$'))
    } catch (e) {
      console.warn('[brain] sleep: long-term extraction failed:', e)
    }

    // 3) Consolidate short-term logs older than 7 days into medium-term weekly files
    const consolidated = await this.consolidateShortTerm()

    // 4) Sync to GitHub — GitSync pushes dirty paths + pulls remote changes
    try {
      if (this.gitSync) await this.gitSync.syncNow()
      else await this.memory.syncToGitHub(`sleep cycle ${day}`)
    } catch { /* offline ok */ }

    return { report: res.text, consolidated }
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
      if (this.memory.read(target)) {
        // already consolidated — just drop the raw files
        for (const f of files) this.memory.remove(`short-term/${f}`)
        consolidated += files.length
        continue
      }
      const corpus = files.map(f => `### ${f}\n${this.memory.read(`short-term/${f}`) ?? ''}`).join('\n\n').slice(-16000)
      try {
        const cfg = this.store.get()
        const res = await chat(cfg.ai as AiProviderConfig, [
          {
            role: 'system',
            content: 'You compress daily memory logs into a weekly medium-term memory. Produce a tight markdown digest: key events, decisions, open loops, patterns. Max ~400 words. No fluff.'
          },
          { role: 'user', content: corpus }
        ], [], this.localLlm?.endpoint)
        this.memory.write(target, `# Week ${week}\n\n${res.text}\n`)
      } catch {
        // LLM unavailable — still consolidate mechanically so short-term doesn't grow forever
        this.memory.write(target, `# Week ${week}\n\n_Consolidated without LLM._\n\n${files.map(f => `- ${f}`).join('\n')}\n`)
      }
      for (const f of files) this.memory.remove(`short-term/${f}`)
      consolidated += files.length
    }
    return consolidated
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
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'note'
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
