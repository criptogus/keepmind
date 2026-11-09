import { useEffect, useState } from 'react'
import { IconSparkle, IconDoc, IconSync } from './icons'

// Skill bank — everything the second brain knows how to do. Vault skills
// (skills/*.md + long-term/skills.md, written by evolve/skills crons or
// installed from the registry) next to installable suggestions from
// superagentskill.com. Installing writes into memory/skills/ → syncs to
// GitHub → every connected agent can use it.

export default function Skills({ onActivity, onToast }: { onActivity?: () => void; onToast?: (m: string, k?: 'info' | 'error' | 'success') => void }) {
  const [skills, setSkills] = useState<{ items: any[]; suggestions: any[] } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = async () => {
    const s = await window.sb.brainSkills().catch(() => null)
    if (s) setSkills(s)
  }

  useEffect(() => { refresh() }, [])

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

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>SKILL BANK</div>
          <h1>What your brain knows how to do</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>
            Procedural memory — skills the brain accumulated and can hand to any connected agent.
          </p>
        </div>
        <button className="btn" onClick={refresh}>↻ REFRESH</button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 1100 }}>
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
          <div style={{ maxHeight: 480, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(skills?.items ?? []).map((s: any) => (
              <div key={s.file} className="goal-row" style={{ cursor: 'default' }}>
                <IconSparkle size={12} />
                <span className="goal-text">{s.title}</span>
                <span className="faint mono" style={{ fontSize: 10 }}>
                  {s.file}
                </span>
                <span className="faint mono" style={{ fontSize: 10 }}>
                  {s.ageDays === 0 ? 'new' : `${s.ageDays}d`}
                </span>
              </div>
            ))}
          </div>
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
          <div style={{ maxHeight: 480, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
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
