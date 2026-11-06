import { useEffect, useRef, useState } from 'react'

// ── Types ──
interface Props {
  config: any
  onDone: () => void
  onToast: (msg: string, kind?: 'info' | 'error' | 'success') => void
}

const STEPS = ['Bem-vindo', 'GitHub', 'Inteligência', 'Conectores', 'Pronto']

const PROVIDERS = [
  { id: 'local', emoji: '🏠', name: 'Local (recomendado)', desc: 'Roda no seu PC, offline, privado. Baixa ~2GB na primeira vez.' },
  { id: 'anthropic', emoji: '🧠', name: 'Claude', desc: 'API key da Anthropic. Melhor qualidade de resposta.' },
  { id: 'openai', emoji: '⚡', name: 'OpenAI', desc: 'API key da OpenAI (GPT-4o, o-series).' },
  { id: 'gemini', emoji: '✨', name: 'Gemini', desc: 'API key gratuita do Google AI Studio.' },
  { id: 'ollama', emoji: '🦙', name: 'Ollama', desc: 'Se você já tem Ollama instalado com modelos.' }
]

export default function Wizard({ config, onDone, onToast }: Props) {
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)

  // github state
  const [ghDevice, setGhDevice] = useState<any>(null)
  const [ghLogin, setGhLogin] = useState('')
  const [repoName, setRepoName] = useState('')
  const [repoCreated, setRepoCreated] = useState(false)
  const pollRef = useRef<any>(null)

  // ai state
  const [provider, setProvider] = useState(config?.ai?.provider ?? 'local')
  const [apiKey, setApiKey] = useState(config?.ai?.apiKey ?? '')
  const [model, setModel] = useState(config?.ai?.model ?? '')
  const [localStatus, setLocalStatus] = useState<any>(null)
  const [localProgress, setLocalProgress] = useState<{ kind: string; pct?: number; downloaded?: number; total?: number; modelId?: string } | null>(null)
  const [aiTest, setAiTest] = useState<{ ok: boolean; msg: string } | null>(null)

  // connectors state
  const [waQr, setWaQr] = useState<any>(null)
  const [tgToken, setTgToken] = useState('')
  const [pgUrl, setPgUrl] = useState('')
  const [serverStatus, setServerStatus] = useState<Record<string, boolean>>({})

  useEffect(() => {
    window.sb.localLlmStatus().then(setLocalStatus)
    const off = window.sb.onLocalLlmProgress(setLocalProgress)
    window.sb.mcpStatus().then(s => {
      const map: Record<string, boolean> = {}
      for (const id of ['whatsapp', 'telegram', 'postgres']) map[id] = s.running.includes(id)
      setServerStatus(map)
    })
    return off
  }, [])

  // poll github device flow
  useEffect(() => {
    if (!ghDevice) return
    pollRef.current = setInterval(async () => {
      try {
        const res = await window.sb.ghPollDeviceFlow(ghDevice)
        if (res) {
          clearInterval(pollRef.current)
          setGhLogin(res.login ?? 'você')
          setRepoName(`second-brain-${res.login ?? 'me'}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
          onToast('GitHub conectado! ✅', 'success')
        }
      } catch (e: any) {
        clearInterval(pollRef.current)
        onToast(`GitHub: ${e?.message ?? e}`, 'error')
      }
    }, Math.max(ghDevice.interval ?? 5, 5) * 1000)
    return () => clearInterval(pollRef.current)
  }, [ghDevice])

  // poll whatsapp QR
  useEffect(() => {
    if (step !== 3 || !serverStatus.whatsapp) return
    const t = setInterval(async () => {
      const qr = await window.sb.whatsappQr()
      setWaQr(qr)
      if (qr?.status === 'connected') onToast('WhatsApp conectado! ✅', 'success')
    }, 2500)
    return () => clearInterval(t)
  }, [step, serverStatus.whatsapp])

  const startGithub = async () => {
    setBusy(true)
    try {
      const dc = await window.sb.ghStartDeviceFlow()
      setGhDevice(dc)
      await window.sb.openExternal(dc.verification_uri)
      onToast(`Código: ${dc.user_code}`, 'info')
    } catch (e: any) {
      onToast(`GitHub falhou: ${e?.message ?? e} — verifique se o OAuth App está configurado`, 'error')
    } finally { setBusy(false) }
  }

  const createRepo = async () => {
    setBusy(true)
    try {
      const repo = await window.sb.ghCreateRepo(repoName || 'second-brain', 'Meu second brain — memória e insights')
      setRepoCreated(true)
      onToast(`Repo criado: ${repo.html_url}`, 'success')
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
      setAiTest({ ok: true, msg: 'Modelo local pronto!' })
      onToast('Cérebro local pronto 🧠', 'success')
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
        const testCfg = { provider, apiKey, model: model || p?.models?.[0] }
        const res = await window.sb.aiTest(testCfg)
        setAiTest(res.ok ? { ok: true, msg: `Conectado: ${res.reply}` } : { ok: false, msg: res.error })
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
        if (!tgToken.trim()) { onToast('Cole o token do bot primeiro', 'error'); return }
        await window.sb.updateMcp(id, { env: { TELEGRAM_BOT_TOKEN: tgToken.trim() }, enabled: true })
      }
      if (kind === 'postgres') {
        if (!pgUrl.trim()) { onToast('Cole a DATABASE_URL primeiro', 'error'); return }
        await window.sb.updateMcp(id, { env: { DATABASE_URL: pgUrl.trim() }, enabled: true })
      }
      if (kind === 'whatsapp') {
        await window.sb.updateMcp(id, { enabled: true })
      }
      const res = await window.sb.mcpStart(id)
      setServerStatus(s => ({ ...s, [id]: true }))
      onToast(`${id} conectado (${res.tools.length} tools)`, 'success')
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
          <h1>🧠 Second Brain</h1>
          <p className="dim" style={{ marginTop: 6, fontSize: 14 }}>
            Vamos configurar seu cérebro digital em 2 minutos.
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
            <h2>O que o Second Brain faz</h2>
            <p className="sub">
              Ele conecta seus apps (GitHub, WhatsApp, Telegram, banco de dados), guarda memórias
              no <strong>seu repositório do GitHub</strong>, e conversa com você através de
              agentes especialistas — Warren Buffett, Bill Gates, Elon Musk e outros —
              tudo com uma IA que pode rodar <strong>local no seu PC</strong>.
            </p>
            <div className="grid grid-2" style={{ marginBottom: 8 }}>
              {[
                ['💾', 'Memória própria', 'Seus dados ficam num repo GitHub seu — portável e seu.'],
                ['🔌', 'Conectores', 'WhatsApp (QR), Telegram, Postgres e qualquer MCP.'],
                ['🧠', 'IA local', 'Modelo open-source embutido — funciona offline.'],
                ['🎭', 'Agentes', 'Converse com personas que pensam com o seu contexto.']
              ].map(([e, t, d]) => (
                <div key={t} className="card card-pad" style={{ padding: '16px 18px' }}>
                  <div style={{ fontSize: 22, marginBottom: 8 }}>{e}</div>
                  <h3 style={{ fontSize: 13.5 }}>{t}</h3>
                  <p className="faint" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>{d}</p>
                </div>
              ))}
            </div>
            <button className="btn btn--primary btn--lg" style={{ width: '100%' }} onClick={() => setStep(1)}>
              Começar →
            </button>
          </div>
        )}

        {/* STEP 1 — GitHub */}
        {step === 1 && (
          <div className="card wizard__card">
            <h2>1 · Conecte seu GitHub</h2>
            <p className="sub">
              O Second Brain guarda toda a memória num <strong>repositório privado seu</strong>.
              Você autoriza pelo navegador — nenhum token fica exposto.
            </p>
            {!ghDevice && !ghLogin && (
              <button className="btn btn--primary btn--lg" onClick={startGithub} disabled={busy}>
                {busy ? 'Abrindo GitHub…' : 'Conectar com GitHub'}
              </button>
            )}
            {ghDevice && !ghLogin && (
              <div className="card card-pad" style={{ textAlign: 'center' }}>
                <p style={{ marginBottom: 14 }}>
                  Abra o GitHub e digite o código:
                </p>
                <div className="mono" style={{
                  fontSize: 32, fontWeight: 700, letterSpacing: '0.2em',
                  color: 'var(--blue-bright)', textShadow: '0 0 20px var(--glow)',
                  padding: '14px', borderRadius: 10, background: 'rgba(3,7,18,.7)',
                  border: '1px solid var(--line-bright)', marginBottom: 14
                }}>
                  {ghDevice.user_code}
                </div>
                <p className="faint" style={{ fontSize: 12 }}>Aguardando autorização… a janela do GitHub já deve estar aberta.</p>
                <div className="progress-bar" style={{ maxWidth: 280, margin: '14px auto 0' }}>
                  <div style={{ width: '60%' }} />
                </div>
              </div>
            )}
            {ghLogin && (
              <>
                <div className="card card-pad" style={{ marginBottom: 16, borderColor: 'rgba(52,211,153,.3)' }}>
                  <p style={{ color: 'var(--green)', fontWeight: 600 }}>✓ Conectado como <strong>{ghLogin}</strong></p>
                </div>
                {!repoCreated ? (
                  <>
                    <div className="field">
                      <label>Nome do repositório</label>
                      <input value={repoName} onChange={e => setRepoName(e.target.value)} />
                      <span className="hint">Será criado privado no seu GitHub automaticamente.</span>
                    </div>
                    <button className="btn btn--primary btn--lg" style={{ width: '100%' }} onClick={next} disabled={busy}>
                      {busy ? 'Criando…' : 'Criar repositório'}
                    </button>
                  </>
                ) : (
                  <div className="card card-pad" style={{ borderColor: 'rgba(52,211,153,.3)' }}>
                    <p style={{ color: 'var(--green)', fontWeight: 600 }}>✓ Repositório criado e pronto para receber sua memória.</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* STEP 2 — AI */}
        {step === 2 && (
          <div className="card wizard__card">
            <h2>2 · Escolha a IA</h2>
            <p className="sub">
              O modelo <strong>local</strong> já vem embutido — baixa uma vez e funciona offline.
              Ou conecte sua própria API para máxima qualidade.
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
                <h3 style={{ fontSize: 13.5, marginBottom: 10 }}>Modelo local</h3>
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
                      {localProgress.kind === 'server' && `Baixando servidor llama.cpp… ${Math.round((localProgress.pct ?? 0) * 100)}%`}
                      {localProgress.kind === 'model' && `Baixando modelo… ${((localProgress.downloaded ?? 0) / 1e9).toFixed(1)} / ${((localProgress.total ?? 0) / 1e9).toFixed(1)} GB`}
                      {localProgress.kind === 'ensure' && 'Preparando modelo local…'}
                    </div>
                    <div className="progress-bar">
                      <div style={{ width: localProgress.kind === 'model' && localProgress.total
                        ? `${Math.min(100, ((localProgress.downloaded ?? 0) / localProgress.total) * 100)}%`
                        : localProgress.kind === 'server' ? `${Math.round((localProgress.pct ?? 0) * 100)}%` : '50%' }} />
                    </div>
                  </div>
                )}
                <button className="btn btn--primary" style={{ marginTop: 14, width: '100%' }} onClick={ensureLocal} disabled={busy}>
                  {busy ? 'Baixando/preparando…' : '⬇ Baixar e ativar modelo local'}
                </button>
                {aiTest && (
                  <p style={{ marginTop: 10, fontSize: 12.5, color: aiTest.ok ? 'var(--green)' : 'var(--red)' }}>
                    {aiTest.ok ? '✓ ' : '✗ '}{aiTest.msg}
                  </p>
                )}
              </div>
            )}

            {provider !== 'local' && (
              <>
                <div className="field">
                  <label>API Key</label>
                  <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                    placeholder={provider === 'anthropic' ? 'sk-ant-…' : provider === 'openai' ? 'sk-…' : provider === 'gemini' ? 'AIza…' : 'http://localhost:11434'} />
                </div>
                {provider === 'ollama' && (
                  <div className="field">
                    <label>Base URL (opcional)</label>
                    <input value={model} onChange={e => setModel(e.target.value)} placeholder="http://localhost:11434 — ou nome do modelo" />
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
              <button className="btn btn--ghost" onClick={() => setStep(1)}>← Voltar</button>
              <button className="btn btn--primary btn--lg" style={{ flex: 1 }} onClick={next} disabled={busy || !canNext()}>
                {busy ? 'Testando…' : provider === 'local' ? 'Usar IA local →' : 'Testar e continuar →'}
              </button>
            </div>
          </div>
        )}

        {/* STEP 3 — connectors */}
        {step === 3 && (
          <div className="card wizard__card">
            <h2>3 · Conectores (opcional)</h2>
            <p className="sub">
              Conecte mensageiros e dados agora ou depois em <strong>Ajustes → Conectores</strong>.
            </p>

            {/* WhatsApp */}
            <div className="mcp-row">
              <span className="m-emoji">🟢</span>
              <div className="m-info">
                <div className="m-name">WhatsApp</div>
                <div className="m-desc">Conexão via QR code (estilo WhatsApp Web). ⚠ Não-oficial — use com moderação.</div>
                {waQr?.status === 'qr' && (
                  <div className="qr-box">
                    <img src={waQr.dataUrl} alt="WhatsApp QR" />
                    <p className="faint" style={{ color: '#333', fontSize: 12 }}>Escaneie com o WhatsApp → Aparelhos conectados</p>
                  </div>
                )}
                {waQr?.status === 'connected' && <div className="m-status on">● Conectado</div>}
              </div>
              <button className="btn btn--sm" onClick={() => toggleServer('whatsapp', 'whatsapp')}>
                {serverStatus.whatsapp ? 'Parar' : waQr?.status === 'qr' ? 'Aguardando scan…' : 'Conectar'}
              </button>
            </div>

            {/* Telegram */}
            <div className="mcp-row">
              <span className="m-emoji">✈️</span>
              <div className="m-info">
                <div className="m-name">Telegram</div>
                <div className="m-desc">Bot oficial via BotFather. Conversa remota com seu second brain.</div>
                {!serverStatus.telegram && (
                  <input value={tgToken} onChange={e => setTgToken(e.target.value)}
                    placeholder="Token do bot (@BotFather)" className="mono"
                    style={{ marginTop: 8, width: '100%', background: 'rgba(3,7,18,.7)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', color: 'var(--text)', fontSize: 12 }} />
                )}
                {serverStatus.telegram && <div className="m-status on">● Rodando</div>}
              </div>
              <button className="btn btn--sm" onClick={() => toggleServer('telegram', 'telegram')}>
                {serverStatus.telegram ? 'Parar' : 'Conectar'}
              </button>
            </div>

            {/* Postgres */}
            <div className="mcp-row">
              <span className="m-emoji">🐘</span>
              <div className="m-info">
                <div className="m-name">Postgres (somente leitura)</div>
                <div className="m-desc">Converse com seus dados. postgres://user:pass@host:5432/db</div>
                {!serverStatus.postgres && (
                  <input value={pgUrl} onChange={e => setPgUrl(e.target.value)}
                    placeholder="postgres://…" className="mono"
                    style={{ marginTop: 8, width: '100%', background: 'rgba(3,7,18,.7)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', color: 'var(--text)', fontSize: 12 }} />
                )}
                {serverStatus.postgres && <div className="m-status on">● Rodando</div>}
              </div>
              <button className="btn btn--sm" onClick={() => toggleServer('postgres', 'postgres')}>
                {serverStatus.postgres ? 'Parar' : 'Conectar'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button className="btn btn--ghost" onClick={() => setStep(2)}>← Voltar</button>
              <button className="btn btn--primary btn--lg" style={{ flex: 1 }} onClick={skipConnectors}>
                Concluir setup →
              </button>
            </div>
            <p className="faint" style={{ fontSize: 11.5, marginTop: 12, textAlign: 'center' }}>
              Você pode conectar mais apps depois — Gmail, Calendar, Notion etc. via Composio ou outros MCPs.
            </p>
          </div>
        )}

        {/* STEP 4 — done */}
        {step === 4 && (
          <div className="card wizard__card" style={{ textAlign: 'center', padding: '44px 32px' }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>🧠</div>
            <h2 style={{ fontSize: 22 }}>Seu second brain está pronto</h2>
            <p className="sub" style={{ margin: '10px auto 26px', maxWidth: 460 }}>
              Comece conversando — pergunte "o que você sabe sobre mim?" ou chame Warren Buffett.
              Tudo que acontecer será lembrado no seu repositório.
            </p>
            <button className="btn btn--primary btn--lg" style={{ width: '100%', maxWidth: 320 }} onClick={onDone}>
              Entrar no Second Brain →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
