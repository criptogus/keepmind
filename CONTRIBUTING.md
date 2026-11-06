# Contributing

Thanks for your interest! Second Brain is early — issues and PRs are very welcome.

## Setup

```bash
npm install
npm run dev
```

## Checks before PR

```bash
npm run typecheck   # tsc for main+preload and renderer
npm run build       # electron-vite production build
```

## Guidelines

- TypeScript strict mode — keep it clean.
- Main-process code: Node/Electron APIs only; renderer: no Node access (use `window.sb` via preload).
- UI text is in **English**; keep the HUD/neural aesthetic (cyan/lime/amber on black, mono labels, pill shapes — no square menus).
- The brain canvas must stay cheap: sprite-based drawing, capped node/edge counts.
- Never commit secrets, tokens, or user data. WhatsApp session files live in `userData`, not the repo.
- Conventional-ish commit messages are appreciated.

## Areas looking for help

- Composio connector (Gmail/Calendar/Notion via one integration)
- Semantic search over memory (local embeddings)
- Scheduled agents (daily briefings, reminders)
- Real `git` sync alongside the Contents API
- Windows/Linux packaging polish (electron-builder)
