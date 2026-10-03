import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { computePushButtonState } from '../src/renderer/src/hooks/pushButtonState';

/**
 * Bouton « Envoyer les corrections » : cartes locales SANS ligne d'outbox (ex. modifiées par
 * l'opérateur logistique avant une mise à jour de l'application).
 *
 * Avant : avec l'envoi automatique actif et le poste en ligne, le bouton n'était visible que si
 * t_outbox contenait des lignes PENDING/ERROR : ces cartes restaient masquées alors que l'envoi
 * manuel (upload-worker.js) les envoie.
 *
 * Après : le compteur orphelin reproduit le filtre de upload-worker.js, selon les options du clic
 * (allowMissing, onlyModified). Ce test vérifie cette parité sur des cas explicites.
 *
 * Base SQLite jetable, synchro réseau coupée, données fictives.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-p1e-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

const DEFAULT = { allowMissing: true, onlyModified: false };
const STRICT = { allowMissing: false, onlyModified: false };
const MODIFIED_ONLY = { allowMissing: true, onlyModified: true };

describe('getUnsyncedConformeOrphanCardsCount — parité avec le clic « Envoyer les corrections »', () => {
  let connection: typeof import('../src/main/database/connection');
  let stats: typeof import('../src/main/database/queries/stats.queries');
  let cartes: typeof import('../src/main/database/queries/cartes.queries');
  let db: import('better-sqlite3').Database;
  let nextSite = 950;

  const newSite = () => {
    const id = nextSite++;
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, ?, ?, 1, ?)`).run(id, `SITE_${id}`, `S${id}`, `site-p1e-${id}`);
    return id;
  };

  let seq = 0;
  const SYNCED_AT = '2026-09-01 10:00:00';
  const insert = (siteId: number, o: {
    noms?: string; prenoms?: string; ddn?: string | null; rangement?: string; statut?: string;
    dirty?: number; cle?: string; centre?: number | null; sync?: string | null; synced?: boolean;
  } = {}) => {
    seq++;
    const sync = o.sync === undefined ? `sync-p1e-${seq}` : o.sync;
    const id = Number(db.prepare(`
      INSERT INTO t_cartes (site_id, centre_id, noms, prenoms, date_de_naissance, lieu_de_naissance, contact, rangement, statut, sync_id, is_dirty, cle_doublon, cle_doublon_flex, synced_at)
      VALUES (?, ?, ?, ?, ?, 'ABIDJAN', '0700000000', ?, ?, ?, ?, ?, ?, ?)
    `).run(siteId, o.centre ?? null, o.noms ?? `NOM${seq}`, o.prenoms ?? `PRE${seq}`, o.ddn === undefined ? '1990-01-01' : o.ddn,
      o.rangement ?? 'R-1', o.statut ?? 'EN STOCK', sync, o.dirty ?? 1, o.cle ?? `CLE_${seq}`, `FLEX_${seq}`,
      o.synced ? SYNCED_AT : null).lastInsertRowid);
    return { id, sync };
  };

  const addOutbox = (syncId: string | null, status: 'PENDING' | 'ERROR' | 'SYNCED') =>
    db.prepare(`INSERT INTO t_outbox (id, table_name, operation, payload, status) VALUES (?, 't_cartes', 'UPDATE', '{}', ?)`).run(syncId, status);

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    stats = await import('../src/main/database/queries/stats.queries');
    cartes = await import('../src/main/database/queries/cartes.queries');
    db = await connection.initDatabase();
  }, 60_000); // démarrage à froid lent sur les postes de développement (migration complète d'une base neuve)

  afterAll(() => {
    connection?.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('options par défaut : carte conforme modifiée en local, sans ligne d\'outbox → comptée', () => {
    const site = newSite();
    insert(site);
    insert(site);
    expect(stats.getUnsyncedConformeOrphanCardsCount(site, null, DEFAULT)).toBe(2);
  });

  it('carte déjà dans l\'outbox (PENDING ou ERROR) → non comptée ; ligne SYNCED seule → comptée', () => {
    const site = newSite();
    const pending = insert(site); addOutbox(pending.sync, 'PENDING');
    const error = insert(site); addOutbox(error.sync, 'ERROR');
    const synced = insert(site); addOutbox(synced.sync, 'SYNCED');
    expect(stats.getUnsyncedConformeOrphanCardsCount(site, null, DEFAULT)).toBe(1);
  });

  it('cartes que le clic n\'enverrait pas → non comptées (doublons, date invalide, identité vide, brouillon, déjà synchronisée)', () => {
    const site = newSite();
    insert(site, { cle: 'CLE_JUMEAUX' });
    insert(site, { cle: 'CLE_JUMEAUX' });                                          // doublon strict (x2)
    insert(site, { noms: 'PROB', prenoms: 'ABLE', cle: 'CLE_PROB_1' });
    insert(site, { noms: 'PROB', prenoms: 'ABLE', cle: 'CLE_PROB_2' });            // doublon probable (x2)
    insert(site, { ddn: '12/05/1990' });                                           // date invalide
    insert(site, { noms: '', prenoms: '', rangement: 'NON CLASSE' });              // identité vide
    db.prepare(`UPDATE t_cartes SET num_secu = '' WHERE site_id = ?`).run(site);
    insert(site, { statut: 'BROUILLON' });                                         // brouillon
    insert(site, { dirty: 0, synced: true });                                      // déjà synchronisée
    expect(stats.getUnsyncedConformeOrphanCardsCount(site, null, DEFAULT)).toBe(0);
  });

  it('cantonnement : autre site non compté ; centre ADMIN_CENTRE restreint au centre', () => {
    const site = newSite();
    const other = newSite();
    const centreA = Number(db.prepare(`INSERT INTO t_centres (nom, site_id, sync_id) VALUES ('CA', ?, ?)`).run(site, `centre-a-${site}`).lastInsertRowid);
    const centreB = Number(db.prepare(`INSERT INTO t_centres (nom, site_id, sync_id) VALUES ('CB', ?, ?)`).run(site, `centre-b-${site}`).lastInsertRowid);
    insert(site, { centre: centreA });
    insert(site, { centre: centreA });
    insert(site, { centre: centreB });
    insert(other);
    expect(stats.getUnsyncedConformeOrphanCardsCount(site, null, DEFAULT)).toBe(3);
    expect(stats.getUnsyncedConformeOrphanCardsCount(site, centreA, DEFAULT)).toBe(2);
    expect(stats.getUnsyncedConformeOrphanCardsCount(site, centreB, DEFAULT)).toBe(1);
  });

  it('allowMissing=false (AdminCentre, AgentSaisie, AgentVerification, VerificationSearch) : données critiques requises', () => {
    const site = newSite();
    insert(site);                                                                  // complète → comptée
    insert(site, { rangement: 'NON CLASSE' });                                     // rangement NON CLASSE → exclue
    insert(site, { rangement: '' });                                               // rangement vide → exclue
    insert(site, { prenoms: '' });                                                 // prénoms vides → exclue
    expect(stats.getUnsyncedConformeOrphanCardsCount(site, null, DEFAULT)).toBe(4);
    expect(stats.getUnsyncedConformeOrphanCardsCount(site, null, STRICT)).toBe(1);
  });

  it('onlyModified=true (site ayant des cartes déjà synchronisées modifiées) : seules les cartes déjà synchronisées', () => {
    const site = newSite();
    insert(site);                                                                  // jamais synchronisée → exclue en mode modifié
    insert(site, { synced: true });                                                // modifiée après synchro → comptée
    insert(site, { synced: true, dirty: -1 });                                     // suppression en attente → comptée
    expect(stats.getUnsyncedConformeOrphanCardsCount(site, null, DEFAULT)).toBe(3);
    expect(stats.getUnsyncedConformeOrphanCardsCount(site, null, MODIFIED_ONLY)).toBe(2);
  });

  it('scénario réel : carte enfilée par la mise à jour de rangement → non comptée ; même carte sans ligne d\'outbox → comptée', () => {
    const site = newSite();
    const { id, sync } = insert(site, { dirty: 0 });
    const logistique = { role: 'OPERATEUR_LOGISTIQUE', site_id: site, id_user: 9, login: 'logi.test' };

    cartes.updateRangementEtFiche(id, { rangement: 'R-77' }, logistique);
    expect(db.prepare(`SELECT status FROM t_outbox WHERE id = ?`).get(sync)).toEqual({ status: 'PENDING' });
    expect(stats.getUnsyncedConformeOrphanCardsCount(site, null, DEFAULT)).toBe(0); // circuit automatique : pas d'orphelin

    db.prepare(`DELETE FROM t_outbox WHERE id = ?`).run(sync);       // carte modifiée avant la mise à jour : jamais enfilée
    expect(stats.getUnsyncedConformeOrphanCardsCount(site, null, DEFAULT)).toBe(1);
  });

  it('compteurs disjoints : outbox actionnable + orphelines = cartes conformes modifiées (options par défaut)', () => {
    const site = newSite();
    const a = insert(site); addOutbox(a.sync, 'PENDING');
    const b = insert(site); addOutbox(b.sync, 'ERROR');
    insert(site); insert(site); insert(site);
    const conformes = stats.getUnsyncedConformeCardsCount(site);
    const orphelines = stats.getUnsyncedConformeOrphanCardsCount(site, null, DEFAULT);
    expect(conformes).toBe(5);
    expect(orphelines).toBe(3);
    expect(orphelines + 2).toBe(conformes); // 2 cartes couvertes par l'outbox (PENDING + ERROR)
  });
});

describe('computePushButtonState — visibilité du bouton « Envoyer les corrections »', () => {
  const base = { autoUpstream: true, isOnline: true, conformeCount: 0, outboxActionableCount: 0, orphanCount: 0, isBulkUploading: false };

  it('envoi automatique + en ligne, rien à envoyer → bouton masqué', () => {
    expect(computePushButtonState(base)).toEqual({ visible: false, disabled: true, actionableCount: 0 });
  });

  it('envoi automatique + en ligne, cartes locales sans outbox (cas corrigé) → bouton visible et actif', () => {
    const s = computePushButtonState({ ...base, orphanCount: 12, conformeCount: 12 });
    expect(s).toEqual({ visible: true, disabled: false, actionableCount: 12 });
  });

  it('défaut d\'origine : l\'ancienne règle (visible = lignes d\'outbox > 0) masquait le bouton pour ces cartes', () => {
    const legacyVisible = (outboxActionableCount: number) => outboxActionableCount > 0; // usePushButtonVisibility avant correctif
    const state = { ...base, orphanCount: 12, conformeCount: 12, outboxActionableCount: 0 };
    expect(legacyVisible(state.outboxActionableCount)).toBe(false);
    expect(computePushButtonState(state).visible).toBe(true);
  });

  it('envoi automatique + en ligne, lignes d\'outbox seules (comportement existant) → bouton visible', () => {
    expect(computePushButtonState({ ...base, outboxActionableCount: 4 })).toEqual({ visible: true, disabled: false, actionableCount: 4 });
  });

  it('les deux compteurs s\'additionnent (disjoints)', () => {
    expect(computePushButtonState({ ...base, outboxActionableCount: 4, orphanCount: 3 }).actionableCount).toBe(7);
  });

  it('envoi automatique désactivé ou hors-ligne → toujours visible, compteur = cartes conformes (inchangé)', () => {
    expect(computePushButtonState({ ...base, autoUpstream: false, conformeCount: 5, orphanCount: 99 })).toEqual({ visible: true, disabled: false, actionableCount: 5 });
    expect(computePushButtonState({ ...base, isOnline: false, conformeCount: 0 })).toEqual({ visible: true, disabled: true, actionableCount: 0 });
  });

  it('envoi en cours → bouton désactivé', () => {
    expect(computePushButtonState({ ...base, orphanCount: 3, isBulkUploading: true }).disabled).toBe(true);
  });
});
