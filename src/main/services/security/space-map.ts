import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Memory } from '../brain/memory-store'
import { frontmatter, policy } from './classification'
import type { SpaceKeys } from './keys'

const valid = (space: string) => /^[a-zA-Z0-9_-]{1,80}$/.test(space)
export interface SpaceMap { aliases: Record<string, string>; approved: true; approved_at: string }
export function approvedSpaceMap(file: string): SpaceMap {
  if (!existsSync(file)) throw new Error('Approved state/space-map.json required')
  const config = JSON.parse(readFileSync(file, 'utf8'))
  if (config.approved !== true || typeof config.approved_at !== 'string' || !Number.isFinite(Date.parse(config.approved_at))) throw new Error('Space map requires explicit approval and approved_at')
  if (!config.aliases || typeof config.aliases !== 'object' || Array.isArray(config.aliases)) throw new Error('Invalid space aliases')
  for (const [source, target] of Object.entries(config.aliases)) {
    if (!valid(source) || typeof target !== 'string' || !valid(target)) throw new Error('Invalid space alias')
    const seen = new Set<string>([source]); let current = target
    while (Object.hasOwn(config.aliases, current)) {
      if (seen.has(current)) throw new Error('Cyclic space aliases')
      seen.add(current); current = config.aliases[current]
    }
    if (seen.has(current)) throw new Error('Cyclic space aliases')
  }
  return config
}
export function canonicalSpace(space: string, config: SpaceMap): string {
  while (Object.hasOwn(config.aliases, space)) space = config.aliases[space]
  return space
}
function noteFiles(root: string, state: string, prefix = ''): string[] {
  if (!existsSync(join(root, prefix))) return []
  const files: string[] = []
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name === 'ops') continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (resolve(root, rel) === resolve(state)) continue
    if (entry.isDirectory()) files.push(...noteFiles(root, state, rel))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(rel)
  }
  return files.sort()
}
function storedSpace(text: string): string {
  if (text.startsWith('KEEPMIND-ITEM:1\n')) {
    const space = JSON.parse(text.slice('KEEPMIND-ITEM:1\n'.length)).space
    if (typeof space !== 'string' || !valid(space)) throw new Error('Invalid stored space')
    return space
  }
  return policy(text).space
}
// Suggestions disclose identifiers and aggregate counts, never note paths/text.
// They never generate approval or apply a merge.
export function suggestSpaces(root: string, state: string) {
  const counts = new Map<string, number>()
  for (const file of noteFiles(root, state)) {
    const space = storedSpace(readFileSync(join(root, file), 'utf8'))
    counts.set(space, (counts.get(space) ?? 0) + 1)
  }
  return [...counts].filter(([space]) => space.startsWith('board-') && counts.has(`company-${space.slice(6)}`))
    .sort(([a], [b]) => a.localeCompare(b)).map(([from, count]) => ({ from, to: `company-${from.slice(6)}`, counts: { source: count, target: counts.get(`company-${from.slice(6)}`)! } }))
}
export function applySpaceMap(root: string, state: string, keys?: SpaceKeys, encryptAll = false, persistKeys?: () => void) {
  const config = approvedSpaceMap(join(state, 'space-map.json'))
  const memory = new Memory(root, null); memory.keys = keys; memory.encryptAll = encryptAll; memory.onKeysChanged = persistKeys ?? null
  const pending: { file: string; source: string; target: string; text: string }[] = []
  // Preflight every changed note before the first write; ciphertext keeps its
  // original space key until authenticated and rewritten by the native writer.
  for (const file of noteFiles(root, state)) {
    const raw = readFileSync(join(root, file), 'utf8'), source = storedSpace(raw), target = canonicalSpace(source, config)
    if (target === source) continue
    memory.currentSpace = source; memory.grants = [target]
    const text = memory.read(file)
    if (text === null) throw new Error('Space access denied')
    const item = policy(text); item.space = target
    if ((item.class === 'sensitive' || item.class === 'secret' || encryptAll) && !keys) throw new Error('Memory locked')
    pending.push({ file, source, target, text: frontmatter(text, item) })
  }
  for (const item of pending) {
    memory.currentSpace = item.source; memory.grants = [item.target]
    memory.classificationFloor = 'public'
    memory.write(item.file, item.text)
  }
  return { changed: pending.length, spaces: [...new Set(Object.entries(config.aliases).flatMap(([source, target]) => [source, target]))] }
}
