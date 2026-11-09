import { useCallback, useEffect, useState } from 'react'
import NeuralField from './components/NeuralField'
import { BrainMark, IconDashboard, IconChat, IconPlug, IconSettings, IconClock, IconSparkle, IconSync, IconDoc } from './components/icons'
import Wizard from './components/Wizard'
import Chat from './components/Chat'
import Dashboard from './components/Dashboard'
import Connectors from './components/Connectors'
import Automations from './components/Automations'
import Settings from './components/Settings'
import GraphView from './components/GraphView'
import Activity from './components/Activity'
import Skills from './components/Skills'
import Login from './components/Login'

type View = 'graph' | 'dashboard' | 'skills' | 'chat' | 'activity' | 'connectors' | 'automations' | 'settings'

interface Toast { id: number; msg: string; kind: 'info' | 'error' | 'success' }

const NAV: { id: View; label: string; Icon: (p: { size?: number }) => JSX.Element }[] = [
  { id: 'graph', label: 'Brain', Icon: IconSparkle },
  { id: 'dashboard', label: 'Health', Icon: IconDashboard },
  { id: 'skills', label: 'Skills', Icon: IconDoc },
  { id: 'chat', label: 'Chat', Icon: IconChat },
  { id: 'activity', label: 'Activity', Icon: IconSync },
  { id: 'connectors', label: 'Agents', Icon: IconPlug },
  { id: 'automations', label: 'Automations', Icon: IconClock },
  { id: 'settings', label: 'Settings', Icon: IconSettings }
]

export default function App() {
  const [config, setConfig] = useState<any>(null)
  const [view, setView] = useState<View>('graph')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [activity, setActivity] = useState(0)
  const [authState, setAuthState] = useState<{ needsSetup: boolean; user: any } | null>(null)

  const toast = useCallback((msg: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, msg, kind }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000)
  }, [])

  const pulse = useCallback(() => {
    setActivity(a => Math.min(a + 0.35, 1.5))
    setTimeout(() => setActivity(a => Math.max(a - 0.35, 0)), 400)
  }, [])

  const loadConfig = useCallback(async () => {
    const c = await window.sb.getConfig()
    setConfig(c)
  }, [])

  useEffect(() => {
    loadConfig()
    window.sb.authState?.().then(setAuthState).catch(() => setAuthState({ needsSetup: false, user: { id: 0, email: 'local', name: 'Local' } }))
  }, [loadConfig])

  // decay neural activity
  useEffect(() => {
    const t = setInterval(() => setActivity(a => Math.max(0, a - 0.04)), 200)
    return () => clearInterval(t)
  }, [])

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
          <p className="dim" style={{ marginTop: 18, fontFamily: 'var(--mono)', letterSpacing: '.15em', fontSize: 11, textTransform: 'uppercase' }}>
            booting keepmind…
          </p>
        </div>
      </div>
    )
  }

  if (!config.onboardingDone) {
    return (
      <>
        <NeuralField activity={0.4} />
        <Wizard config={config} onDone={loadConfig} onToast={toast} />
        <ToastWrap toasts={toasts} onDismiss={id => setToasts(t => t.filter(x => x.id !== id))} />
      </>
    )
  }

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
            </button>
          ))}
        </nav>
        <div className="sidebar__foot">
          <div className="status-pill">
            <span className={`dot ${config?.github?.repoUrl ? '' : 'off'}`} />
            <span>{config?.github?.repoUrl ? 'github linked' : 'github offline'}</span>
          </div>
          <div className="status-pill">
            <span className={`dot ${config?.ai?.provider === 'local' || config?.ai?.apiKey ? '' : 'off'}`} />
            <span>ai · {config?.ai?.provider ?? '—'}</span>
          </div>
        </div>
      </aside>

      {/* mobile bottom nav */}
      <nav className="mobile-nav">
        {NAV.map(n => (
          <button
            key={n.id}
            className={`mobile-nav__item ${view === n.id ? 'is-active' : ''}`}
            onClick={() => setView(n.id)}
            aria-label={n.label}
            title={n.label}
          >
            <n.Icon size={19} />
          </button>
        ))}
      </nav>

      <main className="main" style={{ zIndex: 1 }}>
        {view === 'dashboard' && <Dashboard onActivity={pulse} onToast={toast} />}
        {view === 'skills' && <Skills onActivity={pulse} onToast={toast} />}
        {view === 'chat' && <Chat onActivity={pulse} />}
        {view === 'graph' && <GraphView />}
        {view === 'activity' && <Activity />}
        {view === 'connectors' && <Connectors onActivity={pulse} onToast={toast} />}
        {view === 'automations' && <Automations onActivity={pulse} onToast={toast} />}
        {view === 'settings' && <Settings onToast={toast} onActivity={pulse} />}
      </main>

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
          <button className="toast__x" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  )
}
