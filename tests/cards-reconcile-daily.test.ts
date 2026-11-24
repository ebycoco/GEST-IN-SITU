import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

/**
 * R1 (plan quota Supabase gratuit, 2026-11-24) : le rattrapage par liste de sync_id
 * (cards-reconcile.ts) tourne au plus une fois par 22 h (~1x/jour), par poste et par site.
 *
 * Avant : echeance en memoire (1 h), re-armee a 2 min a chaque demarrage du cycle auto
 * (connexion, changement de role, bascule de la preference) -> ~42 passages/jour/poste mesures.
 * Apres : date du dernier succes dans t_config (cle par site), echec -> essai espace
 * (1 h, 2 h, 4 h, 8 h max) sans mise a jour de la date de succes.
 *
 * Base SQLite en memoire (t_config seule), reseau et Supabase simules : aucun appel reseau.
 */

const mocks = vi.hoisted(() => ({
  db: null as import('better-sqlite3').Database | null,
  reconcile: vi.fn<(siteId: number, centreId: number | null) => Promise<import('../src/main/sync/cards-reconcile').ReconcileResult>>(),
  getPendingCardsCount: vi.fn(async () => 0)
}));

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('electron', () => ({
  app: { getPath: () => '.', isPackaged: false },
  net: { online: true, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));
vi.mock('../src/main/sync/network-monitor', () => ({
  networkMonitor: { getState: () => 'ONLINE', on: vi.fn(), start: vi.fn(), stop: vi.fn(), resetAndRetry: vi.fn() }
}));
vi.mock('../src/main/sync/outbox.service', () => ({
  processOutboxPending: vi.fn(), getOutboxPendingCount: vi.fn(() => 0),
  getOutboxActionableCount: vi.fn(() => 0), setCardsAutoUpstreamEnabled: vi.fn()
}));
vi.mock('../src/main/sync/upstream', () => ({ runUpstream: vi.fn() }));
vi.mock('../src/main/sync/downstream', () => ({
  runDownstream: vi.fn(), syncUsersFromCloud: vi.fn(), runSyncInitiale: vi.fn(),
  runLogsDownstream: vi.fn(), syncCurrentUserActiveStatus: vi.fn(),
  getPendingCardsCount: mocks.getPendingCardsCount, writeCardsChunkWithoutCursor: vi.fn()
}));
vi.mock('../src/main/sync/supabase-client', () => ({ getSupabaseClient: () => null }));
vi.mock('../src/main/sync/presence.service', () => ({ recordPresenceLogout: vi.fn() }));
vi.mock('../src/main/database/queries/maintenance.queries', () => ({ purgeEmptyRows: vi.fn() }));
vi.mock('../src/main/auth/session-heartbeat', () => ({
  refreshSecureCurrentUser: vi.fn(), getCurrentGrantedRoles: vi.fn(() => []),
  resolveCurrentSessionLogin: vi.fn(), stopSessionHeartbeat: vi.fn(),
  getSecureCurrentUser: vi.fn(() => ({ id_user: 1, site_id: 4, centre_id: 2, role: 'OPERATEUR_VERIFICATION' }))
}));
vi.mock('../src/main/database/connection', () => ({ getDatabase: () => mocks.db }));
vi.mock('../src/main/sync/cards-reconcile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/sync/cards-reconcile')>();
  return { ...actual, reconcileMissingCards: mocks.reconcile };
});

import {
  computeReconcileNextAt,
  readReconcileScheduleState,
  reconcileConfigKeys,
  reconcileRetryDelayMs,
  CARDS_RECONCILE_INITIAL_DELAY_MS,
  CARDS_RECONCILE_MIN_INTERVAL_MS,
  CARDS_RECONCILE_RETRY_BASE_MS,
  CARDS_RECONCILE_RETRY_MAX_MS,
  CARDS_RECONCILE_FUTURE_TOLERANCE_MS
} from '../src/main/sync/cards-reconcile';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const SITE = 4;
const OTHER_SITE = 9;
const T0 = Date.parse('2026-11-24T08:00:00.000Z');

