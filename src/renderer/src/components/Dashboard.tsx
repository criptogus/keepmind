import { useEffect, useState } from 'react'
import { IconSparkle, IconDoc, IconSync } from './icons'

// Brain Health — meta-insights ABOUT the second brain: which crons should
// run, what's idle, where intelligence leaks. Every card carries evidence
// and an action you can apply. Below: the skill bank (vault skills +
// registry suggestions installable into memory/skills/).

const IMPACT_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  high: { label: 'HIGH', color: '#fb7185', bg: 'rgba(251,113,133,.12)' },
  medium: { label: 'MED', color: '#fbbf24', bg: 'rgba(251,191,36,.1)' },
  low: { label: 'LOW', color: '#38bdf8', bg: 'rgba(56,189,248,.1)' }
}

const ACTION_LABEL: Record<string, string> = {
  'create-automation': '⚡ enable cron',
  'enable-automation': '⚡ enable',
  'run-now': '▶ run now'
}

export default function Dashboard({ onActivity, onToast }: { onActivity?: () => void; onToast?: (m: string, k?: 'info' | 'error' | 'success') => void }) {
  const [report, setReport] = useState<any>(null)
  const [skills, setSkills] = useState<{ items: any[]; suggestions: any[] } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = async () => {
    const [r, s] = await Promise.all([
      window.sb.brainHealth().catch(() => null),
      window.sb.brainSkills().catch(() => null)
    ])
    if (r) setReport(r)
    if (s) setSkills(s)
  }

  useEffect(() => { refresh() }, [])

  const apply = async (recId: string) => {
    setBusy(recId)
    onActivity?.()
    try {
      const r = await window.sb.brainHealthApply(recId)
      setReport(r)
      onToast?.('Applied — brain config updated', 'success')
    } catch (e: any) {
      onToast?.(`Apply failed: ${e?.message ?? e}`, 'error')
    } finally { setBusy(null) }
  }

  const install = async (slug: string) => {
    setBusy(`skill-${slug}`)
    onActivity?.()
    try {
      await window.sb.brainSkillInstall(slug)
      onToast?.(`Skill "${slug}" installed to skills/ — syncing to GitHub`, 'success')
      await refresh()
    } catch (e: any) {
      onToast?.(`Install failed: ${e?.message ?? e}`, 'error')
    } finally { setBusy(null) }
  }

  const st = report?.stats

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>BRAIN HEALTH</div>
          <h1>Second brain diagnostics</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>
            Meta-insights about the brain itself — what to automate, what's idle, how to get smarter.
            {report && <> Generated {new Date(report.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · recomputed from journal + vault on every load.</>}
          </p>
        </div>
        <button className="btn" onClick={refresh}>↻ REFRESH</button>
      </div>

      {/* vitals */}
      {st && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10, marginBottom: 20, maxWidth: 900 }}>
          {[
            { k: 'memory files', v: st.files },
            { k: 'writes / 7d', v: st.writes7d },
            { k: 'entities', v: st.entities },
            { k: 'skills', v: st.skills },
            { k: 'crons enabled', v: `${st.automationsEnabled}/${st.automationsTotal}` },
            { k: 'search gaps', v: st.searchGaps }
          ].map(m => (
            <div key={m.k} className="card stat" style={{ padding: '12px 14px' }}>
              <div className="stat__num" style={{ fontSize: 20 }}>{m.v}</div>
              <div className="stat__label">{m.k}</div>
            </div>
          ))}
        </div>
      )}

      {/* recommendations */}
      <div className="hud-tag" style={{ marginBottom: 10 }}>RECOMMENDATIONS</div>
      {!report && <p className="faint" style={{ fontSize: 13 }}>Analyzing brain…</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 900, marginBottom: 28 }}>
        {(report?.recommendations ?? []).map((r: any) => {
          const im = IMPACT_STYLE[r.impact] ?? IMPACT_STYLE.low
          return (
            <div key={r.id} className="card card-pad" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <span style={{
                fontFamily: 'var(--mono)', fontSize: 9.5, fontWeight: 700, letterSpacing: '.06em',
                padding: '3px 8px', borderRadius: 6, flexShrink: 0, marginTop: 2,
                color: im.color, background: im.bg, border: `1px solid ${im.color}44`
              }}>{im.label}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 650 }}>{r.title}</div>
                <p className="faint" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>{r.detail}</p>
              </div>
              {r.action && (
                <button
                  className="btn btn--sm btn--primary"
                  style={{ flexShrink: 0 }}
                  disabled={busy === r.id}
                  onClick={() => apply(r.id)}
                >
                  {busy === r.id ? '…' : ACTION_LABEL[r.action.type] ?? 'APPLY'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* skill bank */}
      <div className="hud-tag" style={{ marginBottom: 10 }}>SKILL BANK</div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 980 }}>
        {/* vault skills */}
        <div className="card card-pad">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <IconDoc size={14} /> In your vault
            {skills && <span className="faint" style={{ fontWeight: 400, fontSize: 11 }}>({skills.items.length})</span>}
          </h2>
          {!skills && <p className="faint" style={{ fontSize: 12.5 }}>Loading…</p>}
          {skills?.items.length === 0 && (
            <p className="faint" style={{ fontSize: 12.5 }}>
              No skills yet — the evolve/skills crons write them here, or install one from the registry →
            </p>
          )}
          {(skills?.items ?? []).map((s: any) => (
            <div key={s.file} className="goal-row" style={{ cursor: 'default' }}>
              <IconSparkle size={12} />
              <span className="goal-text">{s.title}</span>
              <span className="faint mono" style={{ fontSize: 10 }}>
                {s.ageDays === 0 ? 'new' : `${s.ageDays}d`}
              </span>
            </div>
          ))}
        </div>

        {/* registry suggestions */}
        <div className="card card-pad">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <IconSync size={14} /> From superagentskill.com
          </h2>
          <p className="faint" style={{ fontSize: 11.5, marginBottom: 12 }}>
            Installing writes the skill into <span className="mono">skills/</span> — it syncs to GitHub and every connected agent can use it.
          </p>
          {!skills && <p className="faint" style={{ fontSize: 12.5 }}>Querying registry…</p>}
          {skills?.suggestions.length === 0 && (
            <p className="faint" style={{ fontSize: 12.5 }}>Registry unreachable or no matches.</p>
          )}
          <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(skills?.suggestions ?? []).map((s: any) => (
              <div key={s.slug} style={{
                border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px',
                display: 'flex', gap: 10, alignItems: 'flex-start'
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</span>
                    <span className="badge badge--custom" style={{ fontSize: 9 }}>{s.type}</span>
                    {s.alreadyHave && <span className="chip chip--lime" style={{ fontSize: 9 }}>HAVE</span>}
                  </div>
                  <p className="faint" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.45 }}>{s.description}</p>
                  <div className="faint mono" style={{ fontSize: 9.5, marginTop: 4 }}>
                    {s.installs > 0 ? `⬇ ${s.installs.toLocaleString()} installs` : s.slug}
                  </div>
                </div>
                {!s.alreadyHave && (
                  <button
                    className="btn btn--sm"
                    style={{ flexShrink: 0 }}
                    disabled={busy === `skill-${s.slug}`}
                    onClick={() => install(s.slug)}
                  >
                    {busy === `skill-${s.slug}` ? '…' : '+ add'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
