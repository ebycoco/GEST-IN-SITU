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
    setActiveRole: (role: string): Promise<{ success: boolean; activeRole?: string; message?: string }> =>
      ipcRenderer.invoke('auth:setActiveRole', role),
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
    },
    onAuthWarning: (callback: (warningMessage: string) => void) => {
      const listener = (_: any, warningMessage: string) => callback(warningMessage);
      ipcRenderer.on('auth:warning', listener);
      return () => ipcRenderer.removeListener('auth:warning', listener);
    },
    isPreloadingUsers: (): Promise<boolean> => 
      ipcRenderer.invoke('auth:isPreloadingUsers'),
    onPreloadStatus: (callback: (isPreloading: boolean) => void) => {
      const listener = (_: any, isPreloading: boolean) => callback(isPreloading);
      ipcRenderer.on('auth:preload-status', listener);
      return () => ipcRenderer.removeListener('auth:preload-status', listener);
    }
  },
  // Cartes
  cartes: {
    countDrafts: (siteId: number, currentUser?: any): Promise<number> => 
      ipcRenderer.invoke('cartes:countDrafts', siteId, currentUser),
    publishDrafts: (siteId: number, currentUser?: any): Promise<{ publishedCount: number; skippedInvalidDateCount: number }> =>
      ipcRenderer.invoke('cartes:publishDrafts', siteId, currentUser),
    searchAllRecords: (siteId: number, filters: any, limit: number): Promise<any[]> => 
      ipcRenderer.invoke('cartes:searchAllRecords', siteId, filters, limit),
    getRecordForCorrection: (originalId: number | string, recordType: string, siteId?: number): Promise<any> =>
      ipcRenderer.invoke('cartes:getRecordForCorrection', originalId, recordType, siteId),
    getPage: (
      offset: number, 
      limit: number, 
      filters?: { statut?: string; site_id?: string; centre_id?: string; rangement?: string; statut_physique?: string; q?: string; search?: string; agent_saisie?: string }
    ): Promise<{ rows: ICarte[]; total: number; offset: number; limit: number }> => 
      ipcRenderer.invoke('cartes:getPage', offset, limit, filters),
    search: (
      query: string, 
      limit?: number, 
      filters?: { date_de_naissance?: string; lieu_de_naissance?: string; contact?: string; site_id?: string; exclude_delivered?: string }
    ): Promise<ICarte[]> => 
      ipcRenderer.invoke('cartes:search', query, limit, filters),
    searchCloudEmergency: (query: string, filters: any): Promise<any[]> => 
      ipcRenderer.invoke('cartes:searchCloudEmergency', query, filters),
    pullSingleCard: (cardData: any): Promise<any> => 
      ipcRenderer.invoke('cartes:pullSingleCard', cardData),
    getById: (id: number): Promise<ICarte> => 
      ipcRenderer.invoke('cartes:getById', id),
    create: (data: Partial<ICarte>): Promise<{ id: number; sync_id: string }> => 
      ipcRenderer.invoke('cartes:create', data),
    updateCarte: (id: number, data: Partial<ICarte>, currentUser?: any): Promise<{ id: number; sync_id: string; changes?: number }> => 
      ipcRenderer.invoke('cmu:updateCarte', id, data, currentUser),
    update: (id: number, data: Partial<ICarte>, currentUser?: any): Promise<{ changes: number }> => 
      ipcRenderer.invoke('cartes:update', id, data, currentUser),
    delete: (id: number, currentUser?: any): Promise<{ changes: number }> => 
      ipcRenderer.invoke('cartes:delete', id, currentUser),
    delivrer: (id: number, data: IDeliveryData, currentUser?: Partial<IUser>): Promise<any> => 
      ipcRenderer.invoke('cartes:delivrer', id, data, currentUser),
    transferer: (id: number, data: { centre_id: number; rangement?: string; agent_transfert: string }, currentUser?: Partial<IUser>): Promise<any> => 
      ipcRenderer.invoke('cartes:transferer', id, data, currentUser),
    signalerAbsence: (id: number, agentLogin: string, agentInfo: string, commentaire?: string, currentUser?: any): Promise<any> => 
      ipcRenderer.invoke('cartes:signalerAbsence', id, agentLogin, agentInfo, commentaire, currentUser),
    getAbsences: (siteId?: number): Promise<ICarte[]> => 
      ipcRenderer.invoke('cartes:getAbsences', siteId),
    getAbsencesCentre: (centreId: number): Promise<ICarte[]> =>
      ipcRenderer.invoke('cartes:getAbsencesCentre', centreId),
    getEscaladesResoluesCentre: (centreId: number): Promise<ICarte[]> =>
      ipcRenderer.invoke('cartes:getEscaladesResoluesCentre', centreId),
    getAbsencesSite: (siteId?: number): Promise<ICarte[]> => 
      ipcRenderer.invoke('cartes:getAbsencesSite', siteId),
    escaladerAuSite: (id: number, currentUser?: Partial<IUser>): Promise<any> => 
      ipcRenderer.invoke('cartes:escaladerAuSite', id, currentUser),
    getAgentAbsences: (agent: string, siteId?: number): Promise<ICarte[]> => 
      ipcRenderer.invoke('cartes:getAgentAbsences', agent, siteId),
    getSignalementsResolus: (agent: string, siteId?: number): Promise<ICarte[]> => 
      ipcRenderer.invoke('cartes:getSignalementsResolus', agent, siteId),
    archiveSignalement: (id: number, agentLogin: string): Promise<boolean> =>
      ipcRenderer.invoke('cartes:archiveSignalement', id, agentLogin),
    getArchivedSignalements: (agentLogin: string): Promise<number[]> =>
      ipcRenderer.invoke('cartes:getArchivedSignalements', agentLogin),
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
    getInvalidDates: (siteId?: number, offset?: number, limit?: number, query?: string): Promise<{ rows: any[], total: number }> => 
      ipcRenderer.invoke('cartes:getInvalidDates', siteId, offset, limit, query),
    getDatesVidesPage: (siteId?: number, offset?: number, limit?: number, query?: string): Promise<{ rows: any[], total: number }> => 
      ipcRenderer.invoke('cartes:getDatesVidesPage', siteId, offset, limit, query),
    updateDate: (id: number, newDate: string): Promise<any> => 
      ipcRenderer.invoke('cartes:updateDate', id, newDate),
    getDoublonsPage: (siteId: number, offset: number, limit: number, query?: string, filters?: any): Promise<{ rows: ICarte[]; total: number }> => 
      ipcRenderer.invoke('cartes:getDoublonsPage', siteId, offset, limit, query, filters),
    getDoublonsProbablesPage: (siteId: number, offset: number, limit: number, query?: string, filters?: any): Promise<{ rows: ICarte[]; total: number }> => 
      ipcRenderer.invoke('cartes:getDoublonsProbablesPage', siteId, offset, limit, query, filters),
    getSansNumSecuPage: (siteId: number, offset: number, limit: number, query?: string, filters?: any): Promise<{ rows: ICarte[]; total: number }> => 
      ipcRenderer.invoke('cartes:getSansNumSecuPage', siteId, offset, limit, query, filters),
    getSansNomPage: (siteId: number, offset: number, limit: number, query?: string, filters?: any): Promise<{ rows: ICarte[]; total: number }> => 
      ipcRenderer.invoke('cartes:getSansNomPage', siteId, offset, limit, query, filters),
    getSansPrenomPage: (siteId: number, offset: number, limit: number, query?: string, filters?: any): Promise<{ rows: ICarte[]; total: number }> => 
      ipcRenderer.invoke('cartes:getSansPrenomPage', siteId, offset, limit, query, filters),
    getSansRangementPage: (siteId: number, offset: number, limit: number, query?: string, filters?: any): Promise<{ rows: ICarte[]; total: number }> => 
      ipcRenderer.invoke('cartes:getSansRangementPage', siteId, offset, limit, query, filters),
    getSansContactPage: (siteId: number, offset: number, limit: number, query?: string): Promise<{ rows: ICarte[]; total: number }> => 
      ipcRenderer.invoke('cartes:getSansContactPage', siteId, offset, limit, query),
    getSansLieuNaissancePage: (siteId: number, offset: number, limit: number, query?: string): Promise<{ rows: ICarte[]; total: number }> => 
      ipcRenderer.invoke('cartes:getSansLieuNaissancePage', siteId, offset, limit, query),
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
    inventairePhysiqueScan: (identifiant: string, rangement: string): Promise<any> =>
      ipcRenderer.invoke('cartes:inventairePhysiqueScan', identifiant, rangement),
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
    get: (siteId?: number, centreId?: number, forceRefresh?: boolean): Promise<any> =>
      ipcRenderer.invoke('stats:get', siteId, centreId, forceRefresh),
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
    getVerificationCardsTodayPaginated: (agentUsername: string, siteId: number, page?: number, pageSize?: number): Promise<{ rows: any[]; total: number }> =>
      ipcRenderer.invoke('stats:getVerificationCardsTodayPaginated', agentUsername, siteId, page, pageSize),
    getApurementCardsTodayPaginated: (agentUsername: string, siteId: number, page?: number, pageSize?: number): Promise<{ rows: any[]; total: number }> =>
      ipcRenderer.invoke('stats:getApurementCardsTodayPaginated', agentUsername, siteId, page, pageSize),
    getApurementStats: (
      agentUsername: string,
      siteId: number
    ): Promise<{ today: number; yesterday: number; week: number; month: number; year: number; last7Days: { dayName: string; count: number }[] }> =>
      ipcRenderer.invoke('stats:getApurementStats', agentUsername, siteId),
    getAgentToday: (userId: number): Promise<number> =>
      ipcRenderer.invoke('stats:getAgentToday', userId),
    getAgentRecentSaisies: (userId: number, limit?: number, offset?: number): Promise<{ total: number; rows: any[] }> =>
      ipcRenderer.invoke('stats:getAgentRecentSaisies', userId, limit, offset),
    getAgentStats: (
      userId: number
    ): Promise<{ today: number; yesterday: number; week: number; month: number; year: number }> =>
      ipcRenderer.invoke('stats:getAgentStats', userId),
    getAgentCardsTodayPaginated: (userId: number, page?: number, pageSize?: number): Promise<{ rows: any[]; total: number }> =>
      ipcRenderer.invoke('stats:getAgentCardsTodayPaginated', userId, page, pageSize),
    getSiteSaisieToday: (siteId: number, centreId?: number, agentId?: number, dateStr?: string): Promise<any[]> => 
      ipcRenderer.invoke('stats:getSiteSaisieToday', siteId, centreId, agentId, dateStr),
    getSiteQualiteToday: (siteId: number, centreId?: number, agentId?: number, dateStr?: string): Promise<any[]> => 
      ipcRenderer.invoke('stats:getSiteQualiteToday', siteId, centreId, agentId, dateStr),
    getSiteLogistiqueToday: (siteId: number, centreId?: number, agentId?: number, dateStr?: string): Promise<any[]> => 
      ipcRenderer.invoke('stats:getSiteLogistiqueToday', siteId, centreId, agentId, dateStr),
    getActivitiesByAgentAndDate: (siteId: number, centreId?: number | null, agentId?: number | null, dateStr?: string | null): Promise<any> => 
      ipcRenderer.invoke('stats:getActivitiesByAgentAndDate', siteId, centreId, agentId, dateStr),
    getRetraits: (siteId: number, centreId: number | null, period: 'jour' | 'semaine' | 'mois' | 'annee', customDate?: string | null): Promise<{ rows: any[]; totaux: any }> => 
      ipcRenderer.invoke('stats:getRetraits', siteId, centreId, period, customDate ?? null),
    getRetraitsTrend: (siteId: number, centreId: number | null, period: 'jour' | 'semaine' | 'mois' | 'annee', customDate?: string | null): Promise<Array<{ label: string; total: number }>> => 
      ipcRenderer.invoke('stats:getRetraitsTrend', siteId, centreId, period, customDate ?? null),
    getUnsyncedCardsCount: (siteId: number): Promise<number> =>
      ipcRenderer.invoke('stats:getUnsyncedCardsCount', siteId),
    getUnsyncedConformeCardsCount: (siteId: number): Promise<number> =>
      ipcRenderer.invoke('stats:getUnsyncedConformeCardsCount', siteId),
    getDetailedSyncStats: (siteId: number): Promise<{ cleanCount: number, missingCount: number, probableCount: number, strictCount: number, invalidCount: number, modifiedCount: number, ghostCount: number }> =>
      ipcRenderer.invoke('stats:getDetailedSyncStats', siteId),
    getUnsyncedUsersCount: (siteId: number): Promise<number> => 
      ipcRenderer.invoke('stats:getUnsyncedUsersCount', siteId),
    
    getUnsyncedCentresCount: (siteId: number): Promise<number> => 
      ipcRenderer.invoke('stats:getUnsyncedCentresCount', siteId),
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
    processFile: (path: string, agent: string, totalEstimate?: number, siteId?: number, userId?: number, excludedRowIndices?: number[]): Promise<{ success: boolean; message: string }> =>
      ipcRenderer.invoke('import:processFile', path, agent, totalEstimate, siteId, userId, excludedRowIndices),
    fusionner: (agent: string, siteId?: number): Promise<{ updated: number; inserted: number }> => 
      ipcRenderer.invoke('import:fusionner', agent, siteId),
    getAnomalies: (siteId: number, offset = 0, limit = 50, query?: string): Promise<{rows: any[], total: number}> =>
      ipcRenderer.invoke('import:getAnomalies', siteId, offset, limit, query),
    clearAnomalies: (siteId: number): Promise<void> =>
      ipcRenderer.invoke('import:clearAnomalies', siteId),
    deleteAnomaly: (id: number): Promise<void> =>
      ipcRenderer.invoke('import:deleteAnomaly', id),
    updateAnomalyField: (id: number, field: string, value: string): Promise<any> =>
      ipcRenderer.invoke('import:updateAnomalyField', id, field, value),
    countEmptyAnomalies: (siteId: number): Promise<number> =>
      ipcRenderer.invoke('import:countEmptyAnomalies', siteId),
    deleteEmptyAnomalies: (siteId: number): Promise<void> =>
      ipcRenderer.invoke('import:deleteEmptyAnomalies', siteId),
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
    getAll: (siteId?: number, centreId?: number): Promise<IUser[]> => 
      ipcRenderer.invoke('users:getAll', siteId, centreId),
    getProfile: (login: string): Promise<any> => 
      ipcRenderer.invoke('users:getProfile', login),
    create: (data: Partial<IUser>): Promise<any> => 
      ipcRenderer.invoke('users:create', data),
    update: (id: number, data: Partial<IUser>): Promise<{ changes: number }> => 
      ipcRenderer.invoke('users:update', id, data),
    delete: (id: number): Promise<{ changes: number }> => 
      ipcRenderer.invoke('users:delete', id),
    hardDelete: (id: number): Promise<any> => 
      ipcRenderer.invoke('users:hardDelete', id),
    resetAgentPassword: (targetUserId: number): Promise<{ success: boolean; temporaryPassword: string }> =>
      ipcRenderer.invoke('auth:resetAgentPassword', targetUserId),
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
    assainirGlobal: (payload: { site_id: number }): Promise<{ success: boolean; deleted: number; details: any }> =>
      ipcRenderer.invoke('qualite:assainirGlobal', payload),
  },
  // Hierarchy
  hierarchy: {
    getSites: (): Promise<ISite[]> => 
      ipcRenderer.invoke('hierarchy:getSites'),
    getSitesSummary: (): Promise<ISiteSummary[]> => 
      ipcRenderer.invoke('hierarchy:getSitesSummary'),
    createSite: (data: { nom: string; code: string; max_centres: number; admin: { nom: string; login: string; password_hash: string } }, currentUser?: any): Promise<any> => 
      ipcRenderer.invoke('hierarchy:createSite', data, currentUser),
    updateSite: (id: number, data: Partial<ISite>): Promise<any> => 
      ipcRenderer.invoke('hierarchy:updateSite', id, data),
    deleteSite: (id: number): Promise<any> => 
      ipcRenderer.invoke('hierarchy:deleteSite', id),
    resetAdminPassword: (siteId: number, pass: string): Promise<any> => 
      ipcRenderer.invoke('hierarchy:resetAdminPassword', siteId, pass),
    verifyPassword: (password: string, actionName?: string, login?: string): Promise<boolean> =>
      ipcRenderer.invoke('hierarchy:verifyPassword', password, login, actionName),
    getCentres: (siteId?: number): Promise<any[]> => 
      ipcRenderer.invoke('hierarchy:getCentres', siteId),
    getCentreById: (id: number): Promise<any> => 
      ipcRenderer.invoke('hierarchy:getCentreById', id),
    createCentre: (data: any): Promise<any> => 
      ipcRenderer.invoke('hierarchy:createCentre', data),
    updateCentre: (id: number, data: any): Promise<any> => 
      ipcRenderer.invoke('hierarchy:updateCentre', id, data),
    deleteCentre: (id: number): Promise<any> => 
      ipcRenderer.invoke('centre:delete', id),
    getPostes: (centreId?: number): Promise<any[]> => 
      ipcRenderer.invoke('hierarchy:getPostes', centreId),
    pullCentres: (siteId: number, currentUser?: any): Promise<{ success: boolean; count: number; message?: string }> => 
      ipcRenderer.invoke('sync:pullCentres', siteId, currentUser),
    forceCentres: (siteId: number, currentUser?: any): Promise<{ success: boolean; count: number; message?: string }> => 
      ipcRenderer.invoke('sync:forceCentres', siteId, currentUser),
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
    openExternal: (url: string): Promise<{ success: boolean; error?: string }> => 
      ipcRenderer.invoke('app:openExternal', url),
    openExternalUrl: (url: string): void => 
      ipcRenderer.send('app:openExternalUrl', url),
  },


  database: {
    getCardsCount: (): Promise<number> => 
      ipcRenderer.invoke('database:getCardsCount'),
    export: (currentUser?: any): Promise<{ success: boolean; filePath?: string; reason?: string }> => 
      ipcRenderer.invoke('database:export', currentUser),
    import: (currentUser?: any, password?: string): Promise<{ success: boolean; reason?: string }> =>
      ipcRenderer.invoke('database:import', currentUser, password),
  },
  db: {
    purge: (siteId?: number, currentUser?: any): Promise<{ success: boolean; count: number }> => 
      ipcRenderer.invoke('db:purge', siteId, currentUser),
    emergencyPurge: (siteId: number, currentUser?: any): Promise<{ success: boolean }> => 
      ipcRenderer.invoke('db:emergency-purge', siteId, currentUser),
    getCardCount: (siteId?: number): Promise<number> =>
      ipcRenderer.invoke('db:getCardCount', siteId),
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
    getCloudCartesCount: (siteId: number): Promise<number> => 
      ipcRenderer.invoke('sync:getCloudCartesCount', siteId),
    getTotalCloudCartesCount: (siteId: number): Promise<number> => 
      ipcRenderer.invoke('sync:getTotalCloudCartesCount', siteId),
    force: (): Promise<any> => 
      ipcRenderer.invoke('sync:force'),
    forcePing: (): Promise<{ success: boolean; state: string }> => 
      ipcRenderer.invoke('sync:forcePing'),
    retryConnection: (): Promise<{ success: boolean; state: string }> =>
      ipcRenderer.invoke('network:retry'),
    // Identité dérivée côté main de la session serveur réelle (getSecureCurrentUser) —
    // aucun paramètre d'identité n'est plus transmis depuis le renderer (cf. migration
    // V65 de schema.ts : la préférence est désormais indexée par id_user, pas par login).
    getAutoDownstream: (): Promise<boolean> =>
      ipcRenderer.invoke('sync:getAutoDownstream'),
    setAutoDownstream: (enabled: boolean): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('sync:setAutoDownstream', enabled),
    onStatusChanged: (callback: (status: any) => void) => {
      const listener = (_: any, status: any) => callback(status);
      ipcRenderer.on('sync:status-changed', listener);
      return () => ipcRenderer.removeListener('sync:status-changed', listener);
    },
    startBulk: (
      siteId: number,
      allowProbable?: boolean,
      allowInvalid?: boolean,
      allowMissing?: boolean,
      onlyModified?: boolean,
      currentUser?: any
    ): Promise<{
      success: boolean;
      message: string;
      status?: 'BLOCKED_STRICT' | 'BLOCKED_PROBABLE' | 'BLOCKED_INVALID' | 'BLOCKED_MISSING';
      count?: number;
      uploadedCount?: number;
      missingCount?: number;
      strictCount?: number;
      probableCount?: number;
      invalidCount?: number;
    }> => 
      ipcRenderer.invoke('sync:startBulk', siteId, allowProbable, allowInvalid, allowMissing, onlyModified, currentUser),
    onBulkProgress: (callback: (p: number) => void) => {
      const listener = (_: any, p: number) => callback(p);
      ipcRenderer.on('sync:bulk-progress', listener);
      return () => ipcRenderer.removeListener('sync:bulk-progress', listener);
    },
    cancelBulk: (currentUser?: any): Promise<{ success: boolean; message: string }> =>
      ipcRenderer.invoke('sync:cancelBulk', currentUser),
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
    syncUsersFromSupabase: (siteId: number, currentUser?: any): Promise<{ success: boolean; count: number; message?: string }> =>
      ipcRenderer.invoke('admin:syncUsersFromSupabase', siteId, currentUser),
    forceAgents: (siteId: number): Promise<{ success: boolean; count: number; message?: string }> => 
      ipcRenderer.invoke('sync:forceAgents', siteId),
    /**
     * Écoute les événements du cycle downstream automatique (toutes les 2h post-login).
     * Permet d'afficher une notification discrète dans le footer de l'UI.
     *
     * @param callback - Fonction appelée à chaque événement du cycle automatique.
     * @returns Fonction de nettoyage à appeler au démontage du composant.
     */
    onAutoDownstream: (callback: (event: any) => void) => {
      const listener = (_: any, event: any) => callback(event);
      ipcRenderer.on('sync:auto-downstream', listener);
      return () => ipcRenderer.removeListener('sync:auto-downstream', listener);
    },
    onDownstreamProgress: (callback: (p: number) => void) => {
      const listener = (_: any, p: number) => callback(p);
      ipcRenderer.on('sync:downstream-progress', listener);
      return () => ipcRenderer.removeListener('sync:downstream-progress', listener);
    },
  },
  // Maintenance
  maintenance: {
    clearAll: (currentUser?: any): Promise<void> => 
      ipcRenderer.invoke('maintenance:clearAll', currentUser),
    clearDatabaseCartes: (siteId?: number, currentUser?: any): Promise<{ success: boolean; count: number }> => 
      ipcRenderer.invoke('maintenance:clearDatabaseCartes', siteId, currentUser),
    clearCloudCartes: (siteId: number, currentUser?: any): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('maintenance:clearCloudCartes', siteId, true, currentUser),
    fullReset: (currentUser?: any): Promise<void> => 
      ipcRenderer.invoke('maintenance:fullReset', currentUser),
    purgeEmptyRows: (): Promise<void> => 
      ipcRenderer.invoke('maintenance:purgeEmptyRows'),
    getLogs: (limit?: number, offset?: number, searchTerm?: string, filterLevel?: string): Promise<{logs: any[], total: number}> =>
      ipcRenderer.invoke('maintenance:getLogs', limit, offset, searchTerm, filterLevel),
    clearLogs: (password: string, currentUser?: any): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('maintenance:clearLogs', password, currentUser),
    exportLogs: (): Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }> =>
      ipcRenderer.invoke('maintenance:exportLogs'),
    analyzeUploadedLogs: (): Promise<{ success: boolean; problemDescription?: string; detailedExplanation?: string; prompt?: string; error?: string }> =>
      ipcRenderer.invoke('maintenance:analyzeUploadedLogs'),
    onPurgeCloudProgress: (callback: (p: number) => void) => {
      const listener = (_event: any, p: number) => callback(p);
      ipcRenderer.on('db:purge-cloud-progress', listener);
      return () => ipcRenderer.removeListener('db:purge-cloud-progress', listener);
    },
  },
  onDatabaseUpdated: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('sync:updated-data', listener);
    return () => ipcRenderer.removeListener('sync:updated-data', listener);
  },
  // Auto Updater
  updater: {
    check: (): Promise<{ success: boolean; result?: any; error?: string }> =>
      ipcRenderer.invoke('updater:check'),
    download: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('updater:download'),
    install: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('updater:install'),
    onUpdateAvailable: (callback: (info: any) => void) => {
      const listener = (_: any, info: any) => callback(info);
      ipcRenderer.on('updater:update-available', listener);
      return () => ipcRenderer.removeListener('updater:update-available', listener);
    },
    onUpdateNotAvailable: (callback: (info: any) => void) => {
      const listener = (_: any, info: any) => callback(info);
      ipcRenderer.on('updater:update-not-available', listener);
      return () => ipcRenderer.removeListener('updater:update-not-available', listener);
    },
    onDownloadProgress: (callback: (progress: any) => void) => {
      const listener = (_: any, progress: any) => callback(progress);
      ipcRenderer.on('updater:download-progress', listener);
      return () => ipcRenderer.removeListener('updater:download-progress', listener);
    },
    onUpdateDownloaded: (callback: (info: any) => void) => {
      const listener = (_: any, info: any) => callback(info);
      ipcRenderer.on('updater:update-downloaded', listener);
      return () => ipcRenderer.removeListener('updater:update-downloaded', listener);
    },
    onError: (callback: (error: string) => void) => {
      const listener = (_: any, error: string) => callback(error);
      ipcRenderer.on('updater:error', listener);
      return () => ipcRenderer.removeListener('updater:error', listener);
    },
  },
  // Debug
  debug: {
    getAllAnomalies: (filterType?: string): Promise<any[]> => ipcRenderer.invoke('debug:getAllAnomalies', filterType)
  }
};

contextBridge.exposeInMainWorld('api', api);

export type ApiType = typeof api;
export { api };