/** Acces aux membres prives du moteur (meme approche que sync-cycle-outbox-sans-site.test.ts). */
interface EngineInternals {
  startAutoDownstreamTimer: (siteId: number) => void;
  stopAutoDownstreamTimer: () => void;
  triggerCardsShortSync: (siteId: number) => Promise<void>;
  cardsReconcileNextAt: number;
  isSyncing: boolean;
  isDownstreamRunning: boolean;
  isBulkUploading: boolean;
  globalSyncLocked: boolean;
}
let engine: EngineInternals;

function setNow(ms: number): void {
  vi.setSystemTime(ms);
}

/** Demarrage du cycle auto (login / changement de role / bascule de preference). */
function startCycle(siteId = SITE): void {
  engine.startAutoDownstreamTimer(siteId);
}

/** Deconnexion, changement de role ou desactivation de la preference : arret du cycle. */
function stopCycle(): void {
  engine.stopAutoDownstreamTimer();
}

async function tick(siteId = SITE): Promise<void> {
  await engine.triggerCardsShortSync(siteId);
}

function configValue(key: string): string | null {
  const row = mocks.db!.prepare('SELECT value FROM t_config WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  setNow(T0);
  mocks.db = new Database(':memory:');
  mocks.db.exec("CREATE TABLE t_config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')))");
  mocks.reconcile.mockReset();
  mocks.reconcile.mockResolvedValue({ status: 'ok', missingFound: 0, recovered: 0 });
  mocks.getPendingCardsCount.mockClear();
  const mod = await import('../src/main/sync/sync-engine');
  engine = mod.syncEngine as unknown as EngineInternals;
  engine.stopAutoDownstreamTimer();
  engine.isSyncing = false;
  engine.isDownstreamRunning = false;
  engine.isBulkUploading = false;
  engine.globalSyncLocked = false;
});

afterEach(() => {
  engine.stopAutoDownstreamTimer();
  mocks.db?.close();
  mocks.db = null;
  vi.useRealTimers();
});

