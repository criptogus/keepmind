import { useEffect, useRef, useState } from 'react'
import { IconSend } from './icons'

interface Msg { role: 'user' | 'assistant'; content: string; agent?: string; streaming?: boolean }

interface Agent { id: string; name: string; emoji: string; persona: string; builtin?: boolean }

const AGENT_ACCENTS: Record<string, string> = {
  brain: '#22d3ee',
  warren: '#a3e635',
  bill: '#38bdf8',
  elon: '#facc15',
  naval: '#a78bfa',
  jobs: '#f1f5f9'
}

export default function Chat({ agents, onActivity }: { agents: Agent[]; onActivity?: () => void }) {
  const [activeAgent, setActiveAgent] = useState(agents[0]?.id ?? 'brain')
  const [messages, setMessages] = useState<Record<string, Msg[]>>({})
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  const agent = agents.find(a => a.id === activeAgent) ?? agents[0]
  const msgs = messages[activeAgent] ?? []

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs])

  useEffect(() => {
    unsubRef.current?.()
    unsubRef.current = window.sb.onBrainDelta((t) => {
      setMessages(prev => {
        const list = [...(prev[activeAgent] ?? [])]
        const last = list[list.length - 1]
        if (last?.role === 'assistant' && last.streaming) {
          list[list.length - 1] = { ...last, content: last.content + t }
        }
        return { ...prev, [activeAgent]: list }
      })
      onActivity?.()
    })
    return () => unsubRef.current?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgent])

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)
    onActivity?.()

    const userMsg: Msg = { role: 'user', content: text }
    const placeholder: Msg = { role: 'assistant', content: '', agent: agent?.name, streaming: true }
    setMessages(prev => ({ ...prev, [activeAgent]: [...(prev[activeAgent] ?? []), userMsg, placeholder] }))

    try {
      await window.sb.brainChat(activeAgent, text)
    } catch (e: any) {
      setMessages(prev => {
        const list = [...(prev[activeAgent] ?? [])]
        list[list.length - 1] = { role: 'assistant', content: `⚠️ ${e?.message ?? e}`, streaming: false }
        return { ...prev, [activeAgent]: list }
      })
    } finally {
      setMessages(prev => {
        const list = [...(prev[activeAgent] ?? [])]
        const last = list[list.length - 1]
        if (last?.streaming) list[list.length - 1] = { ...last, streaming: false }
        return { ...prev, [activeAgent]: list }
      })
      setBusy(false)
    }
  }

  const renderMd = (text: string) => {
    // very light markdown: code blocks, bold, lists
    const parts = text.split(/(```[\s\S]*?```)/g)
    return parts.map((part, i) => {
      if (part.startsWith('```')) {
        const code = part.replace(/^```\w*\n?/, '').replace(/```$/, '')
        return <pre key={i}><code>{code}</code></pre>
      }
      return <span key={i} dangerouslySetInnerHTML={{ __html: mdInline(part) }} />
    })
  }

  const mdInline = (s: string) =>
    s
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^[-*] /gm, '• ')

  return (
    <div className="chat-wrap">
      <aside className="agent-rail">
        {agents.map(a => {
          const accent = AGENT_ACCENTS[a.id] ?? '#22d3ee'
          const isActive = a.id === activeAgent
          return (
            <button
              key={a.id}
              className={`agent-btn ${isActive ? 'is-active' : ''}`}
              onClick={() => setActiveAgent(a.id)}
              style={isActive ? {
                borderColor: `${accent}55`,
                color: '#fff',
                background: `linear-gradient(90deg, ${accent}30, ${accent}0d)`,
                boxShadow: `0 0 16px ${accent}30, inset 0 0 12px ${accent}14`,
                textShadow: `0 0 10px ${accent}aa`
              } : undefined}
            >
              <span className="emoji" style={isActive ? { filter: `drop-shadow(0 0 6px ${accent})` } : undefined}>{a.emoji}</span>
              <span className="label">{a.name}</span>
            </button>
          )
        })}
      </aside>

      <div className="chat-main">
        <div className="chat-header">
          <div className="msg__avatar" style={{
            width: 38, height: 38, fontSize: 19,
            borderColor: `${AGENT_ACCENTS[agent?.id ?? ''] ?? '#22d3ee'}88`,
            boxShadow: `0 0 16px ${AGENT_ACCENTS[agent?.id ?? ''] ?? '#22d3ee'}40`
          }}>{agent?.emoji}</div>
          <div>
            <h3>{agent?.name ?? 'Second Brain'}</h3>
            <div className="faint" style={{ fontSize: 12 }}>
              {agent?.builtin ? 'Built-in specialist' : 'Custom agent'} · with your second brain context
            </div>
          </div>
        </div>

        <div className="chat-messages">
          {msgs.length === 0 && (
            <div className="empty">
              <div className="e-emoji">{agent?.emoji}</div>
              <h3>Talk to {agent?.name}</h3>
              <p>
                {agent?.id === 'brain'
                  ? 'Ask anything — I know everything you connected: apps, memory, insights.'
                  : `You're chatting with a ${agent?.name} persona. It answers with your full second brain context.`}
              </p>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`msg ${m.role === 'user' ? 'msg--user' : ''}`}>
              <div className="msg__avatar">
                {m.role === 'user' ? '🧑' : (agents.find(a => a.name === m.agent)?.emoji ?? agent?.emoji ?? '🧠')}
              </div>
              <div>
                <div className="msg__bubble msg__body">
                  {m.streaming && !m.content ? (
                    <span className="typing"><span /><span /><span /></span>
                  ) : (
                    renderMd(m.content)
                  )}
                </div>
                {m.agent && <div className="msg__meta">{m.agent}</div>}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="chat-input">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            }}
            placeholder={`Message ${agent?.name ?? 'Second Brain'}… (Enter to send)`}
            rows={1}
          />
          <button className="btn btn--primary" onClick={send} disabled={busy || !input.trim()} style={{ borderRadius: 999, padding: '0 18px', height: 42 }}>
            {busy ? '…' : <IconSend size={16} />}
          </button>
        </div>
      </div>
    </div>
  )
}
