import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  canAutoRetry,
  normalizeNetworkState,
  recordAttempt,
  runFirstLaunchSetup,
  shouldShowOfflineBanner,
  startBoundedPoll,
  type AutoRetryState,
  type FirstLaunchSetupDeps
} from '../src/renderer/src/pages/loginFirstLaunch';

describe('normalizeNetworkState', () => {
  it.each([
    ['ONLINE', 'online'],
    ['online', 'online'],
    ['connected', 'online'],
    ['DEGRADED', 'online'],
    ['PROBING', 'unknown'],
    ['OFFLINE', 'offline'],
    ['PERMANENT_OFFLINE', 'offline'],
    [undefined, 'unknown'],
    [null, 'unknown'],
    [42, 'unknown'],
    ['??', 'unknown']
  ])('%s -> %s', (input, expected) => {
    expect(normalizeNetworkState(input)).toBe(expected);
  });
});

describe('shouldShowOfflineBanner', () => {
  const base = { isOnline: false, setupStatus: 'failed' as const, navigatorOnLine: true, mainNetworkKind: null };
  it('en ligne -> jamais de bandeau hors-ligne', () => {
    expect(shouldShowOfflineBanner({ ...base, isOnline: true })).toBe(false);
  });
  it('échec de config alors que le réseau est en ligne -> le message de config prime', () => {
    expect(shouldShowOfflineBanner(base)).toBe(false);
  });
  it('vrai hors-ligne (navigator.onLine false) conservé', () => {
    expect(shouldShowOfflineBanner({ ...base, navigatorOnLine: false })).toBe(true);
  });
  it('vrai hors-ligne (état OFFLINE du main) conservé', () => {
    expect(shouldShowOfflineBanner({ ...base, mainNetworkKind: 'offline' })).toBe(true);
  });
  it('hors-ligne hors échec de config (pulling) conservé', () => {
    expect(shouldShowOfflineBanner({ ...base, setupStatus: 'pulling' })).toBe(true);
  });
});

