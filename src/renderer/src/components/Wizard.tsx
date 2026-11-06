import { useEffect, useRef, useState } from 'react'

interface Props {
  config: any
  onDone: () => void
  onToast: (msg: string, kind?: 'info' | 'error' | 'success') => void
}

const STEPS = ['Welcome', 'GitHub', 'AI', 'Connectors', 'Done']

const PROVIDERS = [
  { id: 'local', emoji: '🏠', name: 'Local (recommended)', desc: 'Runs on your PC, offline, private. Downloads ~2GB once.' },
  { id: 'codex', emoji: '🟢', name: 'Codex / ChatGPT', desc: 'Uses your Codex CLI login (~/.codex). No key needed.' },
  { id: 'claude-oauth', emoji: '🧠', name: 'Claude (sign-in)', desc: 'Claude Pro/Max — run `claude setup-token` and paste it.' },
  { id: 'anthropic', emoji: '🔑', name: 'Claude API', desc: 'Anthropic API key. Pay-per-token.' },
  { id: 'openai', emoji: '⚡', name: 'OpenAI', desc: 'OpenAI API key (GPT-4o, o-series).' },
  { id: 'grok', emoji: '𝕏', name: 'Grok', desc: 'xAI API key from console.x.ai.' },
  { id: 'gemini', emoji: '✨', name: 'Gemini', desc: 'Free API key from Google AI Studio.' },
  { id: 'ollama', emoji: '🦙', name: 'Ollama', desc: 'If you already have Ollama installed with models.' }
]

