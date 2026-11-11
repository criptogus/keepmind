#!/usr/bin/env node
// In-process Corp MCP (no HTTP bridge). Same vault as the Corp server.
//
//   KEEPMIND_CORP_DATA=./corp/data KEEPMIND_CORP_TOKEN=… node corp/mcp-stdio-worker.mjs
//   KEEPMIND_CORP_AGENT=composer (optional)

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendAudit, ensureVaultShape } from './lib.mjs'
import { loadOrg, saveOrg } from './org-persist.mjs'
import { resolveSyncBearer } from './sync-tokens-store.mjs'
import { runStdioMcpServer } from './mcp-stdio-server.mjs'

const env = process.env
const dataDir = path.resolve(env.KEEPMIND_CORP_DATA || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data'))
const vault = path.resolve(env.KEEPMIND_CORP_VAULT || path.join(dataDir, 'vault'))
const orgFile = path.join(dataDir, 'org.json')
const token = env.KEEPMIND_CORP_TOKEN || ''
const agentId = env.KEEPMIND_CORP_AGENT || 'composer'

if (!token) {
  process.stderr.write('KEEPMIND_CORP_TOKEN required\n')
  process.exit(1)
}

ensureVaultShape(vault)
let org = loadOrg(orgFile, env.KEEPMIND_CORP_ORG_NAME || 'KeepMind Corp')
const syncCtx = resolveSyncBearer(vault, token)
if (!syncCtx?.scopes?.includes('mcp:invoke')) {
  process.stderr.write('Token missing mcp:invoke scope\n')
  process.exit(1)
}
const user = org.users.find((u) => u.id === syncCtx.userId && !u.disabled)
if (!user) {
  process.stderr.write('Token user not found\n')
  process.exit(1)
}
const syncOn = org.agents.find((a) => a.id === 'sync' && a.enabled)
const composerOn = org.agents.find((a) => a.id === 'composer' && a.enabled)
if (!syncOn) {
  process.stderr.write('Enable Sync agent in admin\n')
  process.exit(1)
}
if (agentId === 'composer' && !composerOn) {
  process.stderr.write('Enable Composer agent in admin\n')
  process.exit(1)
}

runStdioMcpServer({
  vault,
  getOrg: () => org,
  getUser: () => user,
  agentId,
  persistOrg: () => saveOrg(orgFile, org),
  audit: (actor, op, extra) => appendAudit(vault, { actor: actor.email, role: actor.role, op, ...extra })
})
