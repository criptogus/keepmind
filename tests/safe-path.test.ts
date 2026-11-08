import { describe, it, expect } from 'vitest'
import { resolveInside, stripForbiddenKeys, isPlainObject } from '../src/main/safe-path'
describe('safe paths and patches', () => {
  it('allows contained paths', () => expect(resolveInside('/tmp/km-memory', 'notes', 'a.md')).toBe('/tmp/km-memory/notes/a.md'))
  it.each(['../etc/passwd', 'notes/../../etc/passwd', '/etc/passwd', '..', 'a/../../../tmp/x', '../km-memory-evil/x.md'])('rejects %s', path => {
    expect(() => resolveInside('/tmp/km-memory', path)).toThrow(/escapes root/)
  })
  it('rejects traversal spread across arguments', () => expect(() => resolveInside('/tmp/km-memory', 'notes', '..', '..', 'etc', 'passwd')).toThrow())
  it('strips prototype pollution keys', () => {
    const clean = stripForbiddenKeys(JSON.parse('{"__proto__":{"polluted":1},"name":"ok","constructor":{"x":1}}'))
    expect(clean).toEqual({ name: 'ok' })
    expect(Object.hasOwn(clean, '__proto__')).toBe(false)
    expect(Object.hasOwn(clean, 'constructor')).toBe(false)
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(null)).toBe(false)
  })
})
