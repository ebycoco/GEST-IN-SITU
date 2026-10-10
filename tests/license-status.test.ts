import { describe, it, expect } from 'vitest';
import { computeLicenseStatus } from '../src/shared/utils/license';

const DAY = 86400000;
const NOW = new Date('2026-10-10T08:00:00.000Z');
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

describe('computeLicenseStatus', () => {
  it.each([[1], [true], ['1']])('permanent pour is_permanent=%s', (v) => {
    expect(computeLicenseStatus(at(DAY), v, NOW)).toEqual({ state: 'permanent', daysLeft: null });
  });

  it.each([[null], [''], [undefined], ['   ']])('undefined pour date=%s', (d) => {
    expect(computeLicenseStatus(d as string | null | undefined, 0, NOW)).toEqual({ state: 'undefined', daysLeft: null });
  });

  it('invalid pour une date non parsable', () => {
    expect(computeLicenseStatus('pas-une-date', 0, NOW)).toEqual({ state: 'invalid', daysLeft: null });
  });

  it('expired 1 ms après l\'échéance', () => {
    expect(computeLicenseStatus(at(-1), 0, NOW).state).toBe('expired');
  });

  it('exactement à l\'échéance : non expiré, 0 jour, critical', () => {
    expect(computeLicenseStatus(at(0), 0, NOW)).toEqual({ state: 'critical', daysLeft: 0 });
  });

  it('+1 jour', () => {
    expect(computeLicenseStatus(at(DAY), 0, NOW)).toEqual({ state: 'critical', daysLeft: 1 });
  });

  it('+7 j critical, +8 j warning, +30 j warning, +31 j ok', () => {
    expect(computeLicenseStatus(at(7 * DAY), 0, NOW)).toEqual({ state: 'critical', daysLeft: 7 });
    expect(computeLicenseStatus(at(8 * DAY), 0, NOW)).toEqual({ state: 'warning', daysLeft: 8 });
    expect(computeLicenseStatus(at(30 * DAY), 0, NOW)).toEqual({ state: 'warning', daysLeft: 30 });
    expect(computeLicenseStatus(at(31 * DAY), 0, NOW)).toEqual({ state: 'ok', daysLeft: 31 });
  });

  it('accepte une valeur ISO avec heure (arrondi supérieur)', () => {
    expect(computeLicenseStatus('2026-10-20T00:00:00.000Z', 0, NOW)).toEqual({ state: 'warning', daysLeft: 10 });
  });

  it('daysLeft cohérent avec Math.ceil de la bannière session-heartbeat', () => {
    for (const ms of [1, DAY - 1, DAY, DAY + 1, 3 * DAY - 5000, 12.5 * DAY]) {
      const expiry = at(ms);
      const banner = Math.ceil((new Date(expiry).getTime() - NOW.getTime()) / (1000 * 3600 * 24));
      expect(computeLicenseStatus(expiry, 0, NOW).daysLeft).toBe(banner);
    }
  });

  it('ne lève jamais d\'exception (now invalide)', () => {
    expect(() => computeLicenseStatus(at(DAY), 0, new Date('x'))).not.toThrow();
    expect(computeLicenseStatus(at(DAY), 0, new Date('x')).state).toBe('invalid');
  });
});
