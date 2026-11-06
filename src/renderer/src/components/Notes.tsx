import { useEffect, useState } from 'react'
import { IconNotes, IconPlus, IconTrash, IconDoc } from './icons'

interface Note { id: string; title: string; body: string; updated: string }

export default function Notes({ onActivity }: { onActivity?: () => void }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [current, setCurrent] = useState<Note | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const refresh = async () => {
    const list = await window.sb.notesList()
    setNotes(list)
    return list
  }

  useEffect(() => {
    refresh().then(list => {
      if (list.length && !current) open(list[0])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const open = (n: Note) => {
    setCurrent(n); setTitle(n.title); setBody(n.body); setDirty(false)
  }

  const newNote = () => {
    setCurrent(null); setTitle(''); setBody(''); setDirty(true)
  }

  const save = async () => {
    if (!title.trim() && !body.trim()) return
    setSaving(true)
    try {
      const n = await window.sb.notesSave(current?.id ?? null, title.trim() || 'Untitled', body)
      setCurrent(n); setDirty(false)
      await refresh()
      onActivity?.()
    } finally { setSaving(false) }
  }

  const del = async () => {
    if (!current) return
    if (!confirm(`Delete "${current.title}"?`)) return
    await window.sb.notesDelete(current.id)
    setCurrent(null); setTitle(''); setBody('')
    refresh()
  }

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>KNOWLEDGE BASE</div>
          <h1>Notes</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>
            Markdown notes stored in <span className="mono" style={{ color: 'var(--cyan)' }}>memory/notes/</span> — synced to GitHub, readable by every connected AI.
          </p>
        </div>
        <button className="btn btn--primary" onClick={newNote}>
          <IconPlus size={12} /> New note
        </button>
      </div>

      <div className="notes-layout">
        <div className="card notes-list">
          {notes.length === 0 && <p className="faint" style={{ padding: 14, fontSize: 12.5 }}>No notes yet — create your first one.</p>}
          {notes.map(n => (
            <button
              key={n.id}
              className={`note-item ${current?.id === n.id ? 'is-active' : ''}`}
              onClick={() => open(n)}
            >
              <IconDoc size={13} />
              <span className="note-item__title">{n.title}</span>
              <span className="faint" style={{ fontSize: 10.5 }}>{n.updated?.slice(0, 10)}</span>
            </button>
          ))}
        </div>

        <div className="card card-pad notes-editor">
          {!current && !dirty && (
            <div style={{ textAlign: 'center', padding: '60px 20px' }} className="faint">
              <IconNotes size={40} />
              <p style={{ marginTop: 14, fontSize: 13 }}>Select a note or create a new one.</p>
            </div>
          )}
          {(current || dirty) && (
            <>
              <div className="field" style={{ marginBottom: 12 }}>
                <input
                  value={title}
                  onChange={e => { setTitle(e.target.value); setDirty(true) }}
                  placeholder="Note title"
                  style={{ fontSize: 16, fontWeight: 600 }}
                />
              </div>
              <textarea
                value={body}
                onChange={e => { setBody(e.target.value); setDirty(true) }}
                placeholder="Write in Markdown… # headings, **bold**, - lists, `code`"
                style={{ width: '100%', minHeight: 320, resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 13 }}
              />
              <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
                <button className="btn btn--primary" onClick={save} disabled={saving || !dirty}>
                  {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
                </button>
                {current && (
                  <button className="btn btn--ghost" onClick={del}>
                    <IconTrash size={12} /> Delete
                  </button>
                )}
                <span className="faint" style={{ fontSize: 11, marginLeft: 'auto' }}>
                  {current ? `memory/notes/${current.id}.md` : 'new note → memory/notes/'}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
