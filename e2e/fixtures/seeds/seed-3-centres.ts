/**
 * e2e/fixtures/seeds/seed-3-centres.ts
 *
 * Seed dédié (agent-13, QA terrain) pour
 * verification-search-3centres.e2e.spec.ts — topologie à 3 centres nommés
 * explicitement sur un même site :
 *   - ZZTEST_CENTRE_1 (numero=1, "principal")
 *   - ZZTEST_CENTRE_2 (numero=2, non principal)
 *   - ZZTEST_CENTRE_3 (numero=3, non principal)
 * + 1 carte par centre (ZZTEST_CARTE_C1/C2/C3) + 1 compte
 * OPERATEUR_VERIFICATION rattaché au Centre 3 (ZZTEST_OPV_CENTRE3).
 *
 * Reconstruit depuis la documentation inline du spec appelant (topologie,
 * rangements A1/B1/C1, prénoms PORTECARTE_UN/DEUX/TROIS, dates de naissance)
 * — le script original (scratchpad d'une session Claude Code passée) a
 * disparu du disque. Le mécanisme réel de cloisonnement observé par lecture
 * de code (RechercheView.tsx, isAgentAuthorisedForCard) compare uniquement
 * centre_id + site_id (égalité stricte), pas le préfixe de rangement — ce
 * dernier reste renseigné ici par cohérence documentaire uniquement.
 *
 * Même contrainte ABI que e2e/fixtures/seed-database.ts : ce fichier importe
 * better-sqlite3 et doit être exécuté via le binaire Electron en mode
 * ELECTRON_RUN_AS_NODE=1 (jamais sous le Node système du test-runner
 * Playwright), après bundling esbuild — reproduit dans le spec appelant.
 *
 * Doit être seedé AVANT le lancement de l'app (voir commentaire du
 * `test.beforeAll` du spec appelant : seeder après le lancement a provoqué,
 * de façon reproductible, un "database disk image is malformed" sur cette
 * même famille de specs).
 */
import Database from 'better-sqlite3';
import { join } from 'path';
import { hashPassword } from '../../../src/main/auth/local-auth';

interface Seed3CentresResult {
  siteId: number;
  centre1Id: number;
  centre2Id: number;
  centre3Id: number;
  cardIds: Record<string, number>;
  opvCentre3: { login: string; password: string; id: number };
}

const TEST_PASSWORD = 'ZZTEST_Pwd_QaTerrain_2026!';

function dbPathOf(userDataDir: string): string {
  return join(userDataDir, 'data', 'gest_in_situ.db');
}

export function seed3Centres(userDataDir: string): Seed3CentresResult {
  const dbPath = dbPathOf(userDataDir);
  // La base a déjà été créée/migrée par `runSeedInElectronNode()` (seed de
  // base site/centre/users) AVANT ce script — voir le beforeAll du spec
  // appelant : on ouvre donc simplement la connexion existante, sans
  // `runMigrations()` (déjà fait), ni PRAGMA supplémentaires nécessaires.
  const db = new Database(dbPath, { timeout: 30000 });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const now = Date.now();

  const siteResult = db
    .prepare(`INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`)
    .run('ZZTEST_SITE_A', `ZZTEST-SITE-3C-${now}`, `zztest-site-3c-${now}`);
  const siteId = siteResult.lastInsertRowid as number;

  const insertCentre = db.prepare(
    `INSERT INTO t_centres (site_id, nom, numero, prefixe_rangement, sync_id) VALUES (?, ?, ?, ?, ?)`
  );
  const centre1Id = insertCentre.run(siteId, 'ZZTEST_CENTRE_1', 1, 'A', `zztest-centre1-${now}`).lastInsertRowid as number;
  const centre2Id = insertCentre.run(siteId, 'ZZTEST_CENTRE_2', 2, 'B', `zztest-centre2-${now}`).lastInsertRowid as number;
  const centre3Id = insertCentre.run(siteId, 'ZZTEST_CENTRE_3', 3, 'C', `zztest-centre3-${now}`).lastInsertRowid as number;

  const passwordHash = hashPassword(TEST_PASSWORD);
  const insertUser = db.prepare(
    `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
     VALUES (@login, @hash, @role, @nom, @prenom, 1, @site_id, @centre_id, @sync_id, 0)`
  );
  const insertRole = db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)');
  const userResult = insertUser.run({
    login: 'ZZTEST_OPV_CENTRE3',
    hash: passwordHash,
    role: 'OPERATEUR_VERIFICATION',
    nom: 'ZZTEST',
    prenom: 'OpvCentre3',
    site_id: siteId,
    centre_id: centre3Id,
    sync_id: `zztest-user-opvcentre3-${now}`
  });
  const opvId = userResult.lastInsertRowid as number;
  insertRole.run(opvId, 'OPERATEUR_VERIFICATION');

  const insertCarte = db.prepare(
    `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, rangement, statut, statut_physique,
       contact, num_secu, site_id, centre_id, agent_saisie, cle_doublon, cle_doublon_flex, sync_id, is_dirty)
     VALUES (@noms, @prenoms, @ddn, @rangement, 'EN STOCK', 'OK',
       @contact, @num_secu, @site_id, @centre_id, 'SYSTEM', @cle_doublon, @cle_doublon_flex, @sync_id, 0)`
  );

  function makeCarte(noms: string, prenoms: string, ddn: string, rangement: string, centreId: number, contact: string, numSecu: string) {
    const cleDbl = `${noms}|${prenoms}|${ddn}||${contact}`;
    const result = insertCarte.run({
      noms, prenoms, ddn, rangement,
      contact, num_secu: numSecu,
      site_id: siteId, centre_id: centreId,
      cle_doublon: cleDbl, cle_doublon_flex: cleDbl,
      sync_id: `zztest-carte-${noms}-${now}`
    });
    return result.lastInsertRowid as number;
  }

  const cardIds: Record<string, number> = {
    c1: makeCarte('ZZTEST_CARTE_C1', 'PORTECARTE_UN', '1990-01-01', 'A1', centre1Id, '0100000001', 'ZZTEST-NUMSECU-C1'),
    c2: makeCarte('ZZTEST_CARTE_C2', 'PORTECARTE_DEUX', '1990-01-02', 'B1', centre2Id, '0100000002', 'ZZTEST-NUMSECU-C2'),
    c3: makeCarte('ZZTEST_CARTE_C3', 'PORTECARTE_TROIS', '1990-01-03', 'C1', centre3Id, '0100000003', 'ZZTEST-NUMSECU-C3')
  };

  db.close();

  return {
    siteId, centre1Id, centre2Id, centre3Id, cardIds,
    opvCentre3: { login: 'ZZTEST_OPV_CENTRE3', password: TEST_PASSWORD, id: opvId }
  };
}

const SEED_3_CENTRES_MARKER = '__SEED_3_CENTRES_RESULT__:';

function isRunAsScript(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof require !== 'undefined' && require.main === module;
}

if (isRunAsScript()) {
  const userDataDir = process.argv[2];
  if (!userDataDir) {
    console.error('[SEED-3CENTRES] Usage: seed-3-centres <userDataDir>');
    process.exit(1);
  }
  try {
    const result = seed3Centres(userDataDir);
    console.log(SEED_3_CENTRES_MARKER + JSON.stringify(result));
    process.exit(0);
  } catch (err: any) {
    console.error('[SEED-3CENTRES] Échec du seed :', err?.stack || err?.message || err);
    process.exit(1);
  }
}

export { SEED_3_CENTRES_MARKER };
