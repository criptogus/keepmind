import type { GitHubConfig } from '../store'

const API = 'https://api.github.com'

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
  const res = await fetch(`${API}/login/device/code`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPES })
  })
  if (!res.ok) throw new Error(`GitHub device flow failed: ${res.status} ${await res.text()}`)
  return res.json()
}

export async function pollDeviceFlow(deviceCode: DeviceCode): Promise<{ accessToken: string; login?: string } | null> {
  const res = await fetch(`${API}/login/oauth/access_token`, {
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
    return { accessToken: data.access_token, login: user.login }
  }
  if (data.error === 'authorization_pending' || data.error === 'slow_down') return null
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

export async function pushFile(cfg: GitHubConfig, path: string, content: string, message: string) {
  if (!cfg.accessToken) throw new Error('GitHub not connected')
  const { owner, repo, branch } = repoCoords(cfg)
  const encoded = encodeURIComponent(path)
  const apiPath = `/repos/${owner}/${repo}/contents/${encoded}`

  // get existing sha if file exists
  let sha: string | undefined
  try {
    const existing = await apiGet(`${apiPath}?ref=${branch}`, cfg.accessToken)
    sha = existing.sha
  } catch { /* new file */ }

  await apiSend('PUT', apiPath, cfg.accessToken, {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch,
    ...(sha ? { sha } : {})
  })
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
  try {
    const { owner, repo } = repoCoords(cfg)
    const tree = await apiGet(`/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, cfg.accessToken)
    return ((tree.tree ?? []) as any[])
      .filter(t => t.type === 'blob' && t.path?.startsWith(prefix))
      .map(t => ({ path: t.path.slice(prefix.length), sha: t.sha }))
  } catch {
    return []
  }
}

// Fetch a single file's content + blob sha (paths are relative to memory/).
export async function fetchMemoryFile(cfg: GitHubConfig, relPath: string): Promise<{ content: string; sha: string } | null> {
  if (!cfg.accessToken) return null
  try {
    const { owner, repo, branch } = repoCoords(cfg)
    const data = await apiGet(`/repos/${owner}/${repo}/contents/memory/${encodeURIComponent(relPath)}?ref=${branch}`, cfg.accessToken)
    const content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8')
    return { content, sha: data.sha }
  } catch {
    return null
  }
}
