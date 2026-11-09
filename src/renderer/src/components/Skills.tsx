import { useEffect, useMemo, useState } from 'react'
import { IconDoc, IconSparkle } from './icons'
import SakScoreboard from './SakScoreboard'

interface VaultSkill {
  file: string
  path: string
  group: string
  segment: string
  title: string
  ageDays: number
  uses: number
  mentions: number
  kind: string
  slug: string
  excerpt: string
}

interface Suggestion {
  slug: string
  name: string
  description: string
  type: string
  installs: number
  alreadyHave: boolean
}

interface SakNote {
  path: string
  at: string
  score: number | null
  formatScore: number | null
  substanceScore: number | null
  rationale: string
  actions: string[]
  pillars?: { name: string; score: number | null; rationale: string }[]
}

interface Hint {
  path: string
  title: string
  segment: string
  kind: 'use' | 'idle' | 'note' | 'duplicate' | 'threat'
  sentence: string
}

interface ThreatFinding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  title: string
  detail: string
}

interface SkillThreat {
  path: string
  slug: string
  at: string
  status: 'clean' | 'review' | 'blocked' | 'unavailable'
  score: number | null
  findingsCritical: number
  findingsPublic: number
  injection: string | null
  summary: string
  findings: ThreatFinding[]
}

interface Snapshot {
  items: VaultSkill[]
  suggestions: Suggestion[]
  hints: Hint[]
  notes: SakNote[]
  segments: { id: string; count: number }[]
  threats: SkillThreat[]
}

const REGISTRY_TYPES = [
  { id: '', label: 'Tudo' },
  { id: 'skill', label: 'Skill' },
  { id: 'playbook', label: 'Playbook' },
  { id: 'soul', label: 'Soul' },
  { id: 'guardrail', label: 'Guardrail' }
] as const

function hintLabel(kind: Hint['kind']): string {
  switch (kind) {
    case 'use': return 'Uso'
    case 'idle': return 'Parada'
    case 'note': return 'Nota'
    case 'duplicate': return 'Duplicada'
    case 'threat': return 'Ameaça'
    default: {
      const unreachable: never = kind
      return unreachable
    }
  }
}

