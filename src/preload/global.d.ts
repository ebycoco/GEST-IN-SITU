export {};

declare global {
  interface Window {
    api: {
      auth: {
        login: (login: string, mdp: string) => Promise<any>;
      };
      stats: {
        get: () => Promise<any>;
      };
      cartes: {
        getPage: (offset: number, limit: number, filters: any) => Promise<{rows: any[], total: number}>;
        search: (query: string, limit?: number) => Promise<any[]>;
        delivrer: (id: number, data: any) => Promise<boolean>;
        signalerAbsence: (id: number, agent: string) => Promise<boolean>;
      };
      users: {
        getAll: () => Promise<any[]>;
        delete: (id: number) => Promise<boolean>;
      };
      logs: {
        getRecent: (limit?: number) => Promise<any[]>;
      };
      import: {
        selectFile: () => Promise<string | null>;
        parseCSV: (path: string) => Promise<{rows: any[], headers: string[], total: number, error?: string}>;
        executeBatch: (rows: any[], agent: string) => Promise<void>;
        fusionner: () => Promise<{updated: number, inserted: number}>;
      };
      window: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
      };
    };
  }
}
