// Builds the copy-paste prompt that connects an external LLM (Claude, Codex,
// Grok, Gemini, ChatGPT…) to the user's KeepMind GitHub repo.

export function buildConnectPrompt(repoUrl: string): string {
  const repo = repoUrl?.replace(/\.git$/, '') ?? 'YOUR_SECOND_BRAIN_REPO_URL'
  return `You are now connected to my "KeepMind" — a GitHub repository that is my long-term memory, shared with my KeepMind desktop app.

REPOSITORY: ${repo}

## FIRST: repo governance wins
Before writing anything, explore the repo root and read its governance docs — \`AGENTS.md\`, \`CLAUDE.md\`, \`CONTEXT.md\`, \`governance/\`, \`README\`, writer/ingest scripts in \`tools/\` or \`ops/\`. If the repo defines its own structure, write paths, or a writer script, FOLLOW THEM — they override everything below. Never bypass a documented write path with raw git commits.

## Memory layout
The repo IS the memory — its structure is whatever it already is. Explore first; do not assume directories exist. Common KeepMind-native layout (only if present):
- \`memory/short-term/YYYY-MM-DD.md\` — raw daily logs (working memory)
- \`memory/medium-term/\`, \`memory/long-term/\` — consolidations and durable facts/lessons/skills (app-managed; read freely, append only if clearly durable)
- \`memory/insights/\`, \`memory/summaries/\`, \`memory/sleep/\` — generated reports (read-only)
- \`memory/notes/\`, \`memory/daily/\`, \`memory/entities/\`, \`memory/review/\`, \`memory/skills/\`, \`memory/crm/\`, \`memory/ops/\`
If the repo uses a different memory root (e.g. an imported vault), write inside THAT root, not a parallel \`memory/\` tree.

## Boundaries — do not create parallel systems
- If the repo already has directories for people/companies/relationships, EXTEND them — never create a second CRM.
- If my tasks live in an external tool (e.g. Google Tasks), do NOT create task files in the repo — record references/links instead.
- If the repo ships a memory/writer script or MCP server (e.g. \`tools/keepmind-mcp.mjs\`), prefer it over raw file edits.
- Secrets, passwords, API keys and credentials are NEVER saved.

## Setup (do once)
- Clone the repo locally, or access it via the GitHub API / \`gh\` CLI / GitHub MCP if you have one.
- Read the repo's index/context files and the most recent memory logs to load context.
- The app syncs this repo continuously — anything you push is pulled into my KeepMind automatically. Pull before reading, push after writing — UNLESS repo governance specifies another write path.

## Every session
- BEFORE answering anything about me, my work, or my projects: read the relevant memory files first.
- AFTER completing meaningful work: APPEND a memory entry in the repo's own format. Never rewrite or delete existing entries.

## What to save
Append under a dated heading (e.g. \`## HH:MM — <source>\`, matching repo conventions). Save:
- Decisions made and the reasoning behind them
- Work output: emails sent (subject + gist), documents produced (title + summary/path), code shipped, PRs, deploys
- Insights, lessons learned, things I said I would do
- Personal context when relevant: health, family, preferences, goals, finances

## Rules
- Markdown only. Append-only. One file per day per source.
- Keep entries concise — bullets, not essays. Link artifacts by path or URL.
- Commit and push at the end of each session with message \`memory: YYYY-MM-DD <source>\`.
- If you cannot write to GitHub directly, end your reply with a \`## 🧠 MEMORY BLOCK\` section containing the exact markdown to append — I will paste it back.

Confirm you understand by listing the top 5 things you remember about me after reading the repo.`
}

// ── Agent connection catalog ──
// Each card tells a specific agent HOW to reach the local KeepMind brain:
// either by spawning the bundled MCP server (stdio) or, for web/VPS agents
// without local file access, by the git-based prompt above.

export interface ConnectInfo {
  mcpScript: string
  memoryDir: string
  memoryRoot?: string // repo-relative memory root, e.g. 'memory/' or '' for whole-vault imports
  repoUrl: string | null
  repoOwner: string | null
  repoName: string | null
}

export interface AgentSnippet {
  label: string
  language: string
  content: string
}

export interface AgentCard {
  id: string
  name: string
  tag: string
  where: string
  blurb: string
  snippets: AgentSnippet[]
  prompt?: boolean
  note?: string
}

const jsonMcp = (script: string, dir: string) => JSON.stringify({
  mcpServers: {
    keepmind: { command: 'node', args: [script, '--dir', dir] }
  }
}, null, 2)

const tomlMcp = (script: string, dir: string) =>
`[mcp_servers.keepmind]
command = "node"
args = ["${script}", "--dir", "${dir}"]`

