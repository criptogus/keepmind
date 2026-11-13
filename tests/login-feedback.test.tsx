// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import Login from '../src/renderer/src/components/Login'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
it('announces invalid credentials without leaking IPC internals and permits retry', async () => {
  const login = vi.fn().mockRejectedValueOnce(Error("Error invoking remote method 'auth:login': Error: Invalid email or password")).mockResolvedValue({})
  ;(window as any).sb = { authLogin: login }
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host); const done = vi.fn()
  try {
    await act(async () => root.render(<Login needsSetup={false} googleConfigured={false} onDone={done} />))
    for (const [selector,value] of [['input[type=email]','test@example.invalid'],['input[type=password]','synthetic-password']]) {
      const field = host.querySelector(selector)!
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,value); field.dispatchEvent(new Event('input',{bubbles:true})) })
    }
    const button = [...host.querySelectorAll('button')].find(b => b.textContent === 'SIGN IN')!
    await act(async () => button.click())
    expect(host.querySelector('[role=alert]')?.textContent).toContain('E-mail ou senha incorretos')
    expect(host.textContent).not.toContain('auth:login'); expect(done).not.toHaveBeenCalled()
    await act(async () => button.click()); expect(done).toHaveBeenCalledOnce(); expect(host.querySelector('[role=alert]')).toBeNull()
  } finally { act(() => root.unmount()); host.remove() }
})
