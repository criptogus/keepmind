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
import { refreshEntities } from './entities'

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
    for (const sub of ['short-term', 'medium-term', 'long-term', 'sleep', 'inbox', 'insights', 'summaries', 'agents', 'notes', 'tasks', 'daily', 'meetings', 'entities', 'review', 'skills', 'crm', 'ops']) {
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
    if (existsSync(p)) {
      unlinkSync(p)
      if (!this.quiet) this.onWrite?.(relative)
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
    // knowledge gaps: searches that returned nothing (logged by MCP/RAG clients)
    const gaps = this.memory.read('ops/search-gaps.md')
    if (gaps) parts.push(`### ops/search-gaps.md (unanswered queries)\n${gaps.slice(-3000)}`)
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
    for (const file of ['facts.md', 'lessons.md', 'skills.md']) {
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

    try {
      if (this.gitSync) await this.gitSync.syncNow()
      else await this.memory.syncToGitHub(`evolution ${day}`)
    } catch { /* offline ok */ }
    void this.rag?.reindex().catch(() => {})
    return res.text
  }

  // ── Enrich: note intelligence pass ──
  // Picks recent notes missing frontmatter and asks the LLM to enrich them:
  // summary, topic tags and [[wikilinks]] to known entities — written as
  // YAML frontmatter at the top of the note (never rewrites user content).

  private async enrichNote(rel: string, entityNames: string[]): Promise<boolean> {
    const content = this.memory.read(rel) ?? ''
    if (!content.trim()) return false
    // already enriched (frontmatter marker or legacy Enrichment section)
    if (/^---\n[\s\S]*?enriched:/m.test(content) || content.includes('## Enrichment')) return false

    const res = await chat(this.store.get().ai as AiProviderConfig, [
      {
        role: 'system',
        content: `You enrich personal notes in a knowledge base. Given a note, output ONLY these three lines and nothing else:

summary: <one sentence, max 25 words>
tags: <3-6 comma-separated lowercase tags>
links: <comma-separated [[Entity]] wikilinks — ONLY from this list: ${entityNames.join(', ') || '(none yet)'}>

If a field has nothing useful write "-". Write values in the user's language.`
      },
      { role: 'user', content: content.slice(0, 6000) }
    ], [], this.localLlm?.endpoint)

    const fields: Record<string, string> = {}
    for (const line of res.text.split('\n')) {
      const m = line.match(/^(summary|tags|links):\s*(.+)$/i)
      if (m) fields[m[1].toLowerCase()] = m[2].trim()
    }
    if (!fields.summary && !fields.tags) return false

    const day = new Date().toISOString().slice(0, 10)
    const fmLines = ['---', `enriched: ${day}`]
    if (fields.summary && fields.summary !== '-') fmLines.push(`summary: ${JSON.stringify(fields.summary)}`)
    if (fields.tags && fields.tags !== '-') fmLines.push(`tags: ${fields.tags}`)
    if (fields.links && fields.links !== '-') fmLines.push(`links: ${fields.links}`)
    fmLines.push('---', '')
    const fm = fmLines.join('\n')

    // replace existing frontmatter or prepend
    let next: string
    const existing = content.match(/^---\n[\s\S]*?\n---\n?/)
    next = existing ? fm + content.slice(existing[0].length) : fm + content
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
      if (enriched >= 8) break // bound LLM calls per run
      try {
        if (await this.enrichNote(`notes/${f}`, entityNames)) {
          enriched++
          lines.push(`- \`${f}\` — enriched`)
        }
      } catch { /* skip note on failure */ }
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
    return { enriched, report }
  }

  // ── Spaced repetition: flashcards + review sessions ──
  // Sleep distills durable learnings into Q/A cards in review/cards.md.
  // The 'review' automation quizzes the brain against them nightly.

  private async generateFlashcards(): Promise<number> {
    // source: recent long-term learnings
    const src = ['facts.md', 'lessons.md', 'skills.md']
      .map(f => this.memory.read(`long-term/${f}`) ?? '')
      .join('\n')
      .slice(-12000)
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

  // Review session: sample cards, ask the LLM to answer blind, then grade.
  async review(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10)
    const raw = this.memory.read('review/cards.md') ?? ''
    const cards = [...raw.matchAll(/^Q:\s*(.+)\nA:\s*(.+)$/gm)]
      .map(m => ({ q: m[1].trim(), a: m[2].trim() }))
      .filter(c => c.q && c.a)

    if (!cards.length) {
      const msg = '# Review — no flashcards yet\n\nRun a sleep cycle first — it generates cards from long-term learnings.\n'
      this.memory.write(`review/session-${day}.md`, msg)
      return msg
    }

    // deterministic-ish sample of up to 8 cards
    const sample = cards.sort(() => Math.random() - 0.5).slice(0, 8)
    const questions = sample.map((c, i) => `${i + 1}. ${c.q}`).join('\n')

    // blind self-test: can the brain answer its own cards?
    const answers = await chat(this.store.get().ai as AiProviderConfig, [
      {
        role: 'system',
        content: `You are taking a closed-book quiz on your own knowledge base. Answer each numbered question from memory — concise, one line each, format "N. answer". If unsure, say "don't know" honestly.`
      },
      { role: 'user', content: questions }
    ], [], this.localLlm?.endpoint)

    // grade: show correct answers next to model's attempt
    const grade = await chat(this.store.get().ai as AiProviderConfig, [
      {
        role: 'system',
        content: `Grade a quiz. For each question show: the model's answer, the correct answer, and PASS/FAIL (PASS = same fact, wording may differ). End with "Score: N/M". Be strict but fair.`
      },
      {
        role: 'user',
        content: `QUESTIONS:\n${questions}\n\nMODEL ANSWERS:\n${answers.text}\n\nCORRECT ANSWERS:\n${sample.map((c, i) => `${i + 1}. ${c.a}`).join('\n')}`
      }
    ], [], this.localLlm?.endpoint)

    const report = [
      `# Review session — ${day}`,
      `_${sample.length} cards sampled from ${cards.length} total_`,
      '',
      '## Questions', '', questions, '',
      '## Model answers (blind)', '', answers.text, '',
      '## Grading', '', grade.text, ''
    ].join('\n')
    this.memory.write(`review/session-${day}.md`, report)

    try {
      if (this.gitSync) await this.gitSync.syncNow()
    } catch { /* offline ok */ }
    void this.rag?.reindex().catch(() => {})
    return report
  }

  // ── Security audit: scan memory for leaked secrets ──
  // Deterministic pattern scan (no LLM needed) — reports file+line but
  // NEVER prints the secret value itself.

  async securityAudit(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10)
    const PATTERNS: [string, RegExp][] = [
      ['openai/generic api key', /\b(sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,})\b/],
      ['github token', /\b(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|gho_[A-Za-z0-9]{30,})\b/],
      ['slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
      ['aws key', /\bAKIA[0-9A-Z]{16}\b/],
      ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
      ['password assignment', /(?:password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"\s]{8,}['"]/i],
      ['bearer token', /bearer\s+[A-Za-z0-9._~+/=-]{20,}/i]
    ]
    const hits: string[] = []
    for (const rel of this.memory.allRelFiles()) {
      const content = this.memory.read(rel)
      if (!content) continue
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        for (const [label, re] of PATTERNS) {
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
      const msg = '# Skills evolution — nothing to review yet\n\nNo skills recorded. They accumulate from sleep cycles and `sb_remember kind=skill`.\n'
      this.memory.write(`insights/skills-${day}.md`, msg)
      return msg
    }

    // 1) deterministic dedupe on skills.md bullets
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

    // 2) LLM consolidation review
    const corpus = [
      skillsMd.slice(-8000),
      ...skillDocs.slice(-10)
    ].join('\n\n').slice(-20000)

    const res = await chat(this.store.get().ai as AiProviderConfig, [
      {
        role: 'system',
        content: `You are the skills curator of a personal knowledge system. Review the procedural skills below and output a consolidation report:

1. **Merge** — skills that are duplicates or should be one procedure
2. **Prune** — skills that are stale, wrong, or superseded (say why)
3. **Promote** — skills proven useful ≥2 times that deserve a dedicated page in skills/
4. **Gap** — recurring tasks with NO skill yet that should get one

Rules: be skeptical — fewer, sharper skills beat many vague ones. Ground every call in the text. Markdown, user's language, max ~400 words.`
      },
      { role: 'user', content: corpus }
    ], [], this.localLlm?.endpoint)

    const report = [
      `# Skills evolution — ${day}`,
      `_${deduped} duplicate bullet(s) removed from skills.md · ${skillFiles.length} skill page(s)_`,
      '', res.text, ''
    ].join('\n')
    this.memory.write(`insights/skills-${day}.md`, report)
    this.memory.append('long-term/skills.md', `\n\n## Evolution review ${day}\n\n${res.text}\n`)

    try {
      if (this.gitSync) await this.gitSync.syncNow()
    } catch { /* offline ok */ }
    void this.rag?.reindex().catch(() => {})
    return report
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
