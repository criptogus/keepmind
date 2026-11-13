import { useEffect, useRef, useState } from 'react'
import KeepMindAvatar from './KeepMindAvatar'
import { BrainMark, IconDoc, IconPlug, IconShield } from './icons'

interface Props {
  config: any
  onDone: (intent?: { view: 'connectors' | 'settings'; query?: string; path?: string }) => void | Promise<void>
  onToast: (msg: string, kind?: 'info' | 'error' | 'success') => void
}
const steps = ['Seu second brain', 'Conecte seus agentes']
const titles = ['Sua IA continua de onde vocês pararam', 'Conecte a aplicação de IA que você já usa']

export default function Wizard({ onDone }: Props) {
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const scrollArea = useRef<HTMLElement>(null)
  useEffect(() => {
    if (scrollArea.current) scrollArea.current.scrollTop = 0
    heading.current?.focus({ preventScroll: true })
  }, [step])
  const finish = async (connect: boolean) => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      await window.sb.setConfig({ onboardingDone: true })
      await onDone(connect ? { view: 'connectors' } : undefined)
    } catch {
      setError('Não foi possível concluir a configuração. Tente novamente.')
      inFlight.current = false; setBusy(false)
    }
  }
  return <div className="wizard-screen">
    <header className="wizard__header">
      <div className="wizard__brand"><span aria-hidden="true"><BrainMark size={36} /></span><div><strong>KeepMind SB</strong><span>Memória compartilhada com seus agentes</span></div></div>
      <div className="wizard__progress" role="progressbar" aria-label="Progresso da configuração" aria-valuemin={1} aria-valuemax={2} aria-valuenow={step + 1} aria-valuetext={`Etapa ${step + 1} de 2: ${steps[step]}`}>
        {steps.map((label, i) => <div key={label} className={`wizard__step ${i === step ? 'is-active' : ''} ${i < step ? 'is-done' : ''}`}><span className="wizard__step-dot" /><span>{label}</span></div>)}
      </div>
    </header>
    <main className="wizard__scroll" ref={scrollArea} aria-labelledby="wizard-title"><div className="wizard" key={step}>
      <div className="wizard__intro"><span className="hud-tag">Etapa {step + 1} de 2 · {steps[step]}</span><h1 id="wizard-title" ref={heading} tabIndex={-1}>{titles[step]}</h1></div>
      {error && <div className="wizard__error" role="alert">{error}</div>}
      {step === 0 ? <section className="card wizard__card wizard__welcome">
        <KeepMindAvatar size={64} state="idle" /><h2>Trabalhe com sua IA. Retome com contexto.</h2>
        <p className="sub">Conecte seus agentes ao KeepMind. Durante o trabalho, eles podem consultar o que já aconteceu e registrar decisões, resultados e próximos passos para as próximas sessões.</p>
        <div className="wizard__benefits"><span><IconPlug /> Conecte seus agentes</span><span><IconDoc /> Retome projetos com contexto</span><span><IconShield /> Confira fontes e permissões</span></div>
        <p className="faint">Você acompanha o que foi registrado e revisa propostas. Não precisa alimentar a memória com notas manuais.</p>
      </section> : <section className="card wizard__card">
        <h2>Comece pela conexão</h2><p className="sub">Em Integrações, escolha sua aplicação — como Cursor, Claude Desktop ou Codex — e siga as instruções disponíveis para ela.</p>
        <ol><li>Configure o acesso à memória na aplicação de IA.</li><li>Oriente o agente a consultar o contexto antes de trabalhar e registrar os resultados ao terminar.</li><li>Confira as fontes e a atividade no KeepMind para verificar o que foi salvo.</li></ol>
        <div className="wizard__reassurance"><span aria-hidden="true"><IconShield /></span><p>O acesso depende da configuração e das permissões. Abrir as instruções não significa que o agente já está conectado.</p></div>
        <p className="faint">A proteção da memória e as permissões ficam em Configurações. A IA do chat interno é opcional e também pode ser configurada lá.</p>
      </section>}
    </div></main>
    <footer className="wizard__footer"><p>Seu trabalho gera contexto para a próxima sessão.</p><div className="wizard__actions">
      {step === 0 ? <button className="btn btn--primary" onClick={() => setStep(1)}>Começar →</button> : <>
        <button className="btn btn--ghost" disabled={busy} onClick={() => setStep(0)}>Voltar</button>
        <button className="btn btn--ghost" disabled={busy} onClick={() => void finish(false)}>Explorar primeiro</button>
        <button className="btn btn--primary" disabled={busy} onClick={() => void finish(true)}>{busy ? 'Abrindo…' : 'Conectar meus agentes'}</button>
      </>}
    </div></footer>
  </div>
}
