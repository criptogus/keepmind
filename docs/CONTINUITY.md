# Project memory and continuity between assistants

KeepMind's **Projetos** view stores the state needed to resume work: objective,
success criteria, next step, decisions, rejected approaches, artifacts, evidence,
observed outcomes and unanswered questions. The native chat and the bundled MCP
server use the same continuity engine. No model subscription is needed to create
or review a project.

## First project

1. Open **Projetos** in the desktop app and create one project with an objective,
   success criteria and a next step. Sources are optional, existing Markdown paths
   within the current space, such as `notes/research.md`.
2. Record a decision with its alternatives, assumptions and expected result. New
   decisions start as proposals. Review them in the interface to accept, reject
   or supersede them; previous reviews remain in the record.
3. Record approaches already tried, why they failed or were rejected, and when
   they might still be useful. Link an artifact to the decisions it depends on.
4. Use **Copiar contexto** to take the current handoff to another assistant, or
   connect that assistant to the same memory through MCP.
5. Record observed results separately from execution status and expected results.
   A successful command does not automatically confirm a lesson or a business
   outcome. Lesson confirmation requires the human interface.

The standalone Corp backend does not yet implement this API. Its shared interface
shows an explicit availability message rather than pretending to save projects.

## MCP workflow

Keep the server entry point and both modules together:

```text
tools/keepmind-mcp.mjs
tools/lib/memory-contract.mjs
tools/lib/continuity.mjs
```

The app materializes the complete bundle for external agents. New memory
repositories receive the modules through scaffolding. Existing repository files
are preserved: when updating a manually copied server, update all three files.
The standalone npm package includes the modules; it still needs publication
before a registry installation receives a new version.

Encrypted access requires the existing unlocked native key service and explicit
launcher scopes. Client write permission must be enabled by the launcher; tool
arguments cannot grant it. See [SECURITY-MODEL.md](SECURITY-MODEL.md) and the
[server README](../tools/README.md) for the existing unlock mechanism.

| Tool | Purpose |
|---|---|
| `continuity_list` | List authorized projects in the client's default space |
| `continuity_create` | Create a project and optionally snapshot its source versions |
| `continuity_get` | Read the full structured project and current revision |
| `continuity_context` | Obtain categorized context, evidence states and fingerprint |
| `continuity_update` | Update title, objective, success criteria, next step or status |
| `continuity_add_decision` | Propose a decision, alternatives and expected result |
| `continuity_add_attempt` | Preserve an attempted approach, result and applicability |
| `continuity_add_artifact` | Associate a Markdown artifact with decisions and sources |
| `continuity_record_outcome` | Record execution status, observed result and proposed lesson |
| `continuity_add_question` / `continuity_resolve_question` | Track explicit information gaps |
| `continuity_check` | Check source versions and dependent artifacts |
| `continuity_metrics` | Count records and human usefulness feedback |

For example, the arguments to create and resume a project are:

```json
{
  "title": "New onboarding",
  "objective": "Help a new user resume one real project",
  "successCriteria": "The user can identify the next step without repeating context",
  "nextStep": "Test the first project flow",
  "evidence": ["notes/user-research.md"]
}
```

Call `continuity_context` with the returned `projectId`. Then use the returned
revision when proposing a decision:

```json
{
  "projectId": "<returned UUID>",
  "expectedRevision": 1,
  "choice": "Start onboarding with one project",
  "alternatives": ["Start with an empty graph"],
  "rejectionReason": "An empty graph does not explain the next useful action",
  "assumptions": ["The user already has one project to resume"],
  "expectedOutcome": "The user can resume work with less repeated explanation",
  "evidence": ["notes/user-research.md"]
}
```

All changes to an existing project require `expectedRevision`. On
`REVISION_CONFLICT`, read the current state and reconcile before retrying. Do not
blindly retry the previous write or replace the raw project file. The generic
`sb_write` and `sb_append` tools refuse protected project records, including path
aliases. A model-supplied `actor: "human"` cannot authorize a human action.

The review, evidence acknowledgement and feedback actions are exposed only to the
trusted desktop interface. Direct MCP attempts are rejected by the engine too.

## What a handoff means

`continuity_context` separates accepted decisions, proposals and rejected or
superseded decisions. It preserves attempts, predictions, assumptions, observed
results, open questions and source versions. It includes:

