import { join } from 'node:path'

import { chat } from '../llm'
import type { AiProviderConfig } from '../../store'

import { SECRET_PATTERNS } from '../redact'
import { evolutionHints, listVaultSkills, loadSakNotes, loadSkillThreats } from '../skillsHub'

import { splitBlocks, fnv } from './utils'

import { BrainSleep } from './sleep'

export class BrainMaintenance extends BrainSleep {
  async evolve(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10)
    const stats = this.memoryTierStats()

    // Gather the brain's recent self-reports as evidence
    const corpusParts: string[] = [`Memory stats: ${JSON.stringify(stats)}`]
    for (const r of this.memory.list(this.memory.scopePath('sleep')).sort().slice(-5)) {
      const c = this.memory.read(this.memory.scopePath(`sleep/${r}`))
      if (c) corpusParts.push(`### sleep/${r}\n${c.slice(0, 3000)}`)
    }
    for (const f of this.memory.list(this.memory.scopePath('insights')).sort().slice(-5)) {
      const c = this.memory.read(this.memory.scopePath(`insights/${f}`))
      if (c) corpusParts.push(`### insights/${f}\n${c.slice(0, 2000)}`)
    }
    const gaps = this.memory.read(this.memory.scopePath('ops/search-gaps.md'))
    if (gaps) corpusParts.push(`### unanswered queries (knowledge gaps)\n${gaps.slice(-3000)}`)
    const prior = this.memory.read(this.memory.scopePath('long-term/evolution.md'))
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
    this.memory.write(this.memory.scopePath(`insights/evolution-${day}.md`), report)
    this.memory.append(this.memory.scopePath('long-term/evolution.md'), `\n\n## ${day}\n\n${res.text}\n`)
    this.ensurePolicy()
    const proposal = res.text.replace(/\s+/g, ' ').trim().slice(0, 420)
    this.memory.append(this.memory.scopePath('ops/policy.md'), `\n- ${day}: ${proposal}\n`)
    this.note('improved', `Evolução de ${day} deixou uma proposta na política do cérebro.`, 'ops/policy.md')

