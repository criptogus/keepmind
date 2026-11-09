import { useCallback, useEffect, useState } from 'react'
import { mdToHtml } from '../lib/markdown'

interface LedgerEntry {
  ts: number
  verb: 'processed' | 'discovered' | 'improved' | 'needs-you'
  sentence: string
  path?: string
}

interface Card { q: string; a: string }
interface Task { id: string; title: string; done: boolean; due: string | null; priority: string }
interface Pending { id: string; name: string; instruction: string; kind: string }

const VERB: Record<LedgerEntry['verb'], string> = {
  processed: 'Processado',
  discovered: 'Descoberto',
  improved: 'Melhorado',
  'needs-you': 'Pedindo você'
}

export default function Today({ onToast }: { onToast?: (m: string, k?: 'info' | 'error' | 'success') => void }) {
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [cards, setCards] = useState<Card[]>([])
  const [revealed, setRevealed] = useState<string | null>(null)
  const [briefing, setBriefing] = useState('')
  const [briefingState, setBriefingState] = useState('Preparando o briefing de hoje…')
  const [policy, setPolicy] = useState<{ active: string; proposals: string[] } | null>(null)
  const [sleepLine, setSleepLine] = useState('')

  const load = useCallback(async () => {
    const [led, taskList, pend, due, pol, sleeps] = await Promise.all([
      window.sb.brainLedger(40).catch(() => []),
      window.sb.tasksList().catch(() => []),
      window.sb.automationPending().catch(() => []),
      window.sb.brainCards().catch(() => []),
      window.sb.brainPolicy().catch(() => null),
      window.sb.brainListSleep().catch(() => [])
    ])
    setLedger(led ?? [])
    setTasks((taskList ?? []).filter((t: Task) => !t.done).slice(0, 8))
    setPending(pend ?? [])
    setCards(due ?? [])
    setPolicy(pol)
    const last = (sleeps ?? [])[0]
    if (last) {
      const line = String(last.content ?? '').split('\n').map((l: string) => l.trim()).find((l: string) => l && !l.startsWith('#') && !l.startsWith('_'))
      setSleepLine(line ? `${last.date}: ${line.slice(0, 180)}` : `Último sono em ${last.date}.`)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const off = window.sb.onJob?.(() => { load() })
    return () => { off?.() }
  }, [load])

  useEffect(() => {
    let dead = false
    window.sb.brainBriefing(false).then(text => {
      if (dead) return
      setBriefing(String(text ?? '').replace(/^# .+\n+/, '').trim())
      setBriefingState('')
    }).catch(() => {
      if (!dead) setBriefingState('O briefing de hoje ainda não pôde ser escrito. O restante do dia continua aqui.')
    })
    return () => { dead = true }
  }, [])

  const approve = async (p: Pending) => {
    await window.sb.automationApprove(p.id)
    onToast?.(`“${p.name}” aprovado e em execução.`, 'success')
    await load()
  }
  const reject = async (p: Pending) => {
    await window.sb.automationReject(p.id)
    await load()
  }
  const grade = async (card: Card, rating: 'again' | 'hard' | 'good' | 'easy') => {
    await window.sb.brainGradeCard(card.q, rating)
    setCards(list => list.filter(c => c.q !== card.q))
    setRevealed(null)
  }
  const applyPolicy = async () => {
    const msg = await window.sb.brainPolicyApply()
    onToast?.(String(msg), 'success')
    await load()
  }

  const groups: LedgerEntry['verb'][] = ['needs-you', 'discovered', 'improved', 'processed']

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>Hoje</div>
          <h1>O que o cérebro fez</h1>
          <p className="dim" style={{ fontSize: 14, marginTop: 6, maxWidth: 640, lineHeight: 1.5 }}>
            Cada linha é um trabalho concluído, uma descoberta ou algo que espera você. O mapa continua em Mapa.
          </p>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 18 }}>
        <div className="card card-pad">
          <h2>Briefing</h2>
          {briefingState && <p className="dim" style={{ marginTop: 8, fontSize: 13 }}>{briefingState}</p>}
          {briefing && (
            <div className="msg__body" style={{ marginTop: 10, fontSize: 14, lineHeight: 1.55 }} dangerouslySetInnerHTML={{ __html: mdToHtml(briefing) }} />
          )}
          {sleepLine && <p className="dim" style={{ marginTop: 12, fontSize: 13 }}>Último sono — {sleepLine}</p>}
        </div>
        <div className="card card-pad">
          <h2>Tarefas abertas</h2>
          {tasks.length === 0 && <p className="dim" style={{ marginTop: 8, fontSize: 13 }}>Nenhuma tarefa aberta no planner.</p>}
          {tasks.map(t => (
            <div key={t.id} className="note-row" style={{ cursor: 'default' }}>
              <span className="note-row__title">{t.title}</span>
              <span className="faint mono" style={{ fontSize: 11 }}>{t.due ?? t.priority}</span>
            </div>
          ))}
        </div>
      </div>

      {groups.map(verb => {
        const items = ledger.filter(e => e.verb === verb).slice(0, 6)
        if (!items.length) return null
        return (
          <div key={verb} style={{ marginBottom: 16 }}>
            <h2>{VERB[verb]}</h2>
            <div className="card" style={{ marginTop: 8 }}>
              {items.map((e, i) => (
                <div key={`${e.ts}-${i}`} className="note-row" style={{ cursor: 'default' }}>
                  <span className="note-row__title">{e.sentence}</span>
                  <span className="faint mono" style={{ fontSize: 11, flexShrink: 0 }}>
                    {new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {e.path ? ` · ${e.path}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {pending.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <h2>Aprovações ({pending.length})</h2>
          {pending.map(p => (
            <div key={p.id} className="note-row" style={{ alignItems: 'flex-start', cursor: 'default' }}>
              <div style={{ flex: 1 }}>
                <strong>{p.name}</strong>
                <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>{p.instruction}</p>
              </div>
              <button className="btn btn--primary btn--sm" onClick={() => approve(p)}>Aprovar</button>
              <button className="btn btn--ghost btn--sm" onClick={() => reject(p)}>Recusar</button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-2">
        <div className="card card-pad">
          <h2>Revisão para você</h2>
          <p className="dim" style={{ fontSize: 13, margin: '6px 0 10px' }}>
            Estes cards saíram da memória longa. A nota é sua, não a do modelo.
          </p>
          {cards.length === 0 && <p className="dim" style={{ fontSize: 13 }}>Nenhum card vencido. O sono cria cards quando há fato durável.</p>}
          {cards.map(c => (
            <div key={c.q} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <div style={{ fontSize: 14 }}>{c.q}</div>
              {revealed === c.q && <p className="dim" style={{ marginTop: 6, fontSize: 13 }}>{c.a}</p>}
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {revealed !== c.q && <button className="btn btn--ghost btn--sm" onClick={() => setRevealed(c.q)}>Mostrar resposta</button>}
                {revealed === c.q && (
                  <>
                    <button className="btn btn--ghost btn--sm" onClick={() => grade(c, 'again')}>De novo</button>
                    <button className="btn btn--ghost btn--sm" onClick={() => grade(c, 'hard')}>Difícil</button>
                    <button className="btn btn--ghost btn--sm" onClick={() => grade(c, 'good')}>Bom</button>
                    <button className="btn btn--ghost btn--sm" onClick={() => grade(c, 'easy')}>Fácil</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="card card-pad">
          <h2>Política do cérebro</h2>
          <p className="dim" style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>{policy?.active || 'Ainda sem política ativa.'}</p>
          {(policy?.proposals.length ?? 0) > 0 && (
            <>
              <p className="dim" style={{ fontSize: 12, marginTop: 12 }}>Última proposta</p>
              <p style={{ fontSize: 13, marginTop: 4 }}>{policy?.proposals[policy.proposals.length - 1]}</p>
              <button className="btn btn--primary btn--sm" style={{ marginTop: 10 }} onClick={applyPolicy}>Aplicar na política ativa</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
