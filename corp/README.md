# KeepMind Corp

**KeepMind corporativo = o mesmo second brain (Today, Brain, Chat, Skills, Security) + governança da empresa.**

O app de desktop **gratuito** (KeepMind pessoal) continua o produto individual. A edição **Corp** entrega o mesmo cérebro e as regras da empresa num **aplicativo de desktop instalável** (Windows, macOS, Linux): o servidor local sobe automaticamente — usuários finais e TI **não** precisam instalar Node, npm nem Docker.

Desenho completo: [`docs/ENTERPRISE.md`](../docs/ENTERPRISE.md).

## Por que instalar?

KeepMind Corp **não** é a versão gratuita para uso pessoal. É o **mesmo KeepMind** que você já conhece (memória em Markdown, chat, skills, segurança), mais **política da organização**: quem pode ver o quê, provedores de IA, autonomia dos agentes, SSO e auditoria.

Em vez de pedir que cada pessoa configure servidor ou container, o **app Corp** embute o servidor corporativo. Na primeira execução, um assistente cria a organização e a conta **owner**; depois disso, a equipe usa o cérebro em `/brain/` e a TI gere tudo em `/admin/` — tudo na máquina ou no ambiente que vocês escolherem, sem “subir um Docker” como caminho principal.

## Como instalar (usuários finais e TI)

1. Obtenha o instalador para o seu sistema (gerado pela equipe que mantém o repositório):
   - **macOS:** `.dmg` ou `.zip`
   - **Windows:** instalador `.exe` (NSIS)
   - **Linux:** `.AppImage`
2. Abra o app **KeepMind Corp**.
3. Na **primeira vez**, conclua o onboarding (nome da org, conta owner, senha).
4. Use o **KeepMind** em `/brain/`; donos e admins abrem **governança** em `/admin/`.

Dados locais ficam na pasta de dados do app (por exemplo `userData/keepmind-corp/` no Electron).

### Quem gera os instaladores

Quem desenvolve ou empacota o produto, a partir deste repositório:

```bash
npm run dist:corp:mac    # ou dist:corp:win / dist:corp:linux / dist:corp
```

Saída em `dist-corp/`. Configuração: [`electron-builder.corp.yml`](../electron-builder.corp.yml).

## O que você vê depois do login

| Rota | Quem | O quê |
|------|------|--------|
| `/brain/` | Todos | **Second brain** — mesma interface KeepMind, memória em `people/<id>/memory/` + camada `shared/memory/` |
| `/admin/` | Dono, admin | **Governança** — SSO, política, times, agentes, varredura, cofre bruto |

Membros não configuram chave de provedor na interface: a empresa traz BYOK no ambiente do servidor.

## Primeira execução (onboarding)

Não há usuário embutido. Na **primeira vez**, o portal abre um assistente em 4 passos:

1. Explica o que é Corp (brain + governança).
2. Nome da organização.
3. Conta **owner** (nome + email).
4. Senha (mín. 12 caracteres).

Alternativa para automação: `KEEPMIND_CORP_OWNER_EMAIL` e `KEEPMIND_CORP_OWNER_PASSWORD` no ambiente (pula o wizard se definidos antes do primeiro login).

Depois do login, um tour rápido no `/brain/` marca o onboarding do usuário como concluído.

## Desenvolvimento local (somente quem altera o código)

Para testar o servidor e a UI sem gerar instalador:

```bash
npm run corp:build-brain   # compila a UI KeepMind (base /brain/)
npm run corp
```

Portal: `http://127.0.0.1:8787` → onboarding ou login → **KeepMind** em `/brain/`.

## Verificação

```bash
npm run corp:build-brain
npm run corp:check
```

### Publicar instaladores (CI)

Tag no repositório dispara build nos três sistemas:

```bash
git tag corp-v0.1.0 && git push origin corp-v0.1.0
```

Artefatos ficam na **GitHub Release** ligada à tag (workflow `release-corp.yml`).
