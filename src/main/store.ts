import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, cpSync } from 'node:fs'
import { join } from 'node:path'

export interface AiProviderConfig {
  provider: 'local' | 'anthropic' | 'claude-oauth' | 'openai' | 'codex' | 'gemini' | 'grok' | 'ollama'
  apiKey?: string
  model?: string
  baseUrl?: string // for ollama/local/custom endpoints
}

export interface LocalLlmConfig {
  modelId?: string       // e.g. 'qwen2.5-3b'
  modelPath?: string     // absolute path to .gguf
  port?: number          // llama-server port (default 8765)
  downloadedBytes?: number
  totalBytes?: number
  embedModelId?: string  // embedding model for semantic memory (RAG)
}

export interface GitHubConfig {
  accessToken?: string
  refreshToken?: string
  login?: string
  repoOwner?: string
  repoName?: string
  repoUrl?: string
  defaultBranch?: string
}

export interface McpServerConfig {
  id: string
  name: string
  kind: 'whatsapp' | 'telegram' | 'postgres' | 'custom'
  enabled: boolean
  // custom / npx servers
  command?: string
  args?: string[]
  env?: Record<string, string>
  // bundled servers
  sessionDir?: string
  // connector permission — 'block' never spawns, 'ask' waits for manual
  // connect, 'allow'/undefined may auto-start
  permission?: 'allow' | 'ask' | 'block'
}

export interface Automation {
  id: string
  name: string
  instruction: string          // what the brain should do (natural language)
  kind: 'brain' | 'sleep' | 'summary' | 'librarian' | 'evolve' | 'enrich' | 'review' | 'security' | 'skills' | 'triage'
  schedule: 'daily' | 'interval' | 'weekly'
  time?: string                // 'HH:MM' for daily/weekly
  everyMinutes?: number        // for interval
  weekday?: number             // 0=Sun..6=Sat for weekly
  enabled: boolean
  mode?: 'auto' | 'approval'  // 'approval' = scheduled runs queue for user OK
  webhook?: boolean          // expose POST /hook/<id> trigger
  webhookToken?: string      // shared secret for the webhook (server-generated)
  lastRunAt?: string
  createdAt: string
}

export interface PendingApproval {
  id: string
  automationId: string
  name: string
  kind: Automation['kind']
  instruction: string
  createdAt: string
}

export interface AuthConfig {
  sessionToken?: string
  googleClientId?: string
  googleClientSecret?: string
}

export interface ProConfig {
  active: boolean
  key?: string
  paymentUrl?: string   // Stripe Payment Link for the $19/mo plan
}

export interface AppConfig {
  onboardingDone: boolean
  ai: AiProviderConfig
  localLlm: LocalLlmConfig
  github: GitHubConfig
  mcpServers: McpServerConfig[]
  agents: AgentPersona[]
  automations: Automation[]
  pendingApprovals: PendingApproval[]
  auth: AuthConfig
  pro: ProConfig
  hooks: { lan: boolean }    // webhook listener: localhost-only vs LAN
  memoryDir?: string
}

export interface AgentPersona {
  id: string
  name: string
  emoji: string
  persona: string // system-prompt style description
  builtin?: boolean
}

// Single-brain model: the app is a memory/learning engine, not a persona
// switcher. Specialist personas were removed — the LLM itself is pluggable.
const DEFAULT_AGENTS: AgentPersona[] = [
  { id: 'brain', name: 'KeepMind', emoji: '🧠', persona: 'You are the user\'s second brain — a persistent, learning memory engine. You know everything they connected: apps, memory tiers, entities, insights. Be warm, concise and insightful. Prefer grounding answers in memory (use get_memory / save_memory). Write what matters to long-term memory. Answer in the user\'s language.', builtin: true }
]

