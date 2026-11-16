const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

// Corp only: avoid changing the main app's legacy safeStorage/keychain identity.
// In app-builder-lib 25.1.8 mac signApp returns true even with identity: null,
// so afterSign runs after all resource/plist changes, including for --mac --dir.
module.exports = function macAdhocSign(context) {
  if (process.platform !== 'darwin' || context.electronPlatformName !== 'darwin') return

  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  // Use argv directly so spaces in the product name/path need no shell quoting.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' })
  // codesign writes signature details to stderr; retain them in the build log.
  execFileSync('codesign', ['-dv', '--verbose=4', app], { stdio: 'inherit' })
}
