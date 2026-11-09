import { useEffect, useRef, useState } from 'react'
import { IconClock, IconMoon, IconSync, IconPlay, IconTrash, IconSparkle } from './icons'

interface Automation {
  id: string
  name: string
  instruction: string
  kind: 'brain' | 'sleep' | 'summary' | 'librarian' | 'evolve' | 'enrich' | 'review' | 'security' | 'skills' | 'triage' | 'briefing' | 'escalate' | 'compact' | 'gaps'
  schedule: 'daily' | 'interval' | 'weekly'
  time?: string
  everyMinutes?: number
  weekday?: number
  enabled: boolean
  mode?: 'auto' | 'approval'
  webhook?: boolean
  webhookToken?: string
  lastRunAt?: string
  lastSummary?: string
  createdAt: string
}

interface PendingApproval {
  id: string
  automationId: string
  name: string
  kind: string
  instruction: string
  createdAt: string
}

interface ActivityEntry {
  ts: number
  op: 'write' | 'append' | 'remove'
  path: string
  source: string
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
  brain: 'free task',
  sleep: 'sleep',
  summary: 'summary',
  librarian: 'cleanup',
  evolve: 'evolution',
  enrich: 'enrichment',
  review: 'your review',
  security: 'security',
  skills: 'skills',
  triage: 'triage',
  briefing: 'briefing',
  escalate: 'tasks',
  compact: 'compact',
  gaps: 'gaps'
}

const KINDS = Object.keys(KIND_LABEL)

