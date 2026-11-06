import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { chat, chatStream, type ChatMessage, type ToolDefinition } from './llm'
import type { AiProviderConfig } from '../store'
import type { McpManager } from './mcp'
import type { LocalLlm } from './local-llm'
import type { AgentPersona } from '../store'
import * as github from './github'
import type { GitHubConfig, Store } from '../store'

// ── Memory: markdown files in the local memory dir, mirrored to the GitHub repo ──

export class Memory {
  constructor(private dir: string, private gh: GitHubConfig | null) {
    mkdirSync(this.dir, { recursive: true })
    for (const sub of ['inbox', 'insights', 'summaries', 'agents']) {
      mkdirSync(join(this.dir, sub), { recursive: true })
    }
  }

  private path(...parts: string[]) { return join(this.dir, ...parts) }

  write(relative: string, content: string) {
    const p = this.path(relative)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, content, 'utf8')
  }

  append(relative: string, content: string) {
    const p = this.path(relative)
    mkdirSync(join(p, '..'), { recursive: true })
    appendFileSync(p, content, 'utf8')
  }

  read(relative: string): string | null {
    const p = this.path(relative)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }

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

  constructor(store: Store, mcp: McpManager | null, localLlm: LocalLlm | null = null) {
    this.store = store
    this.mcp = mcp
    this.localLlm = localLlm
    this.memory = new Memory(store.memoryDir, store.get().github.accessToken ? store.get().github : null)
  }

  setMcp(mcp: McpManager) { this.mcp = mcp }
  setLocalLlm(l: LocalLlm) { this.localLlm = l }

  getMemory() { return this.memory }

  private buildSystemContext(agent: AgentPersona): string {
    const cfg = this.store.get()
    const parts: string[] = [
      agent.persona,
      '',
      '## Connected sources',
      `- GitHub memory repo: ${cfg.github.repoUrl ?? 'not connected'}`,
      `- AI provider: ${cfg.ai.provider} (${cfg.ai.model ?? 'default'})`,
      `- MCP servers running: ${this.mcp?.runningServers.join(', ') || 'none'}`
    ]
    // Inject recent memory digest
    const digest = this.memory.read('inbox/digest.md')
    if (digest) parts.push('', '## Recent memory digest', digest.slice(0, 4000))
    const insights = this.memory.list('insights').slice(-5)
    for (const f of insights) {
      const c = this.memory.read(`insights/${f}`)
      if (c) parts.push('', `### ${f}`, c.slice(0, 1200))
    }
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
      const file = `inbox/${slug(title)}.md`
      this.memory.write(file, `# ${title}\n\n${content}\n\n---\nsaved ${new Date().toISOString()}\n`)
      return `Saved to memory/${file}`
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
    const cfg = this.store.get()
    const agent = cfg.agents.find(a => a.id === agentId) ?? cfg.agents[0]
    const messages: ChatMessage[] = [
      { role: 'system', content: this.buildSystemContext(agent) },
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

    // Persist exchange to memory
    const day = new Date().toISOString().slice(0, 10)
    this.memory.append(`inbox/${day}.md`, `\n\n## ${new Date().toLocaleTimeString()} — ${agent.name}\n\n**You:** ${userMessage}\n\n**${agent.name}:** ${finalText}\n`)
    return finalText
  }

  async streamChat(agentId: string, userMessage: string): Promise<string> {
    // Non-tool streaming path for snappy UX; falls back inside chat() for tool use
    return this.chat(agentId, userMessage)
  }

  async generateInsights(): Promise<string[]> {
    const cfg = this.store.get()
    const memoryFiles = this.memory.list('inbox').slice(-10)
    const corpus = memoryFiles.map(f => this.memory.read(`inbox/${f}`) ?? '').join('\n---\n').slice(-12000)
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
    const today = this.memory.read(`inbox/${day}.md`) ?? '(no activity today)'
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
