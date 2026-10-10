import { describe, it, expect, vi } from 'vitest';

/** isPresenceTrackedRole() (src/main/sync/presence.service.ts) : fonction pure, dépendances mockées. */
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/main/sync/network-monitor', () => ({
  networkMonitor: { getState: () => 'OFFLINE' },
}));
vi.mock('../src/main/sync/supabase-client', () => ({
  getSupabaseClient: () => null,
}));

import { isPresenceTrackedRole } from '../src/main/sync/presence.service';

describe('isPresenceTrackedRole', () => {
  it.each([
    'OPERATEUR_VERIFICATION',
    'OPERATEUR_QUALITE',
    'OPERATEUR_SAISIE',
    'OPERATEUR_LOGISTIQUE',
    'OPERATEUR_INVENTAIRE',
    'OPERATEUR_APUREMENT',
    'ADMIN_CENTRE',
  ])('%s est suivi', (role) => {
    expect(isPresenceTrackedRole(role)).toBe(true);
  });

  it.each(['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ROLE_INCONNU', ''])('%s n\'est pas suivi', (role) => {
    expect(isPresenceTrackedRole(role)).toBe(false);
  });

  it('null / undefined -> false', () => {
    expect(isPresenceTrackedRole(null)).toBe(false);
    expect(isPresenceTrackedRole(undefined)).toBe(false);
  });
});
