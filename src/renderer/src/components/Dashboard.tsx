import { useEffect, useState } from 'react'
import BrainCore from './BrainCore'
import { IconSparkle, IconDoc } from './icons'

export default function Dashboard({ onActivity }: { onActivity?: () => void }) {
  const [insights, setInsights] = useState<any[]>([])
  const [summaries, setSummaries] = useState<any[]>([])
  const [memory, setMemory] = useState<any[]>([])
  const [config, setConfig] = useState<any>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = async () => {
    const [i, s, m, c] = await Promise.all([
      window.sb.brainListInsights(),
      window.sb.brainListSummaries(),
      window.sb.brainListMemory(),
      window.sb.getConfig()
    ])
    setInsights(i); setSummaries(s); setMemory(m); setConfig(c)
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

  const pushGitHub = async () => {
    setBusy('push')
    try {
      const r = await window.sb.ghPushMemory('sync: memory update')
      alert(`Sincronizado: ${r.pushed} arquivos → GitHub`)
    } catch (e: any) { alert(e?.message ?? e) }
    finally { setBusy(null) }
  }

  const latestInsight = insights[0]
  const latestSummary = summaries[0]

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>CÉREBRO ATIVO · {new Date().toLocaleDateString('pt-BR')}</div>
          <h1 style={{ textShadow: '0 0 24px rgba(34,211,238,.35)' }}>SECOND BRAIN</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>
            {config?.github?.repoUrl
              ? <>memória persistida em <span className="mono" style={{ color: 'var(--cyan)' }}>{config.github.repoUrl}</span></>
              : 'conecte o GitHub no wizard para ativar a memória persistente.'}
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={genInsights} disabled={!!busy}>
            {busy === 'insights' ? 'GERANDO…' : <><IconSparkle size={12} /> GERAR INSIGHTS</>}
          </button>
          <button className="btn" onClick={genSummary} disabled={!!busy}>
            {busy === 'summary' ? 'GERANDO…' : <><IconDoc size={12} /> RESUMO DO DIA</>}
          </button>
          <button className="btn btn--ghost" onClick={pushGitHub} disabled={!!busy || !config?.github?.repoUrl}>
            {busy === 'push' ? '…' : '⇪ SYNC GITHUB'}
          </button>
        </div>
      </div>

      {/* Neural core stage */}
      <div className="brain-stage" style={{ marginBottom: 20 }}>
        <BrainCore activity={0.55} />
        <div className="orbit-chip orbit-chip--lime" style={{ top: '14%', left: '8%', animationDelay: '0s' }}>
          memórias <b>{memory.length}</b>
        </div>
        <div className="orbit-chip orbit-chip--amber" style={{ top: '22%', right: '9%', animationDelay: '1.4s' }}>
          insights <b>{insights.length}</b>
        </div>
        <div className="orbit-chip" style={{ bottom: '24%', left: '12%', animationDelay: '2.6s' }}>
          resumos <b>{summaries.length}</b>
        </div>
        <div className="orbit-chip orbit-chip--violet" style={{ bottom: '30%', right: '11%', animationDelay: '.8s' }}>
          ia <b>{config?.ai?.provider ?? '—'}</b>
        </div>
        <div className="orbit-chip orbit-chip--lime" style={{ top: '48%', left: '3%', animationDelay: '3.4s' }}>
          {config?.github?.repoUrl ? 'github linkado' : 'github offline'}
        </div>
        <div className="brain-label">córtex sináptico · segundo brain</div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <div className="card stat"><div className="stat__num">{memory.length}</div><div className="stat__label">ARQUIVOS DE MEMÓRIA</div></div>
        <div className="card stat"><div className="stat__num">{insights.length}</div><div className="stat__label">INSIGHTS SALVOS</div></div>
        <div className="card stat"><div className="stat__num">{summaries.length}</div><div className="stat__label">RESUMOS DIÁRIOS</div></div>
        <div className="card stat">
          <div className="stat__num" style={{ fontSize: 15, paddingTop: 6 }}>{config?.ai?.provider ?? '—'}</div>
          <div className="stat__label">PROVIDER DE IA{config?.ai?.model ? ` · ${config.ai.model}` : ''}</div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card card-pad">
          <h2>Últimos insights</h2>
          {latestInsight ? (
            <div style={{ marginTop: 14 }}>
              <div className="faint mono" style={{ fontSize: 11, marginBottom: 10 }}>{latestInsight.date}</div>
              <div className="msg__body" style={{ fontSize: 13 }} dangerouslySetInnerHTML={{ __html: md(latestInsight.content) }} />
            </div>
          ) : (
            <p className="faint" style={{ fontSize: 13, marginTop: 14, lineHeight: 1.6 }}>
              Nenhum insight ainda. Converse com o cérebro e clique em "Gerar insights" —
              ele analisa sua memória e aponta o que importa.
            </p>
          )}
          {insights.length > 1 && (
            <details style={{ marginTop: 14 }}>
              <summary className="faint" style={{ fontSize: 12, cursor: 'pointer' }}>Ver anteriores ({insights.length - 1})</summary>
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
          <h2>Resumo mais recente</h2>
          {latestSummary ? (
            <div style={{ marginTop: 14 }}>
              <div className="faint mono" style={{ fontSize: 11, marginBottom: 10 }}>{latestSummary.date}</div>
              <div className="msg__body" style={{ fontSize: 13 }} dangerouslySetInnerHTML={{ __html: md(latestSummary.content) }} />
            </div>
          ) : (
            <p className="faint" style={{ fontSize: 13, marginTop: 14, lineHeight: 1.6 }}>
              Sem resumos ainda. O resumo diário consolida o que aconteceu no seu segundo brain.
            </p>
          )}
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h2>Memória ({memory.length} arquivos)</h2>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
          {memory.slice(0, 60).map((m: any) => (
            <details key={m.path} className="insight-item" style={{ cursor: 'pointer' }}>
              <summary style={{ flex: 1, listStyle: 'none' }}>
                <span className="mono" style={{ fontSize: 12 }}>{m.path}</span>
              </summary>
              <div className="msg__body" style={{ fontSize: 12, marginTop: 10, whiteSpace: 'pre-wrap' }}>{m.content.slice(0, 2000)}</div>
            </details>
          ))}
          {memory.length === 0 && <p className="faint" style={{ fontSize: 13 }}>A memória começa a ser gravada conforme você conversa.</p>}
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
