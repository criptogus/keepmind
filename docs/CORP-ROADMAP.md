# KeepMind Corp — roadmap (v0.2 → v1.0)

> Estado final desta linha de release (PR #7).

## Status por versão

| Versão | Foco | Estado |
|--------|------|--------|
| **v0.1** (`corp-v01`) | Onboarding, Electron, brain + `/admin/` | ✅ |
| **v0.2** | BYOK, chat OpenAI, agentes | ✅ |
| **v0.3** | Backup, SSO, busca híbrida, RAG, ABAC `shared/`, import/export | ✅ |
| **v0.4** | Tokens sync, corp-push, rerank, Composer | ✅ |
| **v0.5** | MCP HTTP + bridge, quotas, sync bidirecional | ✅ |
| **v0.6** | MCP stdio, sync agendado desktop, metering time | ✅ |
| **v0.7** | ABAC `people/`, GitHub corp, BYOK report | ✅ |
| **v0.8** | ABAC fino `memory/`, GitHub agendado + hook CI, export SIEM | ✅ |
| **v1.0** | Roadmap Corp fechado — tag `corp-v1.0` recomendada pós-merge | ✅ |

## v0.8 (entregue)

1. **ABAC fino** — prefixos `people/<id>/memory/...` validados na política  
2. **GitHub agendado** — scheduler servidor (tick 5 min) + `scheduleEnabled`  
3. **Hook CI** — `POST /api/hooks/github-sync` + header `X-KeepMind-Hook`  
4. **SIEM** — `GET /api/audit/export?format=ndjson|csv`

## Pós v1.0 (fora deste PR)

- Paperclip runtime completo (budget $, goals)  
- ABAC `people/` por time hierárquico  
- Instalador Corp auto-update canal estável  

## KeepMind pessoal ↔ Corp

| Capacidade | Status |
|------------|--------|
| Layout memória compatível | ✅ |
| Export/import API + corp-push/sync CLI | ✅ |
| Desktop Corp sync (Settings) | ✅ |
| Composer + corp-mcp stdio/bridge | ✅ |
