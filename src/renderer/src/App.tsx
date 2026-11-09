import { useCallback, useEffect, useState } from 'react'
import NeuralField from './components/NeuralField'
import { BrainMark, IconDashboard, IconChat, IconPlug, IconSettings, IconClock, IconSparkle, IconSync, IconToday } from './components/icons'
import Wizard from './components/Wizard'
import Chat from './components/Chat'
import Dashboard from './components/Dashboard'
import Connectors from './components/Connectors'
import Automations from './components/Automations'
import Settings from './components/Settings'
import GraphView from './components/GraphView'
import Activity from './components/Activity'
import Today from './components/Today'
import Login from './components/Login'

type View = 'today' | 'graph' | 'dashboard' | 'chat' | 'activity' | 'connectors' | 'automations' | 'settings'

interface Toast { id: number; msg: string; kind: 'info' | 'error' | 'success' }
interface Job { phase: 'start' | 'done' | 'error'; name: string; summary?: string }
interface Hit { path: string; title: string; snippet: string }

const NAV: { id: View; label: string; Icon: (p: { size?: number }) => JSX.Element }[] = [
  { id: 'today', label: 'Hoje', Icon: IconToday },
  { id: 'graph', label: 'Mapa', Icon: IconSparkle },
  { id: 'chat', label: 'Conversar', Icon: IconChat },
  { id: 'dashboard', label: 'Saúde', Icon: IconDashboard },
  { id: 'activity', label: 'Atividade', Icon: IconSync },
  { id: 'connectors', label: 'Conectar', Icon: IconPlug },
  { id: 'automations', label: 'Agenda', Icon: IconClock },
  { id: 'settings', label: 'Ajustes', Icon: IconSettings }
]

