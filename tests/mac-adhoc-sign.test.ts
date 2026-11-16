import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const childProcess = require('node:child_process')
const { load } = require('js-yaml')
const context = {
  electronPlatformName: 'darwin',
  appOutDir: '/tmp/corp build/mac-arm64',
  packager: { appInfo: { productFilename: 'KeepMind Corp' } }
}

// Spy on the CommonJS builtin used by the builder's CommonJS hook.
function setup(platform = 'darwin') {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform as NodeJS.Platform)
  const exec = vi.spyOn(childProcess, 'execFileSync').mockImplementation(() => Buffer.alloc(0))
  const file = require.resolve('../scripts/mac-adhoc-sign.cjs')
  delete require.cache[file]
  return { exec, hook: require(file) }
}

afterEach(() => vi.restoreAllMocks())

describe('Corp macOS ad-hoc signing', () => {
  it('signs the whole product bundle, strictly verifies it, and logs its signature in order', () => {
    const { exec, hook } = setup()
    hook(context)
    const app = join(context.appOutDir, 'KeepMind Corp.app')
    expect(exec.mock.calls).toEqual([
      ['codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' }],
      ['codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' }],
      ['codesign', ['-dv', '--verbose=4', app], { stdio: 'inherit' }]
    ])
  })

  it.each(['linux', 'win32'])('skips on a %s host', platform => {
    const { exec, hook } = setup(platform)
    hook(context)
    expect(exec).not.toHaveBeenCalled()
  })

  it('skips non-mac targets on a mac host', () => {
    const { exec, hook } = setup()
    hook({ ...context, electronPlatformName: 'win32' })
    expect(exec).not.toHaveBeenCalled()
  })

  it.each([1, 2])('fails the build when codesign call %i fails', call => {
    const { exec, hook } = setup()
    const failure = new Error('codesign failed')
    for (let i = 1; i < call; i++) exec.mockImplementationOnce(() => Buffer.alloc(0))
    exec.mockImplementationOnce(() => { throw failure })
    expect(() => hook(context)).toThrow(failure)
    expect(exec).toHaveBeenCalledTimes(call)
  })

  it('wires the Corp hook after signing and disables automatic certificate selection', () => {
    const config = load(readFileSync('electron-builder.corp.yml', 'utf8'))
    expect(config.afterSign).toBe('scripts/mac-adhoc-sign.cjs')
    expect(config.mac.identity).toBeNull()
    expect(typeof require(join(process.cwd(), config.afterSign))).toBe('function')
    const main = load(readFileSync('electron-builder.yml', 'utf8'))
    expect(main.afterSign).toBeUndefined()
  })
})