export function buildAgentCatalog(info: ConnectInfo): AgentCard[] {
  const { mcpScript: s, memoryDir: d, repoUrl, memoryRoot } = info
  const repoName = (repoUrl ?? '').replace(/\.git$/, '').split('/').pop() || 'your-brain-repo'
  const memArg = memoryRoot === '' || memoryRoot == null ? '.' : `./${memoryRoot.replace(/\/$/, '')}`
  const cloneSnippet = `git clone ${repoUrl ?? '<your-repo-url>'}\ncd ${repoName}\nnode tools/keepmind-mcp.mjs --dir ${memArg}`
  const composerRule = `---
description: KeepMind memory — search before answering, append after work (Composer)
globs:
alwaysApply: true
---

You have the **keepmind** MCP server (sb_search, sb_read, sb_append, sb_remember, …).

1. Before answering about the user, their work, or prior decisions: run **sb_search**.
2. After meaningful work: **sb_append** or **sb_remember** — never rewrite history.
3. Follow repo **AGENTS.md** if present; it overrides generic layout guesses.
4. Never store secrets or credentials in memory.`

  const cards: AgentCard[] = [
    {
      id: 'composer', name: 'Cursor Composer', tag: 'app · Agent',
      where: 'Cursor → Composer (Agent) · MCP em .cursor/mcp.json',
      blurb:
        'Composer é o modo agente do Cursor. Com o servidor KeepMind MCP ativo, o Composer usa sb_search, sb_remember e o restante das tools de memória em cada sessão — o mesmo fluxo do desktop KeepMind.',
      snippets: [
        { label: '.cursor/mcp.json', language: 'json', content: jsonMcp(s, d) },
        { label: '.cursor/rules/keepmind-memory.mdc', language: 'markdown', content: composerRule },
        {
          label: 'Checklist',
          language: 'markdown',
          content: [
            '1. Cole o mcp.json no projeto (ou use o que o repo já tem em `.cursor/mcp.json`).',
            '2. Cursor → Settings → MCP → confirme **keepmind** habilitado.',
            '3. Abra **Composer** (Agent), não só o chat inline.',
            '4. Na primeira mensagem: “Leia AGENTS.md e busque na memória antes de responder.”'
          ].join('\n')
        }
      ],
      prompt: true,
      note: 'Composer e o editor Cursor compartilham o mesmo MCP — esta ficha é o fluxo recomendado para o Agent.'
    },
    {
      id: 'grok', name: 'Grok Bot', tag: 'bot · your VM',
      where: 'runs inside your VM — repo clone + MCP',
      blurb: 'Your Grok bot running on your own machine or VM. Clone the brain repo there and run the bundled MCP server — it gets sb_search, sb_remember and friends natively. Falls back to the git prompt if the bot has no shell.',
      snippets: [
        { label: 'bot on VM (repo clone)', language: 'bash', content: cloneSnippet },
        { label: 'mcpServers JSON', language: 'json', content: jsonMcp(s, d) }
      ],
      prompt: true
    },
    {
      id: 'codex', name: 'Codex', tag: 'CLI · local',
      where: '~/.codex/config.toml',
      blurb: 'Codex CLI / IDE extension. Registers KeepMind as an MCP server — tools like sb_search, sb_remember become native.',
      snippets: [{ label: 'config.toml', language: 'toml', content: tomlMcp(s, d) }],
      prompt: true
    },
    {
      id: 'claude', name: 'Claude Code', tag: 'CLI · local',
      where: 'claude mcp add · or repo .mcp.json',
      blurb: 'User-scope MCP registration. If you work inside a clone of the brain repo, the shipped .mcp.json connects automatically.',
      snippets: [
        { label: 'terminal', language: 'bash', content: `claude mcp add keepmind --scope user -- node "${s}" --dir "${d}"` },
        { label: '.mcp.json (inside repo clone)', language: 'json', content: jsonMcp('tools/keepmind-mcp.mjs', './memory') }
      ],
      prompt: true
    },
    {
      id: 'cursor', name: 'Cursor (editor)', tag: 'IDE · local',
      where: '.cursor/mcp.json',
      blurb: 'MCP no workspace para Chat e Composer. Para o fluxo agente completo, use o cartão **Cursor Composer** acima.',
      snippets: [{ label: 'mcp.json', language: 'json', content: jsonMcp(s, d) }],
      prompt: true
    },
    {
      id: 'gemini', name: 'Gemini CLI', tag: 'CLI · local',
      where: '.gemini/settings.json',
      blurb: 'Same mcpServers shape as the repo scaffold — project or ~/.gemini/settings.json for user scope.',
      snippets: [{ label: 'settings.json', language: 'json', content: jsonMcp(s, d) }],
      prompt: true
    },
    {
      id: 'hermes', name: 'Hermes / any MCP client', tag: 'bot · local or VPS',
      where: 'client mcp config',
      blurb: 'Generic stdio MCP registration for Hermes, OpenCode, custom bots or scripts. On a VPS, clone the repo and run `node tools/keepmind-mcp.mjs --dir ./memory` instead — the script ships inside the repo.',
      snippets: [
        { label: 'mcpServers JSON', language: 'json', content: jsonMcp(s, d) },
        { label: 'remote/VPS (repo clone)', language: 'bash', content: cloneSnippet }
      ],
      prompt: true
    },
    {
      id: 'chatgpt', name: 'ChatGPT', tag: 'web · no shell',
      where: 'paste prompt in chat',
      blurb: 'No local MCP — connects through your GitHub repo. Paste the prompt; the agent reads/writes memory via git and returns a MEMORY BLOCK you paste back.',
      snippets: [],
      prompt: true,
      note: 'Needs the GitHub connector enabled in ChatGPT, or paste the MEMORY BLOCK it returns.'
    }
  ]
  return cards
}
