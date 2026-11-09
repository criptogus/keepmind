# KeepMind Corp

**KeepMind corporativo = o mesmo second brain (Today, Brain, Chat, Skills, Security) + governança da empresa.**

O app de desktop gratuito continua o produto individual. A edição Corp roda no browser na sua VPC: a UI do KeepMind em `/brain/`, com política de provedores, autonomia, BYOK e auditoria vindas da organização. Donos e admins abrem **governança** em `/admin/` (pessoas, agentes, varredura).

Desenho completo: [`docs/ENTERPRISE.md`](../docs/ENTERPRISE.md).

## O que você vê depois do login

| Rota | Quem | O quê |
|------|------|--------|
| `/brain/` | Todos | **Second brain** — mesma interface KeepMind, memória em `people/<id>/memory/` + camada `shared/memory/` |
| `/admin/` | Dono, admin | **Governança** — SSO, política, times, agentes, varredura, cofre bruto |

Membros não configuram chave de provedor na interface: a empresa traz BYOK no ambiente do servidor.

## Subir

```bash
npm run corp:build-brain   # compila a UI KeepMind (base /brain/)
KEEPMIND_CORP_OWNER_EMAIL=voce@empresa.com \
KEEPMIND_CORP_OWNER_PASSWORD='uma-senha-longa' \
npm run corp
```

Portal: `http://127.0.0.1:8787` → login → **KeepMind** em `/brain/`.

Docker: `docker compose up --build` dentro desta pasta (veja `.env.example`).

## Próximo passo (desktop Corp)

O mesmo núcleo pode empacotar como app Electron **KeepMind Corp** apontando para a política do servidor — o web já valida memória + governança sem fork da UX.

## Verificação

```bash
npm run corp:build-brain
npm run corp:check
```
