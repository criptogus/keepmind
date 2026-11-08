
import { BrainMaintenance } from './maintenance'

export class Brain extends BrainMaintenance {
  listSleepReports(): { date: string; content: string }[] {
    return this.memory.list('sleep').sort().reverse().map(f => ({
      date: f.replace('.md', ''),
      content: this.memory.read(`sleep/${f}`) ?? ''
    }))
  }

  listInsights(): { date: string; content: string }[] {
    return this.memory.list('insights').sort().reverse().map(f => ({
      date: f.replace('.md', ''),
      content: this.memory.read(`insights/${f}`) ?? ''
    }))
  }

  listSummaries(): { date: string; content: string }[] {
    return this.memory.list('summaries').sort().reverse().map(f => ({
      date: f.replace('.md', ''),
      content: this.memory.read(`summaries/${f}`) ?? ''
    }))
  }
}
