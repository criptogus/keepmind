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

## Primeira subida (onboarding)

Não há usuário embutido. Na **primeira vez**, o portal em `/` abre um assistente em 4 passos:

1. Explica o que é Corp (brain + governança).
2. Nome da organização.
3. Conta **owner** (nome + email).
4. Senha (mín. 12 caracteres).

Alternativa para automação: ainda vale `KEEPMIND_CORP_OWNER_EMAIL` e `KEEPMIND_CORP_OWNER_PASSWORD` no ambiente (pula o wizard se definidos antes do primeiro login).

Depois do login, um tour rápido no `/brain/` marca o onboarding do usuário como concluído.

## Subir (servidor web)

```bash
npm run corp:build-brain   # compila a UI KeepMind (base /brain/)
npm run corp
```

Portal: `http://127.0.0.1:8787` → onboarding ou login → **KeepMind** em `/brain/`.

Docker (compila o `/brain/` na imagem):

```bash
docker compose -f corp/docker-compose.yml up --build
```

Na primeira vez, abra `http://localhost:8787/` e conclua o onboarding (owner não é obrigatório no `.env`).

## App desktop (Windows, macOS, Linux)

O pacote **KeepMind Corp** embute o servidor Node e abre a janela no portal local. Dados em `userData/keepmind-corp/`.

```bash
npm run dist:corp:mac    # ou dist:corp:win / dist:corp:linux / dist:corp
```

Saída em `dist-corp/`. Cada máquina faz o onboarding na primeira execução (conta owner + nome da org).

## Verificação

```bash
npm run corp:build-brain
npm run corp:check
```
