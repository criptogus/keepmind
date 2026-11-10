import path from 'node:path'
import { readJson, writeJsonAtomic } from './lib.mjs'

const REL = 'ops/github-sync.json'

function filePath(vault) {
  return path.join(vault, REL)
}

export function readGithubSync(vault) {
  const data = readJson(filePath(vault), {})
  return {
    enabled: !!data.enabled,
    owner: String(data.owner || ''),
    repo: String(data.repo || ''),
    branch: String(data.branch || 'main'),
    repoPrefix: String(data.repoPrefix || 'corp-vault'),
    lastPushAt: data.lastPushAt || null,
    lastPullAt: data.lastPullAt || null,
    lastMessage: data.lastMessage || ''
  }
}

export function writeGithubSync(vault, patch) {
  const prev = readJson(filePath(vault), {})
  const next = {
    ...prev,
    ...patch,
    owner: String(patch.owner ?? prev.owner ?? '').slice(0, 80),
    repo: String(patch.repo ?? prev.repo ?? '').slice(0, 80),
    branch: String(patch.branch ?? prev.branch ?? 'main').slice(0, 80),
    repoPrefix: String(patch.repoPrefix ?? prev.repoPrefix ?? 'corp-vault').slice(0, 120)
  }
  writeJsonAtomic(filePath(vault), next)
  return readGithubSync(vault)
}
