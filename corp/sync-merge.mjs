/** Merge remote import rows into local writes (path relative to user memory root). */
export function mergeImportRows(rows, { readLocal, writeLocal, mode = 'newer' }) {
  let imported = 0
  let skipped = 0
  for (const row of rows) {
    const rel = String(row.path || '').trim()
    const content = String(row.content ?? '')
    if (!rel.endsWith('.md') || !rel) continue
    const remoteAt = Number(row.updatedAt || 0)
    let localAt = 0
    let localText = null
    try {
      localText = readLocal(rel)
      localAt = localText ? (readLocal.mtime?.(rel) ?? 0) : 0
    } catch {
      localText = null
    }
    if (mode === 'force' || localText == null) {
      writeLocal(rel, content)
      imported += 1
      continue
    }
    if (mode === 'newer') {
      if (remoteAt > localAt) {
        writeLocal(rel, content)
        imported += 1
      } else skipped += 1
    }
  }
  return { imported, skipped }
}

export function pickPushRows(localRows, remoteByPath, mode = 'newer') {
  const out = []
  for (const row of localRows) {
    const rel = row.path
    const remote = remoteByPath.get(rel)
    if (!remote) {
      out.push(row)
      continue
    }
    if (mode === 'newer' && (row.updatedAt ?? 0) > (remote.updatedAt ?? 0)) out.push(row)
  }
  return out
}
