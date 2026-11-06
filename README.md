<div align="center">

# 🧠 Second Brain

**A local-first, open-source "second brain" for your desktop.**
It connects your apps, remembers everything in *your own* GitHub repo,
and thinks with you through specialist AI agents — running fully offline if you want.

[![License: MIT](https://img.shields.io/badge/License-MIT-cyan.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![llama.cpp](https://img.shields.io/badge/Local%20LLM-llama.cpp-22d3ee)](https://github.com/ggml-org/llama.cpp)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-a78bfa)](https://modelcontextprotocol.io/)

![Platform](https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-supported-brightgreen)

</div>

---

## What it does

Second Brain is a desktop app (Electron) that gives you a persistent, *yours-only* AI memory:

- **🧠 Local AI, zero cloud required** — bundles [llama.cpp](https://github.com/ggml-org/llama.cpp) and downloads an open-source GGUF model (Qwen2.5, Llama 3.2, SmolLM2) on first run. Works fully offline. Claude / OpenAI / Gemini / Ollama also supported via BYOK.
- **💾 Memory you own** — every conversation, insight and summary is stored as Markdown in a **private GitHub repo created for you** via OAuth device flow. Portable, versioned, yours.
- **🔌 Connectors (MCP)** — WhatsApp via QR code (Baileys), Telegram bot, Postgres read-only, and *any* custom MCP server you add.
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
│       └────────────┴────────────┴───────┴──────┬──────┘ │
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

First launch walks you through a 4-step wizard:

1. **GitHub** — device-flow OAuth → creates a private `second-brain-*` repo.
2. **AI** — pick the bundled local model (~2 GB download) or paste an API key.
3. **Connectors** — optional: WhatsApp QR, Telegram bot token, Postgres URL.
4. Done — start chatting. Insights and a daily summary generate automatically.

## Memory layout (in your repo)

```
memory/
├── INDEX.md                  # table of contents (created on demand)
├── inbox/YYYY-MM-DD.md       # daily conversation logs (append-only)
├── insights/YYYY-MM-DD.md    # generated insights
├── summaries/YYYY-MM-DD.md   # daily summaries
└── agents/                   # per-agent notes
```

External AIs (Claude, Codex, Grok, Gemini…) can plug into the same repo —
the app generates a ready-to-paste prompt under **Brain → Plug in your AI**.

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

- [ ] Composio as a universal connector (Gmail, Calendar, Notion, Drive…)
- [ ] Claude Code / Codex CLI as an optional "brain" backend
- [ ] Local embeddings for semantic memory search
- [ ] Real `git clone/push` sync in addition to the Contents API
- [ ] Scheduled agents (cron) — e.g. automatic daily briefings

## ⚠️ Notes & risks

- **WhatsApp** uses [Baileys](https://github.com/WhiskeySockets/Baileys), an *unofficial* library. WhatsApp may ban numbers that automate heavily. The connector is strictly opt-in.
- **Postgres** connector is read-only by design.
- Local models need RAM: ~4 GB (1.7B), ~6 GB (3B), ~12 GB+ (7B).

## Contributing

PRs welcome! Please open an issue first for big changes. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Second Brain contributors
