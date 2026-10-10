import { describe, it, expect } from 'vitest';
import {
  computeStatus,
  computeLogoutCell,
  HEARTBEAT_ONLINE_MAX_MIN,
  HEARTBEAT_OFFLINE_MIN,
  HEARTBEAT_CLOCK_SKEW_TOLERANCE_MIN,
  type PresenceStatusInput,
} from '../src/renderer/src/pages/agentsPresenceStatus';

const NOW = Date.parse('2026-10-10T12:00:00.000Z');
const minAgo = (m: number): string => new Date(NOW - m * 60000).toISOString();

function row(p: Partial<PresenceStatusInput> = {}): PresenceStatusInput {
  return { last_heartbeat_at: null, last_login_at: null, last_logout_at: null, ...p };
}

describe('constantes', () => {
  it('seuils validés', () => {
    expect(HEARTBEAT_ONLINE_MAX_MIN).toBe(6);
    expect(HEARTBEAT_OFFLINE_MIN).toBe(15);
  });
});

describe('computeStatus - âge du battement', () => {
  const cases: Array<[number, string]> = [
    [0, 'EN_LIGNE'],
    [1, 'EN_LIGNE'],
    [5.9, 'EN_LIGNE'],
    [6, 'INACTIF'],
    [14.9, 'INACTIF'],
    [15, 'HORS_LIGNE'],
    [16, 'HORS_LIGNE'],
  ];
  it.each(cases)('battement il y a %s min -> %s', (age, expected) => {
    expect(computeStatus(row({ last_heartbeat_at: minAgo(age) }), NOW)).toBe(expected);
  });

  it('absence de battement -> HORS_LIGNE', () => {
    expect(computeStatus(row(), NOW)).toBe('HORS_LIGNE');
  });
});

describe('computeStatus - horloge de poste en avance (battement futur)', () => {
  const minAhead = (m: number): string => new Date(NOW + m * 60000).toISOString();
  it('tolérance exportée = 2 min', () => {
    expect(HEARTBEAT_CLOCK_SKEW_TOLERANCE_MIN).toBe(2);
  });
  it.each([
    [1, 'EN_LIGNE'],
    [2, 'EN_LIGNE'],
    [3, 'INACTIF'],
    [10, 'INACTIF'],
  ])('battement %s min dans le futur -> %s', (ahead, expected) => {
    expect(computeStatus(row({ last_heartbeat_at: minAhead(ahead) }), NOW)).toBe(expected);
  });
  it('logout >= battement futur -> HORS_LIGNE (priorité inchangée)', () => {
    expect(computeStatus(row({ last_heartbeat_at: minAhead(10), last_logout_at: minAhead(10) }), NOW)).toBe('HORS_LIGNE');
    expect(computeStatus(row({ last_heartbeat_at: minAhead(10), last_logout_at: minAhead(11) }), NOW)).toBe('HORS_LIGNE');
  });
  it('INACTIF futur -> cellule déconnexion vide', () => {
    const r = row({ last_heartbeat_at: minAhead(10) });
    expect(computeLogoutCell(r, computeStatus(r, NOW))).toEqual({ kind: 'none' });
  });
});

describe('computeStatus - déconnexion', () => {
  it('logout >= battement -> HORS_LIGNE (égalité incluse)', () => {
    expect(computeStatus(row({ last_heartbeat_at: minAgo(1), last_logout_at: minAgo(1) }), NOW)).toBe('HORS_LIGNE');
    expect(computeStatus(row({ last_heartbeat_at: minAgo(2), last_logout_at: minAgo(1) }), NOW)).toBe('HORS_LIGNE');
  });
  it('logout ancien (session précédente) + battement récent -> EN_LIGNE', () => {
    expect(
      computeStatus(row({ last_heartbeat_at: minAgo(1), last_login_at: minAgo(30), last_logout_at: minAgo(600) }), NOW)
    ).toBe('EN_LIGNE');
  });
  it('battement tardif antérieur au logout -> HORS_LIGNE', () => {
    expect(computeStatus(row({ last_heartbeat_at: minAgo(10), last_logout_at: minAgo(3) }), NOW)).toBe('HORS_LIGNE');
  });
});

