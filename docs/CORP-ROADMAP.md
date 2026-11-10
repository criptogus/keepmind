# KeepMind Corp — roadmap (v0.2+)

> Comparação honesta com o que existe hoje e para onde vamos.

## Status por versão

| Versão | Foco | Estado |
|--------|------|--------|
| **v0.1** (`corp-v01`) | Onboarding, Electron, brain + `/admin/` | ✅ Release |
| **v0.2** | BYOK admin, chat OpenAI, agentes autonomia | ✅ PR #7 |
| **v0.3** | Backup, SSO admin, busca híbrida, RAG no chat, ABAC `shared/`, import/export memória | 🚧 Esta branch |
| **v0.4** | MCP runtime, sync desktop, metering agentes | Planejado |

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

## v0.4 (próximo)

- Worker MCP corporativo com auditoria por tool call  
- Embeddings / busca semântica real  
- Conector KeepMind desktop → Corp (push inbox/skills)  
- Registro de agentes externos + quotas (Paperclip-light)  
