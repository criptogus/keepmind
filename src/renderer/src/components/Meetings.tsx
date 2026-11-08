import { useEffect, useRef, useState } from 'react'
import { IconMeeting, IconPlay } from './icons'
import { mdToHtml } from '../lib/markdown'
import { AGENT_ACCENTS } from '../lib/accents'

interface MeetingMeta { id: string; path: string; title: string; date: string; participants: string }
interface Agent { id: string; name: string; emoji: string }
interface LiveMsg { agentId: string; name: string; emoji: string; text: string }

export default function Meetings({ agents, onActivity, onToast }: {
  agents: Agent[]
  onActivity?: () => void
  onToast?: (m: string, k?: 'info' | 'error' | 'success') => void
}) {
  const [meetings, setMeetings] = useState<MeetingMeta[]>([])
  const [viewing, setViewing] = useState<string | null>(null) // meeting path being viewed
  const [viewContent, setViewContent] = useState('')

  const [topic, setTopic] = useState('')
  const [agenda, setAgenda] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)
  const [live, setLive] = useState<{ speaker: string; msgs: LiveMsg[] } | null>(null)
  const [result, setResult] = useState<{ path: string; tasksCreated: number } | null>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)

  const refresh = async () => setMeetings(await window.sb.meetingList())
  useEffect(() => { refresh() }, [])

  useEffect(() => {
    const off = window.sb.onMeetingEvent?.((ev: any) => {
      if (ev.kind === 'speaker') {
        setLive(l => ({ speaker: `${ev.emoji ?? ''} ${ev.name}`, msgs: l?.msgs ?? [] }))
      } else if (ev.kind === 'text' && ev.agentId) {
        setLive(l => ({
          speaker: '',
          msgs: [...(l?.msgs ?? []), { agentId: ev.agentId, name: '', emoji: '', text: ev.text }]
        }))
        onActivity?.()
      } else if (ev.kind === 'done') {
        setResult({ path: ev.path, tasksCreated: 0 })
      } else if (ev.kind === 'error') {
        onToast?.(ev.message ?? 'Meeting failed', 'error')
      }
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' })
  }, [live?.msgs.length])

  const toggleAgent = (id: string) => {
    setSelected(s => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const start = async () => {
    if (!topic.trim() || !selected.size || running) return
    setRunning(true); setResult(null)
    setLive({ speaker: ' convening…', msgs: [] })
    onActivity?.()
    try {
      const res: any = await window.sb.meetingStart({
        topic: topic.trim(),
        participantIds: [...selected],
        agenda: agenda.trim() || undefined
      })
      setResult({ path: res.path, tasksCreated: res.tasksCreated ?? 0 })
      onToast?.(`Meeting saved — ${res.tasksCreated ?? 0} action items → tasks`, 'success')
      await refresh()
    } catch (e: any) {
      onToast?.(String(e?.message ?? e), 'error')
    } finally {
      setRunning(false)
      setLive(null)
      setTopic(''); setAgenda(''); setSelected(new Set())
    }
  }

  const openMeeting = async (path: string) => {
    const content = await window.sb.meetingGet(path)
    setViewContent(content ?? '')
    setViewing(path)
  }

  return (
    <div>
      {/* New meeting */}
      <div className="card card-pad" style={{ marginBottom: 20, maxWidth: 860 }}>
        <h2 style={{ marginBottom: 12 }}>Convene a meeting</h2>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Topic</label>
          <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Should I launch the product before Q4?" disabled={running} />
        </div>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Agenda (optional)</label>
          <textarea rows={2} value={agenda} onChange={e => setAgenda(e.target.value)} placeholder="Points to cover, constraints, deadline…" disabled={running} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label className="hud-tag" style={{ display: 'block', marginBottom: 8 }}>PARTICIPANTS</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {agents.map(a => (
              <button
                key={a.id}
                className={`chip ${selected.has(a.id) ? 'chip--active' : ''}`}
                onClick={() => toggleAgent(a.id)}
                disabled={running}
              >
                <span style={{ color: AGENT_ACCENTS[a.id] ?? '#22d3ee' }}>{a.emoji}</span> {a.name}
              </button>
            ))}
          </div>
        </div>
        <button className="btn btn--primary" onClick={start} disabled={running || !topic.trim() || !selected.size}>
          {running ? 'MEETING IN SESSION…' : <><IconPlay size={12} /> Start meeting</>}
        </button>
      </div>

      {/* Live transcript */}
      {live && (
        <div className="card card-pad" style={{ marginBottom: 20, maxWidth: 860, borderColor: 'rgba(167,139,250,.35)' }}>
          <div className="hud-tag" style={{ marginBottom: 10, color: 'var(--violet)' }}>
            {running ? `● LIVE — ${live.speaker}` : 'MEETING WRAPPED'}
          </div>
          <div ref={transcriptRef} style={{ maxHeight: 380, overflowY: 'auto' }}>
            {live.msgs.map((m, i) => {
              const agent = agents.find(a => a.id === m.agentId)
              return (
                <div key={i} className="meeting-msg">
                  <span className="meeting-msg__who" style={{ color: AGENT_ACCENTS[m.agentId] ?? undefined }}>{agent?.emoji} {agent?.name ?? m.agentId}</span>
                  <p>{m.text}</p>
                </div>
              )
            })}
            {running && <p className="faint" style={{ fontSize: 12 }}>typing…</p>}
          </div>
          {result && (
            <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--lime)' }}>
              ✓ Saved to memory · {result.tasksCreated} action item{result.tasksCreated === 1 ? '' : 's'} added to Tasks
            </p>
          )}
        </div>
      )}

      {/* Past meetings */}
      <div className="card card-pad" style={{ maxWidth: 860 }}>
        <h2 style={{ marginBottom: 12 }}>Past meetings</h2>
        {meetings.length === 0 && (
          <p className="faint" style={{ fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
            <IconMeeting size={26} />
            <br />No meetings yet — convene your first round table above.
          </p>
        )}
        {meetings.map(m => (
          <button key={m.id} className="note-row" onClick={() => openMeeting(m.path)}>
            <span className="note-row__title">{m.title}</span>
            <span className="faint" style={{ fontSize: 11 }}>{m.date} · {m.participants}</span>
          </button>
        ))}
      </div>

      {/* Meeting viewer modal */}
      {viewing && (
        <div className="modal-backdrop" onClick={() => setViewing(null)}>
          <div className="card card-pad modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ fontSize: 15 }}>Meeting transcript</h2>
              <button className="btn btn--ghost btn--sm" onClick={() => setViewing(null)}>Close</button>
            </div>
            <div className="meeting-view" dangerouslySetInnerHTML={{ __html: mdToHtml(viewContent) }} />
          </div>
        </div>
      )}
    </div>
  )
}
