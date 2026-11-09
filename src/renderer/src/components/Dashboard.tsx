import { useEffect, useState } from 'react'
import { IconSparkle } from './icons'

// Brain Health — meta-insights ABOUT the second brain: which crons should
// run, what's idle, where intelligence leaks. Every card carries evidence
// and an action you can apply. The skill bank lives on its own Skills page.

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
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = async () => {
    const r = await window.sb.brainHealth().catch(() => null)
    if (r) setReport(r)
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

      {/* skill bank lives on its own page */}
      <div className="card card-pad" style={{ maxWidth: 900, display: 'flex', alignItems: 'center', gap: 12 }}>
        <IconSparkle size={16} />
        <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>
          Procedural memory — the skills your brain accumulated and can install new ones — lives on the <strong style={{ color: 'var(--text)' }}>Skills</strong> page.
        </p>
      </div>
    </div>
  )
}
