# Second Brain 🧠

> Um second brain open-source, instalável (Electron), que conecta seus apps,
> guarda tudo na **sua** memória (um repo GitHub seu) e conversa com você
> através de agentes especialistas — com IA que pode rodar **local no seu PC**.

## O que ele faz

- **Memória persistente** — tudo que importa vira Markdown num repositório
  **privado seu no GitHub**. Portável, seu, versionado.
- **IA local embutida** — baixa o `llama.cpp` + um modelo GGUF open-source
  (Qwen2.5, Llama 3.2, SmolLM2) e roda offline. Também aceita Claude, OpenAI,
  Gemini ou Ollama via API key (BYOK).
- **Conectores MCP** — WhatsApp via QR code (Baileys, estilo WhatsApp Web),
  Telegram (bot oficial), Postgres (somente leitura) e qualquer servidor MCP.
- **Agentes especialistas** — Warren Buffett, Bill Gates, Elon Musk, Naval,
  Steve Jobs — todos respondendo com o contexto completo do seu second brain.
  Crie os seus.
- **Insights e resumos** — o cérebro gera insights acionáveis e resumos diários
  a partir da sua memória.
- **Interface neural** — canvas de sinapses em azul elétrico sobre fundo preto;
  cada atividade "dispara" neurônios.

## Stack

- **Electron + React + TypeScript** (electron-vite)
- **llama.cpp** (`llama-server`) para LLM local open-source
- **MCP** (Model Context Protocol) — cliente stdio próprio + servidor
  WhatsApp bundled (Baileys)
- **GitHub REST API** — OAuth device flow + sync de memória

## Desenvolvimento

```bash
npm install
npm run dev        # electron-vite dev
npm run build      # build de produção
npm run typecheck
npm run dist       # electron-builder → dist/
```

## Setup do GitHub OAuth (para releases)

O device flow precisa de um **OAuth App** no GitHub:

1. GitHub → Settings → Developer settings → OAuth Apps → New
2. Homepage URL qualquer (ex: `https://secondbrain.dev`), sem callback
3. Copie o **Client ID** e defina no build:
   `SECOND_BRAIN_GH_CLIENT_ID=Ov23li... npm run dist`
   ou edite `CLIENT_ID` em `src/main/services/github.ts`.

## Avisos

- **WhatsApp**: Baileys é não-oficial. O WhatsApp pode banir números que
  automatizam pesado. Use por sua conta e risco — o conector é opt-in.
- **Postgres**: o server-postgres oficial é read-only por design.
- Modelos locais precisam de RAM: ~4GB (1.7B), ~6GB (3B), ~10GB+ (7B).

## Roadmap

- [ ] Composio como conector universal (Gmail, Calendar, Notion, Drive…)
- [ ] Claude Code / Codex CLI como "cérebro" opcional
- [ ] Embeddings locais para busca semântica na memória
- [ ] Sync incremental via git (clone/push) além da Contents API
- [ ] Agentes agendados (cron) — ex: resumo diário automático

## Licença

MIT
