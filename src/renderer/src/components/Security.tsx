import { useEffect, useState } from 'react'
import { IconSparkle, IconSync, IconSettings } from './icons'

// Vault security — choose what gets encrypted at rest (per top-level
// directory, AES-256-GCM, user-chosen passphrase) and review risk alerts:
// deterministic secret scan + AI advisor grounded in the scan evidence.
// Encrypted files sync to GitHub as ciphertext; reads decrypt transparently.

interface Status {
  configured: boolean
  enabled: boolean
  categories: string[]
  availableCategories: string[]
  encryptedFiles: number
  totalMdFiles: number
}
interface Hit { path: string; line: number; label: string; encrypted: boolean }
interface Scan { hits: Hit[]; totalHits: number; byLabel: Record<string, number>; unencryptedHits: number }

export default function Security({ onActivity, onToast }: { onActivity?: () => void; onToast?: (m: string, k?: 'info' | 'error' | 'success') => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [scan, setScan] = useState<Scan | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [cats, setCats] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [aiText, setAiText] = useState<string | null>(null)

  const refresh = async () => {
    const s = await window.sb.securityStatus().catch(() => null)
    if (s) {
      setStatus(s)
      setCats(new Set(s.categories ?? []))
    }
  }

  useEffect(() => { refresh() }, [])

  const run = async (key: string, fn: () => Promise<any>, ok?: string) => {
    setBusy(key)
    onActivity?.()
    try {
      const r = await fn()
      if (r?.status) setStatus(r.status)
      if (ok) onToast?.(ok, 'success')
      await refresh()
      return r
    } catch (e: any) {
      onToast?.(e?.message ?? String(e), 'error')
      return null
    } finally { setBusy(null) }
  }

  const saveKey = () => run('key', () =>
    window.sb.securityConfigure({ passphrase, ...(status?.enabled ? {} : {}) }).then(() => {
      setPassphrase('')
      return { status: null }
    }),
    'Encryption key set — vault re-encrypted with your passphrase'
  )

  const toggleEnabled = () => run('enabled', () =>
    window.sb.securityConfigure({ enabled: !status?.enabled }),
    status?.enabled ? 'Encryption paused — new writes stay plaintext' : 'Encryption ON — new writes to selected folders are encrypted'
  )

  const saveCategories = () => run('cats', () =>
    window.sb.securityConfigure({ categories: [...cats] }),
    'Encrypted folders updated'
  )

  const doScan = () => run('scan', async () => {
    const s = await window.sb.securityScan()
    setScan(s)
    return { status: null }
  })

  const doEncrypt = () => run('encrypt', () => window.sb.securityEncryptAll(), 'Vault encryption pass complete — syncing ciphertext to GitHub')
  const doDecrypt = () => run('decrypt', () => window.sb.securityDecryptAll(), 'Vault decrypted — files back to plaintext')

  const doAi = () => run('ai', async () => {
    const t = await window.sb.securityAiAlerts()
    setAiText(t)
    return { status: null }
  })

  const pct = status && status.totalMdFiles ? Math.round((status.encryptedFiles / status.totalMdFiles) * 100) : 0

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>SECURITY</div>
          <h1>Vault encryption &amp; risk alerts</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>
            Choose what is encrypted at rest — ciphertext is what syncs to GitHub. The key never leaves this machine.
          </p>
        </div>
        <button className="btn" onClick={refresh}>↻ REFRESH</button>
      </div>

      {!status && <p className="faint" style={{ fontSize: 12.5 }}>Scanning vault…</p>}

      {status && (
        <>
          {/* ── Encryption at rest ── */}
          <div className="card card-pad" style={{ marginBottom: 16, maxWidth: 1100 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                <IconSettings size={14} /> Encryption at rest
              </h2>
              <span className={`chip ${status.enabled ? 'chip--active' : ''}`} style={{ fontSize: 10 }}>
                {status.enabled ? '● ENCRYPTING' : '○ OFF'}
              </span>
              <span className="faint mono" style={{ fontSize: 11, marginLeft: 'auto' }}>
                {status.encryptedFiles}/{status.totalMdFiles} files encrypted ({pct}%)
              </span>
            </div>

            <div style={{ height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--blue)', boxShadow: '0 0 12px var(--blue)', transition: 'width .4s' }} />
            </div>

            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div>
                <div className="field">
                  <label>Encryption passphrase {status.configured && <span className="faint" style={{ fontWeight: 400 }}>(set — enter new one to rotate)</span>}</label>
                  <input
                    type="password"
                    value={passphrase}
                    onChange={e => setPassphrase(e.target.value)}
                    placeholder={status.configured ? '••••••••  (leave empty to keep current)' : 'min. 8 characters — derives the AES-256 key'}
                    autoComplete="off"
                  />
                  <span className="hint">Derives the vault key with scrypt. Stored sealed by the local keyfile — never synced, never sent anywhere. Rotating re-encrypts the whole vault automatically.</span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn--sm" disabled={!passphrase || busy === 'key'} onClick={saveKey}>
                    {busy === 'key' ? '…' : status.configured ? 'ROTATE KEY' : 'SET KEY'}
                  </button>
                  <button
                    className={`btn btn--sm ${status.enabled ? 'btn--danger' : 'btn--primary'}`}
                    disabled={!status.configured || busy === 'enabled'}
                    onClick={toggleEnabled}
                    title={!status.configured ? 'Set a passphrase first' : ''}
                  >
                    {busy === 'enabled' ? '…' : status.enabled ? 'DISABLE' : 'ENABLE'}
                  </button>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-dim)', display: 'block', marginBottom: 8 }}>
                  Encrypt these folders
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', maxHeight: 180, overflowY: 'auto' }}>
                  {status.availableCategories.map(d => (
                    <label key={d} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={cats.has(d)}
                        onChange={e => {
                          const next = new Set(cats)
                          if (e.target.checked) next.add(d); else next.delete(d)
                          setCats(next)
                        }}
                      />
                      <span className="mono">{d}/</span>
                    </label>
                  ))}
                  {status.availableCategories.length === 0 && <span className="faint" style={{ fontSize: 12 }}>No folders yet</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button className="btn btn--sm btn--ghost" disabled={busy === 'cats'} onClick={saveCategories}>SAVE FOLDERS</button>
                  <button className="btn btn--sm" disabled={!status.configured || busy === 'encrypt'} onClick={doEncrypt} title="Encrypt every .md in the selected folders now">
                    {busy === 'encrypt' ? 'ENCRYPTING…' : 'ENCRYPT ALL'}
                  </button>
                  <button className="btn btn--sm btn--ghost" disabled={!status.configured || busy === 'decrypt'} onClick={doDecrypt} title="Decrypt every encrypted file back to plaintext">
                    {busy === 'decrypt' ? 'DECRYPTING…' : 'DECRYPT ALL'}
                  </button>
                </div>
              </div>
            </div>

            <p className="faint" style={{ fontSize: 11, marginTop: 14, lineHeight: 1.5 }}>
              Encrypted <span className="mono">.md</span> files become ciphertext blobs — agents, RAG and the graph keep working because reads decrypt transparently. What syncs to GitHub is ciphertext only. The activity journal (<span className="mono">ops/</span>) is local-only and never leaves the machine.
            </p>
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 1100 }}>
            {/* ── Secret scan ── */}
            <div className="card card-pad">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <IconSparkle size={14} />
                <h2 style={{ margin: 0 }}>Secret scan</h2>
                <button className="btn btn--sm" style={{ marginLeft: 'auto' }} disabled={busy === 'scan'} onClick={doScan}>
                  {busy === 'scan' ? 'SCANNING…' : scan ? '↻ RESCAN' : 'SCAN VAULT'}
                </button>
              </div>
              {!scan && <p className="faint" style={{ fontSize: 12 }}>Detects API keys, tokens, private keys and password assignments — reports location only, never the value.</p>}
              {scan && (
                <>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    <span className={`chip ${scan.unencryptedHits ? '' : 'chip--active'}`} style={{ fontSize: 10 }}>
                      {scan.totalHits} hits · {scan.unencryptedHits} plaintext
                    </span>
                    {Object.entries(scan.byLabel).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => (
                      <span key={k} className="badge badge--custom" style={{ fontSize: 9 }}>{k} ×{v}</span>
                    ))}
                  </div>
                  {scan.totalHits === 0 && <p className="faint" style={{ fontSize: 12 }}>✅ No secret patterns detected.</p>}
                  <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {scan.hits.map((h, i) => (
                      <div key={i} className="goal-row" style={{ cursor: 'default', padding: '6px 10px' }}>
                        <span className={`chip ${h.encrypted ? 'chip--amber' : ''}`} style={{ fontSize: 8.5, flexShrink: 0, ...(h.encrypted ? {} : { borderColor: 'rgba(248,113,113,.4)', color: '#fca5a5' }) }}>
                          {h.encrypted ? 'ENC' : 'PLAIN'}
                        </span>
                        <span className="mono faint" style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {h.path}:{h.line}
                        </span>
                        <span className="faint" style={{ fontSize: 10, marginLeft: 'auto', flexShrink: 0 }}>{h.label}</span>
                      </div>
                    ))}
                    {scan.totalHits > scan.hits.length && (
                      <p className="faint" style={{ fontSize: 11, textAlign: 'center' }}>+{scan.totalHits - scan.hits.length} more not shown</p>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* ── AI advisor ── */}
            <div className="card card-pad">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <IconSync size={14} />
                <h2 style={{ margin: 0 }}>AI security advisor</h2>
                <button className="btn btn--sm" style={{ marginLeft: 'auto' }} disabled={busy === 'ai'} onClick={doAi}>
                  {busy === 'ai' ? 'ANALYZING…' : aiText ? '↻ RE-ANALYZE' : 'ANALYZE'}
                </button>
              </div>
              <p className="faint" style={{ fontSize: 11.5, marginBottom: 10 }}>
                Sends the scan summary (paths + pattern types, never secret values) to your configured AI provider and asks for prioritized recommendations.
              </p>
              {!aiText && !busy && <p className="faint" style={{ fontSize: 12 }}>Run a scan first for sharper advice — the advisor works with whatever evidence exists.</p>}
              {aiText && (
                <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 340, overflowY: 'auto' }}>
                  {aiText}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
