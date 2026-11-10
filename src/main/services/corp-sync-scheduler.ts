import type { Store } from '../store'
import { corpSyncNow } from './corp-sync'

let timer: ReturnType<typeof setInterval> | null = null

export function reconcileCorpSyncSchedule(store: Store): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  const cfg = store.get().corpSync
  if (!cfg?.enabled || !cfg.baseUrl?.trim() || !cfg.token?.trim()) return
  const minutes = Math.max(15, Math.min(1440, cfg.intervalMinutes ?? 60))
  const ms = minutes * 60_000
  timer = setInterval(() => {
    corpSyncNow(store).catch((err) => {
      console.error('[corp-sync]', err?.message ?? err)
    })
  }, ms)
}
