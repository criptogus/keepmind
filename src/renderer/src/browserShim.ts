// Browser preview shim — when the renderer runs outside Electron (plain
// browser at localhost:5173), window.sb doesn't exist. Provide a demo stub so
// the UI is explorable. All mutating calls are no-ops.

const demoConfig = {
  onboardingDone: true,
  ai: { provider: 'local', model: 'qwen2.5-3b' },
  localLlm: { modelId: 'qwen2.5-3b' },
  github: { repoUrl: 'https://github.com/voce/second-brain', login: 'voce' },
  mcpServers: [
    { id: 'whatsapp', name: 'WhatsApp', kind: 'whatsapp', enabled: true },
    { id: 'telegram', name: 'Telegram', kind: 'telegram', enabled: false },
    { id: 'postgres', name: 'Postgres (read-only)', kind: 'postgres', enabled: false }
  ],
  agents: [
    { id: 'brain', name: 'Second Brain', emoji: '🧠', persona: 'You are the user\'s second brain.', builtin: true },
    { id: 'warren', name: 'Warren Buffett', emoji: '🎩', persona: 'Speak like Warren Buffett: direct, value, long-term.', builtin: true },
    { id: 'bill', name: 'Bill Gates', emoji: '🖥️', persona: 'Speak like Bill Gates: technology, data, optimism.', builtin: true },
    { id: 'elon', name: 'Elon Musk', emoji: '🚀', persona: 'Speak like Elon Musk: first principles, ambition.', builtin: true }
  ],
  automations: [
    { id: 'auto_demo1', name: 'Morning briefing', instruction: 'every day at 8am summarize yesterday\'s activity', kind: 'summary', schedule: 'daily', time: '08:00', enabled: true, createdAt: '2026-11-01T00:00:00Z', lastRunAt: '2026-11-05T08:00:00Z' }
  ]
}

const noop = async () => ({})
const noopVoid = async () => undefined

const demoMemory = [
  { path: 'inbox/2026-11-05.md', content: '# 2026-11-05\n\n## Chat with Warren Buffett\n\n**You:** how to think long-term?\n\n**Warren:** The short-term market is a voting machine; the long-term market is a weighing machine. Build something that still exists in 10 years.\n' },
  { path: 'insights/2026-11-05.md', content: '# Insights — 2026-11-05\n\n- 📌 You mentioned "focus" 3x this week — consider protecting deep-work blocks\n- ⚠️ No messages answered in 2 days on connected WhatsApp\n- 🎯 Q4 goal: review your circles of competence yearly' },
  { path: 'summaries/2026-11-04.md', content: '# Daily summary — 2026-11-04\n\n- Product-focused day; 2 important decisions made\n- Warren Buffett suggested reviewing time allocation\n- Tomorrow: writing block suggested by the brain' }
]

let deltaCb: ((t: string) => void) | null = null

