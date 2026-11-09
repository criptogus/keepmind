// Builds the copy-paste prompt that connects an external LLM (Claude, Codex,
// Grok, Gemini, ChatGPT…) to the user's KeepMind GitHub repo.

export function buildConnectPrompt(repoUrl: string): string {
  const repo = repoUrl?.replace(/\.git$/, '') ?? 'YOUR_SECOND_BRAIN_REPO_URL'
  return `You are now connected to my "KeepMind" — a private GitHub repository that is my long-term memory. From now on, use it like a persistent memory across every session, shared with my KeepMind desktop app.

REPOSITORY: ${repo}

## Memory layout (human-brain style tiers)
The repo keeps memory in tiers under \`memory/\`:
- \`short-term/YYYY-MM-DD.md\` — raw daily logs (working memory). THIS is where you write.
- \`medium-term/YYYY-Www.md\` — weekly consolidations (written by the app's sleep cycle; don't touch)
- \`long-term/\` — durable facts, lessons and skills (app-managed; read freely, append only if clearly durable)
- \`insights/\`, \`summaries/\`, \`sleep/\` — generated reports (read-only for you)
- \`notes/\`, \`tasks/\`, \`daily/\` — user notes, to-dos and daily goals
- \`entities/\` — knowledge graph: one page per person/project/topic with [[wikilinks]]
- \`review/\` — spaced-repetition flashcards and quiz sessions
- \`skills/\` — procedural skills (reusable "how we do X" pages)
- \`crm/\` — people/, companies/, interactions/ relationship memory
- \`ops/\` — operational logs incl. search-gaps.md (queries that found nothing)
- \`long-term/decisions.md\` — decision ledger (append via remember kind=decision)
- Notes may have YAML frontmatter (\`summary:\`, \`tags:\`, \`links:\`) — preserve it when editing
- \`tools/keepmind-mcp.mjs\` — zero-dep MCP server; if you support MCP, prefer it over raw file edits:
  \`node tools/keepmind-mcp.mjs --dir ./memory\` exposes sb_search / sb_read / sb_write / sb_remember / sb_tasks

## Setup (do once)
- Clone the repo locally, or access it via the GitHub API / \`gh\` CLI / GitHub MCP if you have one.
- Read \`memory/long-term/facts.md\`, \`memory/long-term/lessons.md\`, \`memory/long-term/skills.md\` and the last few \`short-term/\` logs to load context.
- The app syncs this repo continuously — anything you push is pulled into my KeepMind automatically, and vice versa. Always \`git pull\` before reading and \`git push\` after writing.
- If \`memory/INDEX.md\` does not exist, create it — a markdown table of contents of everything stored.

## Every session
- BEFORE answering anything about me, my work, or my projects: read the relevant memory files first.
- AFTER completing meaningful work: APPEND a memory entry. Never rewrite or delete existing entries.

## What to save
Append to \`memory/short-term/YYYY-MM-DD.md\` under a heading \`## HH:MM — <source>\` (e.g. \`claude-code\`, \`chatgpt\`, \`gemini\`). Save:
- Decisions made and the reasoning behind them
- Work output: emails sent (subject + gist), documents produced (PDFs, decks, reports — title + summary/path), code shipped, PRs, deploys
- Insights, lessons learned, things I said I would do
- Personal context when relevant: health, family, preferences, goals, finances

## Rules
- Markdown only. Append-only. One file per day per source.
- Keep entries concise — bullets, not essays. Link artifacts by path or URL.
- Secrets, passwords, API keys and credentials are NEVER saved.
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
  const { mcpScript: s, memoryDir: d, repoUrl } = info
  const cards: AgentCard[] = [
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
      id: 'cursor', name: 'Cursor', tag: 'IDE · local',
      where: '.cursor/mcp.json',
      blurb: 'Paste into the project (or ~/.cursor/mcp.json for global) — Cursor spawns the memory server per workspace.',
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
        { label: 'remote/VPS (repo clone)', language: 'bash', content: `git clone ${repoUrl ?? '<your-repo-url>'}\ncd second-brain-vault\nnode tools/keepmind-mcp.mjs --dir ./memory` }
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
    },
    {
      id: 'grok', name: 'Grok', tag: 'web / bot · VPS',
      where: 'paste prompt · or bot with shell',
      blurb: 'X/Grok web has no shell — use the prompt. A Grok bot on a VPS with shell access can clone the repo and run the bundled MCP server directly.',
      snippets: [
        { label: 'bot on VPS (repo clone)', language: 'bash', content: `git clone ${repoUrl ?? '<your-repo-url>'}\ncd second-brain-vault\nnode tools/keepmind-mcp.mjs --dir ./memory` }
      ],
      prompt: true
    }
  ]
  return cards
}