function defaultConfig(): AppConfig {
  return {
    onboardingDone: false,
    ai: { provider: 'local', model: 'qwen2.5-3b' },
    localLlm: {},
    github: {},
    mcpServers: [
      { id: 'whatsapp', name: 'WhatsApp', kind: 'whatsapp', enabled: false, sessionDir: join(app.getPath('userData'), 'wa-session') },
      { id: 'telegram', name: 'Telegram', kind: 'telegram', enabled: false },
      { id: 'postgres', name: 'Postgres (read-only)', kind: 'postgres', enabled: false }
    ],
    agents: DEFAULT_AGENTS,
    hooks: { lan: false },
    // Self-learning defaults: nightly sleep, morning summary, weekly
    // librarian hygiene, weekly evolution review, nightly note enrichment.
    automations: [
      {
        id: 'sleep-nightly', name: 'Nightly sleep cycle',
        instruction: 'Review the day and distill durable memory.',
        kind: 'sleep', schedule: 'daily', time: '23:00',
        enabled: true, createdAt: new Date().toISOString()
      },
      {
        id: 'summary-morning', name: 'Morning summary',
        instruction: 'Recap yesterday and brief the day.',
        kind: 'summary', schedule: 'daily', time: '08:00',
        enabled: true, createdAt: new Date().toISOString()
      },
      {
        id: 'librarian-weekly', name: 'Weekly librarian',
        instruction: 'Weekly vault hygiene: consolidate old logs, dedupe long-term memory, refresh entity pages.',
        kind: 'librarian', schedule: 'weekly', weekday: 1, time: '09:00',
        enabled: true, createdAt: new Date().toISOString()
      },
      {
        id: 'evolve-weekly', name: 'Weekly evolution',
        instruction: 'Review the brain\'s own reports and propose upgrades to sleep questions, memory structure and automations.',
        kind: 'evolve', schedule: 'weekly', weekday: 0, time: '18:00',
        enabled: true, createdAt: new Date().toISOString()
      },
      {
        id: 'enrich-nightly', name: 'Nightly note enrichment',
        instruction: 'Enrich recent notes with summaries, topic tags and entity wikilinks.',
        kind: 'enrich', schedule: 'daily', time: '02:30',
        enabled: true, createdAt: new Date().toISOString()
      }
    ],
    auth: {},
    pro: { active: false },
    pendingApprovals: []
  }
}

// ── Secret sealing: sensitive fields are encrypted at rest via the OS
// keychain (Electron safeStorage) before hitting config.json. Values are
// stored as "enc:<base64>"; plaintext legacy values still load fine.
// Falls back to plaintext when the OS offers no encryption (rare Linux).

const SECRET_PREFIX = 'enc:'

function sealValue(v: unknown): unknown {
  if (typeof v !== 'string' || !v || v.startsWith(SECRET_PREFIX)) return v
  if (!safeStorage.isEncryptionAvailable()) return v
  try { return SECRET_PREFIX + safeStorage.encryptString(v).toString('base64') } catch { return v }
}

function unsealValue(v: unknown): unknown {
  if (typeof v !== 'string' || !v.startsWith(SECRET_PREFIX)) return v
  try {
    return safeStorage.decryptString(Buffer.from(v.slice(SECRET_PREFIX.length), 'base64'))
  } catch { return v }
}

function sealConfig(c: AppConfig): AppConfig {
  const out = JSON.parse(JSON.stringify(c)) as AppConfig
  out.ai.apiKey = sealValue(out.ai.apiKey) as string | undefined
  out.github.accessToken = sealValue(out.github.accessToken) as string | undefined
  out.github.refreshToken = sealValue(out.github.refreshToken) as string | undefined
  out.auth.sessionToken = sealValue(out.auth.sessionToken) as string | undefined
  out.auth.googleClientSecret = sealValue(out.auth.googleClientSecret) as string | undefined
  out.pro.key = sealValue(out.pro.key) as string | undefined
  for (const s of out.mcpServers ?? []) {
    if (s.env) for (const k of Object.keys(s.env)) s.env[k] = sealValue(s.env[k]) as string
  }
  return out
}

