import { join } from 'node:path'

import { chat } from '../llm'
import type { AiProviderConfig } from '../../store'

import { refreshEntities } from '../entities'

import { isoWeek } from './utils'

import { BrainInsights } from './insights'

export class BrainSleep extends BrainInsights {
  async sleep(): Promise<{ report: string; consolidated: number; summary: string }> {
    const cfg = this.store.get()
    const day = new Date().toISOString().slice(0, 10)
    const corpus = this.recentCorpus()

    if (!corpus.trim()) {
      const report = `# Sleep cycle — ${day}\n\nNo memory activity to process yet. The brain sleeps peacefully. 💤\n`
      this.memory.write(this.memory.scopePath(`sleep/${day}.md`), report)
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
    this.memory.write(this.memory.scopePath(`sleep/${day}.md`), report)

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
        const existing = this.memory.read(this.memory.scopePath(`long-term/${file}`)) ?? ''
        if (await this.isSemanticDuplicate(clean, existing)) {
          console.log(`[brain] sleep: skipped duplicate ${file} section`)
          return
        }
        this.memory.append(this.memory.scopePath(`long-term/${file}`), `\n\n## ${day}\n\n${clean}\n`)
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
      const existingWeek = this.memory.read(this.memory.scopePath(target))
      if (existingWeek) {
        // A previous pass already opened this week. Append days that are
        // not in the file yet — never delete a log that was not copied.
        const fresh = files.filter(f => !existingWeek.includes(`## ${f.replace('.md', '')}`))
        if (fresh.length) {
          const extra = fresh.map(f => {
            const day = f.replace('.md', '')
            const content = this.memory.read(this.memory.scopePath(`short-term/${f}`)) ?? ''
            return `## ${day}\n\n${content.trim()}`
          })
          this.memory.append(this.memory.scopePath(target), `\n\n${extra.join('\n\n')}\n`)
        }
        for (const f of files) {
          const day = f.replace('.md', '')
          const merged = (this.memory.read(this.memory.scopePath(target)) ?? '').includes(`## ${day}`)
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
        const content = this.memory.read(this.memory.scopePath(`short-term/${f}`)) ?? ''
        const stats = `${(content.match(/^##\s+/gm) ?? []).length} sections · ${(content.match(/^[-*]\s+/gm) ?? []).length} bullets · ${content.length} chars`
        return `## ${day}\n\n_${stats}_\n\n${content.trim()}`
      })
      this.memory.write(this.memory.scopePath(target), `# Week ${week}\n\n${parts.join('\n\n')}\n`)
      for (const f of files) this.memory.remove(`short-term/${f}`)
      consolidated += files.length
    }
    return consolidated
  }

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

  protected dedupeLongTerm(): number {
    let removed = 0
    for (const file of ['lessons.md', 'skills.md']) {
      const rel = `long-term/${file}`
      const content = this.memory.read(this.memory.scopePath(rel))
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
      if (next !== content) this.memory.write(this.memory.scopePath(rel), next)
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
    this.memory.write(this.memory.scopePath(`insights/librarian-${day}.md`), report)
    this.note('improved', `Librarian de ${day}: ${consolidated} logs consolidados, ${deduped} duplicatas removidas, ${entities.created} entidades novas.`, `insights/librarian-${day}.md`)
    return report
  }
}
