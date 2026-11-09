import { useEffect, useRef, useState } from 'react'
import { BrainMark } from './icons'
interface Props {
  config: any
  onDone: () => void
  onToast: (msg: string, kind?: 'info' | 'error' | 'success') => void
}

const STEPS = ['Welcome', 'GitHub', 'AI', 'Agents', 'Done']

const PROVIDERS = [
  { id: 'local', mark: '⌂', accent: '#22d3ee', name: 'Local (recommended)', desc: 'Runs on your PC, offline, private. Downloads ~2GB once.' },
  { id: 'codex', mark: '◎', accent: '#4ade80', name: 'Codex / ChatGPT', desc: 'Uses your Codex CLI login (~/.codex). No key needed.' },
  { id: 'claude-oauth', mark: '✳', accent: '#c4b5fd', name: 'Claude (sign-in)', desc: 'Claude Pro/Max — run `claude setup-token` and paste it.' },
  { id: 'anthropic', mark: 'A', accent: '#fbbf24', name: 'Claude API', desc: 'Anthropic API key. Pay-per-token.' },
  { id: 'openai', mark: 'O', accent: '#34d399', name: 'OpenAI', desc: 'OpenAI API key (GPT-4o, o-series).' },
  { id: 'grok', mark: 'X', accent: '#e5e7eb', name: 'Grok', desc: 'xAI API key from console.x.ai.' },
  { id: 'gemini', mark: 'G', accent: '#60a5fa', name: 'Gemini', desc: 'Free API key from Google AI Studio.' },
  { id: 'ollama', mark: 'L', accent: '#fb923c', name: 'Ollama', desc: 'If you already have Ollama installed with models.' }
]

