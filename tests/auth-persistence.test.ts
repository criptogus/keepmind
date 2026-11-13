import { it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
vi.mock('sql.js', async () => {
  const actual = await vi.importActual<any>('sql.js')
  return { default: () => actual.default({ locateFile: () => createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm') }) }
})
import { AuthService } from '../src/main/services/auth'
it('preserves the same account and valid session after application replacement, and asks login after expiration', async () => {
  const root=mkdtempSync(join(tmpdir(),'km-auth-reinstall-')),profile=join(root,'profile'),installation=join(root,'app');mkdirSync(profile);mkdirSync(installation)
  try {
    const first=new AuthService(profile), user=await first.register('fixture@example.invalid','synthetic-password','Test')
    const token=await first.createSession(user.id)
    rmSync(installation,{recursive:true});mkdirSync(installation)
    const reinstalled=new AuthService(profile)
    expect(await reinstalled.hasUsers()).toBe(true)
    expect((await reinstalled.userByToken(token))?.id).toBe(user.id)
    expect((await reinstalled.verifyPassword('fixture@example.invalid','synthetic-password'))?.id).toBe(user.id)
    const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+31*864e5)
    // Expiry uses Date construction; advance fake time with real async IO unaffected.
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now+31*864e5)
    expect(await reinstalled.userByToken(token)).toBeNull()
    expect(await reinstalled.userCount()).toBe(1)
  } finally {vi.useRealTimers();vi.restoreAllMocks();rmSync(root,{recursive:true,force:true})}
})
