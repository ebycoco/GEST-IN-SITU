export {};

declare global {
  interface Window {
    api: {
      auth: {
        login: (login: string, mdp: string) => Promise<any>;
        logout: (login?: string) => Promise<boolean>;
        setActiveRole: (role: string) => Promise<{ success: boolean; activeRole?: string; message?: string }>;
        updateSelfProfile: (userId: number, data: any) => Promise<{ success: boolean; message?: string }>;
        registerSuperAdmin: (data: any) => Promise<{ success: boolean; message: string }>;
        onSessionExpired: (callback: (payload?: { reason?: 'revoked' | 'disabled' }) => void) => () => void;
        onSessionUpdated: (callback: (payload: { roles: string[] }) => void) => () => void;
        getSessionSnapshot: () => Promise<any>;
        onAuthWarning: (callback: (warningMessage: string) => void) => () => void;
        isPreloadingUsers: () => Promise<boolean>;
        onPreloadStatus: (callback: (isPreloading: boolean) => void) => () => void;
      };
      stats: {
        get: (siteId?: number, centreId?: number, forceRefresh?: boolean) => Promise<any>;
        getCentre: (centreId: number, siteId: number) => Promise<any>;
        getCentreOperateurs: (centreId: number) => Promise<any[]>;
        getGlobal: () => Promise<any>;
        getVerification: (agentUsername: string, siteId: number) => Promise<any>;
        getCardsToday: (agentUsername: string, siteId: number) => Promise<any[]>;
        getVerificationCardsTodayPaginated: (agentUsername: string, siteId: number, page?: number, pageSize?: number) => Promise<{ rows: any[]; total: number; syncSummary: { synced: number; pending: number; error: number } }>;
        getApurementCardsTodayPaginated: (agentUsername: string, siteId: number, page?: number, pageSize?: number) => Promise<{ rows: any[]; total: number; syncSummary: { synced: number; pending: number; error: number } }>;
        getApurementStats: (agentUsername: string, siteId: number) => Promise<any>;
        getAgentToday: (userId: number) => Promise<number>;
        getAgentRecentSaisies: (userId: number, limit?: number, offset?: number) => Promise<{ total: number; rows: any[] }>;
        getAgentStats: (userId: number) => Promise<{ today: number; yesterday: number; week: number; month: number; year: number }>;
        getAgentCardsTodayPaginated: (userId: number, page?: number, pageSize?: number) => Promise<{ rows: any[]; total: number; syncSummary: { synced: number; pending: number; error: number } }>;
        getSiteSaisieToday: (siteId: number, centreId?: number, agentId?: number, dateStr?: string) => Promise<any[]>;
        getSiteQualiteToday: (siteId: number, centreId?: number, agentId?: number, dateStr?: string) => Promise<any[]>;
        getSiteLogistiqueToday: (siteId: number, centreId?: number, agentId?: number, dateStr?: string) => Promise<any[]>;
        getActivitiesByAgentAndDate: (siteId: number, centreId?: number | null, agentId?: number | null, dateStr?: string | null) => Promise<any>;
        getRetraits: (siteId: number, centreId: number | null, period: string, customDate?: string | null) => Promise<{ rows: any[]; totaux: any }>;
        getRetraitsTrend: (siteId: number, centreId: number | null, period: string, customDate?: string | null) => Promise<Array<{ label: string; total: number }>>;
        getUnsyncedCardsCount: (siteId: number) => Promise<number>;
        getUnsyncedConformeCardsCount: (siteId: number) => Promise<number>;
        getUnsyncedUsersCount: (siteId: number) => Promise<number>;
        getUnsyncedCentresCount: (siteId: number) => Promise<number>;
        getDetailedSyncStats: (siteId: number) => Promise<{ cleanCount: number, missingCount: number, probableCount: number, strictCount: number, invalidCount: number, modifiedCount: number, ghostCount: number }>;
        getSiteSyncSummary: (siteId?: number) => Promise<{ pending: number; error: number }>;
      };
      cartes: {
        searchAllRecords: (siteId: number, filters: any, limit: number) => Promise<any[]>;
        getRecordForCorrection: (originalId: number | string, recordType: string, siteId?: number) => Promise<any>;
        getPage: (offset: number, limit: number, filters: any) => Promise<{rows: any[], total: number}>;
        search: (query: string, limit?: number, filters?: any) => Promise<any[]>;
        searchCloudEmergency: (query: string, filters: any) => Promise<any[]>;
        pullSingleCard: (cardData: any) => Promise<any>;
        getById: (id: number) => Promise<any>;
        create: (data: any) => Promise<any>;
        countDrafts: (siteId: number, currentUser?: any) => Promise<number>;
        publishDrafts: (siteId: number, currentUser?: any) => Promise<{ publishedCount: number; skippedInvalidDateCount: number }>;
        updateCarte: (id: number, data: any, currentUser?: any) => Promise<any>;
        update: (id: number, data: any, currentUser?: any) => Promise<any>;
        delete: (id: number, currentUser?: any) => Promise<boolean>;
        delivrer: (id: number, data: any, currentUser?: any) => Promise<boolean>;
        transferer: (id: number, data: { centre_id: number; rangement?: string; agent_transfert: string }, currentUser?: any) => Promise<any>;
        signalerAbsence: (id: number, agentLogin: string, agentInfo: string, commentaire?: string, currentUser?: any) => Promise<boolean>;
        declarerDoublon: (id: number, motif: string) => Promise<any>;
        annulerDoublon: (id: number, motifAnnulation: string) => Promise<any>;
        getAbsences: (siteId?: number) => Promise<any[]>;
        getAbsencesCentre: (centreId: number) => Promise<any[]>;
        getEscaladesResoluesCentre: (centreId: number) => Promise<any[]>;
        getAbsencesSite: (siteId?: number) => Promise<any[]>;
        escaladerAuSite: (id: number, currentUser?: any) => Promise<any>;
        getAgentAbsences: (agent: string, siteId?: number) => Promise<any[]>;
        getSignalementsResolus: (agent: string, siteId?: number) => Promise<any[]>;
        archiveSignalement: (id: number, agentLogin: string) => Promise<boolean>;
        getArchivedSignalements: (agentLogin: string) => Promise<number[]>;
        resoudreAbsence: (id: number, data: any) => Promise<boolean>;
        declarerPerdue: (id: number) => Promise<boolean>;
        getHistoriquePertes: (siteId?: number) => Promise<any[]>;
        reactiverCarte: (id: number, nouveauRangement: string, currentUser?: any) => Promise<any>;
        getInvalidDates: (siteId?: number, offset?: number, limit?: number, query?: string) => Promise<{ rows: any[], total: number }>;
        getDatesVidesPage: (siteId?: number, offset?: number, limit?: number, query?: string) => Promise<{ rows: any[], total: number }>;
        updateDate: (id: number, newDate: string) => Promise<boolean>;
        getDoublonsPage: (siteId: number, offset: number, limit: number, query?: string, filters?: any) => Promise<{rows: any[], total: number}>;
        getDoublonsProbablesPage: (siteId: number, offset: number, limit: number, query?: string, filters?: any) => Promise<{rows: any[], total: number}>;
        getSansNumSecuPage: (siteId: number, offset: number, limit: number, query?: string, filters?: any) => Promise<{rows: any[], total: number}>;
        getSansNomPage: (siteId: number, offset: number, limit: number, query?: string, filters?: any) => Promise<{rows: any[], total: number}>;
        getSansPrenomPage: (siteId: number, offset: number, limit: number, query?: string, filters?: any) => Promise<{rows: any[], total: number}>;
        getSansRangementPage: (siteId: number, offset: number, limit: number, query?: string, filters?: any) => Promise<{rows: any[], total: number}>;
        getSansContactPage: (siteId: number, offset: number, limit: number, query?: string) => Promise<{rows: any[], total: number}>;
        getSansLieuNaissancePage: (siteId: number, offset: number, limit: number, query?: string) => Promise<{rows: any[], total: number}>;
        updateQuickFields: (id: number, fields: { num_secu?: string, rangement?: string, noms?: string, prenoms?: string, contact?: string, lieu_de_naissance?: string, date_de_naissance?: string, sexe?: string }) => Promise<any>;
        searchQuickLogistique: (siteId: number, critere: string) => Promise<any[]>;
        updateRangementEtFiche: (id: number, fields: { rangement: string, num_secu?: string }) => Promise<any>;
        searchCombinedInventaire: (siteId: number, queryNomsPrenoms: string, dateNaissance?: string, lieuNaissance?: string) => Promise<any[]>;
        updateApurementHistorique: (id: number, fields: { date_delivrance: string, nom_retirant: string, num_retirant: string, relation_retirant: string, agent_distributeur: string }) => Promise<any>;
        inventairePhysiqueScan: (identifiant: string, rangement: string) => Promise<any>;
      };
      logistique: {
        recevoirLot: (payload: { lot_id: string; quantite: number; centre_origine: string }) => Promise<{ success: boolean }>;
        triCartes: (payload: { lot_id: string; nombre_cartes_triées: number; statut_tri: string }) => Promise<{ success: boolean }>;
        transfertCentre: (payload: { lot_id: string; centre_destination: string; nombre_cartes: number }) => Promise<{ success: boolean }>;
        inventairePhysique: (payload: { centre_id: string | number; ecart_constaté: number; note_agent: string }) => Promise<{ success: boolean }>;
      };
      users: {
        getAll: (siteId?: number, centreId?: number) => Promise<any[]>;
        getProfile: (login: string) => Promise<any>;
        create: (data: any) => Promise<any>;
        update: (id: number, data: any) => Promise<any>;
        delete: (id: number) => Promise<boolean>;
        hardDelete: (id: number) => Promise<boolean>;
        resetAgentPassword: (targetUserId: number) => Promise<{ success: boolean; temporaryPassword: string }>;
      };
      logs: {
        get: (offset?: number, limit?: number, filters?: any) => Promise<{rows: any[], total: number}>;
        add: (userId: number, login: string, action: string, detail?: string) => Promise<boolean>;
        purge: (payload?: { periode_purge?: string }) => Promise<any>;
        consultation: (offset: number, limit: number, filters?: any) => Promise<{rows: any[], total: number}>;
        export: (payload?: { periode_export?: string }) => Promise<{ success: boolean; filePath?: string; nombre_lignes_exportées?: number; error?: string; canceled?: boolean }>;
      };
      audit: {
        getPage: (offset: number, limit: number, currentUser?: any) => Promise<{rows: any[], total: number}>;
        delete: (id: number, currentUser: any) => Promise<{success: boolean}>;
      };
      qualite: {
        fusionnerDoublons: (payload: { id_carte_source: number; id_carte_cible: number; champs_fusionnes: string[] }) => Promise<any>;
        corrigerFormat: (payload: { id_carte: number; champ_corrige: string; valeur_avant: string; valeur_apres: string }) => Promise<any>;
        supprimerIncoherences: (payload: { type_incoherence: string; site_id: number }) => Promise<any>;
        assainirGlobal: (payload: { site_id: number }) => Promise<{ success: boolean; deleted: number; details: any }>;
      };
      export: {
        csv: (filters?: any) => Promise<any>;
        excel: (filters?: any) => Promise<any>;
        pdf: (filters?: any) => Promise<any>;
        getRangements: (siteId?: number) => Promise<string[]>;
        marquerExporte: (ids: number[]) => Promise<any>;
        getRows: (filters?: any) => Promise<any[]>;
        onPdfProgress: (callback: (progress: number) => void) => () => void;
      };
      import: {
        selectFile: () => Promise<string | null>;
        parseCSV: (path: string) => Promise<{rows: any[], headers: string[], total: number, error?: string}>;
        executeBatch: (rows: any[], agent: string, siteId?: number) => Promise<void>;
        clearTemp: (siteId?: number) => Promise<void>;
        processFile: (path: string, agent: string, totalEstimate?: number, siteId?: number, userId?: number, excludedRowIndices?: number[]) => Promise<any>;
        fusionner: (agent: string, siteId?: number) => Promise<{updated: number, inserted: number}>;
        getAnomalies: (siteId: number, offset?: number, limit?: number, query?: string) => Promise<{rows: any[], total: number}>;
        clearAnomalies: (siteId: number) => Promise<void>;
        deleteAnomaly: (id: number) => Promise<void>;
        updateAnomalyField: (id: number, field: string, value: string) => Promise<void>;
        countEmptyAnomalies: (siteId: number) => Promise<number>;
        deleteEmptyAnomalies: (siteId: number) => Promise<void>;
        onProgress: (callback: (p: number) => void) => () => void;
      };
      hierarchy: {
        getSites: () => Promise<any[]>;
        getSitesSummary: () => Promise<any[]>;
        createSite: (data: any, currentUser?: any) => Promise<any>;
        updateSite: (id: number, data: any) => Promise<any>;
        deleteSite: (id: number) => Promise<any>;
        resetAdminPassword: (siteId: number, pass: string) => Promise<any>;
        verifyPassword: (password: string, actionName?: string, login?: string) => Promise<boolean>;
        getCentres: (siteId?: number) => Promise<any[]>;
        getCentreById: (id: number) => Promise<any>;
        createCentre: (data: any) => Promise<any>;
        updateCentre: (id: number, data: any) => Promise<any>;
        deleteCentre: (id: number) => Promise<any>;
        getPostes: (centreId?: number) => Promise<any[]>;
        pullCentres: (siteId: number, currentUser?: any) => Promise<{ success: boolean; count: number; message?: string }>;
        forceCentres: (siteId: number, currentUser?: any) => Promise<{ success: boolean; count: number; message?: string }>;
      };
      maintenance: {
        clearAll: (currentUser?: any) => Promise<any>;
        clearDatabaseCartes: (siteId?: number, currentUser?: any) => Promise<any>;
        clearCloudCartes: (siteId: number, currentUser?: any) => Promise<{ success: boolean }>;
        fullReset: (currentUser?: any) => Promise<{success: boolean}>;
        purgeEmptyRows: () => Promise<void>;
        getLogs: (limit?: number, offset?: number, searchTerm?: string, filterLevel?: string) => Promise<{logs: any[], total: number}>;
        clearLogs: (password: string, currentUser?: any) => Promise<{ success: boolean }>;
        exportLogs: () => Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }>;
        analyzeUploadedLogs: () => Promise<{ success: boolean; problemDescription?: string; detailedExplanation?: string; prompt?: string; error?: string }>;
        onPurgeCloudProgress: (callback: (p: number) => void) => () => void;
      };
      window: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
        isMaximized: () => Promise<boolean>;
      };
      log: {
        info: (message: string) => void;
        error: (message: string, error?: any) => void;
        warn: (message: string) => void;
      };
      app: {
        getName: () => Promise<string>;
        getVersion: () => Promise<string>;
        getDbPath: () => Promise<string>;
        exportLogs: () => Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }>;
        checkFirstLaunch: () => Promise<{ isFirstLaunch: boolean }>;
        openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
        openExternalUrl: (url: string) => void;
      };
      database: {
        getCardsCount: () => Promise<number>;
        export: (currentUser?: any) => Promise<{ success: boolean; filePath?: string; reason?: string }>;
        import: (currentUser?: any, password?: string) => Promise<{ success: boolean; reason?: string }>;
      };
      db: {
        purge: (siteId?: number, currentUser?: any) => Promise<{ success: boolean; count: number }>;
        emergencyPurge: (siteId: number, currentUser?: any) => Promise<{ success: boolean }>;
        getCardCount: (siteId?: number) => Promise<number>;
        onPurgeProgress: (callback: (p: number) => void) => () => void;
      };
      sync: {
        getStatus: () => Promise<{ state: string; lastSync: string; queueCount: number; isSyncing: boolean; isGlobalLocked: boolean; outboxCount?: number; outboxErrorCount?: number; errors?: any[] }>;
        getCloudCartesCount: (siteId: number) => Promise<number>;
        getTotalCloudCartesCount: (siteId: number) => Promise<number>;
        force: () => Promise<{ success: boolean; message: string }>;
        forcePing: () => Promise<{ success: boolean; state: string }>;
        retryConnection: () => Promise<{ success: boolean; state: string }>;

        getAutoDownstream: () => Promise<boolean>;
        setAutoDownstream: (enabled: boolean) => Promise<{ success: boolean }>;
        onStatusChanged: (callback: (status: any) => void) => () => void;
        startBulk: (
          siteId: number,
          allowProbable?: boolean,
          allowInvalid?: boolean,
          allowMissing?: boolean,
          onlyModified?: boolean
        ) => Promise<{
          success: boolean;
          message: string;
          status?: 'BLOCKED_STRICT' | 'BLOCKED_PROBABLE' | 'BLOCKED_INVALID' | 'BLOCKED_MISSING';
          count?: number;
          uploadedCount?: number;
          missingCount?: number;
          strictCount?: number;
          probableCount?: number;
          invalidCount?: number;
        }>;
        onBulkProgress: (callback: (p: number) => void) => () => void;
        onDownstreamProgress: (callback: (p: { progress: number; merged: number; total: number }) => void) => () => void;
        cancelBulk: (currentUser?: any) => Promise<{ success: boolean; message: string }>;
        getUnreadCount: (siteId?: number) => Promise<number>;
        getUnreadList: (siteId?: number) => Promise<any[]>;
        markAsRead: (siteId?: number) => Promise<boolean>;
        markNotificationAsRead: (idLog: number) => Promise<boolean>;
        pullSiteCards: (siteId: number, currentUser?: any) => Promise<{ success: boolean; count: number; message?: string }>;
        forceGlobal: () => Promise<{ success: boolean; counts: { sites: number; centres: number; users: number } }>;
        forceSite: (siteId: number) => Promise<{ success: boolean; counts: { cards: number; users: number }; errors: string[] }>;
        pullAgents: (siteId: number, currentUser?: any) => Promise<{ success: boolean; count: number; message?: string }>;
        syncUsersFromSupabase: (siteId: number, currentUser?: any) => Promise<{ success: boolean; count: number; message?: string }>;
        forceAgents: (siteId: number) => Promise<{ success: boolean; count: number; message?: string }>;
      };
      updater: {
        check: () => Promise<{ success: boolean; result?: any; error?: string }>;
        download: () => Promise<{ success: boolean; error?: string }>;
        install: () => Promise<{ success: boolean; error?: string }>;
        onUpdateAvailable: (callback: (info: any) => void) => () => void;
        onUpdateNotAvailable: (callback: (info: any) => void) => () => void;
        onDownloadProgress: (callback: (progress: any) => void) => () => void;
        onUpdateDownloaded: (callback: (info: any) => void) => () => void;
        onError: (callback: (error: string) => void) => () => void;
      };
      debug: {
        getAllAnomalies: () => Promise<any[]>;
      };
      onDatabaseUpdated: (callback: (data: any) => void) => () => void;
    };
  }
}
