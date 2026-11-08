import { useEffect, useRef, useState } from 'react'
import { IconClock, IconMoon, IconSync, IconPlay, IconTrash, IconSparkle } from './icons'

interface Automation {
  id: string
  name: string
  instruction: string
  kind: 'brain' | 'sleep' | 'summary'
  schedule: 'daily' | 'interval' | 'weekly'
  time?: string
  everyMinutes?: number
  weekday?: number
  enabled: boolean
  lastRunAt?: string
  createdAt: string
}

interface Parsed {
  kind: string
  schedule: string
  label: string
  time?: string
  everyMinutes?: number
  weekday?: number
  name: string
}

const KIND_LABEL: Record<string, string> = {
  brain: 'brain task',
  sleep: 'sleep cycle',
  summary: 'summary'
}

function scheduleLabel(a: Automation): string {
  if (a.schedule === 'interval') {
    const m = a.everyMinutes ?? 60
    return m < 60 ? `every ${m} min` : m < 1440 ? `every ${m / 60}h` : `every ${m / 1440}d`
  }
  if (a.schedule === 'weekly') {
    const d = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][a.weekday ?? 1]
    return `every ${d} at ${a.time ?? '09:00'}`
  }
  return `every day at ${a.time ?? '08:00'}`
}

export default function Automations({ onActivity, onToast }: { onActivity?: () => void; onToast?: (m: string, k?: 'info' | 'error' | 'success') => void }) {
  const [autos, setAutos] = useState<Automation[]>([])
  const [tiers, setTiers] = useState<any>(null)
  const [sleepReports, setSleepReports] = useState<any[]>([])
  const [sync, setSync] = useState<any>(null)
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [sleeping, setSleeping] = useState(false)
  const parseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = async () => {
    const [a, t, s, sy] = await Promise.all([
      window.sb.automationList(),
      window.sb.brainMemoryTiers(),
      window.sb.brainListSleep(),
      window.sb.syncStatus()
    ])
    setAutos(a ?? []); setTiers(t); setSleepReports(s ?? []); setSync(sy)
  }

  useEffect(() => { refresh() }, [])

  // live NL → schedule preview
  useEffect(() => {
    if (parseTimer.current) clearTimeout(parseTimer.current)
    if (!text.trim()) { setParsed(null); return }
    parseTimer.current = setTimeout(async () => {
      try { setParsed(await window.sb.automationParse(text)) } catch { /* noop */ }
    }, 350)
    return () => { if (parseTimer.current) clearTimeout(parseTimer.current) }
  }, [text])

  const create = async () => {
    if (!text.trim()) return
    setBusy('create')
    try {
      await window.sb.automationCreate({ instruction: text })
      setText(''); setParsed(null)
      onToast?.('Automation scheduled ✓', 'success')
      await refresh()
    } catch (e: any) { onToast?.(e?.message ?? String(e), 'error') }
    finally { setBusy(null) }
  }

  const toggle = async (a: Automation) => {
    await window.sb.automationUpdate(a.id, { enabled: !a.enabled })
    await refresh()
  }
  const runNow = async (a: Automation) => {
    setBusy(a.id); onActivity?.()
    try { await window.sb.automationRunNow(a.id); onToast?.(`"${a.name}" ran`, 'success'); await refresh() }
    catch (e: any) { onToast?.(e?.message ?? String(e), 'error') }
    finally { setBusy(null) }
  }
  const remove = async (a: Automation) => {
    await window.sb.automationRemove(a.id)
    await refresh()
  }

  const sleepNow = async () => {
    setSleeping(true); onActivity?.()
    try {
      const r = await window.sb.brainSleep()
      onToast?.('Sleep cycle complete — the brain learned from today 🌙', 'success')
      await refresh()
      // surface the report
      const reports = await window.sb.brainListSleep()
      setSleepReports(reports ?? [])
      void r
    } catch (e: any) { onToast?.(e?.message ?? String(e), 'error') }
    finally { setSleeping(false) }
  }

  const syncNow = async () => {
    setBusy('sync')
    try { await window.sb.syncNow(); await refresh(); onToast?.('Synced with GitHub ✓', 'success') }
    catch (e: any) { onToast?.(e?.message ?? String(e), 'error') }
    finally { setBusy(null) }
  }

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag hud-tag--amber" style={{ marginBottom: 6 }}>AUTOMATIONS · SLEEP CYCLES · SYNC</div>
          <h1 style={{ textShadow: '0 0 24px rgba(163,230,53,.3)' }}>AUTOMATE</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>
            Schedule the brain in plain language. It runs even while you sleep — and learns from every cycle.
          </p>
        </div>
        <div className="actions">
          <button className="btn btn--ghost" onClick={syncNow} disabled={busy === 'sync' || !sync?.connected}>
            <IconSync size={12} /> {busy === 'sync' ? 'SYNCING…' : sync?.connected ? 'SYNC NOW' : 'NO REPO'}
          </button>
        </div>
      </div>

      {/* Memory tiers */}
      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <div className="card stat"><div className="stat__num" style={{ color: 'var(--cyan)' }}>{tiers?.shortTerm ?? '—'}</div><div className="stat__label">SHORT-TERM · daily logs</div></div>
        <div className="card stat"><div className="stat__num" style={{ color: 'var(--amber)' }}>{tiers?.mediumTerm ?? '—'}</div><div className="stat__label">MEDIUM-TERM · weekly</div></div>
        <div className="card stat"><div className="stat__num" style={{ color: 'var(--lime)' }}>{tiers?.longTerm ?? '—'}</div><div className="stat__label">LONG-TERM · facts & skills</div></div>
        <div className="card stat"><div className="stat__num" style={{ color: 'var(--violet)' }}>{tiers?.sleepCycles ?? '—'}</div><div className="stat__label">SLEEP CYCLES</div></div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 20 }}>
        {/* New automation */}
        <div className="card card-pad">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><IconClock size={15} /> New automation</h2>
          <p className="faint" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.6 }}>
            Describe it naturally — the brain figures out the schedule.
            e.g. <em>"every day at 8am summarize my whatsapp and save important contacts"</em> or
            {' '}<em>"every 2 hours check my email for urgent threads"</em>
          </p>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="every day at 8am, …"
            rows={3}
            style={{
              width: '100%', marginTop: 12, padding: '12px 14px', borderRadius: 12,
              background: 'rgba(3,7,18,.7)', border: '1px solid var(--line)',
              color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12.5,
              resize: 'vertical', outline: 'none'
            }}
          />
          {parsed && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <span className="chip" style={{ borderColor: 'rgba(34,211,238,.35)', color: 'var(--cyan)' }}>{parsed.label}</span>
              <span className="chip">{KIND_LABEL[parsed.kind] ?? parsed.kind}</span>
            </div>
          )}
          <button
            className="btn btn--primary"
            style={{ marginTop: 14 }}
            disabled={!text.trim() || busy === 'create'}
            onClick={create}
          >
            <IconSparkle size={12} /> {busy === 'create' ? 'SCHEDULING…' : 'SCHEDULE'}
          </button>
        </div>

        {/* Sleep mode */}
        <div className="card card-pad" style={{ borderColor: 'rgba(167,139,250,.25)' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><IconMoon size={15} /> Sleep mode</h2>
          <p className="faint" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.6 }}>
            The brain's nightly cycle reviews the day and answers five questions:
            what's <strong>working</strong>, what works but <strong>can improve</strong>,
            what <strong>isn't working</strong> (fix it / <strong>stop it</strong>),
            and what we're <strong>not doing yet</strong> that we should start.
            Learnings go to long-term memory — facts, lessons and reusable skills.
          </p>
          <button
            className="btn"
            style={{ marginTop: 14, borderColor: 'rgba(167,139,250,.4)', color: '#c4b5fd' }}
            disabled={sleeping}
            onClick={sleepNow}
          >
            <IconMoon size={12} /> {sleeping ? 'DREAMING…' : 'RUN SLEEP CYCLE NOW'}
          </button>
          {sync?.lastPull && (
            <p className="faint mono" style={{ fontSize: 10.5, marginTop: 12 }}>
              last github pull {new Date(sync.lastPull).toLocaleTimeString()} · {sync.pending} pending push{sync.pending === 1 ? '' : 'es'}
            </p>
          )}
        </div>
      </div>

      {/* Active automations */}
      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <h2>Active automations ({autos.filter(a => a.enabled).length}/{autos.length})</h2>
        {autos.length === 0 ? (
          <p className="faint" style={{ fontSize: 13, marginTop: 12, lineHeight: 1.6 }}>
            No automations yet. Describe one above — e.g.{' '}
            <em>"every morning at 7am give me a briefing of yesterday"</em>.
          </p>
        ) : (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {autos.map(a => (
              <div key={a.id} className="insight-item" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13 }}>{a.name}</strong>
                    <span className="chip" style={{ fontSize: 9.5 }}>{scheduleLabel(a)}</span>
                    <span className="chip" style={{ fontSize: 9.5, opacity: .8 }}>{KIND_LABEL[a.kind]}</span>
                    {!a.enabled && <span className="chip" style={{ fontSize: 9.5, opacity: .6 }}>paused</span>}
                  </div>
                  <p className="faint" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>{a.instruction}</p>
                  <p className="faint mono" style={{ fontSize: 10.5, marginTop: 6 }}>
                    last run: {a.lastRunAt ? new Date(a.lastRunAt).toLocaleString() : 'never'}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button className="btn btn--ghost" style={{ padding: '6px 12px', fontSize: 10 }} disabled={busy === a.id} onClick={() => runNow(a)}>
                    <IconPlay size={10} /> {busy === a.id ? '…' : 'RUN'}
                  </button>
                  <button className="btn btn--ghost" style={{ padding: '6px 12px', fontSize: 10 }} onClick={() => toggle(a)}>
                    {a.enabled ? 'PAUSE' : 'RESUME'}
                  </button>
                  <button className="btn btn--ghost" style={{ padding: '6px 10px', fontSize: 10, color: '#f87171' }} onClick={() => remove(a)}>
                    <IconTrash size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sleep reports */}
      {sleepReports.length > 0 && (
        <div className="card card-pad">
          <h2>Sleep cycle reports</h2>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sleepReports.slice(0, 10).map((r: any) => (
              <details key={r.date} className="insight-item" style={{ cursor: 'pointer' }}>
                <summary style={{ flex: 1, listStyle: 'none' }}>
                  <span className="mono" style={{ fontSize: 12 }}>🌙 {r.date}</span>
                </summary>
                <div className="msg__body" style={{ fontSize: 12.5, marginTop: 10 }} dangerouslySetInnerHTML={{ __html: md(r.content) }} />
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function md(s: string) {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/### (.+)/g, '<div style="margin-top:12px"><strong style="color:var(--cyan)">$1</strong></div>')
    .replace(/^- /gm, '• ')
    .replace(/\n/g, '<br/>')
}
