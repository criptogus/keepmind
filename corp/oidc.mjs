// OIDC authorization-code + PKCE. RS256 only. No unsigned tokens.

import { randomBytes } from 'node:crypto'
import { sha256 } from './lib.mjs'

export function oidcFromEnv(env = process.env) {
  const issuer = env.KEEPMIND_CORP_OIDC_ISSUER || ''
  const clientId = env.KEEPMIND_CORP_OIDC_CLIENT_ID || ''
  const clientSecret = env.KEEPMIND_CORP_OIDC_CLIENT_SECRET || ''
  const redirectUri = env.KEEPMIND_CORP_OIDC_REDIRECT_URI || ''
  if (!issuer || !clientId || !clientSecret || !redirectUri) return null
  return {
    issuer: issuer.replace(/\/$/, ''),
    clientId,
    clientSecret,
    redirectUri,
    adminGroup: env.KEEPMIND_CORP_OIDC_ADMIN_GROUP || 'keepmind-admins'
  }
}

export function createOidc(config, fetchImpl = globalThis.fetch) {
  let discovery = null
  const pending = new Map()

  async function disco() {
    if (discovery) return discovery
    const res = await fetchImpl(`${config.issuer}/.well-known/openid-configuration`)
    if (!res.ok) {
      const err = new Error('The identity provider discovery document was not available.')
      err.code = 'oidc_down'
      throw err
    }
    discovery = await res.json()
    if (!discovery.authorization_endpoint || !discovery.token_endpoint || !discovery.jwks_uri) {
      const err = new Error('The identity provider discovery document is incomplete.')
      err.code = 'oidc_down'
      throw err
    }
    return discovery
  }

  return {
    config,
    async start() {
      const doc = await disco()
      const verifier = randomBytes(32).toString('base64url')
      const challenge = sha256(verifier).toString('base64url')
      const state = randomBytes(16).toString('hex')
      pending.set(state, { verifier, exp: Date.now() + 10 * 60 * 1000 })
      const url = new URL(doc.authorization_endpoint)
      url.searchParams.set('client_id', config.clientId)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', 'openid email profile')
      url.searchParams.set('redirect_uri', config.redirectUri)
      url.searchParams.set('state', state)
      url.searchParams.set('code_challenge', challenge)
      url.searchParams.set('code_challenge_method', 'S256')
      return url.toString()
    },
    take(state) {
      const row = pending.get(state)
      pending.delete(state)
      if (!row || row.exp < Date.now()) return null
      return row
    },
    async exchange(code, verifier) {
      const doc = await disco()
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        code_verifier: verifier
      })
      const res = await fetchImpl(doc.token_endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`
        },
        body
      })
      if (!res.ok) {
        const err = new Error('The identity provider rejected the sign-in code.')
        err.code = 'bad_token'
        throw err
      }
      const token = await res.json()
      if (!token.id_token) {
        const err = new Error('The identity provider did not return an identity token.')
        err.code = 'bad_token'
        throw err
      }
      const keys = await fetchImpl(doc.jwks_uri)
      if (!keys.ok) {
        const err = new Error('The identity provider keys were not available.')
        err.code = 'oidc_down'
        throw err
      }
      return { idToken: token.id_token, jwks: await keys.json() }
    }
  }
}