const demo = {
  getConfig: async () => demoConfig,
  setConfig: noop,
  updateAi: async (p: any) => ({ ...demoConfig.ai, ...p }),
  updateLocalLlm: noop,
  updateGithub: noop,
  updateMcp: noop,
  addAgent: noop,
  removeAgent: noop,

  aiProviders: async () => [
    { id: 'local', name: 'Local (built-in, offline)', models: ['qwen2.5-3b', 'smollm2-1.7b', 'llama3.2-3b', 'qwen2.5-7b'], needsKey: false },
    { id: 'anthropic', name: 'Claude (Anthropic)', models: ['claude-sonnet-4-5'], needsKey: true },
    { id: 'openai', name: 'OpenAI', models: ['gpt-4o'], needsKey: true },
    { id: 'gemini', name: 'Google Gemini', models: ['gemini-2.5-pro'], needsKey: true },
    { id: 'ollama', name: 'Ollama (local)', models: ['llama3.1'], needsKey: false }
  ],
  aiTest: async () => ({ ok: true, reply: 'OK (demo)' }),

  ghStartDeviceFlow: async () => ({ device_code: 'demo', user_code: 'DEMO-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 }),
  ghPollDeviceFlow: async () => null,
  ghCreateRepo: async () => ({ full_name: 'voce/second-brain', html_url: 'https://github.com/voce/second-brain', clone_url: '', default_branch: 'main' }),
  ghPushMemory: async () => ({ pushed: 12 }),

  localLlmStatus: async () => ({
    catalog: [
      { id: 'smollm2-1.7b', label: 'SmolLM2 1.7B', sizeGB: 1.1, description: 'Smallest option' },
      { id: 'qwen2.5-3b', label: 'Qwen2.5 3B', sizeGB: 2.0, description: 'Recommended default' },
      { id: 'llama3.2-3b', label: 'Llama 3.2 3B', sizeGB: 2.0, description: 'Meta small model' },
      { id: 'qwen2.5-7b', label: 'Qwen2.5 7B', sizeGB: 4.7, description: 'Best quality' }
    ],
    serverDownloaded: true, running: true, endpoint: 'http://127.0.0.1:8765/v1',
    config: { modelId: 'qwen2.5-3b' }, currentModelDownloaded: true,
    embedCatalog: [
      { id: 'bge-small', label: 'BGE Small EN v1.5', sizeMB: 64, dims: 384 },
      { id: 'nomic-embed', label: 'Nomic Embed Text v1.5', sizeMB: 85, dims: 768 }
    ]
  }),
  localLlmDownloadServer: noop,
  localLlmDownloadModel: noop,
  localLlmEnsure: async () => ({ ok: true, endpoint: 'http://127.0.0.1:8765/v1' }),
  localLlmStop: noop,
  onLocalLlmProgress: () => () => {},

  mcpStart: async () => ({ tools: ['whatsapp_status', 'whatsapp_qr', 'whatsapp_send', 'whatsapp_messages'] }),
  mcpStop: noopVoid,
  mcpStatus: async () => ({
    running: ['whatsapp'],
    allTools: [
      { serverId: 'whatsapp', name: 'whatsapp_status', description: 'Check connection' },
      { serverId: 'whatsapp', name: 'whatsapp_send', description: 'Send message' },
      { serverId: 'whatsapp', name: 'whatsapp_messages', description: 'List messages' }
    ]
  }),
  whatsappQr: async () => ({ status: 'qr', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }),
  mcpLogs: async () => [],

  brainChat: async (agentId: string, message: string) => {
    // emit fake streaming
    const replies: Record<string, string> = {
      brain: `🧠 **Second Brain (demo)**\n\nGot your message: "${message}"\n\nIn the real app, I would query your memory, the MCP connectors, and reply with full context.`,
      warren: `🎩 **Warren Buffett**\n\n"Price is what you pay, value is what you get."\n\nOn "${message}": I'd think durable competitive advantage and cash flow. The short-term market is a voting machine — your second brain helps me see the long term.`,
      bill: `🖥️ **Bill Gates**\n\nGreat question about "${message}". I'd approach it with data first — measure what matters, then move fast on the highest-leverage thing. Technology should amplify human potential.`,
      elon: `🚀 **Elon Musk**\n\n"${message}" — let's break this to first principles. What's the actual physics/economics of it? Most people optimize the wrong variable. Think bigger, delete the step entirely if you can.`,
    }
    const text = replies[agentId] ?? replies.brain
    // simulate streaming deltas
    for (const w of text.split(/(\s+)/)) {
      deltaCb?.(w)
      await new Promise(r => setTimeout(r, 15))
    }
    return text
  },
  onBrainDelta: (cb: (t: string) => void) => {
    deltaCb = cb
    return () => { deltaCb = null }
  },
  brainInsights: async () => ['💡 Demo insight'],
  brainDailySummary: async () => 'Demo summary',
  brainListInsights: async () => [
    { date: '2026-11-05', content: '# Insights — 2026-11-05\n\n- 📌 You mentioned "focus" 3x this week — consider protecting deep-work blocks\n- ⚠️ No messages answered in 2 days\n- 🎯 Review your circles of competence' }
  ],
  brainListSummaries: async () => [
    { date: '2026-11-04', content: '# Daily summary — 2026-11-04\n\n- Product-focused day; 2 important decisions made\n- Warren suggested reviewing time allocation\n- Tomorrow: writing block suggested by the brain' }
  ],
  brainListMemory: async () => demoMemory,
  brainSleep: async () => ({ report: '(demo sleep report)', consolidated: 0 }),
  brainListSleep: async () => [
    { date: '2026-11-05', content: '# Sleep cycle — 2026-11-05\n\n### 1. Working\n- Deep work blocks on product\n\n### 2. Can improve\n- More delegation\n\n### 3. Not working → fix\n- Unanswered messages pile up\n\n### 4. Stop\n- Checking phone during focus blocks\n\n### 5. Start\n- Weekly review ritual\n\n### Tonight\'s commitments\n- Block 2h tomorrow morning' }
  ],
  brainMemoryTiers: async () => ({ shortTerm: 3, mediumTerm: 1, longTerm: 8, sleepCycles: 2 }),

  syncStatus: async () => ({ connected: true, pending: 0, lastPull: '2026-11-05T12:00:00Z', lastPush: '2026-11-05T12:00:01Z', syncing: false }),
  syncNow: async () => ({ connected: true, pending: 0, lastPull: '2026-11-05T12:00:00Z', lastPush: '2026-11-05T12:00:01Z', syncing: false }),

  automationList: async () => demoConfig.automations,
  automationParse: async (text: string) => ({
    kind: 'brain', schedule: 'daily', time: '08:00',
    label: 'every day at 08:00 (demo)', name: text.slice(0, 40)
  }),
  automationCreate: async (input: any) => ({ id: 'auto_new', ...input, enabled: true, createdAt: new Date().toISOString() }),
  automationUpdate: async (id: string, patch: any) => ({ ...demoConfig.automations[0], ...patch }),
  automationRemove: async () => true,
  automationRunNow: async () => true,

  authState: async () => ({ needsSetup: false, user: { id: 1, email: 'demo@secondbrain.local', name: 'Demo User' } }),
  authRegister: async () => ({ id: 1, email: 'demo@secondbrain.local', name: 'Demo' }),
  authLogin: async () => ({ id: 1, email: 'demo@secondbrain.local', name: 'Demo' }),
  authLogout: async () => true,
  authGoogleLogin: async () => ({ id: 1, email: 'demo@secondbrain.local', name: 'Demo' }),
  authSetGoogleCreds: async () => true,
  billingStatus: async () => ({ active: false, paymentUrl: '' }),
  billingSetPaymentUrl: async () => true,
  billingActivate: async () => ({ active: true, key: 'demo' }),
  ragStatus: async () => ({ available: true, running: true, modelId: 'bge-small', chunks: 42, embedded: 42 }),
  ragSetup: async () => ({ available: true, running: true, chunks: 42, embedded: 42 }),
  ragReindex: async () => ({ chunks: 42, embedded: 42 }),

  openExternal: noopVoid
}

export function installBrowserShim() {
  if (typeof window !== 'undefined' && !(window as any).sb) {
    ;(window as any).sb = demo
  }
}
