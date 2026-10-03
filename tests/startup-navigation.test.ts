import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  loadInitialNavigation,
  isNetworkServiceLossError,
  STARTUP_NAVIGATION_RECOVERY_DELAY_MS
} from '../src/main/startup-navigation';

/**
 * Navigation initiale de la fenêtre principale (audit démarrage du 03/10/2026) : après un blocage
 * > 15 s du processus principal, le Network Service s'arrête et le premier loadURL est rejeté avec
 * ERR_FAILED (-2) ; sans récupération, la fenêtre restait sur about:blank.
 *
 * L'erreur simulée reproduit la forme réelle observée sous Electron 34 (code + errno).
 */
function electronLoadError(code: string, errno: number): Error {
  return Object.assign(new Error(`${code} (${errno}) loading 'http://localhost:5173'`), { code, errno, url: 'http://localhost:5173' });
}

function makeDeps(canRetry = true) {
  const lines: string[] = [];
  const push = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  const wait = vi.fn(async (_ms: number) => {});
  return { deps: { log: { info: push, warn: push, error: push }, canRetry: vi.fn(() => canRetry), wait }, lines, wait };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('loadInitialNavigation — navigation initiale de la fenêtre principale', () => {
  it('cas 1 : le premier chargement réussit → aucune nouvelle tentative', async () => {
    const load = vi.fn(async () => {});
    const { deps, lines, wait } = makeDeps();

    await expect(loadInitialNavigation(load, deps)).resolves.toBe('loaded');
    expect(load).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    expect(lines.some((l) => l.includes('recovery'))).toBe(false);
  });

  it('cas 2 : ERR_FAILED (-2) initial → une seule récupération, qui réussit', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(electronLoadError('ERR_FAILED', -2))
      .mockResolvedValueOnce(undefined);
    const { deps, lines, wait } = makeDeps();

    await expect(loadInitialNavigation(load, deps)).resolves.toBe('recovered');
    expect(load).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(STARTUP_NAVIGATION_RECOVERY_DELAY_MS);
    expect(lines.filter((l) => l.includes('attempting one recovery navigation'))).toHaveLength(1);
    expect(lines.some((l) => l.includes('recovery navigation succeeded'))).toBe(true);
  });

  it('cas 3 : double échec → la séquence s’arrête, pas de troisième tentative, aucune exception', async () => {
    const load = vi.fn(async () => { throw electronLoadError('ERR_FAILED', -2); });
    const { deps, lines } = makeDeps();

    await expect(loadInitialNavigation(load, deps)).resolves.toBe('failed');
    expect(load).toHaveBeenCalledTimes(2);
    expect(lines.some((l) => l.includes('recovery navigation failed'))).toBe(true);
  });

  it('cas 4 : autre erreur (ex. ERR_CONNECTION_REFUSED, ERR_ABORTED) → aucune récupération', async () => {
    for (const [code, errno] of [['ERR_CONNECTION_REFUSED', -102], ['ERR_ABORTED', -3]] as const) {
      const load = vi.fn(async () => { throw electronLoadError(code, errno); });
      const { deps, wait } = makeDeps();

      await expect(loadInitialNavigation(load, deps)).resolves.toBe('failed');
      expect(load).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    }
    expect(isNetworkServiceLossError(new Error('ERR_FAILED'))).toBe(false); // message seul, sans code/errno
    expect(isNetworkServiceLossError(null)).toBe(false);
  });

  it('cas 5 : une navigation ultérieure qui échoue ne déclenche aucune récupération', async () => {
    // La récupération est portée uniquement par l'appel initial (aucun écouteur, aucun état conservé) :
    // une fois la séquence initiale terminée, un échec de navigation ultérieur n'est pas rejoué.
    const load = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(electronLoadError('ERR_FAILED', -2));
    const { deps, wait } = makeDeps();

    await expect(loadInitialNavigation(load, deps)).resolves.toBe('loaded');
    await expect(load()).rejects.toMatchObject({ code: 'ERR_FAILED' }); // navigation ultérieure simulée
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);
    expect(wait).not.toHaveBeenCalled();
  });

  it('fenêtre détruite pendant l’attente → aucune nouvelle tentative', async () => {
    const load = vi.fn(async () => { throw electronLoadError('ERR_FAILED', -2); });
    const { deps, lines } = makeDeps(false);

    await expect(loadInitialNavigation(load, deps)).resolves.toBe('failed');
    expect(load).toHaveBeenCalledTimes(1);
    expect(lines.some((l) => l.includes('recovery navigation skipped'))).toBe(true);
  });

  it('attente par défaut : un seul délai borné de 1 500 ms avant l’unique nouvelle tentative', async () => {
    vi.useFakeTimers();
    const load = vi.fn()
      .mockRejectedValueOnce(electronLoadError('ERR_FAILED', -2))
      .mockResolvedValueOnce(undefined);
    const { deps } = makeDeps();
    const run = loadInitialNavigation(load, { log: deps.log, canRetry: deps.canRetry });

    await vi.advanceTimersByTimeAsync(STARTUP_NAVIGATION_RECOVERY_DELAY_MS - 1);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(run).resolves.toBe('recovered');
    expect(load).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
