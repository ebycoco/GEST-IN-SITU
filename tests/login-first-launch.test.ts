import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeNetworkState,
  shouldShowOfflineBanner,
  startBoundedPoll
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
