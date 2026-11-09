import { randomBytes } from 'node:crypto'
import type { Store, Automation } from '../store'
import type { Brain } from './brain'

// ── Automations: cron-like jobs described in natural language ──
//
// The user writes e.g. "every day at 8am, summarize my unread whatsapp
// messages and save the important ones" — we parse a schedule, and the
// scheduler runs it through the brain (which has memory + MCP tools).

export interface ParsedSchedule {
  kind: Automation['kind']
  schedule: Automation['schedule']
  time?: string          // HH:MM
  everyMinutes?: number
  weekday?: number
  label: string          // human-readable, shown in UI before creating
  name: string           // suggested name
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6
}

export function parseNaturalSchedule(text: string): ParsedSchedule {
  const t = text.toLowerCase()

  // What kind of job?
  let kind: Automation['kind'] = 'brain'
  if (/\b(sleep|sono|dormir|learning cycle)\b/.test(t)) kind = 'sleep'
  else if (/\b(librarian|hygiene|defrag|vault|dedup|limpeza|faxina)\b/.test(t)) kind = 'librarian'
  else if (/\b(compact|compactar|podar mem[oó]ria)\b/.test(t)) kind = 'compact'
  else if (/\b(escala|escalar|atrasad|prioridade alta)\b/.test(t)) kind = 'escalate'
  else if (/\b(lacuna|search gap|gaps)\b/.test(t)) kind = 'gaps'
  else if (/\b(evol|evolve|evolução|self-improv|meta-learn|upgrade the brain)\b/.test(t)) kind = 'evolve'
  else if (/\b(enrich|enriquec|annotate|tag notes|wikilink)\b/.test(t)) kind = 'enrich'
  else if (/\b(quiz|review|flashcard|revis|estudo|self-test|spaced)\b/.test(t)) kind = 'review'
  else if (/\b(triage|triagem|sort inbox|classify|classificar|route captures)\b/.test(t)) kind = 'triage'
  else if (/\b(security|seguran[çc]a|secret|vazamento|credential|audit)\b/.test(t)) kind = 'security'
  else if (/\b(skills?|habilidades)\b/.test(t) && /\b(evol|review|curat|consolid|promot)/.test(t)) kind = 'skills'
  else if (/\bbriefing\b/.test(t)) kind = 'briefing'
  else if (/\b(daily summary|sum[aá]rio|recap)\b/.test(t)) kind = 'summary'

  // Suggested name: first meaningful words
  const name = text.trim().split(/\s+/).slice(0, 7).join(' ').replace(/[.,;:!?]+$/, '') || 'automation'

  // Interval: "every 30 minutes", "a cada 2 horas", "every hour"
  const interval = t.match(/every\s+(\d+|a|an|one)\s*(minute|min|hour|hr|day)s?\b/) ??
                   t.match(/(?:a cada|every)\s+(\d+|uma?|one)\s*(minuto|min|hora|hr|dia)s?\b/)
  if (interval) {
    const n = interval[1]
    const unit = interval[2]
    const num = /\d/.test(n) ? parseInt(n, 10) : 1
    const minutes = unit.startsWith('min') || unit.startsWith('minuto') ? num
      : unit.startsWith('h') || unit.startsWith('hora') ? num * 60
      : num * 1440
    return {
      kind, schedule: 'interval', everyMinutes: minutes,
      label: `every ${minutes < 60 ? `${minutes} min` : minutes < 1440 ? `${minutes / 60}h` : `${minutes / 1440}d`}`,
      name
    }
  }

  // Extract time: "at 8am", "8:30", "às 20h", "08:00"
  let time: string | undefined
  const tm = t.match(/(?:at|às|as)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|h)?\b/) ??
             t.match(/\b(\d{1,2}):(\d{2})\b/) ??
             t.match(/\b(\d{1,2})\s*(am|pm)\b/)
  if (tm) {
    let h = parseInt(tm[1], 10)
    const m = tm[2] ? parseInt(tm[2], 10) : 0
    const mer = tm[3]
    if (mer === 'pm' && h < 12) h += 12
    if (mer === 'am' && h === 12) h = 0
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  // Weekly: "every monday", "weekly on friday"
  const weekly = t.match(/\b(?:every|each|weekly|weekly on|toda|todo)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/)
  if (weekly || /\bweekly\b|\bsemanal\b/.test(t)) {
    let weekday = weekly ? WEEKDAYS[weekly[1]] : undefined
    if (weekday == null) {
      for (const [k, v] of Object.entries(WEEKDAYS)) {
        if (new RegExp(`\\b${k}\\b`).test(t)) { weekday = v; break }
      }
    }
    return {
      kind, schedule: 'weekly', weekday: weekday ?? 1, time: time ?? '09:00',
      label: `every ${weekdayName(weekday ?? 1)} at ${time ?? '09:00'}`,
      name
    }
  }

  // Daily: "every day", "daily", "every morning", "todo dia", default fallback
  const isDaily = /\b(daily|every\s+day|every\s+morning|every\s+night|every\s+evening|todo dia|diariamente|cada dia|every day)\b/.test(t)
  if (isDaily || !interval) {
    const assumed = !isDaily
    return {
      kind, schedule: 'daily', time: time ?? (assumed ? '08:00' : undefined) ?? '08:00',
      label: `every day at ${time ?? '08:00'}${assumed ? ' (assumed — add "at HH:MM" to change)' : ''}`,
      name
    }
  }

  return { kind, schedule: 'daily', time: '08:00', label: 'every day at 08:00', name }
}

