# Private derived learnings

Implemented local CLI, native app recall and owner-scoped MCP service. All examples and tests are fictional.
No action here sends, exports or publishes anything; `check-public` is only advisory analysis of supplied text.

## Owner decisions

Derived learnings are **always private to the owner**, never shareable. There is no sharing option, public classification, receiving audience or publication action. The owner explicitly approved privacy and no expiry only. The implementation additionally requires explicit approval of each exact immutable draft; that approval flow is an assistant-proposed implementation safeguard, not an additional recorded owner decision. Suggesting, approving, checking and publishing are distinct actions. Only the first three exist here. MCP cannot approve, even with note-write authority or caller-supplied approval arguments.

## Proposed implementation defaults (not owner approvals)

The owner did not decide the lifecycle and independent-review questions. The coordinating assistant proposed these defaults, implemented here:

- Suspend when the source is deleted/unavailable or the user marks it wrong. Ordinary source edits set `sourceChanged` without suspension.
- A public-use check requires human review only when automatic analysis detects risk (including evidence unavailable). A clean check grants no publication authority and is not a guarantee of anonymity or lawful disclosure.

## Architecture and encrypted data model

`DerivedLearnings` stores `derived-learnings.box` under the local state directory, outside Markdown memory, using the existing XChaCha20-Poly1305 space-key implementation. The entire registry is encrypted under `general-knowledge`; provenance is additionally encrypted under the source-space key. Keys remain wrapped by the existing passphrase/recovery infrastructure. No plaintext fallback exists, including when legacy notes permit plaintext. Random UUIDs identify learnings. The registry never enters the normal Markdown index, GitHub sync, embeddings, activity journal or note tools.

Each immutable learning has sanitized owner-reviewed body, purpose, applicability/uncertainty, abstraction (`principle`), pending/active/suspended state and revision-bound approval digest/time (no expiration). Source path, space and content-version digest are inside encrypted provenance. Private lifecycle flags record changed, wrong and deleted/unverifiable evidence. Public-facing projections use an explicit allowlist and omit all provenance and source flags. There is currently one source per learning; multi-source partitioning is intentionally unsupported.

Suggestion is manual abstraction or a fixed deterministic procedural template when `--text` is omitted. Source text is never copied by automatic extraction; there is no model/provider/network dependency. This conservative baseline is not a semantic extraction engine. Draft text supplied by the owner still requires meaningful review for confidentiality, unsupported claims, applicability and re-identification before approval. The approval challenge binds body, purpose, limits and encrypted source version to one random learning ID. Edited source evidence prevents promotion of stale pending drafts. Approved bodies cannot be edited in place.

At retrieval the service checks the dependency locally, remembers deletion/unavailability as a sticky suspension, and excludes suspended/pending items from normal search. Restoration cannot automatically resurrect a suspended record. A changed source remains retrievable under the proposed default. No background rewriting or reapproval occurs. Registry corruption or locked keys fail closed. Dependency checks use a privileged local owner service; their results never expose evidence or source flags through ordinary search. Source details are an explicit action requiring current source-space authority. Missing and inaccessible provenance use the same generic error.

## Access boundaries

CLI is a trusted local owner interface using `--unlock-stdin`; selecting a space requires its configured key. General knowledge is available from any such owner scope, not a grant for other users. MCP requires trusted launcher configuration `owner: true`, at least one configured authorized space, `maxClass` at least internal, unlocked keys and explicit state directory. Default/shared/public clients have no derived-learning access. Client RPC arguments cannot set owner authority. The launcher must only grant owner to the user's private client, never a shared client. General MCP note tools cannot read or mutate the sealed registry. MCP exposes active list/search and public checking, without provenance or approval tools. Ordinary owner MCP search also includes active learning bodies. CLI ordinary search and `learnings search` include active learnings across the selected owner scope. Native app ordinary recall (`RagService.search`, used by chat) includes active private bodies in its existing heading/class/space/text format, including when no Markdown result matches. Native composition checks the current local session against the installation’s first account (user ID 1); signed-out and other accounts receive no owner capability. This identity callback is absent by default and cannot be supplied through search arguments or MCP RPC. Unlocked keys and configured current/granted spaces are still required. Pending/suspended records and provenance never enter recall; the sealed registry stays outside the index and embeddings.

The service decrypts selected source evidence only inside the local process; provenance is not returned with search snippets, metadata or checks. It does not change the existing Memory session classification floor. Source-space vocabulary checking examines only encrypted notes whose envelope belongs to the authorized source space; source identifiers, matched words, detector categories and counts are never returned. Corrupt/plaintext/uncheckable evidence fails closed. No real source content should be printed by operational scripts.

## CLI

All actions take `--dir <memory> --state <state> --space <owner-authorized-space> --unlock-stdin`:

- `learnings suggest --source <relative-note> [--text <abstract-draft>] --purpose <private-purpose> --limits <uncertainty>` returns a pending draft and approval digest.
- `learnings promote --id <uuid> --digest <exact-digest> --approve` explicitly approves that single draft. Omitting approval fails. This is a local owner capability, never an MCP tool.
- `learnings list`; `learnings search --query <text>` (active only).
- `learnings provenance --id <uuid>` requires source authority and intentionally exposes private source details only there.
- `learnings mark-source-wrong --id <uuid>` requires source authority and suspends retrieval.
- `learnings check-public --id <uuid> --text <final-candidate>` checks supplied surrounding text, never publishes.

