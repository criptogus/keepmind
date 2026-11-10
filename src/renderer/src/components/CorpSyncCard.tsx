import { useEffect, useState } from 'react'

interface Props {
  onToast: (m: string, k?: 'info' | 'error' | 'success') => void
}

export default function CorpSyncCard({ onToast }: Props) {
  const [baseUrl, setBaseUrl] = useState('')
  const [token, setToken] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [intervalMinutes, setIntervalMinutes] = useState(60)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    const s = await window.sb.corpSyncStatus()
    setBaseUrl(s.baseUrl ?? '')
    setToken(s.token ?? '')
    setEnabled(!!s.enabled)
    setIntervalMinutes(s.intervalMinutes ?? 60)
    setStatus(s.lastStatus ?? '')
  }

  useEffect(() => {
    refresh().catch(() => {})
  }, [])

  const save = async () => {
    setBusy(true)
    try {
      await window.sb.updateCorpSync({
        baseUrl: baseUrl.trim(),
        token: token.trim(),
        enabled,
        intervalMinutes
      })
      onToast('KeepMind Corp sync settings saved', 'success')
      await refresh()
    } catch (e: unknown) {
      onToast(String((e as Error)?.message ?? e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const runNow = async () => {
    setBusy(true)
    try {
      await window.sb.updateCorpSync({ baseUrl: baseUrl.trim(), token: token.trim() })
      const r = await window.sb.corpSyncNow()
      onToast(`Corp sync: pulled ${r.pulled}, pushed ${r.pushed}`, 'success')
      await refresh()
    } catch (e: unknown) {
      onToast(String((e as Error)?.message ?? e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card card-pad" id="sec-corp-sync">
      <h2 style={{ marginBottom: 14 }}>KeepMind Corp sync</h2>
      <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
        Bidirectional sync with your organization&apos;s Corp server (Bearer token from Admin → Sync).
        Pulls newer files from Corp, then pushes newer local Markdown.
      </p>
      <label>Corp URL<input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://corp.example.com" /></label>
      <label>Sync token<input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bearer token" autoComplete="off" /></label>
      <label>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {' '}Enable automatic sync on this interval (desktop app must stay open)
      </label>
      <label>Interval (minutes)<input type="number" min={15} max={1440} value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))} /></label>
      {status ? <p className="faint mono" style={{ fontSize: 11.5 }}>Last: {status}</p> : null}
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button className="btn btn--primary" type="button" disabled={busy} onClick={save}>SAVE</button>
        <button className="btn" type="button" disabled={busy || !baseUrl || !token} onClick={runNow}>SYNC NOW</button>
      </div>
    </div>
  )
}