export default function Wizard({ config, onDone, onToast }: Props) {
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)

  const [ghDevice, setGhDevice] = useState<any>(null)
  const [ghLogin, setGhLogin] = useState('')
  const [repoName, setRepoName] = useState('')
  const [repoCreated, setRepoCreated] = useState(false)
  const pollRef = useRef<any>(null)

  const [provider, setProvider] = useState(config?.ai?.provider ?? 'local')
  const [apiKey, setApiKey] = useState(config?.ai?.apiKey ?? '')
  const [model, setModel] = useState(config?.ai?.model ?? '')
  const [localStatus, setLocalStatus] = useState<any>(null)
  const [localProgress, setLocalProgress] = useState<{ kind: string; pct?: number; downloaded?: number; total?: number; modelId?: string } | null>(null)
  const [aiTest, setAiTest] = useState<{ ok: boolean; msg: string } | null>(null)
  const [codexStatus, setCodexStatus] = useState<any>(null)

  const [waQr, setWaQr] = useState<any>(null)
  const [tgToken, setTgToken] = useState('')
  const [pgUrl, setPgUrl] = useState('')
  const [serverStatus, setServerStatus] = useState<Record<string, boolean>>({})

  useEffect(() => {
    window.sb.localLlmStatus().then(setLocalStatus)
    window.sb.aiCodexStatus?.().then(setCodexStatus).catch(() => {})
    const off = window.sb.onLocalLlmProgress(setLocalProgress)
    window.sb.mcpStatus().then(s => {
      const map: Record<string, boolean> = {}
      for (const id of ['whatsapp', 'telegram', 'postgres']) map[id] = s.running.includes(id)
      setServerStatus(map)
    })
    return off
  }, [])

  useEffect(() => {
    if (!ghDevice) return
    pollRef.current = setInterval(async () => {
      try {
        const res = await window.sb.ghPollDeviceFlow(ghDevice)
        if (res) {
          clearInterval(pollRef.current)
          setGhLogin(res.login ?? 'you')
          setRepoName(`second-brain-${res.login ?? 'me'}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
          onToast('GitHub connected!', 'success')
        }
      } catch (e: any) {
        clearInterval(pollRef.current)
        onToast(`GitHub: ${e?.message ?? e}`, 'error')
      }
    }, Math.max(ghDevice.interval ?? 5, 5) * 1000)
    return () => clearInterval(pollRef.current)
  }, [ghDevice])

  useEffect(() => {
    if (step !== 3 || !serverStatus.whatsapp) return
    const t = setInterval(async () => {
      const qr = await window.sb.whatsappQr()
      setWaQr(qr)
      if (qr?.status === 'connected') onToast('WhatsApp connected!', 'success')
    }, 2500)
    return () => clearInterval(t)
  }, [step, serverStatus.whatsapp])

  const startGithub = async () => {
    setBusy(true)
    try {
      const dc = await window.sb.ghStartDeviceFlow()
      setGhDevice(dc)
      await window.sb.openExternal(dc.verification_uri)
      onToast(`Code: ${dc.user_code}`, 'info')
    } catch (e: any) {
      onToast(`GitHub failed: ${e?.message ?? e} — check the OAuth App is configured`, 'error')
    } finally { setBusy(false) }
  }

  const createRepo = async () => {
    setBusy(true)
    try {
      const repo = await window.sb.ghCreateRepo(repoName || 'second-brain', 'My second brain — memory & insights')
      setRepoCreated(true)
      onToast(`Repo created: ${repo.html_url}`, 'success')
    } catch (e: any) {
      onToast(`Repo: ${e?.message ?? e}`, 'error')
    } finally { setBusy(false) }
  }

  const ensureLocal = async () => {
    setBusy(true)
    setLocalProgress({ kind: 'ensure' })
    try {
      const modelId = model || localStatus?.config?.modelId || 'qwen2.5-3b'
      await window.sb.updateLocalLlm({ modelId })
      await window.sb.localLlmEnsure(modelId)
      await window.sb.updateAi({ provider: 'local', model: modelId })
      setAiTest({ ok: true, msg: 'Local model ready!' })
      onToast('Local brain ready 🧠', 'success')
    } catch (e: any) {
      setAiTest({ ok: false, msg: String(e?.message ?? e) })
    } finally { setBusy(false); setLocalProgress(null) }
  }

  const saveProvider = async () => {
    setBusy(true)
    try {
      await window.sb.updateAi({ provider, apiKey: apiKey || undefined, model: model || undefined })
      if (provider !== 'local') {
        const providers: any = await window.sb.aiProviders()
        const p = providers.find((x: any) => x.id === provider)
        const testCfg = { provider, apiKey: apiKey || undefined, model: model || p?.models?.[0] }
        const res = await window.sb.aiTest(testCfg)
        setAiTest(res.ok ? { ok: true, msg: `Connected: ${res.reply}` } : { ok: false, msg: res.error })
        if (!res.ok) { setBusy(false); return }
      }
      await window.sb.setConfig({ onboardingDone: true })
      onDone()
    } catch (e: any) {
      onToast(String(e?.message ?? e), 'error')
    } finally { setBusy(false) }
  }

  const toggleServer = async (id: string, kind: string) => {
    const running = serverStatus[id]
    if (running) {
      await window.sb.mcpStop(id)
      setServerStatus(s => ({ ...s, [id]: false }))
      return
    }
    try {
      if (kind === 'telegram') {
        if (!tgToken.trim()) { onToast('Paste the bot token first', 'error'); return }
        await window.sb.updateMcp(id, { env: { TELEGRAM_BOT_TOKEN: tgToken.trim() }, enabled: true })
      }
      if (kind === 'postgres') {
        if (!pgUrl.trim()) { onToast('Paste the DATABASE_URL first', 'error'); return }
        await window.sb.updateMcp(id, { env: { DATABASE_URL: pgUrl.trim() }, enabled: true })
      }
      if (kind === 'whatsapp') {
        await window.sb.updateMcp(id, { enabled: true })
      }
      const res = await window.sb.mcpStart(id)
      setServerStatus(s => ({ ...s, [id]: true }))
      onToast(`${id} connected (${res.tools.length} tools)`, 'success')
    } catch (e: any) {
      onToast(`${id}: ${e?.message ?? e}`, 'error')
    }
  }

  const skipConnectors = async () => {
    await window.sb.setConfig({ onboardingDone: true })
    onDone()
  }

  const canNext = () => {
    if (step === 1) return !!ghLogin
    if (step === 2) {
      if (provider === 'local') return !!aiTest?.ok || !!config?.ai?.apiKey
      if (provider === 'codex') return !!codexStatus?.loggedIn
      return !!apiKey.trim()
    }
    return true
  }

  const next = () => {
    if (step === 1 && !repoCreated && ghLogin) { createRepo(); return }
    if (step === 2) { saveProvider(); return }
    if (step === 3) { skipConnectors(); return }
    setStep(s => Math.min(s + 1, STEPS.length - 1))
  }

  return (
    <div className="view" style={{ display: 'flex', alignItems: 'center' }}>
      <div className="wizard">
        <div>
          <div className="hud-tag" style={{ marginBottom: 8 }}>SECOND BRAIN · SETUP</div>
          <h1 style={{ textShadow: '0 0 24px rgba(34,211,238,.35)' }}>Second Brain</h1>
          <p className="dim" style={{ marginTop: 8, fontSize: 13 }}>
            Let&apos;s set up your digital brain in ~2 minutes.
          </p>
        </div>

        <div className="wizard__stepper">
          {STEPS.map((s, i) => (
            <div key={s} className={`wizard__step-dot ${i === step ? 'is-active' : ''} ${i < step ? 'is-done' : ''}`} />
          ))}
        </div>

        {/* STEP 0 — welcome */}
        {step === 0 && (
          <div className="card wizard__card">
            <h2>What Second Brain does</h2>
            <p className="sub">
              It connects your apps (GitHub, WhatsApp, Telegram, databases), stores memories in
              <strong> your own GitHub repo</strong>, and talks to you through specialist agents —
              Warren Buffett, Bill Gates, Elon Musk and more — powered by an AI that can run
              <strong> locally on your machine</strong>.
            </p>
            <div className="grid grid-2" style={{ marginBottom: 8 }}>
              {[
                ['💾', 'Own memory', 'Everything lives in a private repo that is yours — portable, versioned.'],
                ['🔌', 'Connectors', 'WhatsApp (QR), Telegram, Postgres and any MCP server.'],
                ['🧠', 'Local AI', 'Bundled open-source model — works fully offline.'],
                ['🎭', 'Agents', 'Chat with personas that think using your context.']
              ].map(([e, t, d]) => (
                <div key={t} className="card card-pad" style={{ padding: '16px 18px' }}>
                  <div style={{ fontSize: 22, marginBottom: 8 }}>{e}</div>
                  <h3 style={{ fontSize: 13.5 }}>{t}</h3>
                  <p className="faint" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>{d}</p>
                </div>
              ))}
            </div>
            <button className="btn btn--primary btn--lg" style={{ width: '100%' }} onClick={() => setStep(1)}>
              Get started →
            </button>
            <button className="btn btn--ghost" style={{ width: '100%', marginTop: 10 }} onClick={skipConnectors}>
              Skip setup — explore first, configure later
            </button>
          </div>
        )}

        {/* STEP 1 — GitHub */}
        {step === 1 && (
          <div className="card wizard__card">
            <h2>1 · Connect GitHub</h2>
            <p className="sub">
              Second Brain stores all memory in <strong>a private repository you own</strong>.
              You authorize via the browser — no token ever touches the app.
            </p>
            {!ghDevice && !ghLogin && (
              <button className="btn btn--primary btn--lg" onClick={startGithub} disabled={busy}>
                {busy ? 'Opening GitHub…' : 'Connect with GitHub'}
              </button>
            )}
            {ghDevice && !ghLogin && (
              <div className="card card-pad" style={{ textAlign: 'center' }}>
                <p style={{ marginBottom: 14 }}>
                  Open GitHub and enter the code:
                </p>
                <div className="mono" style={{
                  fontSize: 32, fontWeight: 700, letterSpacing: '0.2em',
                  color: 'var(--blue-bright)', textShadow: '0 0 20px var(--glow)',
                  padding: '14px', borderRadius: 10, background: 'rgba(3,7,18,.7)',
                  border: '1px solid var(--line-bright)', marginBottom: 14
                }}>
                  {ghDevice.user_code}
                </div>
                <p className="faint" style={{ fontSize: 12 }}>Waiting for authorization… the GitHub window should already be open.</p>
                <div className="progress-bar" style={{ maxWidth: 280, margin: '14px auto 0' }}>
                  <div style={{ width: '60%' }} />
                </div>
              </div>
            )}
            {ghLogin && (
              <>
                <div className="card card-pad" style={{ marginBottom: 16, borderColor: 'rgba(52,211,153,.3)' }}>
                  <p style={{ color: 'var(--green)', fontWeight: 600 }}>✓ Connected as <strong>{ghLogin}</strong></p>
                </div>
                {!repoCreated ? (
                  <>
                    <div className="field">
                      <label>Repository name</label>
                      <input value={repoName} onChange={e => setRepoName(e.target.value)} />
                      <span className="hint">Will be created as a private repo on your GitHub automatically.</span>
                    </div>
                    <button className="btn btn--primary btn--lg" style={{ width: '100%' }} onClick={next} disabled={busy}>
                      {busy ? 'Creating…' : 'Create repository'}
                    </button>
                  </>
                ) : (
                  <div className="card card-pad" style={{ borderColor: 'rgba(52,211,153,.3)' }}>
                    <p style={{ color: 'var(--green)', fontWeight: 600 }}>✓ Repository created and ready to receive your memory.</p>
                  </div>
                )}
              </>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button className="btn btn--ghost" style={{ flex: 1 }} onClick={() => setStep(2)}>
                Continue without GitHub
              </button>
              <button className="btn btn--primary btn--lg" style={{ flex: 1 }} onClick={next} disabled={!canNext() || busy}>
                {busy ? 'Working…' : ghLogin ? 'Continue →' : 'Connect GitHub →'}
              </button>
            </div>
            {!ghLogin && (
              <p className="faint" style={{ fontSize: 11.5, marginTop: 10, textAlign: 'center' }}>
                GitHub sync can be set up later in Settings — the brain works locally without it.
              </p>
            )}
          </div>
        )}

        {/* STEP 2 — AI */}
        {step === 2 && (
          <div className="card wizard__card">
            <h2>2 · Choose your AI</h2>
            <p className="sub">
              The <strong>local</strong> model is bundled — download once, works offline.
              Or plug in your own API for maximum quality.
            </p>

            <div className="provider-grid">
              {PROVIDERS.map(p => (
                <button
                  key={p.id}
                  className={`provider-card ${provider === p.id ? 'is-selected' : ''}`}
                  onClick={() => setProvider(p.id)}
                >
                  <div className="p-emoji">{p.emoji}</div>
                  <div className="p-name">{p.name}</div>
                  <div className="p-desc">{p.desc}</div>
                </button>
              ))}
            </div>

            {provider === 'local' && (
              <div className="card card-pad" style={{ marginBottom: 16, background: 'rgba(3,7,18,.6)' }}>
                <h3 style={{ fontSize: 13.5, marginBottom: 10 }}>Local model</h3>
                {localStatus?.catalog?.map((m: any) => (
                  <label key={m.id} style={{ display: 'flex', gap: 10, padding: '8px 0', alignItems: 'flex-start', cursor: 'pointer' }}>
                    <input type="radio" name="llm-model" checked={model === m.id || (!model && m.id === 'qwen2.5-3b')}
                      onChange={() => setModel(m.id)} style={{ marginTop: 3 }} />
                    <span>
                      <strong style={{ fontSize: 13 }}>{m.label}</strong>
                      <span className="faint" style={{ fontSize: 11.5 }}> · ~{m.sizeGB} GB · {m.description}</span>
                    </span>
                  </label>
                ))}
                {localProgress && (
                  <div style={{ marginTop: 12 }}>
                    <div className="faint" style={{ fontSize: 11.5, marginBottom: 6 }}>
                      {localProgress.kind === 'server' && `Downloading llama.cpp server… ${Math.round((localProgress.pct ?? 0) * 100)}%`}
                      {localProgress.kind === 'model' && `Downloading model… ${((localProgress.downloaded ?? 0) / 1e9).toFixed(1)} / ${((localProgress.total ?? 0) / 1e9).toFixed(1)} GB`}
                      {localProgress.kind === 'ensure' && 'Preparing local model…'}
                    </div>
                    <div className="progress-bar">
                      <div style={{ width: localProgress.kind === 'model' && localProgress.total
                        ? `${Math.min(100, ((localProgress.downloaded ?? 0) / localProgress.total) * 100)}%`
                        : localProgress.kind === 'server' ? `${Math.round((localProgress.pct ?? 0) * 100)}%` : '50%' }} />
                    </div>
                  </div>
                )}
                <button className="btn btn--primary" style={{ marginTop: 14, width: '100%' }} onClick={ensureLocal} disabled={busy}>
                  {busy ? 'Downloading/setting up…' : '⬇ Download & enable local model'}
                </button>
                {aiTest && (
                  <p style={{ marginTop: 10, fontSize: 12.5, color: aiTest.ok ? 'var(--green)' : 'var(--red)' }}>
                    {aiTest.ok ? '✓ ' : '✗ '}{aiTest.msg}
                  </p>
                )}
              </div>
            )}

            {provider === 'codex' && (
              <div className="card card-pad" style={{ marginBottom: 16, background: 'rgba(3,7,18,.6)' }}>
                {codexStatus?.loggedIn ? (
                  <p style={{ fontSize: 13, color: 'var(--green)' }}>
                    ✓ Codex CLI signed in{codexStatus.email ? ` as ${codexStatus.email}` : ''}
                    {codexStatus.accountId ? ` · account ${String(codexStatus.accountId).slice(0, 8)}…` : ''}
                  </p>
                ) : (
                  <>
                    <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                      No Codex login found. Install the Codex CLI and run <code className="mono">codex login</code> in your
                      terminal — Second Brain reuses that session automatically. No API key needed.
                    </p>
                    <button className="btn btn--ghost" style={{ marginTop: 10 }} onClick={async () => setCodexStatus(await window.sb.aiCodexStatus())}>
                      ↻ Re-check login
                    </button>
                  </>
                )}
                {aiTest && (
                  <p style={{ marginTop: 10, fontSize: 12.5, color: aiTest.ok ? 'var(--green)' : 'var(--red)' }}>
                    {aiTest.ok ? '✓ ' : '✗ '}{aiTest.msg}
                  </p>
                )}
              </div>
            )}

            {provider !== 'local' && provider !== 'codex' && (
              <>
                <div className="field">
                  <label>{provider === 'claude-oauth' ? 'Claude token' : 'API key'}</label>
                  <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                    placeholder={
                      provider === 'anthropic' ? 'sk-ant-…' :
                      provider === 'claude-oauth' ? 'sk-ant-oat01-… (from `claude setup-token`)' :
                      provider === 'openai' ? 'sk-…' :
                      provider === 'grok' ? 'xai-… (console.x.ai)' :
                      provider === 'gemini' ? 'AIza…' : 'http://localhost:11434'} />
                  {provider === 'claude-oauth' && (
                    <span className="hint">Run <code>claude setup-token</code> in your terminal — it prints a long-lived token for your Claude Pro/Max plan.</span>
                  )}
                  {provider === 'grok' && (
                    <span className="hint">Create a key at console.x.ai → API Keys. Grok uses an OpenAI-compatible endpoint.</span>
                  )}
                </div>
                {provider === 'ollama' && (
                  <div className="field">
                    <label>Base URL (optional)</label>
                    <input value={model} onChange={e => setModel(e.target.value)} placeholder="http://localhost:11434 — or model name" />
                  </div>
                )}
                {aiTest && (
                  <p style={{ fontSize: 12.5, color: aiTest.ok ? 'var(--green)' : 'var(--red)', marginBottom: 12 }}>
                    {aiTest.ok ? '✓ ' : '✗ '}{aiTest.msg}
                  </p>
                )}
              </>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn--ghost" onClick={() => setStep(1)}>← Back</button>
              <button className="btn btn--primary btn--lg" style={{ flex: 1 }} onClick={next} disabled={busy || !canNext()}>
                {busy ? 'Testing…' : provider === 'local' ? 'Use local AI →' : 'Test & continue →'}
              </button>
            </div>
            <button className="btn btn--ghost" style={{ width: '100%', marginTop: 10, fontSize: 12 }} onClick={skipConnectors}>
              Skip — I'll pick an AI later in Settings
            </button>
          </div>
        )}

        {/* STEP 3 — connectors */}
        {step === 3 && (
          <div className="card wizard__card">
            <h2>3 · Connectors (optional)</h2>
            <p className="sub">
              Connect messengers and data now, or later in <strong>Connectors</strong>.
            </p>

            <div className="mcp-row">
              <span className="m-emoji">🟢</span>
              <div className="m-info">
                <div className="m-name">WhatsApp</div>
                <div className="m-desc">QR-code connection (WhatsApp Web style). ⚠ Unofficial — use in moderation.</div>
                {waQr?.status === 'qr' && (
                  <div className="qr-box">
                    <img src={waQr.dataUrl} alt="WhatsApp QR" />
                    <p className="faint" style={{ color: '#333', fontSize: 12 }}>Scan with WhatsApp → Linked devices</p>
                  </div>
                )}
                {waQr?.status === 'connected' && <div className="m-status on">● Connected</div>}
              </div>
              <button className="btn btn--sm" onClick={() => toggleServer('whatsapp', 'whatsapp')}>
                {serverStatus.whatsapp ? 'Stop' : waQr?.status === 'qr' ? 'Waiting scan…' : 'Connect'}
              </button>
            </div>

            <div className="mcp-row">
              <span className="m-emoji">✈️</span>
              <div className="m-info">
                <div className="m-name">Telegram</div>
                <div className="m-desc">Official bot via BotFather. Chat with your second brain remotely.</div>
                {!serverStatus.telegram && (
                  <input value={tgToken} onChange={e => setTgToken(e.target.value)}
                    placeholder="Bot token (@BotFather)" className="mono"
                    style={{ marginTop: 8, width: '100%', background: 'rgba(3,7,18,.7)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', color: 'var(--text)', fontSize: 12 }} />
                )}
                {serverStatus.telegram && <div className="m-status on">● Running</div>}
              </div>
              <button className="btn btn--sm" onClick={() => toggleServer('telegram', 'telegram')}>
                {serverStatus.telegram ? 'Stop' : 'Connect'}
              </button>
            </div>

            <div className="mcp-row">
              <span className="m-emoji">🐘</span>
              <div className="m-info">
                <div className="m-name">Postgres (read-only)</div>
                <div className="m-desc">Talk to your data. postgres://user:pass@host:5432/db</div>
                {!serverStatus.postgres && (
                  <input value={pgUrl} onChange={e => setPgUrl(e.target.value)}
                    placeholder="postgres://…" className="mono"
                    style={{ marginTop: 8, width: '100%', background: 'rgba(3,7,18,.7)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', color: 'var(--text)', fontSize: 12 }} />
                )}
                {serverStatus.postgres && <div className="m-status on">● Running</div>}
              </div>
              <button className="btn btn--sm" onClick={() => toggleServer('postgres', 'postgres')}>
                {serverStatus.postgres ? 'Stop' : 'Connect'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button className="btn btn--ghost" onClick={() => setStep(2)}>← Back</button>
              <button className="btn btn--primary btn--lg" style={{ flex: 1 }} onClick={skipConnectors}>
                Finish setup →
              </button>
            </div>
            <p className="faint" style={{ fontSize: 11.5, marginTop: 12, textAlign: 'center' }}>
              You can connect more apps later — Gmail, Calendar, Notion etc. via Composio or other MCPs.
            </p>
          </div>
        )}

        {/* STEP 4 — done */}
        {step === 4 && (
          <div className="card wizard__card" style={{ textAlign: 'center', padding: '44px 32px' }}>
            <BrainMarkLarge />
            <h2 style={{ fontSize: 22 }}>Your second brain is ready</h2>
            <p className="sub" style={{ margin: '10px auto 26px', maxWidth: 460 }}>
              Start chatting — ask &quot;what do you know about me?&quot; or call Warren Buffett.
              Everything that happens is remembered in your repository.
            </p>
            <button className="btn btn--primary btn--lg" style={{ width: '100%', maxWidth: 320 }} onClick={onDone}>
              Enter Second Brain →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function BrainMarkLarge() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
      <svg width="72" height="72" viewBox="0 0 48 48">
        <defs>
          <filter id="wz-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="1.6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <linearGradient id="wz-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7dd3fc" />
            <stop offset="100%" stopColor="#0891b2" />
          </linearGradient>
        </defs>
        <g filter="url(#wz-glow)" stroke="url(#wz-grad)" strokeWidth="1.8" fill="rgba(34,211,238,0.08)" strokeLinecap="round">
          <path d="M24 10c-5.5 0-9.5 3.8-9.5 9 0 2.6 1.2 4.8 2.8 6.4-1.8.8-3 2.4-3 4.4 0 2.8 2.4 5 5.7 5h8c3.3 0 5.7-2.2 5.7-5 0-2-1.2-3.6-3-4.4 1.6-1.6 2.8-3.8 2.8-6.4 0-5.2-4-9-9.5-9Z" />
          <path d="M24 10v20" strokeWidth="1.4" />
          <path d="M17 17c2-1.4 4-2 7-2M17.5 24c2.2-1.2 4.5-1.6 6.5-1.6M17.5 30.5c2.4-.8 4.8-1 6.8-.8" strokeWidth="1.2" />
          <path d="M31 17c-2-1.4-4-2-7-2M30.5 24c-2.2-1.2-4.5-1.6-6.5-1.6M30.5 30.5c-2.4-.8-4.8-1-6.8-.8" strokeWidth="1.2" />
        </g>
        <circle cx="24" cy="24" r="3" fill="#a5f3fc" />
      </svg>
    </div>
  )
}