describe('computeStatus - dates invalides', () => {
  it('battement invalide -> HORS_LIGNE sans exception', () => {
    expect(computeStatus(row({ last_heartbeat_at: 'pas-une-date' }), NOW)).toBe('HORS_LIGNE');
  });
  it('logout invalide ignoré', () => {
    expect(computeStatus(row({ last_heartbeat_at: minAgo(1), last_logout_at: 'xx' }), NOW)).toBe('EN_LIGNE');
  });
  it('login invalide sans effet', () => {
    expect(computeStatus(row({ last_heartbeat_at: minAgo(1), last_login_at: 'xx' }), NOW)).toBe('EN_LIGNE');
  });
});

describe('computeStatus - last_action_at ignoré', () => {
  it('aucune action + battement récent -> EN_LIGNE', () => {
    const r = { ...row({ last_heartbeat_at: minAgo(1) }), last_action_at: null };
    expect(computeStatus(r, NOW)).toBe('EN_LIGNE');
  });
  it('action ancienne + battement récent -> EN_LIGNE', () => {
    const r = { ...row({ last_heartbeat_at: minAgo(1) }), last_action_at: minAgo(500) };
    expect(computeStatus(r, NOW)).toBe('EN_LIGNE');
  });
});

describe('computeLogoutCell', () => {
  it('statut EN_LIGNE ou INACTIF -> none', () => {
    const r = row({ last_heartbeat_at: minAgo(1), last_logout_at: minAgo(5) });
    expect(computeLogoutCell(r, 'EN_LIGNE')).toEqual({ kind: 'none' });
    expect(computeLogoutCell(r, 'INACTIF')).toEqual({ kind: 'none' });
  });
  it('logout > login -> date de déconnexion', () => {
    const r = row({ last_heartbeat_at: minAgo(20), last_login_at: minAgo(60), last_logout_at: minAgo(20) });
    expect(computeLogoutCell(r, 'HORS_LIGNE')).toEqual({ kind: 'logout', at: minAgo(20) });
  });
  it('logout < login -> Fermé sans déconnexion + dernier signe', () => {
    const r = row({ last_heartbeat_at: minAgo(30), last_login_at: minAgo(60), last_logout_at: minAgo(600) });
    expect(computeLogoutCell(r, 'HORS_LIGNE')).toEqual({ kind: 'closed', lastSignAt: minAgo(30) });
  });
  it('logout == login -> Fermé sans déconnexion', () => {
    const r = row({ last_heartbeat_at: minAgo(30), last_login_at: minAgo(60), last_logout_at: minAgo(60) });
    expect(computeLogoutCell(r, 'HORS_LIGNE')).toEqual({ kind: 'closed', lastSignAt: minAgo(30) });
  });
  it('logout null -> Fermé sans déconnexion', () => {
    const r = row({ last_heartbeat_at: minAgo(30), last_login_at: minAgo(60) });
    expect(computeLogoutCell(r, 'HORS_LIGNE')).toEqual({ kind: 'closed', lastSignAt: minAgo(30) });
  });
  it('login null avec logout valide -> date de déconnexion', () => {
    const r = row({ last_heartbeat_at: minAgo(30), last_logout_at: minAgo(30) });
    expect(computeLogoutCell(r, 'HORS_LIGNE')).toEqual({ kind: 'logout', at: minAgo(30) });
  });
  it('login invalide avec logout valide -> date de déconnexion', () => {
    const r = row({ last_login_at: 'xx', last_logout_at: minAgo(30) });
    expect(computeLogoutCell(r, 'HORS_LIGNE')).toEqual({ kind: 'logout', at: minAgo(30) });
  });
  it('battement absent et pas de logout -> closed sans dernier signe', () => {
    expect(computeLogoutCell(row({ last_login_at: minAgo(60) }), 'HORS_LIGNE')).toEqual({ kind: 'closed', lastSignAt: null });
  });
  it('battement invalide -> closed sans dernier signe', () => {
    expect(computeLogoutCell(row({ last_heartbeat_at: 'xx' }), 'HORS_LIGNE')).toEqual({ kind: 'closed', lastSignAt: null });
  });
});
