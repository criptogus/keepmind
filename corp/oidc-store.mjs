import path from 'node:path'
import { readJson, writeJsonAtomic } from './lib.mjs'
import { getOrgSecret, setOrgSecrets } from './org-secrets.mjs'

function configPath(vault) {
  return path.join(vault, 'ops', 'oidc-config.json')
}

export function readOidcVaultConfig(vault) {
  const row = readJson(configPath(vault), null)
  if (!row || !row.issuer || !row.clientId || !row.redirectUri) return null
  const secret = getOrgSecret(vault, 'oidc') || row.clientSecret || ''
  if (!secret) return null
  return {
    issuer: String(row.issuer).replace(/\/$/, ''),
    clientId: String(row.clientId),
    clientSecret: secret,
    redirectUri: String(row.redirectUri),
    adminGroup: String(row.adminGroup || 'keepmind-admins')
  }
}

export function oidcVaultStatus(vault) {
  const row = readJson(configPath(vault), {})
  return {
    configured: Boolean(readOidcVaultConfig(vault)),
    issuer: row.issuer || '',
    clientId: row.clientId || '',
    redirectUri: row.redirectUri || '',
    adminGroup: row.adminGroup || 'keepmind-admins',
    secretSet: Boolean(getOrgSecret(vault, 'oidc') || row.clientSecret)
  }
}

export function writeOidcVaultConfig(vault, input) {
  const issuer = String(input.issuer || '').replace(/\/$/, '').trim()
  const clientId = String(input.clientId || '').trim()
  const redirectUri = String(input.redirectUri || '').trim()
  const adminGroup = String(input.adminGroup || 'keepmind-admins').trim()
  const clientSecret = String(input.clientSecret || '').trim()
  if (!issuer || !clientId || !redirectUri) {
    const err = new Error('Issuer, client id and redirect URI are required.')
    err.code = 'bad_policy'
    throw err
  }
  writeJsonAtomic(configPath(vault), { issuer, clientId, redirectUri, adminGroup })
  if (clientSecret) setOrgSecrets(vault, { oidc: clientSecret })
  return oidcVaultStatus(vault)
}

export function clearOidcVaultConfig(vault) {
  writeJsonAtomic(configPath(vault), {})
  setOrgSecrets(vault, { oidc: '' })
  return oidcVaultStatus(vault)
}