- `revision`: the stored project version used for subsequent writes.
- `fingerprint`: SHA-256 of the structured context and current evidence state.
- `evidence`: recorded source digest, current digest and availability status.
- `impacts`: changed or unavailable sources and artifacts depending on affected
  decisions.
- `missingQuestion`: a deterministic suggestion based on missing objective,
  success criteria, expected result, source review or next step.

The default response budget is 65,536 UTF-8 bytes, including its readable text.
`maxBytes` can explicitly request between 1,024 and 1,048,576 bytes. An oversized
response fails with `CONTEXT_BUDGET_EXCEEDED`; it never silently drops constraints
or decisions. The caller can explicitly increase the budget or inspect individual
project records with `continuity_get`.

Fingerprints identify a context version; they do not prove a statement true.
An evidence status of `verified` means its bytes still match the recorded or
human-acknowledged source version. It does not mean independent fact checking.
Outcomes without attached evidence are `unverified`, even when execution status
is `completed`. Changed or missing evidence produces `review_required` for linked
outcomes. A human acknowledgement keeps the original digest and records a reason.

Source change detection is based on content hashes. It does not yet determine
semantic contradictions, infer causality, or calculate which business decision
will produce the greatest financial return. Question suggestions use explicit
rules, not a trained value-of-information model. Feedback counts are human
ratings, not an automatically generated quality score.

## Current facts and historical memory

Native chat context, lexical retrieval, RAG and the standalone MCP reader share
`tools/lib/memory-contract.mjs`. Reads and searches default to **current**:

- Active, dated facts whose validity interval includes today are eligible.
- Superseded facts, archived facts, future/invalid dates and pending proposals do
  not enter current fact recall.
- Undated legacy material remains visibly labelled unverified.
- Other notes and logs remain source material or historical records. They are
  not promoted to canonical facts merely because retrieval found matching words.

`mode: "history"` explicitly includes archived records and proposals, preserving
their labels. `mode: "asOf", asOf: "YYYY-MM-DD"` selects dated facts valid on that
date and excludes proposals and undated material. Non-fact notes cannot establish
a dated fact interval. Search snippets retain provenance, classification, space
and version information; long fact chunks retain their individual status labels.
The index is refreshed before retrieval so a correction replaces old indexed
facts on the next query without waiting for a background rebuild.

MCP fact proposals use the client's default space, or the explicitly selected
fact document for `sb_append`. They remain pending until the person accepts them
in Hoje. Existing undated notes are not automatically rewritten as facts.

## Storage, isolation and recovery

Records live at `projects/<uuid>.md` in personal memory or
`spaces/<space>/projects/<uuid>.md` in another space, with a Markdown wrapper and
a versioned JSON payload. The native memory service applies the existing
encryption and classification rules. MCP writes inherit the strongest
classification of the record and its readable sources. Sources must be within
the same project space; traversal, policy directories and symbolic-link sources
are rejected. A removed source does not prevent editing project metadata, and
its availability remains explicit.

A corrupt authorized record is reported as `{id, error: "CORRUPT_PROJECT"}` in
the list while healthy projects remain usable. Inaccessible records do not expose
their titles or contents. Repair corrupted files from a trusted previous version
instead of replacing them with an empty project.

Writes take an exclusive `<uuid>.md.lock` directory and check the revision while
holding it. This coordinates the app and MCP processes sharing the **same local
vault**. Independent Git clones do not share that filesystem lock; synchronize
and resolve repository conflicts before resuming concurrent work across clones.
This is not a distributed transaction protocol.

A process crash can leave a lock. The service fails closed with `PROJECT_LOCKED`
and never guesses that a lock is stale. Close all writers, back up the project,
verify that no process owns the operation, then remove only that project's empty
lock directory before reopening it. Do not delete the project to unlock it.

The private derived-learning registry keeps its existing owner-only access and
retention behavior. Project outcomes do not automatically promote themselves
into that registry or expire existing lessons.

## Verification

Run `npm run build`, `npm run typecheck`, then `npm test`. Building first supplies
the packaged derived-learning module used by the existing MCP tests. New tests
cover shared native/MCP persistence, current/history selection, stale revisions,
human authority, changed and missing evidence, transitive artifact impacts,
encrypted classification inheritance, space isolation, corruption, context
budgets and path aliases.

These are deterministic regression tests of the memory contract. They do not
measure the correctness of a model-generated answer. The Hoje indicator is named
**Retrieval checks** to make that distinction explicit. A cross-model answer
quality benchmark and end-to-end installed desktop testing remain separate
validation work.