    try {
      if (this.gitSync) await this.gitSync.syncNow()
      else await this.memory.syncToGitHub(`evolution ${day}`)
    } catch { /* offline ok */ }
    void this.rag?.reindex().catch(() => {})
    return res.text
  }

  protected enrichNote(rel: string, entityNames: string[]): boolean {
    const content = this.memory.read(this.memory.scopePath(rel)) ?? ''
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
    this.memory.write(this.memory.scopePath(rel), next)
    return true
  }

  async enrich(): Promise<{ enriched: number; report: string }> {
    const day = new Date().toISOString().slice(0, 10)
    const notes = this.memory.list(this.memory.scopePath('notes')).sort().slice(-30)
    const entityIndex = this.memory.read(this.memory.scopePath('entities/index.md')) ?? ''
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
    this.memory.write(this.memory.scopePath(`insights/enrich-${day}.md`), report)

    try {
      if (this.gitSync) await this.gitSync.syncNow()
    } catch { /* offline ok */ }
    void this.rag?.reindex().catch(() => {})
    this.note('improved', `Enriquecimento de ${day}: ${enriched} nota(s) ganharam resumo e ligações.`, `insights/enrich-${day}.md`)
    return { enriched, report }
  }

  async review(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10)
    const due = this.dueCards(5)
    const sentence = due.length
      ? `${due.length} card(s) esperam sua revisão em Hoje.`
      : 'Nenhum card vencido para revisar.'
    const report = `# Revisão — ${day}\n\n${sentence}\n\nA nota é sua, na tela Hoje.\n`
    this.memory.write(this.memory.scopePath(`review/session-${day}.md`), report)
    this.note(due.length ? 'needs-you' : 'processed', sentence, 'review/cards.md')
    return sentence
  }

  async securityAudit(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10)
    const PATTERNS = SECRET_PATTERNS
    const hits: string[] = []
    for (const rel of this.memory.allRelFiles()) {
      const content = this.memory.read(this.memory.scopePath(rel))
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
    this.memory.write(this.memory.scopePath(`insights/security-${day}.md`), text)
    this.note(hits.length ? 'needs-you' : 'processed', hits.length ? `Auditoria achou ${hits.length} possível(is) segredo(s). O valor não foi exibido.` : `Auditoria de ${day} não achou segredos.`, `insights/security-${day}.md`)
    return text
  }

  async evolveSkills(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10)
    const skillsMd = this.memory.read(this.memory.scopePath('long-term/skills.md')) ?? ''
    const skillFiles = this.memory.list(this.memory.scopePath('skills')).sort()
    const skillDocs = skillFiles.map(f => `### skills/${f}\n${(this.memory.read(this.memory.scopePath(`skills/${f}`)) ?? '').slice(0, 3000)}`)

    if (!skillsMd.trim() && !skillDocs.length) {
      const msg = `# Evolução de skills — ${day}\n\nAinda não há skills. Elas entram pelo sono, por \`sb_remember kind=skill\`, ou quando você instala um pacote do SuperagentSkill.\n`
      this.memory.write(this.memory.scopePath(`insights/skills-${day}.md`), msg)
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
      if (next !== skillsMd) this.memory.write(this.memory.scopePath('long-term/skills.md'), next)
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
    this.memory.write(this.memory.scopePath(`insights/skills-${day}.md`), report)
    this.memory.append(this.memory.scopePath('long-term/skills.md'), `\n\n## Evolução ${day}\n\n${res.text}\n`)
    this.note('improved', `Evolução de skills: ${vault.length} no cofre, ${notes.length} nota(s) do SuperagentSkill.`, `insights/skills-${day}.md`)

    try {
      if (this.gitSync) await this.gitSync.syncNow()
    } catch { /* offline ok */ }
    void this.rag?.reindex().catch(() => {})
    return report
  }

  async triageInbox(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10)
    if (!this.laya?.status().available) {
      const msg = '# Inbox triage — skipped\n\nLaya decision engine not installed (Settings → Decision engine).\n'
      this.memory.write(this.memory.scopePath(`insights/triage-${day}.md`), msg)
      return msg
    }

    const processed = new Set(
      (this.memory.read(this.memory.scopePath('ops/triaged-files.txt')) ?? '').split('\n').map(s => s.trim()).filter(Boolean)
    )
    const pending = this.memory.list(this.memory.scopePath('inbox')).filter(f => !processed.has(f)).sort()
    if (!pending.length) {
      const msg = '# Inbox triage — nothing new\n\nAll inbox files already triaged.\n'
      this.memory.write(this.memory.scopePath(`insights/triage-${day}.md`), msg)
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
      const content = this.memory.read(this.memory.scopePath(`inbox/${file}`)) ?? ''
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
          const existing = this.memory.read(this.memory.scopePath(`long-term/${dest}s.md`))?.slice(-4000) ?? ''
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
          this.memory.write(this.memory.scopePath(`tasks/${id}.md`),
            `# ${title}\n> status: open · priority: normal · created: ${new Date().toISOString()}\n\n${prov}${t}\n`)
        }
      } else if (dest === 'note') {
        this.memory.append(this.memory.scopePath(`notes/triage-${day}.md`),
          items.map(t => `## ${t.split(/[.\n]/)[0].slice(0, 70)}\n\n${prov}${t}\n`).join('\n'))
      } else if (dest === 'crm') {
        this.memory.append(this.memory.scopePath(`crm/interactions/triage-${day}.md`),
          `\n## ${day}\n\n` + items.map(t => `- ${t}`).join('\n') + '\n')
      } else if (dest === 'fact') {
        for (const item of items) this.proposeFact(item, 'agent', 'triagem', false)
        this.note('needs-you', `${items.length} fato(s) da triagem esperam você em Hoje.`, 'long-term/facts.md')
      } else {
        this.memory.append(this.memory.scopePath(`long-term/${dest}s.md`),
          `\n\n## ${day} (inbox triage)\n\n` + items.map(t => `- ${t}`).join('\n') + '\n')
      }
    }

    report.push('', `- ${blocksSeen} block(s) seen · ${kept} kept · ${dropped} discarded · ${dups} semantic duplicates skipped`)
    const text = report.join('\n') + '\n'
    this.memory.write(this.memory.scopePath(`insights/triage-${day}.md`), text)
    this.memory.write(this.memory.scopePath('ops/triaged-files.txt'), [...processed].sort().join('\n') + '\n')

    try { if (this.gitSync) await this.gitSync.syncNow() } catch { /* offline ok */ }
    void this.rag?.reindex().catch(() => {})
    return text
  }
}
