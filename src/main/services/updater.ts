import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

// Auto-update via GitHub Releases (electron-builder publish config).
// Only active in packaged builds — dev runs have no update feed.

export function initUpdater() {
  if (!app.isPackaged) return { packaged: false }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const send = (channel: string, payload?: any) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('updater:event', { channel, ...payload })
    }
  }

  autoUpdater.on('checking-for-update', () => send('checking'))
  autoUpdater.on('update-available', (info) => send('available', { version: info.version }))
  autoUpdater.on('update-not-available', () => send('up-to-date'))
  autoUpdater.on('download-progress', (p) =>
    send('progress', { percent: Math.round(p.percent), transferred: p.transferred, total: p.total }))
  autoUpdater.on('update-downloaded', (info) => send('downloaded', { version: info.version }))
  autoUpdater.on('error', (err) => send('error', { message: String(err?.message ?? err) }))

  // Check shortly after launch, then every 6h
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 15_000)
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000)

  return { packaged: true }
}

export function updaterStatus() {
  return { version: app.getVersion(), packaged: app.isPackaged }
}

export function checkForUpdates() {
  if (!app.isPackaged) return Promise.resolve({ packaged: false })
  return autoUpdater.checkForUpdates().then(() => ({ packaged: true })).catch((e: any) => ({ packaged: true, error: String(e?.message ?? e) }))
}

export function installUpdate() {
  if (!app.isPackaged) return false
  autoUpdater.quitAndInstall()
  return true
}
