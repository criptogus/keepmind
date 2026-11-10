# KeepMind Corp — roadmap (v0.2+)

> Comparação honesta com o que existe hoje e para onde vamos.

## Status por versão

| Versão | Foco | Estado |
|--------|------|--------|
| **v0.1** (`corp-v01`) | Onboarding, Electron, brain + `/admin/` | ✅ Release |
| **v0.2** | BYOK admin, chat OpenAI, agentes autonomia | ✅ PR #7 |
| **v0.3** | Backup, SSO admin, busca híbrida, RAG no chat, ABAC `shared/`, import/export memória | ✅ PR #7 |
| **v0.4** | Tokens sync (Bearer), corp-push CLI, rerank semântico opcional, Composer conector | ✅ PR #7 |
| **v0.5** | MCP runtime HTTP + bridge, quotas agentes, sync bidirecional desktop/CLI | ✅ PR #7 |
| **v0.6** | MCP stdio in-process, sync agendado desktop, metering por time | 🚧 Esta branch |

## Paperclip vs Corp

Paperclip: org chart de agentes, metas, budget, runtime.  
Corp **hoje**: catálogo (`brain` / `composer` / `ingest` / `sync`), política, BYOK, auditoria, chat com memória injetada (RAG leve). **Composer** = conector Cursor Agent (MCP). **v0.4** aproxima runtime MCP.

## Governança por cargo

- **RBAC** + partição `people/` / `shared/` ✅  
- **Cargo** (`title`) em pessoas ✅  
- **ABAC** por prefixo em `shared/` (roles, times, títulos no JSON de política) ✅ v0.3  
- ABAC por pasta em `people/` — futuro  

## KeepMind pessoal ↔ Corp

- Layout de memória compatível ✅  
- **Export/import** via `/api/brain/export` e `/api/brain/import` (bundle JSON) ✅ v0.3  
- Sync automático desktop — v0.4  

## v0.3 entregue (esta release)

1. Backup `.tgz` do cofre (owner) — `/api/backup`  
2. SSO OIDC configurável no admin (sem depender só de env)  
3. Busca híbrica por relevância de termos  
4. Chat com trechos de memória (RAG leve)  
5. ABAC em pastas `shared/*`  
6. Briefing e export/import de memória pessoal  

## v0.4 (em andamento)

1. **Tokens de sync** — Admin → Sync; `Bearer` em `/api/brain/import|export` com agente **Sync** ligado  
2. **CLI** — `node tools/corp-push.mjs` (bundle ou pasta `memory/`)  
3. **Busca/chat** — rerank OpenAI (`embed-rerank.mjs`) quando há chave org + provedor `openai`  
4. **Composer** — conector Cursor Agent (card Connectors + rule `.cursor/rules/keepmind-memory.mdc`)

## v0.5 (entregue)

1. **MCP runtime** — `POST /api/mcp/call` + audit + `tools/corp-mcp-bridge.mjs`  
2. **Quotas** — `quotaDaily` por agente  
3. **Sync bidirecional** — `corp-sync.mjs` + Settings **Corp sync**

## v0.6 (em andamento)

1. **MCP stdio in-process** — `npm run corp:mcp` / `corp/mcp-stdio-worker.mjs` (vault local, sem HTTP)  
2. **Sync agendado** — intervalo no desktop quando **Corp sync** está enabled  
3. **Metering** — `budgetDaily` por time, **Admin → Metering**, unidades MCP/chat

## v0.7 (próximo)

- ABAC em `people/` por cargo  
- Sync Corp ↔ GitHub corporativo  
- Relatório de custo BYOK (tokens OpenAI estimados)  
