import { useEffect, useMemo, useState } from 'react'
import { mdToHtml } from '../lib/markdown'

// Transparency feed — everything the brain wrote/changed/removed, attributed
// by source (chat, sleep cycle, automations, UI, connectors). This is the
// observability surface: the vault fills itself via LLMs/apps; this screen
// shows what happened.

const OP_STYLE: Record<string, { color: string; label: string }> = {
  write: { color: 'var(--cyan)', label: 'WRITE' },
  append: { color: 'var(--lime)', label: 'APPEND' },
  remove: { color: 'var(--red, #fb7185)', label: 'REMOVE' }
}

function localDay(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function sourceColor(src: string) {
  if (src.startsWith('auto:')) return 'var(--amber)'
  if (src === 'chat') return 'var(--violet, #a78bfa)'
  if (src === 'sleep') return 'var(--blue)'
  if (src === 'summary') return 'var(--pink, #f472b6)'
  if (src === 'ui') return 'var(--text-faint)'
  return 'var(--text-dim, #64748b)'
}

export default function Activity() {
  const [entries, setEntries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [opFilter, setOpFilter] = useState('all')
  const [srcFilter, setSrcFilter] = useState('all')
  const [open, setOpen] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      const e = await window.sb.brainActivity(800)
      setEntries(e ?? [])
    } finally { setLoading(false) }
  }

  useEffect(() => {
    refresh()
    const off = window.sb.onActivityPush?.((entry: any) => {
      if (entry) setEntries(prev => [entry, ...prev].slice(0, 800))
    })
    return () => { off?.() }
  }, [])

  const sources = useMemo(() => [...new Set(entries.map(e => e.source))].sort(), [entries])
  const filtered = useMemo(() => entries.filter(e =>
    (opFilter === 'all' || e.op === opFilter) &&
    (srcFilter === 'all' || e.source === srcFilter)
  ), [entries, opFilter, srcFilter])

  // group by day
  const groups = useMemo(() => {
    const g = new Map<string, any[]>()
    for (const e of filtered) {
      const d = localDay(e.ts)
      if (!g.has(d)) g.set(d, [])
      g.get(d)!.push(e)
    }
    return [...g.entries()]
  }, [filtered])

  const today = localDay(Date.now())
  const todayEntries = entries.filter(e => localDay(e.ts) === today)
  const bySource = todayEntries.reduce<Record<string, number>>((m, e) => ({ ...m, [e.source]: (m[e.source] ?? 0) + 1 }), {})

  const toggleFile = async (path: string) => {
    if (open === path) { setOpen(null); setFileContent(null); return }
    setOpen(path); setFileContent(null)
    const c = await window.sb.brainMemoryFile(path).catch(() => null)
    setFileContent(c)
  }

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>Registro</div>
          <h1>Atividade</h1>
          <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>
            Cada arquivo que o cérebro escreveu, completou ou apagou, e quem fez isso. O dia segue o relógio deste computador.
          </p>
        </div>
        <button className="btn btn--ghost" onClick={refresh} disabled={loading}>
          {loading ? '…' : '↻ Refresh'}
        </button>
      </div>

      {/* today pulse */}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="stat__num">{todayEntries.length}</div><div className="stat__label">CHANGES TODAY</div></div>
        <div className="card stat"><div className="stat__num">{todayEntries.filter(e => e.op === 'write').length}</div><div className="stat__label">WRITES</div></div>
        <div className="card stat"><div className="stat__num">{todayEntries.filter(e => e.op === 'append').length}</div><div className="stat__label">APPENDS</div></div>
        <div className="card stat"><div className="stat__num" style={{ fontSize: 13, paddingTop: 6 }}>{Object.keys(bySource).length}</div><div className="stat__label">ACTIVE SOURCES</div></div>
      </div>

      {Object.keys(bySource).length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 16, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="faint" style={{ fontSize: 11.5 }}>today by source:</span>
          {Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
            <span key={s} className="mono" style={{ fontSize: 11, color: sourceColor(s) }}>
              {s} <b>{n}</b>
            </span>
          ))}
        </div>
      )}

      {/* filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {['all', 'write', 'append', 'remove'].map(op => (
          <button key={op} className={`btn btn--sm ${opFilter === op ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setOpFilter(op)}>
            {OP_STYLE[op]?.label ?? op.toUpperCase()}
          </button>
        ))}
        <select
          value={srcFilter}
          onChange={e => setSrcFilter(e.target.value)}
          style={{ background: 'rgba(3,7,18,.7)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 11, padding: '6px 8px' }}
        >
          <option value="all">all sources</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* feed grouped by day */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {groups.map(([day, items]) => (
          <div key={day}>
            <div className="faint mono" style={{ fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.08em' }}>
              {day === today ? 'Hoje' : day}
            </div>
            <div className="card" style={{ padding: '4px 0' }}>
              {items.map((e, i) => {
                const op = OP_STYLE[e.op] ?? OP_STYLE.write
                const t = new Date(e.ts)
                return (
                  <div key={i}>
                    <button
                      onClick={() => toggleFile(e.path)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                        padding: '7px 14px', background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--text)', fontSize: 12.5, textAlign: 'left'
                      }}
                    >
                      <span className="mono faint" style={{ fontSize: 10.5, width: 42, flex: 'none' }}>
                        {t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: op.color, width: 52, flex: 'none' }}>
                        {op.label}
                      </span>
                      <span className="mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                        {e.path}
                      </span>
                      <span className="mono" style={{ fontSize: 10, color: sourceColor(e.source), flex: 'none' }}>
                        {e.source}
                      </span>
                    </button>
                    {open === e.path && (
                      <div style={{ padding: '4px 14px 12px 66px' }}>
                        {fileContent == null ? (
                          <p className="faint" style={{ fontSize: 11 }}>loading…</p>
                        ) : (
                          <div className="msg__body" style={{ fontSize: 12, maxHeight: 220, overflowY: 'auto' }} dangerouslySetInnerHTML={{ __html: mdToHtml(fileContent.slice(0, 3000)) }} />
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {!filtered.length && !loading && (
          <div className="card card-pad">
            <p className="faint" style={{ fontSize: 13 }}>
              Ainda não há atividade. Conversas, sono, agenda e conectores aparecem aqui no momento em que gravam alguma coisa.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
