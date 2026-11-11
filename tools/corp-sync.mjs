#!/usr/bin/env node
// Bidirectional sync: pull Corp → local, then push newer local → Corp (merge newer).
//   KEEPMIND_CORP_URL=… KEEPMIND_CORP_TOKEN=… node tools/corp-sync.mjs --dir ./memory

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { pickPushRows } from '../corp/sync-merge.mjs'

function parseArgs(argv) {
  const out = { dir: './memory' }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') out.dir = argv[++i]
    else if (a === '--url') out.url = argv[++i]
  }
  out.url = (out.url || process.env.KEEPMIND_CORP_URL || 'http://127.0.0.1:8787').replace(/\/$/, '')
  out.token = process.env.KEEPMIND_CORP_TOKEN
  return out
}

function walkMd(root, base = '') {
  const files = []
  for (const name of readdirSync(root)) {
    const abs = path.join(root, name)
    const rel = base ? `${base}/${name}` : name
    const st = statSync(abs)
    if (st.isDirectory()) files.push(...walkMd(abs, rel))
    else if (name.endsWith('.md')) {
      files.push({
        path: rel.replace(/\\/g, '/'),
        content: readFileSync(abs, 'utf8'),
        updatedAt: st.mtimeMs
      })
    }
  }
  return files
}

async function main() {
  const args = parseArgs(process.argv)
  if (!args.token) {
    console.error('Set KEEPMIND_CORP_TOKEN')
    process.exit(1)
  }
  const memRoot = path.resolve(args.dir)
  const headers = {
    authorization: `Bearer ${args.token}`,
    'content-type': 'application/json',
    'x-keepmind-corp': '1'
  }
  const exp = await fetch(`${args.url}/api/brain/export`, { headers })
  if (!exp.ok) {
    console.error('export failed', exp.status)
    process.exit(1)
  }
  const bundle = await exp.json()
  const remote = bundle.files || []
  let pulled = 0
  let pullSkip = 0
  for (const row of remote) {
    const target = path.join(memRoot, row.path)
    mkdirSync(path.dirname(target), { recursive: true })
    const remoteAt = Number(row.updatedAt || 0)
  let localAt = 0
    try { localAt = statSync(target).mtimeMs } catch { /* new */ }
    if (localAt >= remoteAt && remoteAt > 0 && localAt > 0) {
      pullSkip += 1
      continue
    }
    writeFileSync(target, row.content)
    pulled += 1
  }
  const local = walkMd(memRoot)
  const remoteMap = new Map(remote.map((r) => [r.path, r]))
  const pushRows = pickPushRows(local, remoteMap, 'newer')
  let pushed = 0
  if (pushRows.length) {
    const imp = await fetch(`${args.url}/api/brain/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ merge: 'newer', files: pushRows })
    })
    const body = await imp.json().catch(() => ({}))
    if (!imp.ok) {
      console.error(body.message || body.error || imp.status)
      process.exit(1)
    }
    pushed = body.imported ?? pushRows.length
  }
  console.log(`Corp sync: pulled ${pulled} (skipped ${pullSkip}), pushed ${pushed}.`)
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
