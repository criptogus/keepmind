import { useEffect, useState } from 'react'
import { IconSparkle } from './icons'

interface Props {
  onToast: (m: string, k?: 'info' | 'error' | 'success') => void
  onActivity?: () => void
}

const PROVIDERS = [
  { id: 'local', emoji: '🏠', name: 'Local (built-in)', desc: 'Runs on your machine via llama.cpp. Private, offline.' },
  { id: 'anthropic', emoji: '🧠', name: 'Claude', desc: 'Anthropic API key. Best reasoning quality.' },
  { id: 'openai', emoji: '⚡', name: 'OpenAI', desc: 'OpenAI API key (GPT-4o, o-series).' },
  { id: 'gemini', emoji: '✨', name: 'Gemini', desc: 'Free API key from Google AI Studio.' },
  { id: 'ollama', emoji: '🦙', name: 'Ollama', desc: 'Uses your existing Ollama install.' }
]

export default function Settings({ onToast, onActivity }: Props) {
  const [config, setConfig] = useState<any>(null)
  const [providers, setProviders] = useState<any[]>([])
  const [local, setLocal] = useState<any>(null)
  const [provider, setProvider] = useState('local')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<any>(null)
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null)

  const refresh = async () => {
    const [c, p, l] = await Promise.all([
      window.sb.getConfig(), window.sb.aiProviders(), window.sb.localLlmStatus()
    ])
    setConfig(c); setProviders(p); setLocal(l)
    setProvider(c.ai?.provider ?? 'local')
    setApiKey(c.ai?.apiKey ?? '')
    setModel(c.ai?.model ?? '')
  }

  useEffect(() => {
    refresh()
    const off = window.sb.onLocalLlmProgress(setProgress)
    return off
  }, [])

  const currentProvider = providers.find(p => p.id === provider)

  const save = async () => {
    setBusy(true); setTest(null)
    try {
      await window.sb.updateAi({ provider, apiKey: apiKey || undefined, model: model || undefined })
      onToast('Settings saved', 'success')
      await refresh()
    } catch (e: any) { onToast(String(e?.message ?? e), 'error') }
    finally { setBusy(false) }
  }

  const testConn = async () => {
    setBusy(true); setTest(null)
    try {
      const res = await window.sb.aiTest({ provider, apiKey: apiKey || undefined, model: model || undefined })
      setTest(res.ok ? { ok: true, msg: `Connected — reply: ${res.reply}` } : { ok: false, msg: res.error })
    } catch (e: any) { setTest({ ok: false, msg: String(e?.message ?? e) }) }
    finally { setBusy(false) }
  }

  const ensureLocal = async () => {
    setBusy(true); onActivity?.()
    try {
      const modelId = model || local?.config?.modelId || 'qwen2.5-3b'
      await window.sb.updateLocalLlm({ modelId })
      await window.sb.localLlmEnsure(modelId)
      await window.sb.updateAi({ provider: 'local', model: modelId })
      setTest({ ok: true, msg: 'Local model ready' })
      onToast('Local brain ready 🧠', 'success')
      await refresh()
    } catch (e: any) {
      setTest({ ok: false, msg: String(e?.message ?? e) })
    } finally { setBusy(false); setProgress(null) }
  }

  const pushMemory = async () => {
    setBusy(true)
    try {
      const r = await window.sb.ghPushMemory('sync: memory update')
      onToast(`Synced ${r.pushed} files → GitHub`, 'success')
    } catch (e: any) { onToast(String(e?.message ?? e), 'error') }
    finally { setBusy(false) }
  }

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>SYSTEM CONFIG</div>
          <h1>Settings</h1>
        </div>
      </div>

      <div className="grid" style={{ maxWidth: 860 }}>
        {/* AI provider */}
        <div className="card card-pad">
          <h2 style={{ marginBottom: 14 }}>AI provider</h2>
          <div className="provider-grid" style={{ marginBottom: 16 }}>
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                className={`provider-card ${provider === p.id ? 'is-selected' : ''}`}
                onClick={() => { setProvider(p.id); setTest(null) }}
              >
                <div className="p-emoji">{p.emoji}</div>
                <div className="p-name">{p.name}</div>
                <div className="p-desc">{p.desc}</div>
              </button>
            ))}
          </div>

          {provider === 'local' ? (
            <div>
              <div className="faint" style={{ fontSize: 12.5, marginBottom: 10 }}>
                Bundled llama.cpp server · {local?.running ? '● running' : '○ stopped'} · endpoint {local?.endpoint ?? '—'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {(local?.catalog ?? []).map((m: any) => (
                  <label key={m.id} style={{ display: 'flex', gap: 10, padding: '8px 10px', alignItems: 'flex-start', cursor: 'pointer', borderRadius: 8, border: '1px solid transparent' }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--line)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}>
                    <input type="radio" name="set-llm-model" checked={model === m.id || (!model && m.id === 'qwen2.5-3b')}
                      onChange={() => setModel(m.id)} style={{ marginTop: 3 }} />
                    <span>
                      <strong style={{ fontSize: 13 }}>{m.label}</strong>
                      <span className="faint" style={{ fontSize: 11.5 }}> · ~{m.sizeGB} GB · {m.description}</span>
                      {local?.config?.modelId === m.id && <span style={{ color: 'var(--green)', fontSize: 11 }}> · active</span>}
                    </span>
                  </label>
                ))}
              </div>
              {progress && (
                <div className="progress-bar" style={{ marginBottom: 10 }}>
                  <div style={{ width: progress.kind === 'model' && progress.total
                    ? `${Math.min(100, ((progress.downloaded ?? 0) / progress.total) * 100)}%`
                    : progress.kind === 'server' ? `${Math.round((progress.pct ?? 0) * 100)}%` : '50%' }} />
                </div>
              )}
              <button className="btn btn--primary" onClick={ensureLocal} disabled={busy}>
                {busy ? 'WORKING…' : '⬇ DOWNLOAD & START LOCAL MODEL'}
              </button>
            </div>
          ) : (
            <>
              <div className="field">
                <label>API key</label>
                <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                  placeholder={provider === 'anthropic' ? 'sk-ant-…' : provider === 'openai' ? 'sk-…' : provider === 'gemini' ? 'AIza…' : 'http://localhost:11434'} />
              </div>
              {currentProvider?.models?.length > 0 && provider !== 'ollama' && (
                <div className="field">
                  <label>Model</label>
                  <select value={model} onChange={e => setModel(e.target.value)}>
                    <option value="">default</option>
                    {currentProvider.models.map((m: string) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              )}
              {provider === 'ollama' && (
                <div className="field">
                  <label>Model / base URL</label>
                  <input value={model} onChange={e => setModel(e.target.value)} placeholder="llama3.1 or http://localhost:11434" />
                </div>
              )}
            </>
          )}

          {test && (
            <p style={{ fontSize: 12.5, color: test.ok ? 'var(--green)' : 'var(--red)', marginTop: 12 }}>
              {test.ok ? '✓ ' : '✗ '}{test.msg}
            </p>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn" onClick={testConn} disabled={busy}>TEST CONNECTION</button>
            <button className="btn btn--primary" onClick={save} disabled={busy}>
              {busy ? 'SAVING…' : 'SAVE'}
            </button>
          </div>
        </div>

        {/* Memory / GitHub */}
        <div className="card card-pad">
          <h2 style={{ marginBottom: 14 }}>Memory & sync</h2>
          <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
            Your second brain stores everything as Markdown in your private GitHub repo.
            Push now to back up the current memory state.
          </p>
          <div className="faint mono" style={{ fontSize: 11.5, marginBottom: 14, wordBreak: 'break-all' }}>
            {config?.github?.repoUrl ?? 'GitHub not connected — run the setup wizard again'}
          </div>
          <button className="btn" onClick={pushMemory} disabled={busy || !config?.github?.repoUrl}>
            <IconSparkle size={12} /> SYNC MEMORY TO GITHUB
          </button>
        </div>

        {/* About */}
        <div className="card card-pad">
          <h2 style={{ marginBottom: 14 }}>About</h2>
          <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
            <p><strong style={{ color: 'var(--text)' }}>Second Brain</strong> v0.1.0 — open source, MIT.</p>
            <p style={{ marginTop: 8 }}>
              Local-first AI memory. Your data lives in <em>your</em> GitHub repo.
              The LLM can run fully offline on your machine.
            </p>
            <p className="mono" style={{ marginTop: 8, fontSize: 11 }}>
              electron · react · typescript · llama.cpp · mcp
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
