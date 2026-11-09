import { useState } from 'react'
import { mdToHtml as md } from '../lib/markdown'

// Keep the roadmap's memory reports alongside main's health diagnostics.
export default function MemoryOverview({ onActivity }: { onActivity?: () => void }) {
  const [data, setData] = useState<{ insights: any[]; summaries: any[]; memory: any[]; tiers: any; sync: any } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = async () => {
    const [insights, summaries, memory, tiers, sync] = await Promise.all([
      window.sb.brainListInsights(), window.sb.brainListSummaries(), window.sb.brainListMemory(),
      window.sb.brainMemoryTiers(), window.sb.syncStatus()
    ])
    setData({ insights, summaries, memory, tiers, sync })
  }
  const run = async (action?: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { if (action) { onActivity?.(); await action() }; await refresh() }
    catch (e: any) { setError(e?.message ?? 'Memory is unavailable. Unlock memory in Settings.') }
    finally { setBusy(false) }
  }
  return <details className="card card-pad" style={{ marginTop: 20 }} onToggle={e => {
    if (e.currentTarget.open && !data && !busy) void run()
  }}>
    <summary style={{ cursor: 'pointer' }}>Memory, insights & summaries</summary>
    <div className="actions" style={{ marginTop: 14 }}>
      <button className="btn" disabled={busy} onClick={() => run(() => window.sb.brainInsights())}>GENERATE INSIGHTS</button>
      <button className="btn" disabled={busy} onClick={() => run(() => window.sb.brainDailySummary())}>DAILY SUMMARY</button>
      <button className="btn" disabled={busy} onClick={() => run(() => window.sb.brainSleep())}>SLEEP</button>
      <button className="btn" disabled={busy || !data?.sync?.connected} onClick={() => run(() => window.sb.syncNow())}>SYNC GITHUB</button>
      <button className="btn" disabled={busy} onClick={() => run()}>REFRESH</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {data && <>
      <p className="faint mono" style={{ marginTop: 12 }}>
        short {data.tiers.shortTerm} · medium {data.tiers.mediumTerm} · long {data.tiers.longTerm} · sleep {data.tiers.sleepCycles}
        {' · '}{data.sync?.error ? 'Sync error' : data.sync?.syncing ? 'Syncing…' : data.sync?.connected ? 'GitHub connected' : 'GitHub offline'}
      </p>
      {[{ title: 'Insights', items: data.insights }, { title: 'Summaries', items: data.summaries }].map(group => <div key={group.title}>
        <h2 style={{ marginTop: 14 }}>{group.title}</h2>
        {!group.items.length && <p className="faint">No reports yet.</p>}
        {group.items.map(item => <details key={item.date}>
          <summary>{item.date}</summary>
          <div className="msg__body" dangerouslySetInnerHTML={{ __html: md(item.content) }} />
        </details>)}
      </div>)}
      <h2 style={{ marginTop: 14 }}>Memory ({data.memory.length} files)</h2>
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        {data.memory.slice(0, 60).map(item => <details key={item.path}>
          <summary className="mono">{item.path}</summary>
          <div style={{ whiteSpace: 'pre-wrap' }}>{item.content.slice(0, 2000)}</div>
        </details>)}
      </div>
    </>}
  </details>
}
