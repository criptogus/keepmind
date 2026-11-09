# KeepMind Corp

Edição para empresas, separada do app de desktop. O desenho está em [`docs/ENTERPRISE.md`](../docs/ENTERPRISE.md).

O desktop continua o produto individual. Este processo é um console de administração, auto-hospedado, de um único inquilino. Ele não abre o Electron e o Electron não lê esta política.

## Decisão de memória

O cofre é partido:

- `people/<id>/` — memória da pessoa. Outro membro não lê.
- `shared/` — o que a empresa compartilha.
- `ops/activity.jsonl` — trilha de auditoria, no mesmo formato de ledger do app.
- `ops/corp-policy.json` — política sem segredo, para o operador versionar no repositório do cliente.

## O que esta versão faz

- Login local do dono (break-glass) e SSO por OIDC, código de autorização com PKCE. O token de identidade precisa ser RS256, com `iss` e `aud` conferidos. Token sem assinatura é recusado.
- Papéis: dono, admin, membro, auditor.
- Console: agentes ligados, provedores permitidos, autonomia por time, pessoas, cofre, auditoria e varredura.
- Varredura de segredo e de PII (CPF, CNPJ, email, telefone) no mesmo espírito do app. O valor encontrado não sai na resposta. Arquivo que começa com `KMS1` é contado como cifrado e não é aberto.
- BYOK da empresa. O pedido que tenta gravar uma chave pessoal é recusado. A chave do provedor fica em variável de ambiente, fora deste arquivo.
- A retenção fica registrada. Esta versão não apaga o cofre sozinha.

Ainda ficam para um ciclo seguinte: SCIM, HSM, cota de custo, retenção automática, legal hold e o SaaS gerenciado.

## Subir

Na raiz do repositório:

```bash
KEEPMIND_CORP_OWNER_EMAIL=voce@empresa.com \
KEEPMIND_CORP_OWNER_PASSWORD='uma-senha-longa' \
npm run corp
```

O console abre em `http://127.0.0.1:8787`. Sem as duas variáveis, e sem um dono já criado, a tela avisa que o bootstrap falta. Não há senha padrão.

Com Docker, a partir desta pasta:

```bash
cp .env.example .env
# edite o email e a senha
docker compose up --build
```

OIDC é opcional. Quando as quatro variáveis `KEEPMIND_CORP_OIDC_ISSUER`, `CLIENT_ID`, `CLIENT_SECRET` e `REDIRECT_URI` existem, a tela mostra "Entrar com SSO". Quem chega no grupo `KEEPMIND_CORP_OIDC_ADMIN_GROUP` (padrão `keepmind-admins`) entra como admin. O dono local continua o acesso de emergência.

## Verificação

```bash
npm run corp:check
```
