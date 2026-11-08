// Secret-pattern detection shared by the security audit and the
// outbound redactor. Patterns are deliberately conservative — they
// target well-known credential shapes, not generic high-entropy text,
// so normal prose is never mangled.

export const SECRET_PATTERNS: [label: string, re: RegExp][] = [
  ['openai/generic api key', /\b(sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,})\b/],
  ['github token', /\b(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|gho_[A-Za-z0-9]{30,}|ghu_[A-Za-z0-9]{30,}|ghs_[A-Za-z0-9]{30,}|ghr_[A-Za-z0-9]{30,})\b/],
  ['slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['aws key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['bearer token', /\bbearer\s+[A-Za-z0-9._~+/=-]{20,}/gi],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['stripe key', /\b[sr]k_(live|test)_[A-Za-z0-9]{16,}\b/],
  ['google api key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['password assignment', /(?:password|passwd|pwd|secret|api[_-]?key|token|client[_-]?secret)\s*[:=]\s*['"][^'"\s]{8,}['"]/gi]
]

const REDACTED = '⟨redacted:secret⟩'

// Replace every secret-looking span with a placeholder. Used before
// memory content leaves the machine for a cloud LLM.
export function redactSecrets(text: string): string {
  if (!text) return text
  let out = text
  for (const [, re] of SECRET_PATTERNS) {
    re.lastIndex = 0
    out = out.replace(re, REDACTED)
  }
  return out
}

// True when the effective provider runs on the user's own machine —
// local inference and Ollama are trusted with plaintext memory.
export function isLocalProvider(provider: string): boolean {
  return provider === 'local' || provider === 'ollama'
}
