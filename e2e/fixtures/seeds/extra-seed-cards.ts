/**
 * e2e/fixtures/seeds/extra-seed-cards.ts
 *
 * Seed complémentaire dédié (agent-13, QA terrain) pour
 * verification-search.e2e.spec.ts — `e2e/fixtures/seed-database.ts` ne seed
 * aucune carte (seulement site/centre/utilisateurs de base), or
 * VerificationSearchPage/RechercheView affichent un écran bloquant tant que
 * la base locale est vide. Ce script complète, sur la base DÉJÀ seedée par
 * `runSeedInElectronNode()` (site/centre/users, voir launchSeededApp), un
 * jeu de cartes ZZTEST_ dédié à chaque scénario exercé par le spec appelant,
 * plus une topologie secondaire (site B pour le cloisonnement, 2 centres
 * additionnels du site principal pour le cloisonnement cross-centre) et 2
 * comptes OPERATEUR_VERIFICATION additionnels (opv2, opv3).
 *
 * Reconstruit depuis la documentation inline et les assertions précises du
 * spec appelant (valeurs de rangement, dates, statuts) — le script original
 * (scratchpad d'une session Claude Code passée) a disparu du disque.
 *
 * Topologie de cartes créées (site principal `siteId`/`centreId`, sauf
 * mention contraire) :
 *   - dispo            : ZZTEST_DISPO KOUAME, 1990-01-15, rangement A1,
 *                         EN STOCK, contact brut '0102030405' (test 23 vérifie
 *                         l'ancien contact brut AVANT délivrance).
 *   - nonclasse        : ZZTEST_NONCLASSE YAO, 1993-04-10, rangement VIDE
 *                         (carte "NON CLASSÉE"), EN STOCK.
 *   - absente          : ZZTEST_ABSENTE AYA, 1991-02-20, EN STOCK,
 *                         statut_physique=ABSENT pré-seedé directement (pas
 *                         via signalerAbsence()) -> agent_signalement_absence
 *                         reste NULL, aligné avec le commentaire du test 20.
 *   - perdue           : ZZTEST_PERDUE ADAMA, 1988-08-08, EN STOCK,
 *                         statut_physique=PERDUE.
 *   - homonyme_alpha/beta/gamma : ZZTEST_HOMONYME ALPHA/BETA/GAMMA,
 *                         1985-06-15, rangements B1/B2/B3.
 *   - inversion        : ZZTEST_INVNOM ZZTEST_INVPRENOM (noms/prénoms
 *                         volontairement dans cet ordre), 1994-05-05,
 *                         rangement C1.
 *   - crosssite        : ZZTEST_CROSSSITE ETRANGER, 1995-01-01, rattachée à
 *                         `site2Id`/`centre2Id` (site distinct du principal).
 *   - stats2           : ZZTEST_STATS2 OPV2CARD, 1998-05-05, rangement D1,
 *                         site/centre PRINCIPAL (délivrée par opv2 pendant
 *                         le test, jamais par ce seed).
 *   - centre3_card     : ZZTEST_CENTRE3 GAMMA, 1996-03-03, rattachée à
 *                         `centre3Id` (même site principal, centre distinct
 *                         de celui de l'agent principal).
 *   - multibadge_own   : ZZTEST_MULTIBADGE OWN, 1999-09-09, rangement Z3,
 *                         rattachée à `centre3Id` (propre centre de opv3).
 *   - multibadge_other : ZZTEST_MULTIBADGE OTHER, 1999-09-09, rangement Z4,
 *                         rattachée à `centre4Id` (centre étranger à opv3).
 *
 * Même contrainte ABI que e2e/fixtures/seed-database.ts : ce fichier importe
 * better-sqlite3 et doit être exécuté via le binaire Electron en mode
 * ELECTRON_RUN_AS_NODE=1 (jamais sous le Node système du test-runner
 * Playwright), après bundling esbuild — reproduit dans le spec appelant.
 */
import Database from 'better-sqlite3';
import { join } from 'path';
import { hashPassword } from '../../../src/main/auth/local-auth';

interface ExtraSeedResult {
  site2Id: number;
  centre2Id: number;
  cardIds: Record<string, number>;
  centre3Id: number;
  centre4Id: number;
  opv2: { login: string; password: string; id: number };
  opv3: { login: string; password: string; id: number };
}

