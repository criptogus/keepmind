import { chat, type ChatMessage } from './llm'
import type { Memory } from './brain'
import type { Store } from '../store'
import type { LocalLlm } from './local-llm'

// ── Planner: notes, tasks and daily goals stored as synced markdown ──
// Everything lives under memory/ so GitSync mirrors it to the GitHub repo
// and external AIs can read/write the same files.

export interface Note {
  id: string          // filename without .md
  title: string
  body: string        // markdown body (without the # title line)
  updated: string
}

export interface Task {
  id: string
  title: string
  done: boolean
  priority: 'low' | 'normal' | 'high'
  due: string | null   // YYYY-MM-DD
  created: string
  notes: string
}

export interface GoalItem { text: string; done: boolean }

export interface DailyGoals { date: string; items: GoalItem[] }

const today = () => new Date().toISOString().slice(0, 10)

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'item'
}

function noteTitle(content: string, fallback: string): string {
  const m = content.match(/^#\s+(.+)$/m)
  return m?.[1]?.trim() || fallback
}

function noteBody(content: string): string {
  return content.replace(/^#\s+[^\n]*\n?/, '').replace(/\n?---\n(created|updated):[^\n]*\n?/g, '\n').trim()
}

function parseTaskMeta(line: string) {
  const meta: Record<string, string> = {}
  for (const part of line.split('·')) {
    const [k, v] = part.split(':').map(s => s.trim())
    if (k && v) meta[k] = v
  }
  return meta
}

export class Planner {
  constructor(
    private memory: Memory,
    private store: Store,
    private localLlm: LocalLlm | null = null
  ) {}

  // ── Notes ──

  listNotes(): Note[] {
    return this.memory.list(this.memory.scopePath('notes')).sort().reverse().map(f => {
      const content = this.memory.read(this.memory.scopePath(`notes/${f}`)) ?? ''
      const id = f.replace(/\.md$/, '')
      const m = content.match(/updated:\s*(\S+)/)
      return {
        id,
        title: noteTitle(content, id),
        body: noteBody(content),
        updated: m?.[1] ?? ''
      }
    })
  }

  getNote(id: string): Note | null {
    const content = this.memory.read(this.memory.scopePath(`notes/${id}.md`))
    if (content == null) return null
    return {
      id,
      title: noteTitle(content, id),
      body: noteBody(content),
      updated: content.match(/updated:\s*(\S+)/)?.[1] ?? ''
    }
  }

  saveNote(id: string | null, title: string, body: string): Note {
    const slugId = id ?? slug(title)
    const now = new Date().toISOString()
    const existing = this.memory.read(this.memory.scopePath(`notes/${slugId}.md`)) ?? ''
    const created = existing.match(/created:\s*(\S+)/)?.[1] ?? now
    this.memory.write(this.memory.scopePath(`notes/${slugId}.md`),
      `# ${title.trim() || 'Untitled'}\n\n${body.trim()}\n\n---\ncreated: ${created}\nupdated: ${now}\n`)
    return this.getNote(slugId)!
  }

  deleteNote(id: string) {
    this.memory.remove(this.memory.scopePath(`notes/${id}.md`))
    this.memory.remove(this.memory.scopePath(`notes/${id}`)) // safety
  }

  // ── Tasks ──

  private parseTaskFile(f: string): Task | null {
    const content = this.memory.read(this.memory.scopePath(`tasks/${f}`))
    if (content == null) return null
    const lines = content.split('\n')
    const title = (lines.find(l => l.startsWith('# ')) ?? '# ').slice(2).trim()
    const metaLine = lines.find(l => l.startsWith('> ')) ?? ''
    const meta = parseTaskMeta(metaLine.replace(/^>\s*/, ''))
    return {
      id: f.replace(/\.md$/, ''),
      title,
      done: meta.status === 'done',
      priority: (meta.priority as Task['priority']) ?? 'normal',
      due: meta.due ?? null,
      created: meta.created ?? '',
      notes: lines.slice(lines.indexOf(metaLine) + 1).join('\n').replace(/---\n(created|updated):[^\n]*/g, '').trim()
    }
  }

  private writeTask(t: Task) {
    const now = new Date().toISOString()
    this.memory.write(this.memory.scopePath(`tasks/${t.id}.md`),
      `# ${t.title}\n> status: ${t.done ? 'done' : 'open'} · priority: ${t.priority}${t.due ? ` · due: ${t.due}` : ''} · created: ${t.created || now}\n\n${t.notes}\n`)
  }

  listTasks(): Task[] {
    const tasks = this.memory.list(this.memory.scopePath('tasks'))
      .map(f => this.parseTaskFile(f))
      .filter((t): t is Task => !!t)
    return tasks.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      if (a.due && b.due) return a.due.localeCompare(b.due)
      if (a.due) return -1
      if (b.due) return 1
      return b.created.localeCompare(a.created)
    })
  }

  addTask(title: string, opts: { due?: string; priority?: Task['priority']; notes?: string } = {}): Task {
    const id = `${today().replace(/-/g, '')}-${slug(title)}-${Math.random().toString(36).slice(2, 6)}`
    const task: Task = {
      id, title: title.trim(), done: false,
      priority: opts.priority ?? 'normal',
      due: opts.due ?? null,
      created: new Date().toISOString(),
      notes: opts.notes ?? ''
    }
    this.writeTask(task)
    return task
  }

  updateTask(id: string, patch: Partial<Task>) {
    const t = this.listTasks().find(x => x.id === id)
    if (!t) return null
    const next = { ...t, ...patch }
    this.writeTask(next)
    return next
  }

  toggleTask(id: string) {
    const t = this.listTasks().find(x => x.id === id)
    if (!t) return null
    return this.updateTask(id, { done: !t.done })
  }

  deleteTask(id: string) {
    this.memory.remove(this.memory.scopePath(`tasks/${id}.md`))
  }

  // ── Daily goals ──

  getDailyGoals(date?: string): DailyGoals {
    const d = date ?? today()
    const content = this.memory.read(this.memory.scopePath(`daily/${d}.md`)) ?? ''
    const items = content.split('\n')
      .filter(l => /^- \[[ xX]\]/.test(l.trim()))
      .map(l => ({ done: /\[[xX]\]/.test(l), text: l.replace(/^- \[[ xX]\]\s*/, '').trim() }))
    return { date: d, items }
  }

  private writeDailyGoals(d: DailyGoals) {
    const body = d.items.map(i => `- [${i.done ? 'x' : ' '}] ${i.text}`).join('\n')
    this.memory.write(this.memory.scopePath(`daily/${d.date}.md`), `# Goals — ${d.date}\n\n${body || '_No goals yet._'}\n`)
  }

  setDailyGoals(date: string, items: GoalItem[]) {
    this.writeDailyGoals({ date, items })
  }

  toggleGoal(date: string, index: number) {
    const g = this.getDailyGoals(date)
    if (g.items[index]) g.items[index].done = !g.items[index].done
    this.writeDailyGoals(g)
    return g
  }

  addGoal(date: string, text: string) {
    const g = this.getDailyGoals(date)
    g.items.push({ text: text.trim(), done: false })
    this.writeDailyGoals(g)
    return g
  }

  removeGoal(date: string, index: number) {
    const g = this.getDailyGoals(date)
    g.items.splice(index, 1)
    this.writeDailyGoals(g)
    return g
  }

  // AI-suggested daily intentions grounded in recent memory
  suggestGoals() { return this.memory.withScope(() => this.scopedSuggestGoals()) }
  private async scopedSuggestGoals(): Promise<string[]> {
    const cfg = this.store.get()
    const recent = this.memory.shortTermFiles().slice(-3)
      .map(f => this.memory.read(this.memory.scopePath(`short-term/${f}`)) ?? '')
      .join('\n').slice(-6000)
    const openTasks = this.listTasks().filter(t => !t.done).slice(0, 10)
      .map(t => `- ${t.title}${t.due ? ` (due ${t.due})` : ''}`).join('\n')
    const res = await chat(cfg.ai, [
      {
        role: 'system',
        content: 'You set daily intentions for a person. Given their recent activity and open tasks, propose exactly 3 concrete, realistic goals for today. One short line each, imperative mood, in the user\'s language. No numbering, no preamble.'
      },
      {
        role: 'user',
        content: `Recent activity:\n${recent || '(none)'}\n\nOpen tasks:\n${openTasks || '(none)'}`
      }
    ] as ChatMessage[], [], this.localLlm?.endpoint)
    return res.text.split('\n').map(l => l.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 3)
  }
}
