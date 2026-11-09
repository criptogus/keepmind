import { spawn, ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { McpServerConfig } from '../store'

// ── Minimal MCP stdio client (JSON-RPC 2.0 over newline-delimited JSON) ──

interface JsonRpcRequest { jsonrpc: '2.0'; id: number; method: string; params?: any }
interface JsonRpcResponse { jsonrpc: '2.0'; id: number; result?: any; error?: { code: number; message: string } }

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export class McpClient extends EventEmitter {
  private proc: ChildProcess | null = null
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private tools: McpTool[] = []
  readonly serverId: string

  constructor(serverId: string) {
    super()
    this.serverId = serverId
  }

  async start(cfg: McpServerConfig): Promise<void> {
    if (!cfg.command) throw new Error(`MCP server ${cfg.id} has no command`)
    const args = cfg.args ?? []
    this.proc = spawn(cfg.command, args, {
      env: { ...process.env, ...(cfg.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe']
    })

    this.proc.stdout!.on('data', (chunk: Buffer) => this.onData(chunk.toString()))
    this.proc.stderr!.on('data', (d: Buffer) => this.emit('log', `[${cfg.name}] ${d.toString().trim()}`))
    this.proc.on('exit', (code) => {
      this.emit('exit', code)
      this.rejectAll(new Error(`MCP server exited (${code})`))
    })

    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'keepmind', version: '0.1.0' }
    })
    this.notify('notifications/initialized')
    const list = await this.request('tools/list', {})
    this.tools = (list?.tools ?? []).map((t: any) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} }
    }))
    this.emit('ready', this.tools)
  }

  private onData(chunk: string) {
    this.buffer += chunk
    let idx
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line) as JsonRpcResponse & { method?: string }
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!
          this.pending.delete(msg.id)
          if (msg.error) p.reject(new Error(msg.error.message))
          else p.resolve(msg.result)
        } else if (msg.method) {
          this.emit('notification', msg)
        }
      } catch { /* non-JSON noise */ }
    }
  }

  private send(msg: JsonRpcRequest | any) {
    if (!this.proc?.stdin?.writable) throw new Error('MCP server not running')
    this.proc.stdin.write(JSON.stringify(msg) + '\n')
  }

  private notify(method: string, params?: any) {
    this.send({ jsonrpc: '2.0', method, params })
  }

  private request(method: string, params?: any): Promise<any> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.send({ jsonrpc: '2.0', id, method, params })
      } catch (e) {
        this.pending.delete(id)
        reject(e as Error)
      }
    })
  }

  private rejectAll(err: Error) {
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }

  listTools(): McpTool[] { return this.tools }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const res = await this.request('tools/call', { name, arguments: args })
    const content = res?.content ?? []
    return content.map((c: any) => c.text ?? JSON.stringify(c)).join('\n')
  }

  async stop() {
    try { this.proc?.kill('SIGTERM') } catch { /* noop */ }
    this.proc = null
    this.rejectAll(new Error('stopped'))
  }
}

// ── Manager: owns the lifecycle of all MCP servers ──

export class McpManager extends EventEmitter {
  private clients = new Map<string, McpClient>()
  private configs: McpServerConfig[]
  private sessionDir: string

  constructor(configs: McpServerConfig[], userDataDir: string) {
    super()
    this.configs = configs
    this.sessionDir = join(userDataDir, 'mcp-sessions')
    mkdirSync(this.sessionDir, { recursive: true })
  }

  private resolveCommand(cfg: McpServerConfig): McpServerConfig {
    // Bundled servers shipped with the app
    if (cfg.kind === 'whatsapp' && !cfg.command) {
      const bundled = join(__dirname, 'mcp', 'whatsapp-server.js')
      return {
        ...cfg,
        command: process.execPath,
        args: [bundled],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          WA_SESSION_DIR: cfg.sessionDir ?? join(this.sessionDir, 'whatsapp')
        }
      }
    }
    if (cfg.kind === 'telegram' && !cfg.command) {
      // Bundled GramJS server — QR login as a real user account (not bot token)
      const bundled = join(__dirname, 'mcp', 'telegram-server.js')
      return {
        ...cfg,
        command: process.execPath,
        args: [bundled],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          TG_SESSION_DIR: cfg.sessionDir ?? join(this.sessionDir, 'telegram'),
          TELEGRAM_API_ID: cfg.env?.TELEGRAM_API_ID ?? '',
          TELEGRAM_API_HASH: cfg.env?.TELEGRAM_API_HASH ?? ''
        }
      }
    }
    if (cfg.kind === 'postgres' && !cfg.command) {
      const dbUrl = cfg.env?.DATABASE_URL ?? ''
      return {
        ...cfg,
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres', dbUrl]
      }
    }
    return cfg
  }

  async startServer(cfg: McpServerConfig): Promise<McpTool[]> {
    if (cfg.permission === 'block') throw new Error(`connector "${cfg.name ?? cfg.id}" is blocked`)
    await this.stopServer(cfg.id)
    const resolved = this.resolveCommand(cfg)
    const client = new McpClient(cfg.id)
    client.on('log', (msg: string) => this.emit('log', { serverId: cfg.id, message: msg }))
    client.on('notification', (n: any) => this.emit('notification', { serverId: cfg.id, ...n }))
    client.on('exit', (code: number) => {
      this.clients.delete(cfg.id)
      this.emit('serverExit', { serverId: cfg.id, code })
    })
    await client.start(resolved)
    this.clients.set(cfg.id, client)
    return client.listTools()
  }

  async stopServer(id: string) {
    const c = this.clients.get(id)
    if (c) { await c.stop(); this.clients.delete(id) }
  }

  async stopAll() {
    await Promise.all([...this.clients.keys()].map(id => this.stopServer(id)))
  }

  getClient(id: string): McpClient | undefined { return this.clients.get(id) }

  get runningServers(): string[] { return [...this.clients.keys()] }

  // Aggregate all tools from running servers, prefixed with server id
  allTools(): { serverId: string; tool: McpTool }[] {
    const out: { serverId: string; tool: McpTool }[] = []
    for (const [id, c] of this.clients) {
      for (const t of c.listTools()) out.push({ serverId: id, tool: t })
    }
    return out
  }

  async callTool(serverId: string, name: string, args: Record<string, unknown>): Promise<string> {
    const c = this.clients.get(serverId)
    if (!c) throw new Error(`MCP server ${serverId} not running`)
    return c.callTool(name, args)
  }
}