export default function App() {
  const [config, setConfig] = useState<any>(null)
  const [view, setView] = useState<View>('today')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [activity, setActivity] = useState(0.35)
  const [authState, setAuthState] = useState<{ needsSetup: boolean; user: any } | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [palette, setPalette] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [opened, setOpened] = useState<{ path: string; content: string } | null>(null)

  const toast = useCallback((msg: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, msg, kind }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 8000)
  }, [])

  const pulse = useCallback(() => {
    setActivity(a => Math.min(a + 0.55, 1.8))
    setTimeout(() => setActivity(a => Math.max(a - 0.25, 0.35)), 900)
  }, [])

  const loadConfig = useCallback(async () => {
    const c = await window.sb.getConfig()
    setConfig(c)
  }, [])

  useEffect(() => {
    loadConfig()
    window.sb.authState?.().then(setAuthState).catch(() => setAuthState({ needsSetup: false, user: { id: 0, email: 'local', name: 'Local' } }))
  }, [loadConfig])

  useEffect(() => {
    const offJob = window.sb.onJob?.((e: Job) => {
      setJob(e)
      pulse()
      if (e.phase === 'done' && e.summary) toast(`${e.name}: ${e.summary}`, 'success')
      if (e.phase === 'error' && e.summary) toast(`${e.name}: ${e.summary}`, 'error')
    })
    const offAct = window.sb.onActivityPush?.(() => pulse())
    return () => { offJob?.(); offAct?.() }
  }, [pulse, toast])

  useEffect(() => {
    const refreshPending = () => window.sb.automationPending?.().then((p: any[]) => setPendingCount(p?.length ?? 0)).catch(() => {})
    refreshPending()
    const t = setInterval(refreshPending, 15000)
    return () => clearInterval(t)
  }, [view])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette(v => !v)
      }
      if (e.key === 'Escape') setPalette(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!palette) return
    const handle = setTimeout(async () => {
      if (query.trim().length < 2) { setHits([]); return }
      const found = await window.sb.brainSearch(query).catch(() => [])
      setHits(found ?? [])
    }, 180)
    return () => clearTimeout(handle)
  }, [query, palette])

  const openHit = async (hit: Hit) => {
    const content = await window.sb.brainMemoryFile(hit.path).catch(() => '')
    setOpened({ path: hit.path, content: content ?? '' })
  }

  if (authState && !authState.user) {
    return (
      <Login
        needsSetup={authState.needsSetup}
        googleConfigured={!!(config?.auth?.googleClientId && config?.auth?.googleClientSecret)}
        onDone={async () => {
          const s = await window.sb.authState()
          setAuthState(s)
          await loadConfig()
        }}
      />
    )
  }

  if (!config) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
        <div style={{ textAlign: 'center' }}>
          <BrainMark size={64} />
          <p className="dim" style={{ marginTop: 18, fontFamily: 'var(--mono)', letterSpacing: '.12em', fontSize: 12 }}>
            Abrindo o KeepMind…
          </p>
        </div>
      </div>
    )
  }

  if (!config.onboardingDone) {
    return (
      <>
        <NeuralField activity={0.7} />
        <Wizard config={config} onDone={loadConfig} onToast={toast} />
        <ToastWrap toasts={toasts} onDismiss={id => setToasts(t => t.filter(x => x.id !== id))} />
      </>
    )
  }

  const jobLine = job?.phase === 'start'
    ? `Agora: ${job.name}`
    : job?.summary
      ? `${job.name}: ${job.summary}`
      : 'O cérebro está acordado. Nenhum trabalho em curso.'

  return (
    <div className="app">
      <NeuralField activity={activity} />

      <aside className="sidebar">
        <div className="brand">
          <BrainMark size={36} />
          <div className="brand__name">keep<em>mind</em></div>
        </div>
        <nav className="nav">
          {NAV.map(n => (
            <button
              key={n.id}
              className={`nav__item ${view === n.id ? 'is-active' : ''}`}
              onClick={() => setView(n.id)}
            >
              <span className="ico"><n.Icon size={17} /></span>
              <span className="nav__label">{n.label}</span>
              {n.id === 'automations' && pendingCount > 0 && <span className="nav__badge">{pendingCount}</span>}
            </button>
          ))}
        </nav>
        <button className="status-pill" onClick={() => setPalette(true)} style={{ width: '100%', cursor: 'pointer' }}>
          <span>Buscar na memória</span>
          <span className="mono" style={{ marginLeft: 'auto' }}>Ctrl K</span>
        </button>
        <div className="sidebar__foot">
          <div className="status-pill" title={jobLine}>
            <span className={`dot ${job?.phase === 'error' ? 'off' : ''}`} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{jobLine}</span>
          </div>
          <div className="status-pill">
            <span className={`dot ${config?.github?.repoUrl ? '' : 'off'}`} />
            <span>{config?.github?.repoUrl ? 'Repositório ligado' : 'Repositório desligado'}</span>
          </div>
          <div className="status-pill">
            <span className={`dot ${config?.ai?.provider === 'local' || config?.ai?.apiKey ? '' : 'off'}`} />
            <span>Modelo · {config?.ai?.provider ?? '—'}</span>
          </div>
        </div>
      </aside>

      <nav className="mobile-nav">
        {NAV.map(n => (
          <button
            key={n.id}
            className={`mobile-nav__item ${view === n.id ? 'is-active' : ''}`}
            onClick={() => setView(n.id)}
            aria-label={n.label}
            title={n.label}
          >
            <n.Icon size={18} />
            <span className="mobile-nav__label">{n.label}</span>
          </button>
        ))}
      </nav>

      <main className="main" style={{ zIndex: 1 }}>
        {view === 'today' && <Today onToast={toast} />}
        {view === 'dashboard' && <Dashboard onActivity={pulse} onToast={toast} />}
        {view === 'chat' && <Chat onActivity={pulse} />}
        {view === 'graph' && <GraphView />}
        {view === 'activity' && <Activity />}
        {view === 'connectors' && <Connectors onActivity={pulse} onToast={toast} />}
        {view === 'automations' && <Automations onActivity={pulse} onToast={toast} />}
        {view === 'settings' && <Settings onToast={toast} onActivity={pulse} />}
      </main>

      {palette && (
        <div className="palette-back" onClick={() => setPalette(false)}>
          <div className="palette" onClick={e => e.stopPropagation()}>
            <input
              autoFocus
              value={query}
              onChange={e => { setQuery(e.target.value); setOpened(null) }}
              placeholder="Buscar nota, fato, tarefa, relatório…"
            />
            <div className="palette__list">
              {hits.map(h => (
                <button key={h.path} className="palette__hit" onClick={() => openHit(h)}>
                  <strong>{h.title}</strong>
                  <span className="mono faint">{h.path}</span>
                </button>
              ))}
              {query.trim().length >= 2 && hits.length === 0 && <p className="dim" style={{ padding: 12 }}>Nada com esse texto.</p>}
            </div>
            {opened && (
              <div className="palette__file">
                <div className="mono faint">{opened.path}</div>
                <pre>{opened.content.slice(0, 4000)}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      <ToastWrap toasts={toasts} onDismiss={id => setToasts(t => t.filter(x => x.id !== id))} />
    </div>
  )
}

function ToastWrap({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast--${t.kind === 'error' ? 'error' : t.kind === 'success' ? 'success' : ''}`}>
          <span style={{ flex: 1 }}>{t.msg}</span>
          <button className="toast__x" aria-label="Fechar" onClick={() => onDismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  )
}
