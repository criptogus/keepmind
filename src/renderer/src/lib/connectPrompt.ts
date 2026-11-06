// Builds the copy-paste prompt that connects an external LLM (Claude, Codex,
// Grok, Gemini, ChatGPT…) to the user's Second Brain GitHub repo.

export function buildConnectPrompt(repoUrl: string): string {
  const repo = repoUrl?.replace(/\.git$/, '') ?? 'YOUR_SECOND_BRAIN_REPO_URL'
  return `You are now connected to my "Second Brain" — a private GitHub repository that is my long-term memory. From now on, use it like a persistent memory across every session.

REPOSITORY: ${repo}

## Setup (do once)
- Clone the repo locally, or access it via the GitHub API / \`gh\` CLI / GitHub MCP if you have one.
- Read \`memory/\` to load context: \`inbox/\` (daily logs), \`insights/\`, \`summaries/\`, \`agents/\`.
- If \`memory/INDEX.md\` does not exist, create it — a markdown table of contents of everything stored.

## Every session
- BEFORE answering anything about me, my work, or my projects: read the relevant memory files first.
- AFTER completing meaningful work: APPEND a memory entry. Never rewrite or delete existing entries.

## What to save
Append to \`memory/inbox/YYYY-MM-DD.md\` under a heading \`## HH:MM — <source>\` (e.g. \`claude-code\`, \`chatgpt\`, \`gemini\`). Save:
- Decisions made and the reasoning behind them
- Work output: emails sent (subject + gist), documents produced (PDFs, decks, reports — title + summary/path), code shipped, PRs, deploys
- Insights, lessons learned, things I said I would do
- Personal context when relevant: health, family, preferences, goals, finances

## Rules
- Markdown only. Append-only. One file per day per source.
- Keep entries concise — bullets, not essays. Link artifacts by path or URL.
- Secrets, passwords and credentials are NEVER saved.
- Commit at the end of each session with message \`memory: YYYY-MM-DD <source>\`.
- If you cannot write to GitHub directly, end your reply with a \`## 🧠 MEMORY BLOCK\` section containing the exact markdown to append — I will paste it back.

Confirm you understand by listing the top 5 things you remember about me after reading the repo.`
}
