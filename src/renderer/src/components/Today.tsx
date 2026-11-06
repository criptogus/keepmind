import { useEffect, useState } from 'react'
import { IconToday, IconTasks, IconNotes, IconSparkle, IconSend } from './icons'

const todayStr = () => new Date().toISOString().slice(0, 10)

export default function Today({ onNavigate }: { onNavigate?: (v: string) => void }) {
  const [goals, setGoals] = useState<{ text: string; done: boolean }[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [notes, setNotes] = useState<any[]>([])
  const [goalInput, setGoalInput] = useState('')
  const [taskInput, setTaskInput] = useState('')
  const [noteInput, setNoteInput] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const date = todayStr()

  const refresh = async () => {
    const [g, t, n] = await Promise.all([
      window.sb.goalsGet(date),
      window.sb.tasksList(),
      window.sb.notesList()
    ])
    setGoals(g.items)
    setTasks(t.filter((x: any) => !x.done).slice(0, 8))
    setNotes(n.slice(0, 4))
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

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>DAILY COMMAND CENTER</div>
          <h1>{greet}</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            {goals.length > 0 && <> · <span style={{ color: 'var(--lime)' }}>{doneGoals}/{goals.length} goals</span></>}
          </p>
        </div>
      </div>

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
          {goals.length === 0 && <p className="faint" style={{ fontSize: 12.5 }}>No intentions yet. Add one or let the brain suggest.</p>}
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

        {/* Tasks due / open */}
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
          {tasks.length === 0 && <p className="faint" style={{ fontSize: 12.5 }}>Nothing pending. Your list is clear.</p>}
          {tasks.map(t => (
            <div key={t.id} className="goal-row">
              <button className={`goal-check ${t.done ? 'is-done' : ''}`} onClick={() => toggleTask(t.id)}>
                {t.done ? '✓' : ''}
              </button>
              <span className={`goal-text ${t.done ? 'is-done' : ''}`}>
                {t.title}
                {t.priority === 'high' && <span className="chip chip--amber" style={{ marginLeft: 8 }}>HIGH</span>}
                {t.due && <span className="faint" style={{ marginLeft: 8, fontSize: 11 }}>{t.due === date ? 'today' : t.due}</span>}
              </span>
            </div>
          ))}
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
