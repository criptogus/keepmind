import { join } from 'node:path'

import { chat } from '../llm'
import type { AiProviderConfig } from '../../store'

import { activeForPrompt } from '../facts'

import { BrainContext } from './context'

export class BrainInsights extends BrainContext {
  async generateInsights(): Promise<string[]> {
    const lines = this.scriptedInsights()
    const day = new Date().toISOString().slice(0, 10)
    this.memory.write(this.memory.scopePath(`insights/${day}.md`), `# Insights — ${day}\n\n${lines.map(l => `- ${l}`).join('\n')}\n`)
    return lines
  }

  async dailySummary(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10)
    const today = this.memory.read(this.memory.scopePath(`short-term/${day}.md`)) ?? this.memory.read(this.memory.scopePath(`inbox/${day}.md`)) ?? ''
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
    for (const f of this.memory.list(this.memory.scopePath('tasks'))) {
      const c = this.memory.read(this.memory.scopePath(`tasks/${f}`)) ?? ''
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
    this.memory.write(this.memory.scopePath(`summaries/${day}.md`), text)
    this.note('processed', `Resumo de ${day} pronto.`, `summaries/${day}.md`)
    return text
  }

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
    const src = [
      activeForPrompt(this.memory.read(this.memory.scopePath('long-term/facts.md')) ?? ''),
      this.memory.read(this.memory.scopePath('long-term/lessons.md')) ?? '',
      this.memory.read(this.memory.scopePath('long-term/skills.md')) ?? ''
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
