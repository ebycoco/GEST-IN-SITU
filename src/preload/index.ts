import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // Auth
  auth: {
    login: (login: string, password: string) => ipcRenderer.invoke('auth:login', login, password),
  },
  // Cartes
  cartes: {
    getPage: (offset: number, limit: number, filters?: Record<string, string>) => ipcRenderer.invoke('cartes:getPage', offset, limit, filters),
    search: (query: string, limit?: number) => ipcRenderer.invoke('cartes:search', query, limit),
    getById: (id: number) => ipcRenderer.invoke('cartes:getById', id),
    create: (data: Record<string, unknown>) => ipcRenderer.invoke('cartes:create', data),
    update: (id: number, data: Record<string, unknown>) => ipcRenderer.invoke('cartes:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('cartes:delete', id),
    delivrer: (id: number, data: Record<string, unknown>) => ipcRenderer.invoke('cartes:delivrer', id, data),
    signalerAbsence: (id: number, agent: string) => ipcRenderer.invoke('cartes:signalerAbsence', id, agent),
  },
  // Stats
  stats: { get: () => ipcRenderer.invoke('stats:get') },
  // Import
  import: {
    selectFile: () => ipcRenderer.invoke('import:selectFile'),
    parseCSV: (path: string) => ipcRenderer.invoke('import:parseCSV', path),
    executeBatch: (rows: Record<string, string>[], agent: string) => ipcRenderer.invoke('import:executeBatch', rows, agent),
    fusionner: () => ipcRenderer.invoke('import:fusionner'),
  },
  // Export
  export: { selectFolder: () => ipcRenderer.invoke('export:selectFolder') },
  // Users
  users: {
    getAll: () => ipcRenderer.invoke('users:getAll'),
    create: (data: Record<string, unknown>) => ipcRenderer.invoke('users:create', data),
    update: (id: number, data: Record<string, unknown>) => ipcRenderer.invoke('users:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('users:delete', id),
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
    getCentres: (siteId?: number) => ipcRenderer.invoke('hierarchy:getCentres', siteId),
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
};

contextBridge.exposeInMainWorld('api', api);

export type ApiType = typeof api;
