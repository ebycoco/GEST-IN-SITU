import { describe, it, expect } from 'vitest';
import {
  computeLicenseStatus,
  getLicenseDaysLeft,
  getLicenseLimitMs,
  isLicenseExpired
} from '../src/shared/utils/license';

/**
 * Règle A1 : la date d'échéance est le DERNIER JOUR utilisable (jour calendaire UTC) ; la licence
 * ne s'arrête qu'au lendemain 00:00:00.000 UTC. daysLeft = jours calendaires UTC.
 */
const DAY = 86400000;
const EXPIRY = '2026-10-10T00:00:00.000Z'; // saisie SitesPage : new Date('2026-10-10').toISOString()
const NOW = new Date('2026-10-10T08:00:00.000Z');
/** Échéance = jour UTC de NOW + n jours (minuit UTC, comme SitesPage). */
const expiryPlusDays = (n: number) => new Date(Date.UTC(2026, 9, 10 + n)).toISOString();

describe('computeLicenseStatus (règle A1)', () => {
  it.each([[1], [true], ['1']])('permanent pour is_permanent=%s', (v) => {
    expect(computeLicenseStatus(EXPIRY, v, NOW)).toEqual({ state: 'permanent', daysLeft: null });
  });

  it.each([[null], [''], [undefined], ['   ']])('undefined pour date=%s', (d) => {
    expect(computeLicenseStatus(d as string | null | undefined, 0, NOW)).toEqual({ state: 'undefined', daysLeft: null });
  });

  it('invalid (non bloquant) pour une date non parsable', () => {
    expect(computeLicenseStatus('pas-une-date', 0, NOW)).toEqual({ state: 'invalid', daysLeft: null });
    expect(isLicenseExpired('pas-une-date', NOW)).toBe(false);
  });

  it('jour J 08:00 UTC : NON expiré, daysLeft 0, critical', () => {
    expect(computeLicenseStatus(EXPIRY, 0, new Date('2026-10-10T08:00:00.000Z'))).toEqual({ state: 'critical', daysLeft: 0 });
  });

  it('jour J 00:00:00.000 UTC : non expiré, daysLeft 0', () => {
    expect(computeLicenseStatus(EXPIRY, 0, new Date('2026-10-10T00:00:00.000Z'))).toEqual({ state: 'critical', daysLeft: 0 });
  });

  it('jour J 23:59:59.999 UTC : toujours non expiré', () => {
    expect(computeLicenseStatus(EXPIRY, 0, new Date('2026-10-10T23:59:59.999Z'))).toEqual({ state: 'critical', daysLeft: 0 });
  });

  it('lendemain 00:00:00.000 UTC : expiré', () => {
    const r = computeLicenseStatus(EXPIRY, 0, new Date('2026-10-11T00:00:00.000Z'));
    expect(r.state).toBe('expired');
    expect(r.daysLeft).toBeLessThan(0);
  });

  it('la veille (09/10) : daysLeft 1, quelle que soit l\'heure', () => {
    expect(computeLicenseStatus(EXPIRY, 0, new Date('2026-10-09T00:00:00.000Z'))).toEqual({ state: 'critical', daysLeft: 1 });
    expect(computeLicenseStatus(EXPIRY, 0, new Date('2026-10-09T23:59:59.999Z'))).toEqual({ state: 'critical', daysLeft: 1 });
  });

  it('+7 j critical, +8 j warning, +30 j warning, +31 j ok (jours calendaires)', () => {
    expect(computeLicenseStatus(expiryPlusDays(7), 0, NOW)).toEqual({ state: 'critical', daysLeft: 7 });
    expect(computeLicenseStatus(expiryPlusDays(8), 0, NOW)).toEqual({ state: 'warning', daysLeft: 8 });
    expect(computeLicenseStatus(expiryPlusDays(30), 0, NOW)).toEqual({ state: 'warning', daysLeft: 30 });
    expect(computeLicenseStatus(expiryPlusDays(31), 0, NOW)).toEqual({ state: 'ok', daysLeft: 31 });
  });

  it('valeur avec heure non nulle (15:30Z) : seul le jour UTC compte', () => {
    const iso = '2026-10-10T15:30:00.000Z';
    expect(computeLicenseStatus(iso, 0, new Date('2026-10-10T20:00:00.000Z'))).toEqual({ state: 'critical', daysLeft: 0 });
    expect(computeLicenseStatus(iso, 0, new Date('2026-10-10T23:59:59.999Z')).state).toBe('critical');
    expect(computeLicenseStatus(iso, 0, new Date('2026-10-11T00:00:00.000Z')).state).toBe('expired');
  });

  it('accepte une date simple YYYY-MM-DD', () => {
    expect(computeLicenseStatus('2026-10-20', 0, NOW)).toEqual({ state: 'warning', daysLeft: 10 });
  });

  it('ne lève jamais d\'exception (now invalide)', () => {
    expect(() => computeLicenseStatus(EXPIRY, 0, new Date('x'))).not.toThrow();
    expect(computeLicenseStatus(EXPIRY, 0, new Date('x')).state).toBe('invalid');
  });
});

describe('helpers de licence (règle A1)', () => {
  it('getLicenseLimitMs : 00:00 UTC du lendemain du jour d\'échéance', () => {
    expect(getLicenseLimitMs(EXPIRY)).toBe(Date.UTC(2026, 9, 11));
    expect(getLicenseLimitMs('2026-10-10T23:59:59.999Z')).toBe(Date.UTC(2026, 9, 11));
    expect(getLicenseLimitMs('2026-10-31T10:00:00Z')).toBe(Date.UTC(2026, 10, 1));
  });

  it('getLicenseLimitMs : null si non parsable / vide', () => {
    expect(getLicenseLimitMs('nope')).toBeNull();
    expect(getLicenseLimitMs(null)).toBeNull();
    expect(getLicenseLimitMs(undefined)).toBeNull();
  });

  it('isLicenseExpired : bornes exactes', () => {
    const limit = Date.UTC(2026, 9, 11);
    expect(isLicenseExpired(EXPIRY, new Date(limit - 1))).toBe(false);
    expect(isLicenseExpired(EXPIRY, new Date(limit))).toBe(true);
    expect(isLicenseExpired(EXPIRY, new Date(limit + DAY))).toBe(true);
  });

  it('isLicenseExpired : ne lève jamais, false si date ou now invalide', () => {
    expect(() => isLicenseExpired('x', new Date('x'))).not.toThrow();
    expect(isLicenseExpired(EXPIRY, new Date('x'))).toBe(false);
    expect(isLicenseExpired(null, NOW)).toBe(false);
  });

  it('getLicenseDaysLeft : jours calendaires UTC (0 jour J, 1 la veille, négatif après)', () => {
    expect(getLicenseDaysLeft(EXPIRY, new Date('2026-10-10T23:59:59.999Z'))).toBe(0);
    expect(getLicenseDaysLeft(EXPIRY, new Date('2026-10-09T00:00:00.000Z'))).toBe(1);
    expect(getLicenseDaysLeft(EXPIRY, new Date('2026-10-03T12:00:00.000Z'))).toBe(7);
    expect(getLicenseDaysLeft(EXPIRY, new Date('2026-10-11T00:00:00.000Z'))).toBe(-1);
    expect(getLicenseDaysLeft('nope', NOW)).toBeNull();
    expect(getLicenseDaysLeft(EXPIRY, new Date('x'))).toBeNull();
  });
});
