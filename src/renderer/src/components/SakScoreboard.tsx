interface SakPillar {
  name: string
  score: number | null
  rationale: string
}

export interface SakGrade {
  path: string
  at: string
  score: number | null
  formatScore: number | null
  substanceScore: number | null
  rationale: string
  actions: string[]
  pillars?: SakPillar[]
}

interface SkillRef {
  path: string
  title: string
}

function tone(score: number | null): string {
  if (score == null) return 'is-none'
  if (score >= 85) return 'is-high'
  if (score >= 70) return 'is-mid'
  if (score >= 50) return 'is-low'
  return 'is-risk'
}

function band(score: number | null): string {
  if (score == null) return 'Sem número'
  if (score >= 85) return 'Alta'
  if (score >= 70) return 'Boa'
  if (score >= 50) return 'No meio'
  return 'Baixa'
}

function when(at: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function Meter({ score }: { score: number | null }) {
  const width = score == null ? 0 : Math.max(0, Math.min(100, score))
  return (
    <div className="sak-meter" aria-hidden="true">
      <i style={{ width: `${width}%` }} />
    </div>
  )
}

export default function SakScoreboard({
  skills,
  notes,
  selectedPath,
  busy,
  onSelect,
  onReview
}: {
  skills: SkillRef[]
  notes: SakGrade[]
  selectedPath: string | null
  busy: boolean
  onSelect: (path: string) => void
  onReview: (path: string) => void
}) {
  const titleOf = (path: string) => skills.find(s => s.path === path)?.title ?? path.split('/').pop() ?? path
  const selectedNote = selectedPath ? notes.find(n => n.path === selectedPath) ?? null : null
  const open = selectedPath ? selectedNote : (notes[0] ?? null)
  const pending = skills.filter(s => !notes.some(n => n.path === s.path))

  return (
    <section className="card card-pad sak-place">
      <div className="sak-place__head">
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>SUPERAGENTSKILL</div>
          <h2>Notas</h2>
          <p className="faint" style={{ fontSize: 13 }}>
            A nota geral fica grande. Formato é a estrutura do arquivo. Substância é o que o texto realmente diz.
          </p>
        </div>
      </div>

      {notes.length === 0 && (
        <div className={`sak-score ${tone(null)}`}>
          <div className="sak-score__top">
            <div>
              <div className="sak-score__title">Nenhuma nota ainda</div>
              <p className="faint sak-score__when">Peça uma avaliação e o boletim aparece aqui.</p>
            </div>
            <div className="sak-score__num">—<small>SAK</small></div>
          </div>
        </div>
      )}

      {notes.length > 0 && (
        <div className="sak-board">
          {notes.map(n => (
            <button
              key={n.path}
              type="button"
              className={`sak-score ${tone(n.score)} ${open?.path === n.path ? 'is-open' : ''}`}
              onClick={() => onSelect(n.path)}
            >
              <div className="sak-score__top">
                <div>
                  <div className="sak-score__title">{titleOf(n.path)}</div>
                  <div className="faint sak-score__when">{when(n.at)} · São Paulo</div>
                </div>
                <div className="sak-score__num">
                  {n.score ?? '—'}
                  <small>{band(n.score)}</small>
                </div>
              </div>
              <div className="sak-axes">
                <div className="sak-axis">
                  <span><em>Formato</em><b>{n.formatScore ?? '—'}</b></span>
                  <Meter score={n.formatScore} />
                </div>
                <div className="sak-axis">
                  <span><em>Substância</em><b>{n.substanceScore ?? '—'}</b></span>
                  <Meter score={n.substanceScore} />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedPath && !selectedNote && (
        <div className="sak-sheet">
          <h2 style={{ margin: 0 }}>{titleOf(selectedPath)}</h2>
          <p className="faint" style={{ fontSize: 13, margin: '6px 0 12px' }}>
            Esta skill ainda não tem nota no SuperagentSkill.
          </p>
          <button className="btn btn--sm" type="button" disabled={busy} onClick={() => onReview(selectedPath)}>
            {busy ? 'Avaliando…' : 'Avaliar no SuperagentSkill'}
          </button>
        </div>
      )}

      {open && (
        <div className="sak-sheet">
          <div className="sak-sheet__lead">
            <div className={`sak-score__num ${tone(open.score)}`} style={{ fontSize: 56 }}>
              {open.score ?? '—'}
              <small>de 100 · {band(open.score)}</small>
            </div>
            <div>
              <h2 style={{ margin: 0 }}>{titleOf(open.path)}</h2>
              <p className="faint" style={{ fontSize: 12.5, margin: '4px 0 10px' }}>{when(open.at)} · São Paulo</p>
              <div className="sak-axes">
                <div className="sak-axis">
                  <span><em>Formato</em><b>{open.formatScore ?? '—'}</b></span>
                  <Meter score={open.formatScore} />
                </div>
                <div className="sak-axis">
                  <span><em>Substância</em><b>{open.substanceScore ?? '—'}</b></span>
                  <Meter score={open.substanceScore} />
                </div>
              </div>
            </div>
          </div>
          {open.rationale && <p style={{ fontSize: 14, lineHeight: 1.55, marginTop: 14 }}>{open.rationale}</p>}
          {(open.pillars ?? []).length > 0 && (
            <div className="sak-pillars">
              {(open.pillars ?? []).map(p => (
                <div key={p.name} className="sak-pillar">
                  <span><b>{p.name}</b><b>{p.score ?? '—'}</b></span>
                  <Meter score={p.score} />
                  {p.rationale && <p className="faint" style={{ fontSize: 12, marginTop: 4 }}>{p.rationale}</p>}
                </div>
              ))}
            </div>
          )}
          {open.actions.length > 0 && (
            <ul className="sak-actions">
              {open.actions.map(a => <li key={a}>{a}</li>)}
            </ul>
          )}
          <div style={{ marginTop: 12 }}>
            <button className="btn btn--sm" type="button" disabled={busy} onClick={() => onReview(open.path)}>
              {busy ? 'Avaliando…' : 'Avaliar de novo'}
            </button>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <p className="faint" style={{ fontSize: 12.5, margin: '12px 0 0' }}>
          Sem nota ainda: {pending.slice(0, 6).map(s => s.title).join(', ')}
          {pending.length > 6 ? ` e mais ${pending.length - 6}` : ''}.
        </p>
      )}
    </section>
  )
}
