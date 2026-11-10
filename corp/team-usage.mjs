import { dayKey } from './agent-usage.mjs'

/** Paperclip-light: abstract "units" per day (MCP=1, chat cloud≈10). */
export const UNIT_MCP = 1
export const UNIT_CHAT_CLOUD = 10

export function resetTeamUsageIfNeeded(team) {
  const today = dayKey()
  if (team.usageDay !== today) {
    team.usageToday = 0
    team.usageDay = today
  }
}

export function assertTeamBudget(org, teamId) {
  const team = org.teams.find((t) => t.id === teamId) ?? org.teams[0]
  if (!team) return team
  const limit = team.budgetDaily
  if (limit == null || limit <= 0) return team
  resetTeamUsageIfNeeded(team)
  if ((team.usageToday ?? 0) >= limit) {
    const err = new Error(`Daily team budget exceeded for "${team.id}" (${limit} units).`)
    err.code = 'team_budget_exceeded'
    throw err
  }
  return team
}

export function recordTeamUsage(team, units = 1) {
  resetTeamUsageIfNeeded(team)
  team.usageToday = (team.usageToday ?? 0) + units
}

export function meteringSnapshot(org) {
  return {
    teams: org.teams.map((t) => ({
      id: t.id,
      name: t.name,
      budgetDaily: t.budgetDaily ?? null,
      usageToday: t.usageToday ?? 0,
      usageDay: t.usageDay ?? null,
      remaining:
        t.budgetDaily == null || t.budgetDaily <= 0
          ? null
          : Math.max(0, t.budgetDaily - (t.usageToday ?? 0))
    })),
    agents: org.agents.map((a) => ({
      id: a.id,
      name: a.name,
      quotaDaily: a.quotaDaily ?? null,
      usageToday: a.usageToday ?? 0,
      usageDay: a.usageDay ?? null
    })),
    unitCosts: { mcp: UNIT_MCP, chatCloud: UNIT_CHAT_CLOUD }
  }
}