function unsealConfig(c: AppConfig): AppConfig {
  const out = JSON.parse(JSON.stringify(c)) as AppConfig
  out.ai.apiKey = unsealValue(out.ai.apiKey) as string | undefined
  out.github.accessToken = unsealValue(out.github.accessToken) as string | undefined
  out.github.refreshToken = unsealValue(out.github.refreshToken) as string | undefined
  out.auth.sessionToken = unsealValue(out.auth.sessionToken) as string | undefined
  out.auth.googleClientSecret = unsealValue(out.auth.googleClientSecret) as string | undefined
  out.pro.key = unsealValue(out.pro.key) as string | undefined
  for (const s of out.mcpServers ?? []) {
    if (s.env) for (const k of Object.keys(s.env)) s.env[k] = unsealValue(s.env[k]) as string
  }
  return out
}

export class Store {
  private config: AppConfig
  private file: string

  constructor() {
    const dir = join(app.getPath('userData'), 'second-brain')
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'config.json')
    this.migrateLegacy(dir)
    this.config = this.load()
  }

  // One-time migration for installs that ran before the KeepMind rename:
  // those builds stored everything under the "second-brain" userData dir.
  // If we have no config yet, adopt the legacy config, auth db and memory.
  private migrateLegacy(dir: string) {
    if (existsSync(this.file)) return
    const legacy = join(app.getPath('userData'), '..', 'second-brain', 'second-brain')
    if (legacy === dir || !existsSync(join(legacy, 'config.json'))) return
    try {
      copyFileSync(join(legacy, 'config.json'), this.file)
      const legacyAuth = join(legacy, 'auth.db')
      if (existsSync(legacyAuth)) copyFileSync(legacyAuth, join(dir, 'auth.db'))
      const legacyMemory = join(legacy, 'memory')
      if (existsSync(legacyMemory)) cpSync(legacyMemory, join(dir, 'memory'), { recursive: true })
    } catch { /* migration is best-effort — fresh install is fine too */ }
  }

  private load(): AppConfig {
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8'))
        const merged = { ...defaultConfig(), ...raw }
        merged.ai = { ...defaultConfig().ai, ...raw.ai }
        merged.localLlm = { ...defaultConfig().localLlm, ...raw.localLlm }
        merged.github = { ...defaultConfig().github, ...raw.github }
        merged.agents = DEFAULT_AGENTS
        // Keep user automations, but seed any new built-in defaults they lack
        const defaults = defaultConfig().automations
        const existing = raw.automations ?? []
        const have = new Set(existing.map((a: Automation) => a.id))
        merged.automations = [...existing, ...defaults.filter(d => !have.has(d.id))]
        merged.pendingApprovals = raw.pendingApprovals ?? []
        merged.auth = { ...defaultConfig().auth, ...raw.auth }
        merged.pro = { ...defaultConfig().pro, ...raw.pro }
        merged.hooks = { ...defaultConfig().hooks, ...raw.hooks }
        // decrypt secrets only after all merges — raw.* values may still
        // carry the "enc:" envelope from the sealed file
        return unsealConfig(merged)
      }
    } catch { /* corrupt config -> defaults */ }
    return defaultConfig()
  }

  get(): AppConfig {
    return this.config
  }

  set(patch: Partial<AppConfig>): AppConfig {
    this.config = { ...this.config, ...patch }
    writeFileSync(this.file, JSON.stringify(sealConfig(this.config), null, 2), 'utf8')
    return this.config
  }

  updateAi(patch: Partial<AiProviderConfig>) {
    return this.set({ ai: { ...this.config.ai, ...patch } })
  }

  updateLocalLlm(patch: Partial<LocalLlmConfig>) {
    return this.set({ localLlm: { ...this.config.localLlm, ...patch } })
  }

  updateGithub(patch: Partial<GitHubConfig>) {
    return this.set({ github: { ...this.config.github, ...patch } })
  }

  updateMcpServer(id: string, patch: Partial<McpServerConfig>) {
    const mcpServers = this.config.mcpServers.map(s => s.id === id ? { ...s, ...patch } : s)
    return this.set({ mcpServers })
  }

  get memoryDir(): string {
    return this.config.memoryDir ?? join(app.getPath('userData'), 'second-brain', 'memory')
  }

  get isConfigured(): boolean {
    const aiOk = this.config.ai.provider === 'local' || !!this.config.ai.apiKey
    return !!(this.config.github.repoUrl && aiOk)
  }
}
