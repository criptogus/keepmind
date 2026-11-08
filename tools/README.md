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
