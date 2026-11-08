import type { AiProviderConfig } from '../../store'
import { refreshEntities } from '../entities'
import { chat } from '../llm'

import { BrainInsights } from './insights'
import { isoWeek } from './utils'

export class BrainSleep extends BrainInsights {
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
      await appendIf('facts.md', '', grab('===FACTS===', '===LESSONS==='))
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

    return { report: res.text, consolidated }
  }

  protected async consolidateShortTerm(): Promise<number> {
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
  protected entityCompleter(): (prompt: string) => Promise<string> {
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

  protected dedupeLongTerm(): number {
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

}
