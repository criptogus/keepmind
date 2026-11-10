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
    lastMessage: data.lastMessage || '',
    scheduleEnabled: !!data.scheduleEnabled,
    intervalMinutes: Number(data.intervalMinutes) || 60,
    hookSecretSet: Boolean(data.hookSecret)
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
    repoPrefix: String(patch.repoPrefix ?? prev.repoPrefix ?? 'corp-vault').slice(0, 120),
    scheduleEnabled: patch.scheduleEnabled !== undefined ? !!patch.scheduleEnabled : !!prev.scheduleEnabled,
    intervalMinutes: Math.max(15, Math.min(1440, Number(patch.intervalMinutes ?? prev.intervalMinutes) || 60)),
    hookSecret:
      patch.hookSecret === '' || patch.hookSecret === null
        ? undefined
        : (patch.hookSecret ? String(patch.hookSecret).slice(0, 80) : prev.hookSecret)
  }
  if (next.hookSecret === undefined && prev.hookSecret) next.hookSecret = prev.hookSecret
  writeJsonAtomic(filePath(vault), next)
  const pub = readGithubSync(vault)
  pub.hookSecret = undefined
  return pub
}

export function verifyGithubHookSecret(vault, provided) {
  const raw = readJson(filePath(vault), {})
  const secret = raw.hookSecret
  if (!secret || !provided) return false
  return String(provided) === String(secret)
}

