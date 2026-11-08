import { app, BrowserWindow, net } from 'electron'
import { autoUpdater } from 'electron-updater'
import { createWriteStream, existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

// Two update channels:
//  1. electron-updater → GitHub "latest" release (tagged v* builds).
//     Requires a signed app on macOS to auto-install.
//  2. "continuous" channel → rolling prerelease rebuilt on every push to
//     main. Custom downloader + self-swap installer that works unsigned.

const REPO = 'criptogus/keepmind'
const CONTINUOUS_TAG = 'continuous'

interface ContinuousUpdate {
  version: string
  url: string
  name: string
  marker: string
}

let pendingContinuous: { file: string; version: string } | null = null
let checking = false

// The continuous release keeps the same semver between version bumps, so we
// track "already seen" by release timestamp + asset digest instead.
function stateFile(): string {
  return join(app.getPath('userData'), 'continuous-state.json')
}
function seenMarker(): string | null {
  try { return JSON.parse(readFileSync(stateFile(), 'utf8')).seen ?? null } catch { return null }
}
function markSeen(marker: string) {
  try { writeFileSync(stateFile(), JSON.stringify({ seen: marker })) } catch {}
}

function send(channel: string, payload?: any) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updater:event', { channel, ...payload })
  }
}

// ── electron-updater (signed releases) ──

export function initUpdater() {
  if (!app.isPackaged) return { packaged: false }

  autoUpdater.autoDownload = false // we drive downloads ourselves below
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => send('checking'))
  autoUpdater.on('update-available', (info) => send('available', { version: info.version }))
  autoUpdater.on('update-not-available', () => send('up-to-date'))
  autoUpdater.on('update-downloaded', (info) => send('downloaded', { version: info.version }))
  autoUpdater.on('error', (err) => send('error', { message: String(err?.message ?? err) }))

  const tick = () => { void checkForUpdates() }
  setTimeout(tick, 15_000)
  setInterval(tick, 6 * 60 * 60 * 1000)

  return { packaged: true }
}

export function updaterStatus() {
  return { version: app.getVersion(), packaged: app.isPackaged }
}

// ── semver-ish compare ──

function parseVersion(v: string): number[] {
  return (v.match(/\d+/g) ?? []).slice(0, 3).map(Number)
}
function versionGt(a: string, b: string): boolean {
  const [x, y] = [parseVersion(a), parseVersion(b)]
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  }
  return false
}

// ── continuous channel ──

function assetNameForPlatform(): RegExp {
  if (process.platform === 'darwin') {
    // universal build preferred; fall back to arch-specific
    return process.arch === 'arm64' ? /-universal-mac\.zip$|-arm64-mac\.zip$/ : /-universal-mac\.zip$|-x64-mac\.zip$/
  }
  if (process.platform === 'win32') return /\.exe$/
  return /\.AppImage$/
}