describe('startBoundedPoll', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('succès au 3e essai', async () => {
    const check = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const onDone = vi.fn();
    startBoundedPoll({ check, onDone, intervalMs: 1500, timeoutMs: 60000 });
    await vi.advanceTimersByTimeAsync(1500 * 3);
    expect(check).toHaveBeenCalledTimes(3);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith('success');
    await vi.advanceTimersByTimeAsync(10000);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('échec après le délai (40 essais pour 60 s / 1,5 s)', async () => {
    const check = vi.fn().mockResolvedValue(false);
    const onDone = vi.fn();
    startBoundedPoll({ check, onDone, intervalMs: 1500, timeoutMs: 60000 });
    await vi.advanceTimersByTimeAsync(58000);
    expect(onDone).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(check).toHaveBeenCalledTimes(40);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith('timeout');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('un check qui rejette compte comme un essai raté', async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(true);
    const onDone = vi.fn();
    startBoundedPoll({ check, onDone, intervalMs: 1000, timeoutMs: 10000 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(onDone).toHaveBeenCalledWith('success');
  });

  it('annulation propre : aucun nouvel appel ni onDone, aucun timer restant', async () => {
    const check = vi.fn().mockResolvedValue(false);
    const onDone = vi.fn();
    const cancel = startBoundedPoll({ check, onDone, intervalMs: 1500, timeoutMs: 60000 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(check).toHaveBeenCalledTimes(1);
    cancel();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120000);
    expect(check).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('annulation pendant un check en vol : résultat ignoré', async () => {
    let resolveCheck: (v: boolean) => void = () => undefined;
    const check = vi.fn(() => new Promise<boolean>((r) => { resolveCheck = r; }));
    const onDone = vi.fn();
    const cancel = startBoundedPoll({ check, onDone, intervalMs: 1500, timeoutMs: 60000 });
    await vi.advanceTimersByTimeAsync(1500);
    cancel();
    resolveCheck(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onDone).not.toHaveBeenCalled();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('pas de cumul au redéclenchement (annuler l\'ancien avant de relancer)', async () => {
    const checkA = vi.fn().mockResolvedValue(false);
    const checkB = vi.fn().mockResolvedValue(false);
    const cancelA = startBoundedPoll({ check: checkA, onDone: vi.fn(), intervalMs: 1500, timeoutMs: 60000 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(checkA).toHaveBeenCalledTimes(2);
    cancelA();
    startBoundedPoll({ check: checkB, onDone: vi.fn(), intervalMs: 1500, timeoutMs: 60000 });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(checkA).toHaveBeenCalledTimes(2);
    expect(checkB).toHaveBeenCalledTimes(2);
  });
});

describe('canAutoRetry / recordAttempt (planificateur de redéclenchement auto)', () => {
  const fresh: AutoRetryState = { attempts: 0, lastAttemptAt: null };
  it('première tentative autorisée', () => {
    expect(canAutoRetry(fresh, 1000)).toBe(true);
  });
  it('refuse avant le délai minimal de 10 s, accepte après', () => {
    const st = recordAttempt(fresh, 1000, true);
    expect(canAutoRetry(st, 5000)).toBe(false);
    expect(canAutoRetry(st, 11000)).toBe(true);
  });
  it('plafond de 5 tentatives automatiques', () => {
    let st = fresh;
    for (let i = 0; i < 5; i++) st = recordAttempt(st, i * 20000, true);
    expect(canAutoRetry(st, 10_000_000)).toBe(false);
  });
  it('une tentative manuelle ne consomme pas le plafond mais avance l horodatage', () => {
    const st = recordAttempt(fresh, 1000, false);
    expect(st.attempts).toBe(0);
    expect(canAutoRetry(st, 2000)).toBe(false);
  });
  it('simulation 90 s d événements ONLINE chaque seconde : <= 5 tentatives espacées de >= 10 s', () => {
    let st = fresh;
    const starts: number[] = [];
    for (let t = 0; t <= 90000; t += 1000) {
      if (canAutoRetry(st, t)) { st = recordAttempt(st, t, true); starts.push(t); }
    }
    expect(starts.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(10000);
  });
});

describe('runFirstLaunchSetup', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  const make = (over: Partial<FirstLaunchSetupDeps> = {}) => {
    const deps = {
      forcePing: vi.fn().mockResolvedValue({ success: true, state: 'ONLINE' }),
      forceGlobal: vi.fn().mockResolvedValue(undefined),
      checkFirstLaunch: vi.fn().mockResolvedValue({ isFirstLaunch: true }),
      onConfigured: vi.fn(),
      onFailed: vi.fn(),
      intervalMs: 1500,
      timeoutMs: 60000,
      ...over
    } satisfies FirstLaunchSetupDeps;
    return deps;
  };

  it('forceGlobal qui retourne undefined n est PAS un échec : le sondage décide (succès au 3e essai)', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const deps = make();
    deps.checkFirstLaunch
      .mockResolvedValueOnce({ isFirstLaunch: true })   // contrôle initial
      .mockResolvedValueOnce({ isFirstLaunch: true })   // après forceGlobal
      .mockResolvedValueOnce({ isFirstLaunch: true })   // sondage 1
      .mockResolvedValueOnce({ isFirstLaunch: false }); // sondage 2
    runFirstLaunchSetup(deps);
    await vi.advanceTimersByTimeAsync(3100);
    expect(deps.onFailed).not.toHaveBeenCalled();
    expect(deps.onConfigured).toHaveBeenCalledTimes(1);
  });

  it('forceGlobal qui lève « Session invalide » n est pas un échec (impasse corrigée)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const deps = make({ forceGlobal: vi.fn().mockRejectedValue(new Error('Accès refusé. Session invalide.')) });
    deps.checkFirstLaunch
      .mockResolvedValueOnce({ isFirstLaunch: true })
      .mockResolvedValueOnce({ isFirstLaunch: false }); // comptes arrivés pendant forceGlobal
    runFirstLaunchSetup(deps);
    await vi.advanceTimersByTimeAsync(10);
    expect(deps.onConfigured).toHaveBeenCalledTimes(1);
    expect(deps.onFailed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sortie d impasse immédiate : base déjà remplie => aucun ping ni forceGlobal', async () => {
    const deps = make({ checkFirstLaunch: vi.fn().mockResolvedValue({ isFirstLaunch: false }) });
    runFirstLaunchSetup(deps);
    await vi.advanceTimersByTimeAsync(10);
    expect(deps.onConfigured).toHaveBeenCalledTimes(1);
    expect(deps.forcePing).not.toHaveBeenCalled();
    expect(deps.forceGlobal).not.toHaveBeenCalled();
  });

  it('forcePing OFFLINE => échec unreachable, sans forceGlobal ni sondage', async () => {
    const deps = make({ forcePing: vi.fn().mockResolvedValue({ success: true, state: 'OFFLINE' }) });
    runFirstLaunchSetup(deps);
    await vi.advanceTimersByTimeAsync(10);
    expect(deps.onFailed).toHaveBeenCalledWith('unreachable');
    expect(deps.forceGlobal).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forcePing qui lève => échec network_error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const deps = make({ forcePing: vi.fn().mockRejectedValue(new Error('x')) });
    runFirstLaunchSetup(deps);
    await vi.advanceTimersByTimeAsync(10);
    expect(deps.onFailed).toHaveBeenCalledWith('network_error');
  });

  it('cloud vide, réseau en ligne : échec no_accounts après 60 s, appels bornés (pas de tempête)', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const deps = make();
    runFirstLaunchSetup(deps);
    await vi.advanceTimersByTimeAsync(90000);
    expect(deps.onFailed).toHaveBeenCalledTimes(1);
    expect(deps.onFailed).toHaveBeenCalledWith('no_accounts');
    expect(deps.forcePing).toHaveBeenCalledTimes(1);
    expect(deps.forceGlobal).toHaveBeenCalledTimes(1);
    // 1 contrôle initial + 1 après forceGlobal + 40 essais de sondage
    expect(deps.checkFirstLaunch).toHaveBeenCalledTimes(42);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('annulation : aucun callback ni nouvel appel', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const deps = make();
    const cancel = runFirstLaunchSetup(deps);
    await vi.advanceTimersByTimeAsync(3100);
    cancel();
    const calls = deps.checkFirstLaunch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120000);
    expect(deps.checkFirstLaunch).toHaveBeenCalledTimes(calls);
    expect(deps.onConfigured).not.toHaveBeenCalled();
    expect(deps.onFailed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('simulation de la boucle de la page : événements ONLINE chaque seconde pendant 90 s => runs bornés', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const deps = make();
    let state: AutoRetryState = { attempts: 0, lastAttemptAt: null };
    let running = false;
    for (let t = 0; t < 90; t++) {
      if (!running && canAutoRetry(state, Date.now())) {
        state = recordAttempt(state, Date.now(), true);
        running = true;
        runFirstLaunchSetup({ ...deps, onFailed: (r) => { running = false; deps.onFailed(r); } });
      }
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(deps.forcePing.mock.calls.length).toBeLessThanOrEqual(2);
    expect(deps.checkFirstLaunch.mock.calls.length).toBeLessThanOrEqual(2 * 42);
  });
});
