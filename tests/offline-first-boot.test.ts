import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

/**
 * Audit 2026-10-31 (P1-3) : poste neuf démarré hors ligne sans aucun compte actif.
 * Le rattrapage relance le préchargement des comptes au retour du réseau, une tentative à la fois,
 * et retire son écoute après succès (succès = au moins un compte actif en base).
 */

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { armOfflineBootUserRecovery } from '../src/main/auth/offline-first-boot';

function goOnline(net: EventEmitter, from = 'OFFLINE'): void {
  net.emit('change', { oldState: from, newState: 'ONLINE' });
}

describe('armOfflineBootUserRecovery', () => {
  let net: EventEmitter;
  let activeCount: number;
  let clock: number;

  beforeEach(() => {
    net = new EventEmitter();
    activeCount = 0;
    clock = 1_000_000;
  });

  const baseDeps = (preload: () => Promise<void>) => ({
    network: net,
    countActiveUsers: () => activeCount,
    preload,
    canPreload: () => true,
    minIntervalMs: 30_000,
    now: () => clock
  });

  it("n'arme rien si un compte actif existe déjà", () => {
    activeCount = 2;
    const preload = vi.fn(async () => undefined);
    const h = armOfflineBootUserRecovery(baseDeps(preload));
    expect(h.isArmed()).toBe(false);
    expect(net.listenerCount('change')).toBe(0);
  });

  it("n'arme rien sans client Supabase (E2E isolé / configuration absente)", () => {
    const preload = vi.fn(async () => undefined);
    const h = armOfflineBootUserRecovery({ ...baseDeps(preload), canPreload: () => false });
    expect(h.isArmed()).toBe(false);
    expect(net.listenerCount('change')).toBe(0);
  });

  it("n'arme rien si le comptage échoue (pas de présomption de poste vide)", () => {
    const preload = vi.fn(async () => undefined);
    const h = armOfflineBootUserRecovery({ ...baseDeps(preload), countActiveUsers: () => { throw new Error('db'); } });
    expect(h.isArmed()).toBe(false);
    expect(net.listenerCount('change')).toBe(0);
  });

  it('relance le préchargement au retour ONLINE et retire l\'écoute après succès', async () => {
    const preload = vi.fn(async () => { activeCount = 3; });
    const h = armOfflineBootUserRecovery(baseDeps(preload));
    expect(h.isArmed()).toBe(true);
    expect(net.listenerCount('change')).toBe(1);

    // Transitions non pertinentes : aucune tentative.
    net.emit('change', { oldState: 'OFFLINE', newState: 'PROBING' });
    net.emit('change', { oldState: 'PROBING', newState: 'PERMANENT_OFFLINE' });
    expect(preload).not.toHaveBeenCalled();

    goOnline(net, 'PROBING');
    await h.currentAttempt();
    expect(preload).toHaveBeenCalledTimes(1);
    expect(h.isArmed()).toBe(false);
    expect(net.listenerCount('change')).toBe(0);

    goOnline(net);
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it('une seule tentative à la fois (garde de concurrence)', async () => {
    let release!: () => void;
    const preload = vi.fn(() => new Promise<void>((resolve) => { release = () => { activeCount = 1; resolve(); }; }));
    const h = armOfflineBootUserRecovery({ ...baseDeps(preload), minIntervalMs: 0 });

    goOnline(net);
    goOnline(net, 'DEGRADED');
    goOnline(net, 'PROBING');
    expect(preload).toHaveBeenCalledTimes(1);

    release();
    await h.currentAttempt();
    expect(h.isArmed()).toBe(false);
  });

  it('échec (préchargement sans effet ou rejet) : reste armé et réessaie au passage ONLINE suivant, après le délai minimal', async () => {
    const preload = vi.fn()
      .mockImplementationOnce(async () => undefined) // erreur réseau avalée par preloadUsersFromCloud
      .mockImplementationOnce(async () => { throw new Error('fetch failed'); })
      .mockImplementationOnce(async () => { activeCount = 1; });
    const h = armOfflineBootUserRecovery(baseDeps(preload));

    goOnline(net);
    await h.currentAttempt();
    expect(preload).toHaveBeenCalledTimes(1);
    expect(h.isArmed()).toBe(true);

    // Oscillation rapide du réseau : ignorée pendant le délai minimal.
    clock += 10_000;
    goOnline(net);
    expect(preload).toHaveBeenCalledTimes(1);

    clock += 30_000;
    goOnline(net);
    await h.currentAttempt();
    expect(preload).toHaveBeenCalledTimes(2);
    expect(h.isArmed()).toBe(true);

    clock += 30_000;
    goOnline(net);
    await h.currentAttempt();
    expect(preload).toHaveBeenCalledTimes(3);
    expect(h.isArmed()).toBe(false);
    expect(net.listenerCount('change')).toBe(0);
  });

  it('se retire sans préchargement si des comptes sont arrivés par un autre chemin', () => {
    const preload = vi.fn(async () => undefined);
    const h = armOfflineBootUserRecovery(baseDeps(preload));
    activeCount = 1; // ex. sync:forceGlobal ou sync-engine entre-temps
    goOnline(net);
    expect(preload).not.toHaveBeenCalled();
    expect(h.isArmed()).toBe(false);
    expect(net.listenerCount('change')).toBe(0);
  });

  it('disarm est idempotent', () => {
    const h = armOfflineBootUserRecovery(baseDeps(vi.fn(async () => undefined)));
    h.disarm();
    h.disarm();
    expect(net.listenerCount('change')).toBe(0);
  });
});
