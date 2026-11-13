// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import NeuralField from '../src/renderer/src/components/NeuralField'
import { updateAppearance } from '../src/renderer/src/lib/appearance'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
it('bounds decorative frames and releases work when hidden, disabled or unmounted', async () => {
  localStorage.clear()
  const pending = new Map<number, FrameRequestCallback>(); let next = 0
  const context = { setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn() }
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context as any)
  vi.stubGlobal('requestAnimationFrame',(fn: FrameRequestCallback) => { pending.set(++next,fn); return next })
  vi.stubGlobal('cancelAnimationFrame',(id: number) => pending.delete(id))
  let hidden = false; vi.spyOn(document,'hidden','get').mockImplementation(() => hidden)
  const disconnect = vi.fn(); vi.stubGlobal('ResizeObserver',class { observe() {} disconnect = disconnect })
  vi.spyOn(window,'matchMedia').mockReturnValue({matches:false,addEventListener(){},removeEventListener(){}} as any)
  const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host)
  const frame = (time: number) => { const callbacks=[...pending.values()];pending.clear();callbacks.forEach(fn=>fn(time)) }
  try {
    await act(async()=>root.render(<NeuralField activity={100} />))
    expect(host.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true')
    // Simulate a 120 Hz display for one second. Decoration must not render at 120 fps.
    for(let t=0;t<=1000;t+=1000/120) frame(t)
    expect(context.clearRect.mock.calls.length).toBeGreaterThan(20)
    expect(context.clearRect.mock.calls.length).toBeLessThanOrEqual(30)
    hidden=true;document.dispatchEvent(new Event('visibilitychange'));expect(pending.size).toBe(0)
    hidden=false;document.dispatchEvent(new Event('visibilitychange'));expect(pending.size).toBe(1)
    await act(async()=>updateAppearance({motionEnabled:false}))
    expect(host.querySelector('canvas')).toBeNull();expect(pending.size).toBe(0);expect(disconnect).toHaveBeenCalled()
    await act(async()=>updateAppearance({motionEnabled:true}))
    expect(pending.size).toBe(1)
    await act(async()=>updateAppearance({backgroundEnabled:false}))
    expect(host.querySelector('canvas')).toBeNull();expect(pending.size).toBe(0)
    await act(async()=>updateAppearance({backgroundEnabled:true}))
    expect(pending.size).toBe(1)
    act(()=>root.unmount());expect(pending.size).toBe(0)
  } finally { host.remove();localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals() }
})