const TEST_PASSWORD = 'ZZTEST_Pwd_QaTerrain_2026!';

function dbPathOf(userDataDir: string): string {
  return join(userDataDir, 'data', 'gest_in_situ.db');
}

export function extraSeedCards(userDataDir: string, siteId: number, centreId: number): ExtraSeedResult {
  const dbPath = dbPathOf(userDataDir);
  // Base déjà créée/migrée par runSeedInElectronNode() (launchSeededApp) :
  // simple ouverture de la connexion existante, pas de runMigrations() ici.
  const db = new Database(dbPath, { timeout: 30000 });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const now = Date.now();

  // ── Site secondaire (cloisonnement, test 8) ─────────────────────────────
  const site2Id = db
    .prepare(`INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`)
    .run('ZZTEST_SITE_B', `ZZTEST-SITE-B-${now}`, `zztest-site-b-${now}`)
    .lastInsertRowid as number;
  const insertCentre = db.prepare(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, ?, ?)`);
  const centre2Id = insertCentre.run(site2Id, 'ZZTEST_CENTRE_B', 1, `zztest-centre-b-${now}`).lastInsertRowid as number;

  // ── 2 centres additionnels du SITE PRINCIPAL (cloisonnement cross-centre
  // intra-site, tests 14/15) ───────────────────────────────────────────────
  const centre3Id = insertCentre.run(siteId, 'ZZTEST_CENTRE_3', 2, `zztest-centre-3-${now}`).lastInsertRowid as number;
  const centre4Id = insertCentre.run(siteId, 'ZZTEST_CENTRE_4', 3, `zztest-centre-4-${now}`).lastInsertRowid as number;

  // ── Comptes OPERATEUR_VERIFICATION additionnels ─────────────────────────
  const passwordHash = hashPassword(TEST_PASSWORD);
  const insertUser = db.prepare(
    `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
     VALUES (@login, @hash, @role, @nom, @prenom, 1, @site_id, @centre_id, @sync_id, 0)`
  );
  const insertRole = db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)');

  function makeUser(login: string, prenom: string, userCentreId: number) {
    const id = insertUser.run({
      login, hash: passwordHash, role: 'OPERATEUR_VERIFICATION', nom: 'ZZTEST', prenom,
      site_id: siteId, centre_id: userCentreId, sync_id: `zztest-extra-user-${login}-${now}`
    }).lastInsertRowid as number;
    insertRole.run(id, 'OPERATEUR_VERIFICATION');
    return { login, password: TEST_PASSWORD, id };
  }

  const opv2 = makeUser('ZZTEST_OPV2', 'Opv2', centreId);
  const opv3 = makeUser('ZZTEST_OPV3', 'Opv3', centre3Id);

  // ── Cartes ───────────────────────────────────────────────────────────────
  const insertCarte = db.prepare(
    `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, rangement, statut, statut_physique,
       contact, num_secu, site_id, centre_id, agent_saisie, cle_doublon, cle_doublon_flex, sync_id, is_dirty,
       agent_signalement_absence, escalade_niveau)
     VALUES (@noms, @prenoms, @ddn, @rangement, @statut, @statut_physique,
       @contact, @num_secu, @site_id, @centre_id, 'SYSTEM', @cle_doublon, @cle_doublon_flex, @sync_id, 0,
       @agent_signalement_absence, @escalade_niveau)`
  );

  const cardIds: Record<string, number> = {};

  function makeCarte(
    key: string, noms: string, prenoms: string, ddn: string, rangement: string,
    opts: {
      cardSiteId?: number; cardCentreId?: number; contact?: string; numSecu?: string | null;
      statut?: string; statutPhysique?: string; agentSignalementAbsence?: string | null; escaladeNiveau?: string;
    } = {}
  ) {
    const {
      cardSiteId = siteId, cardCentreId = centreId, contact = '0100000000', numSecu = `ZZTEST-NUMSECU-${key.toUpperCase()}`,
      statut = 'EN STOCK', statutPhysique = 'OK', agentSignalementAbsence = null, escaladeNiveau = 'CENTRE'
    } = opts;
    const cleDbl = `${noms}|${prenoms}|${ddn}||${contact}`;
    const id = insertCarte.run({
      noms, prenoms, ddn, rangement, statut, statut_physique: statutPhysique,
      contact, num_secu: numSecu,
      site_id: cardSiteId, centre_id: cardCentreId,
      cle_doublon: cleDbl, cle_doublon_flex: cleDbl,
      sync_id: `zztest-extra-carte-${key}-${now}`,
      agent_signalement_absence: agentSignalementAbsence,
      escalade_niveau: escaladeNiveau
    }).lastInsertRowid as number;
    cardIds[key] = id;
    return id;
  }

  makeCarte('dispo', 'ZZTEST_DISPO', 'KOUAME', '1990-01-15', 'A1', { contact: '0102030405' });
  makeCarte('nonclasse', 'ZZTEST_NONCLASSE', 'YAO', '1993-04-10', '', { contact: '0100000010' });
  makeCarte('absente', 'ZZTEST_ABSENTE', 'AYA', '1991-02-20', 'A2', {
    contact: '0100000011', statutPhysique: 'ABSENT', agentSignalementAbsence: null, escaladeNiveau: 'CENTRE'
  });
  makeCarte('perdue', 'ZZTEST_PERDUE', 'ADAMA', '1988-08-08', 'A3', {
    contact: '0100000012', statutPhysique: 'PERDUE', escaladeNiveau: 'RESOLU'
  });
  makeCarte('homonyme_alpha', 'ZZTEST_HOMONYME', 'ALPHA', '1985-06-15', 'B1', { contact: '0100000013' });
  makeCarte('homonyme_beta', 'ZZTEST_HOMONYME', 'BETA', '1985-06-15', 'B2', { contact: '0100000014' });
  makeCarte('homonyme_gamma', 'ZZTEST_HOMONYME', 'GAMMA', '1985-06-15', 'B3', { contact: '0100000015' });
  makeCarte('inversion', 'ZZTEST_INVNOM', 'ZZTEST_INVPRENOM', '1994-05-05', 'C1', { contact: '0100000016' });
  makeCarte('crosssite', 'ZZTEST_CROSSSITE', 'ETRANGER', '1995-01-01', 'X1', {
    cardSiteId: site2Id, cardCentreId: centre2Id, contact: '0100000017'
  });
  makeCarte('stats2', 'ZZTEST_STATS2', 'OPV2CARD', '1998-05-05', 'D1', { contact: '0100000018' });
  makeCarte('centre3_card', 'ZZTEST_CENTRE3', 'GAMMA', '1996-03-03', 'E1', {
    cardCentreId: centre3Id, contact: '0100000019'
  });
  makeCarte('multibadge_own', 'ZZTEST_MULTIBADGE', 'OWN', '1999-09-09', 'Z3', {
    cardCentreId: centre3Id, contact: '0100000020'
  });
  makeCarte('multibadge_other', 'ZZTEST_MULTIBADGE', 'OTHER', '1999-09-09', 'Z4', {
    cardCentreId: centre4Id, contact: '0100000021'
  });

  db.close();

  return { site2Id, centre2Id, cardIds, centre3Id, centre4Id, opv2, opv3 };
}

const EXTRA_SEED_MARKER = '__EXTRA_SEED_RESULT__:';

function isRunAsScript(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof require !== 'undefined' && require.main === module;
}

if (isRunAsScript()) {
  const userDataDir = process.argv[2];
  const siteIdArg = process.argv[3];
  const centreIdArg = process.argv[4];
  if (!userDataDir || !siteIdArg || !centreIdArg) {
    console.error('[EXTRA-SEED-CARDS] Usage: extra-seed-cards <userDataDir> <siteId> <centreId>');
    process.exit(1);
  }
  try {
    const result = extraSeedCards(userDataDir, Number(siteIdArg), Number(centreIdArg));
    console.log(EXTRA_SEED_MARKER + JSON.stringify(result));
    process.exit(0);
  } catch (err: any) {
    console.error('[EXTRA-SEED-CARDS] Échec du seed :', err?.stack || err?.message || err);
    process.exit(1);
  }
}

export { EXTRA_SEED_MARKER };
