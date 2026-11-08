import type { AiProviderConfig } from '../../store'
import { chat } from '../llm'

import { BrainSleep } from './sleep'
import { splitBlocks } from './utils'

export class BrainMaintenance extends BrainSleep {
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

  protected async enrichNote(rel: string, entityNames: string[]): Promise<boolean> {
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
}
