import { defaultOrg, mergeAgentCatalog, mergeTeamCatalog, readJson, writeJsonAtomic } from './lib.mjs'

export function loadOrg(file, name = 'KeepMind Corp') {
  const loaded = readJson(file, null)
  const base = defaultOrg(name)
  if (!loaded || !Array.isArray(loaded.users)) return base
  return {
    ...base,
    ...loaded,
    name: typeof loaded.name === 'string' ? loaded.name : base.name,
    users: loaded.users,
    teams: mergeTeamCatalog(loaded.teams, base.teams),
    agents: mergeAgentCatalog(loaded.agents, base.agents),
    policy: { ...base.policy, ...(loaded.policy || {}), byokRequired: true, memberKeys: false }
  }
}

export function saveOrg(file, org) {
  writeJsonAtomic(file, org)
}
