import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * P1-D (audit Phase 1 du 27/09/2026) — invariants des mutations de cartes.
 * Base SQLite jetable (migrations réelles), synchro réseau coupée, données fictives.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-p1d-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

describe('Invariants cartes (P1-D)', () => {
  let connection: typeof import('../src/main/database/connection');
  let queries: typeof import('../src/main/database/queries/cartes.queries');
  let db: import('better-sqlite3').Database;
  const SITE_ID = 930;
  const qualite = { role: 'OPERATEUR_QUALITE', site_id: SITE_ID, id_user: 7, login: 'qualite.test' };

  const insertCarte = (suffix: string, extra: Record<string, string> = {}) => Number(db.prepare(`
    INSERT INTO t_cartes (site_id, noms, prenoms, date_de_naissance, lieu_de_naissance, contact, rangement, statut, sync_id, is_dirty, cle_doublon, cle_doublon_flex)
    VALUES (@site, @noms, @prenoms, '1990-01-01', 'ABIDJAN', '0700000000', 'R-1', 'EN STOCK', @sync, 0, 'OBSOLETE', 'OBSOLETE')
  `).run({ site: SITE_ID, noms: extra.noms ?? 'NOMTEST', prenoms: `PRENOM${suffix}`, sync: `sync-p1d-${suffix}` }).lastInsertRowid);
  const row = (id: number) => db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id) as any;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    queries = await import('../src/main/database/queries/cartes.queries');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_P1D', 'SITE_P1D', 1, 'site-p1d')`).run(SITE_ID);
  });

  afterAll(() => {
    connection?.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('A. updateQuickFields recalcule cle_doublon / cle_doublon_flex', () => {
    it('modification du contact → clés recalculées avec le nouveau contact', () => {
      const id = insertCarte('A');
      queries.updateQuickFields(id, { contact: '05 11 22 33 44' }, qualite);
      const c = row(id);
      expect(c.contact).toBe('0511223344');
      expect(c.cle_doublon).toBe('NOMTEST|PRENOMA|1990-01-01|ABIDJAN|0511223344');
      expect(c.cle_doublon_flex).toBe('NOMTEST|PRENOMA|1990-01-01|0511223344');
      expect(c.is_dirty).toBe(1);
    });

    it('modification des noms/lieu → clés recalculées (accents retirés, même formule que updateCarte)', () => {
      const id = insertCarte('B');
      queries.updateQuickFields(id, { noms: 'Kouamé', lieu_de_naissance: 'Bouaké' }, qualite);
      expect(row(id).cle_doublon).toBe('KOUAME|PRENOMB|1990-01-01|BOUAKE|0700000000');
    });

    it('champ hors identité (rangement) → clés inchangées (pas de réécriture inutile)', () => {
      const id = insertCarte('C');
      queries.updateQuickFields(id, { rangement: 'R-9' }, qualite);
      expect(row(id).cle_doublon).toBe('OBSOLETE');
    });

    it('deux cartes rendues identiques par correction de contact → même cle_doublon (doublon désormais détectable)', () => {
      const id1 = insertCarte('D1', { noms: 'JUMEAU' });
      const id2 = insertCarte('D2', { noms: 'JUMEAU' });
      db.prepare(`UPDATE t_cartes SET prenoms = 'MEME' WHERE id_carte IN (?, ?)`).run(id1, id2);
      queries.updateQuickFields(id1, { contact: '0101010101' }, qualite);
      queries.updateQuickFields(id2, { contact: '0101010101' }, qualite);
      expect(row(id1).cle_doublon).toBe(row(id2).cle_doublon);
    });
  });

  describe('B. updateCarte (branche anomalie) : plus de repli siteId || 1', () => {
    it('anomalie sans site_id → refus explicite, aucune carte créée sur le site 1', () => {
      const idAno = Number(db.prepare(`INSERT INTO t_import_anomalies (site_id, noms, prenoms, date_de_naissance) VALUES (NULL, 'ORPHELIN', 'X', '1991-02-02')`).run().lastInsertRowid);
      const avant = (db.prepare('SELECT COUNT(*) AS c FROM t_cartes WHERE site_id = 1').get() as { c: number }).c;
      expect(() => queries.updateCarte(idAno, { _recordType: 'AnomalieImport', noms: 'ORPHELIN' }, { role: 'SUPER ADMIN', login: 'sa' }))
        .toThrow(/sans site de rattachement/);
      expect((db.prepare('SELECT COUNT(*) AS c FROM t_cartes WHERE site_id = 1').get() as { c: number }).c).toBe(avant);
      expect(db.prepare('SELECT id FROM t_import_anomalies WHERE id = ?').get(idAno)).toBeTruthy(); // anomalie conservée
    });

    it('appel sans session → refus (le cloisonnement ne peut plus être sauté)', () => {
      const idAno = Number(db.prepare(`INSERT INTO t_import_anomalies (site_id, noms, prenoms, date_de_naissance) VALUES (?, 'SANSSESSION', 'X', '1991-02-02')`).run(SITE_ID).lastInsertRowid);
      expect(() => queries.updateCarte(idAno, { _recordType: 'AnomalieImport' })).toThrow(/Session invalide/);
    });

    it('anomalie d\'un autre site → refus (comportement existant conservé)', () => {
      const idAno = Number(db.prepare(`INSERT INTO t_import_anomalies (site_id, noms, prenoms, date_de_naissance) VALUES (?, 'AUTRESITE', 'X', '1991-02-02')`).run(SITE_ID + 1).lastInsertRowid);
      expect(() => queries.updateCarte(idAno, { _recordType: 'AnomalieImport' }, { role: 'ADMINISTRATEUR_SITE', site_id: SITE_ID, login: 'as' }))
        .toThrow(/n'appartient pas à votre site/);
    });

    it('anomalie du bon site → transférée sur SON site (pas celui de l\'appelant)', () => {
      const idAno = Number(db.prepare(`INSERT INTO t_import_anomalies (site_id, noms, prenoms, date_de_naissance) VALUES (?, 'TRANSFERT', 'OK', '1992-03-03')`).run(SITE_ID).lastInsertRowid);
      queries.updateCarte(idAno, { _recordType: 'AnomalieImport' }, { role: 'SUPER ADMIN', site_id: 1, login: 'sa' });
      const c = db.prepare(`SELECT site_id FROM t_cartes WHERE noms = 'TRANSFERT'`).get() as { site_id: number };
      expect(c.site_id).toBe(SITE_ID);
    });
  });

  describe('C. deleteCarte', () => {
    it('sans utilisateur → refus (auparavant : autorisé par défaut)', () => {
      const id = insertCarte('DEL1');
      expect(() => queries.deleteCarte(id)).toThrow(/session invalide/);
      expect(row(id).is_dirty).toBe(0);
    });

    it('OPERATEUR_SAISIE sur une carte EN STOCK → refus (comportement existant conservé)', () => {
      const id = insertCarte('DEL2');
      expect(() => queries.deleteCarte(id, { role: 'OPERATEUR_SAISIE', site_id: SITE_ID, login: 's' })).toThrow(/Rôle insuffisant/);
    });

    it('autre site → refus ; même site (QUALITE) → suppression logique + outbox DELETE', () => {
      const id = insertCarte('DEL3');
      expect(() => queries.deleteCarte(id, { role: 'OPERATEUR_QUALITE', site_id: SITE_ID + 1, login: 'q' })).toThrow();
      queries.deleteCarte(id, { role: 'OPERATEUR_QUALITE', site_id: SITE_ID, login: 'q' });
      expect(row(id).is_dirty).toBe(-1);
      const ob = db.prepare(`SELECT operation FROM t_outbox WHERE id = ?`).get('sync-p1d-DEL3') as { operation: string } | undefined;
      expect(ob?.operation).toBe('DELETE');
    });
  });

  describe('D. updateDateDeNaissance : confusion id d\'anomalie / id_carte (NON CORRIGÉ — hors périmètre autorisé)', () => {
    // it.fails : ce test décrit le comportement ATTENDU et échoue tant que le défaut existe.
    // Quand il sera corrigé, Vitest signalera ce test comme « réussi de façon inattendue ».
    it.fails('corriger la date d\'une CARTE ne doit jamais transformer une anomalie qui porte le même numéro', () => {
      const idCarte = insertCarte('COLLISION');
      db.prepare(`INSERT INTO t_import_anomalies (id, site_id, noms, prenoms, date_de_naissance) VALUES (?, ?, 'ANOMALIE', 'MEME_ID', 'invalide')`)
        .run(idCarte, SITE_ID);
      queries.updateDateDeNaissance(idCarte, '1985-05-05'); // chemin de qualite:corrigerFormat (handlers.ts:2740)
      expect(row(idCarte).date_de_naissance).toBe('1985-05-05');
      expect(db.prepare('SELECT id FROM t_import_anomalies WHERE id = ?').get(idCarte)).toBeTruthy();
    });
  });
});