function threatLabel(status: SkillThreat['status']): string {
  switch (status) {
    case 'clean': return 'Limpa'
    case 'review': return 'Revisar'
    case 'blocked': return 'Bloqueada'
    case 'unavailable': return 'Sem resposta'
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

export default function Skills({ onActivity, onToast }: { onActivity?: () => void; onToast?: (m: string, k?: 'info' | 'error' | 'success') => void }) {
  const [data, setData] = useState<Snapshot | null>(null)
  const [segment, setSegment] = useState('todas')
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [registryType, setRegistryType] = useState('')
  const [results, setResults] = useState<Suggestion[] | null>(null)
  const [report, setReport] = useState('')
  const [trust, setTrust] = useState('')

  const refresh = async () => {
    const s = await window.sb.brainSkills().catch(() => null)
    if (s) setData(s)
  }

  useEffect(() => { refresh() }, [])

  const items = useMemo(() => {
    const all = data?.items ?? []
    if (segment === 'todas') return all
    return all.filter(s => s.segment === segment)
  }, [data, segment])

  const current = items.find(s => s.path === selected) ?? items[0] ?? null
  const note = data?.notes.find(n => n.path === current?.path) ?? null
  const hints = (data?.hints ?? []).filter(h => !current || h.path === current.path || h.path === '')
  const catalog = results ?? data?.suggestions ?? []
  const threat = data?.threats?.find(t => t.path === current?.path) ?? null

  const install = async (slug: string) => {
    setBusy(`install-${slug}`)
    onActivity?.()
    try {
      await window.sb.brainSkillInstall(slug)
      onToast?.(`“${slug}” entrou em skills/ e segue para o GitHub.`, 'success')
      setResults(null)
      await refresh()
    } catch (e: any) {
      onToast?.(e?.message ?? 'Não foi possível instalar.', 'error')
    } finally { setBusy(null) }
  }

  const search = async () => {
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      return
    }
    setBusy('search')
    try {
      const hits = await window.sb.brainSkillSearch(q, registryType || undefined)
      setResults(hits)
    } catch (e: any) {
      onToast?.(e?.message ?? 'O SuperagentSkill não respondeu.', 'error')
    } finally { setBusy(null) }
  }

  const review = async (path: string) => {
    setBusy('review')
    onActivity?.()
    try {
      const next = await window.sb.brainSkillReview(path)
      setData(d => d ? { ...d, notes: [next, ...d.notes.filter(n => n.path !== path)] } : d)
      onToast?.(next.score != null ? `Nota ${next.score} no SuperagentSkill.` : 'Nota recebida.', 'success')
      await refresh()
    } catch (e: any) {
      onToast?.(e?.message ?? 'A avaliação falhou.', 'error')
    } finally { setBusy(null) }
  }

  const evolve = async () => {
    setBusy('evolve')
    onActivity?.()
    try {
      const out = await window.sb.brainSkillEvolve()
      setReport(out.report)
      setData(d => d ? { ...d, hints: out.hints } : d)
      onToast?.('A evolução das skills foi gravada em insights/.', 'success')
    } catch (e: any) {
      onToast?.(e?.message ?? 'A evolução falhou.', 'error')
    } finally { setBusy(null) }
  }

  const scanThreats = async () => {
    setBusy('threat')
    onActivity?.()
    try {
      const out = await window.sb.brainSkillThreatScan()
      setData(d => d ? { ...d, threats: out.threats, hints: out.hints } : d)
      const blocked = out.threats.filter((t: SkillThreat) => t.status === 'blocked').length
      const review = out.threats.filter((t: SkillThreat) => t.status === 'review').length
      onToast?.(
        blocked || review
          ? `${blocked} bloqueada(s), ${review} para revisar.`
          : 'Nenhuma skill do cofre foi marcada como maliciosa.',
        blocked ? 'error' : 'success'
      )
    } catch (e: any) {
      onToast?.(e?.message ?? 'A análise de ameaças falhou.', 'error')
    } finally { setBusy(null) }
  }

  const showTrust = async (slug: string) => {
    setBusy('trust')
    try {
      const t = await window.sb.brainSkillTrust(slug)
      setTrust(t.summary)
    } catch (e: any) {
      onToast?.(e?.message ?? 'Sem relatório de confiança.', 'error')
    } finally { setBusy(null) }
  }

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>HABILIDADES</div>
          <h1>O que o cérebro sabe fazer</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4, maxWidth: 680 }}>
            Suas skills, separadas por origem. O uso vem das conversas e do diário. A nota e a análise de skill maliciosa vêm do SuperagentSkill, quando você pede.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn--ghost btn--sm" onClick={refresh}>Atualizar</button>
          <button className="btn btn--ghost btn--sm" disabled={busy === 'threat'} onClick={scanThreats}>
            {busy === 'threat' ? 'Analisando…' : 'Analisar ameaças'}
          </button>
          <button className="btn btn--sm" disabled={busy === 'evolve'} onClick={evolve}>
            {busy === 'evolve' ? 'Evoluindo…' : 'Evoluir com o cérebro'}
          </button>
        </div>
      </div>

      <SakScoreboard
        skills={data?.items ?? []}
        notes={data?.notes ?? []}
        selectedPath={selected}
        busy={busy === 'review'}
        onSelect={path => { setSegment('todas'); setSelected(path); setTrust('') }}
        onReview={review}
      />

      <div className="card card-pad" style={{ maxWidth: 1100, marginBottom: 16 }}>
        <h2 style={{ marginBottom: 8 }}>Skills maliciosas</h2>
        <p className="faint" style={{ fontSize: 13, lineHeight: 1.5, marginTop: 0 }}>
          O SuperagentSkill faz as duas checagens. No pacote publicado, o relatório de confiança traz os achados de robustez: injeção, vazamento e jailbreak. No arquivo do cofre, o dry-run do upload roda o guarda de prompt injection e não publica nada. Um achado crítico impede a instalação.
        </p>
        {(data?.threats.length ?? 0) === 0 && (
          <p className="faint" style={{ fontSize: 13, marginBottom: 0 }}>Ainda não rodou nesta máquina. O botão acima analisa o que está no cofre.</p>
        )}
        {(data?.threats.length ?? 0) > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(data?.threats ?? []).map(t => (
              <button
                key={t.path}
                onClick={() => { setSegment('todas'); setSelected(t.path) }}
                style={{
                  textAlign: 'left', background: 'transparent', border: '1px solid var(--line)',
                  borderRadius: 10, padding: '8px 12px', color: 'inherit', cursor: 'pointer'
                }}
              >
                <span className="chip" style={{ marginRight: 8 }}>{threatLabel(t.status)}</span>
                <span style={{ fontSize: 13 }}>{t.summary}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {(data?.hints.length ?? 0) > 0 && (
        <div className="card card-pad" style={{ maxWidth: 1100, marginBottom: 16 }}>
          <h2 style={{ marginBottom: 10 }}>Próximas melhorias</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(data?.hints ?? []).slice(0, 6).map((h, i) => (
              <button
                key={`${h.path}-${i}`}
                onClick={() => { if (h.path) { setSegment('todas'); setSelected(h.path) } }}
                style={{
                  textAlign: 'left', background: 'transparent', border: '1px solid var(--line)',
                  borderRadius: 10, padding: '8px 12px', color: 'inherit', cursor: h.path ? 'pointer' : 'default'
                }}
              >
                <span className="chip" style={{ marginRight: 8 }}>{hintLabel(h.kind)}</span>
                <span style={{ fontSize: 13 }}>{h.sentence}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {report && (
        <div className="card card-pad" style={{ maxWidth: 1100, marginBottom: 16 }}>
          <h2 style={{ marginBottom: 8 }}>Última evolução</h2>
          <pre className="faint" style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font)', fontSize: 13, lineHeight: 1.5, margin: 0 }}>{report}</pre>
        </div>
      )}

      <div className="skills-grid">
        <div className="card card-pad">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <IconDoc size={14} /> No cofre
            {data && <span className="faint" style={{ fontWeight: 400, fontSize: 11 }}>({items.length})</span>}
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            <button className={`chip ${segment === 'todas' ? 'chip--lime' : ''}`} onClick={() => setSegment('todas')}>
              Todas {data ? data.items.length : ''}
            </button>
            {(data?.segments ?? []).map(s => (
              <button key={s.id} className={`chip ${segment === s.id ? 'chip--lime' : ''}`} onClick={() => setSegment(s.id)}>
                {s.id} {s.count}
              </button>
            ))}
          </div>
          {!data && <p className="faint" style={{ fontSize: 13 }}>Carregando o cofre…</p>}
          {data && items.length === 0 && (
            <p className="faint" style={{ fontSize: 13 }}>
              Nenhuma skill neste segmento. Instale uma do SuperagentSkill ou deixe o sono gravar um procedimento.
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
            {items.map(s => (
              <button
                key={s.path}
                onClick={() => { setSelected(s.path); setTrust('') }}
                style={{
                  textAlign: 'left', cursor: 'pointer',
                  border: `1px solid ${current?.path === s.path ? 'var(--cyan)' : 'var(--line)'}`,
                  background: 'transparent', borderRadius: 10, padding: '8px 10px', color: 'inherit'
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{s.title}</span>
                  <span className="chip">{s.segment}</span>
                  <span className="faint" style={{ fontSize: 11, marginLeft: 'auto' }}>
                    {data?.notes.find(n => n.path === s.path)?.score != null
                      ? `nota ${data.notes.find(n => n.path === s.path)?.score} · `
                      : ''}
                    {s.uses + s.mentions} uso(s)
                    {data?.threats?.some(t => t.path === s.path && t.status !== 'clean')
                      ? ` · ${threatLabel(data.threats.find(t => t.path === s.path)!.status)}`
                      : ''}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {current && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <h2 style={{ margin: 0 }}>{current.title}</h2>
                <span className="chip">{current.kind}</span>
              </div>
              <p className="faint" style={{ fontSize: 12.5, margin: '8px 0' }}>
                {current.uses} gravações no diário · {current.mentions} menções nas conversas recentes
                {current.ageDays === 0 ? ' · hoje' : ` · ${current.ageDays} dias`}
              </p>
              <p style={{ fontSize: 13.5, lineHeight: 1.5 }}>{current.excerpt}</p>
              {threat && (
                <div style={{ marginTop: 10 }}>
                  <div className="hud-tag" style={{ marginBottom: 6 }}>Ameaça · {threatLabel(threat.status)}</div>
                  <p style={{ fontSize: 13, lineHeight: 1.5 }}>{threat.summary}</p>
                  {threat.injection && <p className="faint" style={{ fontSize: 12.5 }}>{threat.injection}</p>}
                  {threat.findings.length > 0 && (
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                      {threat.findings.map(f => <li key={`${f.severity}-${f.title}`}>[{f.severity}] {f.title}{f.detail ? ` — ${f.detail}` : ''}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {note && (
                <p className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>
                  Nota {note.score ?? 'sem número'} no boletim do SuperagentSkill, acima.
                </p>
              )}
              {hints.filter(h => h.path === current.path).map(h => (
                <p key={h.sentence} className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>{h.sentence}</p>
              ))}
              {trust && <p style={{ fontSize: 13, marginTop: 8 }}>{trust}</p>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                <button className="btn btn--sm" disabled={busy === 'review'} onClick={() => review(current.path)}>
                  {busy === 'review' ? 'Avaliando…' : 'Avaliar no SuperagentSkill'}
                </button>
                {current.slug && (
                  <button className="btn btn--ghost btn--sm" disabled={busy === 'trust'} onClick={() => showTrust(current.slug)}>
                    Confiança
                  </button>
                )}
                {current.slug && (
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => window.sb.openExternal(`https://superagentskill.com/marketplace/trust/${current.slug}`)}
                  >
                    Abrir no site
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="card card-pad">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <IconSparkle size={14} /> SuperagentSkill
          </h2>
          <p className="faint" style={{ fontSize: 12.5, marginBottom: 12 }}>
            O catálogo público entra no cofre como uma skill sua. Ela sincroniza e qualquer agente ligado passa a usá-la.
          </p>
          <form
            onSubmit={e => { e.preventDefault(); search() }}
            style={{ display: 'flex', gap: 8, marginBottom: 8 }}
          >
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar no catálogo"
              style={{ flex: 1, minWidth: 0 }}
            />
            <button className="btn btn--sm" type="submit" disabled={busy === 'search'}>
              {busy === 'search' ? '…' : 'Buscar'}
            </button>
          </form>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {REGISTRY_TYPES.map(t => (
              <button
                key={t.id || 'all'}
                type="button"
                className={`chip ${registryType === t.id ? 'chip--lime' : ''}`}
                onClick={() => setRegistryType(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {!data && results === null && <p className="faint" style={{ fontSize: 13 }}>Consultando o catálogo…</p>}
          {catalog.length === 0 && (
            <p className="faint" style={{ fontSize: 13 }}>Nada encontrado. Tente outra palavra, com pelo menos duas letras.</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 520, overflowY: 'auto' }}>
            {catalog.map(s => (
              <div key={s.slug} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</span>
                  <span className="chip">{s.type}</span>
                  {s.alreadyHave && <span className="chip chip--lime">No cofre</span>}
                </div>
                {s.description && <p className="faint" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.45 }}>{s.description}</p>}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <span className="faint" style={{ fontSize: 11, marginRight: 'auto' }}>
                    {s.installs > 0 ? `${s.installs.toLocaleString('pt-BR')} instalações` : s.slug}
                  </span>
                  {!s.alreadyHave && (
                    <button className="btn btn--sm" disabled={busy === `install-${s.slug}`} onClick={() => install(s.slug)}>
                      {busy === `install-${s.slug}` ? '…' : 'Instalar'}
                    </button>
                  )}
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => window.sb.openExternal(`https://superagentskill.com/marketplace/trust/${s.slug}`)}
                  >
                    Site
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            className="btn btn--ghost btn--sm"
            style={{ marginTop: 12 }}
            onClick={() => window.sb.openExternal('https://superagentskill.com')}
          >
            Abrir superagentskill.com
          </button>
        </div>
      </div>
    </div>
  )
}
