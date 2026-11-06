import { useState } from 'react'

interface Agent { id: string; name: string; emoji: string; persona: string; builtin?: boolean }

export default function Agents({ agents, onChanged, onToast }: {
  agents: Agent[]
  onChanged: () => void
  onToast: (m: string, k?: 'info' | 'error' | 'success') => void
}) {
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
    onToast('Agente criado! Encontre-o no chat.', 'success')
  }

  const remove = async (id: string) => {
    await window.sb.removeAgent(id)
    onChanged()
  }

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Agentes especialistas</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>
            Personas que conversam com o contexto completo do seu second brain.
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => setShowForm(s => !s)}>
          {showForm ? 'Cancelar' : '+ Novo agente'}
        </button>
      </div>

      {showForm && (
        <div className="card card-pad" style={{ marginBottom: 20 }}>
          <h2 style={{ marginBottom: 14 }}>Criar agente personalizado</h2>
          <div className="grid grid-3">
            <div className="field">
              <label>Nome</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Minha mentora de finanças" />
            </div>
            <div className="field">
              <label>Emoji</label>
              <input value={emoji} onChange={e => setEmoji(e.target.value)} style={{ maxWidth: 90 }} />
            </div>
            <div className="field">
              <label>Personalidade / instruções</label>
              <input value={persona} onChange={e => setPersona(e.target.value)} placeholder="Ex: Fale como um CIO experiente, direto e estratégico…" />
            </div>
          </div>
          <p className="faint" style={{ fontSize: 12, marginBottom: 14 }}>
            Dica: descreva estilo de fala, valores e foco. O agente sempre recebe o contexto do seu second brain automaticamente.
          </p>
          <button className="btn btn--primary" onClick={create} disabled={!name.trim() || !persona.trim()}>
            Criar agente
          </button>
        </div>
      )}

      <div className="grid grid-3">
        {agents.map(a => (
          <div key={a.id} className="agent-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span className="a-emoji">{a.emoji}</span>
              <span className={`badge ${a.builtin ? 'badge--builtin' : 'badge--custom'}`}>
                {a.builtin ? 'nativo' : 'custom'}
              </span>
            </div>
            <div className="a-name">{a.name}</div>
            <div className="a-persona">{a.persona}</div>
            {!a.builtin && (
              <button className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => remove(a.id)}>
                Remover
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
