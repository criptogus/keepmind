import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { classify, maxClass, policy, redact, restricted, type Classification } from './classification'
export interface Consent { id: string; space: string; provider: string; expiresAt: number }
export interface EgressContext { space?: string; spaces?: string[]; class?: Classification; consent?: Consent; grants?: Consent[]; logFile?: string }
export function gate(provider: string, local: boolean, messages: { content: string }[], context: EgressContext = {}) {
  const space = context.space ?? 'personal'
  const classification = maxClass(context.class ?? 'internal', ...messages.map(m => maxClass(classify(m.content), policy(m.content).class)),
    ...messages.flatMap(m => [...m.content.matchAll(/^class:\s*(public|internal|sensitive|secret)\s*$/gm)].map(x => x[1] as Classification)))
  const spaces = new Set([space, ...(context.spaces ?? []), ...messages.flatMap(m => [...m.content.matchAll(/^space:\s*([a-zA-Z0-9_-]+)\s*$/gm)].map(x => x[1]))])
  const consentFor = (s: string) => [context.consent, ...(context.grants ?? [])].find(c => c && c.space === s && c.provider === provider && c.id && c.expiresAt > Date.now())
  if (!local && restricted(classification) && [...spaces].some(s => !consentFor(s))) throw new Error('Cloud egress denied: explicit space consent required')
  let count = 0
  const result = messages.map(m => { if (local) return m; const r = redact(m.content); count += r.count; return { ...m, content: r.text } })
  if (!local && !context.logFile) throw new Error('Cloud egress audit log unavailable')
  if (context.logFile) {
    mkdirSync(dirname(context.logFile), { recursive: true })
    for (const s of spaces) appendFileSync(context.logFile, JSON.stringify({ ts: new Date().toISOString(), provider, space: s, class: classification, redactions: count, consent_id: consentFor(s)?.id ?? null }) + '\n', { mode: 0o600 })
  }
  return result
}
export function isLocalEndpoint(provider: string, endpoint?: string) {
  if (!['local', 'ollama'].includes(provider)) return false
  try { const u = new URL(endpoint ?? (provider === 'local' ? 'http://127.0.0.1:8765' : 'http://localhost:11434')); return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && ['http:', 'https:'].includes(u.protocol) } catch { return false }
}

let defaultContext: (() => EgressContext) | undefined
export function configureEgressContext(resolve: () => EgressContext) { defaultContext = resolve }
export function egressContext(): EgressContext { return defaultContext?.() ?? {} }
