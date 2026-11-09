import { useEffect, useState } from 'react'
import { IconSparkle, IconSync, IconShield, IconSettings } from './icons'

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
interface Scan {
  hits: Hit[]; totalHits: number; byLabel: Record<string, number>; unencryptedHits: number
  piiHits: Hit[]; piiTotal: number; piiByLabel: Record<string, number>
}

const SEV_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  plain: { label: 'EXPOSED', color: '#fb7185', bg: 'rgba(251,113,133,.12)' },
  enc: { label: 'ENCRYPTED', color: '#fbbf24', bg: 'rgba(251,191,36,.1)' }
}

export default function Security({ onActivity, onToast }: { onActivity?: () => void; onToast?: (m: string, k?: 'info' | 'error' | 'success') => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [scan, setScan] = useState<Scan | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [cats, setCats] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [aiText, setAiText] = useState<string | null>(null)
  const [obfuscate, setObfuscate] = useState(false)
  const [showPii, setShowPii] = useState(false)

  const refresh = async () => {
    const s = await window.sb.securityStatus().catch(() => null)
    if (s) {
      setStatus(s)
      setCats(new Set(s.categories ?? []))
    }
    const cfg = await window.sb.getConfig().catch(() => null)
    if (cfg) setObfuscate(!!cfg.github?.obfuscatePaths)
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

  const saveKey = () => run('key', async () => {
    await window.sb.securityConfigure({ passphrase })
    setPassphrase('')
    return { status: null }
  }, status?.configured
    ? 'Key rotated — vault re-encrypted with your new passphrase'
    : 'Encryption key set — vault ready to encrypt')

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

  const doEncrypt = () => run('encrypt', () => window.sb.securityEncryptAll(), 'Vault encryption pass complete — ciphertext syncing to GitHub')
  const doDecrypt = () => run('decrypt', () => window.sb.securityDecryptAll(), 'Vault decrypted — files back to plaintext')

  const doAi = () => run('ai', async () => {
    const t = await window.sb.securityAiAlerts()
    setAiText(t)
    return { status: null }
  })

  const toggleObfuscate = () => run('obf', async () => {
    const next = !obfuscate
    await window.sb.updateGithub({ obfuscatePaths: next })
    setObfuscate(next)
    return { status: null }
  }, obfuscate
    ? 'Path obfuscation OFF — files re-push under their real names'
    : 'Path obfuscation ON — new pushes use hashed remote names')

  const pct = status && status.totalMdFiles ? Math.round((status.encryptedFiles / status.totalMdFiles) * 100) : 0
  const sev = scan ? (scan.unencryptedHits > 0 ? 'plain' : 'enc') : null

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>VAULT SECURITY</div>
          <h1>Encryption &amp; risk posture</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>
            Pick what is encrypted at rest — ciphertext is what syncs to GitHub. The key never leaves this machine.
          </p>
        </div>
        <button className="btn" onClick={refresh}>↻ REFRESH</button>
      </div>

      {!status && <p className="faint" style={{ fontSize: 13 }}>Scanning vault…</p>}

      {status && (
        <>
          {/* vitals */}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 22, maxWidth: 1000 }}>
            {[
              { k: 'files encrypted', v: `${status.encryptedFiles}/${status.totalMdFiles}`, sub: `${pct}% of vault` },
              { k: 'encryption', v: status.enabled ? 'ON' : 'OFF', sub: status.configured ? 'key configured' : 'no key set' },
              { k: 'folders covered', v: status.categories.length, sub: 'selected for encryption' },
              { k: 'secret hits', v: scan ? scan.totalHits : '—', sub: scan ? `${scan.unencryptedHits} plaintext` : 'run a scan' },
              { k: 'pii exposures', v: scan ? scan.piiTotal : '—', sub: scan ? 'cpf/cnpj/email/phone' : 'run a scan' }
            ].map(m => (
              <div key={m.k} className="card stat" style={{ padding: '12px 14px' }}>
                <div className="stat__num" style={{ fontSize: 20 }}>{m.v}</div>
                <div className="stat__label">{m.k}</div>
                <div className="faint" style={{ fontSize: 9.5, marginTop: 2 }}>{m.sub}</div>
              </div>
            ))}
          </div>

          {/* ── Encryption at rest ── */}
          <div className="hud-tag" style={{ marginBottom: 10 }}>ENCRYPTION AT REST</div>
          <div className="card card-pad" style={{ marginBottom: 26, maxWidth: 1000 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <IconShield size={15} />
                  <span style={{ fontSize: 14, fontWeight: 650 }}>Vault encryption</span>
                  <button
                    className={`chip ${status.enabled ? 'chip--active' : ''}`}
                    style={{ cursor: 'pointer', opacity: status.configured ? 1 : 0.45 }}
                    disabled={!status.configured || busy === 'enabled'}
                    onClick={toggleEnabled}
                    title={status.configured ? '' : 'Set a passphrase first'}
                  >
                    {status.enabled ? '● ENCRYPTING' : '○ OFF'}
                  </button>
                </div>
                <p className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>
                  AES-256-GCM per file · GitHub receives ciphertext only · reads decrypt transparently for brain, RAG, graph and agents.
                </p>
              </div>
              <div style={{ width: 180 }}>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: 'var(--cyan)', boxShadow: '0 0 12px var(--cyan)', transition: 'width .4s' }} />
                </div>
                <div className="faint mono" style={{ fontSize: 10, marginTop: 5, textAlign: 'right' }}>{pct}% encrypted</div>
              </div>
            </div>

            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <div>
                <div className="field">
                  <label>Encryption passphrase {status.configured && <span className="faint" style={{ fontWeight: 400 }}>(set — enter a new one to rotate)</span>}</label>
                  <input
                    type="password"
                    value={passphrase}
                    onChange={e => setPassphrase(e.target.value)}
                    placeholder={status.configured ? '••••••••  (leave empty to keep current)' : 'min. 8 characters — derives the AES-256 key'}
                    autoComplete="off"
                  />
                  <span className="hint">Derives the vault key with scrypt — stored sealed by the local keyfile, never synced, never sent anywhere. Rotating re-encrypts the whole vault automatically.</span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn--sm btn--primary" disabled={!passphrase || busy === 'key'} onClick={saveKey}>
                    {busy === 'key' ? '…' : status.configured ? 'ROTATE KEY' : 'SET KEY'}
                  </button>
                  <button className="btn btn--sm" disabled={!status.configured || busy === 'encrypt'} onClick={doEncrypt} title="Encrypt every .md in the selected folders now">
                    {busy === 'encrypt' ? 'ENCRYPTING…' : 'ENCRYPT ALL'}
                  </button>
                  <button className="btn btn--sm btn--ghost" disabled={!status.configured || busy === 'decrypt'} onClick={doDecrypt} title="Decrypt every encrypted file back to plaintext">
                    {busy === 'decrypt' ? 'DECRYPTING…' : 'DECRYPT ALL'}
                  </button>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--text-dim)', display: 'block', marginBottom: 10 }}>
                  Folders to encrypt
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 190, overflowY: 'auto' }}>
                  {status.availableCategories.map(d => (
                    <button
                      key={d}
                      className={`chip ${cats.has(d) ? 'chip--active' : ''}`}
                      style={{ cursor: 'pointer', fontSize: 10 }}
                      onClick={() => {
                        const next = new Set(cats)
                        if (next.has(d)) next.delete(d); else next.add(d)
                        setCats(next)
                      }}
                    >
                      {d}/
                    </button>
                  ))}
                  {status.availableCategories.length === 0 && <span className="faint" style={{ fontSize: 12 }}>No folders yet</span>}
                </div>
                <button className="btn btn--sm btn--ghost" style={{ marginTop: 10 }} disabled={busy === 'cats'} onClick={saveCategories}>
                  {busy === 'cats' ? '…' : 'SAVE FOLDERS'}
                </button>
              </div>
            </div>
          </div>

          {/* ── GitHub sync privacy ── */}
          <div className="hud-tag" style={{ marginBottom: 10 }}>GITHUB SYNC PRIVACY</div>
          <div className="card card-pad" style={{ marginBottom: 26, maxWidth: 1000 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <IconSync size={15} />
                  <span style={{ fontSize: 14, fontWeight: 650 }}>Obfuscate remote paths</span>
                  <button
                    className={`chip ${obfuscate ? 'chip--active' : ''}`}
                    style={{ cursor: 'pointer', opacity: status.configured ? 1 : 0.45 }}
                    disabled={busy === 'obf'}
                    onClick={toggleObfuscate}
                  >
                    {obfuscate ? '● OBFUSCATED' : '○ PLAINTEXT PATHS'}
                  </button>
                </div>
                <p className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>
                  Pushes files under HMAC-hashed names (<span className="mono">h_…</span>) so the repo doesn't reveal your vault's folder structure.
                  External agents keep writing plaintext paths — both namespaces sync. The hash key never leaves this machine; files already on GitHub keep their history.
                </p>
              </div>
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 1000 }}>
            {/* ── Secret scan ── */}
            <div>
              <div className="hud-tag" style={{ marginBottom: 10 }}>SECRET SCAN</div>
              <div className="card card-pad">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <IconSparkle size={14} />
                  <span style={{ fontSize: 13, fontWeight: 650 }}>Credentials exposure</span>
                  {sev && (
                    <span style={{
                      marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
                      letterSpacing: '.08em', padding: '3px 8px', borderRadius: 6,
                      color: SEV_STYLE[sev].color, background: SEV_STYLE[sev].bg,
                      border: `1px solid ${SEV_STYLE[sev].color}44`
                    }}>{SEV_STYLE[sev].label}</span>
                  )}
                  <button className="btn btn--sm" style={{ marginLeft: sev ? 0 : 'auto' }} disabled={busy === 'scan'} onClick={doScan}>
                    {busy === 'scan' ? 'SCANNING…' : scan ? '↻ RESCAN' : 'SCAN VAULT'}
                  </button>
                </div>
                {!scan && <p className="faint" style={{ fontSize: 12 }}>Detects API keys, tokens, private keys and password assignments — reports location only, never the value.</p>}
                {scan && (
                  <>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                      <span className="chip" style={{ fontSize: 9.5 }}>{scan.totalHits} hits</span>
                      <span className="chip chip--amber" style={{ fontSize: 9.5 }}>{scan.unencryptedHits} plaintext</span>
                      {Object.entries(scan.byLabel).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => (
                        <span key={k} className="badge badge--custom" style={{ fontSize: 9 }}>{k} ×{v}</span>
                      ))}
                    </div>
                    {scan.piiTotal > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <button
                          className="chip"
                          style={{ cursor: 'pointer', fontSize: 9.5 }}
                          onClick={() => setShowPii(v => !v)}
                        >
                          {showPii ? '▾' : '▸'} {scan.piiTotal} PII exposures ({Object.entries(scan.piiByLabel).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}×${v}`).join(', ')})
                        </button>
                        {showPii && (
                          <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 6, display: 'flex', flexDirection: 'column' }}>
                            {scan.piiHits.map((h, i) => (
                              <div key={i} className="goal-row" style={{ cursor: 'default', padding: '5px 4px' }}>
                                <span className="mono faint" style={{ fontSize: 10 }}>{h.path}:{h.line}</span>
                                <span className="faint" style={{ fontSize: 10, marginLeft: 'auto' }}>{h.label}{h.encrypted ? ' · enc' : ''}</span>
                              </div>
                            ))}
                            {scan.piiTotal > scan.piiHits.length && (
                              <p className="faint" style={{ fontSize: 11, textAlign: 'center', padding: '6px 0' }}>+{scan.piiTotal - scan.piiHits.length} more not shown</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {scan.totalHits === 0 && <p className="faint" style={{ fontSize: 12 }}>✅ No secret patterns detected.</p>}
                    <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                      {scan.hits.map((h, i) => {
                        const s = SEV_STYLE[h.encrypted ? 'enc' : 'plain']
                        return (
                          <div key={i} className="goal-row" style={{ cursor: 'default', padding: '7px 4px' }}>
                            <span style={{
                              fontFamily: 'var(--mono)', fontSize: 8.5, fontWeight: 700, letterSpacing: '.06em',
                              padding: '2px 7px', borderRadius: 5, flexShrink: 0,
                              color: s.color, background: s.bg, border: `1px solid ${s.color}44`
                            }}>{s.label}</span>
                            <span className="mono faint" style={{ fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {h.path}:{h.line}
                            </span>
                            <span className="faint" style={{ fontSize: 10, marginLeft: 'auto', flexShrink: 0 }}>{h.label}</span>
                          </div>
                        )
                      })}
                      {scan.totalHits > scan.hits.length && (
                        <p className="faint" style={{ fontSize: 11, textAlign: 'center', padding: '8px 0' }}>+{scan.totalHits - scan.hits.length} more not shown</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── AI advisor ── */}
            <div>
              <div className="hud-tag" style={{ marginBottom: 10 }}>AI ADVISOR</div>
              <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <IconSync size={14} />
                  <span style={{ fontSize: 13, fontWeight: 650 }}>Risk intelligence</span>
                  <button className="btn btn--sm" style={{ marginLeft: 'auto' }} disabled={busy === 'ai'} onClick={doAi}>
                    {busy === 'ai' ? 'ANALYZING…' : aiText ? '↻ RE-ANALYZE' : 'ANALYZE'}
                  </button>
                </div>
                <p className="faint" style={{ fontSize: 11.5, marginBottom: 12 }}>
                  Sends the scan summary (paths + pattern types, never secret values) to your configured AI provider for prioritized recommendations.
                </p>
                {!aiText && !busy && <p className="faint" style={{ fontSize: 12 }}>Run a scan first for sharper advice — the advisor works with whatever evidence exists.</p>}
                {aiText && (
                  <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.65, whiteSpace: 'pre-wrap', flex: 1, maxHeight: 360, overflowY: 'auto' }}>
                    {aiText}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
