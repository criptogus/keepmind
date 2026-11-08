import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GitHubConfig } from '../store'
import * as github from './github'

// ── Repo scaffold: files that teach ANY agent how to use this memory repo ──
//
// Pushed once to the user's GitHub repo (repo root, outside memory/):
//   AGENTS.md              — layout + conventions + MCP tools (read by Codex,
//                            Claude Code, Cursor, Gemini CLI, OpenCode…)
//   CLAUDE.md              — @AGENTS.md import for Claude Code
//   GEMINI.md              — pointer for Gemini CLI
//   .mcp.json              — registers the bundled memory MCP server
//   tools/keepmind-mcp.mjs — zero-dep MCP server shipped IN the repo,
//                            so `git clone` + `node tools/...` is all a bot needs

const AGENTS_MD = `# KeepMind — agent guide

This repository is a **KeepMind memory store**. Everything under \`memory/\`
is durable knowledge written and read by AI agents. Treat it as the user's
long-term memory: read before answering, write what matters.

## Layout (memory/)

| Path | Contents |
|---|---|
| \`short-term/\` | daily raw logs — recent working memory |
| \`medium-term/\` | weekly consolidations |
| \`long-term/\` | \`facts.md\`, \`lessons.md\`, \`skills.md\`, \`notes/\` — permanent memory |
| \`sleep/\` | nightly learning reports |
| \`insights/\`, \`summaries/\` | generated insights & daily summaries |
| \`notes/\` | user notes (Markdown) |
| \`tasks/\` | to-dos — \`# Title\` + \`> status: open · priority: … · due: …\` meta line |
| \`daily/\` | daily intentions/goals |
| \`meetings/\` | legacy roundtable transcripts |
| \`entities/\` | one page per person/project/topic, linked with \`[[Name]]\` |
| \`review/\` | spaced-repetition flashcards (\`cards.md\`) + quiz sessions |

## MCP server (recommended)

This repo ships its own memory server — zero dependencies, Node 18+:

\`\`\`bash
node tools/keepmind-mcp.mjs --dir ./memory
\`\`\`

Tools: \`sb_search\` (search memory first!), \`sb_read\`, \`sb_write\`,
\`sb_append\`, \`sb_remember\` (durable fact/lesson/skill), \`sb_recent\`,
\`sb_list\`, \`sb_tree\`, \`sb_tasks\`, \`sb_query\` (structured filters:
tasks by status/priority/due, notes by tag, entities by text).

Claude Code picks it up automatically via \`.mcp.json\`. Codex, Gemini CLI,
OpenCode or any MCP client can spawn the same command.

## Conventions

- Markdown only. One fact per bullet in \`long-term/\` files.
- Tasks: first line \`# Title\`, second line \`> status: open|done · priority: low|normal|high · due: YYYY-MM-DD · created: ISO\`.
- Notes may carry YAML frontmatter (\`summary:\`, \`tags:\`, \`links:\`, \`enriched:\`) — preserve it when editing.
- Link recurring people/projects/topics with \`[[Name]]\` — entity pages live in \`memory/entities/\`.
- Write in the user's language. Keep entries dated and concise.
- Prefer \`sb_remember\` for durable facts — it lands in the right long-term file.
`

const MCP_JSON = JSON.stringify({
  mcpServers: {
    'keepmind': {
      command: 'node',
      args: ['tools/keepmind-mcp.mjs', '--dir', './memory']
    }
  }
}, null, 2) + '\n'

// Cursor reads .cursor/mcp.json; Gemini CLI reads .gemini/settings.json —
// same mcpServers shape, so agents in those tools connect with zero config.
const CURSOR_MCP_JSON = MCP_JSON
const GEMINI_SETTINGS = JSON.stringify({
  mcpServers: {
    keepmind: {
      command: 'node',
      args: ['tools/keepmind-mcp.mjs', '--dir', './memory']
    }
  }
}, null, 2) + '\n'

function mcpServerSource(): string {
  // tools/keepmind-mcp.mjs ships inside the app bundle (and the repo)
  const candidates = [
    join(__dirname, '../../tools/keepmind-mcp.mjs'),
    join(__dirname, '../../../tools/keepmind-mcp.mjs'),
    join(process.cwd(), 'tools/keepmind-mcp.mjs')
  ]
  for (const p of candidates) {
    try { return readFileSync(p, 'utf8') } catch { /* try next */ }
  }
  throw new Error('keepmind-mcp.mjs not found')
}

export async function ensureRepoScaffold(gh: GitHubConfig): Promise<string[]> {
  if (!gh.accessToken || !gh.repoOwner) return []
  const [root, tools] = await Promise.all([
    github.listRepoFiles(gh, ''),
    github.listRepoFiles(gh, 'tools')
  ])
  const files: Array<[string, string]> = [
    ['AGENTS.md', AGENTS_MD],
    ['CLAUDE.md', '@AGENTS.md\n'],
    ['GEMINI.md', 'Read AGENTS.md — it documents this KeepMind memory repo, its layout under memory/, conventions, and the bundled MCP server (tools/keepmind-mcp.mjs).\n'],
    ['.mcp.json', MCP_JSON],
    ['.cursor/mcp.json', CURSOR_MCP_JSON],
    ['.gemini/settings.json', GEMINI_SETTINGS],
    ['tools/keepmind-mcp.mjs', mcpServerSource()]
  ]

  const pushed: string[] = []
  for (const [path, content] of files) {
    const base = path.split('/').pop()!
    const inTools = path.startsWith('tools/')
    const exists = inTools ? tools.includes(path) || tools.includes(base) : root.includes(path) || root.includes(base)
    if (exists) continue
    await github.pushFile(gh, path, content, 'scaffold: agent onboarding files')
    pushed.push(path)
  }
  return pushed
}
