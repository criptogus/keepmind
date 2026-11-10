# KeepMind Corp — roadmap (v0.2+)

> Comparação honesta com o que existe hoje (`corp-v01`) e para onde vamos.

## Perguntas frequentes

### Já temos gestão de agentes estilo Paperclip?

**Não no mesmo nível.** [Paperclip](https://paperclip.ing/) foca em **org chart de agentes**, metas, orçamento por agente e orquestração de “empresa de agentes”.

No Corp **hoje**:

| Paperclip (referência) | KeepMind Corp hoje |
|------------------------|-------------------|
| Org chart de agentes, metas, budget | Catálogo fixo (`brain`, `ingest`, `sync`) + ligar/desligar + `teamId` |
| BYO agents, runtime | Agentes **não executam** MCP/workers no servidor Corp |
| Custo por agente | Sem metering |
| Governança em runtime | Política de **provedor** + **autonomia** (teto org + por time) |

**v0.2–v0.3 (esta direção):** painel de agentes com descrição, time, autonomia máxima; BYOK no admin; chat real respeitando política.  
**v0.4+ (paridade Paperclip-light):** registrar agentes externos, quotas, fila de trabalho, ledger por agente.

### Governança de dados por cargo da empresa?

**Parcial.**

| Camada | Hoje | Próximo |
|--------|------|---------|
| **Papel (RBAC)** | `owner`, `admin`, `member`, `auditor` — quem edita política, vê cofre, audita | Mantido |
| **Partição de dados** | `people/<id>/` privado; `shared/`; owner/admin veem tudo; auditor vê ledger/scan, não corpo pessoal | Mantido |
| **Time** | `teamId` + autonomia por time (teto da org) | UI melhor |
| **Cargo (job title)** | Campo `title` em pessoas (metadado, **não** regra de acesso ainda) | v0.2 |
| **ABAC por cargo** | Não | Ex.: “Diretor vê pasta `shared/finance`” — v0.4 |

Governança de **conteúdo sensível** (segredos, PII) já existe via varredura + bloqueio de chave pessoal (BYOK).

### Second brain conectado com KeepMind?

**Mesmo produto de UI, cofres diferentes por enquanto.**

| Aspecto | Situação |
|---------|----------|
| Interface | Mesmo renderer (Today, Brain, Skills, …) via `corpShim` |
| Layout de memória | `people/<id>/memory/` compatível com o app pessoal |
| **Sync automático** | **Não** — KeepMind desktop usa repo/local do usuário; Corp usa vault do tenant |
| Caminho desejado | Export/import ou sync opcional pessoal → Corp (só política permitir); Corp como “modo trabalho” |

**v0.3:** documentar “levar memória para o Corp” (export de skills/inbox).  
**v0.4:** conector opcional desktop Corp-aware (mesmo login OIDC, push inbox).

---

## v0.2 (em andamento)

1. **BYOK no admin** — cadastro de chaves da org no cofre (`ops/org-secrets.json`), status mascarado, sem vazar em API.
2. **UI Corp enxuta** — esconder Connect/Crons que não têm backend Corp.
3. **Cargo (`title`)** em pessoas — preparar governança futura por área.
4. **Agentes** — coluna autonomia máxima por agente no JSON (persistido).
5. **Chat mínimo** — se política incluir `openai` e chave da org existir, resposta real (senão mensagem clara).

## v0.3

- Busca semântica / embeddings no vault Corp (ou delegar ao worker `brain`).
- OIDC assistido no admin (formulário, não só env).
- Backup/export do vault.

## v0.4

- Runtime de agentes (MCP) com `agents.write` + auditoria por execução.
- Regras por cargo/pasta (ABAC).
- Sync opcional KeepMind pessoal ↔ Corp.
