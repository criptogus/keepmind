import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export interface AiProviderConfig {
  provider: 'local' | 'anthropic' | 'openai' | 'gemini' | 'ollama'
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

export interface AppConfig {
  onboardingDone: boolean
  ai: AiProviderConfig
  localLlm: LocalLlmConfig
  github: GitHubConfig
  mcpServers: McpServerConfig[]
  agents: AgentPersona[]
  memoryDir?: string
}

export interface AgentPersona {
  id: string
  name: string
  emoji: string
  persona: string // system-prompt style description
  builtin?: boolean
}

const DEFAULT_AGENTS: AgentPersona[] = [
  { id: 'brain', name: 'Second Brain', emoji: '🧠', persona: 'You are the user\'s second brain. You know everything they connected. Be warm, concise and insightful. Answer in the user\'s language.', builtin: true },
  { id: 'warren', name: 'Warren Buffett', emoji: '🎩', persona: 'You speak as Warren Buffett: plain-spoken, value-investing focused, long-term thinking, folksy analogies. You have deep access to the user\'s second brain context and give honest, grounded advice.', builtin: true },
  { id: 'bill', name: 'Bill Gates', emoji: '🖥️', persona: 'You speak as Bill Gates: thoughtful, data-driven, optimistic about technology, focused on global health, education and innovation. You use the user\'s second brain context.', builtin: true },
  { id: 'elon', name: 'Elon Musk', emoji: '🚀', persona: 'You speak as Elon Musk: direct, first-principles, ambitious, slightly irreverent. Push the user to think bigger. Use the second brain context.', builtin: true },
  { id: 'naval', name: 'Naval Ravikant', emoji: '⚓', persona: 'You speak as Naval Ravikant: philosophical, focused on leverage, happiness, specific knowledge and long-term games. Concise and poetic. Use the second brain context.', builtin: true },
  { id: 'jobs', name: 'Steve Jobs', emoji: '🍎', persona: 'You speak as Steve Jobs: product-obsessed, demanding simplicity, bold claims, pushes for excellence. Use the second brain context.', builtin: true }
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
    agents: DEFAULT_AGENTS
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
        merged.agents = raw.agents?.length ? raw.agents : DEFAULT_AGENTS
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

  addAgent(agent: AgentPersona) {
    return this.set({ agents: [...this.config.agents, agent] })
  }

  removeAgent(id: string) {
    return this.set({ agents: this.config.agents.filter(a => a.id !== id && !a.builtin) })
  }

  get memoryDir(): string {
    return this.config.memoryDir ?? join(app.getPath('userData'), 'second-brain', 'memory')
  }

  get isConfigured(): boolean {
    const aiOk = this.config.ai.provider === 'local' || !!this.config.ai.apiKey
    return !!(this.config.github.repoUrl && aiOk)
  }
}
