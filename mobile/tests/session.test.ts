// Session d'onglet (sessionStorage) : restauration au demarrage, effacement au verrou et a
// la deconnexion, verrou d'inactivite respecte apres rechargement simule, claims invalides.
// Le client supabase est remplace par un faux dont signOut efface la cle comme auth-js.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fauxMagasin } from './fauxMagasin';

vi.mock('../src/lib/config', () => ({
  config: { supabaseUrl: 'https://x.test', publishableKey: 'pk', gisLoginUrl: 'https://x.test/f', valide: true },
}));

const magasin = fauxMagasin();
vi.stubGlobal('sessionStorage', magasin);

interface FauxAuth {
  getSession: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  stopAutoRefresh: ReturnType<typeof vi.fn>;
}
let dernierAuth: FauxAuth;
let optionsClient: { auth?: Record<string, unknown> } | undefined;
let jetonCourant = '';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn((_u: string, _k: string, opts: { auth?: Record<string, unknown> }) => {
    optionsClient = opts;
    dernierAuth = {
      getSession: vi.fn(async () => {
        const brut = magasin.getItem('gis-mobile-auth');
        return brut ? { data: { session: { access_token: jetonCourant } }, error: null } : { data: { session: null }, error: null };
      }),
      signOut: vi.fn(async () => {
        magasin.removeItem('gis-mobile-auth'); // comme auth-js : _removeSession
        return { error: null };
      }),
      stopAutoRefresh: vi.fn(async () => undefined),
    };
    return { auth: dernierAuth, from: vi.fn() };
  }),
}));

import { fermerSession, restaurerSession } from '../src/lib/api';
import { IDLE_TIMEOUT_MS } from '../src/lib/idleLock';
import { CLE_ACTIVITE, CLE_AUTH, CLE_LOGIN } from '../src/lib/stockageSession';

function b64url(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}
function jeton(claims: Record<string, unknown>): string {
  return `${b64url({ alg: 'HS256' })}.${b64url({ role: 'authenticated', ...claims })}.sig`;
}
const CLAIMS_OK = { gis_v: 1, gis_sync_id: 'u-1', gis_site_id: 3, gis_roles: ['OPERATEUR_VERIFICATION'], gis_primary_role: 'OPERATEUR_VERIFICATION' };

function poserSession(opts: { jeton: string; activiteIlYaMs: number | null; login?: string }) {
  jetonCourant = opts.jeton;
  magasin.setItem(CLE_AUTH, '{"access_token":"x"}');
  if (opts.activiteIlYaMs !== null) magasin.setItem(CLE_ACTIVITE, String(Date.now() - opts.activiteIlYaMs));
  magasin.setItem(CLE_LOGIN, opts.login ?? 'agent01');
}
const cles = () => Object.keys(magasin.dump()).sort();

beforeEach(async () => {
  for (const k of cles()) magasin.removeItem(k);
  await fermerSession(); // remet le module a zero (client = null)
  for (const k of cles()) magasin.removeItem(k);
});

describe('restaurerSession (page rechargee)', () => {
  it('cree le client avec sessionStorage (pas localStorage), cle dediee, sans detection d\'URL', async () => {
    poserSession({ jeton: jeton(CLAIMS_OK), activiteIlYaMs: 1000 });
    await restaurerSession();
    const a = optionsClient?.auth ?? {};
    expect(a['persistSession']).toBe(true);
    expect(a['autoRefreshToken']).toBe(true);
    expect(a['detectSessionInUrl']).toBe(false);
    expect(a['storageKey']).toBe(CLE_AUTH);
    // l'adaptateur ecrit dans le faux sessionStorage
    (a['storage'] as { setItem(k: string, v: string): void }).setItem('gis-mobile-test', 'v');
    expect(magasin.getItem('gis-mobile-test')).toBe('v');
  });

  it('session valide + activite recente : restauree (login, claims, derniere activite)', async () => {
    poserSession({ jeton: jeton(CLAIMS_OK), activiteIlYaMs: 60_000, login: 'agent01' });
    const r = await restaurerSession();
    expect(r).not.toBeNull();
    expect(r?.session.login).toBe('agent01');
    expect(r?.session.claims.syncId).toBe('u-1');
    expect(r?.session.claims.siteId).toBe(3);
    expect(Date.now() - (r?.derniereActivite ?? 0)).toBeGreaterThanOrEqual(59_000);
    expect(magasin.getItem(CLE_AUTH)).not.toBeNull(); // session conservee
  });

  it('delai d\'inactivite depasse apres rechargement : tout est efface, connexion demandee', async () => {
    poserSession({ jeton: jeton(CLAIMS_OK), activiteIlYaMs: IDLE_TIMEOUT_MS + 1000 });
    expect(await restaurerSession()).toBeNull();
    expect(cles()).toEqual([]);
    expect(dernierAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('activite absente : refusee (pas de contournement en supprimant la cle)', async () => {
    poserSession({ jeton: jeton(CLAIMS_OK), activiteIlYaMs: null });
    expect(await restaurerSession()).toBeNull();
    expect(cles()).toEqual([]);
  });

  it('claims invalides (role absent) : tout efface, aucune exception', async () => {
    poserSession({ jeton: jeton({ ...CLAIMS_OK, gis_roles: ['ADMIN_CENTRE'] }), activiteIlYaMs: 1000 });
    expect(await restaurerSession()).toBeNull();
    expect(cles()).toEqual([]);
  });

  it('jeton sans claims gis_* : tout efface', async () => {
    poserSession({ jeton: jeton({}), activiteIlYaMs: 1000 });
    expect(await restaurerSession()).toBeNull();
    expect(cles()).toEqual([]);
  });

  it('session non renouvelable (getSession sans session) : tout efface', async () => {
    magasin.setItem(CLE_ACTIVITE, String(Date.now()));
    magasin.setItem(CLE_LOGIN, 'agent01');
    // pas de CLE_AUTH : le faux getSession rend { session: null }
    expect(await restaurerSession()).toBeNull();
    expect(cles()).toEqual([]);
  });
});

describe('fermerSession (verrou / deconnexion)', () => {
  it('efface la session ET l\'activite, y compris si signOut echoue (hors ligne)', async () => {
    poserSession({ jeton: jeton(CLAIMS_OK), activiteIlYaMs: 1000 });
    expect(await restaurerSession()).not.toBeNull();
    dernierAuth.signOut.mockImplementation(async () => {
      throw new Error('Failed to fetch'); // signOut n'a pas retire la cle
    });
    await fermerSession();
    expect(cles()).toEqual([]);
  });

  it('activite et identifiant effaces immediatement (avant la fin du signOut)', async () => {
    poserSession({ jeton: jeton(CLAIMS_OK), activiteIlYaMs: 1000 });
    await restaurerSession();
    let liberer: () => void = () => undefined;
    dernierAuth.signOut.mockImplementation(() => new Promise<{ error: null }>((r) => { liberer = () => r({ error: null }); }));
    const fin = fermerSession();
    expect(magasin.getItem(CLE_ACTIVITE)).toBeNull();
    expect(magasin.getItem(CLE_LOGIN)).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    liberer();
    await fin;
    expect(cles()).toEqual([]);
  });

  it('sans client ouvert : efface quand meme les cles restantes', async () => {
    magasin.setItem(CLE_AUTH, 'reste');
    await fermerSession();
    expect(cles()).toEqual([]);
  });
});
