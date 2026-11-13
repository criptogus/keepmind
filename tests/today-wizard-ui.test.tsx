// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import Today from '../src/renderer/src/components/Today'
import Wizard from '../src/renderer/src/components/Wizard'
vi.mock('../src/renderer/src/components/KeepMindAvatar', () => ({ default: () => null }))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const button = (text: string) => [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent?.trim()) === text)!
const click = async (text: string) => { expect(button(text)).toBeTruthy(); await act(async () => { button(text).click() }); await flush() }
const mount = async (element: React.ReactNode) => { const node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node); await act(async () => root.render(element)); await flush() }
afterEach(() => { if (root) act(() => root.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks() })
it('keeps failed decisions distinct from empty and retries, then resumes the recent project', async () => {
  let fail = true
  const navigate = vi.fn()
  ;(window as any).sb = { continuity: async () => [{ id:'p', title:'Projeto', objective:'Objetivo', nextStep:'Próximo', status:'active', updatedAt:'2026-01-01' }], automationPending: async () => { if (fail) throw Error('offline'); return [] }, brainFacts: async () => [], brainPolicy: async () => null, brainLedger: async () => [], brainHealth: async () => null, brainListSleep: async () => [], brainEval: async () => null, onJob: () => () => {} }
  await mount(<Today onNavigate={navigate} />)
  expect(document.body.textContent).toContain('aprovações de automação')
  expect(document.body.textContent).not.toContain('Nenhuma decisão pendente agora.')
  fail = false; await click('Tentar novamente')
  expect(document.body.textContent).toContain('Nenhuma decisão pendente agora.')
  await click('Retomar projeto'); expect(navigate).toHaveBeenCalledWith('projects', { projectId: 'p' })
})
it('opens agent integrations without capturing memory, requiring a password or configuring an AI provider', async () => {
  const done = vi.fn(); const setConfig = vi.fn().mockRejectedValueOnce(Error('disk')).mockResolvedValue({})
  const capture = vi.fn(); const setup = vi.fn(); const updateAi = vi.fn()
  ;(window as any).sb = { setConfig, brainCapture: capture, securitySetup: setup, updateAi }
  await mount(<Wizard config={{}} onDone={done} onToast={() => {}} />)
  expect(document.querySelector('textarea, input[type=password]')).toBeNull()
  await click('Começar →')
  expect(document.activeElement?.id).toBe('wizard-title')
  expect(document.querySelector('[role=progressbar]')?.getAttribute('aria-valuetext')).toContain('Etapa 2 de 2')
  expect(document.body.textContent).toContain('não significa que o agente já está conectado')
  await click('Conectar meus agentes')
  expect(document.querySelector('[role=alert]')).toBeTruthy(); expect(done).not.toHaveBeenCalled()
  await click('Conectar meus agentes')
  expect(setConfig).toHaveBeenLastCalledWith({ onboardingDone: true })
  expect(done).toHaveBeenCalledWith({ view: 'connectors' })
  expect(capture).not.toHaveBeenCalled(); expect(setup).not.toHaveBeenCalled(); expect(updateAi).not.toHaveBeenCalled()
})
it('allows exploration without claiming a connected agent and prevents duplicate completion', async () => {
  let resolve!: () => void
  const setConfig = vi.fn(() => new Promise<void>(r => { resolve = r })); const done = vi.fn()
  ;(window as any).sb = { setConfig }
  await mount(<Wizard config={{}} onDone={done} onToast={() => {}} />)
  await click('Começar →'); await click('Voltar'); expect(document.activeElement?.id).toBe('wizard-title')
  await click('Começar →'); await click('Explorar primeiro')
  expect(button('Explorar primeiro').disabled).toBe(true)
  await click('Explorar primeiro'); expect(setConfig).toHaveBeenCalledOnce()
  await act(async () => resolve()); await flush()
  expect(done).toHaveBeenCalledWith(undefined)
})
it('makes agent connection the personal home action without exposing it in Corp', async () => {
  const navigate = vi.fn(); const capture = vi.fn()
  ;(window as any).sb = { continuity: async () => [], automationPending: async () => [], brainFacts: async () => [], brainPolicy: async () => null, brainLedger: async () => [], brainHealth: async () => null, brainListSleep: async () => [], brainEval: async () => null }
  await mount(<Today onNavigate={navigate} onCapture={capture} />)
  const connect = document.querySelector('.value-action') as HTMLButtonElement
  await act(async () => connect.click()); expect(navigate).toHaveBeenCalledWith('connectors'); expect(capture).not.toHaveBeenCalled()
  expect(document.body.textContent).not.toContain('Guardar uma ideia')
  await act(async () => root.render(<Today personal={false} onNavigate={navigate} />)); await flush()
  await act(async () => (document.querySelector('.value-action') as HTMLButtonElement).click())
  expect(navigate).toHaveBeenLastCalledWith('activity'); expect(button('Configurar conexão')).toBeUndefined()
})
