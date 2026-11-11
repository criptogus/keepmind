#!/usr/bin/env node
// Stdio MCP bridge → KeepMind Corp HTTP /api/mcp/call
// Usage:
//   KEEPMIND_CORP_URL=http://127.0.0.1:8787 KEEPMIND_CORP_TOKEN=… node tools/corp-mcp-bridge.mjs

import { createInterface } from 'node:readline'

const PROTOCOL_VERSION = '2024-11-05'
const BASE = (process.env.KEEPMIND_CORP_URL || 'http://127.0.0.1:8787').replace(/\/$/, '')
const TOKEN = process.env.KEEPMIND_CORP_TOKEN || ''
const AGENT = process.env.KEEPMIND_CORP_AGENT || 'composer'

const TOOLS = [
  { name: 'sb_search', description: 'Search memory', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'sb_read', description: 'Read memory file', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'sb_append', description: 'Append markdown', inputSchema: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' } }, required: ['text'] } },
  { name: 'sb_list', description: 'List paths', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } }
]

async function remoteCall(tool, args) {
  if (!TOKEN) throw new Error('KEEPMIND_CORP_TOKEN required')
  const res = await fetch(`${BASE}/api/mcp/call`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      'x-keepmind-corp': '1'
    },
    body: JSON.stringify({ agentId: AGENT, tool, arguments: args })
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.message || body.error || res.status)
  return body.text ?? JSON.stringify(body)
}

function ok(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function err(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

async function handle(msg) {
  const { id, method, params } = msg
  if (id === undefined) return null
  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'keepmind-corp-bridge', version: '0.5.0' }
    })
  }
  if (method === 'ping') return ok(id, {})
  if (method === 'tools/list') return ok(id, { tools: TOOLS })
  if (method === 'tools/call') {
    try {
      const text = await remoteCall(params?.name, params?.arguments ?? {})
      return ok(id, { content: [{ type: 'text', text: String(text) }], isError: false })
    } catch (e) {
      return ok(id, { content: [{ type: 'text', text: `error: ${e.message}` }], isError: true })
    }
  }
  return err(id, -32601, `method not found: ${method}`)
}

const rl = createInterface({ input: process.stdin, terminal: false })
rl.on('line', async (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let msg
  try {
    msg = JSON.parse(trimmed)
  } catch {
    return
  }
  try {
    const res = await handle(msg)
    if (res) process.stdout.write(`${JSON.stringify(res)}\n`)
  } catch (e) {
    if (msg?.id !== undefined) process.stdout.write(`${JSON.stringify(err(msg.id, -32000, e.message))}\n`)
  }
})
process.stderr.write('[keepmind-corp-mcp-bridge] remote Corp runtime\n')
