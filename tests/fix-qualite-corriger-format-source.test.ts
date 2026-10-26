import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Audit 2026-10-26 (point 8) — `qualite:corrigerFormat` confondait le numéro d'une carte
 * (t_cartes.id_carte) et celui d'une anomalie d'import (t_import_anomalies.id) : deux séries
 * indépendantes qui se chevauchent. Corriger la carte n°N pouvait transférer/supprimer
 * l'anomalie n°N (et inversement), et une anomalie dont `carte_id` est renseigné (n° sécu ou
 * clé nom|prénom|date, jamais un id carte) était supprimée sans qu'aucune carte ne soit créée,
 * avec une réponse `success: true`.
 *
 * Correctif : la vue indique la table d'origine (`source`), seule cette table est lue ; une
 * anomalie est toujours transférée vers t_cartes (carte créée identifiée par lastInsertRowid).
 * Base SQLite jetable (migrations réelles), synchro réseau coupée, données fictives.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-corriger-format-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

describe('qualite:corrigerFormat — séparation carte / anomalie (audit 2026-10-26 point 8)', () => {
  let connection: typeof import('../src/main/database/connection');
  let queries: typeof import('../src/main/database/queries/cartes.queries');
  let db: import('better-sqlite3').Database;
  const SITE_ID = 940;
  const AUTRE_SITE = 941;
  const qualite = { role: 'OPERATEUR_QUALITE', site_id: SITE_ID, id_user: 7, login: 'qualite.test' };
  let seq = 0;

  /** Carte fictive + anomalie fictive portant EXACTEMENT le même numéro (collision réelle). */
  const insertCollision = (siteAnomalie = SITE_ID, carteId: string | null = null) => {
    seq += 1;
    const idCarte = Number(db.prepare(`
      INSERT INTO t_cartes (site_id, noms, prenoms, date_de_naissance, lieu_de_naissance, contact, rangement, statut, sync_id, is_dirty, cle_doublon, cle_doublon_flex)
      VALUES (?, 'CARTE', ?, '1990-01-01', 'ABIDJAN', '0700000000', 'R-1', 'EN STOCK', ?, 0, 'X', 'X')
    `).run(SITE_ID, `PCARTE${seq}`, `sync-cf-${seq}`).lastInsertRowid);
    db.prepare(`
      INSERT INTO t_import_anomalies (id, site_id, carte_id, type_anomalie, noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, contact, rangement)
      VALUES (?, ?, ?, 'DATE_INVALIDE', 'ANOMALIE', ?, '31/02/1980', 'BOUAKE', ?, '0500000000', 'R-2')
    `).run(idCarte, siteAnomalie, carteId, `PANO${seq}`, `98765432100${String(seq).padStart(2, '0')}`);
    return idCarte;
  };
  const carte = (id: number) => db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id) as any;
  const anomalie = (id: number) => db.prepare('SELECT * FROM t_import_anomalies WHERE id = ?').get(id) as any;
  const nbCartes = () => (db.prepare('SELECT COUNT(*) AS c FROM t_cartes').get() as { c: number }).c;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    queries = await import('../src/main/database/queries/cartes.queries');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_CF', 'SITE_CF', 1, 'site-cf')`).run(SITE_ID);
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_CF2', 'SITE_CF2', 1, 'site-cf2')`).run(AUTRE_SITE);
  });

  afterAll(() => {
    connection?.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('A. source = t_cartes : seule la carte visée change', () => {
    it('correction de date : la carte n°N change, l\'anomalie n°N reste intacte, aucune carte créée', () => {
      const id = insertCollision();
      const avant = nbCartes();
      const res = queries.corrigerFormatQualite({ source: 't_cartes', id, champ: 'date_de_naissance', valeur_apres: '1985-05-05', currentUser: qualite });
      expect(res).toMatchObject({ success: true, changes: 1, id_carte: id });
      expect(carte(id).date_de_naissance).toBe('1985-05-05');
      expect(carte(id).cle_doublon).toBe(`CARTE|PCARTE${seq}|1985-05-05|ABIDJAN|0700000000`);
      expect(carte(id).is_dirty).toBe(1);
      expect(anomalie(id)).toBeTruthy();
      expect(anomalie(id).date_de_naissance).toBe('31/02/1980');
      expect(nbCartes()).toBe(avant);
      // Quadriptyque : la carte corrigée est enfilée (payload complet) dans t_outbox.
      expect(db.prepare('SELECT operation FROM t_outbox WHERE id = ?').get(`sync-cf-${seq}`)).toBeTruthy();
    });

    it('correction d\'un autre champ (contact) : la carte change, l\'anomalie reste intacte', () => {
      const id = insertCollision();
      const res = queries.corrigerFormatQualite({ source: 't_cartes', id, champ: 'contact', valeur_apres: '0102030405', currentUser: qualite });
      expect(res).toMatchObject({ success: true, changes: 1, id_carte: id });
      expect(carte(id).contact).toBe('0102030405');
      expect(anomalie(id)).toBeTruthy();
      expect(anomalie(id).contact).toBe('0500000000');
    });

    it('valeur déjà identique : aucune écriture (idempotence), succès sans changement', () => {
      const id = insertCollision();
      const res = queries.corrigerFormatQualite({ source: 't_cartes', id, champ: 'contact', valeur_apres: '0700000000', currentUser: qualite });
      expect(res).toMatchObject({ success: true, changes: 0 });
      expect(carte(id).is_dirty).toBe(0);
      expect(anomalie(id)).toBeTruthy();
    });
  });

  describe('B. source = t_import_anomalies : transfert, la carte homonyme n°N est intacte', () => {
    it('correction de date : nouvelle carte créée avec la date, anomalie supprimée, carte n°N inchangée', () => {
      const id = insertCollision();
      const carteAvant = carte(id);
      const res = queries.corrigerFormatQualite({ source: 't_import_anomalies', id, champ: 'date_de_naissance', valeur_apres: '1980-02-28', currentUser: qualite });
      expect(res.success).toBe(true);
      expect(res.changes).toBe(1);
      expect(res.id_carte).not.toBe(id);
      const nouvelle = carte(res.id_carte as number);
      expect(nouvelle.noms).toBe('ANOMALIE');
      expect(nouvelle.date_de_naissance).toBe('1980-02-28');
      expect(nouvelle.site_id).toBe(SITE_ID);
      expect(nouvelle.is_dirty).toBe(1);
      expect(anomalie(id)).toBeUndefined();
      expect(carte(id)).toEqual(carteAvant);
    });

    it('correction d\'un autre champ (noms) : appliqué à la carte créée (lastInsertRowid), carte n°N inchangée', () => {
      const id = insertCollision();
      const carteAvant = carte(id);
      const res = queries.corrigerFormatQualite({ source: 't_import_anomalies', id, champ: 'noms', valeur_apres: 'KOUAMÉ', currentUser: qualite });
      expect(res.success).toBe(true);
      expect(res.changes).toBe(1);
      const nouvelle = carte(res.id_carte as number);
      expect(nouvelle.noms).toBe('KOUAME');
      expect(nouvelle.prenoms).toBe(`PANO${seq}`);
      expect(anomalie(id)).toBeUndefined();
      expect(carte(id)).toEqual(carteAvant);
    });

    it('anomalie dont carte_id = n° sécu : une carte est bien créée (transfert), anomalie supprimée, champ appliqué', () => {
      const id = insertCollision(SITE_ID, '1234567890123');
      const carteAvant = carte(id);
      const avant = nbCartes();
      const res = queries.corrigerFormatQualite({ source: 't_import_anomalies', id, champ: 'contact', valeur_apres: '0708091011', currentUser: qualite });
      expect(res.success).toBe(true);
      expect(nbCartes()).toBe(avant + 1);
      expect(carte(res.id_carte as number).contact).toBe('0708091011');
      expect(anomalie(id)).toBeUndefined();
      expect(carte(id)).toEqual(carteAvant);
    });

    it('anomalie dont carte_id = clé nom|prénom|date : idem, correction de date appliquée à la carte créée', () => {
      const id = insertCollision(SITE_ID, 'ANOMALIE|X|31/02/1980');
      const res = queries.corrigerFormatQualite({ source: 't_import_anomalies', id, champ: 'date_de_naissance', valeur_apres: '1980-03-01', currentUser: qualite });
      expect(res.success).toBe(true);
      expect(carte(res.id_carte as number).date_de_naissance).toBe('1980-03-01');
      expect(anomalie(id)).toBeUndefined();
    });
  });

  describe('C. jamais « rien corrigé mais success: true »', () => {
    it('carte inexistante → success: false, changes: 0', () => {
      const res = queries.corrigerFormatQualite({ source: 't_cartes', id: 99_999_001, champ: 'contact', valeur_apres: '0102030405', currentUser: qualite });
      expect(res).toMatchObject({ success: false, changes: 0, id_carte: null });
    });

    it('anomalie inexistante (même si une carte porte ce numéro) → success: false, carte intacte', () => {
      const id = insertCollision();
      db.prepare('DELETE FROM t_import_anomalies WHERE id = ?').run(id);
      const carteAvant = carte(id);
      const res = queries.corrigerFormatQualite({ source: 't_import_anomalies', id, champ: 'contact', valeur_apres: '0102030405', currentUser: qualite });
      expect(res).toMatchObject({ success: false, changes: 0, id_carte: null });
      expect(carte(id)).toEqual(carteAvant);
    });

    it('source absente ou invalide → erreur claire, rien n\'est modifié', () => {
      const id = insertCollision();
      const carteAvant = carte(id);
      expect(() => queries.corrigerFormatQualite({ source: undefined, id, champ: 'contact', valeur_apres: '0102030405', currentUser: qualite }))
        .toThrow(/source/i);
      expect(() => queries.corrigerFormatQualite({ source: 't_users', id, champ: 'contact', valeur_apres: '0102030405', currentUser: qualite }))
        .toThrow(/source/i);
      expect(carte(id)).toEqual(carteAvant);
      expect(anomalie(id)).toBeTruthy();
    });
  });

  describe('D. cloisonnement : le site contrôlé est celui de la fiche réellement visée', () => {
    it('anomalie d\'un autre site (carte homonyme sur le site de l\'agent) → refus, anomalie conservée', () => {
      const id = insertCollision(AUTRE_SITE);
      const avant = nbCartes();
      expect(() => queries.corrigerFormatQualite({ source: 't_import_anomalies', id, champ: 'contact', valeur_apres: '0102030405', currentUser: qualite }))
        .toThrow(/n'appartient pas à votre site/);
      expect(anomalie(id)).toBeTruthy();
      expect(nbCartes()).toBe(avant);
    });

    it('carte du site de l\'agent (anomalie homonyme sur un autre site) → autorisé, seule la carte change', () => {
      const id = insertCollision(AUTRE_SITE);
      const res = queries.corrigerFormatQualite({ source: 't_cartes', id, champ: 'contact', valeur_apres: '0102030406', currentUser: qualite });
      expect(res.success).toBe(true);
      expect(carte(id).contact).toBe('0102030406');
      expect(anomalie(id).contact).toBe('0500000000');
    });

    it('SUPER ADMIN : pas de restriction de site (comportement existant conservé)', () => {
      const id = insertCollision(AUTRE_SITE);
      const res = queries.corrigerFormatQualite({ source: 't_import_anomalies', id, champ: 'contact', valeur_apres: '0102030407', currentUser: { role: 'SUPER ADMIN', site_id: SITE_ID, id_user: 1, login: 'sa' } });
      expect(res.success).toBe(true);
      expect(carte(res.id_carte as number).site_id).toBe(AUTRE_SITE);
    });
  });

  describe('E. fonctions de date explicites (remplacent la devinette de updateDateDeNaissance)', () => {
    it('corrigerDateNaissanceCarte : ne touche jamais l\'anomalie de même numéro', () => {
      const id = insertCollision();
      const r = queries.corrigerDateNaissanceCarte(id, '1970-07-07');
      expect(r.changes).toBe(1);
      expect(carte(id).date_de_naissance).toBe('1970-07-07');
      expect(anomalie(id)).toBeTruthy();
    });

    it('transfererAnomalieVersCarte : crée une carte, supprime l\'anomalie, ne touche pas la carte de même numéro', () => {
      const id = insertCollision();
      const carteAvant = carte(id);
      const newId = queries.transfererAnomalieVersCarte(id, '1981-01-01');
      expect(newId).not.toBeNull();
      expect(newId).not.toBe(id);
      expect(carte(newId as number).date_de_naissance).toBe('1981-01-01');
      expect(anomalie(id)).toBeUndefined();
      expect(carte(id)).toEqual(carteAvant);
    });

    it('transfererAnomalieVersCarte sur un id d\'anomalie inexistant → null, rien n\'est créé', () => {
      const avant = nbCartes();
      expect(queries.transfererAnomalieVersCarte(99_999_002, '1981-01-01')).toBeNull();
      expect(nbCartes()).toBe(avant);
    });
  });
});
