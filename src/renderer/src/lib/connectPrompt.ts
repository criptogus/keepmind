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
