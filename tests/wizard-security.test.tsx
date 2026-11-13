// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import MemorySecurity from '../src/renderer/src/components/MemorySecurity'
vi.mock('open-bot-avatar/dom', () => ({ mountAvatar: () => ({ update() {}, destroy() {} }) }))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
it('requires recovery acknowledgement before reporting memory ready', async () => {
  let status = { configured: false, unlocked: false, space: 'personal', encryptAll: true }
  const capture = vi.fn().mockResolvedValue('Salvo'); const ready = vi.fn(); const blocking = vi.fn()
  ;(window as any).sb = {
    memorySecurityStatus: vi.fn(async () => status), securitySetup: vi.fn(async () => { status = { ...status, configured: true, unlocked: true }; return { recoveryKey: 'fixture-recovery-key' } }),
    securityUnlock: vi.fn(), localLlmStatus: vi.fn().mockResolvedValue({}), aiCodexStatus: vi.fn().mockResolvedValue({}), onLocalLlmProgress: () => () => {}, brainCapture: capture
  }
  const event = vi.fn(); window.addEventListener('keepmind:memory-scope-change', event)
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host)
  const button = (name: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === name)!
  const click = async (name: string) => act(async () => { button(name).click(); await Promise.resolve(); await Promise.resolve() })
  const input = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => act(async () => { Object.getOwnPropertyDescriptor(el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => { root.render(<MemorySecurity setupOnly onStatusChange={ready} onBlockingChange={blocking} />); await Promise.resolve() })
  expect(host.textContent).toContain('Configure a proteção da memória')
  await input(host.querySelector('input[type=password]')!, 'senha de teste')
  await click('Criar proteção')
  expect(host.textContent).toContain('fixture-recovery-key')
  expect(event).toHaveBeenCalledOnce()
  expect(ready).not.toHaveBeenCalledWith(expect.objectContaining({ unlocked: true })); expect(blocking).toHaveBeenLastCalledWith(true)
  await click('Guardei minha chave de recuperação')
  expect(ready).toHaveBeenLastCalledWith(expect.objectContaining({ unlocked: true })); expect(blocking).toHaveBeenLastCalledWith(false)
  act(() => root.unmount()); host.remove(); window.removeEventListener('keepmind:memory-scope-change', event)
})
it('retains the recovery credential after an unlock failure and permits retry', async () => {
  let status = { configured: true, unlocked: false, space: 'personal', encryptAll: true }
  const unlock = vi.fn().mockRejectedValueOnce(new Error('Credencial inválida')).mockImplementation(async () => { status = { ...status, unlocked: true } })
  ;(window as any).sb = { memorySecurityStatus: vi.fn(async () => status), securityUnlock: unlock, securitySetup: vi.fn(), localLlmStatus: vi.fn().mockResolvedValue({}), aiCodexStatus: vi.fn().mockResolvedValue({}), onLocalLlmProgress: () => () => {}, brainCapture: vi.fn() }
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host)
  const button = (name: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === name)!
  const click = async (name: string) => act(async () => { button(name).click(); await Promise.resolve(); await Promise.resolve() })
  await act(async () => { root.render(<MemorySecurity setupOnly />); await Promise.resolve() })
  const field = [...host.querySelectorAll('input')].find(i => i.placeholder === 'Chave de recuperação')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'chave'); field.dispatchEvent(new Event('input', { bubbles: true })) })
  await click('Recuperar acesso')
  expect(host.textContent).toContain('Credencial inválida'); expect(field.value).toBe('chave')
  await click('Recuperar acesso')
  expect(unlock).toHaveBeenCalledTimes(2); expect(host.textContent).toContain('Memória desbloqueada.')
  act(() => root.unmount()); host.remove()
})
