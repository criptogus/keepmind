import { it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryServer } from '../tools/keepmind-mcp.mjs'
it('serves MCP requests, suppresses notifications, and contains note access', () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-mcp-'))
  try {
    mkdirSync(join(dir, 'notes')); writeFileSync(join(dir, 'notes/fact.md'), '# Budget\nThe project budget is forty dollars.')
    symlinkSync('/etc', join(dir, 'outside'))
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search', arguments: { query: 'budget' } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'read_note', arguments: { path: 'notes/fact.md' } } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'read_note', arguments: { path: '../secret' } } },
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'read_note', arguments: { path: 'outside/passwd' } } }
    ]
    const handle = createMemoryServer(dir)
    const replies = requests.map(r => handle(r)).filter(Boolean)
    expect(replies).toHaveLength(6)
    expect(replies[1].result.tools.map((t: { name: string }) => t.name)).toContain('read_note')
    expect(replies[2].result.content[0].text).toContain('notes/fact.md')
    expect(replies[3].result.content[0].text).toContain('forty dollars')
    expect(replies[4].result.isError).toBe(true)
    expect(replies[5].result.isError).toBe(true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
