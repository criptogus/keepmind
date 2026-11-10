import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { Store } from '../store'

export interface CorpSyncResult {
  pulled: number
  pullSkipped: number
  pushed: number
  error?: string
}

function walkMd(root: string, base = ''): Array<{ path: string; content: string; updatedAt: number }> {
  const files: Array<{ path: string; content: string; updatedAt: number }> = []
  if (!existsSync(root)) return files
  for (const name of readdirSync(root)) {
    const abs = join(root, name)
    const rel = base ? `${base}/${name}` : name
    const st = statSync(abs)
    if (st.isDirectory()) files.push(...walkMd(abs, rel))
    else if (name.endsWith('.md')) {
      files.push({ path: rel.replace(/\\/g, '/'), content: readFileSync(abs, 'utf8'), updatedAt: st.mtimeMs })
    }
  }
  return files
}

export async function corpSyncNow(store: Store): Promise<CorpSyncResult> {
  const cfg = store.get().corpSync
  const base = String(cfg?.baseUrl || '').replace(/\/$/, '')
  const token = String(cfg?.token || '').trim()
  if (!base || !token) throw new Error('Corp sync URL and token are required in Settings.')
  const memRoot = store.memoryDir
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-keepmind-corp': '1'
  }
  const exp = await fetch(`${base}/api/brain/export`, { headers })
  if (!exp.ok) throw new Error(`Corp export failed (${exp.status})`)
  const bundle = (await exp.json()) as { files?: Array<{ path: string; content: string; updatedAt?: number }> }
  const remote = bundle.files ?? []
  let pulled = 0
  let pullSkipped = 0
  for (const row of remote) {
    const target = join(memRoot, row.path)
    mkdirSync(dirname(target), { recursive: true })
    const remoteAt = Number(row.updatedAt || 0)
    let localAt = 0
    try {
      localAt = statSync(target).mtimeMs
    } catch {
      /* new file */
    }
    if (localAt >= remoteAt && remoteAt > 0 && localAt > 0) {
      pullSkipped += 1
      continue
    }
    writeFileSync(target, row.content)
    pulled += 1
  }
  const local = walkMd(memRoot)
  const remoteMap = new Map(remote.map((r) => [r.path, r]))
  const pushRows = local.filter((row) => {
    const remoteRow = remoteMap.get(row.path)
    if (!remoteRow) return true
    return (row.updatedAt ?? 0) > (remoteRow.updatedAt ?? 0)
  })
  let pushed = 0
  if (pushRows.length) {
    const imp = await fetch(`${base}/api/brain/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ merge: 'newer', files: pushRows })
    })
    const body = (await imp.json().catch(() => ({}))) as { imported?: number; message?: string; error?: string }
    if (!imp.ok) throw new Error(body.message || body.error || `Corp import failed (${imp.status})`)
    pushed = body.imported ?? pushRows.length
  }
  const now = new Date().toISOString()
  store.set({
    corpSync: {
      ...cfg,
      baseUrl: base,
      token,
      lastPullAt: now,
      lastPushAt: pushed ? now : cfg?.lastPushAt ?? null,
      lastStatus: `pulled ${pulled}, pushed ${pushed}`
    }
  })
  return { pulled, pullSkipped, pushed }
}