export default function Wizard({ config, onDone, onToast }: Props) {
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)

  const [ghDevice, setGhDevice] = useState<any>(null)
  const [ghCopied, setGhCopied] = useState(false)
  const [ghLogin, setGhLogin] = useState('')
  const [ghWaitSec, setGhWaitSec] = useState(0)
  const [repoMode, setRepoMode] = useState<'create' | 'import'>('create')
  const [userRepos, setUserRepos] = useState<any[]>([])
  const [importRef, setImportRef] = useState('')
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

  useEffect(() => {
    window.sb.localLlmStatus().then(setLocalStatus)
    window.sb.aiCodexStatus?.().then(setCodexStatus).catch(() => {})
    const off = window.sb.onLocalLlmProgress(setLocalProgress)
    return off
  }, [])

  useEffect(() => {
    if (!ghDevice || ghLogin) return
    setGhWaitSec(0)
    const t = setInterval(() => setGhWaitSec(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [ghDevice, ghLogin])

  useEffect(() => {
    if (!ghDevice) return
    let nextPollAt = 0
    pollRef.current = setInterval(async () => {
      if (Date.now() < nextPollAt) return // honoring slow_down backoff
      try {
        const res: any = await window.sb.ghPollDeviceFlow(ghDevice)
        if (res?.status === 'success') {
          clearInterval(pollRef.current)
          setGhLogin(res.login ?? 'you')
          setRepoName(`keepmind-${res.login ?? 'me'}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
          onToast('GitHub connected!', 'success')
        } else if (res?.status === 'slow_down') {
          nextPollAt = Date.now() + 10_000
        }
        // 'pending' → keep polling
      } catch (e: any) {
        const msg = String(e?.message ?? e)
        if (/expired|denied|bad_verification/i.test(msg)) {
          // terminal — the code is dead, let the user restart the flow
          clearInterval(pollRef.current)
          setGhDevice(null)
          onToast(`GitHub: ${msg} — start the connection again`, 'error')
        }
        // transient errors (network blips) → keep polling
      }
    }, Math.max(ghDevice.interval ?? 5, 5) * 1000)
    return () => clearInterval(pollRef.current)
  }, [ghDevice])

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

  // Once GitHub is connected, offer the user's repos for import
  useEffect(() => {
    if (!ghLogin) return
    window.sb.ghListRepos?.().then((repos: any[]) => {
      const sorted = [...(repos ?? [])].sort((a, b) => {
        const score = (r: any) => /brain|second|keepmind|memory/i.test(r.full_name) ? 0 : 1
        return score(a) - score(b)
      })
      setUserRepos(sorted)
      if (sorted[0] && !importRef) setImportRef(sorted[0].full_name)
    }).catch(() => {})
  }, [ghLogin])

  const useExistingRepo = async () => {
    setBusy(true)
    try {
      const [owner, name] = importRef.split('/')
      await window.sb.ghUseRepo(owner, name)
      setRepoCreated(true)
      onToast(`Repo linked: ${importRef}`, 'success')
    } catch (e: any) {
      onToast(`Repo: ${e?.message ?? e}`, 'error')
    } finally { setBusy(false) }
  }

  const createRepo = async () => {
    setBusy(true)
    try {
      const repo = await window.sb.ghCreateRepo(repoName || 'keepmind', 'My KeepMind — memory & insights')
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
    if (step === 1 && !repoCreated && ghLogin) { repoMode === 'import' ? useExistingRepo() : createRepo(); return }
    if (step === 2) { saveProvider(); return }
    if (step === 3) { skipConnectors(); return }
    setStep(s => Math.min(s + 1, STEPS.length - 1))
  }

  return (
    <div className="view" style={{ display: 'flex', alignItems: 'center' }}>
      <div className="wizard">
        <div>
          <div className="hud-tag" style={{ marginBottom: 8 }}>KEEPMIND · SETUP</div>
          <h1 style={{ textShadow: '0 0 24px rgba(34,211,238,.35)' }}>KeepMind</h1>
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
            <h2>Your AI agents get a brain</h2>
            <p className="sub">
              KeepMind is not a note app — it&apos;s the <strong>persistent memory engine your LLMs plug into</strong>.
              Connect Codex, Claude, Cursor or any agent via MCP and it starts learning on its own:
              reading, writing, organizing and consolidating knowledge in the background while you sleep.
            </p>
            <div className="card card-pad" style={{ padding: '14px 18px', marginBottom: 16, borderColor: 'rgba(34,211,238,.35)' }}>
              <p className="faint" style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                🔓 <strong style={{ color: 'var(--text)' }}>Never locked to one model.</strong>{' '}
                Your entire knowledge base is plain Markdown in <em>your</em> GitHub repo — swap Codex for Claude,
                Cursor for Grok, local for cloud, at any moment. Zero migration, zero export, zero loss.
                The agents are replaceable. The brain is yours.
              </p>
            </div>
            <div className="grid grid-2" style={{ marginBottom: 8 }}>
              {[
                ['🧠', 'Agent-native memory', 'LLMs read & write via MCP tools — no copy-paste, no context loss between sessions.'],
                ['🔁', 'Swap brains anytime', 'Change provider whenever you want. Same memory, same skills — knowledge never leaves your repo.'],
                ['🌙', 'Sleep-cycle learning', 'Nightly cycles replay the day and distill durable facts, lessons and skills — like memory consolidation in a real brain.'],
                ['🧬', 'Living synaptic map', 'A real-time 3D graph of how your memories connect — watch knowledge fire as agents write.'],
                ['🗂️', 'Tiered memory + semantic search', 'Short → medium → long-term consolidation, embeddings-powered recall, entity graph linking people & projects.'],
                ['⚙️', 'Self-improving brain', 'Automations, skill evolution, dedup and memory hygiene — the brain maintains itself and recommends what to run next.']
              ].map(([e, t, d]) => (
                <div key={t} className="card card-pad" style={{ padding: '16px 18px' }}>
                  <div className="feat-emoji" style={{ fontSize: 22, marginBottom: 8 }}>{e}</div>
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
              KeepMind stores all memory in <strong>a private repository you own</strong>.
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
                  border: '1px solid var(--line-bright)', marginBottom: 10,
                  display: 'inline-block'
                }}>
                  {ghDevice.user_code}
                </div>
                <div style={{ marginBottom: 14 }}>
                  <button
                    className="btn btn--ghost"
                    style={{ fontSize: 12, padding: '5px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(ghDevice.user_code)
                        setGhCopied(true)
                        setTimeout(() => setGhCopied(false), 2000)
                      } catch { /* clipboard unavailable */ }
                    }}
                  >
                    {ghCopied ? '✓ Copied' : '⧉ Copy code'}
                  </button>
                </div>
                <div className="gh-wait" style={{ marginBottom: 6 }}>
                  <span className="gh-spinner" />
                  <p className="faint" style={{ fontSize: 12.5 }}>
                    Waiting for authorization — {ghWaitSec}s elapsed
                  </p>
                </div>
                <p className="faint" style={{ fontSize: 11, marginBottom: 12 }}>
                  Enter the code on GitHub, click <strong>Authorize</strong>, and this screen will continue automatically.
                </p>
                <button
                  className="btn btn--ghost"
                  style={{ fontSize: 12, padding: '5px 14px', marginBottom: 12 }}
                  onClick={async () => {
                    try {
                      const res: any = await window.sb.ghPollDeviceFlow(ghDevice)
                      if (res?.status === 'success') {
                        setGhLogin(res.login ?? 'you')
                        setRepoName(`keepmind-${res.login ?? 'me'}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
                        onToast('GitHub connected!', 'success')
                      } else {
                        onToast('Not authorized yet — finish on github.com then check again', 'info')
                      }
                    } catch (e: any) {
                      onToast(`Check failed: ${e?.message ?? e}`, 'error')
                    }
                  }}
                >
                  Already authorized? Check now
                </button>
                <div className="progress-bar progress-bar--indeterminate" style={{ maxWidth: 280, margin: '0 auto' }}>
                  <div />
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
                    <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                      {([['create', '＋ New repo'], ['import', '⇪ Import existing']] as const).map(([m, label]) => (
                        <button key={m}
                          className={`btn ${repoMode === m ? 'btn--primary' : 'btn--ghost'}`}
                          style={{ flex: 1, fontSize: 12.5 }}
                          onClick={() => setRepoMode(m)}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {repoMode === 'create' ? (
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
                      <>
                        <div className="field">
                          <label>Existing repository</label>
                          {userRepos.length > 0 ? (
                            <select value={importRef} onChange={e => setImportRef(e.target.value)}>
                              {userRepos.map((r: any) => (
                                <option key={r.full_name} value={r.full_name}>
                                  {r.full_name}{r.private ? ' 🔒' : ''}{/brain|second|keepmind|memory/i.test(r.full_name) ? ' ★' : ''}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input value={importRef} onChange={e => setImportRef(e.target.value)} placeholder="owner/repo-name" />
                          )}
                          <span className="hint">
                            {userRepos.length > 0
                              ? 'Pick a repo — its memory/ contents will sync into KeepMind. ★ = likely a brain repo.'
                              : 'Loading your repos… or type owner/repo manually.'}
                          </span>
                        </div>
                        <button className="btn btn--primary btn--lg" style={{ width: '100%' }} onClick={next}
                          disabled={busy || !importRef.includes('/')}>
                          {busy ? 'Linking…' : 'Use this repo →'}
                        </button>
                      </>
                    )}
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
                  style={{ '--accent': p.accent } as any}
                  onClick={() => { setProvider(p.id); if (p.id !== 'local' && p.id !== 'ollama') setModel('') }}
                >
                  <div className="p-mark" style={{ color: p.accent, borderColor: `${p.accent}55`, background: `${p.accent}14` }}>{p.mark}</div>
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
                      terminal — KeepMind reuses that session automatically. No API key needed.
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

        {/* STEP 3 — agents */}
        {step === 3 && (
          <div className="card wizard__card">
            <h2>3 · Your agents, your brain</h2>
            <p className="sub">
              KeepMind exposes a local <strong>MCP server</strong> — any agent that speaks MCP can read and write
              your memory. After setup, the <strong>Agents</strong> page has copy-paste configs and prompts for each one.
            </p>
            <div className="grid grid-2" style={{ marginBottom: 8 }}>
              {[
                ['◎', 'Codex / ChatGPT', 'TOML snippet for ~/.codex/config.toml — uses your existing CLI login.'],
                ['✳', 'Claude Code', 'One command: claude mcp add keepmind. Also .mcp.json for repo work.'],
                ['▣', 'Cursor / Gemini CLI', 'Drop-in JSON configs for .cursor/mcp.json and .gemini/settings.json.'],
                ['𝕏', 'Grok & VPS bots', 'Same MCP server runs headless on any server — your brain travels with the repo.']
              ].map(([e, t, d]) => (
                <div key={t} className="card card-pad" style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 18 }}>{e}</span>
                    <strong style={{ fontSize: 13 }}>{t}</strong>
                  </div>
                  <p className="faint" style={{ fontSize: 12, lineHeight: 1.5, margin: 0 }}>{d}</p>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button className="btn btn--ghost" onClick={() => setStep(2)}>← Back</button>
              <button className="btn btn--primary btn--lg" style={{ flex: 1 }} onClick={skipConnectors}>
                Finish setup →
              </button>
            </div>
            <p className="faint" style={{ fontSize: 11.5, marginTop: 12, textAlign: 'center' }}>
              Everything syncs to your GitHub repo continuously — agents on other machines see the same brain.
            </p>
          </div>
        )}

        {/* STEP 4 — done */}
        {step === 4 && (
          <div className="card wizard__card" style={{ textAlign: 'center', padding: '44px 32px' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <BrainMark size={72} />
            </div>
            <h2 style={{ fontSize: 22 }}>Your KeepMind is ready</h2>
            <p className="sub" style={{ margin: '10px auto 26px', maxWidth: 460 }}>
              Your brain is live. Connect an agent from the <strong>Agents</strong> page and it starts learning immediately —
              every night it consolidates what happened, and every write syncs to your GitHub repo.
              Change the AI whenever you want; the memory stays.
            </p>
            <button className="btn btn--primary btn--lg" style={{ width: '100%', maxWidth: 320 }} onClick={onDone}>
              Enter KeepMind →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