## Re-identification checks and limits

Deterministic checks conservatively flag capitalized names, source vocabulary (including lower-case company/person names), numbers/amounts/dates, URLs/contact markers and distinctive-event vocabulary. Source-space evidence must be available; absent authority, deleted evidence, suspended learning, corruption, symlinks or plaintext evidence returns the same `review_required` result. A successful result is named `no_automatic_risk_detected`, never “safe to publish.” Both outcomes include `publicationAuthorized: false`.

Heuristics cannot prove anonymity, identify every rare situation, assess outside audience knowledge or infer lawful disclosure. Vocabulary overlap and capitalization intentionally overflag. The user must include all surrounding material in the candidate. Cumulative disclosure, independent human review workflow, revision editing, revocation tooling, distribution receipts, external exports and shared audiences are not implemented. None is authorized by this feature.

Tests use temporary fictional encrypted fixtures for approval boundaries, authority, redaction, lifecycle, at-rest encryption, containment and checker risks. State2 and source vaults are outside this review; no demonstration was rerun.

## Security review and validation limits

The deterministic local source-aware checker now gates suggestion and promotion independently for **body, purpose and applicability**. Risky drafts are rejected with a generic error before their text is returned or stored. Retrieval rechecks all three fields, including legacy drafts, and requires a revision-matching approval for cross-scope active results. This is conservative filtering, not proof of anonymization: obfuscation, paraphrase, outside knowledge and detector false negatives remain possible. It uses no cloud. The explicit source-details action intentionally reveals provenance only inside its authorized source scope.

Default list/search is active only. Explicit inactive listing is restricted to the source-authorized scope and still filters unsafe fields. Marking a source wrong suspends every stored revision linked to its exact source path and space, including pending ones. Authorization checks precede source lifecycle reads in ID-based actions; foreign pending records are not lifecycle-evaluated by listing. Cross-scope active availability necessarily reveals whether an approved learning is currently retrievable, but no reason or source flags are returned. Timing and filesystem contention are not constant-time or isolated per scope.

Registry read-modify-write operations use an exclusive filesystem lock and unique exclusive temporary files with atomic rename. Contention fails closed rather than retrying or overwriting a stale snapshot. A crash can leave a lock requiring trusted operator recovery; there is no automatic stale-lock bypass, fsync durability guarantee, or hostile-local-process isolation. Initial CLI registry key provisioning is persisted while holding that lock; read-only CLI commands no longer rewrite stale key configurations. Other application writers of key configuration do not participate in this lock.

Evidence paths and registry paths reject existing symlink components; evidence additionally requires lexical and real containment. Directory components are not pinned by file descriptors: malicious concurrent filesystem replacement (TOCTOU), hard links and an attacker who can write the owner state directory remain outside the trust boundary. No attempt is made to route around operating-system/tool blocks. Owner capability is trusted launcher configuration, not authentication inferred from RPC text; any code with the unlocked master keys can bypass service policy. Do not grant owner to shared clients.

MCP ordinary `search`/`sb_search` and `learning_search` are regression-tested against temporary fictional encrypted fixtures across owner spaces. Shared clients (including note writers), public-only clients, empty scopes and unknown scopes cannot elevate themselves using RPC arguments. Native ordinary app recall is covered by an automated service integration test for owner access across spaces, signed-out/nonowner denial, default capability denial, pending/suspended exclusion, redacted output and locked keys. This is **an automated service test, not an opened Electron app or manual UI test**. No window was opened; renderer behavior remains unvalidated.

Earlier review evidence remains historical: a native CLI ordinary-search smoke over an empty temporary fixture returned `[]`; an encrypted-learning subprocess inside Vitest timed out after ten seconds with null status and no stderr. In this final pass an asynchronous subprocess probe used only the supported `--unlock-stdin` pipe with EOF and a fictional credential. It exited zero with no captured output. A trivial spawned Node writer also yielded no captured stdout/stderr, so the result does not diagnose a CLI deadlock or establish encrypted CLI success. The encrypted CLI end-to-end probe remains explicitly skipped in the suite and is an **open validation gap**. No secret-input workaround, passphrase environment/argv/log exposure, denied-tool bypass or sandbox bypass was used. No actual code deadlock was identified or claimed fixed.

The earlier demo evidence in `scripts/demo-general-learnings.ts` predates this final hardening and was not rerun or overwritten. Only always-private and no-expiry were user approved; exact-draft approval, lifecycle and public-check rules remain proposed implementation defaults.

Final local validation after hardening: `npm test` passed **80 tests**, with **2 skipped** (**82 total**), across **13 passed test files and 1 skipped file (14 total)**. Derived-learning coverage is **15 passed, 1 skipped (16 total)**. Skips are the opt-in search-scale benchmark and the encrypted CLI subprocess validation gap described above. `npm run typecheck` (node and web), `npm run build`, and `git diff --check` passed. Earlier review totals were 78 passed/1 skipped (79 total); these are historical, not final totals. Sync-test messages use mocked fetch responses. No state2, real notes, source vault, secrets, network, demo rerun, commit, push, workflow or external send was used for this final pass.
