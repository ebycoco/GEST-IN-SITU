import { describe, expect, it } from 'vitest';
import { IDLE_TIMEOUT_MS, IdleClock } from '../src/lib/idleLock';

function horloge(debut = 1_000_000) {
  let t = debut;
  return { now: () => t, avance: (ms: number) => { t += ms; } };
}

describe('verrou d\'inactivite (15 min)', () => {
  it('delai par defaut = 15 minutes', () => {
    expect(IDLE_TIMEOUT_MS).toBe(900_000);
  });
  it('se verrouille a 15 min sans activite, pas avant', () => {
    const h = horloge();
    const c = new IdleClock(IDLE_TIMEOUT_MS, h.now);
    h.avance(IDLE_TIMEOUT_MS - 1);
    expect(c.shouldLock()).toBe(false);
    h.avance(1);
    expect(c.shouldLock()).toBe(true);
  });
  it('une activite repart de zero', () => {
    const h = horloge();
    const c = new IdleClock(IDLE_TIMEOUT_MS, h.now);
    h.avance(14 * 60_000);
    c.touch();
    h.avance(14 * 60_000);
    expect(c.shouldLock()).toBe(false);
    expect(c.remainingMs()).toBe(60_000);
  });
  it('retour d\'arriere-plan apres 20 min : verrou immediat (pas de minuterie requise)', () => {
    const h = horloge();
    const c = new IdleClock(IDLE_TIMEOUT_MS, h.now);
    h.avance(20 * 60_000);
    expect(c.shouldLock()).toBe(true);
    expect(c.remainingMs()).toBe(0);
  });
  it('jamais pendant un envoi ; la reprise compte comme activite', () => {
    const h = horloge();
    const c = new IdleClock(IDLE_TIMEOUT_MS, h.now);
    c.setSuspended(true);
    h.avance(30 * 60_000);
    expect(c.shouldLock()).toBe(false);
    c.setSuspended(false);
    expect(c.shouldLock()).toBe(false);
    h.avance(IDLE_TIMEOUT_MS);
    expect(c.shouldLock()).toBe(true);
  });
});
