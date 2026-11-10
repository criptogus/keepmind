#!/usr/bin/env node
// Push a KeepMind memory bundle into KeepMind Corp (import API).
// Usage:
//   node tools/corp-push.mjs --url http://127.0.0.1:8787 --token "$CORP_TOKEN" --bundle ./export.json
//   KEEPMIND_CORP_TOKEN=... node tools/corp-push.mjs --url ... --dir ./memory

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const out = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--url') out.url = argv[++i]
    else if (a === '--token') out.token = argv[++i]
    else if (a === '--bundle') out.bundle = argv[++i]
    else if (a === '--dir') out.dir = argv[++i]
    else if (a === '--email') out.email = argv[++i]
    else if (a === '--password') out.password = argv[++i]
  }
  out.token = out.token || process.env.KEEPMIND_CORP_TOKEN
  return out
}

function walkMd(root, base = '') {
  const files = []
  for (const name of readdirSync(root)) {
    const abs = path.join(root, name)
    const rel = base ? `${base}/${name}` : name
    const st = statSync(abs)
    if (st.isDirectory()) files.push(...walkMd(abs, rel))
    else if (name.endsWith('.md')) files.push({ path: rel.replace(/\\/g, '/'), abs })
  }
  return files
}

async function login(base, email, password) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-keepmind-corp': '1' },
    body: JSON.stringify({ email, password })
  })
  if (!res.ok) throw new Error(`login failed: ${res.status}`)
  const cookie = res.headers.getSetCookie?.()?.find(c => c.startsWith('kmcorp='))
    || res.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('no session cookie')
  return cookie
}

async function main() {
  const args = parseArgs(process.argv)
  const base = String(args.url || 'http://127.0.0.1:8787').replace(/\/$/, '')
  let files = []
  if (args.bundle) {
    const bundle = JSON.parse(readFileSync(args.bundle, 'utf8'))
    files = bundle.files || []
  } else if (args.dir) {
    files = walkMd(path.resolve(args.dir)).map(f => ({
      path: f.path,
      content: readFileSync(f.abs, 'utf8')
    }))
  } else {
    console.error('Provide --bundle export.json or --dir path/to/memory')
    process.exit(1)
  }
  let headers = { 'content-type': 'application/json', 'x-keepmind-corp': '1' }
  if (args.token) headers.authorization = `Bearer ${args.token}`
  else if (args.email && args.password) {
    const cookie = await login(base, args.email, args.password)
    headers.cookie = cookie
  } else {
    console.error('Set --token or --email + --password (or KEEPMIND_CORP_TOKEN)')
    process.exit(1)
  }
  const res = await fetch(`${base}/api/brain/import`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ files })
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error(body.message || body.error || res.status)
    process.exit(1)
  }
  console.log(`Imported ${body.imported ?? 0} file(s) into KeepMind Corp.`)
}

main().catch(err => {
  console.error(err.message || err)
  process.exit(1)
})
