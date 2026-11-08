# General learnings — proposed design only

Status: proposal for product review. Nothing in this document authorizes extraction,
promotion, publication, cross-space access, or implementation. No promotion feature
is implemented by this change. All examples below are fictional.

## Recommendation and trust boundary

Introduce a `derived_learning` note in a dedicated `general-knowledge` space. It
contains an abstract reusable principle, never a copied source passage. Treat this
as a new disclosure decision, not as a declassification shortcut. Gustavo must
explicitly approve **each** promotion and its exact text, audience and purpose.
Batch approval, implicit consent, background promotion and automatic promotion
are prohibited. Approval cannot waive lawful confidentiality duties, contractual
restrictions, personal-data obligations or another party's rights. An unresolved
restriction blocks the promotion even if Gustavo clicks approve.

Extraction starts manually from selected accessible sources, or as a suggestion
from a local model. Remote AI requires explicit, scoped, time-limited consent for
the selected source spaces and provider before any source text leaves the device.
Suggestion consent and promotion approval are separate. Imported instructions
cannot supply either. Local model output receives the same review as manual text.
Disable model tools/network access during extraction unless separately authorized.

## Sanitization and reidentification review

Strip companies, people, personal identifiers, contact details, numbers, amounts,
percentages, dates, locations, product names, counterparties, document titles,
source links, direct quotations and distinctive wording. Replace concrete events
with a general mechanism and state its limitations. Removal is not reliable
anonymization: a rare sequence of events, board composition, industry combination,
unusual transaction or memorable failure may identify the source without names.
Assess uniqueness against what the intended audience already knows, including
combinations of several published learnings. If meaningful abstraction still
permits identification, withhold it. Automated detectors only assist review.

Record abstraction level (`principle`, `pattern`, `procedure`) and derived
classification (`internal` by default; `public` only after a separate public-use
review). Derivation must never silently lower source classification. The current
session high-water policy remains intact: a future trusted promotion service
would need a narrow, audited approval boundary rather than changing that global
floor. Unsupported claims must be labeled hypotheses with applicability limits.

## Audience and purpose

An internal learning for another board is still a disclosure across compartments.
Review the receiving board's authority, purpose, competitive overlap and duties;
source-space access does not authorize this transfer. Prefer a neutral principle
that carries no evidence about a particular organization. General-knowledge space
membership alone must not authorize every possible downstream use.

A public article requires a distinct approval for the final article/export and
public audience, including surrounding text, combinations, citations and metadata.
Prior internal approval does not authorize publication. Neither approval nor a
sanitized label makes confidential material lawfully publishable. Do not include
source attribution unless separately lawful and explicitly authorized.

## Proposed data model

Store the following separately, encrypted at rest with their respective space
keys. Use random opaque IDs that reveal no source organization or path.

| Record | Fields and visibility |
| --- | --- |
| General note | random `id`, `type: derived_learning`, `space: general-knowledge`, sanitized body, abstraction level, derived class, applicability/uncertainty, status, approved audience/purpose, review deadline, revision |
| Source provenance | source references and versions, encrypted excerpts if needed, source classes, contradictions, assessment and lineage; kept in source space, accessible only with current source authority |
| Approval | exact body/revision digest, Gustavo identity, audience, purpose, lawful-disclosure review outcome, time, expiry; confidential assessment stored with provenance |
| Dependency | opaque reverse dependency from source to derived revision, used by a privileged lifecycle service; never returned in general results |
| Distribution receipt | derived revision, destination/cache/export category, consent/approval revision and revocation capability; no source metadata in recipient records |

Do not put provenance IDs, source counts, hashes of source titles, paths, space
identifiers, titles, excerpts, link targets or source-derived embeddings in the
general note, general index, public export or MCP response. Even existence and
counts can identify a source. Keep dependency lookup in a separately encrypted
service registry requiring source authority; do not use guessable source hashes.
For multiple sources, partition provenance by source authority so a user with
access to one cannot discover the others. Fail closed if safe partitioning is
unavailable. General notes must stand on their own without a hidden-source badge.

## Search, MCP and provenance policy

General search indexes only the approved sanitized revision, classification,
abstract tags and approved audience. Use the general-space key for text, vectors
and HMAC tokens. Pending/rejected/revoked revisions and private provenance cannot
enter general search, autocomplete, snippets, recommendations, telemetry or caches.
An indexer must not dereference source links while building the general index.

MCP requires both general-space scope/class authority and the approved purpose
and audience. A client-supplied claim of purpose is insufficient; use launcher
policy. General read/search/export returns no provenance fields, source IDs,
titles or existence hints, even for clients that also have source access.
A separate explicit provenance action verifies current access to every field
returned and audits content-free access. Source authorization is checked again
at read time; approval is never a permanent source-access grant. Denied provenance
requests must not distinguish absent from inaccessible sources. General MCP
writes cannot create approved promotions or approve as Gustavo.

## UX proposal

