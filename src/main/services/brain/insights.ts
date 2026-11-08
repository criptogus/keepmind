import type { AiProviderConfig } from '../../store'
import { chat } from '../llm'

import { BrainContext } from './context'

export class BrainInsights extends BrainContext {
  async generateInsights(): Promise<string[]> {
    const cfg = this.store.get()
    const memoryFiles = [...this.memory.shortTermFiles(), ...this.memory.list(this.memory.scopePath('inbox'))].slice(-10)
    const corpus = memoryFiles.map(f => {
      const dir = this.memory.read(this.memory.scopePath(`short-term/${f}`)) != null ? 'short-term' : 'inbox'
      return this.memory.read(this.memory.scopePath(`${dir}/${f}`)) ?? ''
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
    this.memory.write(this.memory.scopePath(`insights/${day}.md`), `# Insights — ${day}\n\n${lines.map(l => `- ${l}`).join('\n')}\n`)
    return lines
  }

  async dailySummary(): Promise<string> {
    const cfg = this.store.get()
    const day = new Date().toISOString().slice(0, 10)
    const today = this.memory.read(this.memory.scopePath(`short-term/${day}.md`)) ?? this.memory.read(this.memory.scopePath(`inbox/${day}.md`)) ?? '(no activity today)'
    const res = await chat(cfg.ai as AiProviderConfig, [
      {
        role: 'system',
        content: 'You write a warm, concise daily summary of a person\'s digital life. 5-8 bullet points max. Highlight what mattered, what\'s pending, one suggested focus for tomorrow. Plain language.'
      },
      { role: 'user', content: `Today\'s activity:\n${today.slice(-8000)}` }
    ], [], this.localLlm?.endpoint)
    this.memory.write(this.memory.scopePath(`summaries/${day}.md`), `# Daily summary — ${day}\n\n${res.text}\n`)
    return res.text
  }

  // ── Sleep mode: nightly learning cycle ──
  // 1) Reads recent short-term memory + insights
  // 2) Answers the 5 learning questions and writes a sleep report
  // 3) Extracts durable facts / lessons / skills into long-term memory
  // 4) Consolidates old short-term logs into medium-term weekly files
  // 5) Syncs everything to the GitHub repo

  protected recentCorpus(maxChars = 20000): string {
    const parts: string[] = []
    const short = this.memory.shortTermFiles().slice(-10)
    for (const f of short) {
      const c = this.memory.read(this.memory.scopePath(`short-term/${f}`))
      if (c) parts.push(`### ${f}\n${c}`)
    }
    // legacy inbox fallback
    for (const f of this.memory.list(this.memory.scopePath('inbox')).slice(-5)) {
      const c = this.memory.read(this.memory.scopePath(`inbox/${f}`))
      if (c) parts.push(`### inbox/${f}\n${c}`)
    }
    const insights = this.memory.list(this.memory.scopePath('insights')).slice(-5)
    for (const f of insights) {
      const c = this.memory.read(this.memory.scopePath(`insights/${f}`))
      if (c) parts.push(`### ${f}\n${c}`)
    }
    // knowledge gaps: searches that returned nothing (logged by MCP/RAG clients)
    const gaps = this.memory.read(this.memory.scopePath('ops/search-gaps.md'))
    if (gaps) parts.push(`### ops/search-gaps.md (unanswered queries)\n${gaps.slice(-3000)}`)
    const corpus = parts.join('\n\n').slice(-maxChars)
    return corpus
  }

  protected async generateFlashcards(): Promise<number> {
    // source: recent long-term learnings
    const src = ['facts.md', 'lessons.md', 'skills.md']
      .map(f => this.memory.read(this.memory.scopePath(`long-term/${f}`)) ?? '')
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
    const existing = this.memory.read(this.memory.scopePath('review/cards.md')) ?? ''
    const seen = new Set([...existing.matchAll(/^Q:\s*(.+)$/gm)].map(m => m[1].trim().toLowerCase()))
    const day = new Date().toISOString().slice(0, 10)
    const fresh = cards.filter(c => !seen.has(c.q.toLowerCase())).slice(0, 6)
    if (!fresh.length) return 0

    const block = `\n### ${day}\n\n` + fresh.map(c => `Q: ${c.q}\nA: ${c.a}`).join('\n\n') + '\n'
    this.memory.append(this.memory.scopePath('review/cards.md'), block)
    return fresh.length
  }

}
