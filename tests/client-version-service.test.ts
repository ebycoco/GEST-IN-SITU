import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';

/**
 * Versions des postes — service d'envoi/lecture (src/main/sync/client-version.service.ts),
 * docs/PLAN_ECRAN_VERSIONS_POSTES.md étapes 2 et 3.
 *
 * Couvre : clé de poste (création, relecture, fichier corrompu → régénéré), règle
 * anti-répétition (1/h sauf changement d'utilisateur ou de version), garde is.dev
 * (GIS_REPORT_VERSION_IN_DEV), identité envoyée (sync_id uniquement, jamais d'id local),
 * attente du retour en ligne, absorption des erreurs (RPC fermée), lecture + traduction locale.
 * Aucun accès réseau : client Supabase, moniteur réseau et base sont des doublures.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-client-version-'));

const electronState = { version: '2.27.0' };
// is.dev (@electron-toolkit/utils) vaut !app.isPackaged : le service lit app.isPackaged à l'appel.
const isState = { dev: false };
vi.mock('electron', () => ({
  app: {
    getPath: () => tmpDir,
    getVersion: () => electronState.version,
    get isPackaged() { return !isState.dev; }
  }
}));

class FakeMonitor extends EventEmitter {
  state = 'ONLINE';
  getState(): string { return this.state; }
}
const fakeMonitor = new FakeMonitor();
vi.mock('../src/main/sync/network-monitor', () => ({
  get networkMonitor() { return fakeMonitor; }
}));

const rpcCalls: { fn: string; args: unknown }[] = [];
let rpcResponder: (fn: string) => { data: unknown; error: unknown } = () => ({ data: true, error: null });
let clientAvailable = true;
const fakeClient = {
  rpc: (fn: string, args?: unknown) => {
    rpcCalls.push({ fn, args });
    return { abortSignal: async () => rpcResponder(fn) };
  }
};
vi.mock('../src/main/sync/supabase-client', () => ({
  getSupabaseClient: () => (clientAvailable ? fakeClient : null)
}));

let sessionUser: any = null;
vi.mock('../src/main/auth/session-heartbeat', () => ({
  getSecureCurrentUser: () => sessionUser
}));

// Base locale factice : t_sites (id 7 → sync 'site-sync-7', nom 'ABOBO') et t_users.
const fakeSites = [{ id: 7, sync_id: 'site-sync-7', nom: 'ABOBO' }];
const fakeUsers = [{ sync_id: 'user-sync-1', login: 'agent.un' }];
vi.mock('../src/main/database/connection', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => ({
      get: (id: number) => {
        if (sql.includes('FROM t_sites WHERE id')) {
          const s = fakeSites.find((x) => x.id === id);
          return s ? { sync_id: s.sync_id } : undefined;
        }
        return undefined;
      },
      all: (...ids: string[]) => {
        if (sql.includes('FROM t_sites')) return fakeSites.filter((s) => ids.includes(s.sync_id)).map((s) => ({ sync_id: s.sync_id, label: s.nom }));
        if (sql.includes('FROM t_users')) return fakeUsers.filter((u) => ids.includes(u.sync_id)).map((u) => ({ sync_id: u.sync_id, label: u.login }));
        return [];
      }
    })
  })
}));

const svc = await import('../src/main/sync/client-version.service');

// Envoi en tâche de fond (setImmediate + E/S fichier async) : attente bornée par sondage,
// robuste à la charge de la suite complète (pas de délai fixe trop court).
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 100));
const waitCalls = async (n: number): Promise<void> => {
  await vi.waitFor(() => expect(rpcCalls).toHaveLength(n), { timeout: 5000, interval: 20 });
  await flush(); // laisse l'envoi en vol se terminer (drapeau sendInFlight relâché)
};
const posteFile = (): string => svc.getPosteKeyFilePath();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeEach(() => {
  svc.__resetClientVersionStateForTests();
  fakeMonitor.removeAllListeners();
  fakeMonitor.state = 'ONLINE';
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: true, error: null });
  clientAvailable = true;
  sessionUser = null;
  isState.dev = false;
  electronState.version = '2.27.0';
  delete process.env.GIS_REPORT_VERSION_IN_DEV;
  fs.rmSync(path.join(tmpDir, 'gis-poste'), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('clé de poste', () => {
  it('est créée au premier appel (UUID) dans userData/gis-poste/poste-id.json', async () => {
    const key = await svc.getPosteKey();
    expect(key).toMatch(UUID_RE);
    expect(posteFile()).toBe(path.join(tmpDir, 'gis-poste', 'poste-id.json'));
    const stored = JSON.parse(fs.readFileSync(posteFile(), 'utf-8'));
    expect(stored.poste_key).toBe(key);
    // Écriture atomique : aucun fichier temporaire résiduel.
    expect(fs.readdirSync(path.dirname(posteFile())).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('est relue à l\'identique par un nouveau processus', async () => {
    const first = await svc.getPosteKey();
    svc.__resetClientVersionStateForTests(); // simule un redémarrage (cache mémoire vidé)
    const second = await svc.getPosteKey();
    expect(second).toBe(first);
  });

  it('fichier corrompu (JSON invalide) → nouvelle clé générée et réécrite', async () => {
    fs.mkdirSync(path.dirname(posteFile()), { recursive: true });
    fs.writeFileSync(posteFile(), '{pas du json', 'utf-8');
    const key = await svc.getPosteKey();
    expect(key).toMatch(UUID_RE);
    expect(JSON.parse(fs.readFileSync(posteFile(), 'utf-8')).poste_key).toBe(key);
  });

  it('contenu invalide (clé hors format) → nouvelle clé générée', async () => {
    fs.mkdirSync(path.dirname(posteFile()), { recursive: true });
    fs.writeFileSync(posteFile(), JSON.stringify({ poste_key: 'a b' }), 'utf-8');
    const key = await svc.getPosteKey();
    expect(key).toMatch(UUID_RE);
  });
});

describe('règle anti-répétition (shouldSendReport)', () => {
  const H = svc.REPORT_MIN_INTERVAL_MS;
  const last = { at: 1_000_000, userSyncId: 'u1', version: '2.27.0' };

  it('premier envoi toujours autorisé', () => {
    expect(svc.shouldSendReport(null, { userSyncId: null, version: '2.27.0' }, 0)).toBe(true);
  });
  it('même utilisateur et même version : refusé avant 1 h, autorisé à 1 h', () => {
    expect(svc.shouldSendReport(last, { userSyncId: 'u1', version: '2.27.0' }, last.at + H - 1)).toBe(false);
    expect(svc.shouldSendReport(last, { userSyncId: 'u1', version: '2.27.0' }, last.at + H)).toBe(true);
  });
  it('changement d\'utilisateur ou de version : autorisé immédiatement', () => {
    expect(svc.shouldSendReport(last, { userSyncId: 'u2', version: '2.27.0' }, last.at + 1)).toBe(true);
    expect(svc.shouldSendReport(last, { userSyncId: null, version: '2.27.0' }, last.at + 1)).toBe(true);
    expect(svc.shouldSendReport(last, { userSyncId: 'u1', version: '2.28.0' }, last.at + 1)).toBe(true);
  });
});

describe('garde is.dev', () => {
  it('désactivé en dev sans GIS_REPORT_VERSION_IN_DEV', () => {
    isState.dev = true;
    expect(svc.isVersionReportingAllowed()).toBe(false);
  });
  it('activé en dev avec GIS_REPORT_VERSION_IN_DEV=1', () => {
    isState.dev = true;
    process.env.GIS_REPORT_VERSION_IN_DEV = '1';
    expect(svc.isVersionReportingAllowed()).toBe(true);
  });
  it('activé hors dev (poste installé)', () => {
    expect(svc.isVersionReportingAllowed()).toBe(true);
  });
  it('aucun appel RPC en dev, même après connexion', async () => {
    isState.dev = true;
    sessionUser = { sync_id: 'user-sync-1', site_id: 7 };
    svc.reportClientVersionAfterLogin();
    await flush();
    expect(rpcCalls).toEqual([]);
  });
});

describe('envoi après connexion', () => {
  it('envoie les sync_id (utilisateur + t_sites.sync_id), jamais l\'id local du site', async () => {
    sessionUser = { id_user: 42, sync_id: 'user-sync-1', site_id: 7 };
    svc.reportClientVersionAfterLogin();
    await waitCalls(1);
    expect(rpcCalls[0].fn).toBe('fn_report_client_version');
    const args = rpcCalls[0].args as Record<string, unknown>;
    expect(args.p_poste_key).toMatch(UUID_RE);
    expect(args.p_app_version).toBe('2.27.0');
    expect(args.p_user_sync_id).toBe('user-sync-1');
    expect(args.p_site_sync_id).toBe('site-sync-7');
  });

  it('1 envoi/heure : second déclenchement identique ignoré, changement d\'utilisateur renvoyé', async () => {
    sessionUser = { sync_id: 'user-sync-1', site_id: 7 };
    svc.reportClientVersionAfterLogin();
    await waitCalls(1);
    svc.reportClientVersionAfterLogin();
    await flush();
    expect(rpcCalls).toHaveLength(1);
    sessionUser = { sync_id: 'user-sync-2', site_id: 7 };
    svc.reportClientVersionAfterLogin();
    await waitCalls(2);
  });

  it('RPC fermée (permission denied) : erreur absorbée, pas de nouvel essai dans l\'heure', async () => {
    rpcResponder = () => ({ data: null, error: { code: '42501', message: 'permission denied for function fn_report_client_version' } });
    sessionUser = { sync_id: 'user-sync-1', site_id: 7 };
    expect(() => svc.reportClientVersionAfterLogin()).not.toThrow();
    await waitCalls(1);
    svc.reportClientVersionAfterLogin();
    await flush();
    expect(rpcCalls).toHaveLength(1);
  });

  it('client Supabase absent : aucun appel, aucune exception', async () => {
    clientAvailable = false;
    svc.reportClientVersionAfterLogin();
    await flush();
    expect(rpcCalls).toEqual([]);
  });

  it('hors ligne : attend le premier retour ONLINE, puis un seul envoi et écouteur retiré', async () => {
    fakeMonitor.state = 'OFFLINE';
    sessionUser = { sync_id: 'user-sync-1', site_id: 7 };
    svc.reportClientVersionAfterLogin();
    await flush();
    expect(rpcCalls).toEqual([]);
    expect(fakeMonitor.listenerCount('change')).toBe(1);

    fakeMonitor.state = 'ONLINE';
    fakeMonitor.emit('change', { oldState: 'OFFLINE', newState: 'ONLINE' });
    await waitCalls(1);
    expect(fakeMonitor.listenerCount('change')).toBe(0);
  });

  it('stopClientVersionReporter retire l\'écouteur réseau en attente', async () => {
    fakeMonitor.state = 'OFFLINE';
    svc.reportClientVersionAfterLogin();
    await flush();
    expect(fakeMonitor.listenerCount('change')).toBe(1);
    svc.stopClientVersionReporter();
    expect(fakeMonitor.listenerCount('change')).toBe(0);
  });
});

describe('lecture listClientVersions', () => {
  it('hors ligne → OFFLINE sans appel RPC', async () => {
    fakeMonitor.state = 'OFFLINE';
    expect(await svc.listClientVersions()).toEqual({ success: false, error: 'OFFLINE' });
    expect(rpcCalls).toEqual([]);
  });

  it('client absent → NO_CLIENT', async () => {
    clientAvailable = false;
    expect(await svc.listClientVersions()).toEqual({ success: false, error: 'NO_CLIENT' });
  });

  it('erreur RPC → RPC_ERROR (jamais d\'exception)', async () => {
    rpcResponder = () => ({ data: null, error: { code: '42501', message: 'permission denied' } });
    expect(await svc.listClientVersions()).toEqual({ success: false, error: 'RPC_ERROR' });
  });

  it('traduit site_sync_id → nom et last_user_sync_id → login en local, inconnu → null', async () => {
    rpcResponder = (fn) => {
      if (fn === 'fn_list_client_versions') {
        return {
          error: null,
          data: [
            { poste_ref: 'abcdef12', app_version: '2.27.0', site_sync_id: 'site-sync-7', last_user_sync_id: 'user-sync-1', first_seen_at: '2026-11-01T00:00:00Z', last_seen_at: '2026-11-14T00:00:00Z', nb_reports: 3, key_kind: 'publishable' },
            { poste_ref: '0123456789', app_version: '2.26.2', site_sync_id: 'site-inconnu', last_user_sync_id: null, first_seen_at: null, last_seen_at: null, nb_reports: '5', key_kind: null }
          ]
        };
      }
      return { error: null, data: [{ nb_total: 4, nb_preuve: 1, nb_ignorees: 1, nb_listables: 2 }] };
    };
    const res = await svc.listClientVersions();
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(rpcCalls.map((c) => c.fn).sort()).toEqual(['fn_count_client_versions', 'fn_list_client_versions']);
    expect(res.counts).toEqual({ nb_total: 4, nb_preuve: 1, nb_ignorees: 1, nb_listables: 2 });
    expect(res.truncated).toBe(false);
    expect(res.rows[0]).toMatchObject({ poste_ref: 'abcdef12', site_nom: 'ABOBO', last_user_login: 'agent.un', nb_reports: 3 });
    expect(res.rows[1]).toMatchObject({ poste_ref: '01234567', site_nom: null, last_user_login: null, nb_reports: 5 });
  });
});
