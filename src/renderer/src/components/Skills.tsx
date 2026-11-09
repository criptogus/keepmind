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
  category: string
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
  paths?: string[]
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
  categories: { id: string; label: string; count: number }[]
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
    case 'threat': return 'Threat'
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
  const [category, setCategory] = useState('todas')
  const [vaultQuery, setVaultQuery] = useState('')
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
    const q = vaultQuery.trim().toLowerCase()
    return (data?.items ?? []).filter(s => {
      if (segment !== 'todas' && s.segment !== segment) return false
      if (category !== 'todas' && s.category !== category) return false
      if (!q) return true
      return `${s.title} ${s.excerpt} ${s.path} ${s.slug} ${s.category}`.toLowerCase().includes(q)
    })
  }, [data, segment, category, vaultQuery])

  const ranked = useMemo(() => {
    return [...(data?.items ?? [])]
      .sort((a, b) => (b.uses + b.mentions) - (a.uses + a.mentions) || a.title.localeCompare(b.title))
      .slice(0, 10)
  }, [data])

  const categoryLabel = (id: string) => data?.categories?.find(c => c.id === id)?.label ?? id

  const openSkill = (path: string, categoryId?: string) => {
    setSegment('todas')
    setVaultQuery('')
    if (categoryId) setCategory(categoryId)
    setSelected(path)
    setTrust('')
  }

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
      onToast?.(e?.message ?? 'Could not install.', 'error')
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
      onToast?.(e?.message ?? 'SuperagentSkill did not respond.', 'error')
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
      onToast?.(e?.message ?? 'Scoring failed.', 'error')
    } finally { setBusy(null) }
  }

  const evolve = async () => {
    setBusy('evolve')
    onActivity?.()
    try {
      const out = await window.sb.brainSkillEvolve()
      setReport(out.report)
      setData(d => d ? { ...d, hints: out.hints } : d)
      onToast?.('Skill evolution saved to insights/.', 'success')
    } catch (e: any) {
      onToast?.(e?.message ?? 'Evolution failed.', 'error')
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
          : 'No vault skill was flagged as malicious.',
        blocked ? 'error' : 'success'
      )
    } catch (e: any) {
      onToast?.(e?.message ?? 'Threat analysis failed.', 'error')
    } finally { setBusy(null) }
  }

  const keepCopy = async (path: string) => {
    setBusy(`keep-${path}`)
    onActivity?.()
    try {
      const out = await window.sb.brainSkillKeep(path)
      const n = out?.archived?.length ?? 0
      onToast?.(n ? `Kept ${out.kept}. Archived ${n} other file${n === 1 ? '' : 's'} under skills/_arquivo/.` : 'Kept that copy.', 'success')
      setSelected(out?.kept ?? path)
      await refresh()
    } catch (e: any) {
      onToast?.(e?.message ?? 'Could not archive the other copies.', 'error')
    } finally { setBusy(null) }
  }

  const showTrust = async (slug: string) => {
    setBusy('trust')
    try {
      const t = await window.sb.brainSkillTrust(slug)
      setTrust(t.summary)
    } catch (e: any) {
      onToast?.(e?.message ?? 'No trust report.', 'error')
    } finally { setBusy(null) }
  }

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>HABILIDADES</div>
          <h1>What the brain can do</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4, maxWidth: 680 }}>
            Your skills, split by origin. Usage comes from chats and the journal. Scores and malicious-skill analysis come from SuperagentSkill, on demand.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn--ghost btn--sm" onClick={refresh}>Refresh</button>
          <button className="btn btn--ghost btn--sm" disabled={busy === 'threat'} onClick={scanThreats}>
            {busy === 'threat' ? 'Analyzing…' : 'Scan threats'}
          </button>
          <button className="btn btn--sm" disabled={busy === 'evolve'} onClick={evolve}>
            {busy === 'evolve' ? 'Evolving…' : 'Evolve with the brain'}
          </button>
        </div>
      </div>

      <SakScoreboard
        skills={data?.items ?? []}
        notes={data?.notes ?? []}
        selectedPath={selected}
        busy={busy === 'review'}
        onSelect={path => openSkill(path)}
        onReview={review}
      />

      <div className="card card-pad" style={{ maxWidth: 1100, marginBottom: 16 }}>
        <h2 style={{ marginBottom: 8 }}>Malicious skills</h2>
        <p className="faint" style={{ fontSize: 13, lineHeight: 1.5, marginTop: 0 }}>
          SuperagentSkill runs both checks. For a published package, the trust report carries robustness findings: injection, leakage and jailbreak. For a vault file, the upload dry-run runs the prompt-injection guard and publishes nothing. A critical finding blocks install.
        </p>
        {(data?.threats.length ?? 0) === 0 && (
          <p className="faint" style={{ fontSize: 13, marginBottom: 0 }}>Has not run on this machine yet. The button above analyzes what is in the vault.</p>
        )}
        {(data?.threats.length ?? 0) > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(data?.threats ?? []).map(t => (
              <button
                key={t.path}
                onClick={() => openSkill(t.path)}
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

      <div className="card card-pad" style={{ maxWidth: 1100, marginBottom: 16 }}>
        <h2 style={{ marginBottom: 4 }}>Top 10 most used</h2>
        <p className="faint" style={{ fontSize: 12.5, marginTop: 0 }}>
          Ranked by journal writes plus mentions in recent chats, across the whole vault.
        </p>
        {ranked.length === 0 && <p className="faint" style={{ fontSize: 13, marginBottom: 0 }}>The vault has no skills yet.</p>}
        {ranked.length > 0 && ranked.every(s => s.uses + s.mentions === 0) && (
          <p className="faint" style={{ fontSize: 13 }}>None of these have been used yet. The list is the first ten skills in the vault.</p>
        )}
        <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {ranked.map(s => (
            <li key={s.path}>
              <button
                onClick={() => openSkill(s.path, s.category)}
                style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', textAlign: 'left', padding: 0 }}
              >
                <span style={{ fontWeight: 600, fontSize: 13 }}>{s.title}</span>
                <span className="faint" style={{ fontSize: 12 }}>
                  {' '}· {categoryLabel(s.category)} · {s.uses + s.mentions} use{s.uses + s.mentions === 1 ? '' : 's'}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="card card-pad" style={{ maxWidth: 1100, marginBottom: 16 }}>
        <h2 style={{ marginBottom: 4 }}>Needs improvement</h2>
        <p className="faint" style={{ fontSize: 12.5, marginTop: 0 }}>
          Duplicate names, low SuperagentSkill scores, skills used with no score, and skills idle for 14 days.
        </p>
        {(data?.hints.length ?? 0) === 0 && (
          <p className="faint" style={{ fontSize: 13, marginBottom: 0 }}>Nothing is waiting. New duplicates and weak scores show up here.</p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(data?.hints ?? []).filter(h => h.kind === 'duplicate').map(h => (
            <div key={h.paths?.join('|') ?? h.path} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ marginBottom: 8 }}>
                <span className="chip" style={{ marginRight: 8 }}>{hintLabel(h.kind)}</span>
                <span style={{ fontSize: 13 }}>{h.sentence}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(h.paths ?? [h.path]).map(path => {
                  const skill = data?.items.find(s => s.path === path)
                  return (
                    <div key={path} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => openSkill(path, skill?.category)}
                        style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                      >
                        <span className="mono" style={{ fontSize: 12 }}>{path}</span>
                        {skill && <span className="faint" style={{ fontSize: 11 }}> · {skill.uses + skill.mentions} uses</span>}
                      </button>
                      <button
                        className="btn btn--sm"
                        style={{ marginLeft: 'auto' }}
                        disabled={busy === `keep-${path}`}
                        onClick={() => keepCopy(path)}
                      >
                        {busy === `keep-${path}` ? 'Archiving…' : 'Keep this copy'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          {(data?.hints ?? []).filter(h => h.kind !== 'duplicate').slice(0, 8).map((h, i) => (
            <button
              key={`${h.path}-${h.kind}-${i}`}
              onClick={() => { if (h.path) openSkill(h.path) }}
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

      {report && (
        <div className="card card-pad" style={{ maxWidth: 1100, marginBottom: 16 }}>
          <h2 style={{ marginBottom: 8 }}>Last evolution</h2>
          <pre className="faint" style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font)', fontSize: 13, lineHeight: 1.5, margin: 0 }}>{report}</pre>
        </div>
      )}

      <div className="skills-grid">
        <div className="card card-pad">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <IconDoc size={14} /> In the vault
            {data && <span className="faint" style={{ fontWeight: 400, fontSize: 11 }}>({items.length})</span>}
          </h2>
          <input
            value={vaultQuery}
            onChange={e => setVaultQuery(e.target.value)}
            placeholder="Search by name, category, or file"
            style={{ width: '100%', marginBottom: 10 }}
          />
          <div className="faint" style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>Category</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            <button className={`chip ${category === 'todas' ? 'chip--active' : ''}`} onClick={() => setCategory('todas')}>
              All {data ? data.items.length : ''}
            </button>
            {(data?.categories ?? []).map(c => (
              <button key={c.id} className={`chip ${category === c.id ? 'chip--active' : ''}`} onClick={() => setCategory(c.id)}>
                {c.label} {c.count}
              </button>
            ))}
          </div>
          <div className="faint" style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>Origin</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            <button className={`chip ${segment === 'todas' ? 'chip--active' : ''}`} onClick={() => setSegment('todas')}>
              All
            </button>
            {(data?.segments ?? []).map(s => (
              <button key={s.id} className={`chip ${segment === s.id ? 'chip--active' : ''}`} onClick={() => setSegment(s.id)}>
                {s.id} {s.count}
              </button>
            ))}
          </div>
          {!data && <p className="faint" style={{ fontSize: 13 }}>Loading the vault…</p>}
          {data && items.length === 0 && (
            <p className="faint" style={{ fontSize: 13 }}>
              No skills in this category. Try another chip, or install one from SuperagentSkill.
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
                  <span className="chip">{categoryLabel(s.category)}</span>
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
              <p className="faint mono" style={{ fontSize: 11.5, margin: '8px 0 0' }}>{current.path}</p>
              <p className="faint" style={{ fontSize: 12.5, margin: '6px 0' }}>
                {categoryLabel(current.category)} · {current.uses} journal writes · {current.mentions} mentions in recent chats
                {current.ageDays === 0 ? ' · hoje' : ` · ${current.ageDays} dias`}
              </p>
              <p style={{ fontSize: 13.5, lineHeight: 1.5 }}>{current.excerpt}</p>
              {threat && (
                <div style={{ marginTop: 10 }}>
                  <div className="hud-tag" style={{ marginBottom: 6 }}>Threat · {threatLabel(threat.status)}</div>
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
                  Score {note.score ?? 'unscored'} on the SuperagentSkill board, above.
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
                    Trust
                  </button>
                )}
                {current.slug && (
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => window.sb.openExternal(`https://superagentskill.com/marketplace/trust/${current.slug}`)}
                  >
                    Open on site
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
            The public catalog lands in the vault as your skill. It syncs and any connected agent can use it.
          </p>
          <form
            onSubmit={e => { e.preventDefault(); search() }}
            style={{ display: 'flex', gap: 8, marginBottom: 8 }}
          >
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search the catalog"
              style={{ flex: 1, minWidth: 0 }}
            />
            <button className="btn btn--sm" type="submit" disabled={busy === 'search'}>
              {busy === 'search' ? '…' : 'Search'}
            </button>
          </form>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {REGISTRY_TYPES.map(t => (
              <button
                key={t.id || 'all'}
                type="button"
                className={`chip ${registryType === t.id ? 'chip--active' : ''}`}
                onClick={() => setRegistryType(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {!data && results === null && <p className="faint" style={{ fontSize: 13 }}>Searching the catalog…</p>}
          {catalog.length === 0 && (
            <p className="faint" style={{ fontSize: 13 }}>Nothing found. Try another word, at least two letters.</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 520, overflowY: 'auto' }}>
            {catalog.map(s => (
              <div key={s.slug} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</span>
                  <span className="chip">{s.type}</span>
                  {s.alreadyHave && <span className="chip chip--amber">In the vault</span>}
                </div>
                {s.description && <p className="faint" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.45 }}>{s.description}</p>}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <span className="faint" style={{ fontSize: 11, marginRight: 'auto' }}>
                    {s.installs > 0 ? `${s.installs.toLocaleString('pt-BR')} installs` : s.slug}
                  </span>
                  {!s.alreadyHave && (
                    <button className="btn btn--sm" disabled={busy === `install-${s.slug}`} onClick={() => install(s.slug)}>
                      {busy === `install-${s.slug}` ? '…' : 'Install'}
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
            Open superagentskill.com
          </button>
        </div>
      </div>
    </div>
  )
}
