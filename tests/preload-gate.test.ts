import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Re-audit 2026-10-31 (P1-D) : la porte de préchargement désactive la connexion jusqu'à la fin du
 * préchargement de démarrage (seul moment où les ids de site / centre sont réalignés), 20 s max.
 */

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe('preload-gate', () => {
  let gate: typeof import('../src/main/auth/preload-gate');

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    gate = await import('../src/main/auth/preload-gate');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ouverte puis fermée à la fin du préchargement, notifications true puis false une seule fois', () => {
    const notify = vi.fn();
    expect(gate.isPreloadGateOpen()).toBe(false);
    const close = gate.openPreloadGate(notify);
    expect(gate.isPreloadGateOpen()).toBe(true);
    close();
    close();
    expect(gate.isPreloadGateOpen()).toBe(false);
    expect(notify.mock.calls).toEqual([[true], [false]]);
  });

  it('fermée automatiquement au plafond (réseau lent) ; la fermeture tardive est sans effet', () => {
    const notify = vi.fn();
    const close = gate.openPreloadGate(notify, 20000);
    vi.advanceTimersByTime(19999);
    expect(gate.isPreloadGateOpen()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(gate.isPreloadGateOpen()).toBe(false);
    close();
    expect(notify.mock.calls).toEqual([[true], [false]]);
  });

  it('une ouverture plus récente n\'est pas fermée par l\'ancienne', () => {
    const n1 = vi.fn();
    const n2 = vi.fn();
    const close1 = gate.openPreloadGate(n1);
    const close2 = gate.openPreloadGate(n2);
    close1();
    expect(gate.isPreloadGateOpen()).toBe(true);
    expect(n1.mock.calls).toEqual([[true]]);
    close2();
    expect(gate.isPreloadGateOpen()).toBe(false);
  });
});
