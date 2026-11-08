import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch: any) => ipcRenderer.invoke('config:set', patch),
  updateAi: (patch: any) => ipcRenderer.invoke('config:updateAi', patch),
  updateLocalLlm: (patch: any) => ipcRenderer.invoke('config:updateLocalLlm', patch),
  updateGithub: (patch: any) => ipcRenderer.invoke('config:updateGithub', patch),
  updateMcp: (id: string, patch: any) => ipcRenderer.invoke('config:updateMcp', id, patch),

  // ai
  aiProviders: () => ipcRenderer.invoke('ai:providers'),
  aiCodexStatus: () => ipcRenderer.invoke('ai:codexStatus'),
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

  // auth
  authState: () => ipcRenderer.invoke('auth:state'),
  authRegister: (email: string, password: string, name: string) => ipcRenderer.invoke('auth:register', email, password, name),
  authLogin: (email: string, password: string) => ipcRenderer.invoke('auth:login', email, password),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authGoogleLogin: () => ipcRenderer.invoke('auth:googleLogin'),
  authSetGoogleCreds: (clientId: string, clientSecret: string) => ipcRenderer.invoke('auth:setGoogleCreds', clientId, clientSecret),

  // billing
  billingStatus: () => ipcRenderer.invoke('billing:status'),
  billingSetPaymentUrl: (url: string) => ipcRenderer.invoke('billing:setPaymentUrl', url),
  billingActivate: (key: string) => ipcRenderer.invoke('billing:activate', key),

  // rag
  ragStatus: () => ipcRenderer.invoke('rag:status'),
  ragSetup: (modelId: string) => ipcRenderer.invoke('rag:setup', modelId),
  ragReindex: () => ipcRenderer.invoke('rag:reindex'),

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

  // planner: notes / tasks / goals
  notesList: () => ipcRenderer.invoke('notes:list'),
  notesGet: (id: string) => ipcRenderer.invoke('notes:get', id),
  notesSave: (id: string | null, title: string, body: string) => ipcRenderer.invoke('notes:save', id, title, body),
  notesDelete: (id: string) => ipcRenderer.invoke('notes:delete', id),

  tasksList: () => ipcRenderer.invoke('tasks:list'),
  tasksAdd: (title: string, opts?: any) => ipcRenderer.invoke('tasks:add', title, opts),
  tasksUpdate: (id: string, patch: any) => ipcRenderer.invoke('tasks:update', id, patch),
  tasksToggle: (id: string) => ipcRenderer.invoke('tasks:toggle', id),
  tasksDelete: (id: string) => ipcRenderer.invoke('tasks:delete', id),

  goalsGet: (date?: string) => ipcRenderer.invoke('goals:get', date),
  goalsAdd: (date: string, text: string) => ipcRenderer.invoke('goals:add', date, text),
  goalsToggle: (date: string, index: number) => ipcRenderer.invoke('goals:toggle', date, index),
  goalsRemove: (date: string, index: number) => ipcRenderer.invoke('goals:remove', date, index),
  goalsSuggest: () => ipcRenderer.invoke('goals:suggest'),

  // updater
  updaterStatus: () => ipcRenderer.invoke('updater:status'),
  updaterCheck: () => ipcRenderer.invoke('updater:check'),
  updaterInstall: () => ipcRenderer.invoke('updater:install'),
  onUpdaterEvent: (cb: (e: any) => void) => {
    const handler = (_e: any, ev: any) => cb(ev)
    ipcRenderer.on('updater:event', handler)
    return () => { ipcRenderer.removeListener('updater:event', handler) }
  },

  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
}

export type SecondBrainApi = typeof api
contextBridge.exposeInMainWorld('sb', api)
