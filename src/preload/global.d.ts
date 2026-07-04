export {};

declare global {
  interface Window {
    api: {
      auth: {
        login: (login: string, mdp: string) => Promise<any>;
      };
      stats: {
        get: (siteId?: number) => Promise<any>;
        getCentre: (centreId: number, siteId: number) => Promise<any>;
        getCentreOperateurs: (centreId: number) => Promise<any[]>;
        getGlobal: () => Promise<any>;
        getVerification: (agentUsername: string, siteId: number) => Promise<any>;
        getCardsToday: (agentUsername: string, siteId: number) => Promise<any[]>;
        getAgentToday: (userId: number) => Promise<number>;
        getAgentRecentSaisies: (userId: number, limit?: number) => Promise<any[]>;
        getSiteSaisieToday: (siteId: number) => Promise<any[]>;
        getRetraits: (siteId: number, centreId: number | null, period: string) => Promise<{ rows: any[]; totaux: any }>;
        getRetraitsTrend: (siteId: number, centreId: number | null, period: string) => Promise<Array<{ label: string; total: number }>>;
      };
      cartes: {
        getPage: (offset: number, limit: number, filters: any) => Promise<{rows: any[], total: number}>;
        search: (query: string, limit?: number, filters?: any) => Promise<any[]>;
        getById: (id: number) => Promise<any>;
        create: (data: any) => Promise<any>;
        update: (id: number, data: any) => Promise<any>;
        delete: (id: number) => Promise<boolean>;
        delivrer: (id: number, data: any, currentUser?: any) => Promise<boolean>;
        signalerAbsence: (id: number, agent: string) => Promise<boolean>;
        getAbsences: (siteId?: number) => Promise<any[]>;
        getAgentAbsences: (agent: string, siteId?: number) => Promise<any[]>;
        resoudreAbsence: (id: number, data: any) => Promise<boolean>;
        declarerPerdue: (id: number) => Promise<boolean>;
        getHistoriquePertes: (siteId?: number) => Promise<any[]>;
        reactiverCarte: (id: number, nouveauRangement: string, currentUser?: any) => Promise<any>;
        getInvalidDates: (siteId?: number) => Promise<any[]>;
        updateDate: (id: number, newDate: string) => Promise<boolean>;
        getDoublonsPage: (siteId: number, offset: number, limit: number, query?: string) => Promise<{rows: any[], total: number}>;
        getSansNumSecuPage: (siteId: number, offset: number, limit: number, query?: string) => Promise<{rows: any[], total: number}>;
        getSansRangementPage: (siteId: number, offset: number, limit: number, query?: string) => Promise<{rows: any[], total: number}>;
        updateQuickFields: (id: number, fields: { num_secu?: string, rangement?: string }) => Promise<any>;
        searchQuickLogistique: (siteId: number, critere: string) => Promise<any[]>;
        updateRangementEtFiche: (id: number, fields: { rangement: string, num_secu?: string }) => Promise<any>;
        searchCombinedInventaire: (siteId: number, queryNomsPrenoms: string, dateNaissance?: string, lieuNaissance?: string) => Promise<any[]>;
        updateApurementHistorique: (id: number, fields: { date_delivrance: string, nom_retirant: string, num_retirant: string, relation_retirant: string, agent_distributeur: string }) => Promise<any>;
      };
      users: {
        getAll: (siteId?: number) => Promise<any[]>;
        create: (data: any) => Promise<any>;
        update: (id: number, data: any) => Promise<any>;
        delete: (id: number) => Promise<boolean>;
        hardDelete: (id: number) => Promise<boolean>;
      };
      logs: {
        get: (offset?: number, limit?: number, filters?: any) => Promise<{rows: any[], total: number}>;
        add: (userId: number, login: string, action: string, detail?: string) => Promise<boolean>;
        purge: () => Promise<boolean>;
      };
      export: {
        csv: (filters?: any) => Promise<any>;
        excel: (filters?: any) => Promise<any>;
        getRangements: (siteId?: number) => Promise<string[]>;
        marquerExporte: (ids: number[]) => Promise<any>;
        getRows: (filters?: any) => Promise<any[]>;
      };
      import: {
        selectFile: () => Promise<string | null>;
        parseCSV: (path: string) => Promise<{rows: any[], headers: string[], total: number, error?: string}>;
        executeBatch: (rows: any[], agent: string, siteId?: number) => Promise<void>;
        clearTemp: (siteId?: number) => Promise<void>;
        processFile: (path: string, agent: string, totalEstimate?: number, siteId?: number) => Promise<any>;
        fusionner: (agent: string, siteId?: number) => Promise<{updated: number, inserted: number}>;
        onProgress: (callback: (p: number) => void) => () => void;
      };
      hierarchy: {
        getSites: () => Promise<any[]>;
        getSitesSummary: () => Promise<any[]>;
        createSite: (data: any) => Promise<any>;
        updateSite: (id: number, data: any) => Promise<any>;
        deleteSite: (id: number) => Promise<any>;
        resetAdminPassword: (siteId: number, pass: string) => Promise<any>;
        verifyPassword: (password: string) => Promise<boolean>;
        getCentres: (siteId?: number) => Promise<any[]>;
        createCentre: (data: any) => Promise<any>;
        updateCentre: (id: number, data: any) => Promise<any>;
        getPostes: (centreId?: number) => Promise<any[]>;
      };
      maintenance: {
        clearAll: () => Promise<any>;
        clearDatabaseCartes: (siteId?: number) => Promise<any>;
        fullReset: () => Promise<{success: boolean}>;
      };
      window: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
        isMaximized: () => Promise<boolean>;
      };
      app: {
        getVersion: () => Promise<string>;
        getDbPath: () => Promise<string>;
      };
      db: {
        purge: (siteId?: number) => Promise<{ success: boolean }>;
        emergencyPurge: (siteId: number) => Promise<{ success: boolean }>;
        getCardCount: () => Promise<number>;
        onPurgeProgress: (callback: (p: number) => void) => () => void;
      };
      sync: {
        getStatus: () => Promise<{ state: string; lastSync: string; queueCount: number }>;
        force: () => Promise<{ success: boolean; message: string }>;
        onStatusChanged: (callback: (status: any) => void) => () => void;
        startBulk: (siteId: number) => Promise<{ success: boolean; uploadedCount: number; message: string }>;
        onBulkProgress: (callback: (p: number) => void) => () => void;
        getUnreadCount: (siteId?: number) => Promise<number>;
        getUnreadList: (siteId?: number) => Promise<any[]>;
        markAsRead: (siteId?: number) => Promise<boolean>;
        markNotificationAsRead: (idLog: number) => Promise<boolean>;
      };
      onDatabaseUpdated: (callback: (data: any) => void) => () => void;
    };
  }
}
