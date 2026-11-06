import { useEffect, useState } from 'react'

// Manage MCP connectors after onboarding.
export default function Connectors({ onActivity, onToast }: {
  onActivity?: () => void
  onToast: (m: string, k?: 'info' | 'error' | 'success') => void
}) {
  const [config, setConfig] = useState<any>(null)
  const [status, setStatus] = useState<any>({ running: [], allTools: [] })
  const [waQr, setWaQr] = useState<any>(null)
  const [inputs, setInputs] = useState<Record<string, string>>({})

  const refresh = async () => {
    const [c, s] = await Promise.all([window.sb.getConfig(), window.sb.mcpStatus()])
    setConfig(c); setStatus(s)
  }

  useEffect(() => { refresh() }, [])

  useEffect(() => {
    const t = setInterval(async () => {
      const qr = await window.sb.whatsappQr()
      setWaQr(qr)
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
        onToast(`${srv.name}: ${res.tools.length} tools ativas`, 'success')
      }
      await refresh()
    } catch (e: any) {
      onToast(`${srv.name}: ${e?.message ?? e}`, 'error')
    }
  }

  const meta: Record<string, { emoji: string; desc: string; hint: string }> = {
    whatsapp: { emoji: '🟢', desc: 'WhatsApp via QR code (estilo WhatsApp Web, não-oficial)', hint: 'Escaneie o QR com seu WhatsApp' },
    telegram: { emoji: '✈️', desc: 'Bot do Telegram — converse com seu second brain de qualquer lugar', hint: 'Token do @BotFather' },
    postgres: { emoji: '🐘', desc: 'Banco Postgres em modo somente-leitura', hint: 'postgres://user:pass@host:5432/db' }
  }

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Conectores</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>
            Apps e fontes de dados que alimentam seu second brain via MCP.
          </p>
        </div>
      </div>

      <div className="grid" style={{ maxWidth: 860 }}>
        {(config?.mcpServers ?? []).map((srv: any) => {
          const m = meta[srv.id] ?? { emoji: '🔌', desc: srv.name, hint: '' }
          const running = status.running.includes(srv.id)
          return (
            <div key={srv.id} className="card card-pad">
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ fontSize: 30 }}>{m.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <h3>{srv.name}</h3>
                    <span className={`mcp-row`} style={{ padding: '3px 10px', fontSize: 11, borderRadius: 20, border: '1px solid', borderColor: running ? 'rgba(52,211,153,.4)' : 'var(--line)', color: running ? 'var(--green)' : 'var(--text-faint)' }}>
                      {running ? '● conectado' : '○ offline'}
                    </span>
                  </div>
                  <p className="faint" style={{ fontSize: 12.5, marginTop: 3 }}>{m.desc}</p>
                  {running && (
                    <div className="faint mono" style={{ fontSize: 11, marginTop: 6 }}>
                      {status.allTools.filter((t: any) => t.serverId === srv.id).map((t: any) => t.name).join(' · ') || 'iniciando…'}
                    </div>
                  )}
                </div>
                <button className={`btn btn--sm ${running ? 'btn--danger' : 'btn--primary'}`} onClick={() => toggle(srv)}>
                  {running ? 'Desconectar' : 'Conectar'}
                </button>
              </div>

              {!running && srv.kind !== 'whatsapp' && (
                <input
                  value={inputs[srv.id] ?? ''}
                  onChange={e => setInputs(s => ({ ...s, [srv.id]: e.target.value }))}
                  placeholder={m.hint}
                  className="mono"
                  style={{ marginTop: 12, width: '100%', maxWidth: 520, background: 'rgba(3,7,18,.7)', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)', fontSize: 12.5 }}
                />
              )}

              {srv.id === 'whatsapp' && waQr?.status === 'qr' && (
                <div className="qr-box" style={{ marginTop: 14 }}>
                  <img src={waQr.dataUrl} alt="QR" style={{ width: 200, height: 200 }} />
                  <p style={{ color: '#333', fontSize: 12 }}>Escaneie com WhatsApp → Aparelhos conectados</p>
                </div>
              )}
              {srv.id === 'whatsapp' && waQr?.status === 'connected' && (
                <p style={{ color: 'var(--green)', fontSize: 12.5, marginTop: 10 }}>✓ WhatsApp conectado</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
