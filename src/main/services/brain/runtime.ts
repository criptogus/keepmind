import type { Store } from '../../store'
import type { LayaService } from '../laya'
import type { LocalLlm } from '../local-llm'
import type { McpManager } from '../mcp'
import type { RagService } from '../rag'
import type { GitSync } from '../sync'

import { Memory } from './memory-store'

export class BrainRuntime {
  protected memory: Memory
  protected store: Store
  protected mcp: McpManager | null = null
  protected localLlm: LocalLlm | null = null
  protected gitSync: GitSync | null = null
  protected rag: RagService | null = null
  protected laya: LayaService | null = null

  constructor(store: Store, mcp: McpManager | null, localLlm: LocalLlm | null = null) {
    this.store = store
    this.mcp = mcp
    this.localLlm = localLlm
    this.memory = new Memory(store.memoryDir, () => store.get().github)
  }

  setMcp(mcp: McpManager) { this.mcp = mcp }
  setLocalLlm(l: LocalLlm) { this.localLlm = l }
  attachSync(sync: GitSync) {
    this.gitSync = sync
    this.memory.onWrite = (rel) => sync.markDirty(rel)
  }
  setRag(rag: RagService) { this.rag = rag }
  setLaya(l: LayaService) { this.laya = l }

  getMemory() { return this.memory }
  setActivitySource(src: string) { this.memory.activitySource = src }

  async isSemanticDuplicate(candidate: string, existing: string): Promise<boolean> {
    if (!this.laya?.status().available || !existing.trim()) return false
    const p = await this.laya.yesNo(
      `New item: ${candidate.slice(0, 600)}\n\nExisting memory:\n${existing.slice(-4000)}`,
      'Is the new item already captured by the existing memory?'
    ).catch(() => null)
    return p != null && p > 0.72
  }

  memoryTierStats() {
    return {
      shortTerm: this.memory.shortTermFiles().length,
      mediumTerm: this.memory.mediumTermFiles().length,
      longTerm: this.memory.countFiles('long-term'),
      sleepCycles: this.memory.list('sleep').length
    }
  }

}
