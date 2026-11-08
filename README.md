<div align="center">

<img src="build/icon.png" width="120" alt="Second Brain logo" />

# 🧠 Second Brain

**An open-source, LLM-agnostic second brain.**
Plug *any* LLM — local llama.cpp, Claude, Codex, GPT, Gemini, Grok, Ollama —
into persistent memory stored as plain Markdown in **your own GitHub repo**.
Your knowledge is independent of any model: swap providers anytime, nothing is forgotten.
Runs on your desktop, a VPS, or a bot's own VM.

[![License: MIT](https://img.shields.io/badge/License-MIT-cyan.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![llama.cpp](https://img.shields.io/badge/Local%20LLM-llama.cpp-22d3ee)](https://github.com/ggml-org/llama.cpp)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-a78bfa)](https://modelcontextprotocol.io/)
[![CI](https://github.com/criptogus/second-brain-app/actions/workflows/ci.yml/badge.svg)](https://github.com/criptogus/second-brain-app/actions/workflows/ci.yml)

![Platform](https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-supported-brightgreen)

</div>

---

## What it does

Second Brain is a persistent memory layer that works with **any LLM** — the model is a
replaceable runtime, the repo is the brain:

- **🔀 LLM-agnostic** — bundled [llama.cpp](https://github.com/ggml-org/llama.cpp) local model (fully offline), **Codex/ChatGPT sign-in**, **Claude Pro/Max** via `claude setup-token`, plus API keys for Anthropic, OpenAI, Gemini, Grok (xAI) and Ollama. Change providers whenever you want.
- **📦 Knowledge outlives models** — every conversation, insight and summary is Markdown in a **private GitHub repo created for you** via OAuth device flow. Not weights in a provider's silo — files you own, versioned and portable. Any AI that can read a repo can use it.
- **🖥️ Runs anywhere** — desktop app (Electron) on macOS/Windows/Linux, headless on a VPS, or installed by an agent on its own VM. A GitHub repo is the only hard requirement — it's the durable memory backend every LLM workflow already speaks.
- **🔌 Connectors (MCP)** — a generic MCP stdio client plus bundled servers: WhatsApp via QR (Baileys), Telegram bot, Postgres read-only, and *any* custom MCP server. LLMs call connector tools natively.
- **🧠 Second Brain MCP server** — the repo ships its own zero-dependency MCP server (`tools/second-brain-mcp.mjs`, Node 18+). Claude Code, Codex, Gemini CLI, Grok or any MCP client connects with one command and gets `sb_search` / `sb_read` / `sb_write` / `sb_remember` / `sb_tasks` — structured memory access, not just raw files.
- **📄 Agent-ready repo** — on connect, the app pushes `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.mcp.json` and the MCP server into your repo. Codex/Claude/Grok discover and use the memory automatically — no prompt-pasting needed.
- **🧹 Weekly librarian** — a scheduled hygiene pass (consolidate old logs, dedupe long-term memory, refresh entities) keeps the knowledge base clean on its own.
- **🕸️ Entity layer** — recurring people/projects/topics get their own page in `memory/entities/` with `[[wikilinks]]` — a lightweight knowledge graph in plain Markdown.
- **🔁 Continuous GitHub sync** — the repo is the source of truth: every local memory write pushes in seconds, remote changes (written by Claude, Codex, Grok, or a bot on a VPS…) pull down automatically, before every chat.
- **🧠 Tiered memory + sleep cycles** — short/medium/long-term memory like a real brain. The nightly "sleep" cycle reviews the day (what works, what to fix, what to stop, what to start) and distills facts, lessons and reusable skills into long-term memory.
- **⚡ Natural-language automations** — "every day at 8am summarize my whatsapp" becomes a scheduled cron. Daily/interval/weekly, pause/resume/run-now.
- **🔐 Local accounts + Google sign-in** — SQLite auth (scrypt), PKCE loopback Google OAuth, session tokens. Your data stays on your machine.
- **🧮 Local semantic memory (RAG)** — optional embedding model (BGE/Nomic via llama.cpp) gives the brain meaning-based recall over everything it remembers — fully offline.
- **🤖 More AI providers** — bundled local model, **Codex/ChatGPT sign-in** (reuses `codex login`), **Claude Pro/Max** via `claude setup-token`, plus API keys for Anthropic, OpenAI, Gemini, Grok (xAI) and Ollama.
- **💳 Pro plan** — $19/mo via Stripe Payment Link (configurable in Settings).
- **📅 Today command center** — daily intentions, open tasks and quick notes on one screen. The app opens here every morning.
- **📝 Notes** — Markdown notes in `memory/notes/`, synced and readable by every connected AI.
- **✅ Tasks** — lightweight to-dos with due dates and priorities in `memory/tasks/`.
- **🗣️ Agent meetings** — convene your specialists (Warren, Elon, your custom agents…) in a roundtable: they debate your topic live, the moderator extracts consensus and action items straight into Tasks.
- **🎭 Specialist agents** — chat with Warren Buffett, Bill Gates, Elon Musk, Naval Ravikant, Steve Jobs — or build your own personas. They answer with your full second-brain context.
- **✨ Neural UI** — a procedural synapse visualization (cyan/lime/amber on black) that literally *fires* when things happen in the app.
- **📋 Insights & daily summaries** — the brain analyzes your memory and surfaces what matters, automatically once a day.
- **🤖 Plug in your other AIs** — one copy-paste prompt teaches Claude, Codex, Grok or Gemini to read/write memory in your repo (emails sent, PDFs made, decisions — everything remembered).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     RENDERER (React)                     │
│  BrainCore canvas · Chat · Dashboard · Agents · Wizard   │
└──────────────────────────┬──────────────────────────────┘
                           │ contextBridge (preload)
┌──────────────────────────▼──────────────────────────────┐
│                     MAIN PROCESS (Node)                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │  Brain   │ │   LLM    │ │  GitHub  │ │  MCP Mgr    │ │
│  │ memory/  │ │ multi-   │ │ OAuth +  │ │ whatsapp ·  │ │
│  │ insights │ │ provider │ │ repo sync│ │ telegram ·  │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ │ postgres ·  │ │
│       │            │            │       │ custom      │ │
│  ┌────┴────────────┴────────────┴───────┴──────┬──────┘ │
│  │ GitSync ⇄ repo · Auth (SQLite) · Automations │        │
│  │ scheduler · Librarian · Entities · RAG       │        │
│  │ scheduler · RAG embeddings (llama-server :8766)      │
│  └─────────────────────────────────────────────┴────────┘ │
└────────────────────────────────────────────────┼────────┘
                                                 │ stdio JSON-RPC
              ┌──────────────────────────────────┼───────────┐
              ▼                                  ▼           ▼
      ┌───────────────┐              ┌────────────────┐  ┌─────────┐
      │ llama-server  │              │ whatsapp MCP   │  │ npx MCP │
      │ (local GGUF)  │              │ (Baileys/QR)   │  │ servers │
      └───────────────┘              └────────────────┘  └─────────┘
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Quickstart

```bash
git clone https://github.com/criptogus/second-brain-app.git
cd second-brain-app
npm install
npm run dev        # development (electron-vite)
npm run build      # production build
npm run dist       # installers via electron-builder → dist/
```

Releases are built automatically by GitHub Actions on every `v*` tag —
see [`.github/workflows/release.yml`](.github/workflows/release.yml).
Download the latest build from
[Releases](https://github.com/criptogus/second-brain-app/releases).

First launch walks you through a 4-step wizard:

1. **GitHub** — device-flow OAuth → creates a private `second-brain-*` repo.
2. **AI** — pick the bundled local model (~2 GB download) or paste an API key.
3. **Connectors** — optional: WhatsApp QR, Telegram bot token, Postgres URL.
4. Done — start chatting. Insights and a daily summary generate automatically.

## Run on a VPS or a bot's VM

Second Brain is a great fit for always-on memory: an agent (Grok, Claude, your own
bot) can install it on a VM and every chat — human or AI — shares the same
GitHub-backed memory.

Electron needs a display server even with no window, so on headless Linux use
`xvfb` plus the built-in headless mode (services only — sync, MCP servers,
LLM, automations — no BrowserWindow):

```bash
# one-time deps on Debian/Ubuntu
sudo apt install xvfb

npm install && npm run build
npm run start:headless        # = xvfb-run + SECOND_BRAIN_HEADLESS=1

# or the packaged build:
xvfb-run -a env SECOND_BRAIN_HEADLESS=1 ./dist/linux-unpacked/second-brain
xvfb-run -a env SECOND_BRAIN_HEADLESS=1 "./dist/Second Brain-0.1.1.AppImage"
```

`SECOND_BRAIN_HEADLESS=1` (or `--headless`) skips window creation entirely —
ideal for bots: lower RAM, no GUI deps beyond xvfb. SIGTERM/SIGINT shut down
cleanly (stops MCP servers, sync and schedulers), so it works under systemd:

```ini
# /etc/systemd/system/second-brain.service
[Unit]
Description=Second Brain (headless)
After=network-online.target

[Service]
ExecStart=/usr/bin/xvfb-run -a /opt/second-brain/second-brain
Environment=SECOND_BRAIN_HEADLESS=1
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Point any MCP-capable agent at the same GitHub repo and it reads/writes the
same memory — that's the LLM-agnostic part.

## Memory layout (in your repo)

```
memory/
├── short-term/               # daily raw logs (working memory)
├── medium-term/              # weekly consolidations
├── long-term/                # facts.md, lessons.md, skills.md, notes/
├── sleep/                    # nightly learning reports
├── insights/  summaries/     # generated insights & daily summaries
├── notes/                    # user notes (Markdown)
├── tasks/                    # to-dos with due dates & priorities
├── daily/                    # daily intentions/goals
├── meetings/                 # specialist roundtable transcripts
├── entities/                 # knowledge graph: one page per entity + index
└── agents/                   # per-agent notes
```

External AIs (Claude, Codex, Grok, Gemini…) can plug into the same repo —
the app generates a ready-to-paste prompt under **Brain → Plug in your AI**.

### Connect Codex / Claude / Grok directly (MCP)

Every connected repo contains `tools/second-brain-mcp.mjs` — a zero-dependency
MCP server over your `memory/` directory. Any MCP-capable agent gets
structured memory tools:

```bash
# Claude Code — already wired via the .mcp.json the app pushes
# Codex CLI / Gemini CLI / any MCP client:
node tools/second-brain-mcp.mjs --dir ./memory

# or from this repo / npm:
npx second-brain-mcp --dir /path/to/your/memory-clone
```

Available tools: `sb_search` (search memory first), `sb_read`, `sb_write`,
`sb_append`, `sb_remember` (durable fact/lesson/skill), `sb_recent`,
`sb_list`, `sb_tree`, `sb_tasks` — plus `memory://` resources for browsing.

## Tech stack

| Layer | Tech |
|---|---|
| Desktop | Electron 33 |
| Renderer | React 18 + TypeScript + Vite (electron-vite) |
| Local LLM | llama.cpp `llama-server` + GGUF (Qwen2.5 / Llama 3.2 / SmolLM2) |
| Protocol | MCP (Model Context Protocol) — custom stdio client + bundled WhatsApp server (Baileys) |
| GitHub | OAuth device flow + Contents API |
| Storage | Markdown files → your private repo |

## Roadmap

- [x] Scheduled agents (natural-language automations + sleep cycles)
- [x] Local semantic memory (RAG via llama.cpp embeddings)
- [x] Codex/ChatGPT sign-in as an AI backend
- [x] MCP server exposing memory to external agents (Claude, Codex, Grok…)
- [x] Agent-ready repo scaffold (AGENTS.md, CLAUDE.md, .mcp.json, bundled MCP server)
- [x] Weekly librarian hygiene automation + entity/knowledge-graph layer
- [ ] Composio as a universal connector (Gmail, Calendar, Notion, Drive…)
- [ ] Semantic search inside the standalone MCP server (embeddings endpoint)
- [ ] Real `git clone/push` sync in addition to the Contents API
- [ ] Mobile companion (read-only memory viewer)

## ⚠️ Notes & risks

- **WhatsApp** uses [Baileys](https://github.com/WhiskeySockets/Baileys), an *unofficial* library. WhatsApp may ban numbers that automate heavily. The connector is strictly opt-in.
- **Postgres** connector is read-only by design.
- Local models need RAM: ~4 GB (1.7B), ~6 GB (3B), ~12 GB+ (7B).

## Contributing

PRs welcome! Please open an issue first for big changes. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Second Brain contributors
