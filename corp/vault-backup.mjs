import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

export function streamVaultBackup(vault, res) {
  if (!existsSync(vault)) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'no_vault' }))
    return false
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  res.writeHead(200, {
    'content-type': 'application/gzip',
    'content-disposition': `attachment; filename="keepmind-corp-vault-${stamp}.tgz"`,
    'cache-control': 'no-store'
  })
  const child = spawn('tar', ['-cz', '-C', vault, '.'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  child.stdout.pipe(res)
  child.stderr.on('data', () => {})
  child.on('error', () => {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'tar_missing', message: 'tar is required for backup on this host.' }))
  })
  return true
}
