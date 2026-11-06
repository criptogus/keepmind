import type { AiProviderConfig } from '../store'

// Resolve the effective provider config. The bundled 'local' provider talks to
// the llama-server OpenAI-compatible endpoint managed by LocalLlm.
export function effectiveConfig(ai: AiProviderConfig, localEndpoint?: string): AiProviderConfig {
  if (ai.provider === 'local') {
    return {
      provider: 'openai',
      baseUrl: localEndpoint ?? 'http://127.0.0.1:8765/v1',
      apiKey: 'local',
      model: ai.model
    }
  }
  return ai
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string
}

export interface LlmResponse {
  text: string
  toolCalls?: ToolCall[]
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON schema
}

const MODELS: Record<string, string[]> = {
  local: ['qwen2.5-3b', 'smollm2-1.7b', 'llama3.2-3b', 'qwen2.5-7b'],
  anthropic: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o4-mini'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  ollama: ['llama3.1', 'qwen2.5', 'mistral']
}

export function listProviders() {
  return Object.keys(MODELS).map(id => ({
    id,
    name: { local: 'Local (built-in, offline)', anthropic: 'Claude (Anthropic)', openai: 'OpenAI', gemini: 'Google Gemini', ollama: 'Ollama (local)' }[id]!,
    models: MODELS[id]!,
    needsKey: id !== 'ollama' && id !== 'local'
  }))
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`${url} -> ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

async function callAnthropic(cfg: AiProviderConfig, messages: ChatMessage[], tools: ToolDefinition[]): Promise<LlmResponse> {
  const { system, rest } = splitSystem(messages)
  const body: any = {
    model: cfg.model ?? MODELS.anthropic[0],
    max_tokens: 4096,
    messages: rest.map(m => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content }))
  }
  if (system) body.system = system
  if (tools.length) {
    body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }))
  }
  const data = await post('https://api.anthropic.com/v1/messages', body, {
    'x-api-key': cfg.apiKey!,
    'anthropic-version': '2023-06-01'
  })
  const text = data.content?.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') ?? ''
  const toolCalls = (data.content ?? []).filter((b: any) => b.type === 'tool_use').map((b: any) => ({
    id: b.id, name: b.name, arguments: b.input ?? {}
  }))
  return { text, toolCalls }
}

async function callOpenAI(cfg: AiProviderConfig, messages: ChatMessage[], tools: ToolDefinition[]): Promise<LlmResponse> {
  const body: any = {
    model: cfg.model ?? MODELS.openai[0],
    messages: messages.map(m => ({ role: m.role === 'tool' ? 'tool' : m.role, content: m.content, name: m.name })),
    ...(tools.length ? {
      tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
      tool_choice: 'auto'
    } : {})
  }
  const base = cfg.baseUrl ?? 'https://api.openai.com/v1'
  const data = await post(`${base.replace(/\/$/, '')}/chat/completions`, body, {
    Authorization: `Bearer ${cfg.apiKey}`
  })
  const msg = data.choices?.[0]?.message ?? {}
  const toolCalls = (msg.tool_calls ?? []).map((tc: any) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: safeJson(tc.function.arguments)
  }))
  return { text: msg.content ?? '', toolCalls }
}

async function callGemini(cfg: AiProviderConfig, messages: ChatMessage[], tools: ToolDefinition[]): Promise<LlmResponse> {
  const { system, rest } = splitSystem(messages)
  const contents = rest.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }))
  const body: any = {
    contents,
    generationConfig: { maxOutputTokens: 4096 },
    ...(tools.length ? {
      tools: [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }]
    } : {})
  }
  if (system) body.systemInstruction = { parts: [{ text: system }] }
  const model = cfg.model ?? MODELS.gemini[0]
  const data = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cfg.apiKey}`,
    body
  )
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join('')
  const toolCalls = parts.filter((p: any) => p.functionCall).map((p: any) => ({
    id: `call_${Math.random().toString(36).slice(2)}`,
    name: p.functionCall.name,
    arguments: p.functionCall.args ?? {}
  }))
  return { text, toolCalls }
}

