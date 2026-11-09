import { policy, restricted } from './security/classification'
import { createHmac } from 'node:crypto'
import { createCryptoHeader, deriveKey, encryptMemory, decryptMemory, isEncrypted, type CryptoHeader } from './sync-crypto'
import type { GitHubConfig } from '../store'

const API = 'https://api.github.com'
// Device flow endpoints live on github.com, NOT api.github.com —
// api.github.com/login/* returns 404.
const WEB = 'https://github.com'

// GitHub OAuth App credentials.
// For the open-source release we ship a public client_id for the device flow.
// Power users can override via env SECOND_BRAIN_GH_CLIENT_ID.
const CLIENT_ID = process.env.SECOND_BRAIN_GH_CLIENT_ID ?? 'Ov23liBpws7Gw3TAaJCx'
const SCOPES = 'repo read:user'

export interface DeviceCode {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export async function startDeviceFlow(): Promise<DeviceCode> {
  const res = await fetch(`${WEB}/login/device/code`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPES })
  })
  if (!res.ok) throw new Error(`GitHub device flow failed: ${res.status} ${await res.text()}`)
  return res.json()
}

export type DevicePoll =
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'success'; accessToken: string; login?: string }

export async function pollDeviceFlow(deviceCode: DeviceCode): Promise<DevicePoll> {
  const res = await fetch(`${WEB}/login/oauth/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      device_code: deviceCode.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
  })
  const data = await res.json()
  if (data.access_token) {
    const user = await apiGet('/user', data.access_token)
    return { status: 'success', accessToken: data.access_token, login: user.login }
  }
  if (data.error === 'authorization_pending') return { status: 'pending' }
  if (data.error === 'slow_down') return { status: 'slow_down' }
  // expired_token / access_denied / bad_verification — terminal, caller should restart
  throw new Error(`GitHub auth error: ${data.error_description ?? data.error}`)
}

async function apiGet(path: string, token: string) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  })
  if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status}`)
  return res.json()
}

