import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

export function hashToken(secret) {
  return createHash('sha256').update(secret).digest('hex')
}

export function verifyTokenHash(secret, hashHex) {
  if (!secret || !hashHex) return false
  const a = Buffer.from(hashToken(secret), 'hex')
  const b = Buffer.from(hashHex, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function mintToken(label = 'sync') {
  const secret = randomBytes(24).toString('base64url')
  const id = randomBytes(8).toString('hex')
  return {
    id,
    label: String(label).slice(0, 40),
    secret,
    hash: hashToken(secret),
    scopes: ['memory:import', 'memory:export'],
    createdAt: new Date().toISOString()
  }
}