function weekdayName(d: number): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d] ?? 'Monday'
}

// ── Scheduler ──

export class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null
  private running = new Set<string>()
  private listeners = new Set<(a: Automation) => void>()
  private payloads = new Map<string, string>()
  onStatus: ((event: { phase: 'start' | 'done' | 'error'; name: string; summary?: string }) => void) | null = null

  constructor(private store: Store, private brain: Brain, private log: (m: string) => void) {}

  onRun(cb: (a: Automation) => void) { this.listeners.add(cb); return () => this.listeners.delete(cb) }

  // Toggle the webhook trigger for an automation. Returns the updated
  // automation (with token) so callers can show the URL to the user.
  setWebhook(id: string, enabled: boolean): Automation | undefined {
    const autos = this.store.get().automations.map(a => a.id === id ? {
      ...a,
      webhook: enabled,
      webhookToken: enabled ? (a.webhookToken ?? `wh_${randomBytes(18).toString('hex')}`) : undefined
    } : a)
    this.store.set({ automations: autos })
    return autos.find(a => a.id === id)
  }

  // Single entry point for "run this automation now-ish": used by the cron
  // tick AND by external webhook triggers. Approval-mode jobs are queued
  // for the user instead of executing. Returns what happened.
  async fire(auto: Automation, payload?: string): Promise<'ran' | 'queued' | 'busy' | 'error'> {
    if (auto.mode === 'approval') {
      const pending = this.store.get().pendingApprovals
      if (!pending.some(p => p.automationId === auto.id)) {
        this.store.set({
          pendingApprovals: [...pending, {
            id: `ap-${Date.now().toString(36)}-${auto.id}`,
            automationId: auto.id,
            name: auto.name,
            kind: auto.kind,
            instruction: auto.instruction,
            createdAt: new Date().toISOString()
          }]
        })
        this.log(`automation "${auto.name}" queued for approval`)
        for (const cb of this.listeners) cb(auto)
      }
      return 'queued'
    }
    if (this.running.has(auto.id)) return 'busy'
    this.running.add(auto.id)
    if (payload?.trim()) this.payloads.set(auto.id, payload.slice(0, 8000))
    try {
      await this.run(auto)
      for (const cb of this.listeners) cb(auto)
      return 'ran'
    } catch (e) {
      this.log(`automation ${auto.name} failed: ${e}`)
      return 'error'
    } finally {
      this.running.delete(auto.id)
    }
  }

  start() {
    this.timer = setInterval(() => { void this.tick() }, 30_000)
    setTimeout(() => { void this.tick() }, 15_000)
  }

  stop() { if (this.timer) clearInterval(this.timer) }

  private async tick() {
    if (!this.store.isConfigured) return
    const now = new Date()
    for (const auto of this.store.get().automations) {
      if (!auto.enabled || this.running.has(auto.id)) continue
      if (!this.isDue(auto, now)) continue

      // fire() handles approval-queueing and execution; lastRunAt is marked
      // for every outcome so a failing job retries on its next schedule
      // instead of every 30s tick.
      await this.fire(auto)
      this.store.set({
        automations: this.store.get().automations.map(a =>
          a.id === auto.id ? { ...a, lastRunAt: new Date().toISOString() } : a)
      })
    }
  }

  private isDue(auto: Automation, now: Date): boolean {
    const last = auto.lastRunAt ? new Date(auto.lastRunAt) : null
    switch (auto.schedule) {
      case 'interval': {
        const every = auto.everyMinutes ?? 60
        if (!last) return true
        return now.getTime() - last.getTime() >= every * 60_000
      }
      case 'daily': {
        const due = lastOccurrence(now, auto.time ?? '08:00')
        // First run waits for today's clock. A later open catches the last missed slot.
        if (!last) return now >= due && due.toDateString() === now.toDateString()
        return last < due
      }
      case 'weekly': {
        const due = lastWeekly(now, auto.weekday ?? 1, auto.time ?? '09:00')
        if (!last) return now >= due && due.toDateString() === now.toDateString()
        return last < due
      }
      default: {
        const neverSchedule: never = auto.schedule
        void neverSchedule
        return false
      }
    }
  }

  async run(auto: Automation) {
    this.log(`automation "${auto.name}" running (${auto.kind})`)
    this.onStatus?.({ phase: 'start', name: auto.name })
    this.brain.setActivitySource(`auto:${auto.name}`)
    await this.brain.ensureProviderReady()
    const payload = this.payloads.get(auto.id)
    this.payloads.delete(auto.id)
    let summary = 'Concluído.'
    try {
      summary = await this.execute(auto, payload)
      this.onStatus?.({ phase: 'done', name: auto.name, summary })
    } catch (e) {
      summary = e instanceof Error ? e.message : String(e)
      this.onStatus?.({ phase: 'error', name: auto.name, summary })
      throw e
    } finally {
      this.store.set({
        automations: this.store.get().automations.map(a =>
          a.id === auto.id ? { ...a, lastSummary: summary } : a)
      })
    }
    this.log(`automation "${auto.name}" done`)
  }

  private async execute(auto: Automation, payload?: string): Promise<string> {
    const event = payload?.trim()
      ? `\n\nEvento recebido pelo webhook:\n${payload.trim().slice(0, 4000)}`
      : ''
    switch (auto.kind) {
      case 'sleep': {
        const r = await this.brain.sleep()
        return r.summary
      }
      case 'librarian':
        return firstLine(await this.brain.librarian())
      case 'evolve':
        return firstLine(await this.brain.evolve())
      case 'enrich': {
        const r = await this.brain.enrich()
        return `Enriquecidas ${r.enriched} notas.`
      }
      case 'review':
        return firstLine(await this.brain.review())
      case 'security':
        return firstLine(await this.brain.securityAudit())
      case 'skills':
        return firstLine(await this.brain.evolveSkills())
      case 'triage':
        return firstLine(await this.brain.triageInbox())
      case 'summary': {
        await this.brain.generateInsights()
        return firstLine(await this.brain.dailySummary())
      }
      case 'briefing':
        return firstLine(await this.brain.briefing(true))
      case 'escalate':
        return this.brain.escalateTasks()
      case 'compact':
        return this.brain.compactLongTerm()
      case 'gaps':
        return this.brain.closeSearchGaps()
      case 'brain': {
        const r = await this.brain.chat('brain',
          `[AUTOMATION] ${auto.instruction}${event}\n\n` +
          `This is a scheduled automation. Do the task, save important results to memory, and reply with a short report of what you did.`)
        return firstLine(r.text)
      }
      default: {
        const neverKind: never = auto.kind
        return `Tipo de automação desconhecido: ${neverKind}`
      }
    }
  }
}

function lastOccurrence(now: Date, time: string): Date {
  const [h, m] = time.split(':').map(Number)
  const due = new Date(now)
  due.setHours(h || 0, m || 0, 0, 0)
  if (now < due) due.setDate(due.getDate() - 1)
  return due
}

function lastWeekly(now: Date, weekday: number, time: string): Date {
  const due = lastOccurrence(now, time)
  const delta = (due.getDay() - weekday + 7) % 7
  due.setDate(due.getDate() - delta)
  return due
}

function firstLine(text: string): string {
  const line = text.split('\n').map(l => l.replace(/^[#>*_\-\s]+/, '').trim()).find(Boolean)
  return (line ?? 'Concluído.').slice(0, 180)
}
