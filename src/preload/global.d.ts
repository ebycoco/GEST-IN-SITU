export {};

declare global {
  interface Window {
    api: {
      auth: {
        login: (login: string, mdp: string) => Promise<any>;
      };
      stats: {
        get: (siteId?: number) => Promise<any>;
      };
      cartes: {
        getPage: (offset: number, limit: number, filters: any) => Promise<{rows: any[], total: number}>;
        search: (query: string, limit?: number) => Promise<any[]>;
        getById: (id: number) => Promise<any>;
        create: (data: any) => Promise<any>;
        update: (id: number, data: any) => Promise<any>;
        delete: (id: number) => Promise<boolean>;
        delivrer: (id: number, data: any) => Promise<boolean>;
        signalerAbsence: (id: number, agent: string) => Promise<boolean>;
        getAbsences: () => Promise<any[]>;
        resoudreAbsence: (id: number, data: any) => Promise<boolean>;
        getInvalidDates: () => Promise<any[]>;
        updateDate: (id: number, newDate: string) => Promise<boolean>;
      };
      users: {
        getAll: () => Promise<any[]>;
        create: (data: any) => Promise<any>;
        update: (id: number, data: any) => Promise<any>;
        delete: (id: number) => Promise<boolean>;
      };
      logs: {
        get: (offset?: number, limit?: number, filters?: any) => Promise<{rows: any[], total: number}>;
        add: (userId: number, login: string, action: string, detail?: string) => Promise<boolean>;
        purge: () => Promise<boolean>;
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
        createSite: (data: any) => Promise<any>;
        updateSite: (id: number, data: any) => Promise<any>;
        deleteSite: (id: number) => Promise<any>;
        verifyPassword: (password: string) => Promise<boolean>;
        getCentres: (siteId?: number) => Promise<any[]>;
        createCentre: (data: any) => Promise<any>;
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
    };
  }
}
