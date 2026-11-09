import type { Store, Automation } from '../store'
import type { Memory } from './brain'
import type { AutomationScheduler } from './automations'

// ── BrainHealth: meta-insights ABOUT the second brain ──
// Not "insights about the user" — diagnostics on the brain itself: which
// crons should run, what's idle, where intelligence is leaking. Every
// recommendation carries evidence and an applicable action.

export interface HealthAction {
  type: 'enable-automation' | 'create-automation' | 'run-now'
  automationId?: string
  automation?: Omit<Automation, 'id' | 'createdAt'> & { id?: string }
}

export interface HealthRecommendation {
  id: string
  title: string
  detail: string
  impact: 'high' | 'medium' | 'low'
  action: HealthAction | null
}

export interface HealthReport {
  generatedAt: string
  stats: {
    files: number
    mdFiles: number
    entities: number
    notes: number
    tasksOpen: number
    writes7d: number
    topSources: { source: string; count: number }[]
    automationsEnabled: number
    automationsTotal: number
    searchGaps: number
    skills: number
    skillsStale: number
  }
  recommendations: HealthRecommendation[]
}

const DAY = 86_400_000

function countLines(file: string | null): number {
  if (!file) return 0
  return file.split('\n').filter(l => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith('<!--')).length
}

export function analyzeHealth(store: Store, memory: Memory): HealthReport {
  const cfg = store.get()
  const now = Date.now()
  const weekAgo = now - 7 * DAY

  const all = memory.allRelFiles().filter(f => f.endsWith('.md'))
  const journal = memory.activity(2000)
  const weekEntries = journal.filter(e => e.ts >= weekAgo)

  const perSource = new Map<string, number>()
  for (const e of weekEntries) perSource.set(e.source, (perSource.get(e.source) ?? 0) + 1)
  const topSources = [...perSource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([source, count]) => ({ source, count }))

  const automations = cfg.automations ?? []
  const enabled = automations.filter(a => a.enabled)

  const gapsRaw = memory.read('ops/search-gaps.md') ?? ''
  const searchGaps = (gapsRaw.match(/^- /gm) ?? []).length

  const skillFiles = memory.list('skills')
  const skillsStale = skillFiles.filter(f => {
    const mt = memory.fileMtime(`skills/${f}`) ?? now
    return now - mt > 30 * DAY
  }).length

  const stats: HealthReport['stats'] = {
    files: all.length,
    mdFiles: all.length,
    entities: memory.list('entities').length,
    notes: memory.list('notes').length,
    tasksOpen: memory.list('tasks').filter(f => {
      const c = memory.read(`tasks/${f}`) ?? ''
      return /status:\s*open/i.test(c)
    }).length,
    writes7d: weekEntries.length,
    topSources,
    automationsEnabled: enabled.length,
    automationsTotal: automations.length,
    searchGaps,
    skills: skillFiles.length,
    skillsStale
  }

  const recs: HealthRecommendation[] = []
  const hasKind = (kind: Automation['kind']) => enabled.some(a => a.kind === kind)
  const hasAutoNamed = (re: RegExp) => enabled.some(a => re.test(a.name))

  // ── 1. No learning loop at all ──
  if (enabled.length === 0) {
    recs.push({
      id: 'no-automations', impact: 'high',
      title: 'The brain never sleeps',
      detail: `${stats.files} files of memory but zero enabled automations — nothing consolidates short-term logs, nothing learns at night, nothing reports. Enable the core learning loop.`,
      action: { type: 'create-automation', automation: {
        name: 'Nightly sleep cycle', kind: 'sleep', schedule: 'daily', time: '23:00',
        instruction: 'Review the day and distill durable memory.', enabled: true, mode: 'auto'
      } }
    })
    recs.push({
      id: 'no-summary', impact: 'medium',
      title: 'No daily summary',
      detail: 'Without a morning summary the brain produces no daily digest — you lose the "what happened yesterday" signal that feeds planning.',
      action: { type: 'create-automation', automation: {
        name: 'Morning summary', kind: 'summary', schedule: 'daily', time: '08:00',
        instruction: 'Daily summary of yesterday and briefing for today.', enabled: true, mode: 'auto'
      } }
    })
  }

  // ── 2. Search gaps = unanswered questions = intelligence leaking ──
  if (searchGaps > 0 && !hasKind('brain')) {
    recs.push({
      id: 'search-gaps', impact: 'high',
      title: `${searchGaps} unanswered queries in search-gaps.md`,
      detail: 'Queries that found nothing are recorded in ops/search-gaps.md — each one is a hole in the brain. A weekly job can research and answer them.',
      action: { type: 'create-automation', automation: {
        name: 'Search-gap researcher', kind: 'brain', schedule: 'weekly', weekday: 5, time: '10:00',
        instruction: 'Read ops/search-gaps.md, pick the top unanswered queries, research them using memory + MCP tools, and save durable answers to long-term notes. Then prune answered gaps.',
        enabled: true, mode: 'auto'
      } }
    })
  }

  // ── 3. Entity layer starving ──
  if (stats.notes > 30 && stats.entities < Math.max(5, stats.notes / 10) && !hasKind('enrich')) {
    recs.push({
      id: 'entities-starving', impact: 'medium',
      title: 'Knowledge graph is underfed',
      detail: `${stats.notes} notes but only ${stats.entities} entity pages — [[wikilinks]] and entity extraction are what make the brain navigable. Enrichment builds them.`,
      action: { type: 'create-automation', automation: {
        name: 'Nightly enrichment', kind: 'enrich', schedule: 'daily', time: '23:30',
        instruction: 'Enrich recent notes: extract entities, add wikilinks, tags and summaries where missing.',
        enabled: true, mode: 'auto'
      } }
    })
  }

  // ── 4. Working memory overflowing ──
  const shortCount = memory.shortTermFiles().length
  const mediumCount = memory.mediumTermFiles().length
  if (shortCount > 14 && mediumCount === 0 && !hasKind('librarian')) {
    recs.push({
      id: 'no-consolidation', impact: 'medium',
      title: 'Working memory never consolidates',
      detail: `${shortCount} daily logs in short-term/ and zero weekly consolidations — the brain is accumulating raw noise instead of distilled memory.`,
      action: { type: 'create-automation', automation: {
        name: 'Weekly librarian', kind: 'librarian', schedule: 'weekly', weekday: 0, time: '10:00',
        instruction: 'Consolidate the past week of short-term logs into medium-term summaries; deduplicate and archive stale entries.',
        enabled: true, mode: 'auto'
      } }
    })
  }

  // ── 5. Passive brain — nothing writes except sync ──
  const agentWrites = weekEntries.filter(e => e.source.startsWith('chat') || e.source.startsWith('auto:') || e.source === 'sleep' || e.source === 'summary').length
  if (stats.writes7d > 0 && agentWrites === 0) {
    recs.push({
      id: 'passive-brain', impact: 'medium',
      title: 'The brain is only mirroring, not thinking',
      detail: `Last 7 days: ${stats.writes7d} changes, all from sync/system — no chat, sleep or automation output. Connect an agent (Agents page) or enable a cron so the brain produces, not just stores.`,
      action: enabled.length === 0 ? { type: 'create-automation', automation: {
        name: 'Nightly sleep cycle', kind: 'sleep', schedule: 'daily', time: '23:00',
        instruction: 'Review the day and distill durable memory.', enabled: true, mode: 'auto'
      } } : null
    })
  }

  // ── 6. Spaced repetition starved ──
  const cardsRaw = memory.read('review/cards.md') ?? ''
  if (stats.notes > 20 && countLines(cardsRaw) < 5 && !hasKind('review')) {
    recs.push({
      id: 'no-review', impact: 'low',
      title: 'No spaced-repetition loop',
      detail: 'The brain stores knowledge but never quizzes it — review/flashcards are how memory gets stronger over time.',
      action: { type: 'create-automation', automation: {
        name: 'Weekly review session', kind: 'review', schedule: 'weekly', weekday: 6, time: '18:00',
        instruction: 'Generate a spaced-repetition review from recent memory: quiz questions, grade answers, update cards.md.',
        enabled: true, mode: 'auto'
      } }
    })
  }

  // ── 7. Skills layer empty ──
  if (stats.files > 100 && memory.list('skills').length === 0 && !hasKind('skills')) {
    recs.push({
      id: 'no-skills', impact: 'low',
      title: 'No procedural skills captured',
      detail: 'skills/ is empty — repeated workflows ("how we deploy", "how we write reports") should crystallize into reusable procedures the brain can follow.',
      action: { type: 'create-automation', automation: {
        name: 'Weekly skills curation', kind: 'skills', schedule: 'weekly', weekday: 0, time: '11:00',
        instruction: 'Review the week for repeated procedures and promote them into skills/ pages; retire stale skills.',
        enabled: true, mode: 'auto'
      } }
    })
  }

  // ── 8. Security audit never scheduled ──
  if (!hasKind('security') && !hasAutoNamed(/security|seguran/i)) {
    recs.push({
      id: 'no-security', impact: 'low',
      title: 'No security audit routine',
      detail: 'A monthly audit checks for leaked secrets, stale sensitive notes and permission drift across connectors.',
      action: { type: 'create-automation', automation: {
        name: 'Monthly security audit', kind: 'security', schedule: 'weekly', weekday: 1, time: '09:00',
        instruction: 'Audit memory for leaked secrets, stale sensitive material and connector permission drift; write findings to ops/security.md.',
        enabled: true, mode: 'approval'
      } }
    })
  }

  // ── 8b. Skills going stale ──
  if (skillFiles.length > 0 && skillsStale === skillFiles.length && !hasKind('evolve')) {
    recs.push({
      id: 'skills-stale', impact: 'medium',
      title: `All ${skillFiles.length} skills are 30+ days old`,
      detail: 'Procedural skills decay as workflows change — an evolve/skills review keeps the bank sharp and prunes what no longer works.',
      action: { type: 'create-automation', automation: {
        name: 'Weekly skills evolution', kind: 'evolve', schedule: 'weekly', weekday: 0, time: '12:00',
        instruction: 'Review skills/ pages: update stale procedures, merge duplicates, propose new skills from recent repeated workflows.',
        enabled: true, mode: 'auto'
      } }
    })
  }

  // ── 9. Enabled but never ran ──
  for (const a of enabled) {
    const last = a.lastRunAt ? new Date(a.lastRunAt).getTime() : 0
    if (!last || now - last > 7 * DAY) {
      recs.push({
        id: `stale-${a.id}`, impact: 'medium',
        title: `"${a.name}" hasn't run in 7+ days`,
        detail: a.lastRunAt
          ? `Last run: ${new Date(a.lastRunAt).toLocaleString()} — schedule (${a.schedule}${a.time ? ` ${a.time}` : ''}) may be misconfigured or the app was closed.`
          : 'Never ran since creation — check its schedule or trigger it manually.',
        action: { type: 'run-now', automationId: a.id }
      })
    }
  }

  // ── 10. Healthy baseline ──
  if (recs.length === 0) {
    recs.push({
      id: 'healthy', impact: 'low',
      title: 'The brain is healthy',
      detail: `All learning loops are enabled and running — ${enabled.length} automations active, ${stats.writes7d} writes in 7 days across ${topSources.length || '—'} sources. Keep feeding it.`,
      action: null
    })
  }

  // sort by impact
  const rank = { high: 0, medium: 1, low: 2 }
  recs.sort((a, b) => rank[a.impact] - rank[b.impact])

  return { generatedAt: new Date().toISOString(), stats, recommendations: recs }
}

export async function applyHealth(
  store: Store,
  memory: Memory,
  automations: AutomationScheduler | null,
  recId: string
): Promise<HealthReport> {
  const report = analyzeHealth(store, memory)
  const rec = report.recommendations.find(r => r.id === recId)
  if (!rec?.action) return report

  const autos = [...(store.get().automations ?? [])]
  const action = rec.action

  if (action.type === 'enable-automation' && action.automationId) {
    store.set({ automations: autos.map(a => a.id === action.automationId ? { ...a, enabled: true } : a) })
  } else if (action.type === 'create-automation' && action.automation) {
    const a = action.automation
    const auto: Automation = {
      ...a,
      id: `auto_health_${Date.now().toString(36)}`,
      enabled: true,
      createdAt: new Date().toISOString()
    }
    store.set({ automations: [...autos, auto] })
  } else if (action.type === 'run-now' && action.automationId) {
    const auto = autos.find(a => a.id === action.automationId)
    if (auto && automations) await automations.fire(auto)
  }

  return analyzeHealth(store, memory)
}
