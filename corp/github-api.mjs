const API = 'https://api.github.com'

async function ghFetch(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) {
    const text = (await res.text()).catch(() => '') || ''
    const err = new Error(`GitHub ${method} ${path}: ${res.status} ${text.slice(0, 120)}`)
    err.code = res.status === 401 ? 'bad_token' : 'github_error'
    throw err
  }
  if (res.status === 204) return null
  return res.json()
}

export async function getFileMeta(token, owner, repo, filePath, branch) {
  const enc = filePath.split('/').map(encodeURIComponent).join('/')
  try {
    return await ghFetch(token, 'GET', `/repos/${owner}/${repo}/contents/${enc}?ref=${encodeURIComponent(branch)}`)
  } catch (e) {
    if (e.code === 'github_error' && String(e.message).includes(': 404')) return null
    throw e
  }
}

export async function putFile(token, owner, repo, filePath, content, message, branch, sha) {
  const enc = filePath.split('/').map(encodeURIComponent).join('/')
  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch
  }
  if (sha) body.sha = sha
  return ghFetch(token, 'PUT', `/repos/${owner}/${repo}/contents/${enc}`, body)
}

export async function listDir(token, owner, repo, dirPath, branch) {
  const enc = dirPath ? `${dirPath.split('/').map(encodeURIComponent).join('/')}` : ''
  const path = enc ? `/repos/${owner}/${repo}/contents/${enc}?ref=${encodeURIComponent(branch)}` : `/repos/${owner}/${repo}/contents?ref=${encodeURIComponent(branch)}`
  const data = await ghFetch(token, 'GET', path)
  return Array.isArray(data) ? data : [data]
}
