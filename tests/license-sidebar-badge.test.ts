import { describe, it, expect } from 'vitest';
import { getLicenseBadgeModel } from '../src/renderer/src/components/layout/LicenseSidebarBadge';
import type { LicenseState } from '../src/shared/utils/license';

const STATES: LicenseState[] = ['permanent', 'ok', 'warning', 'undefined', 'critical', 'expired', 'invalid'];
const SA = 'Pour renouveler, contactez le super administrateur.';
const OTHER = "Pour renouveler, contactez l'administrateur du site.";

describe('getLicenseBadgeModel', () => {
  it('SUPER ADMIN / rôle absent => rien', () => {
    for (const st of STATES) {
      expect(getLicenseBadgeModel(st, 'SUPER ADMIN')).toBeNull();
      expect(getLicenseBadgeModel(st, null)).toBeNull();
    }
  });
  it('couleurs par état', () => {
    const c = (s: LicenseState) => getLicenseBadgeModel(s, 'ADMIN_CENTRE')!.color;
    expect(c('permanent')).toBe('var(--accent-green)');
    expect(c('ok')).toBe('var(--accent-green)');
    expect(c('warning')).toBe('var(--accent-orange)');
    expect(c('undefined')).toBe('var(--accent-orange)');
    expect(c('critical')).toBe('var(--accent-red)');
    expect(c('expired')).toBe('var(--accent-red)');
    expect(c('invalid')).toBe('var(--text-secondary)');
  });
  it('« Expire bientôt » seulement en critical', () => {
    for (const st of STATES) {
      expect(getLicenseBadgeModel(st, 'ADMINISTRATEUR_SITE')!.showSoonText).toBe(st === 'critical');
    }
  });
  it('infobulle seulement en warning/critical/undefined, selon le rôle, sans chiffre', () => {
    for (const st of STATES) {
      const need = st === 'warning' || st === 'critical' || st === 'undefined';
      const a = getLicenseBadgeModel(st, 'ADMINISTRATEUR_SITE')!.tooltip;
      const o = getLicenseBadgeModel(st, 'OPERATEUR_VERIFICATION')!.tooltip;
      expect(a).toBe(need ? SA : null);
      expect(o).toBe(need ? OTHER : null);
      if (a) expect(a).not.toMatch(/\d/);
      if (o) expect(o).not.toMatch(/\d/);
    }
  });
});
