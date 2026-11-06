import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch: any) => ipcRenderer.invoke('config:set', patch),
  updateAi: (patch: any) => ipcRenderer.invoke('config:updateAi', patch),
  updateLocalLlm: (patch: any) => ipcRenderer.invoke('config:updateLocalLlm', patch),
  updateGithub: (patch: any) => ipcRenderer.invoke('config:updateGithub', patch),
  updateMcp: (id: string, patch: any) => ipcRenderer.invoke('config:updateMcp', id, patch),
  addAgent: (agent: any) => ipcRenderer.invoke('config:addAgent', agent),
  removeAgent: (id: string) => ipcRenderer.invoke('config:removeAgent', id),

  // ai
  aiProviders: () => ipcRenderer.invoke('ai:providers'),
  aiTest: (provider: any) => ipcRenderer.invoke('ai:test', provider),

  // github
  ghStartDeviceFlow: () => ipcRenderer.invoke('github:startDeviceFlow'),
  ghPollDeviceFlow: (dc: any) => ipcRenderer.invoke('github:pollDeviceFlow', dc),
  ghCreateRepo: (name: string, desc: string) => ipcRenderer.invoke('github:createRepo', name, desc),
  ghPushMemory: (msg: string) => ipcRenderer.invoke('github:pushMemory', msg),

  // local llm
  localLlmStatus: () => ipcRenderer.invoke('localllm:status'),
  localLlmDownloadServer: () => ipcRenderer.invoke('localllm:downloadServer'),
  localLlmDownloadModel: (id: string) => ipcRenderer.invoke('localllm:downloadModel', id),
  localLlmEnsure: (modelId?: string) => ipcRenderer.invoke('localllm:ensure', modelId),
  localLlmStop: () => ipcRenderer.invoke('localllm:stop'),
  onLocalLlmProgress: (cb: (p: any) => void) => {
    const handler = (_e: any, p: any) => cb(p)
    ipcRenderer.on('localllm:progress', handler)
    return () => { ipcRenderer.removeListener('localllm:progress', handler) }
  },

  // mcp
  mcpStart: (id: string) => ipcRenderer.invoke('mcp:start', id),
  mcpStop: (id: string) => ipcRenderer.invoke('mcp:stop', id),
  mcpStatus: () => ipcRenderer.invoke('mcp:status'),
  whatsappQr: () => ipcRenderer.invoke('mcp:whatsappQr'),
  mcpLogs: () => ipcRenderer.invoke('mcp:logs'),

  // sync
  syncStatus: () => ipcRenderer.invoke('sync:status'),
  syncNow: () => ipcRenderer.invoke('sync:now'),

  // automations
  automationList: () => ipcRenderer.invoke('automation:list'),
  automationParse: (text: string) => ipcRenderer.invoke('automation:parse', text),
  automationCreate: (input: any) => ipcRenderer.invoke('automation:create', input),
  automationUpdate: (id: string, patch: any) => ipcRenderer.invoke('automation:update', id, patch),
  automationRemove: (id: string) => ipcRenderer.invoke('automation:remove', id),
  automationRunNow: (id: string) => ipcRenderer.invoke('automation:runNow', id),

  // brain
  brainChat: (agentId: string, message: string) => ipcRenderer.invoke('brain:chat', agentId, message),
  brainInsights: () => ipcRenderer.invoke('brain:insights'),
  brainDailySummary: () => ipcRenderer.invoke('brain:dailySummary'),
  brainSleep: () => ipcRenderer.invoke('brain:sleep'),
  brainListSleep: () => ipcRenderer.invoke('brain:listSleep'),
  brainMemoryTiers: () => ipcRenderer.invoke('brain:memoryTiers'),
  brainListInsights: () => ipcRenderer.invoke('brain:listInsights'),
  brainListSummaries: () => ipcRenderer.invoke('brain:listSummaries'),
  brainListMemory: () => ipcRenderer.invoke('brain:listMemory'),
  onBrainDelta: (cb: (t: string) => void) => {
    const handler = (_e: any, t: string) => cb(t)
    ipcRenderer.on('brain:delta', handler)
    return () => { ipcRenderer.removeListener('brain:delta', handler) }
  },

  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
}

export type SecondBrainApi = typeof api
contextBridge.exposeInMainWorld('sb', api)
