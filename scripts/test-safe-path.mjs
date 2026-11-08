// Regression test for src/main/safe-path.ts (path containment + IPC patch hygiene).
// Run: node scripts/test-safe-path.mjs   (auto-bundles with esbuild first)
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = '/tmp/keepmind-safe-path-test.cjs'

execFileSync('npx', ['esbuild', 'src/main/safe-path.ts', '--bundle', '--format=cjs', '--platform=node', `--outfile=${out}`], { cwd: root, stdio: 'inherit' })
const { resolveInside, stripForbiddenKeys, isPlainObject } = require(out)

const MEM = '/tmp/km-memory'
assert.strictEqual(resolveInside(MEM, 'notes', 'a.md'), '/tmp/km-memory/notes/a.md')

for (const evil of ['../etc/passwd', 'notes/../../etc/passwd', '/etc/passwd', '..', 'a/../../../tmp/x']) {
  assert.throws(() => resolveInside(MEM, evil), /escapes root/, `should throw: ${evil}`)
}
assert.throws(() => resolveInside(MEM, 'notes', '..', '..', 'etc', 'passwd'), /escapes root/)
assert.throws(() => resolveInside(MEM, '..', 'km-memory-evil', 'x.md'), /escapes root/)

const dirty = JSON.parse('{"__proto__":{"polluted":1},"name":"ok","constructor":{"x":1}}')
const clean = stripForbiddenKeys(dirty)
assert.strictEqual(clean.name, 'ok')
assert.ok(!Object.prototype.hasOwnProperty.call(clean, '__proto__'))
assert.ok(!Object.prototype.hasOwnProperty.call(clean, 'constructor'))
assert.strictEqual({}.polluted, undefined)
assert.ok(isPlainObject({}) && !isPlainObject([]) && !isPlainObject(null))

console.log('safe-path: all assertions passed')
