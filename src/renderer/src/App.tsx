import { useCallback, useEffect, useState } from 'react'
import BrainCore from './components/BrainCore'
import { BrainMark, IconDashboard, IconChat, IconAgents, IconPlug } from './components/icons'
import Wizard from './components/Wizard'
import Chat from './components/Chat'
import Dashboard from './components/Dashboard'
import Agents from './components/Agents'
import Connectors from './components/Connectors'

type View = 'dashboard' | 'chat' | 'agents' | 'connectors'

interface Agent { id: string; name: string; emoji: string; persona: string; builtin?: boolean }
interface Toast { id: number; msg: string; kind: 'info' | 'error' | 'success' }

const NAV: { id: View; label: string; Icon: (p: { size?: number }) => JSX.Element }[] = [
  { id: 'dashboard', label: 'Cérebro', Icon: IconDashboard },
  { id: 'chat', label: 'Conversar', Icon: IconChat },
  { id: 'agents', label: 'Agentes', Icon: IconAgents },
  { id: 'connectors', label: 'Conectores', Icon: IconPlug }
]

export default function App() {
  const [config, setConfig] = useState<any>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [view, setView] = useState<View>('dashboard')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [activity, setActivity] = useState(0)

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
    setAgents(c.agents ?? [])
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])

  // decay neural activity
  useEffect(() => {
    const t = setInterval(() => setActivity(a => Math.max(0, a - 0.04)), 200)
    return () => clearInterval(t)
  }, [])

  if (!config) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48 }}>🧠</div>
          <p className="dim" style={{ marginTop: 14 }}>Inicializando second brain…</p>
        </div>
      </div>
    )
  }

  if (!config.onboardingDone) {
    return (
      <>
        <BrainCore activity={0.4} className="brain-bg" />
        <Wizard config={config} onDone={loadConfig} onToast={toast} />
        <ToastWrap toasts={toasts} />
      </>
    )
  }

  return (
    <div className="app">
      <BrainCore activity={activity} className="brain-bg" />

      <aside className="sidebar">
        <div className="brand">
          <BrainMark size={36} />
          <div className="brand__name">second<em>brain</em></div>
        </div>
        <nav className="nav">
          {NAV.map(n => (
            <button
              key={n.id}
              className={`nav__item ${view === n.id ? 'is-active' : ''}`}
              onClick={() => setView(n.id)}
            >
              <span className="ico"><n.Icon size={17} /></span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar__foot">
          <div className="status-pill">
            <span className={`dot ${config?.github?.repoUrl ? '' : 'off'}`} />
            <span>{config?.github?.repoUrl ? 'GitHub conectado' : 'GitHub offline'}</span>
          </div>
          <div className="status-pill">
            <span className={`dot ${config?.ai?.provider === 'local' || config?.ai?.apiKey ? '' : 'off'}`} />
            <span>IA: {config?.ai?.provider ?? '—'}</span>
          </div>
        </div>
      </aside>

      <main className="main" style={{ zIndex: 1 }}>
        {view === 'dashboard' && <Dashboard onActivity={pulse} />}
        {view === 'chat' && <Chat agents={agents} onActivity={pulse} />}
        {view === 'agents' && <Agents agents={agents} onChanged={loadConfig} onToast={toast} />}
        {view === 'connectors' && <Connectors onActivity={pulse} onToast={toast} />}
      </main>

      <ToastWrap toasts={toasts} />
    </div>
  )
}

function ToastWrap({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast--${t.kind === 'error' ? 'error' : t.kind === 'success' ? 'success' : ''}`}>
          {t.msg}
        </div>
      ))}
    </div>
  )
}
