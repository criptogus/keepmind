const DAY = () => new Date().toISOString().slice(0, 10)

export function dayKey() {
  return DAY()
}

export function resetAgentUsageIfNeeded(agent) {
  const today = dayKey()
  if (agent.usageDay !== today) {
    agent.usageToday = 0
    agent.usageDay = today
  }
}

export function assertAgentQuota(org, agentId) {
  const agent = org.agents.find((a) => a.id === agentId)
  if (!agent) {
    const err = new Error('Unknown agent.')
    err.code = 'bad_agent'
    throw err
  }
  if (!agent.enabled) {
    const err = new Error(`Agent "${agentId}" is disabled.`)
    err.code = 'agent_off'
    throw err
  }
  const limit = agent.quotaDaily
  if (limit == null || limit <= 0) return agent
  resetAgentUsageIfNeeded(agent)
  if ((agent.usageToday ?? 0) >= limit) {
    const err = new Error(`Daily quota exceeded for agent "${agentId}" (${limit}).`)
    err.code = 'quota_exceeded'
    throw err
  }
  return agent
}

export function recordAgentUsage(agent) {
  resetAgentUsageIfNeeded(agent)
  agent.usageToday = (agent.usageToday ?? 0) + 1
}
