import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { Store } from '../store'
import type { AutomationScheduler } from './automations'

// ── Webhook triggers ──
// External apps (Zapier, n8n, GitHub Actions, WhatsApp bridges, cron on a
// VPS…) can fire an automation with:
//   POST http://127.0.0.1:4789/hook/<automationId>
//   headers: x-hook-token: <token>   (or ?token= / Authorization: Bearer)
// Approval-mode automations are queued for the user, same as cron fires.

const PORT = 4789
const MAX_BODY = 64 * 1024
const DEBOUNCE_MS = 5_000

export class HookServer {
  private server: Server | null = null
  private lastFired = new Map<string, number>()

  constructor(
    private store: Store,
    private scheduler: AutomationScheduler,
    private log: (m: string) => void
  ) {}

  get running(): boolean { return !!this.server }
  get port(): number { return PORT }
  get host(): string { return this.store.get().hooks?.lan ? '0.0.0.0' : '127.0.0.1' }

  ensureStarted(): void {
    if (this.server) return
    this.server = createServer((req, res) => { void this.handle(req, res) })
    this.server.on('error', e => this.log(`hook server error: ${e}`))
    this.server.listen(PORT, this.host, () => {
      this.log(`webhook listener on http://${this.host}:${PORT}`)
    })
  }

  restart(): void {
    const was = this.server
    this.server = null
    was?.close(() => this.ensureStarted())
    if (!was) this.ensureStarted()
  }

  private tokenOk(provided: string, expected: string): boolean {
    const a = Buffer.from(provided)
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const m = url.pathname.match(/^\/hook\/([A-Za-z0-9_-]+)$/)
      if (req.method !== 'POST' || !m) return json(404, { ok: false, error: 'not found' })

      const auto = this.store.get().automations.find(a => a.id === m[1])
      if (!auto || !auto.enabled || !auto.webhook || !auto.webhookToken) {
        return json(404, { ok: false, error: 'unknown or disabled hook' })
      }

      const token = req.headers['x-hook-token']
        ?? url.searchParams.get('token')
        ?? (req.headers.authorization?.replace(/^Bearer\s+/i, ''))
        ?? ''
      if (typeof token !== 'string' || !this.tokenOk(token, auto.webhookToken)) {
        this.log(`hook ${auto.id}: bad token`)
        return json(401, { ok: false, error: 'bad token' })
      }

      // drain body (bounded) — payload isn't injected into the prompt,
      // but we log its size for observability
      let size = 0
      req.on('data', c => { size += c.length; if (size > MAX_BODY) req.destroy() })
      await new Promise(r => req.on('end', r))

      const now = Date.now()
      if (now - (this.lastFired.get(auto.id) ?? 0) < DEBOUNCE_MS) {
        return json(429, { ok: false, error: 'debounced' })
      }
      this.lastFired.set(auto.id, now)

      // respond immediately — the automation may run an LLM job for minutes
      json(202, { ok: true, accepted: true })
      void this.scheduler.fire(auto).then(result => {
        this.log(`hook fired "${auto.name}" → ${result} (${size}B body)`)
      })
    } catch (e) {
      return json(500, { ok: false, error: String(e) })
    }
  }
}
