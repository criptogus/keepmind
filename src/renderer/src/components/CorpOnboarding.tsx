import { useState } from 'react'
import { BrainMark } from './icons'

const SLIDES = [
  {
    title: 'Bem-vindo ao KeepMind Corp',
    body: 'Você está no mesmo second brain do app desktop — Hoje, Brain, Skills, Chat — com limites definidos pela empresa.'
  },
  {
    title: 'Sua memória vs. compartilhado',
    body: 'Notas e skills ficam no seu vault pessoal. Pastas compartilhadas aparecem quando a política permite. Nada de chaves de API pessoais se a org exige BYOK.'
  },
  {
    title: 'Governança (dono/admin)',
    body: 'Quem tem permissão abre Organization governance no topo: política de modelos, times, agentes MCP da empresa e trilha de auditoria.'
  }
]

export default function CorpOnboarding({ org, onDone }: { org?: string; onDone: () => void }) {
  const [step, setStep] = useState(0)
  const last = step >= SLIDES.length - 1
  const slide = SLIDES[step]

  async function finish() {
    await window.sb.setConfig({ onboardingDone: true })
    onDone()
  }

  return (
    <div className="corp-onboard" role="dialog" aria-labelledby="corp-onboard-title">
      <div className="corp-onboard__panel">
        <div className="corp-onboard__brand">
          <BrainMark size={48} />
          <div>
            <div className="corp-onboard__tag">KeepMind Corp{org ? ` · ${org}` : ''}</div>
            <h2 id="corp-onboard-title">{slide.title}</h2>
          </div>
        </div>
        <p className="corp-onboard__body">{slide.body}</p>
        <div className="corp-onboard__dots">
          {SLIDES.map((_, i) => (
            <span key={i} className={i === step ? 'on' : ''} />
          ))}
        </div>
        <div className="corp-onboard__actions">
          {step > 0 ? (
            <button type="button" className="btn ghost" onClick={() => setStep(s => s - 1)}>Voltar</button>
          ) : (
            <span />
          )}
          {last ? (
            <button type="button" className="btn" onClick={() => void finish()}>Abrir o Brain</button>
          ) : (
            <button type="button" className="btn" onClick={() => setStep(s => s + 1)}>Continuar</button>
          )}
        </div>
      </div>
    </div>
  )
}
