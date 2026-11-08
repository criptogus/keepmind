import { useState } from 'react'
import { IconPlus, IconTrash } from './icons'
import Meetings from './Meetings'
import { AGENT_ACCENTS } from '../lib/accents'

interface Agent { id: string; name: string; emoji: string; persona: string; builtin?: boolean }

export default function Agents({ agents, onChanged, onToast, onActivity }: {
  agents: Agent[]
  onChanged: () => void
  onToast: (m: string, k?: 'info' | 'error' | 'success') => void
  onActivity?: () => void
}) {
  const [tab, setTab] = useState<'agents' | 'meetings'>('agents')
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🎭')
  const [persona, setPersona] = useState('')

  const create = async () => {
    if (!name.trim() || !persona.trim()) return
    await window.sb.addAgent({
      id: `custom-${Date.now()}`,
      name: name.trim(),
      emoji,
      persona: persona.trim()
    })
    onChanged()
    setShowForm(false)
    setName(''); setPersona('')
    onToast('Agent created! Find it in Chat.', 'success')
  }

  const remove = async (id: string) => {
    await window.sb.removeAgent(id)
    onChanged()
  }

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag" style={{ marginBottom: 6, color: 'var(--violet)' }}>EXPERT PERSONAS</div>
          <h1>Specialist agents</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>
            Personas that chat with your second brain&apos;s full context — or convene them in a meeting.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="tabs">
            <button className={`tab ${tab === 'agents' ? 'is-active' : ''}`} onClick={() => setTab('agents')}>Agents</button>
            <button className={`tab ${tab === 'meetings' ? 'is-active' : ''}`} onClick={() => setTab('meetings')}>Meetings</button>
          </div>
          {tab === 'agents' && (
            <button className="btn btn--primary" onClick={() => setShowForm(s => !s)}>
              {showForm ? 'Cancel' : <><IconPlus size={12} /> New agent</>}
            </button>
          )}
        </div>
      </div>

      {tab === 'meetings' ? (
        <Meetings agents={agents} onActivity={onActivity} onToast={onToast} />
      ) : (<>
      {showForm && (
        <div className="card card-pad" style={{ marginBottom: 20, maxWidth: 860 }}>
          <h2 style={{ marginBottom: 14 }}>Create custom agent</h2>
          <div className="grid grid-3">
            <div className="field">
              <label>Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. My finance mentor" />
            </div>
            <div className="field">
              <label>Emoji</label>
              <input value={emoji} onChange={e => setEmoji(e.target.value)} style={{ maxWidth: 90 }} />
            </div>
            <div className="field">
              <label>Personality / instructions</label>
              <input value={persona} onChange={e => setPersona(e.target.value)} placeholder="e.g. Speak like a seasoned CIO — direct and strategic…" />
            </div>
          </div>
          <p className="faint" style={{ fontSize: 12, marginBottom: 14 }}>
            Tip: describe speaking style, values and focus. The agent always receives your second brain context automatically.
          </p>
          <button className="btn btn--primary" onClick={create} disabled={!name.trim() || !persona.trim()}>
            Create agent
          </button>
        </div>
      )}

      <div className="grid grid-3">
        {agents.map(a => (
          <div key={a.id} className="agent-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span className="a-emoji" style={{ color: AGENT_ACCENTS[a.id] ?? '#22d3ee' }}>{a.emoji}</span>
              <span className={`badge ${a.builtin ? 'badge--builtin' : 'badge--custom'}`}>
                {a.builtin ? 'native' : 'custom'}
              </span>
            </div>
            <div className="a-name">{a.name}</div>
            <div className="a-persona">{a.persona}</div>
            {!a.builtin && (
              <button className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => remove(a.id)}>
                <IconTrash size={12} /> Remove
              </button>
            )}
          </div>
        ))}
      </div>
      </>)}
    </div>
  )
}