describe('R1 — rattrapage au plus une fois par 22 h et par poste (sync-engine)', () => {
  it('poste neuf : premier passage apres le delai initial (2 min), pas avant', async () => {
    startCycle();
    setNow(T0 + 1 * MIN);
    await tick();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.getPendingCardsCount).toHaveBeenCalledTimes(1); // tick normal du cycle court

    setNow(T0 + CARDS_RECONCILE_INITIAL_DELAY_MS);
    await tick();
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    expect(mocks.reconcile).toHaveBeenCalledWith(SITE, 2);
    expect(configValue(reconcileConfigKeys(SITE).lastOk)).toBe(new Date(T0 + CARDS_RECONCILE_INITIAL_DELAY_MS).toISOString());
  });

  it('pas de second passage avant 22 h malgre reconnexions, changements de role et bascules', async () => {
    startCycle();
    setNow(T0 + 2 * MIN);
    await tick();
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    const okAt = T0 + 2 * MIN;

    // Reconnexion, changement de role, bascule off/on de la preference : chaque fois stop + start.
    for (const t of [5 * MIN, 30 * MIN, 1 * HOUR, 3 * HOUR, 12 * HOUR, 21 * HOUR]) {
      setNow(okAt + t);
      stopCycle();
      startCycle();
      expect(engine.cardsReconcileNextAt).toBe(okAt + CARDS_RECONCILE_MIN_INTERVAL_MS);
      setNow(okAt + t + 3 * MIN); // au-dela de l'ancien re-armement a 2 min
      await tick();
    }
    setNow(okAt + CARDS_RECONCILE_MIN_INTERVAL_MS - 1);
    await tick();
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
  });

  it('passage du apres 22 h (et nouvelle date de succes enregistree)', async () => {
    startCycle();
    setNow(T0 + 2 * MIN);
    await tick();
    const okAt = T0 + 2 * MIN;

    setNow(okAt + CARDS_RECONCILE_MIN_INTERVAL_MS);
    await tick();
    expect(mocks.reconcile).toHaveBeenCalledTimes(2);
    expect(configValue(reconcileConfigKeys(SITE).lastOk)).toBe(new Date(okAt + CARDS_RECONCILE_MIN_INTERVAL_MS).toISOString());
  });

  it('poste redemarre plus de 22 h apres le dernier succes : passage apres le delai initial', async () => {
    mocks.db!.prepare('INSERT INTO t_config (key, value) VALUES (?, ?)')
      .run(reconcileConfigKeys(SITE).lastOk, new Date(T0 - 30 * HOUR).toISOString());
    startCycle();
    expect(engine.cardsReconcileNextAt).toBe(T0 + CARDS_RECONCILE_INITIAL_DELAY_MS);
  });

  it('echec : date de succes inchangee, nouvel essai espace (1 h puis 2 h), meme apres reconnexion', async () => {
    const keys = reconcileConfigKeys(SITE);
    const oldOk = new Date(T0 - 25 * HOUR).toISOString();
    mocks.db!.prepare('INSERT INTO t_config (key, value) VALUES (?, ?)').run(keys.lastOk, oldOk);
    mocks.reconcile.mockResolvedValue({ status: 'error', missingFound: 0, recovered: 3, error: 'timeout' });

    startCycle();
    setNow(T0 + 2 * MIN);
    await tick();
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    expect(configValue(keys.lastOk)).toBe(oldOk); // un passage interrompu ne compte pas
    expect(configValue(keys.failCount)).toBe('1');
    const failAt = T0 + 2 * MIN;
    expect(engine.cardsReconcileNextAt).toBe(failAt + CARDS_RECONCILE_RETRY_BASE_MS);

    // Reconnexion 5 min plus tard : pas de rejeu immediat (ancien comportement : 2 min).
    setNow(failAt + 5 * MIN);
    stopCycle();
    startCycle();
    setNow(failAt + 10 * MIN);
    await tick();
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);

    // 1 h apres l'echec : nouvel essai, encore en echec -> 2 h.
    setNow(failAt + CARDS_RECONCILE_RETRY_BASE_MS);
    await tick();
    expect(mocks.reconcile).toHaveBeenCalledTimes(2);
    expect(configValue(keys.failCount)).toBe('2');
    const fail2At = failAt + CARDS_RECONCILE_RETRY_BASE_MS;
    expect(engine.cardsReconcileNextAt).toBe(fail2At + 2 * HOUR);
    setNow(fail2At + 2 * HOUR - 1);
    await tick();
    expect(mocks.reconcile).toHaveBeenCalledTimes(2);

    // Succes : compteur remis a zero, prochain passage a +22 h.
    mocks.reconcile.mockResolvedValue({ status: 'ok', missingFound: 0, recovered: 0 });
    setNow(fail2At + 2 * HOUR);
    await tick();
    expect(mocks.reconcile).toHaveBeenCalledTimes(3);
    expect(configValue(keys.failCount)).toBe('0');
    expect(configValue(keys.lastOk)).toBe(new Date(fail2At + 2 * HOUR).toISOString());
  });

  it('exception inattendue : traitee comme un echec (date de succes non ecrite)', async () => {
    mocks.reconcile.mockRejectedValue(new Error('boom'));
    startCycle();
    setNow(T0 + 2 * MIN);
    await tick();
    const keys = reconcileConfigKeys(SITE);
    expect(configValue(keys.lastOk)).toBeNull();
    expect(configValue(keys.failCount)).toBe('1');
    expect(engine.isDownstreamRunning).toBe(false);
    expect(engine.cardsReconcileNextAt).toBe(T0 + 2 * MIN + CARDS_RECONCILE_RETRY_BASE_MS);
  });

  it('table locale vide (skipped-empty-local) : ni succes ni echec, nouvel essai a 1 h', async () => {
    mocks.reconcile.mockResolvedValue({ status: 'skipped-empty-local', missingFound: 0, recovered: 0 });
    startCycle();
    setNow(T0 + 2 * MIN);
    await tick();
    const keys = reconcileConfigKeys(SITE);
    expect(configValue(keys.lastOk)).toBeNull();
    expect(configValue(keys.failCount)).toBeNull();
    expect(engine.cardsReconcileNextAt).toBe(T0 + 2 * MIN + CARDS_RECONCILE_RETRY_BASE_MS);
  });

  it('cle distincte par site : un succes sur le site 4 ne retarde pas le site 9', async () => {
    startCycle(SITE);
    setNow(T0 + 2 * MIN);
    await tick(SITE);
    expect(configValue(reconcileConfigKeys(SITE).lastOk)).not.toBeNull();
    expect(configValue(reconcileConfigKeys(OTHER_SITE).lastOk)).toBeNull();
    expect(reconcileConfigKeys(SITE).lastOk).toBe('cards_reconcile_last_ok_4');
    expect(reconcileConfigKeys(OTHER_SITE).lastOk).toBe('cards_reconcile_last_ok_9');

    setNow(T0 + 10 * MIN);
    stopCycle();
    startCycle(OTHER_SITE);
    expect(engine.cardsReconcileNextAt).toBe(T0 + 10 * MIN + CARDS_RECONCILE_INITIAL_DELAY_MS);
    setNow(T0 + 12 * MIN);
    await tick(OTHER_SITE);
    expect(mocks.reconcile).toHaveBeenCalledTimes(2);
    expect(mocks.reconcile).toHaveBeenLastCalledWith(OTHER_SITE, 2);

    // Retour sur le site 4 : son echeance de 22 h est conservee.
    stopCycle();
    startCycle(SITE);
    expect(engine.cardsReconcileNextAt).toBe(T0 + 2 * MIN + CARDS_RECONCILE_MIN_INTERVAL_MS);
  });

  it('verrou de synchro actif : pas de passage, ni ecriture t_config (reessai au tick suivant)', async () => {
    startCycle();
    setNow(T0 + 2 * MIN);
    engine.isSyncing = true;
    await tick();
    engine.isSyncing = false;
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(configValue(reconcileConfigKeys(SITE).lastTry)).toBeNull();
    await tick();
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
  });

  /** 3 jours, un demarrage par jour a 8 h et une session de 8 h (ticks toutes les 5 min). */
  async function threeWorkingDays(): Promise<void> {
    for (let day = 0; day < 3; day++) {
      const dayStart = T0 + day * 24 * HOUR;
      setNow(dayStart);
      startCycle();
      for (let t = 0; t <= 8 * HOUR; t += 5 * MIN) {
        setNow(dayStart + t);
        await tick();
      }
      stopCycle(); // poste eteint le soir
    }
  }

  it('P1-1 : succes enregistre dans le futur (horloge corrigee depuis) -> au moins un passage en 3 jours', async () => {
    mocks.db!.prepare('INSERT INTO t_config (key, value) VALUES (?, ?)')
      .run(reconcileConfigKeys(SITE).lastOk, new Date(T0 + 30 * 24 * HOUR).toISOString());
    await threeWorkingDays();
    expect(mocks.reconcile.mock.calls.length).toBeGreaterThanOrEqual(1);
    // La date future est remplacee par une date reelle apres le premier succes.
    expect(configValue(reconcileConfigKeys(SITE).lastOk)).not.toBe(new Date(T0 + 30 * 24 * HOUR).toISOString());
  });

  it('P1-1 : tentative enregistree dans le futur (compteur d\'echecs eleve) -> au moins un passage en 3 jours', async () => {
    const k = reconcileConfigKeys(SITE);
    mocks.db!.prepare('INSERT INTO t_config (key, value) VALUES (?, ?), (?, ?)')
      .run(k.lastTry, new Date(T0 + 30 * 24 * HOUR).toISOString(), k.failCount, '5');
    await threeWorkingDays();
    expect(mocks.reconcile.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('R1 — calcul de l\'echeance (fonctions pures)', () => {
  const NOW = T0;

  it('jamais execute : delai initial', () => {
    expect(computeReconcileNextAt({ lastOkMs: null, lastTryMs: null, failCount: 0 }, NOW)).toBe(NOW + CARDS_RECONCILE_INITIAL_DELAY_MS);
  });

  it('succes recent : +22 h ; succes ancien : delai initial', () => {
    expect(computeReconcileNextAt({ lastOkMs: NOW - HOUR, lastTryMs: NOW - HOUR - MIN, failCount: 0 }, NOW))
      .toBe(NOW - HOUR + CARDS_RECONCILE_MIN_INTERVAL_MS);
    expect(computeReconcileNextAt({ lastOkMs: NOW - 48 * HOUR, lastTryMs: null, failCount: 0 }, NOW))
      .toBe(NOW + CARDS_RECONCILE_INITIAL_DELAY_MS);
  });

  it('passage interrompu (tentative sans resultat, ex. application fermee) : +1 h', () => {
    expect(computeReconcileNextAt({ lastOkMs: NOW - 30 * HOUR, lastTryMs: NOW - 10 * MIN, failCount: 0 }, NOW))
      .toBe(NOW - 10 * MIN + CARDS_RECONCILE_RETRY_BASE_MS);
  });

  it('P1-1 : dates au-dela de la tolerance dans le futur -> traitees comme absentes', () => {
    const far = NOW + CARDS_RECONCILE_FUTURE_TOLERANCE_MS + 1;
    expect(computeReconcileNextAt({ lastOkMs: NOW + 10 * 24 * HOUR, lastTryMs: null, failCount: 0 }, NOW))
      .toBe(NOW + CARDS_RECONCILE_INITIAL_DELAY_MS);
    expect(computeReconcileNextAt({ lastOkMs: far, lastTryMs: null, failCount: 0 }, NOW))
      .toBe(NOW + CARDS_RECONCILE_INITIAL_DELAY_MS);
    expect(computeReconcileNextAt({ lastOkMs: null, lastTryMs: far, failCount: 4 }, NOW))
      .toBe(NOW + CARDS_RECONCILE_INITIAL_DELAY_MS);
    // Succes valide + tentative future ignoree : seule la borne du succes compte.
    expect(computeReconcileNextAt({ lastOkMs: NOW - 30 * HOUR, lastTryMs: far, failCount: 4 }, NOW))
      .toBe(NOW + CARDS_RECONCILE_INITIAL_DELAY_MS);
    // Succes futur ignore + tentative recente valide : delai d'essai applique.
    expect(computeReconcileNextAt({ lastOkMs: far, lastTryMs: NOW - 10 * MIN, failCount: 1 }, NOW))
      .toBe(NOW - 10 * MIN + CARDS_RECONCILE_RETRY_BASE_MS);
  });

  it('P1-1 : petit decalage dans la tolerance (5 min) -> date ramenee a maintenant', () => {
    expect(computeReconcileNextAt({ lastOkMs: NOW + 4 * MIN, lastTryMs: null, failCount: 0 }, NOW))
      .toBe(NOW + CARDS_RECONCILE_MIN_INTERVAL_MS);
    expect(computeReconcileNextAt({ lastOkMs: NOW + CARDS_RECONCILE_FUTURE_TOLERANCE_MS, lastTryMs: null, failCount: 0 }, NOW))
      .toBe(NOW + CARDS_RECONCILE_MIN_INTERVAL_MS);
  });

  it('P2-2 : intervalle minimal de 22 h', () => {
    expect(CARDS_RECONCILE_MIN_INTERVAL_MS).toBe(22 * HOUR);
  });

  it('delai de nouvel essai : 1 h, 2 h, 4 h, 8 h puis plafond 8 h', () => {
    expect(reconcileRetryDelayMs(0)).toBe(HOUR);
    expect(reconcileRetryDelayMs(1)).toBe(HOUR);
    expect(reconcileRetryDelayMs(2)).toBe(2 * HOUR);
    expect(reconcileRetryDelayMs(3)).toBe(4 * HOUR);
    expect(reconcileRetryDelayMs(4)).toBe(8 * HOUR);
    expect(reconcileRetryDelayMs(50)).toBe(CARDS_RECONCILE_RETRY_MAX_MS);
  });

  it('valeurs t_config illisibles : traitees comme absentes', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t_config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)');
    const k = reconcileConfigKeys(7);
    db.prepare('INSERT INTO t_config (key, value) VALUES (?, ?), (?, ?), (?, ?)')
      .run(k.lastOk, 'pas une date', k.lastTry, '', k.failCount, 'abc');
    expect(readReconcileScheduleState(db, 7)).toEqual({ lastOkMs: null, lastTryMs: null, failCount: 0 });
    db.close();
  });
});
