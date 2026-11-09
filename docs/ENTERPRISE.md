# KeepMind Corp — Enterprise Edition (Roadmap)

> Status: **MVP slice is in `corp/`.** The desktop app stays the individual
> product. This document is still the design direction. The first slice is a
> self-hosted admin plane, not the full enterprise program (no SCIM, HSM,
> SOC 2 package, or managed SaaS yet).

## Thesis

KeepMind's core bet — *user-owned Markdown memory, synced to a repo the
customer controls, with LLMs as replaceable runtimes* — is unusually strong
for enterprise. The #1 corporate objection to AI memory products is data
sovereignty: "our data can't go to OpenAI/Anthropic." A vault that lives in
the customer's own GitHub/GitLab/S3, encrypted at rest, with BYOK/on-prem
providers, answers that objection natively. Most competitors (Notion AI,
Glean, etc.) cannot offer this.

The differentiator is not "another corporate RAG" — it is **agent memory as
customer-sovereign infrastructure**.

## What already exists and maps directly

| Enterprise need | Existing KeepMind primitive |
|---|---|
| DLP / data governance | Security scan: secrets + PII (CPF/CNPJ/email/phone), risk alerts, per-folder encryption selection |
| Encryption at rest | KMS1 AES-256-GCM, sealed keyfile, optional HMAC path obfuscation on remote sync |
| Audit trail | Activity ledger, job summaries, per-source write ledger |
| Agent governance | Autonomy modes: supervised → autopilot → autonomous (maps to per-team agent policy) |
| Source of truth | Plain Markdown in customer-owned repo — auditable, diffable, native backup, zero lock-in |
| Local models | Bundled llama.cpp + Ollama support → fully on-prem inference path |

## Gaps (the real work)

1. **Multi-user model** — today is single-user local-first. Corp needs either
   a shared team/org vault or partitioned per-user vaults with a common layer.
   Central decision: is memory *shared* (living company wiki) or *partitioned*
   (personal vaults + shared substrate)?
2. **Identity** — SSO (SAML/OIDC), SCIM provisioning, RBAC. Current Google
   login + local auth is insufficient; customers will bring Okta/Entra.
3. **Admin control plane** — web console: which agents/tools are connected,
   per-team token/cost quotas, provider kill-switch, retention policies.
4. **Enterprise key management** — KMS/HSM integration or envelope encryption
   with per-workspace keys, central rotation, recovery keys. (PR #1's
   `sync-crypto`/security-model docs sketch part of this.)
5. **Compliance** — SOC 2, ISO 27001, LGPD/GDPR: data residency, retention,
   legal hold, eDiscovery over the vault, DPA. The audit ledger + PII scan
   are good starting points.
6. **Packaging** — Electron desktop is not the enterprise form factor.
   Options: web app (the React renderer is already web-capable), self-hosted
   container, or managed SaaS.

## Deployment options

- **Self-hosted "KeepMind Enterprise"** (recommended first step): single
  Node container + web UI, vault in the customer's GitHub/GitLab repo or
  S3-compatible storage reusing existing sync/crypto primitives. License +
  support model. Lowest effort, and "runs in your VPC" is itself a selling
  point.
- **Managed SaaS with tenant isolation**: higher margin, much higher cost —
  billing, isolation, compliance overhead.
- **Hybrid**: desktop stays free/individual; Corp is the same brain core +
  admin plane + enterprise packaging.

## MVP scope (if/when validated)

- Self-hosted single-tenant deployment
- SSO (OIDC at minimum) + basic RBAC
- Admin console: connected agents, provider policy, autonomy policy per team
- Reuse existing vault crypto, PII/secret scanning, activity audit ledger
- BYOK provider config enforced org-wide (no shadow personal keys)

## Go-to-market note

The buyer is a security/compliance committee, not the individual dev who
adopts the desktop app. Validate demand with 2–3 companies before treating
this as a sold product — the "sovereign agent memory" narrative is real, but
the purchasing motion is different from the current one. The slice below
exists so that conversation can run against a real console.

## Decision recorded

Memory is **partitioned personal vaults plus a shared company layer**.

- `people/<id>/` is one person's memory. Another member cannot read it.
- `shared/` is the company layer.
- An owner or admin can see the whole tenant. An auditor sees the ledger and
  scan totals, not the body of a personal file.

The open question in the gaps list is settled for this slice by the partitioned model above.

## What the slice ships

`corp/` is a separate Node process and container: **the KeepMind second-brain
UI** at `/brain/` plus **organization governance** at `/admin/`. Run
`npm run corp:build-brain` then `npm run corp`, or `docker compose` in `corp/`.
See [`corp/README.md`](../corp/README.md).

- Single tenant, self-hosted.
- Same renderer as the desktop app (Today, Brain, Skills, Chat, Security) with
  a corporate API shim and policy in `getConfig().corp`.
- Local break-glass owner plus OIDC (authorization code + PKCE, RS256 tokens).
- Roles: owner, admin, member, auditor.
- Governance console: agents, provider allow-list, per-team autonomy ceiling,
  people, scan, audit.
- Personal memory under `people/<id>/memory/` (desktop-compatible layout) plus
  `shared/memory/` for the company layer.
- Secret / PII scan, `KMS1` skipped at preview, ledger at `ops/activity.jsonl`.
- Organization BYOK — personal provider keys blocked in policy payloads and UI.
