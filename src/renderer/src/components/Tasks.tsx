import { useEffect, useState } from 'react'
import { IconTasks, IconPlus, IconTrash } from './icons'

interface Task {
  id: string; title: string; done: boolean;
  priority: 'low' | 'normal' | 'high'; due: string | null; created: string; notes: string
}

const todayStr = () => new Date().toISOString().slice(0, 10)

export default function Tasks({ onActivity }: { onActivity?: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [input, setInput] = useState('')
  const [due, setDue] = useState('')
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal')
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open')

  const refresh = async () => setTasks(await window.sb.tasksList())
  useEffect(() => { refresh() }, [])

  const add = async () => {
    if (!input.trim()) return
    await window.sb.tasksAdd(input.trim(), { due: due || undefined, priority })
    setInput(''); setDue(''); setPriority('normal')
    refresh(); onActivity?.()
  }

  const toggle = async (id: string) => { await window.sb.tasksToggle(id); refresh(); onActivity?.() }
  const del = async (id: string) => { await window.sb.tasksDelete(id); refresh() }

  const shown = tasks.filter(t =>
    filter === 'all' ? true : filter === 'done' ? t.done : !t.done
  )
  const open = tasks.filter(t => !t.done)
  const done = tasks.filter(t => t.done)
  const today = todayStr()

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>ACTION LAYER</div>
          <h1>Tasks</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>
            {open.length} open · {done.length} done — stored in <span className="mono" style={{ color: 'var(--cyan)' }}>memory/tasks/</span>
          </p>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16, maxWidth: 860 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            style={{ flex: 1, minWidth: 200 }}
            placeholder="What needs doing?"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
          />
          <input type="date" value={due} onChange={e => setDue(e.target.value)} style={{ width: 150 }} />
          <select value={priority} onChange={e => setPriority(e.target.value as any)} style={{ width: 110 }}>
            <option value="low">low</option>
            <option value="normal">normal</option>
            <option value="high">high</option>
          </select>
          <button className="btn btn--primary" onClick={add} disabled={!input.trim()}>
            <IconPlus size={12} /> Add
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {(['open', 'done', 'all'] as const).map(f => (
          <button key={f} className={`chip ${filter === f ? 'chip--active' : ''}`} onClick={() => setFilter(f)}>
            {f} {f === 'open' ? `(${open.length})` : f === 'done' ? `(${done.length})` : `(${tasks.length})`}
          </button>
        ))}
      </div>

      <div className="card card-pad" style={{ maxWidth: 860 }}>
        {shown.length === 0 && (
          <p className="faint" style={{ fontSize: 13, textAlign: 'center', padding: '30px 0' }}>
            <IconTasks size={28} />
            <br />{filter === 'done' ? 'Nothing completed yet.' : 'All clear — add your first task above.'}
          </p>
        )}
        {shown.map(t => (
          <div key={t.id} className={`task-row ${t.done ? 'is-done' : ''}`}>
            <button className={`goal-check ${t.done ? 'is-done' : ''}`} onClick={() => toggle(t.id)}>
              {t.done ? '✓' : ''}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="task-row__title">{t.title}</div>
              <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
                {t.priority !== 'normal' && <span style={{ color: t.priority === 'high' ? 'var(--amber)' : 'var(--cyan)' }}>{t.priority} · </span>}
                {t.due ? (t.due === today ? 'due today' : `due ${t.due}`) : 'no due date'}
                {t.notes ? ` · ${t.notes}` : ''}
              </div>
            </div>
            <button className="goal-x" onClick={() => del(t.id)}><IconTrash size={12} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
