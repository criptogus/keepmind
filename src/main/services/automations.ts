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
  else if (/\b(daily summary|sum[aá]rio|recap|briefing)\b/.test(t)) kind = 'summary'

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

  constructor(private store: Store, private brain: Brain, private log: (m: string) => void) {}

  onRun(cb: (a: Automation) => void) { this.listeners.add(cb); return () => this.listeners.delete(cb) }

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
      this.running.add(auto.id)
      try {
        await this.run(auto)
        this.store.set({
          automations: this.store.get().automations.map(a =>
            a.id === auto.id ? { ...a, lastRunAt: new Date().toISOString() } : a)
        })
        for (const cb of this.listeners) cb(auto)
      } catch (e) {
        this.log(`automation ${auto.name} failed: ${e}`)
      } finally {
        this.running.delete(auto.id)
      }
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
        const [h, m] = (auto.time ?? '08:00').split(':').map(Number)
        const due = new Date(now); due.setHours(h, m, 0, 0)
        if (now < due) return false
        if (!last) return true
        return last.toDateString() !== now.toDateString()
      }
      case 'weekly': {
        const [h, m] = (auto.time ?? '09:00').split(':').map(Number)
        const due = new Date(now); due.setHours(h, m, 0, 0)
        if (now.getDay() !== (auto.weekday ?? 1) || now < due) return false
        if (!last) return true
        return last.toDateString() !== now.toDateString()
      }
    }
  }

  async run(auto: Automation) {
    this.log(`automation "${auto.name}" running (${auto.kind})`)
    if (auto.kind === 'sleep') {
      await this.brain.sleep()
    } else if (auto.kind === 'summary') {
      await this.brain.generateInsights()
      await this.brain.dailySummary()
    } else {
      await this.brain.chat('brain',
        `[AUTOMATION] ${auto.instruction}\n\n` +
        `This is a scheduled automation. Do the task, save important results to memory, and reply with a short report of what you did.`)
    }
    this.log(`automation "${auto.name}" done`)
  }
}
