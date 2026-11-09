import { useEffect, useState } from 'react'
import { IconPlus, IconTrash } from './icons'

interface Props {
  onActivity?: () => void
  onToast: (m: string, k?: 'info' | 'error' | 'success') => void
}

export default function Connectors({ onActivity, onToast }: Props) {
  const [config, setConfig] = useState<any>(null)
  const [status, setStatus] = useState<any>({ running: [], allTools: [] })
  const [qrs, setQrs] = useState<Record<string, any>>({})
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [showCustom, setShowCustom] = useState(false)
  const [custom, setCustom] = useState({ name: '', command: '', args: '' })

  const refresh = async () => {
    const [c, s] = await Promise.all([window.sb.getConfig(), window.sb.mcpStatus()])
    setConfig(c); setStatus(s)
  }

  useEffect(() => { refresh() }, [])

  useEffect(() => {
    const t = setInterval(async () => {
      const [w, g] = await Promise.all([
        window.sb.whatsappQr().catch(() => null),
        window.sb.connectorQr?.('telegram').catch(() => null)
      ])
      setQrs({ whatsapp: w, telegram: g })
    }, 3000)
    return () => clearInterval(t)
  }, [])

  const toggle = async (srv: any) => {
    onActivity?.()
    try {
      if (status.running.includes(srv.id)) {
        await window.sb.mcpStop(srv.id)
        await window.sb.updateMcp(srv.id, { enabled: false })
      } else {
        const env: Record<string, string> = {}
        if (srv.kind === 'telegram' && inputs.telegram) env.TELEGRAM_BOT_TOKEN = inputs.telegram
        if (srv.kind === 'postgres' && inputs.postgres) env.DATABASE_URL = inputs.postgres
        if (Object.keys(env).length) await window.sb.updateMcp(srv.id, { env, enabled: true })
        else await window.sb.updateMcp(srv.id, { enabled: true })
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
    // persist via config patch — mcpServers lives inside config
    const cfg = await window.sb.getConfig()
    const servers = [...(cfg.mcpServers ?? []), {
      id, name: custom.name.trim(), kind: 'custom', enabled: false,
      command: custom.command.trim(), args
    }]
    await window.sb.setConfig({ mcpServers: servers })
    setShowCustom(false)
    setCustom({ name: '', command: '', args: '' })
    await refresh()
    onToast('Custom connector added — click Connect to start it', 'success')
  }

  const removeCustom = async (srv: any) => {
    const cfg = await window.sb.getConfig()
    await window.sb.setConfig({ mcpServers: (cfg.mcpServers ?? []).filter((s: any) => s.id !== srv.id) })
    await window.sb.mcpStop(srv.id).catch(() => {})
    await refresh()
  }

  const meta: Record<string, { emoji: string; desc: string; hint: string }> = {
    whatsapp: { emoji: '🟢', desc: 'WhatsApp via QR code (WhatsApp Web style, unofficial)', hint: 'Scan the QR with WhatsApp → Linked devices' },
    telegram: { emoji: '✈️', desc: 'Telegram via QR code (scan with Telegram → Devices → Link Desktop)', hint: 'Scan the QR with Telegram' },
    postgres: { emoji: '🐘', desc: 'Postgres database in read-only mode', hint: 'postgres://user:pass@host:5432/db' }
  }

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>MCP CONNECTORS</div>
          <h1>Connectors</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>
            Apps and data sources feeding your KeepMind via MCP.
          </p>
        </div>
        <button className="btn" onClick={() => setShowCustom(s => !s)}>
          <IconPlus size={12} /> CUSTOM MCP
        </button>
      </div>

      {showCustom && (
        <div className="card card-pad" style={{ marginBottom: 16, maxWidth: 860 }}>
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

      <div className="grid" style={{ maxWidth: 860 }}>
        {(config?.mcpServers ?? []).map((srv: any) => {
          const m = meta[srv.id] ?? { emoji: '🔌', desc: srv.kind === 'custom' ? 'Custom MCP server' : srv.name, hint: '' }
          const running = status.running.includes(srv.id)
          const isCustom = srv.kind === 'custom'
          return (
            <div key={srv.id} className="card card-pad">
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span className="conn-emoji" style={{ fontSize: 30 }}>{m.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <h3>{srv.name}</h3>
                    {isCustom && <span className="badge badge--custom">custom</span>}
                    <span className="m-status" style={{
                      fontSize: 11, fontFamily: 'var(--mono)', padding: '3px 10px', borderRadius: 20,
                      border: '1px solid', borderColor: running ? 'rgba(52,211,153,.4)' : 'var(--line)',
                      color: running ? 'var(--green)' : 'var(--text-faint)'
                    }}>
                      {running ? '● connected' : '○ offline'}
                    </span>
                  </div>
                  <p className="faint" style={{ fontSize: 12.5, marginTop: 3 }}>{m.desc}</p>
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
                    title="Connector permission: allow = may auto-start · ask = manual connect only · block = never runs"
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

              {!running && !isCustom && !['whatsapp', 'telegram'].includes(srv.kind) && (
                <input
                  value={inputs[srv.id] ?? ''}
                  onChange={e => setInputs(s => ({ ...s, [srv.id]: e.target.value }))}
                  placeholder={m.hint}
                  className="mono"
                  style={{ marginTop: 12, width: '100%', maxWidth: 520, background: 'rgba(3,7,18,.7)', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)', fontSize: 12.5 }}
                />
              )}

              {['whatsapp', 'telegram'].includes(srv.kind) && qrs[srv.kind]?.status === 'qr' && (
                <div className="qr-box" style={{ marginTop: 14 }}>
                  <img src={qrs[srv.kind].dataUrl} alt="QR" style={{ width: 200, height: 200 }} />
                  <p style={{ color: '#333', fontSize: 12 }}>
                    {srv.kind === 'whatsapp' ? 'Scan with WhatsApp → Linked devices' : 'Scan with Telegram → Settings → Devices → Link Desktop'}
                  </p>
                </div>
              )}
              {['whatsapp', 'telegram'].includes(srv.kind) && qrs[srv.kind]?.status === 'connected' && (
                <p style={{ color: 'var(--green)', fontSize: 12.5, marginTop: 10 }}>✓ {srv.name} connected</p>
              )}
              {['whatsapp', 'telegram'].includes(srv.kind) && qrs[srv.kind]?.status === 'error' && (
                <p style={{ color: 'var(--amber)', fontSize: 12.5, marginTop: 10 }}>
                  ⚠ {srv.name}: {qrs[srv.kind].code === 'QR_EXPIRED' ? 'QR expired — click Connect again' : 'connection error — click Connect to retry'}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
