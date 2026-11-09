# Native ingestion and refresh

Build once with `npm run build`. All examples use configurable relative directories and synthetic queries. The app never installs media tools automatically. Install `yt-dlp` and a `faster-whisper` CLI separately and put both on PATH. Missing tools produce CLI_MISSING, retain the queue entry, and never claim success. The faster-whisper executable must accept an input media filename, `--output_dir`, and `--output_format txt`, and write source.txt. CliRunner is injectable for other wrappers and offline tests.

## CLI

```sh
node tools/keepmind-cli.mjs index ./memory --state ./state
node tools/keepmind-cli.mjs search 'garden soil' --dir ./memory --state ./state --space personal
node tools/keepmind-cli.mjs status --dir ./memory --state ./state
node tools/keepmind-cli.mjs refresh --dir ./memory --state ./state
```

`--dir` defaults to ./memory, `--state` to the memory directory's .keepmind subdirectory, and `--space` to personal. For the application, pass the configured native memory directory and its state directory explicitly to share its index. Do not run concurrent app/CLI writers against the same state directory. Indexing compares content hashes, preserves unchanged vectors, removes deleted chunks, and updates receipts only after the SQLite save. CLI search enforces a single space; explicit cross-space grants are configured through the native security session.

For encrypted files, configure encryption in Settings first and provide the passphrase over stdin with `--unlock-stdin`. Never put it in command arguments, files, shell history or logs. The CLI derives the wrapping key in memory, unwraps the configured master, persists only wrapped space keys, and clears the master on exit. Node does not have Electron safeStorage: new detected secrets cannot be captured through this standalone CLI and fail closed. Use the native ingestion queue for secret-bearing sources. Status does not need an unlock.

## Queue and native integration

The app starts RefreshScheduler at an interval configured by KEEPMIND_REFRESH_INTERVAL_MS (default 60000, minimum 1000). The trusted preload API provides pipelineEnqueue({ platform, url, space }), pipelineRefresh(), and pipelineStatus(). platform is a configurable lowercase identifier, space must be the active security space, and source URLs must use HTTPS with no credentials, fragment or query parameters other than v/t. Enqueue requires unlocked encryption because queue payloads may disclose interests and source identifiers. No source addresses appear in pipeline status.

The queue is stored as an encrypted memory item under ops/. Refresh retries failed jobs; successful entries are removed. One service coalesces concurrent refresh requests. A platform's backlog remains nonzero and its state remains error while jobs fail. The app and RAG share the same SQLite connection, so deposited notes become searchable immediately. Local embedding refresh fills in vectors later. Queues for other spaces require switching the active space; grants allow deliberate read/search access but do not silently run another space's jobs.

## Stages and themes

The capture runner invokes yt-dlp without shell interpolation or playlists and with an explicit download flag. It creates a private temporary working directory, downloads the audio, then invokes faster-whisper. Temporary media/transcripts are removed in a finally block after success or failure. Plaintext temporary files are a CLI execution boundary: use encrypted local disks or a memory-backed temp directory for sensitive deployments. A crash can leave temporary files; secure-delete guarantees are outside this MVP.

Persistent raw and draft notes are always encrypted memory items. The curated note contains the canonical platform:videoId ID, source, title, platform, duration and transcript. Source metadata is JSON-quoted within frontmatter. Notes and artifacts use SHA-256 canonical-ID filenames for stable idempotent deposition. All writes pass the native classifier and secret store; they receive space and class metadata.

KeepMind theme notes live under themes/. Keyword overlap selects up to three matching themes deterministically. If none match, a General theme is created for later review, ensuring every capture has at least one theme. Theme references are stored in the themes frontmatter array. Users can edit theme descriptions to improve routing.

A successful receipt verifies raw persistence, curated note persistence, and the exact saved note hash in the index. An indexed stage note records the canonical ID and receipt hash. A failed transcript, deposit or index never updates the end-to-end success timestamp.

## Status

The state directory's status/pipeline.json contains one validated row per registered platform: platform, runner, schedule, timezone, checked_at, last_attempt_at, last_capture_ok_at, last_deposit_ok_at, last_index_ok_at, backlog_count, error_code, state. Dates include an explicit UTC offset. unknown means no successful end-to-end receipt; error means the latest attempt/backlog failed; stale means the last receipt exceeds three refresh intervals; ok means a recent end-to-end receipt. Existing success timestamps survive later failures. Error codes are fixed values, never raw CLI messages or source content. Status is operational metadata, not proof against a malicious local administrator.

Canonical capture filenames also include the space in their hash input, allowing the same video to be deposited independently in different spaces. General fallback themes use a space-specific ID. Status timestamps use UTC offsets even when the configured scheduler timezone differs, so receipt comparisons remain unambiguous.
