import { it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs'
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
it('enforces client spaces and maximum class across reads and discovery', () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-mcp-scope-'))
  try {
    mkdirSync(join(dir, 'notes'))
    writeFileSync(join(dir, 'notes/allowed.md'), '---\nspace: personal\nclass: internal\n---\nallowed')
    writeFileSync(join(dir, 'notes/other.md'), '---\nspace: company-x\nclass: internal\n---\nother')
    writeFileSync(join(dir, 'notes/restricted.md'), '---\nspace: personal\nclass: sensitive\n---\nrestricted')
    const handle = createMemoryServer(dir, { clientId: 'test', clients: { test: { spaces: ['personal'], maxClass: 'internal' } } })
    const list = handle({ id: 1, method: 'resources/list' }).result.resources.map(r => r.name)
    expect(list).toEqual(['notes/allowed.md'])
    const denied = handle({ id: 2, method: 'resources/read', params: { uri: 'memory://notes/other.md' } })
    expect(denied.error).toBeDefined()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
it('requires explicit client write permission and audits every attempt without paths or content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-mcp-write-'))
  try {
    mkdirSync(join(dir, 'notes'))
    writeFileSync(join(dir, 'notes/foreign.md'), '---\nspace: company-y\nclass: internal\n---\nforeign')
    writeFileSync(join(dir, 'notes/high.md'), '---\nspace: company-x\nclass: sensitive\n---\nrestricted')
    const handle = createMemoryServer(dir, { clientId: 'writer', clients: { writer: { spaces: ['company-x'], defaultSpace: 'company-x', maxClass: 'internal', write: true } } })
    const call = (name, path, content) => handle({ id: 1, method: 'tools/call', params: { name, arguments: { path, content } } }).result
    expect(call('sb_write', 'notes/new.md', '# Synthetic note').isError).toBeUndefined()
    expect(readFileSync(join(dir, 'notes/new.md'), 'utf8')).toContain('space: company-x')
    expect(call('sb_append', 'notes/new.md', '\nsynthetic addition').isError).toBeUndefined()
    expect(call('sb_remember', undefined, 'synthetic durable lesson').isError).toBeUndefined()
    for (const [path, content] of [
      ['notes/foreign.md', 'replacement'], ['notes/high.md', 'replacement'],
      ['notes/bad.md', '---\nspace: company-y\nclass: internal\n---\nblocked'],
      ['notes/high-new.md', '---\nspace: company-x\nclass: sensitive\n---\nblocked'],
      ['notes/override.md', '---\nspace: company-x\nclass: internal\nclass_override: secret\n---\nblocked'],
      ['../outside.md', 'blocked'], ['notes/../ops/forged.md', 'blocked'],
      ['notes/duplicate.md', '---\nspace: company-x\nspace: company-y\n---\nblocked']
    ]) expect(call('sb_write', path, content).isError).toBe(true)
    expect(call('sb_append', 'notes/new.md', '\nsynthetic@example.invalid').isError).toBe(true)
    const denied = createMemoryServer(dir, { clientId: 'reader', clients: { reader: { spaces: ['company-x'], maxClass: 'internal' } } })
    expect(denied({ id: 1, method: 'tools/call', params: { name: 'sb_write', arguments: { path: 'notes/denied.md', content: 'blocked' } } }).result.isError).toBe(true)
    const audit = readFileSync(join(dir, 'ops/mcp-reads.jsonl'), 'utf8')
    const rows = audit.trim().split('\n').map(line => JSON.parse(line))
    expect(rows).toHaveLength(13)
    expect(rows.filter(r => r.allowed)).toHaveLength(3)
    for (const row of rows) {
      expect(row.operation).toBe('write')
      expect(row.resource).toMatch(/^[a-f0-9]{64}$/)
      expect(row.ts).toBeDefined(); expect(['writer', 'reader']).toContain(row.client)
      expect(Object.keys(row).sort()).toEqual(['allowed', 'client', 'operation', 'resource', 'ts'])
    }
    expect(audit).not.toContain('notes/')
    expect(audit).not.toContain('synthetic')
    expect(existsSync(join(dir, 'notes/denied.md'))).toBe(false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
it('routes new remember notes to the default space and refuses restricted plaintext even with a higher scope', () => {
  const dir = mkdtempSync(join(tmpdir(), 'km-mcp-default-'))
  try {
    const handle = createMemoryServer(dir, { clients: { default: { spaces: ['company-x', 'personal'], defaultSpace: 'company-x', maxClass: 'secret', write: true } } })
    const call = (content) => handle({ id: 1, method: 'tools/call', params: { name: 'sb_remember', arguments: { kind: 'note', content } } }).result
    expect(call('synthetic ordinary').isError).toBeUndefined()
    expect(readFileSync(join(dir, 'long-term/notes/synthetic-ordinary.md'), 'utf8')).toContain('space: company-x')
    expect(call('synthetic@example.invalid').isError).toBe(true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
