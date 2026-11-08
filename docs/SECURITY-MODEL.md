# KeepMind security model

KeepMind owns its memory model: Markdown item metadata, spaces, memory tiers, themes, and a local hybrid index. Treat imported text as untrusted data.

## Classification and storage

Each written item has `class: public|internal|sensitive|secret` and `space:` frontmatter. Legacy metadata-free text defaults to internal/personal. Rules detect CPF, CNPJ, email, phone, supported API token prefixes, JWTs and private key blocks. Detectors are conservative format detectors, not identity validation. `class_override:` records the user's requested classification; detector and declared classification floors still apply so downgrades cannot disable encryption. Rules cannot detect every secret. Users should raise classification for confidential information without recognizable patterns.

Secret matches are replaced by `[MASKED] keychain:<random-id>` before writing. Only the injectable SecretStore receives original secret values. InMemorySecretStore is for tests only. KeychainSecretStore encrypts values with Electron safeStorage and persists only encrypted strings via an injected backing store. Missing keychains and Linux basic_text backends are rejected. No plaintext fallback exists. Restricted writes without unlocked keys fail. Unlocked indexing migrates restricted plaintext through the same classifier and encrypted writer before indexing. Locked readers refuse restricted plaintext. Enable encryptAll to upgrade other existing plaintext items in the active and granted spaces.

## Keys and recovery

Setup creates a random 256-bit master. Argon2id (libsodium crypto_pwhash, interactive memory/operation limits and random salt) derives the passphrase wrapping key. A separate random 256-bit recovery key wraps the same master. Setup returns that recovery key once; callers must display it once and never persist or log it. The OS keychain holds a wrapped master for subsequent unlock. Configuration contains versioned public KDF parameters, authenticated master wraps and per-space wrapped DEKs; persist changes after space creation. No passphrases or recovery keys belong in configuration.

Each space gets a random 256-bit DEK wrapped by the master. Item and index encryption uses XChaCha20-Poly1305 with a fresh 192-bit nonce and authenticated space/context. Swapping an encrypted file between paths fails authentication. Sensitive and secret items always encrypt; encryptAll also encrypts other classes. A locked/missing key, wrong passphrase, damaged box or unavailable OS keychain fails closed. Lock clears the live master buffer; JavaScript strings, runtime copies, swap and process compromise are outside the secure-erasure guarantee.

Losing both passphrase and recovery key, without a working unlocked keychain, means permanent data loss. Keep a recovery copy offline. The MVP has no escrow, password reset, automatic key rotation or multi-device key exchange.

## Spaces and readers

An active space defaults to personal. Only that space and an explicit grant list may be read or searched. Sleep uses the same scoped Memory instance. Outputs inherit its active space; grants should only be enabled for deliberate cross-space consolidation. Grants are local authority decisions, never instructions taken from note text.

The SQLite index encrypts restricted chunk text and vector payloads and uses keyed HMAC keyword tokens. Decryption happens in memory for scoring. Plaintext FTS/inverted tokens must never be created for restricted chunks. Space predicates apply before scoring. Filesystem metadata, item sizes, update times, posting frequencies and access patterns remain visible. Existing plaintext indexes/backups need secure retirement; deleting SQLite rows is not secure erasure.

## Model egress

All chat and streaming calls pass the egress gate before dispatch. Sensitive/secret text requires local loopback inference by default. A cloud request requires an explicit, unexpired consent for every involved space and provider, supplied per request or as a per-space grant. Detector-based PII/token redaction runs before cloud dispatch. Declarations propagate through frontmatter in assembled contexts; callers with derived data must pass its classification and space explicitly. Redaction is best effort and is not anonymization.

Cloud egress fails if its audit destination is unavailable. Append-only JSONL records contain timestamp, provider, space, class, redaction count and consent ID only. No prompts, responses or credentials are logged. Local loopback is a deployment trust boundary; administrators must keep local endpoints local. Redirects are disabled. OS file permissions and log retention are the administrator's responsibility; append-only describes application behavior, not tamper-proof storage.

## Sync and MCP

Sync encrypts content and the path manifest, hashes remote filenames with domain-separated HMACs, and authenticates the sync key before writes. Local path names do not need to be disclosed remotely. The manifest is authoritative; mutations must serialize. A repository operator can still observe timing, size and history. Old repository history requires separate retirement after migration.

