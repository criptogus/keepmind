# Architecture

Second Brain is an Electron app split into three processes plus spawned helpers.

## Processes

### Renderer (`src/renderer/`)
React 18 + TypeScript SPA, bundled by Vite via `electron-vite`.

- `components/BrainCore.tsx` — procedural neural canvas (~420 neurons in two
  hemispheres, static edges + traveling pulses). Pure Canvas2D, sprite-based
  glow for performance.
- `components/Wizard.tsx` — 4-step onboarding (GitHub OAuth → AI → connectors).
- `components/Chat.tsx` — agent rail + streaming chat (typing effect driven by
  `brain:delta` IPC events).
- `components/Dashboard.tsx` — neural stage + insights/summaries/memory.
- `components/Connectors.tsx` / `Settings.tsx` / `Agents.tsx`.
- `browserShim.ts` — demo stub when the renderer runs in a plain browser
  (no `window.sb`), so the UI is previewable at `localhost:5173`.

All renderer↔main calls go through `window.sb` (contextBridge in
`src/preload/index.ts`). No `nodeIntegration`.

### Main (`src/main/`)

- `store.ts` — JSON config in `userData/second-brain/config.json`
  (providers, GitHub tokens, MCP server list, agent personas).
- `services/llm.ts` — multi-provider chat: Anthropic, OpenAI-compatible
  (OpenAI, Ollama, llama-server), Gemini. Tool-calling loop lives in `brain.ts`.
- `services/local-llm.ts` — downloads the pinned `llama.cpp` release binary
  and GGUF models from HuggingFace into `userData/local-llm/`, spawns
  `llama-server` on `127.0.0.1:8765` with an OpenAI-compatible `/v1` API.
- `services/github.ts` — OAuth **device flow** + repo creation + file push via
  the Contents API (`memory/**` prefix).
- `services/mcp.ts` — minimal MCP client (JSON-RPC 2.0 over stdio, newline-
  delimited) + `McpManager` that resolves bundled vs npx/custom servers.
- `services/brain.ts` — `Memory` (markdown store, mirrored to GitHub) and
  `Brain` (system-context builder, tool definitions incl. routed MCP tools,
  agentic loop, insights, daily summary).
- `mcp/whatsapp-server.ts` — standalone MCP stdio server using Baileys;
  emits QR as a data-URL file polled by the renderer; buffers incoming
  messages for `whatsapp_messages`.

### Persistence

- Local memory: `userData/second-brain/memory/{inbox,insights,summaries,agents}/`
- Config: `userData/second-brain/config.json`
- WhatsApp session: `userData/mcp-sessions/whatsapp/` (Baileys auth state)
- Local LLM: `userData/local-llm/{bin,models}/`

Everything memory-related is mirrored to the user's private GitHub repo under
`memory/` so it survives reinstalls and is usable by external AIs.

## Data flow (chat)

1. Renderer → `brain:chat(agentId, message)` IPC.
2. `Brain.chat` builds system context (persona + connected sources + memory
   digest + recent insights) and tool definitions (save/get memory + all
   running MCP tools, namespaced `mcp_<server>_<tool>`).
3. Agentic loop (max 6 rounds): LLM → tool calls → execute (memory FS or
   `McpManager.callTool`) → append results → repeat.
4. Final answer type-written to renderer via `brain:delta` events.
5. Exchange appended to `memory/inbox/YYYY-MM-DD.md`; optional GitHub push.

## Security notes

- `contextIsolation: true`, `nodeIntegration: false`, CSP on the renderer.
- GitHub OAuth uses the device flow — tokens stay in `userData`, never in the repo.
- WhatsApp Baileys session is local-only; messages are buffered in memory.
- Postgres MCP server is read-only upstream.
- The bundled prompt for external AIs explicitly forbids saving secrets.