async function callOllama(cfg: AiProviderConfig, messages: ChatMessage[], tools: ToolDefinition[]): Promise<LlmResponse> {
  const base = cfg.baseUrl ?? 'http://localhost:11434'
  const data = await post(`${base.replace(/\/$/, '')}/api/chat`, {
    model: cfg.model ?? MODELS.ollama[0],
    messages: messages.map(m => ({ role: m.role === 'tool' ? 'tool' : m.role, content: m.content })),
    stream: false,
    ...(tools.length ? {
      tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
    } : {})
  })
  const msg = data.message ?? {}
  const toolCalls = (msg.tool_calls ?? []).map((tc: any) => ({
    id: tc.id ?? `call_${Math.random().toString(36).slice(2)}`,
    name: tc.function?.name ?? tc.name,
    arguments: tc.function?.arguments ?? tc.arguments ?? {}
  }))
  return { text: msg.content ?? '', toolCalls }
}

function splitSystem(messages: ChatMessage[]): { system: string; rest: ChatMessage[] } {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
  return { system, rest: messages.filter(m => m.role !== 'system') }
}

function safeJson(s: any): Record<string, unknown> {
  if (typeof s === 'object') return s ?? {}
  try { return JSON.parse(s) } catch { return {} }
}

export async function chat(aiCfg: AiProviderConfig, messages: ChatMessage[], tools: ToolDefinition[] = [], localEndpoint?: string): Promise<LlmResponse> {
  const cfg = effectiveConfig(aiCfg, localEndpoint)
  switch (cfg.provider) {
    case 'anthropic':
      if (!cfg.apiKey) throw new Error('Anthropic API key missing')
      return callAnthropic(cfg, messages, tools)
    case 'openai':
      if (!cfg.apiKey) throw new Error('OpenAI API key missing')
      return callOpenAI(cfg, messages, tools)
    case 'gemini':
      if (!cfg.apiKey) throw new Error('Gemini API key missing')
      return callGemini(cfg, messages, tools)
    case 'ollama':
      return callOllama(cfg, messages, tools)
    default:
      throw new Error(`Unknown provider: ${cfg.provider}`)
  }
}

// Streaming variant for chat UI (SSE where supported; simple polling elsewhere)
export async function chatStream(
  aiCfg: AiProviderConfig,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  localEndpoint?: string
): Promise<string> {
  const cfg = effectiveConfig(aiCfg, localEndpoint)
  // Ollama / llama-server streaming path
  if (cfg.provider === 'ollama' || aiCfg.provider === 'local') {
    const isOpenAI = aiCfg.provider === 'local' // llama-server OpenAI-compat path
    const base = aiCfg.provider === 'local'
      ? (localEndpoint ?? cfg.baseUrl ?? 'http://127.0.0.1:8765/v1')
      : (cfg.baseUrl ?? 'http://localhost:11434')
    const url = isOpenAI ? `${base.replace(/\/$/, '')}/chat/completions` : `${base.replace(/\/$/, '')}/api/chat`
    const body: any = isOpenAI
      ? {
          model: cfg.model ?? 'local',
          messages: messages.map(m => ({ role: m.role === 'tool' ? 'assistant' : m.role, content: m.content })),
          stream: true
        }
      : {
          model: cfg.model ?? MODELS.ollama[0],
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          stream: true
        }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: JSON.stringify(body)
    })
    if (!res.ok || !res.body) throw new Error('Local stream failed')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let full = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      for (const line of decoder.decode(value).split('\n').filter(Boolean)) {
        const trimmed = line.replace(/^data: /, '').trim()
        if (!trimmed || trimmed === '[DONE]') continue
        try {
          const j = JSON.parse(trimmed)
          const chunk = isOpenAI ? j.choices?.[0]?.delta?.content : j.message?.content
          if (chunk) { full += chunk; onDelta(chunk) }
        } catch { /* partial line */ }
      }
    }
    return full
  }

  // For hosted providers, fall back to non-streaming with a simulated typewriter feel
  const res = await chat(cfg, messages)
  const words = res.text.split(/(\s+)/)
  let acc = ''
  for (const w of words) {
    acc += w
    onDelta(w)
    await new Promise(r => setTimeout(r, 12))
  }
  return res.text
}