async function apiSend(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) throw new Error(`GitHub API ${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return res.status === 204 ? null : res.json()
}

export interface UserRepo {
  full_name: string
  name: string
  owner: string
  html_url: string
  private: boolean
  default_branch: string
  description?: string
  updated_at: string
}

// List the authenticated user's repos (newest first, up to 100).
export async function listUserRepos(token: string): Promise<UserRepo[]> {
  const items = await apiGet('/user/repos?per_page=100&sort=updated&type=owner', token) as any[]
  return items.map(r => ({
    full_name: r.full_name,
    name: r.name,
    owner: r.owner?.login ?? '',
    html_url: r.html_url,
    private: !!r.private,
    default_branch: r.default_branch ?? 'main',
    description: r.description ?? undefined,
    updated_at: r.updated_at ?? ''
  }))
}

// Validate that owner/repo exists and the token can read it.
export async function getRepo(token: string, owner: string, repo: string) {
  return apiGet(`/repos/${owner}/${repo}`, token) as Promise<{
    full_name: string; html_url: string; default_branch: string; private: boolean
  }>
}

export async function createRepo(token: string, name: string, description: string, privateRepo = true) {
  const repo = await apiSend('POST', '/user/repos', token, {
    name,
    description,
    private: privateRepo,
    auto_init: true,
    has_issues: false,
    has_projects: false,
    has_wiki: false
  })
  return repo as { full_name: string; html_url: string; clone_url: string; default_branch: string }
}

function repoCoords(cfg: GitHubConfig): { owner: string; repo: string; branch: string } {
  const [owner, repo] = (cfg.repoOwner && cfg.repoName)
    ? [cfg.repoOwner, cfg.repoName]
    : (cfg.repoUrl ?? '').replace(/\.git$/, '').split('/').slice(-2)
  return { owner, repo, branch: cfg.defaultBranch ?? 'main' }
}

async function pushRawFile(cfg: GitHubConfig, path: string, content: string, message: string, createOnly = false) {
  if (!cfg.accessToken) throw new Error('GitHub not connected')
  const { owner, repo, branch } = repoCoords(cfg)
  const encoded = encodeURIComponent(path)
  const apiPath = `/repos/${owner}/${repo}/contents/${encoded}`

  // get existing sha if file exists
  let sha: string | undefined
  try {
    const existing = await apiGet(`${apiPath}?ref=${branch}`, cfg.accessToken)
    sha = existing.sha
  } catch (error) {
    if (!(error instanceof Error) || !/: 404$/.test(error.message)) throw error
  }
  if (createOnly && sha) throw new Error('Encryption header was created concurrently; retry sync')

  const res = await apiSend('PUT', apiPath, cfg.accessToken, {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch,
    ...(sha ? { sha } : {})
  })
  return res?.content?.sha ?? null
}

export async function listRepoFiles(cfg: GitHubConfig, dir = ''): Promise<string[]> {
  if (!cfg.accessToken || !cfg.repoOwner || !cfg.repoName) return []
  try {
    const items = await apiGet(`/repos/${cfg.repoOwner}/${cfg.repoName}/contents/${dir}`, cfg.accessToken)
    return (items as any[]).map(i => i.path)
  } catch {
    return []
  }
}

// ── Bidirectional sync helpers ──

export interface RemoteFile { path: string; sha: string }

// Recursive git tree under `prefix` (e.g. 'memory/'). Returns blob entries only.
export async function listTree(cfg: GitHubConfig, prefix = 'memory/'): Promise<RemoteFile[]> {
  if (!cfg.accessToken) return []
  const { owner, repo, branch } = repoCoords(cfg)
  const tree = await apiGet(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, cfg.accessToken)
  if (tree.truncated) throw new Error('GitHub tree is truncated; refusing incomplete sync')
  const files = ((tree.tree ?? []) as any[])
    .filter(t => t.type === 'blob' && t.path?.startsWith(prefix) && !t.path.startsWith('.keepmind/'))
    .map(t => ({ path: t.path.slice(prefix.length), sha: t.sha }))
  if (!cfg.encryptionEnabled) {
    if (await remoteHeader(cfg)) throw new Error('This repository is encrypted')
    return files
  }
  if (!await remoteHeader(cfg)) return files // first migration enumerates legacy names
  return withKey(cfg, false, async key => {
    const manifest = await readManifest(cfg, key)
    return files.map(f => {
      if (/^[a-f0-9]{64}\.enc$/.test(f.path)) {
        const rel = manifest[f.path]
        if (!rel || remoteFilename(rel, key) !== f.path) throw new Error('Invalid encrypted manifest')
        return { ...f, path: rel }
      }
      return f
    })
  })

}

// Delete a file under memory/ (relPath is relative to memory/).
export async function deleteMemoryFile(cfg: GitHubConfig, relPath: string, root = 'memory/') {
  if (!cfg.accessToken) throw new Error('GitHub not connected')
  const { owner, repo, branch } = repoCoords(cfg)
  const remote = cfg.encryptionEnabled ? await withKey(cfg, false, async key => remoteFilename(relPath, key)) : relPath
  const apiPath = `/repos/${owner}/${repo}/contents/${root}${encodeURIComponent(remote)}`
  let sha: string
  try {
    const existing = await apiGet(`${apiPath}?ref=${branch}`, cfg.accessToken)
    sha = existing.sha
  } catch {
    return // already gone
  }
  await apiSend('DELETE', apiPath, cfg.accessToken, { message: 'sync: remove memory file', sha, branch })
  // Retain manifest tombstones: they allow safe recovery if a concurrent delete is interrupted.
}

// Fetch a single file's content + blob sha (paths are relative to memory/).
export async function fetchMemoryFile(cfg: GitHubConfig, relPath: string, rootOrAllowPlaintext: string | boolean = 'memory/', allowPlaintext = false): Promise<{ content: string; sha: string } | null> {
  const root = typeof rootOrAllowPlaintext === 'string' ? rootOrAllowPlaintext : 'memory/'
  if (typeof rootOrAllowPlaintext === 'boolean') allowPlaintext = rootOrAllowPlaintext
  if (!cfg.accessToken) return null
  try {
    const { owner, repo, branch } = repoCoords(cfg)
    const remote = cfg.encryptionEnabled && await remoteHeader(cfg) ? await withKey(cfg, false, async key => {
      const manifest = await readManifest(cfg, key), name = remoteFilename(relPath, key)
      return manifest[name] === relPath ? name : relPath
    }) : relPath
    const data = await apiGet(`/repos/${owner}/${repo}/contents/${root}${encodeURIComponent(remote)}?ref=${branch}`, cfg.accessToken)
    const content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8')
    if (!isEncrypted(content) && cfg.encryptionEnabled && !allowPlaintext) {
      throw new Error('Encrypted sync received plaintext memory; refusing downgrade')
    }
    return { content: isEncrypted(content)
      ? await withKey(cfg, false, key => decryptMemory(content, key))
      : content, sha: data.sha }
  } catch (error) {
    if (error instanceof Error && /: 404$/.test(error.message)) return null
    throw error
  }
}

// Passphrases and derived keys live only in this process, never in config or IPC responses.
let sessionPassphrase = ''
export function unlockSync(passphrase: string) { sessionPassphrase = passphrase }
export function lockSync() { sessionPassphrase = '' }
const CRYPTO_PATH = '.keepmind/crypto.json'
async function remoteHeader(cfg: GitHubConfig): Promise<CryptoHeader | null> {
  const { owner, repo, branch } = repoCoords(cfg)
  const res = await fetch(`${API}/repos/${owner}/${repo}/contents/${CRYPTO_PATH}?ref=${encodeURIComponent(branch)}`, {
    headers: { Authorization: `Bearer ${cfg.accessToken}`, Accept: 'application/vnd.github+json' }
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Could not read encryption header: ${res.status}`)
  const data = await res.json()
  return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'))
}
async function withKey<T>(cfg: GitHubConfig, create: boolean, fn: (key: Uint8Array) => Promise<T>): Promise<T> {
  if (!sessionPassphrase) throw new Error('Encrypted sync is locked. Enter your passphrase in Settings for this session.')
  let header = await remoteHeader(cfg)
  if (!header) {
    if (!create) throw new Error('Missing KeepMind encryption header')
    header = await createCryptoHeader()
    // The sentinel authenticates the passphrase before any memory is overwritten.
    const key = await deriveKey(sessionPassphrase, header)
    try {
      const check = await encryptMemory('KeepMind key verification', key)
      await pushRawFile(cfg, CRYPTO_PATH, JSON.stringify({ ...header, check }), 'sync: initialize encryption', true)
      return await fn(key)
    } finally { key.fill(0) }
  }
  const key = await deriveKey(sessionPassphrase, header)
  try {
    const check = (header as CryptoHeader & { check?: string }).check
    if (!check || await decryptMemory(check, key) !== 'KeepMind key verification') throw new Error('Invalid encryption header verification')
    return await fn(key)
  } finally { key.fill(0) }
}
async function uploadFile(cfg: GitHubConfig, path: string, content: string, message: string) {
  const root = cfg.syncRoot ?? 'memory/'
  if (!path.startsWith(root)) return pushRawFile(cfg, path, content, message)
  if (!cfg.encryptionEnabled && restricted(policy(content).class)) throw new Error('Restricted memory requires encrypted sync')
  const header = await remoteHeader(cfg)
  if (header && !cfg.encryptionEnabled) throw new Error('This repository is encrypted. Enable encrypted sync to upload memory.')
  if (cfg.encryptionEnabled) return withKey(cfg, true, async key => {
    const rel = path.slice(root.length), name = remoteFilename(rel, key)
    const manifest = await readManifest(cfg, key)
    // Publish mapping first so an interrupted upload never leaves an unresolvable blob.
    manifest[name] = rel
    await pushRawFile(cfg, MANIFEST_PATH, await encryptMemory(JSON.stringify(manifest), key), 'sync: update encrypted manifest')
    const sha = await pushRawFile(cfg, `${root}${name}`, await encryptMemory(content, key), message)
    // Remove the legacy path only after both encrypted writes succeeded.
    const { owner, repo, branch } = repoCoords(cfg)
    const oldPath = `/repos/${owner}/${repo}/contents/${root}${encodeURIComponent(rel)}`
    try {
      const old = await apiGet(`${oldPath}?ref=${branch}`, cfg.accessToken!)
      await apiSend('DELETE', oldPath, cfg.accessToken!, { message: 'sync: retire legacy filename', sha: old.sha, branch })
    } catch (error) { if (!(error instanceof Error && /: 404$/.test(error.message))) throw error }
    return sha
  })
  return pushRawFile(cfg, path, content, message)
}

