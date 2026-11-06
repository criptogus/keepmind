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
    { id: 'brain', name: 'Second Brain', emoji: '🧠', persona: 'Você é o second brain do usuário.', builtin: true },
    { id: 'warren', name: 'Warren Buffett', emoji: '🎩', persona: 'Fale como Warren Buffett: direto, valor, longo prazo.', builtin: true },
    { id: 'bill', name: 'Bill Gates', emoji: '🖥️', persona: 'Fale como Bill Gates: tecnologia, dados, otimismo.', builtin: true },
    { id: 'elon', name: 'Elon Musk', emoji: '🚀', persona: 'Fale como Elon Musk: first principles, ambição.', builtin: true }
  ]
}

const noop = async () => ({})
const noopVoid = async () => undefined

const demoMemory = [
  { path: 'inbox/2026-11-05.md', content: '# 2026-11-05\n\n## Conversa com Warren Buffett\n\n**Você:** como pensar em longo prazo?\n\n**Warren:** O mercado de curto prazo é um máquina de votar; o de longo prazo é uma máquina de pesar. Construa algo que ainda exista em 10 anos.\n' },
  { path: 'insights/2026-11-05.md', content: '# Insights — 2026-11-05\n\n- 📌 Você mencionou 3x "foco" esta semana — considere proteger blocos de deep work\n- ⚠️ Nenhuma mensagem respondida há 2 dias no WhatsApp conectado\n- 🎯 Meta Q4: revisar anualmente seus "círculos de competência"' },
  { path: 'summaries/2026-11-04.md', content: '# Daily summary — 2026-11-04\n\n- Dia focado em produto; 2 decisões importantes tomadas\n- Warren Buffett sugeriu revisar alocação de tempo\n- Amanhã: bloco de escrita sugerido pelo cérebro' }
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
    config: { modelId: 'qwen2.5-3b' }, currentModelDownloaded: true
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
      brain: `🧠 **Second Brain (demo)**\n\nRecebi sua mensagem: "${message}"\n\nNo app real, eu consultaria sua memória, os conectores MCP e responderia com contexto completo.`,
      warren: `🎩 **Warren Buffett**\n\n"Price is what you pay, value is what you get."\n\nSobre "${message}": eu pensaria em vantagem competitiva duradoura e fluxo de caixa. O mercado de curto prazo é um máquina de votar — o seu second brain me ajuda a ver o longo prazo.`,
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
  brainDailySummary: async () => 'Resumo demo',
  brainListInsights: async () => [
    { date: '2026-11-05', content: '# Insights — 2026-11-05\n\n- 📌 Você mencionou 3x "foco" esta semana — considere proteger blocos de deep work\n- ⚠️ Nenhuma mensagem respondida há 2 dias\n- 🎯 Revise seus "círculos de competência"' }
  ],
  brainListSummaries: async () => [
    { date: '2026-11-04', content: '# Daily summary — 2026-11-04\n\n- Dia focado em produto; 2 decisões importantes\n- Sugestão: bloco de escrita amanhã' }
  ],
  brainListMemory: async () => demoMemory,

  openExternal: noopVoid
}

export function installBrowserShim() {
  if (typeof window !== 'undefined' && !(window as any).sb) {
    ;(window as any).sb = demo
  }
}
