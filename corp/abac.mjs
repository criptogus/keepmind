// ABAC for shared/ (policy.sharedAccess) and people/ (policy.peopleAccess).

export function normalizeSharedAccess(rules) {
  if (!Array.isArray(rules)) return []
  const out = []
  for (const row of rules) {
    const prefix = String(row.prefix || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
    if (!prefix.startsWith('shared/')) continue
    const roles = Array.isArray(row.roles) ? row.roles.map(String) : []
    const titles = Array.isArray(row.titles) ? row.titles.map((t) => String(t).toLowerCase()) : []
    const teams = Array.isArray(row.teams) ? row.teams.map(String) : []
    out.push({ prefix, roles, titles, teams })
  }
  return out
}

export function normalizePeopleAccess(rules) {
  if (!Array.isArray(rules)) return []
  const out = []
  for (const row of rules) {
    const prefix = String(row.prefix || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
    if (!prefix.startsWith('people/')) continue
    const roles = Array.isArray(row.roles) ? row.roles.map(String) : []
    const titles = Array.isArray(row.titles) ? row.titles.map((t) => String(t).toLowerCase()) : []
    const teams = Array.isArray(row.teams) ? row.teams.map(String) : []
    out.push({ prefix, roles, titles, teams })
  }
  return out
}

function longestRule(rel, rules) {
  const clean = rel.replace(/\\/g, '/')
  let match = null
  for (const rule of rules || []) {
    if (clean === rule.prefix || clean.startsWith(`${rule.prefix}/`)) {
      if (!match || rule.prefix.length > match.prefix.length) match = rule
    }
  }
  return match
}

export function sharedRuleFor(rel, rules) {
  return longestRule(rel, rules)
}

export function peopleRuleFor(rel, rules) {
  return longestRule(rel, rules)
}

export function ruleAllows(rule, { role, title, teamId }) {
  if (rule.roles?.length && rule.roles.includes(role)) return true
  if (rule.teams?.length && rule.teams.includes(teamId)) return true
  const t = String(title || '').toLowerCase()
  if (rule.titles?.length && t && rule.titles.some((x) => t.includes(x) || x.includes(t))) return true
  return false
}
