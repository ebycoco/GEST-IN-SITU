import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  resolveAutoDownstreamPreference,
  readAutoDownstreamPreference,
  readStoredAutoDownstream,
  autoDownstreamConfigKey
} from '../src/main/sync/auto-downstream-preference';

/**
 * P1-1 (2026-11-24) : préférence "Récupération automatique des cartes".
 * Clé absente -> défaut par rôle ACTIF (activé pour OPERATEUR_VERIFICATION seulement) ;
 * valeur explicite 'true' / 'false' toujours respectée, quel que soit le rôle.
 */
describe('resolveAutoDownstreamPreference (fonction pure)', () => {
  it('clé absente : activée pour OPERATEUR_VERIFICATION', () => {
    expect(resolveAutoDownstreamPreference(undefined, 'OPERATEUR_VERIFICATION')).toBe(true);
    expect(resolveAutoDownstreamPreference(null, 'OPERATEUR_VERIFICATION')).toBe(true);
  });

  it('clé absente : désactivée pour les autres rôles (défaut historique)', () => {
    for (const role of ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'OPERATEUR_RECHERCHE', 'AGENT_SAISIE', '']) {
      expect(resolveAutoDownstreamPreference(undefined, role)).toBe(false);
    }
    expect(resolveAutoDownstreamPreference(undefined, null)).toBe(false);
    expect(resolveAutoDownstreamPreference(undefined, undefined)).toBe(false);
  });

  it("valeur explicite 'false' respectée même pour OPERATEUR_VERIFICATION", () => {
    expect(resolveAutoDownstreamPreference('false', 'OPERATEUR_VERIFICATION')).toBe(false);
  });

  it("valeur explicite 'true' respectée pour tout rôle", () => {
    expect(resolveAutoDownstreamPreference('true', 'ADMINISTRATEUR_SITE')).toBe(true);
    expect(resolveAutoDownstreamPreference('true', 'OPERATEUR_VERIFICATION')).toBe(true);
  });

  it('valeur explicite autre que true (historique) = désactivée', () => {
    expect(resolveAutoDownstreamPreference('', 'OPERATEUR_VERIFICATION')).toBe(false);
    expect(resolveAutoDownstreamPreference('1', 'OPERATEUR_VERIFICATION')).toBe(false);
  });
});

describe('readAutoDownstreamPreference (lecture t_config)', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t_config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)');

  it('clé absente -> undefined, puis défaut par rôle', () => {
    expect(readStoredAutoDownstream(db, 41)).toBeUndefined();
    expect(readAutoDownstreamPreference(db, 41, 'OPERATEUR_VERIFICATION')).toBe(true);
    expect(readAutoDownstreamPreference(db, 41, 'ADMIN_CENTRE')).toBe(false);
  });

  it("clé 'false' / 'true' : choix explicite, rôle ignoré", () => {
    db.prepare('INSERT OR REPLACE INTO t_config (key, value) VALUES (?, ?)').run(autoDownstreamConfigKey(42), 'false');
    expect(readAutoDownstreamPreference(db, 42, 'OPERATEUR_VERIFICATION')).toBe(false);
    db.prepare('INSERT OR REPLACE INTO t_config (key, value) VALUES (?, ?)').run(autoDownstreamConfigKey(43), 'true');
    expect(readAutoDownstreamPreference(db, 43, 'ADMIN_CENTRE')).toBe(true);
  });

  it('clé par id_user : la préférence d\'un autre compte n\'est pas lue', () => {
    expect(autoDownstreamConfigKey(42)).toBe('auto_downstream_42');
    expect(readAutoDownstreamPreference(db, 44, 'ADMIN_CENTRE')).toBe(false);
  });
});
