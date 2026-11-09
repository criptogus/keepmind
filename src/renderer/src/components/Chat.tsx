import { useEffect, useRef, useState } from 'react'
import { IconSend } from './icons'
import { mdToHtml } from '../lib/markdown'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  steps?: string[]
  memories?: string[]
  saved?: string[]
}

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

  useEffect(() => {
    if (!messages.length || messages.some(m => m.streaming)) return
    try { localStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-50))) } catch { /* quota */ }
  }, [messages])

  useEffect(() => {
    unsubRef.current?.()
    const offDelta = window.sb.onBrainDelta((t) => {
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
    const offStep = window.sb.onBrainStep((step) => {
      setMessages(prev => {
        const list = [...prev]
        const last = list[list.length - 1]
        if (last?.role === 'assistant' && last.streaming) {
          list[list.length - 1] = { ...last, steps: [...(last.steps ?? []), step] }
        }
        return list
      })
    })
    unsubRef.current = () => { offDelta?.(); offStep?.() }
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

    setMessages(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '', streaming: true, steps: [] }])

    try {
      const result = await window.sb.brainChat('brain', text)
      setMessages(prev => {
        const list = [...prev]
        const last = list[list.length - 1]
        if (last?.role === 'assistant') {
          list[list.length - 1] = {
            ...last,
            streaming: false,
            content: (typeof result?.text === 'string' && result.text.trim()) ? result.text : (last.content || ''),
            memories: result?.memories ?? last.memories,
            saved: result?.saved ?? last.saved,
            steps: result?.steps?.length ? result.steps : last.steps
          }
        }
        return list
      })
    } catch (e: any) {
      setMessages(prev => {
        const list = [...prev]
        list[list.length - 1] = { role: 'assistant', content: e?.message ?? String(e), streaming: false }
        return list
      })
    } finally {
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
            <div className="dim" style={{ fontSize: 13 }}>
              A resposta mostra o que foi consultado e o que foi gravado.
            </div>
          </div>
        </div>

        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="empty">
              <h3>Pergunte ao seu KeepMind</h3>
              <p>
                A resposta usa a memória que já está no repositório. Embaixo de cada resposta
                aparece o que foi encontrado e o arquivo que a conversa gravou.
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role === 'user' ? 'msg--user' : ''}`}>
              <div className="msg__avatar">
                <span className="feat-emoji" style={{ fontSize: 'inherit' }}>{m.role === 'user' ? 'Você' : 'Km'}</span>
              </div>
              <div>
                <div className="msg__bubble msg__body">
                  {m.streaming && !m.content ? (
                    <span className="typing"><span /><span /><span /></span>
                  ) : (
                    <span dangerouslySetInnerHTML={{ __html: mdToHtml(m.content) }} />
                  )}
                </div>
                {m.role === 'assistant' && (m.steps?.length || m.memories?.length || m.saved?.length) ? (
                  <div className="msg__trace">
                    {m.steps?.map((s, n) => <div key={n}>{s}</div>)}
                    {!!m.memories?.length && <div>Memórias: {m.memories.join(', ')}</div>}
                    {!!m.saved?.length && <div>Gravou: {m.saved.join(', ')}</div>}
                    {!m.saved?.length && !m.streaming && <div>Gravou a troca no log de hoje.</div>}
                  </div>
                ) : null}
                <div className="msg__meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {m.role === 'assistant' && m.content && (
                    <button className="msg__copy" onClick={() => copyMsg(m.content)} title="Copiar" aria-label="Copiar mensagem">Copiar</button>
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
            placeholder="Escreva para o KeepMind… (Enter envia)"
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
