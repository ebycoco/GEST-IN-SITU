import { describe, it, expect, vi } from 'vitest';

// Mêmes mocks que tests/presence-tracked-role.test.ts (module main importé pour le test de dérive).
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/main/sync/network-monitor', () => ({
  networkMonitor: { getState: () => 'OFFLINE' },
}));
vi.mock('../src/main/sync/supabase-client', () => ({
  getSupabaseClient: () => null,
}));

import {
  resolveLastLogin,
  sqliteUtcToIso,
  PRESENCE_TRACKED_ROLES,
} from '../src/renderer/src/pages/agentsLastLogin';
import { isPresenceTrackedRole } from '../src/main/sync/presence.service';

const cloud = new Map<string, string>([['sync-1', '2026-10-10T08:30:00.000Z']]);
const empty = new Map<string, string>();

describe('resolveLastLogin', () => {
  it('cloud trouve par sync_id -> source cloud (ISO)', () => {
    expect(resolveLastLogin('OPERATEUR_SAISIE', 'sync-1', '2026-01-01 00:00:00', cloud))
      .toEqual({ source: 'cloud', iso: '2026-10-10T08:30:00.000Z' });
  });

  it('absent du cloud -> repli local interprete en UTC', () => {
    expect(resolveLastLogin('OPERATEUR_SAISIE', 'autre', '2026-10-09 14:05:06', cloud))
      .toEqual({ source: 'local', iso: '2026-10-09T14:05:06.000Z' });
  });

  it('cloud invalide -> repli local', () => {
    const bad = new Map([['s', 'pas-une-date']]);
    expect(resolveLastLogin('ADMIN_CENTRE', 's', '2026-10-09 14:05:06', bad).source).toBe('local');
  });

  it('role non suivi -> Non suivi, meme avec donnees', () => {
    expect(resolveLastLogin('SUPER ADMIN', 'sync-1', '2026-10-09 14:05:06', cloud).source).toBe('untracked');
    expect(resolveLastLogin('ADMINISTRATEUR_SITE', 'sync-1', null, cloud).source).toBe('untracked');
    expect(resolveLastLogin(undefined, 'sync-1', null, cloud).source).toBe('untracked');
  });

  it('ni cloud ni local -> Jamais', () => {
    expect(resolveLastLogin('OPERATEUR_QUALITE', 'x', null, empty)).toEqual({ source: 'never', iso: null });
    expect(resolveLastLogin('OPERATEUR_QUALITE', null, '', empty).source).toBe('never');
    expect(resolveLastLogin('OPERATEUR_QUALITE', 'x', 'garbage', empty).source).toBe('never');
  });
});

describe('sqliteUtcToIso', () => {
  it('traite le format SQLite comme UTC (independant du fuseau)', () => {
    expect(sqliteUtcToIso('2026-10-09 23:59:59')).toBe('2026-10-09T23:59:59.000Z');
  });
  it('conserve une valeur deja suffixee', () => {
    expect(sqliteUtcToIso('2026-10-09T10:00:00Z')).toBe('2026-10-09T10:00:00.000Z');
    expect(sqliteUtcToIso('2026-10-09T10:00:00+02:00')).toBe('2026-10-09T08:00:00.000Z');
  });
  it('null / vide / invalide -> null', () => {
    expect(sqliteUtcToIso(null)).toBeNull();
    expect(sqliteUtcToIso('  ')).toBeNull();
    expect(sqliteUtcToIso('xx')).toBeNull();
  });
});

describe('derive PRESENCE_TRACKED_ROLES vs isPresenceTrackedRole (main)', () => {
  it('chaque role renderer est suivi cote main', () => {
    for (const r of PRESENCE_TRACKED_ROLES) expect(isPresenceTrackedRole(r)).toBe(true);
  });
  it('les roles connus non suivis cote main le sont aussi cote renderer', () => {
    for (const r of ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'CONSULTANT', 'ROLE_INCONNU']) {
      expect(isPresenceTrackedRole(r)).toBe(false);
      expect(PRESENCE_TRACKED_ROLES.includes(r)).toBe(false);
    }
  });
  it('meme cardinalite (7 roles) : detecte un ajout cote main', () => {
    const candidates = [
      'OPERATEUR_VERIFICATION', 'OPERATEUR_QUALITE', 'OPERATEUR_SAISIE', 'OPERATEUR_LOGISTIQUE',
      'OPERATEUR_INVENTAIRE', 'OPERATEUR_APUREMENT', 'ADMIN_CENTRE', 'OPERATEUR_RECHERCHE',
      'CONSULTANT', 'SUPER ADMIN', 'ADMINISTRATEUR_SITE',
    ];
    const mainTracked = candidates.filter(isPresenceTrackedRole).sort();
    expect([...PRESENCE_TRACKED_ROLES].sort()).toEqual(mainTracked);
  });
});
