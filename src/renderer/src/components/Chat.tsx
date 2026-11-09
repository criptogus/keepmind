import { useEffect, useRef, useState } from 'react'
import { IconSend } from './icons'
import { mdToHtml } from '../lib/markdown'

interface Msg { role: 'user' | 'assistant'; content: string; streaming?: boolean }

const STORE_KEY = 'sb-chat:brain'
const loadHistory = (): Msg[] => {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as Msg[]
    return list.filter(m => m && typeof m.content === 'string' && !m.streaming).slice(-50)
  } catch { return [] }
}

export default function Chat({ onActivity }: { onActivity?: () => void }) {
  const [messages, setMessages] = useState<Msg[]>(loadHistory)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Persist finished conversations (skip while a reply is still streaming)
  useEffect(() => {
    if (!messages.length || messages.some(m => m.streaming)) return
    try { localStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-50))) } catch { /* quota */ }
  }, [messages])

  useEffect(() => {
    unsubRef.current?.()
    unsubRef.current = window.sb.onBrainDelta((t) => {
      setMessages(prev => {
        const list = [...prev]
        const last = list[list.length - 1]
        if (last?.role === 'assistant' && last.streaming) {
          list[list.length - 1] = { ...last, content: last.content + t }
        }
        return list
      })
      onActivity?.()
    })
    return () => unsubRef.current?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    if (taRef.current) taRef.current.style.height = 'auto'
    setBusy(true)
    onActivity?.()

    const userMsg: Msg = { role: 'user', content: text }
    const placeholder: Msg = { role: 'assistant', content: '', streaming: true }
    setMessages(prev => [...prev, userMsg, placeholder])

    try {
      await window.sb.brainChat('brain', text)
    } catch (e: any) {
      setMessages(prev => {
        const list = [...prev]
        list[list.length - 1] = { role: 'assistant', content: `⚠️ ${e?.message ?? e}`, streaming: false }
        return list
      })
    } finally {
      setMessages(prev => {
        const list = [...prev]
        const last = list[list.length - 1]
        if (last?.streaming) list[list.length - 1] = { ...last, streaming: false }
        return list
      })
      setBusy(false)
    }
  }

  const copyMsg = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {})
  }

  return (
    <div className="chat-wrap">
      <div className="chat-main">
        <div className="chat-header">
          <div className="msg__avatar"><span className="feat-emoji">🧠</span></div>
          <div>
            <h3>KeepMind</h3>
            <div className="faint" style={{ fontSize: 12 }}>
              your memory · semantic recall · sleep-cycle learning
            </div>
          </div>
        </div>

        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="empty">
              <div className="e-emoji"><span className="feat-emoji" style={{ fontSize: 'inherit' }}>🧠</span></div>
              <h3>Talk to your KeepMind</h3>
              <p>
                Ask anything — I know everything you connected: apps, memory, insights.
                I learn while you sleep and get sharper every night.
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role === 'user' ? 'msg--user' : ''}`}>
              <div className="msg__avatar">
                <span className="feat-emoji" style={{ fontSize: 'inherit' }}>{m.role === 'user' ? '🧑' : '🧠'}</span>
              </div>
              <div>
                <div className="msg__bubble msg__body">
                  {m.streaming && !m.content ? (
                    <span className="typing"><span /><span /><span /></span>
                  ) : (
                    <span dangerouslySetInnerHTML={{ __html: mdToHtml(m.content) }} />
                  )}
                </div>
                <div className="msg__meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {m.role === 'assistant' && m.content && (
                    <button className="msg__copy" onClick={() => copyMsg(m.content)} title="Copy" aria-label="Copy message">⧉</button>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="chat-input">
          <textarea
            ref={taRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onInput={e => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 140)}px`
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            }}
            placeholder="Message your KeepMind… (Enter to send)"
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
