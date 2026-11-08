import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
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
}

export interface Automation {
  id: string
  name: string
  instruction: string          // what the brain should do (natural language)
  kind: 'brain' | 'sleep' | 'summary' | 'librarian' | 'evolve' | 'enrich'
  schedule: 'daily' | 'interval' | 'weekly'
  time?: string                // 'HH:MM' for daily/weekly
  everyMinutes?: number        // for interval
  weekday?: number             // 0=Sun..6=Sat for weekly
  enabled: boolean
  lastRunAt?: string
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
  auth: AuthConfig
  pro: ProConfig
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
    pro: { active: false }
  }
}

export class Store {
  private config: AppConfig
  private file: string

  constructor() {
    const dir = join(app.getPath('userData'), 'second-brain')
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'config.json')
    this.config = this.load()
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
        merged.auth = { ...defaultConfig().auth, ...raw.auth }
        merged.pro = { ...defaultConfig().pro, ...raw.pro }
        return merged
      }
    } catch { /* corrupt config -> defaults */ }
    return defaultConfig()
  }

  get(): AppConfig {
    return this.config
  }

  set(patch: Partial<AppConfig>): AppConfig {
    this.config = { ...this.config, ...patch }
    writeFileSync(this.file, JSON.stringify(this.config, null, 2), 'utf8')
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
