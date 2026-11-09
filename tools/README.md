# keepmind-mcp

A standalone, dependency-free Node.js stdio MCP server over a local KeepMind
Markdown memory directory. No Electron or embedding model is required.

Run `npx keepmind-mcp --memory-dir /absolute/path/to/memory`, or set
`KEEPMIND_MEMORY_DIR`. The `search` and `read_note` tools provide keyword search
and note reading. Existing `sb_*` tools also support memory writes and appends.
Only point the server at memory that you intend your MCP client to access.

For a source checkout, run `node tools/keepmind-mcp.mjs --memory-dir /path/to/memory`.
Maintainers can package this standalone npm package with `npm pack ./tools`;
publication to npm is required before the bare `npx keepmind-mcp` command can
resolve this release from the registry.

### Encrypted memory

The server defaults to encrypted-only access and cannot read ciphertext while
locked. Use the full built KeepMind installation for decryption; a copy of this
script alone has no key service. Configure launcher-controlled client scopes,
`KEEPMIND_MCP_STATE` and `KEEPMIND_MCP_UNLOCK_FD` (a dedicated inherited descriptor
at least 3). Supply the passphrase through that descriptor, never through args,
environment values, logs, or MCP stdin. See docs/SECURITY-MODEL.md in the app repo.
`KEEPMIND_MCP_ALLOW_PLAINTEXT=true` explicitly permits legacy public/internal
plaintext. It never supplies a fallback for failed decryption. Attachments are
not served by note tools. Token capture requires the native keychain service.
