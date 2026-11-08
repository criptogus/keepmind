import type { AgentPersona, AiProviderConfig } from '../../store'
import { chat, type ChatMessage, type ToolDefinition } from '../llm'

import { BrainRuntime } from './runtime'
import { slug } from './utils'

export class BrainContext extends BrainRuntime {
  protected buildSystemContext(agent: AgentPersona, recall = ''): string {
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

  protected toolDefinitions(): ToolDefinition[] {
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

  protected async execTool(name: string, args: Record<string, unknown>): Promise<string> {
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
      const file = kind === 'note'
        ? `long-term/notes/${slug(title)}.md`
        : `long-term/${kind}s.md` // facts.md / lessons.md / skills.md / decisions.md
      this.memory.append(file, `\n\n## ${title}\n\n${content}\n`)
      return `Saved to memory/${file} (long-term · classified as ${kind})`
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

}
