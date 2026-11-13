import { useEffect, useState } from 'react'
import { IconPlus, IconTrash } from './icons'
import { buildAgentCatalog, buildConnectPrompt, type AgentCard, type ConnectInfo } from '../lib/connectPrompt'

interface Props {
  onActivity?: () => void
  onToast: (m: string, k?: 'info' | 'error' | 'success') => void
}

const HIDDEN_KINDS = new Set(['whatsapp', 'telegram'])

export default function Connectors({ onActivity, onToast }: Props) {
  const [info, setInfo] = useState<ConnectInfo | null>(null)
  const [config, setConfig] = useState<any>(null)
  const [status, setStatus] = useState<any>({ running: [], allTools: [] })
  const [showCustom, setShowCustom] = useState(false)
  const [custom, setCustom] = useState({ name: '', command: '', args: '' })
  const [open, setOpen] = useState<string | null>(null)
  const [copied, setCopied] = useState('')

  const refresh = async () => {
    const [c, s, i] = await Promise.all([
      window.sb.getConfig(), window.sb.mcpStatus(), window.sb.connectInfo().catch(() => null)
    ])
    setConfig(c); setStatus(s); if (i) setInfo(i)
  }

  useEffect(() => { refresh() }, [])

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(c => c === key ? '' : c), 1600)
    } catch {
      onToast('Copy failed — select the text manually', 'error')
    }
  }

  const toggle = async (srv: any) => {
    onActivity?.()
    try {
      if (status.running.includes(srv.id)) {
        await window.sb.mcpStop(srv.id)
        await window.sb.updateMcp(srv.id, { enabled: false })
      } else {
        await window.sb.updateMcp(srv.id, { enabled: true })
        const res = await window.sb.mcpStart(srv.id)
        onToast(`${srv.name}: ${res.tools.length} tools active`, 'success')
      }
      await refresh()
    } catch (e: any) {
      onToast(`${srv.name}: ${e?.message ?? e}`, 'error')
    }
  }

  const addCustom = async () => {
    if (!custom.name.trim() || !custom.command.trim()) {
      onToast('Name and command are required', 'error'); return
    }
    const id = `custom-${Date.now()}`
    const args = custom.args.trim() ? custom.args.trim().split(/\s+/) : []
    const cfg = await window.sb.getConfig()
    const servers = [...(cfg.mcpServers ?? []), {
      id, name: custom.name.trim(), kind: 'custom', enabled: false,
      command: custom.command.trim(), args
    }]
    await window.sb.setConfig({ mcpServers: servers })
    setShowCustom(false)
    setCustom({ name: '', command: '', args: '' })
    await refresh()
    onToast('Custom MCP server added — click Connect to start it', 'success')
  }

  const removeCustom = async (srv: any) => {
    const cfg = await window.sb.getConfig()
    await window.sb.setConfig({ mcpServers: (cfg.mcpServers ?? []).filter((s: any) => s.id !== srv.id) })
    await window.sb.mcpStop(srv.id).catch(() => {})
    await refresh()
  }

  const agents: AgentCard[] = info ? buildAgentCatalog(info) : []
  const servers = (config?.mcpServers ?? []).filter((s: any) => !HIDDEN_KINDS.has(s.kind))
  const promptText = info?.repoUrl ? buildConnectPrompt(info.repoUrl) : ''

  const renderSnippet = (a: AgentCard, sn: { label: string; language: string; content: string }) => (
    <div key={sn.label} style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span className="faint mono" style={{ fontSize: 10.5 }}>{sn.label}</span>
        <button className="btn btn--ghost btn--sm" onClick={() => copy(`${a.id}:${sn.label}`, sn.content)}>
          {copied === `${a.id}:${sn.label}` ? '✓ copied' : '⧉ copy'}
        </button>
      </div>
      <pre className="mono" style={{
        fontSize: 11, lineHeight: 1.5, padding: '10px 12px', borderRadius: 8,
        background: 'rgba(3,7,18,.75)', border: '1px solid var(--line)',
        overflowX: 'auto', whiteSpace: 'pre', margin: 0, color: '#b8d4ec'
      }}>{sn.content}</pre>
    </div>
  )

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>Connect</div>
          <h1>Conecte seus agentes</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>
            Conecte sua aplicação de IA para que os agentes consultem e registrem contexto. Confira os registros e as fontes em Hoje e Atividade.
          </p>
        </div>
        <button className="btn" onClick={() => setShowCustom(s => !s)}>
          <IconPlus size={12} /> CUSTOM MCP
        </button>
      </div>

      <p className="dim">As instruções abaixo não confirmam uma conexão ativa. Após configurar sua aplicação, peça ao agente para consultar a memória e confira o resultado. A proteção e as permissões são gerenciadas em Configurações.</p>
      {!info && <p className="faint" style={{ fontSize: 13 }}>Carregando instruções de conexão…</p>}

      <div className="grid" style={{ maxWidth: 980 }}>
        {agents.map(a => (
          <div key={a.id} className="card card-pad">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <h3>{a.name}</h3>
                  <span className="badge badge--custom" style={{ fontSize: 9.5 }}>{a.tag}</span>
                </div>
                <div className="faint mono" style={{ fontSize: 10.5, marginTop: 3 }}>{a.where}</div>
              </div>
              {a.prompt && (
                <button
                  className="btn btn--sm btn--primary"
                  disabled={!promptText}
                  title={promptText ? 'Copy the connect prompt for this agent' : 'Connect GitHub first to generate the prompt'}
                  onClick={() => copy(`${a.id}:prompt`, promptText)}
                >
                  {copied === `${a.id}:prompt` ? '✓ copied' : '⧉ prompt'}
                </button>
              )}
            </div>
            <p className="faint" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.5 }}>{a.blurb}</p>
            {a.note && <p className="faint" style={{ fontSize: 11.5, marginTop: 6, fontStyle: 'italic' }}>{a.note}</p>}

            {a.snippets.length > 0 && (
              <button
                className="btn btn--ghost btn--sm"
                style={{ marginTop: 10, fontSize: 11 }}
                onClick={() => setOpen(o => o === a.id ? null : a.id)}
              >
                {open === a.id ? '▾ hide config' : '▸ show config'}
              </button>
            )}
            {open === a.id && a.snippets.map(sn => renderSnippet(a, sn))}
          </div>
        ))}
      </div>

      {showCustom && (
        <div className="card card-pad" style={{ marginTop: 20, maxWidth: 860 }}>
          <h2 style={{ marginBottom: 12 }}>Add custom MCP server</h2>
          <div className="grid grid-3">
            <div className="field">
              <label>Name</label>
              <input value={custom.name} onChange={e => setCustom(c => ({ ...c, name: e.target.value }))} placeholder="e.g. Gmail MCP" />
            </div>
            <div className="field">
              <label>Command</label>
              <input value={custom.command} onChange={e => setCustom(c => ({ ...c, command: e.target.value }))} placeholder="npx / node / uvx" className="mono" />
            </div>
            <div className="field">
              <label>Args</label>
              <input value={custom.args} onChange={e => setCustom(c => ({ ...c, args: e.target.value }))} placeholder="-y @scope/mcp-server" className="mono" />
            </div>
          </div>
          <button className="btn btn--primary" onClick={addCustom}>ADD CONNECTOR</button>
        </div>
      )}

      {servers.length > 0 && (
        <div style={{ marginTop: 24, maxWidth: 980 }}>
          <div className="hud-tag" style={{ marginBottom: 10 }}>CUSTOM MCP SERVERS</div>
          <div className="grid">
            {servers.map((srv: any) => {
              const running = status.running.includes(srv.id)
              const isCustom = srv.kind === 'custom'
              return (
                <div key={srv.id} className="card card-pad">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <span className="conn-emoji" style={{ fontSize: 26 }}>{isCustom ? '🔌' : '🐘'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <h3 style={{ fontSize: 15 }}>{srv.name}</h3>
                        {isCustom && <span className="badge badge--custom">custom</span>}
                        <span className="m-status" style={{
                          fontSize: 11, fontFamily: 'var(--mono)', padding: '3px 10px', borderRadius: 20,
                          border: '1px solid', borderColor: running ? 'rgba(52,211,153,.4)' : 'var(--line)',
                          color: running ? 'var(--green)' : 'var(--text-faint)'
                        }}>
                          {running ? '● connected' : '○ offline'}
                        </span>
                      </div>
                      {isCustom && (
                        <div className="faint mono" style={{ fontSize: 11, marginTop: 6, wordBreak: 'break-all' }}>
                          {srv.command} {(srv.args ?? []).join(' ')}
                        </div>
                      )}
                      {running && (
                        <div className="faint mono" style={{ fontSize: 11, marginTop: 6 }}>
                          {status.allTools.filter((t: any) => t.serverId === srv.id).map((t: any) => t.name).join(' · ') || 'starting…'}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                      <select
                        value={srv.permission ?? 'allow'}
                        title="Permission: allow = may auto-start · ask = manual connect only · block = never runs"
                        onChange={async e => {
                          await window.sb.updateMcp(srv.id, { permission: e.target.value })
                          await refresh()
                        }}
                        style={{
                          background: 'rgba(3,7,18,.7)', color: 'var(--text)', border: '1px solid var(--line)',
                          borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 10, padding: '6px 6px'
                        }}
                      >
                        <option value="allow">⚡ allow</option>
                        <option value="ask">⏳ ask</option>
                        <option value="block">⛔ block</option>
                      </select>
                      <button className={`btn btn--sm ${running ? 'btn--danger' : 'btn--primary'}`} onClick={() => toggle(srv)}>
                        {running ? 'Disconnect' : 'Connect'}
                      </button>
                      {isCustom && (
                        <button className="btn btn--ghost btn--sm" onClick={() => removeCustom(srv)} title="Remove">
                          <IconTrash size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                  {!running && !isCustom && (
                    <input
                      placeholder="postgres://user:pass@host:5432/db"
                      className="mono"
                      style={{ marginTop: 12, width: '100%', maxWidth: 520, background: 'rgba(3,7,18,.7)', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)', fontSize: 12.5 }}
                      onKeyDown={async e => {
                        if (e.key === 'Enter') {
                          const v = (e.target as HTMLInputElement).value.trim()
                          if (!v) return
                          try {
                            await window.sb.updateMcp(srv.id, { env: { DATABASE_URL: v }, enabled: true })
                            const res = await window.sb.mcpStart(srv.id)
                            onToast(`${srv.name}: ${res.tools.length} tools active`, 'success')
                            await refresh()
                          } catch (err: any) {
                            onToast(`${srv.name}: ${err?.message ?? err}`, 'error')
                          }
                        }
                      }}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
