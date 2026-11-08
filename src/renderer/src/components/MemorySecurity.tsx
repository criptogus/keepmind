import { useEffect, useState } from 'react'
export default function MemorySecurity() {
  const [status, setStatus] = useState<any>(null), [passphrase, setPassphrase] = useState(''), [recoveryInput, setRecoveryInput] = useState('')
  const [recovery, setRecovery] = useState(''), [space, setSpace] = useState('personal'), [grants, setGrants] = useState(''), [error, setError] = useState('')
  const refresh = async () => { const s = await window.sb.securityStatus(); setStatus(s); setSpace(s.space) }
  useEffect(() => { void refresh().catch(() => setError('Memory security unavailable')) }, [])
  const run = async (fn: () => Promise<unknown>) => { try { setError(''); await fn(); setPassphrase(''); setRecoveryInput(''); await refresh() } catch { setError('Memory security operation failed. Check your credentials and OS keychain.') } }
  return <div className="card card-pad">
    <h2>Memory encryption</h2>
    <p>Restricted memories require unlocked encryption. {status?.unlocked ? 'Unlocked' : 'Locked'}.</p>
    {recovery ? <div role="alert"><p>Save this recovery key offline. It is displayed once. Losing your passphrase and recovery key means losing access to your data.</p><code style={{ overflowWrap: 'anywhere' }}>{recovery}</code><button className="btn" onClick={() => setRecovery('')}>I saved my recovery key</button></div> : <>
      <input type="password" aria-label="Memory passphrase" autoComplete="off" value={passphrase} onChange={e => setPassphrase(e.target.value)} placeholder="Memory passphrase" />
      {!status?.configured ? <button className="btn" disabled={!status || !passphrase} onClick={() => run(async () => { const r = await window.sb.securitySetup(passphrase); setRecovery(r.recoveryKey) })}>Set up encryption</button> : <>
        <button className="btn" disabled={!passphrase} onClick={() => run(() => window.sb.securityUnlock({ passphrase }))}>Unlock with passphrase</button>
        <input type="password" aria-label="Recovery key" autoComplete="off" value={recoveryInput} onChange={e => setRecoveryInput(e.target.value)} placeholder="Recovery key" />
        <button className="btn" disabled={!recoveryInput} onClick={() => run(() => window.sb.securityUnlock({ recoveryKey: recoveryInput }))}>Recover access</button>
        <button className="btn" onClick={() => run(() => window.sb.securityLock())}>Lock memory</button>
      </>}
    </>}
    {status?.unlocked && <>
      <input aria-label="Active space" value={space} onChange={e => setSpace(e.target.value)} />
      <input aria-label="Explicit cross-space grants" value={grants} onChange={e => setGrants(e.target.value)} placeholder="Cross-space grants, comma separated" />
      <button className="btn" onClick={() => run(() => window.sb.securityConfigure(space, grants.split(',').map(s => s.trim()).filter(Boolean), status.encryptAll))}>Apply spaces</button>
      <button className="btn" onClick={() => run(async () => { const config = await window.sb.getConfig(); await window.sb.securityConsent(config.ai.provider) })}>Allow configured cloud model for this space for 15 minutes (PII redacted)</button>
      <label><input type="checkbox" checked={status.encryptAll} onChange={e => run(() => window.sb.securityConfigure(space, grants.split(',').map(s => s.trim()).filter(Boolean), e.target.checked))} />Encrypt all memories in granted spaces</label>
    </>}
    {error && <p role="alert">{error}</p>}
  </div>
}
