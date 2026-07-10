import { contextBridge, ipcRenderer } from 'electron';
import { 
  IUser, 
  ICarte, 
  ISite, 
  IDeliveryData, 
  ISiteSummary, 
  IGlobalStats, 
  ILog 
} from '../shared/types';

const api = {
  // Auth
  auth: {
    login: (login: string, password: string): Promise<any> => 
      ipcRenderer.invoke('auth:login', login, password),
    logout: (login?: string): Promise<void> => 
      ipcRenderer.invoke('auth:logout', login),
    updateSelfProfile: (
      userId: number, 
      data: { nom_user?: string; prenom_user?: string; email?: string; telephone?: string; password?: string }
    ): Promise<{ success: boolean }> => 
      ipcRenderer.invoke('auth:updateSelfProfile', userId, data),
    registerSuperAdmin: (data: Partial<IUser>): Promise<any> => 
      ipcRenderer.invoke('auth:registerSuperAdmin', data),
    onSessionExpired: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('auth:session-expired', listener);
      return () => ipcRenderer.removeListener('auth:session-expired', listener);
    }
  },
  // Cartes
  cartes: {
    getPage: (
      offset: number, 
      limit: number, 
      filters?: { statut?: string; site_id?: string; centre_id?: string; rangement?: string; statut_physique?: string; q?: string; search?: string }
    ): Promise<{ rows: ICarte[]; total: number; offset: number; limit: number }> => 
      ipcRenderer.invoke('cartes:getPage', offset, limit, filters),
    search: (
      query: string, 
      limit?: number, 
      filters?: { date_de_naissance?: string; lieu_de_naissance?: string; contact?: string; site_id?: string; exclude_delivered?: string }
    ): Promise<ICarte[]> => 
      ipcRenderer.invoke('cartes:search', query, limit, filters),
    getById: (id: number): Promise<ICarte> => 
      ipcRenderer.invoke('cartes:getById', id),
    create: (data: Partial<ICarte>): Promise<{ id: number; sync_id: string }> => 
      ipcRenderer.invoke('cartes:create', data),
    update: (id: number, data: Partial<ICarte>): Promise<{ changes: number }> => 
      ipcRenderer.invoke('cartes:update', id, data),
    delete: (id: number): Promise<{ changes: number }> => 
      ipcRenderer.invoke('cartes:delete', id),
    delivrer: (id: number, data: IDeliveryData, currentUser?: Partial<IUser>): Promise<any> => 
      ipcRenderer.invoke('cartes:delivrer', id, data, currentUser),
    signalerAbsence: (id: number, agent: string): Promise<any> => 
      ipcRenderer.invoke('cartes:signalerAbsence', id, agent),
    getAbsences: (siteId?: number): Promise<ICarte[]> => 
      ipcRenderer.invoke('cartes:getAbsences', siteId),
    getAgentAbsences: (agent: string, siteId?: number): Promise<ICarte[]> => 
      ipcRenderer.invoke('cartes:getAgentAbsences', agent, siteId),
    resoudreAbsence: (
      id: number, 
      data: { status: string; agent: string; note: string; rangement: string }
    ): Promise<any> => 
      ipcRenderer.invoke('cartes:resoudreAbsence', id, data),
    declarerPerdue: (id: number): Promise<any> => 
      ipcRenderer.invoke('cartes:declarerPerdue', id),
    getHistoriquePertes: (siteId?: number): Promise<any[]> => 
      ipcRenderer.invoke('cartes:getHistoriquePertes', siteId),
    reactiverCarte: (id: number, nouveauRangement: string, currentUser?: Partial<IUser>): Promise<any> => 
      ipcRenderer.invoke('cartes:reactiverCarte', id, nouveauRangement, currentUser),
    getInvalidDates: (siteId?: number): Promise<ICarte[]> => 
      ipcRenderer.invoke('cartes:getInvalidDates', siteId),
    updateDate: (id: number, newDate: string): Promise<any> => 
      ipcRenderer.invoke('cartes:updateDate', id, newDate),
    getDoublonsPage: (siteId: number, offset: number, limit: number, query?: string): Promise<{ rows: ICarte[]; total: number }> => 
      ipcRenderer.invoke('cartes:getDoublonsPage', siteId, offset, limit, query),
    getDoublonsProbablesPage: (siteId: number, offset: number, limit: number, query?: string): Promise<{ rows: ICarte[]; total: number }> => 
      ipcRenderer.invoke('cartes:getDoublonsProbablesPage', siteId, offset, limit, query),
    getSansNumSecuPage: (siteId: number, offset: number, limit: number, query?: string): Promise<{ rows: ICarte[]; total: number }> => 
      ipcRenderer.invoke('cartes:getSansNumSecuPage', siteId, offset, limit, query),
    getSansRangementPage: (siteId: number, offset: number, limit: number, query?: string): Promise<{ rows: ICarte[]; total: number }> => 
      ipcRenderer.invoke('cartes:getSansRangementPage', siteId, offset, limit, query),
    updateQuickFields: (id: number, fields: { num_secu?: string, rangement?: string }): Promise<any> => 
      ipcRenderer.invoke('cartes:updateQuickFields', id, fields),
    searchQuickLogistique: (siteId: number, critere: string): Promise<Partial<ICarte>[]> => 
      ipcRenderer.invoke('cartes:searchQuickLogistique', siteId, critere),
    updateRangementEtFiche: (id: number, fields: { rangement: string, num_secu?: string }): Promise<any> => 
      ipcRenderer.invoke('cartes:updateRangementEtFiche', id, fields),
    searchCombinedInventaire: (
      siteId: number, 
      queryNomsPrenoms: string, 
      dateNaissance?: string, 
      lieuNaissance?: string
    ): Promise<Partial<ICarte>[]> => 
      ipcRenderer.invoke('cartes:searchCombinedInventaire', siteId, queryNomsPrenoms, dateNaissance, lieuNaissance),
    updateApurementHistorique: (
      id: number, 
      fields: { date_delivrance: string, nom_retirant: string, num_retirant: string, relation_retirant: string, agent_distributeur: string }
    ): Promise<any> => 
      ipcRenderer.invoke('cartes:updateApurementHistorique', id, fields),
  },
  logistique: {
    recevoirLot: (payload: { lot_id: string; quantite: number; centre_origine: string }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('logistique:recevoirLot', payload),
    triCartes: (payload: { lot_id: string; nombre_cartes_triées: number; statut_tri: string }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('logistique:triCartes', payload),
    transfertCentre: (payload: { lot_id: string; centre_destination: string; nombre_cartes: number }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('logistique:transfertCentre', payload),
    inventairePhysique: (payload: { centre_id: string | number; ecart_constaté: number; note_agent: string }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('logistique:inventairePhysique', payload),
  },
  stats: { 
    get: (siteId?: number, centreId?: number): Promise<any> => 
      ipcRenderer.invoke('stats:get', siteId, centreId),
    getCentre: (centreId: number, siteId: number): Promise<Record<string, number>> => 
      ipcRenderer.invoke('stats:getCentre', centreId, siteId),
    getCentreOperateurs: (centreId: number): Promise<any[]> => 
      ipcRenderer.invoke('stats:getCentreOperateurs', centreId),
    getGlobal: (): Promise<IGlobalStats> => 
      ipcRenderer.invoke('stats:getGlobal'),
    getVerification: (
      agentUsername: string, 
      siteId: number
    ): Promise<{ today: number; yesterday: number; week: number; month: number; year: number; last7Days: { dayName: string; count: number }[] }> => 
      ipcRenderer.invoke('stats:getVerification', agentUsername, siteId),
    getCardsToday: (agentUsername: string, siteId: number): Promise<number> => 
      ipcRenderer.invoke('stats:getCardsToday', agentUsername, siteId),
    getAgentToday: (userId: number): Promise<number> => 
      ipcRenderer.invoke('stats:getAgentToday', userId),
    getAgentRecentSaisies: (userId: number, limit?: number): Promise<ICarte[]> => 
      ipcRenderer.invoke('stats:getAgentRecentSaisies', userId, limit),
    getSiteSaisieToday: (siteId: number, centreId?: number): Promise<any[]> => 
      ipcRenderer.invoke('stats:getSiteSaisieToday', siteId, centreId),
    getSiteQualiteToday: (siteId: number, centreId?: number): Promise<any[]> => 
      ipcRenderer.invoke('stats:getSiteQualiteToday', siteId, centreId),
    getSiteLogistiqueToday: (siteId: number, centreId?: number): Promise<any[]> => 
      ipcRenderer.invoke('stats:getSiteLogistiqueToday', siteId, centreId),
    getRetraits: (siteId: number, centreId: number | null, period: 'jour' | 'semaine' | 'mois' | 'annee', customDate?: string | null): Promise<{ rows: any[]; totaux: any }> => 
      ipcRenderer.invoke('stats:getRetraits', siteId, centreId, period, customDate ?? null),
    getRetraitsTrend: (siteId: number, centreId: number | null, period: 'jour' | 'semaine' | 'mois' | 'annee', customDate?: string | null): Promise<Array<{ label: string; total: number }>> => 
      ipcRenderer.invoke('stats:getRetraitsTrend', siteId, centreId, period, customDate ?? null),
    getUnsyncedCardsCount: (siteId: number): Promise<number> => 
      ipcRenderer.invoke('stats:getUnsyncedCardsCount', siteId),
    getUnsyncedUsersCount: (siteId: number): Promise<number> => 
      ipcRenderer.invoke('stats:getUnsyncedUsersCount', siteId),
  },
  // Import
  import: {
    selectFile: (): Promise<{ filePath: string; fileName: string } | null> => 
      ipcRenderer.invoke('import:selectFile'),
    parseCSV: (path: string): Promise<any[]> => 
      ipcRenderer.invoke('import:parseCSV', path),
    executeBatch: (rows: Record<string, string>[], agent: string, siteId?: number): Promise<number> => 
      ipcRenderer.invoke('import:executeBatch', rows, agent, siteId),
    clearTemp: (siteId?: number): Promise<void> => 
      ipcRenderer.invoke('import:clearTemp', siteId),
    processFile: (path: string, agent: string, totalEstimate?: number, siteId?: number): Promise<{ success: boolean; message: string }> => 
      ipcRenderer.invoke('import:processFile', path, agent, totalEstimate, siteId),
    fusionner: (agent: string, siteId?: number): Promise<{ updated: number; inserted: number }> => 
      ipcRenderer.invoke('import:fusionner', agent, siteId),
    getAnomalies: (siteId: number): Promise<any[]> =>
      ipcRenderer.invoke('import:getAnomalies', siteId),
    clearAnomalies: (siteId: number): Promise<void> =>
      ipcRenderer.invoke('import:clearAnomalies', siteId),
    onProgress: (callback: (p: number) => void) => {
      const listener = (_: any, p: number) => callback(p);
      ipcRenderer.on('import:progress', listener);
      return () => ipcRenderer.removeListener('import:progress', listener);
    }
  },
  // Export
  export: {
    csv: (filters?: Record<string, string>): Promise<{ success: boolean; path: string }> => 
      ipcRenderer.invoke('export:csv', filters),
    excel: (filters?: Record<string, string>): Promise<{ success: boolean; path: string }> => 
      ipcRenderer.invoke('export:excel', filters),
    pdf: (filters?: Record<string, string>): Promise<{ success: boolean; path: string }> => 
      ipcRenderer.invoke('export:pdf', filters),
    getRangements: (siteId?: number): Promise<string[]> => 
      ipcRenderer.invoke('cartes:getRangements', siteId),
    marquerExporte: (ids: number[]): Promise<void> => 
      ipcRenderer.invoke('export:marquerExporte', ids),
    getRows: (filters?: Record<string, string>): Promise<any[]> => 
      ipcRenderer.invoke('export:getRows', filters),
    onPdfProgress: (listener: (progress: number) => void) => {
      const cb = (_event: any, val: number) => listener(val);
      ipcRenderer.on('export:pdf-progress', cb);
      return () => {
        ipcRenderer.removeListener('export:pdf-progress', cb);
      };
    }
  },
  // Users
  users: {
    getAll: (siteId?: number): Promise<IUser[]> => 
      ipcRenderer.invoke('users:getAll', siteId),
    create: (data: Partial<IUser>): Promise<any> => 
      ipcRenderer.invoke('users:create', data),
    update: (id: number, data: Partial<IUser>): Promise<{ changes: number }> => 
      ipcRenderer.invoke('users:update', id, data),
    delete: (id: number): Promise<{ changes: number }> => 
      ipcRenderer.invoke('users:delete', id),
    hardDelete: (id: number): Promise<any> => 
      ipcRenderer.invoke('users:hardDelete', id),
    resetAgentPassword: (targetUserId: number, callerUserId: number): Promise<{ success: boolean }> => 
      ipcRenderer.invoke('auth:resetAgentPassword', targetUserId, callerUserId),
  },
  // Logs
  logs: {
    get: (offset?: number, limit?: number, filters?: { site_id?: number }): Promise<ILog[]> => 
      ipcRenderer.invoke('logs:get', offset, limit, filters),
    add: (userId: number, login: string, action: string, detail?: string): Promise<void> => 
      ipcRenderer.invoke('logs:add', userId, login, action, detail),
    purge: (payload?: { periode_purge?: string }): Promise<any> => 
      ipcRenderer.invoke('logs:purge', payload),
    consultation: (offset: number, limit: number, filters?: any): Promise<{ rows: any[]; total: number }> =>
      ipcRenderer.invoke('logs:consultation', offset, limit, filters),
    export: (payload?: { periode_export?: string }): Promise<{ success: boolean; filePath?: string; nombre_lignes_exportées?: number; error?: string; canceled?: boolean }> =>
      ipcRenderer.invoke('logs:export', payload),
  },
  // Audit
  audit: {
    getPage: (offset: number, limit: number, currentUser?: any): Promise<{ rows: any[]; total: number }> => 
      ipcRenderer.invoke('audit:getPage', offset, limit, currentUser),
    delete: (id: number, currentUser: any): Promise<{ success: boolean }> => 
      ipcRenderer.invoke('audit:delete', id, currentUser),
  },
  // Qualite
  qualite: {
    fusionnerDoublons: (payload: { id_carte_source: number; id_carte_cible: number; champs_fusionnes: string[] }): Promise<any> =>
      ipcRenderer.invoke('qualite:fusionnerDoublons', payload),
    corrigerFormat: (payload: { id_carte: number; champ_corrige: string; valeur_avant: string; valeur_apres: string }): Promise<any> =>
      ipcRenderer.invoke('qualite:corrigerFormat', payload),
    supprimerIncoherences: (payload: { type_incoherence: string; site_id: number }): Promise<any> =>
      ipcRenderer.invoke('qualite:supprimerIncoherences', payload),
  },
  // Hierarchy
  hierarchy: {
    getSites: (): Promise<ISite[]> => 
      ipcRenderer.invoke('hierarchy:getSites'),
    getSitesSummary: (): Promise<ISiteSummary[]> => 
      ipcRenderer.invoke('hierarchy:getSitesSummary'),
    createSite: (data: { nom: string; code: string; max_centres: number; admin: { nom: string; login: string; password_hash: string } }): Promise<any> => 
      ipcRenderer.invoke('hierarchy:createSite', data),
    updateSite: (id: number, data: Partial<ISite>): Promise<any> => 
      ipcRenderer.invoke('hierarchy:updateSite', id, data),
    deleteSite: (id: number): Promise<any> => 
      ipcRenderer.invoke('hierarchy:deleteSite', id),
    resetAdminPassword: (siteId: number, pass: string): Promise<any> => 
      ipcRenderer.invoke('hierarchy:resetAdminPassword', siteId, pass),
    verifyPassword: (password: string): Promise<boolean> => 
      ipcRenderer.invoke('hierarchy:verifyPassword', password),
    getCentres: (siteId?: number): Promise<any[]> => 
      ipcRenderer.invoke('hierarchy:getCentres', siteId),
    createCentre: (data: any): Promise<any> => 
      ipcRenderer.invoke('hierarchy:createCentre', data),
    updateCentre: (id: number, data: any): Promise<any> => 
      ipcRenderer.invoke('hierarchy:updateCentre', id, data),
    deleteCentre: (id: number): Promise<any> => 
      ipcRenderer.invoke('centre:delete', id),
    getPostes: (centreId?: number): Promise<any[]> => 
      ipcRenderer.invoke('hierarchy:getPostes', centreId),
  },
  // Config
  config: {
    get: (key: string): Promise<string> => 
      ipcRenderer.invoke('config:get', key),
    set: (key: string, value: string): Promise<void> => 
      ipcRenderer.invoke('config:set', key, value),
    getAll: (): Promise<Record<string, string>> => 
      ipcRenderer.invoke('config:getAll'),
  },
  // Window controls
  window: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    maximize: (): void => ipcRenderer.send('window:maximize'),
    close: (): void => ipcRenderer.send('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  },
  // Notifications
  notification: {
    show: (title: string, body: string): Promise<void> => 
      ipcRenderer.invoke('notification:show', { title, body }),
  },
  // Theme
  theme: {
    get: (): Promise<'dark' | 'light' | 'system'> => 
      ipcRenderer.invoke('theme:get'),
    set: (theme: 'dark' | 'light' | 'system'): Promise<void> => 
      ipcRenderer.invoke('theme:set', theme),
  },
  // Renderer Logging to Main File
  log: {
    info: (message: string): void => ipcRenderer.send('log:info', message),
    error: (message: string, error?: any): void => ipcRenderer.send('log:error', { message, error }),
    warn: (message: string): void => ipcRenderer.send('log:warn', message),
  },
  // App
  app: {
    getName: (): Promise<string> => 
      ipcRenderer.invoke('app:getName'),
    getVersion: (): Promise<string> => 
      ipcRenderer.invoke('app:getVersion'),
    getDbPath: (): Promise<string> => 
      ipcRenderer.invoke('app:getDbPath'),
    exportLogs: (): Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }> => 
      ipcRenderer.invoke('app:exportLogs'),
    checkFirstLaunch: (): Promise<{ isFirstLaunch: boolean }> => 
      ipcRenderer.invoke('app:checkFirstLaunch'),
    checkRemoteVersion: (): Promise<{ success: boolean; version_minimale?: string; url_telechargement?: string; is_active?: boolean; reason?: string }> => 
      ipcRenderer.invoke('app:checkRemoteVersion'),
    openExternal: (url: string): Promise<{ success: boolean; error?: string }> => 
      ipcRenderer.invoke('app:openExternal', url),
    openExternalUrl: (url: string): void => 
      ipcRenderer.send('app:openExternalUrl', url),
    updateRemoteVersion: (payload: { is_active: boolean; version_minimale: string; url_telechargement: string }): Promise<{ success: boolean; error?: string }> => 
      ipcRenderer.invoke('app:updateRemoteVersion', payload),
  },


  database: {
    getCardsCount: (): Promise<number> => 
      ipcRenderer.invoke('database:getCardsCount'),
    export: (currentUser?: any): Promise<{ success: boolean; filePath?: string; reason?: string }> => 
      ipcRenderer.invoke('database:export', currentUser),
    import: (currentUser?: any): Promise<{ success: boolean; reason?: string }> => 
      ipcRenderer.invoke('database:import', currentUser),
  },
  db: {
    purge: (siteId?: number, currentUser?: any): Promise<{ success: boolean; count: number }> => 
      ipcRenderer.invoke('db:purge', siteId, currentUser),
    emergencyPurge: (siteId: number, currentUser?: any): Promise<{ success: boolean }> => 
      ipcRenderer.invoke('db:emergency-purge', siteId, currentUser),
    getCardCount: (): Promise<number> => 
      ipcRenderer.invoke('db:getCardCount'),
    onPurgeProgress: (callback: (p: number) => void) => {
      const listener = (_: any, p: number) => callback(p);
      ipcRenderer.on('db:purge-progress', listener);
      return () => ipcRenderer.removeListener('db:purge-progress', listener);
    },
  },
  // Sync offline-first
  sync: {
    getStatus: (): Promise<any> => 
      ipcRenderer.invoke('sync:getStatus'),
    force: (): Promise<any> => 
      ipcRenderer.invoke('sync:force'),
    onStatusChanged: (callback: (status: any) => void) => {
      const listener = (_: any, status: any) => callback(status);
      ipcRenderer.on('sync:status-changed', listener);
      return () => ipcRenderer.removeListener('sync:status-changed', listener);
    },
    startBulk: (
      siteId: number,
      allowProbable?: boolean,
      allowInvalid?: boolean
    ): Promise<{
      success: boolean;
      message: string;
      status?: 'BLOCKED_STRICT' | 'BLOCKED_PROBABLE' | 'BLOCKED_INVALID';
      count?: number;
      uploadedCount?: number;
    }> => 
      ipcRenderer.invoke('sync:startBulk', siteId, allowProbable, allowInvalid),
    onBulkProgress: (callback: (p: number) => void) => {
      const listener = (_: any, p: number) => callback(p);
      ipcRenderer.on('sync:bulk-progress', listener);
      return () => ipcRenderer.removeListener('sync:bulk-progress', listener);
    },
    getUnreadCount: (siteId?: number): Promise<number> => 
      ipcRenderer.invoke('sync:getUnreadCount', siteId),
    getUnreadList: (siteId?: number): Promise<ILog[]> => 
      ipcRenderer.invoke('sync:getUnreadList', siteId),
    markAsRead: (siteId?: number): Promise<boolean> => 
      ipcRenderer.invoke('sync:markAsRead', siteId),
    markNotificationAsRead: (idLog: number): Promise<boolean> => 
      ipcRenderer.invoke('sync:markNotificationAsRead', idLog),
    forceGlobal: (): Promise<{ success: boolean; counts: { sites: number; centres: number; users: number } }> => 
      ipcRenderer.invoke('sync:forceGlobal'),
    forceSite: (siteId: number): Promise<{ success: boolean; counts: { cards: number; users: number }; errors: string[] }> => 
      ipcRenderer.invoke('sync:forceSite', siteId),
    pullSiteCards: (siteId: number, currentUser?: any): Promise<{ success: boolean; count: number; message?: string }> => 
      ipcRenderer.invoke('sync:pullSiteCards', siteId, currentUser),
    pullAgents: (siteId: number, currentUser?: any): Promise<{ success: boolean; count: number; message?: string }> => 
      ipcRenderer.invoke('sync:pullAgents', siteId, currentUser),
    forceAgents: (siteId: number): Promise<void> => 
      ipcRenderer.invoke('sync:forceAgents', siteId),
  },
  // Maintenance
  maintenance: {
    clearAll: (currentUser?: any): Promise<void> => 
      ipcRenderer.invoke('maintenance:clearAll', currentUser),
    clearDatabaseCartes: (siteId?: number, currentUser?: any): Promise<{ success: boolean; count: number }> => 
      ipcRenderer.invoke('maintenance:clearDatabaseCartes', siteId, currentUser),
    clearCloudCartes: (siteId: number, currentUser?: any): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('maintenance:clearCloudCartes', siteId, currentUser),
    fullReset: (currentUser?: any): Promise<void> => 
      ipcRenderer.invoke('maintenance:fullReset', currentUser),
  },
  onDatabaseUpdated: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('sync:updated-data', listener);
    return () => ipcRenderer.removeListener('sync:updated-data', listener);
  },
};

contextBridge.exposeInMainWorld('api', api);

export type ApiType = typeof api;
export { api };