// Serialize writes so independent manual/background uploads cannot race header initialization.
let uploadQueue: Promise<unknown> = Promise.resolve()
export function pushFile(cfg: GitHubConfig, path: string, content: string, message: string): Promise<string | null> {
  const upload = uploadQueue.then(() => uploadFile(cfg, path, content, message))
  uploadQueue = upload.catch(() => {})
  return upload
}
export async function verifySyncPassphrase(cfg: GitHubConfig): Promise<void> {
  if (!cfg.accessToken || !(cfg.repoOwner || cfg.repoUrl)) return
  if (await remoteHeader(cfg)) await withKey(cfg, false, async () => {})
}

const MANIFEST_PATH = '.keepmind/manifest.enc'
export function remoteFilename(path: string, key: Uint8Array): string {
  return createHmac('sha256', key).update('keepmind:remote-filename:v1:').update(path).digest('hex') + '.enc'
}
async function readManifest(cfg: GitHubConfig, key: Uint8Array): Promise<Record<string, string>> {
  const { owner, repo, branch } = repoCoords(cfg)
  try {
    const data = await apiGet(`/repos/${owner}/${repo}/contents/${MANIFEST_PATH}?ref=${branch}`, cfg.accessToken!)
    const result = JSON.parse(await decryptMemory(Buffer.from(data.content, 'base64').toString('utf8'), key))
    if (!result || typeof result !== 'object' || Array.isArray(result) || Object.entries(result).some(([k, v]) => typeof v !== 'string' || remoteFilename(v, key) !== k)) throw new Error('Invalid encrypted manifest')
    return result
  } catch (error) { if (error instanceof Error && /: 404$/.test(error.message)) return {}; throw error }
}

// For generated, sanitized repo metadata only; memory uploads use pushFile.
export function pushMetadataFile(cfg: GitHubConfig, path: string, content: string, message: string) {
  return pushRawFile(cfg, path, content, message)
}
