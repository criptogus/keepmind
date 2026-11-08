
import { BrainMaintenance } from './maintenance'

export class Brain extends BrainMaintenance {
  override chat(agentId: string, message: string, onDelta?: (text: string) => void) { return this.memory.withScope(() => super.chat(agentId, message, onDelta)) }
  override sleep() { return this.memory.withScope(() => super.sleep()) }
  override librarian() { return this.memory.withScope(() => super.librarian()) }
  override generateInsights() { return this.memory.withScope(() => super.generateInsights()) }
  override dailySummary() { return this.memory.withScope(() => super.dailySummary()) }

  override evolve() { return this.memory.withScope(() => super.evolve()) }
  override enrich() { return this.memory.withScope(() => super.enrich()) }
  override review() { return this.memory.withScope(() => super.review()) }
  override securityAudit() { return this.memory.withScope(() => super.securityAudit()) }
  override evolveSkills() { return this.memory.withScope(() => super.evolveSkills()) }
  override triageInbox() { return this.memory.withScope(() => super.triageInbox()) }

  listSleepReports(): { date: string; content: string }[] {
    return this.memory.list(this.memory.scopePath('sleep')).sort().reverse().map(f => ({
      date: f.replace('.md', ''),
      content: this.memory.read(this.memory.scopePath(`sleep/${f}`)) ?? ''
    }))
  }

  listInsights(): { date: string; content: string }[] {
    return this.memory.list(this.memory.scopePath('insights')).sort().reverse().map(f => ({
      date: f.replace('.md', ''),
      content: this.memory.read(this.memory.scopePath(`insights/${f}`)) ?? ''
    }))
  }

  listSummaries(): { date: string; content: string }[] {
    return this.memory.list(this.memory.scopePath('summaries')).sort().reverse().map(f => ({
      date: f.replace('.md', ''),
      content: this.memory.read(this.memory.scopePath(`summaries/${f}`)) ?? ''
    }))
  }
}
