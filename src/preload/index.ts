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
    getHistoriquePertes: (siteId?: number) => ipcRenderer.invoke('cartes:getHistoriquePertes', siteId),
    reactiverCarte: (id: number, nouveauRangement: string, currentUser?: any) => ipcRenderer.invoke('cartes:reactiverCarte', id, nouveauRangement, currentUser),
    getInvalidDates: (siteId?: number) => ipcRenderer.invoke('cartes:getInvalidDates', siteId),
    updateDate: (id: number, newDate: string) => ipcRenderer.invoke('cartes:updateDate', id, newDate),
    getDoublonsPage: (siteId: number, offset: number, limit: number, query?: string) => ipcRenderer.invoke('cartes:getDoublonsPage', siteId, offset, limit, query),
    getSansNumSecuPage: (siteId: number, offset: number, limit: number, query?: string) => ipcRenderer.invoke('cartes:getSansNumSecuPage', siteId, offset, limit, query),
    getSansRangementPage: (siteId: number, offset: number, limit: number, query?: string) => ipcRenderer.invoke('cartes:getSansRangementPage', siteId, offset, limit, query),
    updateQuickFields: (id: number, fields: { num_secu?: string, rangement?: string }) => ipcRenderer.invoke('cartes:updateQuickFields', id, fields),
    searchQuickLogistique: (siteId: number, critere: string) => ipcRenderer.invoke('cartes:searchQuickLogistique', siteId, critere),
    updateRangementEtFiche: (id: number, fields: { rangement: string, num_secu?: string }) => ipcRenderer.invoke('cartes:updateRangementEtFiche', id, fields),
    searchCombinedInventaire: (siteId: number, queryNomsPrenoms: string, dateNaissance?: string, lieuNaissance?: string) => ipcRenderer.invoke('cartes:searchCombinedInventaire', siteId, queryNomsPrenoms, dateNaissance, lieuNaissance),
    updateApurementHistorique: (id: number, fields: { date_delivrance: string, nom_retirant: string, num_retirant: string, relation_retirant: string, agent_distributeur: string }) => ipcRenderer.invoke('cartes:updateApurementHistorique', id, fields),
  },
  stats: { 
    get: (siteId?: number) => ipcRenderer.invoke('stats:get', siteId),
    getCentre: (centreId: number, siteId: number) => ipcRenderer.invoke('stats:getCentre', centreId, siteId),
    getCentreOperateurs: (centreId: number) => ipcRenderer.invoke('stats:getCentreOperateurs', centreId),
    getGlobal: () => ipcRenderer.invoke('stats:getGlobal'),
    getVerification: (agentUsername: string, siteId: number) => ipcRenderer.invoke('stats:getVerification', agentUsername, siteId),
    getCardsToday: (agentUsername: string, siteId: number) => ipcRenderer.invoke('stats:getCardsToday', agentUsername, siteId),
    getAgentToday: (userId: number) => ipcRenderer.invoke('stats:getAgentToday', userId),
    getAgentRecentSaisies: (userId: number, limit?: number) => ipcRenderer.invoke('stats:getAgentRecentSaisies', userId, limit),
    getSiteSaisieToday: (siteId: number) => ipcRenderer.invoke('stats:getSiteSaisieToday', siteId),
    getRetraits: (siteId: number, centreId: number | null, period: string) => ipcRenderer.invoke('stats:getRetraits', siteId, centreId, period),
    getRetraitsTrend: (siteId: number, centreId: number | null, period: string) => ipcRenderer.invoke('stats:getRetraitsTrend', siteId, centreId, period),
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
    excel: (filters?: Record<string, string>) => ipcRenderer.invoke('export:excel', filters),
    getRangements: (siteId?: number) => ipcRenderer.invoke('cartes:getRangements', siteId),
    marquerExporte: (ids: number[]) => ipcRenderer.invoke('export:marquerExporte', ids),
    getRows: (filters?: Record<string, string>) => ipcRenderer.invoke('export:getRows', filters),
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
    purge: (siteId?: number) => ipcRenderer.invoke('db:purge', siteId),
    emergencyPurge: (siteId: number) => ipcRenderer.invoke('db:emergency-purge', siteId),
    getCardCount: () => ipcRenderer.invoke('db:getCardCount'),
    onPurgeProgress: (callback: (p: number) => void) => {
      const listener = (_: any, p: number) => callback(p);
      ipcRenderer.on('db:purge-progress', listener);
      return () => ipcRenderer.removeListener('db:purge-progress', listener);
    },
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
    markNotificationAsRead: (idLog: number) => ipcRenderer.invoke('sync:markNotificationAsRead', idLog),
    forceGlobal: () => ipcRenderer.invoke('sync:forceGlobal'),
    forceSite: (siteId: number) => ipcRenderer.invoke('sync:forceSite', siteId),
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
