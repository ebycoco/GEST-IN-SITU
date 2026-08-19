/**
 * e2e/fixtures/seeds/seed-qualite-cloud-sync.ts
 *
 * Seed dédié (agent-13, QA terrain) pour
 * qualite-offline-sync-real.e2e.spec.ts — cycle cloud réel pour le portail
 * /agent-qualite (OPERATEUR_QUALITE) : complétion N° Sécu manquant,
 * correction de date invalide, fusion d'un doublon strict.
 *
 * Topologie : 1 site + 1 centre, 1 compte OPERATEUR_QUALITE par
 * userDataDir (opqA sur le Poste A seedé avec cartes, opqB sur le Poste B
 * seedé sans carte). Argument CLI n°2 (`withCards`, '1'/'0') contrôle
 * l'insertion des 4 cartes ZZTEST_QSYNC_* — seul le Poste A ("1") en reçoit,
 * le Poste B ("0") reste vierge pour valider le pull cloud.
 *
 * Cartes (Poste A uniquement) :
 *   - ZZTEST_QSYNC_SANSSECU     : num_secu vide -> Données Manquantes > Sans N° Sécu.
 *   - ZZTEST_QSYNC_DATEINVALIDE : date_de_naissance au format non-ISO
 *     ('01-01-90', 8 caractères) -> has_invalid_date=1 (trigger automatique
 *     de la migration v41, schema.ts) -> Dates Invalides ou Absentes.
 *   - ZZTEST_QSYNC_DOUBLON (dup_target) + ZZTEST_QSYNC_DOUBLON (dup_source) :
 *     même cle_doublon (noms|prenoms|ddn|lieu|contact identiques) -> Doublons
 *     Stricts. dup_target inséré EN PREMIER (id_carte plus bas) avec
 *     rangement/num_secu vides ; dup_source inséré ensuite avec
 *     rangement='QS4-SOURCE' — DoublonsView.tsx groupe par cle_doublon puis
 *     ORDER BY id_carte (cartes.queries.ts:getDoublonsStrictsPage) et prend
 *     `cards[0]` comme cible (targetCard) : la fusion doit donc bien copier
 *     rangement='QS4-SOURCE' depuis la source vers dup_target (cible),
 *     conformément à l'assertion du spec appelant.
 *
 * Reconstruit depuis la documentation inline et les assertions du spec
 * appelant — le script original (scratchpad d'une session Claude Code
 * passée) a disparu du disque.
 *
 * Même contrainte ABI que e2e/fixtures/seed-database.ts (better-sqlite3,
 * bundlé par esbuild puis exécuté via electron.exe ELECTRON_RUN_AS_NODE=1
 * — voir le spec appelant, technique dupliquée localement comme les autres
 * specs cloud de ce dossier).
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { runMigrations } from '../../../src/main/database/schema';
import { hashPassword } from '../../../src/main/auth/local-auth';

interface SeedQualiteCloudResult {
  dbPath: string;
  siteId: number;
  centreId: number;
  opqA: { login: string; password: string; id: number };
  opqB: { login: string; password: string; id: number };
  cardIds: Record<string, number>;
}

const TEST_PASSWORD = 'ZZTEST_Pwd_QaTerrain_2026!';

function resolveDbPathFromUserData(userDataDir: string): string {
  const dataDir = join(userDataDir, 'data');
  mkdirSync(dataDir, { recursive: true });
  return join(dataDir, 'gest_in_situ.db');
}

export function seedQualiteCloudSync(userDataDir: string, withCards: boolean): SeedQualiteCloudResult {
  const dbPath = resolveDbPathFromUserData(userDataDir);
  const db = new Database(dbPath, { timeout: 30000 });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Schéma réel de production (jamais dupliqué/dérivé) — base vierge, jamais
  // précédée d'un autre seed (contrairement à seed-3-centres.ts).
  runMigrations(db);

  const now = Date.now();

  const siteId = db
    .prepare(`INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`)
    .run('ZZTEST_SITE_QSYNC', `ZZTEST-SITE-QSYNC-${now}`, `zztest-site-qsync-${now}`)
    .lastInsertRowid as number;

  const centreId = db
    .prepare(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, ?, ?)`)
    .run(siteId, 'ZZTEST_CENTRE_QSYNC', 1, `zztest-centre-qsync-${now}`)
    .lastInsertRowid as number;

  const passwordHash = hashPassword(TEST_PASSWORD);
  const insertUser = db.prepare(
    `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
     VALUES (@login, @hash, @role, @nom, @prenom, 1, @site_id, @centre_id, @sync_id, 0)`
  );
  const insertRole = db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)');

  function makeUser(login: string, prenom: string) {
    const id = insertUser.run({
      login, hash: passwordHash, role: 'OPERATEUR_QUALITE', nom: 'ZZTEST', prenom,
      site_id: siteId, centre_id: centreId, sync_id: `zztest-qsync-user-${login}-${now}`
    }).lastInsertRowid as number;
    insertRole.run(id, 'OPERATEUR_QUALITE');
    return { login, password: TEST_PASSWORD, id };
  }

  const opqA = makeUser('ZZTEST_QSYNC_OPQ_A', 'OpqA');
  const opqB = makeUser('ZZTEST_QSYNC_OPQ_B', 'OpqB');

  const cardIds: Record<string, number> = {};

  if (withCards) {
    const insertCarte = db.prepare(
      `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, rangement, statut, statut_physique,
         contact, num_secu, site_id, centre_id, agent_saisie, cle_doublon, cle_doublon_flex, sync_id, is_dirty)
       VALUES (@noms, @prenoms, @ddn, @lieu, @rangement, 'EN STOCK', 'OK',
         @contact, @num_secu, @site_id, @centre_id, 'SYSTEM', @cle_doublon, @cle_doublon_flex, @sync_id, 0)`
    );

    function makeCarte(key: string, noms: string, prenoms: string, ddn: string | null, lieu: string, rangement: string, contact: string, numSecu: string | null, syncIdSuffix: string) {
      const cleDbl = `${noms}|${prenoms}|${ddn || ''}|${lieu}|${contact}`;
      const id = insertCarte.run({
        noms, prenoms, ddn, lieu, rangement,
        contact, num_secu: numSecu,
        site_id: siteId, centre_id: centreId,
        cle_doublon: cleDbl, cle_doublon_flex: cleDbl,
        sync_id: `zztest-qsync-carte-${syncIdSuffix}-${now}`
      }).lastInsertRowid as number;
      cardIds[key] = id;
      return id;
    }

    makeCarte('sans_secu', 'ZZTEST_QSYNC_SANSSECU', 'MANQUANT', '1985-05-05', '', 'QS1', '0100000091', null, 'sanssecu');
    // Date volontairement non-ISO (8 caractères, pas de tirets aux positions 5/8)
    // -> trg_cartes_invalid_date_ai (migration v41) positionne has_invalid_date=1
    // automatiquement à l'INSERT, sans intervention manuelle de ce script.
    makeCarte('date_invalide', 'ZZTEST_QSYNC_DATEINVALIDE', 'DATEINVALIDE', '01-01-90', '', 'QS2', '0100000092', '0000000000092', 'dateinvalide');
    // dup_target inséré EN PREMIER (id_carte plus bas) : voir commentaire de
    // tête de fichier sur l'ordre ORDER BY id_carte de getDoublonsStrictsPage.
    makeCarte('dup_target', 'ZZTEST_QSYNC_DOUBLON', 'DUPLIQUE', '1988-08-08', '', '', '0100000093', null, 'dupA-target');
    makeCarte('dup_source', 'ZZTEST_QSYNC_DOUBLON', 'DUPLIQUE', '1988-08-08', '', 'QS4-SOURCE', '0100000093', 'QS4-NUMSECU-SOURCE', 'dupA-source');
  }

  db.close();

  return { dbPath, siteId, centreId, opqA, opqB, cardIds };
}

const SEED_QUALITE_CLOUD_MARKER = '__SEED_QUALITE_CLOUD_RESULT__:';

function isRunAsScript(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof require !== 'undefined' && require.main === module;
}

if (isRunAsScript()) {
  const userDataDir = process.argv[2];
  const withCardsArg = process.argv[3];
  if (!userDataDir) {
    console.error('[SEED-QUALITE-CLOUD] Usage: seed-qualite-cloud-sync <userDataDir> <withCards 0|1>');
    process.exit(1);
  }
  try {
    const result = seedQualiteCloudSync(userDataDir, withCardsArg === '1');
    console.log(SEED_QUALITE_CLOUD_MARKER + JSON.stringify(result));
    process.exit(0);
  } catch (err: any) {
    console.error('[SEED-QUALITE-CLOUD] Échec du seed :', err?.stack || err?.message || err);
    process.exit(1);
  }
}

export { SEED_QUALITE_CLOUD_MARKER };
