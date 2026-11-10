import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const MEMORY_DIRS = ['inbox', 'insights', 'summaries', 'skills', 'entities', 'notes', 'tasks', 'sleep', 'long-term', 'ops']

export function userMemoryRoot(vault, userId) {
  return path.join(vault, 'people', userId, 'memory')
}

export function memoryRel(userId, rel) {
  const clean = String(rel || '').replace(/^\/+/, '').replace(/\\/g, '/')
  return `people/${userId}/memory/${clean}`
}

export function ensureUserBrain(vault, userId, displayName) {
  const root = userMemoryRoot(vault, userId)
  for (const dir of MEMORY_DIRS) mkdirSync(path.join(root, dir), { recursive: true })
  const welcome = path.join(root, 'inbox', 'welcome.md')
  if (!existsSync(welcome)) {
    writeFileSync(welcome, [
      `# Welcome, ${displayName}`,
      '',
      'This is your corporate second brain — the same KeepMind memory layout as the desktop app.',
      'Company-wide notes live under `shared/memory/`.',
      ''
    ].join('\n'))
  }
  const facts = path.join(root, 'long-term', 'facts.md')
  if (!existsSync(facts)) {
    writeFileSync(facts, '# Facts\n\n## Ativos\n\n### f-welcome\n- Your corporate vault is partitioned. Personal memory stays under your user folder.\n')
  }
  mkdirSync(path.join(vault, 'shared', 'memory'), { recursive: true })
}
