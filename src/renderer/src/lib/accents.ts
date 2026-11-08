// Per-entity accent colors — shared by chat rail, agents, meetings, settings.
export const AGENT_ACCENTS: Record<string, string> = {
  brain: '#22d3ee',
  warren: '#a3e635',
  bill: '#38bdf8',
  elon: '#facc15',
  naval: '#a78bfa',
  jobs: '#f1f5f9'
}

export const PROVIDER_ACCENTS: Record<string, string> = {
  local: '#22d3ee',
  codex: '#a3e635',
  'claude-oauth': '#facc15',
  anthropic: '#fb923c',
  openai: '#34d399',
  grok: '#e4e4e7',
  gemini: '#60a5fa',
  ollama: '#a78bfa'
}

export const CONNECTOR_ACCENTS: Record<string, string> = {
  whatsapp: '#4ade80',
  telegram: '#38bdf8',
  postgres: '#60a5fa',
  custom: '#a78bfa'
}