// Ready-made self-learning crons — one click installs them.
const TEMPLATES: { emoji: string; name: string; desc: string; input: any }[] = [
  { emoji: '🌙', name: 'Nightly sleep', desc: '23:00 — reviews the day, answers the 5 learning questions, distills facts/lessons/skills.', input: { name: 'Nightly sleep cycle', kind: 'sleep', schedule: 'daily', time: '23:00', instruction: 'Nightly learning cycle: review the day and distill durable memory.' } },
  { emoji: '📊', name: 'Morning summary', desc: '08:00 — recaps yesterday and briefs the day ahead.', input: { name: 'Morning summary', kind: 'summary', schedule: 'daily', time: '08:00', instruction: 'Daily summary of yesterday and briefing for today.' } },
  { emoji: '🧹', name: 'Weekly librarian', desc: 'Mon 09:00 — consolidates old logs, dedupes long-term memory, refreshes entities.', input: { name: 'Weekly librarian', kind: 'librarian', schedule: 'weekly', weekday: 1, time: '09:00', instruction: 'Weekly vault hygiene: consolidate old logs, dedupe long-term memory, refresh entity pages.' } },
  { emoji: '🧬', name: 'Weekly evolution', desc: 'Sun 18:00 — the brain reviews its own reports and proposes upgrades to itself.', input: { name: 'Weekly evolution', kind: 'evolve', schedule: 'weekly', weekday: 0, time: '18:00', instruction: 'Meta-learning: review sleep reports and insights, propose improvements to the memory system itself.' } },
  { emoji: '✨', name: 'Nightly enrichment', desc: '02:30 — adds summaries, tags and [[wikilinks]] to recent notes.', input: { name: 'Nightly note enrichment', kind: 'enrich', schedule: 'daily', time: '02:30', instruction: 'Enrich recent notes with summaries, topic tags and entity wikilinks.' } },
  { emoji: '🃏', name: 'Your review', desc: 'Daily 20:00 — puts due cards on Today. The note is yours.', input: { name: 'Human review queue', kind: 'review', schedule: 'daily', time: '20:00', instruction: 'Put due flashcards on Today for the person to grade.' } },
  { emoji: '🛡️', name: 'Security audit', desc: 'Weekly Sun 07:00 — scans memory for leaked secrets, API keys and credentials.', input: { name: 'Security audit', kind: 'security', schedule: 'weekly', weekday: 0, time: '07:00', instruction: 'Scan all memory files for leaked secrets and credentials; report exposures without printing values.' } },
  { emoji: '📈', name: 'Skills evolution', desc: 'Weekly Sat 10:00 — dedupes skills, consolidates procedures, proposes promotions to skills/.', input: { name: 'Skills evolution', kind: 'skills', schedule: 'weekly', weekday: 6, time: '10:00', instruction: 'Review procedural skills: dedupe, merge, prune stale ones, propose which deserve dedicated pages.' } },
  { emoji: '⚡', name: 'Fast inbox triage', desc: 'Every 6h — Laya decisions route each capture to notes/tasks/crm/long-term, no LLM needed.', input: { name: 'Fast inbox triage', kind: 'triage', schedule: 'interval', everyMinutes: 360, instruction: 'Triage inbox captures into the right memory destinations using fast decisions.' } },
  { emoji: '🔍', name: 'Search gaps', desc: 'Fri 18:00 — marks searches that already have a file in memory. No model call.', input: { name: 'Close search gaps', kind: 'gaps', schedule: 'weekly', weekday: 5, time: '18:00', instruction: 'Match unanswered searches to files already in memory.' } },
  { emoji: '🗜️', name: 'Compact memory', desc: '23:20 — drops duplicate lines and keeps facts, lessons and skills inside the prompt budget.', input: { name: 'Compact long-term memory', kind: 'compact', schedule: 'daily', time: '23:20', instruction: 'Drop duplicate lines and keep long-term files inside the prompt budget.' } },
  { emoji: '☀️', name: 'Briefing', desc: '08:05 — escreve o texto do dia a partir de tarefas, metas e notas recentes.', input: { name: 'Morning briefing', kind: 'briefing', schedule: 'daily', time: '08:05', instruction: 'Write the daily briefing from tasks, goals and recent notes.' } }
]

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
  const [pending, setPending] = useState<PendingApproval[]>([])
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [tiers, setTiers] = useState<any>(null)
  const [sleepReports, setSleepReports] = useState<any[]>([])
  const [sync, setSync] = useState<any>(null)
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [draftKind, setDraftKind] = useState('brain')
  const [draftTime, setDraftTime] = useState('08:00')
  const [busy, setBusy] = useState<string | null>(null)
  const [sleeping, setSleeping] = useState(false)
  const [hookInfo, setHookInfo] = useState<Record<string, { url: string; token: string }>>({})
  const parseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = async () => {
    const [a, p, act, t, s, sy] = await Promise.all([
      window.sb.automationList(),
      window.sb.automationPending(),
      window.sb.brainActivity(120),
      window.sb.brainMemoryTiers(),
      window.sb.brainListSleep(),
      window.sb.syncStatus()
    ])
    setAutos(a ?? []); setPending(p ?? []); setActivity(act ?? []); setTiers(t); setSleepReports(s ?? []); setSync(sy)
  }

  useEffect(() => { refresh() }, [])

  // live NL → schedule preview
  useEffect(() => {
    if (parseTimer.current) clearTimeout(parseTimer.current)
    if (!text.trim()) { setParsed(null); return }
    parseTimer.current = setTimeout(async () => {
      try {
        const next = await window.sb.automationParse(text)
        setParsed(next)
        if (next?.kind) setDraftKind(next.kind)
        if (next?.time) setDraftTime(next.time)
      } catch { /* noop */ }
    }, 350)
    return () => { if (parseTimer.current) clearTimeout(parseTimer.current) }
  }, [text])

  const addTemplate = async (t: (typeof TEMPLATES)[number]) => {
    setBusy(`tpl-${t.name}`)
    try {
      await window.sb.automationCreate(t.input)
      onToast?.(`"${t.name}" scheduled ✓`, 'success')
      await refresh()
    } catch (e: any) { onToast?.(e?.message ?? String(e), 'error') }
    finally { setBusy(null) }
  }

  const create = async () => {
    if (!text.trim()) return
    setBusy('create')
    try {
      await window.sb.automationCreate({
        instruction: text,
        kind: draftKind,
        time: draftTime || undefined
      })
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
    if (!window.confirm(`Remove "${a.name}" from the schedule?`)) return
    await window.sb.automationRemove(a.id)
    await refresh()
  }
  const setMode = async (a: Automation, mode: 'auto' | 'approval') => {
    await window.sb.automationUpdate(a.id, { mode })
    await refresh()
  }
  const setWebhook = async (a: Automation) => {
    setBusy(`wh-${a.id}`)
    try {
      const r: any = await window.sb.automationSetWebhook(a.id, !a.webhook)
      if (r?.url) setHookInfo(prev => ({ ...prev, [a.id]: { url: r.url, token: r.token } }))
      else setHookInfo(prev => { const n = { ...prev }; delete n[a.id]; return n })
      onToast?.(r?.webhook ? `Webhook live: ${r.url}` : 'Webhook disabled', 'success')
      await refresh()
    } catch (e: any) { onToast?.(e?.message ?? String(e), 'error') }
    finally { setBusy(null) }
  }
  const exportConfig = async () => {
    setBusy('export')
    try { await window.sb.brainExportConfig(); onToast?.('keepmind.json pushed to repo root ✓', 'success') }
    catch (e: any) { onToast?.(e?.message ?? String(e), 'error') }
    finally { setBusy(null) }
  }
  const approve = async (p: PendingApproval) => {
    setBusy(`ap-${p.id}`)
    try { await window.sb.automationApprove(p.id); onToast?.(`"${p.name}" approved & running`, 'success'); await refresh() }
    catch (e: any) { onToast?.(e?.message ?? String(e), 'error') }
    finally { setBusy(null) }
  }
  const reject = async (p: PendingApproval) => {
    await window.sb.automationReject(p.id)
    await refresh()
  }

  const sleepNow = async () => {
    setSleeping(true); onActivity?.()
    try {
      const r = await window.sb.brainSleep()
      onToast?.(r?.summary || 'Sleep done. The report is in Today.', 'success')
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
          <div className="hud-tag hud-tag--amber" style={{ marginBottom: 6 }}>Agenda</div>
          <h1>Brain jobs</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>
            Every job leaves a line about what it did. The result also shows up in Today.
          </p>
        </div>
        <div className="actions">
          <button className="btn btn--ghost" onClick={exportConfig} disabled={busy === 'export' || !sync?.connected} title="Push keepmind.json — declarative brain config — to the repo root">
            ⤴ {busy === 'export' ? 'Exporting…' : 'Config'}
          </button>
          <button className="btn btn--ghost" onClick={syncNow} disabled={busy === 'sync' || !sync?.connected}>
            <IconSync size={12} /> {busy === 'sync' ? 'Syncing…' : sync?.connected ? 'Sync now' : 'No repo'}
          </button>
        </div>
      </div>

      {/* Memory tiers */}
      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <div className="card stat"><div className="stat__num" style={{ color: 'var(--cyan)' }}>{tiers?.shortTerm ?? '—'}</div><div className="stat__label">Short-term · days</div></div>
        <div className="card stat"><div className="stat__num" style={{ color: 'var(--amber)' }}>{tiers?.mediumTerm ?? '—'}</div><div className="stat__label">Medium-term · weeks</div></div>
        <div className="card stat"><div className="stat__num" style={{ color: 'var(--lime)' }}>{tiers?.longTerm ?? '—'}</div><div className="stat__label">Long-term · facts</div></div>
        <div className="card stat"><div className="stat__num" style={{ color: 'var(--violet)' }}>{tiers?.sleepCycles ?? '—'}</div><div className="stat__label">Sleep cycles</div></div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 20 }}>
        {/* New automation */}
        <div className="card card-pad">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><IconClock size={15} /> New job</h2>
          <p className="faint" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.6 }}>
            Descreva em uma frase. A hora e o tipo aparecem abaixo e podem ser corrigidos antes de gravar.
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
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
              <span className="chip" style={{ borderColor: 'rgba(34,211,238,.35)', color: 'var(--cyan)' }}>{parsed.label}</span>
              <select value={draftKind} onChange={e => setDraftKind(e.target.value)} style={{ background: 'transparent', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 8, padding: '4px 8px' }}>
                {KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
              <input type="time" value={draftTime} onChange={e => setDraftTime(e.target.value)} style={{ background: 'transparent', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 8, padding: '4px 8px' }} />
            </div>
          )}
          <button
            className="btn btn--primary"
            style={{ marginTop: 14 }}
            disabled={!text.trim() || busy === 'create'}
            onClick={create}
          >
            <IconSparkle size={12} /> {busy === 'create' ? 'Scheduling…' : 'Schedule'}
          </button>
        </div>

        {/* Sleep mode */}
        <div className="card card-pad" style={{ borderColor: 'rgba(167,139,250,.25)' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><IconMoon size={15} /> Sono</h2>
          <p className="faint" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.6 }}>
            The night cycle reads the day, stores facts, lessons and skills, and leaves a line in Today.
          </p>
          <button
            className="btn"
            style={{ marginTop: 14, borderColor: 'rgba(167,139,250,.4)', color: '#c4b5fd' }}
            disabled={sleeping}
            onClick={sleepNow}
          >
            <IconMoon size={12} /> {sleeping ? 'Consolidating…' : 'Run sleep now'}
          </button>
          {sync?.lastPull && (
            <p className="faint mono" style={{ fontSize: 10.5, marginTop: 12 }}>
              last github pull {new Date(sync.lastPull).toLocaleTimeString()} · {sync.pending} pending push{sync.pending === 1 ? '' : 'es'}
            </p>
          )}
        </div>
      </div>

      {/* Pending approvals — automations in 'approval' mode queue here */}
      {pending.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 20, borderColor: 'rgba(251,191,36,.35)' }}>
          <h2 style={{ color: 'var(--amber)' }}>⏳ Awaiting your approval ({pending.length})</h2>
          <p className="faint" style={{ fontSize: 12, marginTop: 4 }}>
            These automations are set to <strong>approval mode</strong> — nothing runs until you say yes.
          </p>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pending.map(p => (
              <div key={p.id} className="insight-item" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13 }}>{p.name}</strong>
                    <span className="chip" style={{ fontSize: 9.5 }}>{KIND_LABEL[p.kind] ?? p.kind}</span>
                  </div>
                  <p className="faint" style={{ fontSize: 12, marginTop: 4 }}>{p.instruction}</p>
                  <p className="faint mono" style={{ fontSize: 10.5, marginTop: 4 }}>
                    queued {new Date(p.createdAt).toLocaleString()}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button className="btn btn--primary" style={{ padding: '6px 14px', fontSize: 10 }} disabled={busy === `ap-${p.id}`} onClick={() => approve(p)}>
                    {busy === `ap-${p.id}` ? '…' : 'APPROVE'}
                  </button>
                  <button className="btn btn--ghost" style={{ padding: '6px 12px', fontSize: 10, color: '#f87171' }} onClick={() => reject(p)}>
                    REJECT
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Learning templates */}
      <div className="card card-pad" style={{ marginBottom: 20 }}>
          <h2>Modelos</h2>
        <p className="faint" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.6 }}>
          The ones that ship enabled appear disabled here. Each leaves a line after it runs.
        </p>
        <div className="grid grid-3" style={{ marginTop: 14 }}>
          {TEMPLATES.map(t => {
            const installed = autos.some(a => a.name === t.input.name)
            return (
              <div key={t.name} className="card card-pad" style={{ padding: '14px 16px', opacity: installed ? .55 : 1 }}>
                <div style={{ fontSize: 18, marginBottom: 6 }}>{t.emoji}</div>
                <strong style={{ fontSize: 13 }}>{t.name}</strong>
                <p className="faint" style={{ fontSize: 11.5, marginTop: 4, lineHeight: 1.5, minHeight: 34 }}>{t.desc}</p>
                <button
                  className="btn btn--ghost"
                  style={{ marginTop: 8, padding: '5px 12px', fontSize: 10, width: '100%' }}
                  disabled={installed || busy === `tpl-${t.name}`}
                  onClick={() => addTemplate(t)}
                >
                  {installed ? 'INSTALLED ✓' : busy === `tpl-${t.name}` ? 'ADDING…' : '+ ADD'}
                </button>
              </div>
            )
          })}
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
                    <button
                      className="chip"
                      title={a.mode === 'approval' ? 'Runs only after you approve — click for auto' : 'Runs fully autonomously — click for approval'}
                      onClick={() => setMode(a, a.mode === 'approval' ? 'auto' : 'approval')}
                      style={{
                        fontSize: 9.5, cursor: 'pointer',
                        borderColor: a.mode === 'approval' ? 'rgba(251,191,36,.5)' : 'rgba(52,211,153,.35)',
                        color: a.mode === 'approval' ? 'var(--amber)' : 'var(--lime)',
                        background: a.mode === 'approval' ? 'rgba(251,191,36,.08)' : 'rgba(52,211,153,.06)'
                      }}
                    >
                      {a.mode === 'approval' ? '⏳ APPROVAL' : '⚡ AUTO'}
                    </button>
                    <button
                      className="chip"
                      title={a.webhook ? 'Webhook enabled — click to disable' : 'Enable webhook trigger (POST /hook/<id> with token)'}
                      onClick={() => setWebhook(a)}
                      style={{
                        fontSize: 9.5, cursor: 'pointer',
                        borderColor: a.webhook ? 'rgba(34,211,238,.5)' : 'var(--line)',
                        color: a.webhook ? 'var(--cyan)' : 'var(--muted)',
                        background: a.webhook ? 'rgba(34,211,238,.08)' : 'transparent'
                      }}
                    >
                      {busy === `wh-${a.id}` ? '…' : a.webhook ? '🔗 HOOK' : '⊘ HOOK'}
                    </button>
                    {!a.enabled && <span className="chip" style={{ fontSize: 9.5, opacity: .6 }}>paused</span>}
                  </div>
                  <p className="faint" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>{a.instruction}</p>
                  <p className="faint mono" style={{ fontSize: 10.5, marginTop: 6 }}>
                    last run: {a.lastRunAt ? new Date(a.lastRunAt).toLocaleString() : 'never'}
                    {a.lastSummary ? ` · ${a.lastSummary}` : ''}
                  </p>
                  {a.webhook && (hookInfo[a.id] || a.webhookToken) && (
                    <div className="mono" style={{ marginTop: 6, fontSize: 10, background: 'rgba(3,7,18,.6)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', wordBreak: 'break-all' }}>
                      <div style={{ color: 'var(--muted)' }}>POST {(hookInfo[a.id]?.url) ?? `http://127.0.0.1:4789/hook/${a.id}`}</div>
                      <div style={{ color: 'var(--cyan)', marginTop: 2 }}>token: ••••{(hookInfo[a.id]?.token ?? a.webhookToken ?? '').slice(-6)}</div>
                      <div style={{ color: 'var(--muted)', marginTop: 4 }}>header: <code>x-hook-token</code> · approval-mode jobs queue for you</div>
                    </div>
                  )}
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

      {/* Activity feed — everything the brain wrote/changed, with source */}
      <div className="card card-pad">
        <h2>Recent activity</h2>
        <p className="faint" style={{ fontSize: 12, marginTop: 4 }}>
          Every memory write, append and delete — attributed to its source (sleep cycle, chat, automation, you…).
        </p>
        {activity.length === 0 ? (
          <p className="faint" style={{ fontSize: 13, marginTop: 12 }}>No activity yet.</p>
        ) : (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 380, overflowY: 'auto' }}>
            {activity.map((e, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, fontSize: 12 }} className="insight-item">
                <span style={{ width: 14, textAlign: 'center', flexShrink: 0 }}>
                  {e.op === 'write' ? '✎' : e.op === 'append' ? '＋' : '🗑'}
                </span>
                <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.path}</span>
                <span className="chip" style={{ fontSize: 9, flexShrink: 0, opacity: .85 }}>{e.source}</span>
                <span className="faint mono" style={{ fontSize: 10, flexShrink: 0 }}>{new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
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
