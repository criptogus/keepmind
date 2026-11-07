# Changelog

All notable changes to Second Brain are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.1] — 2026-11

### Added
- **Auto-updater** — packaged builds check GitHub Releases on launch and every 6h, download in the background, and offer one-click restart. Settings → Updates.
- **Chat history persistence** — conversations survive view switches and restarts (per-agent, local).
- Richer Markdown rendering in chat (headings, lists, todos, fenced code blocks) shared with Notes/Meetings preview.
- Copy button on assistant messages.
- Releases now ship macOS universal (Intel + Apple Silicon), Windows x64/ARM64 and Linux AppImage builds.

### Changed
- Neural background canvas runs in a lite mode and pauses when the window is hidden — much lower RAM/CPU footprint.

## [0.1.0] — 2026-11

### Added
- Local-first Electron app: Markdown memory synced bidirectionally with a private GitHub repo (source of truth).
- Tiered memory (short / medium / long-term) + nightly "sleep" learning cycle with 5-question review.
- Specialist agents (Buffett, Gates, Musk, Naval, Jobs + custom personas) and multi-agent **Meetings** that produce transcripts and action items.
- Today dashboard: daily intentions, tasks with due dates/priorities, quick notes.
- Natural-language automations (daily / interval / weekly crons).
- AI providers: bundled local llama.cpp model, Codex/ChatGPT sign-in, Claude Pro/Max token, Anthropic, OpenAI, Gemini, Grok, Ollama.
- Local accounts (SQLite + scrypt) and Google sign-in (PKCE loopback).
- Local semantic memory (RAG) with BGE/Nomic embeddings via llama.cpp.
- MCP connectors: WhatsApp (QR), Telegram, Postgres read-only, custom servers.
- Stripe Pro plan ($19/mo) support.
