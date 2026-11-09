// Bundled Telegram MCP server — GramJS (MTProto user account, QR pairing).
// Speaks MCP over stdio (newline-delimited JSON-RPC 2.0).
// QR login mirrors the WhatsApp connector: scan with Telegram → Settings →
// Devices → Link Desktop Device. Session persists in the session dir.

import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { NewMessage } from 'telegram/events'
import { Api } from 'telegram/tl'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import QRCode from 'qrcode'

const SESSION_DIR = process.env.TG_SESSION_DIR ?? join(process.cwd(), 'tg-session')
const SESSION_FILE = join(SESSION_DIR, 'session.txt')
const QR_FILE = join(SESSION_DIR, 'qr.txt')
mkdirSync(SESSION_DIR, { recursive: true })

// Public api credentials (Telegram Desktop). Override with env for own app.
const API_ID = Number(process.env.TELEGRAM_API_ID || 2040)
const API_HASH = process.env.TELEGRAM_API_HASH || 'b18441a1ff607e10a989891a5462e627'

let client: TelegramClient | null = null
let connected = false
let connecting = false
const messageStore: { id: string; from: string; body: string; ts: number }[] = []

function writeQr(data: string) {
  QRCode.toDataURL(data, { margin: 1, width: 320 })
    .then((url: string) => writeFileSync(QR_FILE, url, 'utf8'))
    .catch(() => writeFileSync(QR_FILE, data, 'utf8'))
}

async function startClient() {
  if (connecting) return
  connecting = true
  try {
    const session = new StringSession(existsSync(SESSION_FILE) ? readFileSync(SESSION_FILE, 'utf8') : '')
    client = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 5 })

    client.addEventHandler((ev) => {
      const m = ev.message
      if (!m || m.out) return
      const body = m.message ?? ''
      if (!body) return
      messageStore.push({
        id: String(m.id),
        from: m.senderId ? String(m.senderId) : 'unknown',
        body,
        ts: (typeof m.date === 'number' ? m.date * 1000 : Date.now())
      })
      if (messageStore.length > 500) messageStore.shift()
    }, new NewMessage({}))

    await client.connect()

    if (await client.checkAuthorization()) {
      connected = true
      writeFileSync(QR_FILE, 'CONNECTED', 'utf8')
      connecting = false
      return
    }

    // QR login: export token → render tg://login?token=… → poll import
    const tokenRes: any = await client.invoke(
      new Api.auth.ExportLoginToken({ apiId: API_ID, apiHash: API_HASH, exceptIds: [] })
    )
    if (!(tokenRes instanceof Api.auth.LoginToken)) {
      writeFileSync(QR_FILE, 'LOGIN_FAILED', 'utf8')
      connecting = false
      return
    }
    const qrPayload = `tg://login?token=${tokenRes.token}`
    writeQr(qrPayload)

    const deadline = Date.now() + (tokenRes.expires ?? 180) * 1000
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000))
      try {
        const res: any = await client.invoke(new Api.auth.ImportLoginToken({ token: tokenRes.token }))
        if (res instanceof Api.auth.LoginTokenSuccess || res instanceof Api.auth.LoginTokenMigrateTo) {
          // success (or migrate — gramjs handles migration internally on next calls)
          if (res instanceof Api.auth.LoginTokenMigrateTo) {
            await (client as any)._switchDC(res.dcId)
            const retry: any = await client.invoke(new Api.auth.ImportLoginToken({ token: res.token }))
            if (!(retry instanceof Api.auth.LoginTokenSuccess)) continue
          }
          connected = true
          writeFileSync(SESSION_FILE, client.session.save() as unknown as string, 'utf8')
          writeFileSync(QR_FILE, 'CONNECTED', 'utf8')
          connecting = false
          return
        }
      } catch { /* token not ready yet — keep polling */ }
    }
    writeFileSync(QR_FILE, 'QR_EXPIRED', 'utf8')
    connecting = false
    try { await client.disconnect() } catch { /* noop */ }
  } catch (e) {
    process.stderr.write(`telegram socket failed: ${e}\n`)
    writeFileSync(QR_FILE, 'ERROR', 'utf8')
    connecting = false
    setTimeout(startClient, 5000)
  }
}

const TOOLS = [
  {
    name: 'telegram_status',
    description: 'Check Telegram connection status and whether a QR login is pending.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'telegram_qr',
    description: 'Get the current login QR code as a data URL (empty when connected).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'telegram_send',
    description: 'Send a Telegram text message to a username (e.g. @name) or numeric id.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Username with @ or numeric user id' },
        text: { type: 'string' }
      },
      required: ['to', 'text']
    }
  },
  {
    name: 'telegram_messages',
    description: 'List recent incoming Telegram messages captured by the bridge.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max messages to return (default 20)' },
        from: { type: 'string', description: 'Optional sender filter' }
      }
    }
  }
]

async function callTool(name: string, args: any): Promise<string> {
  switch (name) {
    case 'telegram_status':
      return JSON.stringify({ connected, qrPending: existsSync(QR_FILE) && readFileSync(QR_FILE, 'utf8') !== 'CONNECTED' })
    case 'telegram_qr': {
      if (!existsSync(QR_FILE)) return ''
      const v = readFileSync(QR_FILE, 'utf8')
      return v === 'CONNECTED' || v === 'LOGGED_OUT' || v === 'ERROR' || v === 'LOGIN_FAILED' || v === 'QR_EXPIRED' ? '' : v
    }
    case 'telegram_send': {
      if (!connected || !client) return 'Telegram not connected'
      const to = String(args.to).trim()
      const entity = to.startsWith('@') ? to : (/^\d+$/.test(to) ? Number(to) : to)
      await client.sendMessage(entity as any, { message: String(args.text) })
      return `Sent to ${to}`
    }
    case 'telegram_messages': {
      const limit = Number(args.limit ?? 20)
      const from = args.from ? String(args.from) : null
      const msgs = messageStore
        .filter(m => !from || m.from.includes(from))
        .slice(-limit)
        .map(m => `[${new Date(m.ts).toISOString()}] ${m.from}: ${m.body}`)
      return msgs.join('\n') || 'No messages yet'
    }
    default:
      return `Unknown tool: ${name}`
  }
}

// ── Minimal MCP stdio loop ──

let buffer = ''

function send(msg: any) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function handle(msg: any) {
  const { id, method, params } = msg
  if (id === undefined) return // notification
  const reply = (result: any) => send({ jsonrpc: '2.0', id, result })
  const fail = (message: string) => send({ jsonrpc: '2.0', id, error: { code: -32603, message } })

  switch (method) {
    case 'initialize':
      reply({
        protocolVersion: params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'keepmind-telegram', version: '0.1.0' }
      })
      break
    case 'tools/list':
      reply({ tools: TOOLS })
      break
    case 'tools/call':
      callTool(params?.name, params?.arguments ?? {})
        .then(r => reply({ content: [{ type: 'text', text: r }] }))
        .catch(e => fail(String(e?.message ?? e)))
      break
    case 'ping':
      reply({})
      break
    default:
      fail(`Method not found: ${method}`)
  }
}

process.stdin.on('data', (chunk: Buffer) => {
  buffer += chunk.toString()
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    try { handle(JSON.parse(line)) } catch { /* ignore malformed */ }
  }
})

process.stdin.on('end', () => {
  client?.disconnect().catch(() => {})
  process.exit(0)
})

void startClient()