MCP clients receive configured allowed spaces and maximum classification, with no authorization derived from client-supplied note content. Reads and discovery enforce the same limits, and reads append content-free audit records. The standalone process cannot decrypt locked memory. Direct filesystem access bypasses MCP scopes; run it with appropriately restricted OS privileges. Transport identity must be bound by the launcher to a configured client, not trusted from initialize metadata.

## Operational limits

This MVP protects persisted content and normal application egress, not malware, malicious extensions, screen capture, debug dumps or a compromised OS. Back up encrypted data and key configuration together; keep recovery material separate. Test recovery before trusting a deployment with valuable data. Raw ingestion artifacts must receive the same classification and encryption as curated notes. Status files must contain no source URLs, transcript content, tokens or arbitrary CLI errors.

## Native session behavior

Settings exposes setup, passphrase/keychain unlock, recovery, lock, encrypt-all with migration of existing active/granted items, space grants, and an explicit 15-minute cloud consent for the configured provider in the active space. IPC never returns master keys or secret values. Recovery is shown only by the setup response and dismissed from UI state after acknowledgment. Native key configuration and safeStorage ciphertexts are persisted atomically where applicable with restrictive file modes.

The native Memory session maintains a conservative high-water classification and the set of spaces it has read. Derived writes inherit that classification; egress inherits that class and requires consent for every read space. This intentionally overprotects unrelated subsequent work after reading a restricted item. A process restart starts a new high-water session; automatic classification and item frontmatter remain authoritative. Model tools' descriptions and schemas are included in the gate and cloud redaction. Memory listing and manual backup use the scoped reader, never a raw filesystem bypass.

SQLite enables secure_delete and uses transactional WAL persistence. SQLCipher encrypts the whole database and WAL whenever master keys are configured, including a one-time rekey of older plaintext databases. This reduces exposure in current database pages but cannot erase older filesystem snapshots, backups, prior JSON indexes or repository history. Scope filters run in SQLite before decryption. A scoped replacement preserves rows and postings belonging to other spaces.

Standalone MCP refuses sealed items and defaults to personal/internal with writes disabled. Set KEEPMIND_MCP_SCOPES to a JSON config filename and KEEPMIND_MCP_CLIENT to a launcher-controlled client ID. The config maps client IDs to `{ "spaces": ["company-x"], "defaultSpace": "company-x", "maxClass": "internal", "write": true }`. Unknown clients get no spaces. Every discovery/content access uses the same policy, and audit failures prevent reads. MCP audit records store a resource hash, timestamp, client ID and allowed flag, never note content. Every write checks the existing item and the resulting content against the client scope; new notes receive defaultSpace (or the first allowed space). Explicit write: true is mandatory. Restricted writes require the unlocked native service, even for clients with higher maximum classes. Write attempts, including denials, append an operation, path hash, timestamp, client ID and allowed flag without content. Reserved operational/state files cannot be changed through note tools. Native decryption is intentionally not available to this standalone process.

Long-running chat, sleep, refresh and ingestion operations pin their space/grant snapshot across awaits. Changing the UI's active space cannot redirect an in-flight result into a different compartment. Generated non-personal brain tiers, planner items and entities use spaces/<space>/ paths, while personal keeps the existing tier paths. Explicit file paths still require item-policy authorization. RAG recursively indexes scoped nested tier files and applies space filters before scoring. Imported items may use any contained relative filename but cannot overwrite a path owned by an ungranted space.


## Explicit space merges

`keepmind-cli spaces suggest --dir <memory> --state <state>` returns matching
`board-<slug>` / `company-<slug>` identifiers and note counts only. It does not
write a config or approve a merge. Symlinks and operational/state directories
are excluded from suggestions and application.

The user supplies `<state>/space-map.json`, for example:

```json
{"aliases":{"board-x":"company-x"},"approved":true,"approved_at":"2026-11-08T00:00:00Z"}
```

`keepmind-cli spaces apply --dir <memory> --state <state>` requires that explicit
approval and a valid timestamp; malformed/cyclic aliases fail before mutations.
Approval alone never changes notes. Apply rewrites space metadata through the
native Memory writer (sealed notes authenticate with the source key and reseal
with the destination key), then refreshes affected index spaces. It preserves
paths and classifications and is idempotent. Encrypted installations also require
`--unlock-stdin`. Each file replacement is atomic; the entire multi-file merge is
not a filesystem transaction. After interruption, rerun the approved apply to
finish and refresh the index. No automatically inferred aliases are used.
