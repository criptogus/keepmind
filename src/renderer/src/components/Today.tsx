import { useEffect, useState } from 'react'
import { IconToday, IconTasks, IconNotes, IconSparkle, IconSend, IconGithub, IconSettings } from './icons'

const dateStr = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 864e5)
  return d.toISOString().slice(0, 10)
}

export default function Today({ onNavigate }: { onNavigate?: (v: string) => void }) {
  const [goals, setGoals] = useState<{ text: string; done: boolean }[]>([])
  const [yesterdayLeft, setYesterdayLeft] = useState(0)
  const [tasks, setTasks] = useState<any[]>([])
  const [notes, setNotes] = useState<any[]>([])
  const [config, setConfig] = useState<any>(null)
  const [goalInput, setGoalInput] = useState('')
  const [taskInput, setTaskInput] = useState('')
  const [noteInput, setNoteInput] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const date = dateStr()

  const refresh = async () => {
    const [g, t, n, c, yg] = await Promise.all([
      window.sb.goalsGet(date),
      window.sb.tasksList(),
      window.sb.notesList(),
      window.sb.getConfig(),
      window.sb.goalsGet(dateStr(-1))
    ])
    setGoals(g.items)
    setTasks(t.filter((x: any) => !x.done))
    setNotes(n.slice(0, 4))
    setConfig(c)
    const undone = (yg?.items ?? []).filter((i: any) => !i.done).length
    setYesterdayLeft(g.items.length === 0 ? undone : 0)
  }

  useEffect(() => { refresh() }, [])

  const addGoal = async () => {
    if (!goalInput.trim()) return
    await window.sb.goalsAdd(date, goalInput.trim())
    setGoalInput('')
    refresh()
  }

  const toggleGoal = async (i: number) => {
    await window.sb.goalsToggle(date, i)
    refresh()
  }

  const removeGoal = async (i: number) => {
    await window.sb.goalsRemove(date, i)
    refresh()
  }

  const carryOver = async () => {
    const yg = await window.sb.goalsGet(dateStr(-1))
    for (const i of (yg?.items ?? []).filter((x: any) => !x.done)) {
      await window.sb.goalsAdd(date, i.text)
    }
    refresh()
  }

  const suggest = async () => {
    setSuggesting(true)
    try {
      const ideas = await window.sb.goalsSuggest()
      for (const t of ideas) await window.sb.goalsAdd(date, t)
      refresh()
    } finally { setSuggesting(false) }
  }

  const addTask = async () => {
    if (!taskInput.trim()) return
    await window.sb.tasksAdd(taskInput.trim(), { due: date })
    setTaskInput('')
    refresh()
  }

  const toggleTask = async (id: string) => {
    await window.sb.tasksToggle(id)
    refresh()
  }

  const addNote = async () => {
    if (!noteInput.trim()) return
    const title = noteInput.trim().split('\n')[0].slice(0, 60)
    await window.sb.notesSave(null, title, noteInput.trim())
    setNoteInput('')
    refresh()
  }

  const doneGoals = goals.filter(g => g.done).length
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  // due-date triage: overdue / today / upcoming
  const openTasks = tasks
  const overdue = openTasks.filter(t => t.due && t.due < date)
  const dueToday = openTasks.filter(t => t.due === date)
  const upcoming = openTasks.filter(t => !t.due || t.due > date)
  const priorityTasks = [...overdue, ...dueToday, ...upcoming].slice(0, 8)

  const aiReady = config?.ai?.provider === 'local' ? true : !!config?.ai?.apiKey || config?.ai?.provider === 'codex' || config?.ai?.provider === 'claude-oauth'
  const setupSteps = [
    { ok: !!config?.github?.repoUrl, label: 'Connect GitHub (memory sync)', go: 'settings' },
    { ok: !!aiReady, label: `AI provider: ${config?.ai?.provider ?? 'none'}`, go: 'settings' },
    { ok: true, label: 'Explore — notes, tasks and insights work offline', go: 'today' }
  ]
  const setupDone = setupSteps.filter(s => s.ok).length

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag hud-tag--lime" style={{ marginBottom: 6 }}>DAILY COMMAND CENTER</div>
          <h1>{greet}</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            {goals.length > 0 && <> · <span style={{ color: 'var(--lime)' }}>{doneGoals}/{goals.length} goals</span></>}
          </p>
        </div>
      </div>

      {/* Progressive setup checklist — disappears as pieces get connected */}
      {setupDone < 2 && (
        <div className="card card-pad" style={{ marginBottom: 16, borderColor: 'rgba(250,204,21,.3)' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <IconSettings size={14} /> Finish setup <span className="faint" style={{ fontWeight: 400 }}>({setupDone}/2)</span>
          </h2>
          {setupSteps.slice(0, 2).map((s, i) => (
            <div key={i} className="goal-row" style={{ cursor: s.ok ? 'default' : 'pointer' }} onClick={() => !s.ok && onNavigate?.(s.go)}>
              <span className={`goal-check ${s.ok ? 'is-done' : ''}`} style={{ cursor: 'default' }}>{s.ok ? '✓' : ''}</span>
              <span className="goal-text" style={{ color: s.ok ? 'var(--text-faint)' : undefined }}>{s.label}</span>
              {!s.ok && <span className="chip chip--amber">SET UP →</span>}
            </div>
          ))}
          {!config?.github?.repoUrl && (
            <p className="faint" style={{ fontSize: 11.5, marginTop: 8 }}>
              Everything works locally already — GitHub sync just makes memory portable and shared with your other AIs.
            </p>
          )}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Daily goals */}
        <div className="card card-pad">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><IconToday size={15} /> Today's intentions</h2>
            <button className="btn btn--ghost btn--sm" onClick={suggest} disabled={suggesting}>
              <IconSparkle size={11} /> {suggesting ? 'THINKING…' : 'AI SUGGEST'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              style={{ flex: 1 }}
              placeholder="Add an intention… e.g. ship the proposal"
              value={goalInput}
              onChange={e => setGoalInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addGoal()}
            />
            <button className="btn btn--primary btn--sm" onClick={addGoal}>Add</button>
          </div>
          {yesterdayLeft > 0 && (
            <button className="btn btn--ghost btn--sm" style={{ width: '100%', marginBottom: 10, justifyContent: 'center' }} onClick={carryOver}>
              ↺ Carry over {yesterdayLeft} intention{yesterdayLeft === 1 ? '' : 's'} from yesterday
            </button>
          )}
          {goals.length === 0 && yesterdayLeft === 0 && <p className="faint" style={{ fontSize: 12.5 }}>No intentions yet. Add one or let the brain suggest.</p>}
          {goals.map((g, i) => (
            <div key={i} className="goal-row">
              <button className={`goal-check ${g.done ? 'is-done' : ''}`} onClick={() => toggleGoal(i)}>
                {g.done ? '✓' : ''}
              </button>
              <span className={`goal-text ${g.done ? 'is-done' : ''}`}>{g.text}</span>
              <button className="goal-x" onClick={() => removeGoal(i)}>×</button>
            </div>
          ))}
        </div>

        {/* Tasks — triaged by due date */}
        <div className="card card-pad">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><IconTasks size={15} /> Open tasks</h2>
            {onNavigate && <button className="btn btn--ghost btn--sm" onClick={() => onNavigate('tasks')}>ALL →</button>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              style={{ flex: 1 }}
              placeholder="Add a task…"
              value={taskInput}
              onChange={e => setTaskInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTask()}
            />
            <button className="btn btn--primary btn--sm" onClick={addTask}>Add</button>
          </div>
          {overdue.length + dueToday.length + upcoming.length === 0 && (
            <p className="faint" style={{ fontSize: 12.5 }}>Nothing pending. Your list is clear.</p>
          )}
          {priorityTasks.map(t => {
            const dueLabel = t.due === date ? 'today' : t.due && t.due < date ? `overdue · ${t.due}` : t.due
            return (
              <div key={t.id} className="goal-row">
                <button className={`goal-check ${t.done ? 'is-done' : ''}`} onClick={() => toggleTask(t.id)}>
                  {t.done ? '✓' : ''}
                </button>
                <span className="goal-text">
                  {t.title}
                  {t.priority === 'high' && <span className="chip chip--amber" style={{ marginLeft: 8 }}>HIGH</span>}
                  {dueLabel && (
                    <span className="faint" style={{ marginLeft: 8, fontSize: 11, color: t.due < date ? 'var(--red)' : undefined }}>
                      {dueLabel}
                    </span>
                  )}
                </span>
              </div>
            )
          })}
          {openTasks.length > priorityTasks.length && (
            <p className="faint" style={{ fontSize: 11, marginTop: 8 }}>
              +{openTasks.length - priorityTasks.length} more — see Tasks
            </p>
          )}
        </div>
      </div>

      {/* Quick note + recent notes */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div className="card card-pad">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}><IconNotes size={15} /> Quick note</h2>
          <textarea
            rows={3}
            placeholder="Jot something down — a thought, a link, a reminder…"
            value={noteInput}
            onChange={e => setNoteInput(e.target.value)}
            style={{ width: '100%', resize: 'vertical' }}
          />
          <button className="btn btn--primary btn--sm" style={{ marginTop: 10 }} onClick={addNote} disabled={!noteInput.trim()}>
            <IconSend size={11} /> Save note
          </button>
        </div>
        <div className="card card-pad">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><IconNotes size={15} /> Recent notes</h2>
            {onNavigate && <button className="btn btn--ghost btn--sm" onClick={() => onNavigate('notes')}>ALL →</button>}
          </div>
          {notes.length === 0 && <p className="faint" style={{ fontSize: 12.5 }}>No notes yet.</p>}
          {notes.map(n => (
            <div key={n.id} className="note-row" onClick={() => onNavigate?.('notes')}>
              <span className="note-row__title">{n.title}</span>
              <span className="faint" style={{ fontSize: 11 }}>{n.updated?.slice(0, 10)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