1. Select source excerpts within authorized spaces and choose manual or AI-assisted
   drafting. Show local processing or the exact remote consent scope.
2. Review the abstract draft beside a source-only panel visible under source
   authority. Highlight residual identifiers, concrete quantities, unique situations,
   unsupported claims and confidentiality concerns. Require meaningful review;
   detector success alone never enables approval.
3. Select audience and purpose: internal reuse for a named authorized destination
   or public publication. Display applicable restrictions and unresolved issues.
4. Gustavo explicitly approves that single immutable revision. Editing any text,
   destination, classification or purpose invalidates approval. No prechecked box,
   approval by timeout, recurring approval or model-generated approval.
5. Preview the exact recipient-visible record and exported artifact. Offer reject,
   defer, revise and revoke actions. All approved notes remain encrypted at rest,
   including public-class notes, unless a separate storage opt-in applies.

## Updates, contradictions and revocation

Track the source revision at approval. A source change, contradictory evidence,
deletion, changed access or confidentiality restriction marks affected learnings
`review_required` and suspends retrieval and new exports until Gustavo reapproves
an updated revision. Never silently rewrite an approved claim. Preserve encrypted
revision history under original authority and explain uncertainty without exposing
the source to general readers. A future policy may distinguish harmless edits,
but the conservative recommendation is suspension until review.

Revocation immediately removes the learning from active search/MCP and invalidates
local caches, embeddings, drafts, recommendations and managed exports. Maintain
opaque tombstones so stale replicas cannot resurrect it. Stop further distribution
if dependency evaluation fails. Revoke downstream derivatives recursively, with
cycle detection and idempotent retry. Restore from backup must replay revocations
before serving results. Backups remain encrypted and subject to retention rules.

Previously copied text, screenshots, downloaded exports, remote model retention
and unmanaged third-party caches cannot be reliably recalled. Show this limit
before export; prefer managed expiring views, destination receipts, minimal export
scope and short cache lifetimes. Revocation must not claim to erase uncontrolled
copies. Notify only through separately authorized communication workflows; this
proposal sends nothing. Retain only the minimum audit metadata needed under the
applicable retention policy.

## Fictional generic examples

These examples are invented, unrelated to any vault, and illustrate sanitized
outputs rather than evidence of actual events. Each would still require its own
review and Gustavo's explicit approval before use.

- **Principle:** “Separate a proposal's author from its final reviewer when incentives
  can affect judgment.” Internal procedural learning; omit any incident, identities
  or meeting context. Public reuse requires a fresh disclosure review.
- **Pattern:** “When handoffs lose context, a shared acceptance checklist can make
  responsibilities clearer.” Hypothesis with limits: a checklist does not resolve
  conflicting incentives. Reject if the surrounding situation remains recognizable.
- **Procedure:** “Record competing explanations before choosing an intervention,
  then revisit the assumptions after observing results.” General practice only;
  no metrics, chronology, sector or source identifiers accompany it.

## Proposed acceptance tests (not implemented)

- Manual and local-model suggestions stay pending; each requires Gustavo's explicit
  revision-bound approval. Other identities, batches, timeouts and imported commands
  cannot promote. Remote extraction without matching consent never dispatches.
- Sanitization catches names, PII, quantities, dates, links, titles and indirect
  identifiers. Human review rejects rare recognizable situations and combinations
  that pass identifier detectors. Confidentiality restrictions override approval.
- Public article and internal board-use approvals cannot substitute for each other;
  changed body, audience, classification, purpose or source version invalidates them.
- Disk, WAL, vector, keyword, autocomplete, MCP, error, audit and export scans reveal
  no provenance in general data. Source access loss hides provenance immediately;
  partial multi-source access reveals only permitted fields without source counts.
- Search and MCP deny missing space/class/audience authority and cannot approve via
  write tools. Prompt injection cannot widen source selection, consent or approval.
- Source contradiction/update, revocation and restore suspend every dependent revision
  and invalidate managed caches/exports, including offline retry and stale replicas.
  Failure to evaluate dependencies fails closed. Unmanaged copies are reported as
  outside recall guarantees; no false erasure confirmation is shown.

## Open product questions

- Is `general-knowledge` private to Gustavo, or shared? Which identities and launchers
  can assert receiving audience/purpose, and who maintains those grants?
- What evidence of lawful disclosure review is required, and which restrictions
  categorically prohibit even abstract reuse?
- Should every source edit suspend use, or can a reviewed mechanism distinguish
  editorial changes without giving general readers source-change hints?
- How will Gustavo authenticate each approval, and what expiry/review interval is
  appropriate? How are emergency revocation and temporary unavailability handled?
- Which export destinations support revocation receipts, and should public exports
  be disabled until the limits and publication review are implemented?
- Who can operate the encrypted dependency service across spaces, and how is that
  authority separated from ordinary search/MCP clients and audited?
- What independent reidentification review is needed before public use, and how
  should cumulative disclosure across many learnings be evaluated?
