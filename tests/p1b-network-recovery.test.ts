import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * P1-B (audit Phase 1 du 27/09/2026) — une coupure réseau de ~90 s en pleine session faisait
 * passer NetworkMonitor en PERMANENT_OFFLINE et arrêtait définitivement le ping : plus aucune
 * synchro sans clic "Réessayer" ou redémarrage. Correctif : sonde de reprise unique, à backoff
 * exponentiel plafonné (1 → 2 → 4 → 8 → 10 min).
 *
 * Déterministe : horloge simulée (vi.useFakeTimers) et module 'electron' simulé — aucune requête
 * réseau réelle ne peut partir (net.request est un faux contrôlé par le test).
 */

// Ce fichier teste justement le comportement réseau : la garde E2E ne doit pas être active ici
// (process.env peut être partagé entre fichiers dans un même processus de test).
delete process.env.GEST_IN_SITU_E2E_DISABLE_SYNC;

const netState = { online: true, reachable: true, requests: 0 };

vi.mock('electron', () => ({
  net: {
    get online() { return netState.online; },
    request: vi.fn(() => {
      netState.requests++;
      const handlers: Record<string, (arg?: any) => void> = {};
      return {
        on: (evt: string, cb: (arg?: any) => void) => { handlers[evt] = cb; },
        abort: () => {},
        end: () => {
          const ok = netState.reachable;
          Promise.resolve().then(() => ok ? handlers.response?.({ statusCode: 401 }) : handlers.error?.(new Error('ENOTFOUND')));
        }
      };
    })
  }
}));

describe('NetworkMonitor — reprise automatique après PERMANENT_OFFLINE (P1-B)', () => {
  let monitor: import('../src/main/sync/network-monitor').NetworkMonitor;
  let transitions: string[];
  let permanentAt = 0;

  beforeEach(async () => {
    vi.useFakeTimers();
    netState.online = true; netState.reachable = true; netState.requests = 0;
    const mod = await import('../src/main/sync/network-monitor');
    monitor = new mod.NetworkMonitor();
    transitions = [];
    monitor.on('change', ({ newState }) => {
      transitions.push(newState);
      if (newState === 'PERMANENT_OFFLINE') permanentAt = Date.now();
    });
  });

  afterEach(() => {
    monitor.stop();
    vi.useRealTimers();
  });

  async function reachOnline() {
    monitor.start();
    await vi.advanceTimersByTimeAsync(5_000); // premier ping différé de 5 s
    expect(monitor.getState()).toBe('ONLINE');
  }

  async function cutUntilPermanentOffline() {
    netState.reachable = false;
    for (let i = 0; i < 4 && monitor.getState() !== 'PERMANENT_OFFLINE'; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(monitor.getState()).toBe('PERMANENT_OFFLINE');
  }

  it('ONLINE → coupure → PERMANENT_OFFLINE → réseau rétabli → retour ONLINE sans action utilisateur', async () => {
    await reachOnline();
    await cutUntilPermanentOffline();
    expect(transitions).toEqual(['PROBING', 'ONLINE', 'DEGRADED', 'PERMANENT_OFFLINE']);

    netState.reachable = true;
    const avant = netState.requests;
    const ecoule = Date.now() - permanentAt; // temps déjà écoulé depuis la bascule (fin du pas de 30 s)
    await vi.advanceTimersByTimeAsync(59_000 - ecoule);
    expect(netState.requests).toBe(avant); // aucune sonde avant 1 min : pas de boucle agressive
    await vi.advanceTimersByTimeAsync(1_000);
    expect(monitor.getState()).toBe('ONLINE');
    expect(transitions.at(-1)).toBe('ONLINE');

    // Le ping régulier a repris : une nouvelle coupure est de nouveau détectée.
    netState.reachable = false;
    await vi.advanceTimersByTimeAsync(35_000);
    expect(monitor.getState()).toBe('DEGRADED');
  });

  it('panne prolongée (1 h) : sondes espacées 1/2/4/8/10/10… min, jamais de rafale', async () => {
    await reachOnline();
    await cutUntilPermanentOffline();
    const avant = netState.requests;
    expect(monitor.getNextRecoveryDelayMs()).toBe(2 * 60_000); // la 1ʳᵉ sonde (60 s) est déjà planifiée

    await vi.advanceTimersByTimeAsync(60 * 60_000);
    const sondes = netState.requests - avant;
    // Échéances cumulées : 1, 3, 7, 15, 25, 35, 45, 55 min → 8 sondes en 1 h (contre 120 pings à 30 s).
    expect(sondes).toBe(8);
    expect(monitor.getNextRecoveryDelayMs()).toBe(10 * 60_000); // plafond atteint
    expect(monitor.getState()).toBe('PERMANENT_OFFLINE');
  });

  it('sans réseau local (net.online=false) : aucune requête HTTP n\'est émise par la sonde', async () => {
    await reachOnline();
    await cutUntilPermanentOffline();
    netState.online = false;
    const avant = netState.requests;
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(netState.requests).toBe(avant);
    expect(monitor.getState()).toBe('PERMANENT_OFFLINE');
  });

  it('"Réessayer" manuel annule la sonde planifiée (pas de double ping)', async () => {
    await reachOnline();
    await cutUntilPermanentOffline();
    netState.reachable = true;
    const etat = await monitor.resetAndRetry();
    expect(etat).toBe('ONLINE');
    const avant = netState.requests;
    await vi.advanceTimersByTimeAsync(60_000); // l'ancienne sonde de 60 s ne doit plus partir
    // Seuls les pings réguliers du moniteur relancé (5 s + 30 s + 30 s) peuvent avoir eu lieu.
    expect(netState.requests - avant).toBeLessThanOrEqual(3);
  });
});
