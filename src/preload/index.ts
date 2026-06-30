import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // Auth
  auth: {
    login: (login: string, password: string) => ipcRenderer.invoke('auth:login', login, password),
  },
  // Cartes
  cartes: {
    getPage: (offset: number, limit: number, filters?: Record<string, string>) => ipcRenderer.invoke('cartes:getPage', offset, limit, filters),
    search: (query: string, limit?: number, filters?: Record<string, string>) => ipcRenderer.invoke('cartes:search', query, limit, filters),
    getById: (id: number) => ipcRenderer.invoke('cartes:getById', id),
    create: (data: Record<string, unknown>) => ipcRenderer.invoke('cartes:create', data),
    update: (id: number, data: Record<string, unknown>) => ipcRenderer.invoke('cartes:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('cartes:delete', id),
    delivrer: (id: number, data: Record<string, unknown>, currentUser?: any) => ipcRenderer.invoke('cartes:delivrer', id, data, currentUser),
    signalerAbsence: (id: number, agent: string) => ipcRenderer.invoke('cartes:signalerAbsence', id, agent),
    getAbsences: (siteId?: number) => ipcRenderer.invoke('cartes:getAbsences', siteId),
    getAgentAbsences: (agent: string, siteId?: number) => ipcRenderer.invoke('cartes:getAgentAbsences', agent, siteId),
    resoudreAbsence: (id: number, data: any) => ipcRenderer.invoke('cartes:resoudreAbsence', id, data),
    declarerPerdue: (id: number) => ipcRenderer.invoke('cartes:declarerPerdue', id),
    getInvalidDates: (siteId?: number) => ipcRenderer.invoke('cartes:getInvalidDates', siteId),
    updateDate: (id: number, newDate: string) => ipcRenderer.invoke('cartes:updateDate', id, newDate),
  },
  stats: { 
    get: (siteId?: number) => ipcRenderer.invoke('stats:get', siteId),
    getGlobal: () => ipcRenderer.invoke('stats:getGlobal'),
    getConsultant: (agentUsername: string, siteId: number) => ipcRenderer.invoke('stats:getConsultant', agentUsername, siteId),
    getCardsToday: (agentUsername: string, siteId: number) => ipcRenderer.invoke('stats:getCardsToday', agentUsername, siteId),
  },
  // Import
  import: {
    selectFile: () => ipcRenderer.invoke('import:selectFile'),
    parseCSV: (path: string) => ipcRenderer.invoke('import:parseCSV', path),
    executeBatch: (rows: Record<string, string>[], agent: string, siteId?: number) => ipcRenderer.invoke('import:executeBatch', rows, agent, siteId),
    clearTemp: (siteId?: number) => ipcRenderer.invoke('import:clearTemp', siteId),
    processFile: (path: string, agent: string, totalEstimate?: number, siteId?: number) => ipcRenderer.invoke('import:processFile', path, agent, totalEstimate, siteId),
    fusionner: (agent: string, siteId?: number) => ipcRenderer.invoke('import:fusionner', agent, siteId),
    onProgress: (callback: (p: number) => void) => {
      const listener = (_: any, p: number) => callback(p);
      ipcRenderer.on('import:progress', listener);
      return () => ipcRenderer.removeListener('import:progress', listener);
    }
  },
  // Export
  export: {
    csv: (filters?: Record<string, string>) => ipcRenderer.invoke('export:csv', filters),
  },
  // Users
  users: {
    getAll: (siteId?: number) => ipcRenderer.invoke('users:getAll', siteId),
    create: (data: Record<string, unknown>) => ipcRenderer.invoke('users:create', data),
    update: (id: number, data: Record<string, unknown>) => ipcRenderer.invoke('users:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('users:delete', id),
    hardDelete: (id: number) => ipcRenderer.invoke('users:hardDelete', id),
  },
  // Logs
  logs: {
    get: (offset?: number, limit?: number, filters?: Record<string, unknown>) => ipcRenderer.invoke('logs:get', offset, limit, filters),
    add: (userId: number, login: string, action: string, detail?: string) => ipcRenderer.invoke('logs:add', userId, login, action, detail),
    purge: () => ipcRenderer.invoke('logs:purge'),
  },
  // Hierarchy
  hierarchy: {
    getSites: () => ipcRenderer.invoke('hierarchy:getSites'),
    getSitesSummary: () => ipcRenderer.invoke('hierarchy:getSitesSummary'),
    createSite: (data: any) => ipcRenderer.invoke('hierarchy:createSite', data),
    updateSite: (id: number, data: any) => ipcRenderer.invoke('hierarchy:updateSite', id, data),
    deleteSite: (id: number) => ipcRenderer.invoke('hierarchy:deleteSite', id),
    resetAdminPassword: (siteId: number, pass: string) => ipcRenderer.invoke('hierarchy:resetAdminPassword', siteId, pass),
    verifyPassword: (password: string) => ipcRenderer.invoke('hierarchy:verifyPassword', password),
    getCentres: (siteId?: number) => ipcRenderer.invoke('hierarchy:getCentres', siteId),
    createCentre: (data: any) => ipcRenderer.invoke('hierarchy:createCentre', data),
    updateCentre: (id: number, data: any) => ipcRenderer.invoke('hierarchy:updateCentre', id, data),
    getPostes: (centreId?: number) => ipcRenderer.invoke('hierarchy:getPostes', centreId),
  },
  // Config
  config: {
    get: (key: string) => ipcRenderer.invoke('config:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('config:set', key, value),
    getAll: () => ipcRenderer.invoke('config:getAll'),
  },
  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },
  // Notifications
  notification: {
    show: (title: string, body: string) => ipcRenderer.invoke('notification:show', { title, body }),
  },
  // Theme
  theme: {
    get: () => ipcRenderer.invoke('theme:get'),
    set: (theme: 'dark' | 'light' | 'system') => ipcRenderer.invoke('theme:set', theme),
  },
  // App
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getDbPath: () => ipcRenderer.invoke('app:getDbPath'),
  },
  db: {
    purge: () => ipcRenderer.invoke('db:purge'),
    getCardCount: () => ipcRenderer.invoke('db:getCardCount'),
  },
  // Sync offline-first
  sync: {
    getStatus: () => ipcRenderer.invoke('sync:getStatus'),
    force: () => ipcRenderer.invoke('sync:force'),
    onStatusChanged: (callback: (status: any) => void) => {
      const listener = (_: any, status: any) => callback(status);
      ipcRenderer.on('sync:status-changed', listener);
      return () => ipcRenderer.removeListener('sync:status-changed', listener);
    },
    startBulk: (siteId: number) => ipcRenderer.invoke('sync:startBulk', siteId),
    onBulkProgress: (callback: (p: number) => void) => {
      const listener = (_: any, p: number) => callback(p);
      ipcRenderer.on('sync:bulk-progress', listener);
      return () => ipcRenderer.removeListener('sync:bulk-progress', listener);
    },
    getUnreadCount: (siteId?: number) => ipcRenderer.invoke('sync:getUnreadCount', siteId),
    getUnreadList: (siteId?: number) => ipcRenderer.invoke('sync:getUnreadList', siteId),
    markAsRead: (siteId?: number) => ipcRenderer.invoke('sync:markAsRead', siteId),
  },
  // Maintenance
  maintenance: {
    clearAll: () => ipcRenderer.invoke('maintenance:clearAll'),
    clearDatabaseCartes: (siteId?: number) => ipcRenderer.invoke('maintenance:clearDatabaseCartes', siteId),
    fullReset: () => ipcRenderer.invoke('maintenance:fullReset'),
  },
  onDatabaseUpdated: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('sync:updated-data', listener);
    return () => ipcRenderer.removeListener('sync:updated-data', listener);
  },
};

contextBridge.exposeInMainWorld('api', api);

export type ApiType = typeof api;