async function findContinuousUpdate(): Promise<ContinuousUpdate | null> {
  const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/tags/${CONTINUOUS_TAG}`, {
    headers: { 'User-Agent': 'keepmind-updater', Accept: 'application/vnd.github+json' }
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`github api ${res.status}`)
  const rel = await res.json() as any
  const re = assetNameForPlatform()
  const asset = (rel.assets ?? []).find((a: any) => re.test(a.name))
  if (!asset) return null
  const m = asset.name.match(/(\d+\.\d+\.\d+)/)
  const version = m?.[1] ?? rel.tag_name
  const marker = `${rel.updated_at ?? rel.created_at}:${asset.digest ?? asset.id}`
  // Newer semver always wins. Same version = update only when the release
  // marker changed (new push to main) and we've already recorded a baseline.
  if (!versionGt(version, app.getVersion())) {
    if (!existsSync(stateFile())) { markSeen(marker); return null }
    if (marker === seenMarker()) return null
  }
  return { version, url: asset.browser_download_url, name: asset.name, marker }
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await net.fetch(url, { headers: { 'User-Agent': 'keepmind-updater' } })
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  mkdirSync(dirname(dest), { recursive: true })
  const out = createWriteStream(dest)
  const reader = res.body.getReader()
  let transferred = 0, lastPct = -1
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      out.write(Buffer.from(value))
      transferred += value.byteLength
      if (total) {
        const pct = Math.round((transferred / total) * 100)
        if (pct !== lastPct) { lastPct = pct; send('progress', { percent: pct, transferred, total }) }
      }
    }
  } finally {
    await new Promise<void>((r) => out.end(r))
  }
}

// ── self-install ──

function appBundlePath(): string {
  // <App>.app/Contents/MacOS/<bin> → <App>.app
  return join(dirname(dirname(dirname(process.execPath))))
}

// macOS: unzip → swap .app via detached helper script → relaunch.
// Works unsigned because we replace the bundle ourselves.
async function installMac(updateFile: string, version: string): Promise<void> {
  const work = join(app.getPath('userData'), 'update')
  mkdirSync(work, { recursive: true })
  const dest = join(work, 'extracted')
  await execFileP('ditto', ['-x', '-k', updateFile, dest])
  const newApp = join(dest, 'KeepMind.app')
  if (!existsSync(newApp)) throw new Error('KeepMind.app not found in update archive')

  const target = appBundlePath()
  const script = join(work, 'swap.sh')
  writeFileSync(script, [
    '#!/bin/bash',
    'sleep 2',
    `rm -rf ${JSON.stringify(target)}`,
    `cp -R ${JSON.stringify(newApp)} ${JSON.stringify(dirname(target))}/`,
    `open -a ${JSON.stringify(join(dirname(target), 'KeepMind.app'))}`,
    ''
  ].join('\n'))
  chmodSync(script, 0o755)
  const child = spawn('nohup', ['bash', script], { detached: true, stdio: 'ignore' })
  child.unref()
  app.quit()
}

// Windows: NSIS installer supports silent /S; it relaunches the app itself.
async function installWin(updateFile: string): Promise<void> {
  const child = spawn(updateFile, ['/S'], { detached: true, stdio: 'ignore' })
  child.unref()
  app.quit()
}

// Linux: AppImage is a single file — swap it like the macOS bundle.
async function installLinux(updateFile: string): Promise<void> {
  const target = process.env.APPIMAGE ?? process.execPath
  const script = join(tmpdir(), `keepmind-update-${Date.now()}.sh`)
  writeFileSync(script, [
    '#!/bin/bash',
    'sleep 2',
    `chmod +x ${JSON.stringify(updateFile)}`,
    `cp ${JSON.stringify(updateFile)} ${JSON.stringify(target)}`,
    `nohup ${JSON.stringify(target)} >/dev/null 2>&1 &`,
    ''
  ].join('\n'))
  chmodSync(script, 0o755)
  const child = spawn('nohup', ['bash', script], { detached: true, stdio: 'ignore' })
  child.unref()
  app.quit()
}

async function applyPending(): Promise<void> {
  if (!pendingContinuous) return
  const { file, version } = pendingContinuous
  send('installing', { version })
  try {
    if (process.platform === 'darwin') await installMac(file, version)
    else if (process.platform === 'win32') await installWin(file)
    else await installLinux(file)
  } catch (e: any) {
    send('error', { message: `install failed: ${e?.message ?? e}` })
    pendingContinuous = null
  }
}

// ── public API ──

export async function checkForUpdates(): Promise<any> {
  if (!app.isPackaged) return { packaged: false }

  // continuous channel first (works unsigned; covers every main push)
  if (!checking) {
    checking = true
    try {
      send('checking')
      const upd = await findContinuousUpdate()
      if (upd) {
        send('available', { version: upd.version, channel: 'continuous' })
        const dest = join(app.getPath('userData'), 'update', upd.name)
        await downloadToFile(upd.url, dest)
        pendingContinuous = { file: dest, version: upd.version }
        markSeen(upd.marker) // don't re-download every 6h while awaiting restart
        send('downloaded', { version: upd.version, channel: 'continuous' })
        return { packaged: true, continuous: upd.version }
      }
      send('up-to-date')
      // electron-updater stays dormant: it needs a signed app + a "latest"
      // release on macOS, and errors noisily without one. The continuous
      // channel above is the update path until we ship signed builds.
      return { packaged: true, continuous: null }
    } catch (e: any) {
      send('error', { message: String(e?.message ?? e) })
      return { packaged: true, error: String(e?.message ?? e) }
    } finally {
      checking = false
    }
  }
  return { packaged: true, busy: true }
}

export function installUpdate() {
  if (!app.isPackaged) return false
  if (pendingContinuous) { void applyPending(); return true }
  try { autoUpdater.quitAndInstall(); return true } catch { return false }
}
