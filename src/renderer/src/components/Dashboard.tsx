import { useEffect, useState } from 'react'
import BrainCore from './BrainCore'
import { IconSparkle, IconDoc, IconGithub, IconMoon } from './icons'
import { buildConnectPrompt } from '../lib/connectPrompt'

export default function Dashboard({ onActivity }: { onActivity?: () => void }) {
  const [insights, setInsights] = useState<any[]>([])
  const [summaries, setSummaries] = useState<any[]>([])
  const [memory, setMemory] = useState<any[]>([])
  const [config, setConfig] = useState<any>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [tiers, setTiers] = useState<any>(null)
  const [sync, setSync] = useState<any>(null)
  const [sleeping, setSleeping] = useState(false)

  const refresh = async () => {
    const [i, s, m, c, t, sy] = await Promise.all([
      window.sb.brainListInsights(),
      window.sb.brainListSummaries(),
      window.sb.brainListMemory(),
      window.sb.getConfig(),
      window.sb.brainMemoryTiers?.() ?? Promise.resolve(null),
      window.sb.syncStatus?.() ?? Promise.resolve(null)
    ])
    setInsights(i); setSummaries(s); setMemory(m); setConfig(c); setTiers(t); setSync(sy)
  }

  useEffect(() => { refresh() }, [])

  const genInsights = async () => {
    setBusy('insights'); onActivity?.()
    try { await window.sb.brainInsights(); await refresh() }
    catch (e: any) { alert(e?.message ?? e) }
    finally { setBusy(null) }
  }

  const genSummary = async () => {
    setBusy('summary'); onActivity?.()
    try { await window.sb.brainDailySummary(); await refresh() }
    catch (e: any) { alert(e?.message ?? e) }
    finally { setBusy(null) }
  }

  const sleepNow = async () => {
    setSleeping(true); onActivity?.()
    try { await window.sb.brainSleep(); await refresh() }
    catch (e: any) { alert(e?.message ?? e) }
    finally { setSleeping(false) }
  }

  const pushGitHub = async () => {
    setBusy('push')
    try {
      const r = await window.sb.ghPushMemory('sync: memory update')
      alert(`Synced: ${r.pushed} files → GitHub`)
    } catch (e: any) { alert(e?.message ?? e) }
    finally { setBusy(null) }
  }

  const latestInsight = insights[0]
  const latestSummary = summaries[0]

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>ACTIVE BRAIN · {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
          <h1 style={{ textShadow: '0 0 24px rgba(34,211,238,.35)' }}>SECOND BRAIN</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>
            {config?.github?.repoUrl
              ? <>memory persisted at <span className="mono" style={{ color: 'var(--cyan)' }}>{config.github.repoUrl}</span></>
              : 'connect GitHub in the wizard to activate persistent memory.'}
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={genInsights} disabled={!!busy}>
            {busy === 'insights' ? 'WORKING…' : <><IconSparkle size={12} /> GENERATE INSIGHTS</>}
          </button>
          <button className="btn" onClick={genSummary} disabled={!!busy}>
            {busy === 'summary' ? 'WORKING…' : <><IconDoc size={12} /> DAILY SUMMARY</>}
          </button>
          <button className="btn btn--ghost" onClick={pushGitHub} disabled={!!busy || !config?.github?.repoUrl}>
            {busy === 'push' ? '…' : '⇪ SYNC GITHUB'}
          </button>
          <button
            className="btn"
            style={{ borderColor: 'rgba(250,204,21,.4)', color: '#fde047' }}
            onClick={sleepNow}
            disabled={sleeping}
            title="Nightly learning cycle — reviews the day, extracts facts/lessons/skills to long-term memory"
          >
            <IconMoon size={12} /> {sleeping ? 'DREAMING…' : 'SLEEP'}
          </button>
        </div>
      </div>

      {/* Neural core stage */}
      <div className="brain-stage" style={{ marginBottom: 20 }}>
        <BrainCore activity={0.55} />
        <div className="orbit-chip orbit-chip--lime" style={{ top: '14%', left: '8%', animationDelay: '0s' }}>
          memories <b>{memory.length}</b>
        </div>
        <div className="orbit-chip orbit-chip--amber" style={{ top: '22%', right: '9%', animationDelay: '1.4s' }}>
          insights <b>{insights.length}</b>
        </div>
        <div className="orbit-chip" style={{ bottom: '24%', left: '12%', animationDelay: '2.6s' }}>
          summaries <b>{summaries.length}</b>
        </div>
        <div className="orbit-chip orbit-chip--violet" style={{ bottom: '30%', right: '11%', animationDelay: '.8s' }}>
          ia <b>{config?.ai?.provider ?? '—'}</b>
        </div>
        <div className="orbit-chip orbit-chip--lime" style={{ top: '48%', left: '3%', animationDelay: '3.4s' }}>
          {config?.github?.repoUrl ? 'github linked' : 'github offline'}
        </div>
        <div className="brain-label">synaptic cortex · keepmind</div>
      </div>

      {/* Connect your AI */}
      <div className="card card-pad" style={{ marginBottom: 20, borderColor: 'rgba(163,230,53,.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <IconGithub size={15} /> Plug in your AI
            </h2>
            <p className="faint" style={{ fontSize: 12.5, marginTop: 4, maxWidth: 560, lineHeight: 1.6 }}>
              Copy one prompt into Claude, Codex, Grok, Gemini or ChatGPT — it teaches that AI to read
              and write memory in <strong>your</strong> GitHub repo. Emails sent, PDFs created,
              decisions, insights — everything gets remembered.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn--ghost" onClick={() => setPromptOpen(o => !o)}>
              {promptOpen ? 'Hide prompt' : 'Show prompt'}
            </button>
            <button
              className="btn btn--primary"
              disabled={!config?.github?.repoUrl}
              onClick={async () => {
                await navigator.clipboard.writeText(buildConnectPrompt(config?.github?.repoUrl))
                setCopied(true); setTimeout(() => setCopied(false), 2000)
              }}
            >
              {copied ? '✓ Copied!' : '⧉ Copy prompt'}
            </button>
          </div>
        </div>
        {promptOpen && (
          <pre className="mono" style={{
            marginTop: 16, padding: 16, borderRadius: 10, fontSize: 11.5, lineHeight: 1.65,
            background: 'rgba(3,7,18,.8)', border: '1px solid var(--line)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 340, overflowY: 'auto',
            color: 'var(--text-dim)'
          }}>
            {buildConnectPrompt(config?.github?.repoUrl)}
          </pre>
        )}
        {!config?.github?.repoUrl && (
          <p className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>
            Connect GitHub first (Settings → re-run setup) to generate a prompt with your real repo URL.
          </p>
        )}
      </div>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <div className="card stat"><div className="stat__num">{memory.length}</div><div className="stat__label">MEMORY FILES</div></div>
        <div className="card stat"><div className="stat__num">{insights.length}</div><div className="stat__label">INSIGHTS SAVED</div></div>
        <div className="card stat"><div className="stat__num">{summaries.length}</div><div className="stat__label">DAILY SUMMARIES</div></div>
        <div className="card stat">
          <div className="stat__num" style={{ fontSize: 15, paddingTop: 6 }}>{config?.ai?.provider ?? '—'}</div>
          <div className="stat__label">AI PROVIDER{config?.ai?.model ? ` · ${config.ai.model}` : ''}</div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card card-pad">
          <h2>Latest insights</h2>
          {latestInsight ? (
            <div style={{ marginTop: 14 }}>
              <div className="faint mono" style={{ fontSize: 11, marginBottom: 10 }}>{latestInsight.date}</div>
              <div className="msg__body" style={{ fontSize: 13 }} dangerouslySetInnerHTML={{ __html: md(latestInsight.content) }} />
            </div>
          ) : (
            <p className="faint" style={{ fontSize: 13, marginTop: 14, lineHeight: 1.6 }}>
              No insights yet. Chat with the brain, then hit "Generate insights" —
              it analyzes your memory and surfaces what matters.
            </p>
          )}
          {insights.length > 1 && (
            <details style={{ marginTop: 14 }}>
              <summary className="faint" style={{ fontSize: 12, cursor: 'pointer' }}>Show earlier ({insights.length - 1})</summary>
              {insights.slice(1).map((i: any) => (
                <div key={i.date} style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                  <div className="faint mono" style={{ fontSize: 11, marginBottom: 6 }}>{i.date}</div>
                  <div className="msg__body" style={{ fontSize: 12.5 }} dangerouslySetInnerHTML={{ __html: md(i.content) }} />
                </div>
              ))}
            </details>
          )}
        </div>

        <div className="card card-pad">
          <h2>Latest summary</h2>
          {latestSummary ? (
            <div style={{ marginTop: 14 }}>
              <div className="faint mono" style={{ fontSize: 11, marginBottom: 10 }}>{latestSummary.date}</div>
              <div className="msg__body" style={{ fontSize: 13 }} dangerouslySetInnerHTML={{ __html: md(latestSummary.content) }} />
            </div>
          ) : (
            <p className="faint" style={{ fontSize: 13, marginTop: 14, lineHeight: 1.6 }}>
              No summaries yet. The daily summary consolidates what happened in your KeepMind.
            </p>
          )}
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h2>
          Memory ({memory.length} files)
          {tiers && (
            <span className="faint mono" style={{ fontSize: 10.5, fontWeight: 400, marginLeft: 10 }}>
              short {tiers.shortTerm} · medium {tiers.mediumTerm} · long {tiers.longTerm} · sleep {tiers.sleepCycles}
            </span>
          )}
          {sync?.connected && (
            <span className="faint mono" style={{ fontSize: 10.5, fontWeight: 400, marginLeft: 10, color: sync.pending ? 'var(--amber)' : 'var(--lime)' }}>
              {sync.syncing ? '↻ syncing…' : sync.pending ? `⇡ ${sync.pending} to push` : '✓ github synced'}
            </span>
          )}
        </h2>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
          {memory.slice(0, 60).map((m: any) => (
            <details key={m.path} className="insight-item" style={{ cursor: 'pointer' }}>
              <summary style={{ flex: 1, listStyle: 'none' }}>
                <span className="mono" style={{ fontSize: 12 }}>{m.path}</span>
              </summary>
              <div className="msg__body" style={{ fontSize: 12, marginTop: 10, whiteSpace: 'pre-wrap' }}>{m.content.slice(0, 2000)}</div>
            </details>
          ))}
          {memory.length === 0 && <p className="faint" style={{ fontSize: 13 }}>Memory starts being written as you chat.</p>}
        </div>
      </div>
    </div>
  )
}

function md(s: string) {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- /gm, '• ')
    .replace(/\n/g, '<br/>')
}
