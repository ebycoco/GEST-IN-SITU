/**
 * e2e/fixtures/seeds/extra-seed-qualite.ts
 *
 * Seed complémentaire dédié (agent-13, QA terrain) pour
 * agent-qualite.e2e.spec.ts — `e2e/fixtures/seed-database.ts` ne seed aucune
 * carte/anomalie (seulement site/centre/utilisateurs de base). Ce script
 * complète, sur la base DÉJÀ seedée par `runSeedInElectronNode()` (voir
 * launchSeededApp), un jeu ZZTEST_ dédié à chaque scénario du portail
 * Qualité exercé par le spec appelant, plus un site B (cloisonnement, test
 * 11/13).
 *
 * Reconstruit depuis la documentation inline et les assertions précises du
 * spec appelant (requêtes exactes de cartes.queries.ts vérifiées par lecture
 * de code : getDoublonsStrictsPage/getDoublonsProbablesPage, getSansNumSecuPage,
 * getSansContactPage, getDatesVidesPage, getSansNomPage, getSansRangementPage,
 * getInvalidDateRecords) — le script original (scratchpad d'une session
 * Claude Code passée) a disparu du disque.
 *
 * Cartes t_cartes créées (site principal `siteId`/`centreId` sauf mention) :
 *   - ds_target/ds_source : ZZTEST_DOUBLONSTRICT DUPLIQUE, même cle_doublon
 *     (noms|prenoms|ddn|lieu|contact identiques) -> Doublons Stricts.
 *     ds_target (rangement/num_secu vides) inséré EN PREMIER (id plus bas,
 *     devient `targetCard = cards[0]` dans DoublonsView.tsx après le tri
 *     ORDER BY cle_doublon, id_carte de getDoublonsStrictsPage) ; ds_source
 *     porte rangement/num_secu non vides, à fusionner vers la cible.
 *   - dp_a/dp_b : ZZTEST_DOUBLONPROBABLE PROBABLE, même noms/prenoms/ddn
 *     mais lieu_de_naissance/contact distincts (donc cle_doublon distincts)
 *     -> Doublons Probables (GROUP BY noms,prenoms,ddn HAVING COUNT(DISTINCT
 *     cle_doublon) > 1).
 *   - sans_secu     : ZZTEST_SANSSECU, num_secu NULL -> Sans N° Sécu.
 *   - sans_contact  : ZZTEST_SANSCONTACT, contact NULL -> Sans Contact.
 *   - sans_date     : ZZTEST_SANSDATE, date_de_naissance='' -> Date Vide.
 *   - sans_nom      : ZZTEST_SANSNOM_CINQ en PRÉNOMS, noms='' -> Sans Nom
 *     (getSansNomPage filtre noms IS NULL/'', et matche le texte via
 *     `prenoms LIKE`).
 *   - sans_rangement: ZZTEST_SANSRANGEMENT, rangement='' -> Sans Rangement.
 *   - date_invalide : ZZTEST_DATEINVALIDE, date_de_naissance='01-01-90'
 *     (8 caractères, non-ISO mais non vide) -> Dates Invalides ou Absentes
 *     (getInvalidDateRecords, LENGTH<10) SANS matcher Date Vide (TRIM!=''),
 *     num_secu initial '0000000000001' (13 chiffres, valeur volontairement
 *     "sensible" pour le test de confirmation mot de passe).
 *   - statut_inconnu_stock : ZZTEST_STATUTINCONNU (homonyme valide, carte
 *     normale EN STOCK) -> utilisée par le test 10 (Recherche Universelle)
 *     pour prouver que "Valider et Forcer en Stock" (test 9) ne touche
 *     jamais t_cartes.
 *   - sans_lieu     : ZZTEST_SANSLIEU (carte valide) -> Recherche Universelle
 *     (test 10), doublée d'une anomalie jumelle (dual_search_anomalie
 *     ci-dessous) pour la double casquette "Carte en base" + "Anomalie à
 *     corriger" sur une même recherche.
 *   - 3 cartes ZZTEST_CROSSQUALITE_1/2/3 rattachées à `siteBId` (site
 *     distinct) -> cloisonnement (tests 11/13).
 *
 * Anomalies t_import_anomalies créées :
 *   - anomalie_generique      : ZZTEST_ANOMALIEGENERIQUE, type_anomalie
 *     générique, contact éditable en ligne.
 *   - anomalie_ligne_vide     : noms/prenoms/date_de_naissance tous '' ->
 *     filtre "Afficher uniquement lignes vides".
 *   - anomalie_statut_inconnu : ZZTEST_STATUTINCONNU, type_anomalie=
 *     'STATUT_INCONNU' (AnomaliesBrutesView.tsx: colorTheme/onForceStock
 *     conditionnés strictement sur cette valeur) -> bouton "Valider et
 *     Forcer en Stock".
 *   - dual_search_anomalie    : ZZTEST_SANSLIEU, jumelle de la carte
 *     `sans_lieu` (test 10).
 *
 * Même contrainte ABI que e2e/fixtures/seed-database.ts : ce fichier importe
 * better-sqlite3 et doit être exécuté via le binaire Electron en mode
 * ELECTRON_RUN_AS_NODE=1 (jamais sous le Node système du test-runner
 * Playwright), après bundling esbuild — reproduit dans le spec appelant.
 */
import Database from 'better-sqlite3';
import { join } from 'path';
import { hashPassword } from '../../../src/main/auth/local-auth';

interface ExtraSeedQualiteResult {
  siteBId: number;
  centreBId: number;
  cardIds: Record<string, number>;
}

const TEST_PASSWORD = 'ZZTEST_Pwd_QaTerrain_2026!';

function dbPathOf(userDataDir: string): string {
  return join(userDataDir, 'data', 'gest_in_situ.db');
}

export function extraSeedQualite(userDataDir: string, siteId: number, centreId: number): ExtraSeedQualiteResult {
  const dbPath = dbPathOf(userDataDir);
  // Base déjà créée/migrée par runSeedInElectronNode() (launchSeededApp) :
  // simple ouverture de la connexion existante, pas de runMigrations() ici.
  const db = new Database(dbPath, { timeout: 30000 });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const now = Date.now();

  // ── Site B (cloisonnement, tests 11/13) ─────────────────────────────────
  const siteBId = db
    .prepare(`INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`)
    .run('ZZTEST_QUALITE_SITE_B', `ZZTEST-QUALITE-SITE-B-${now}`, `zztest-qualite-site-b-${now}`)
    .lastInsertRowid as number;
  const centreBId = db
    .prepare(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, ?, ?)`)
    .run(siteBId, 'ZZTEST_QUALITE_CENTRE_B', 1, `zztest-qualite-centre-b-${now}`)
    .lastInsertRowid as number;

  const insertCarte = db.prepare(
    `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, rangement, statut, statut_physique,
       contact, num_secu, site_id, centre_id, agent_saisie, cle_doublon, cle_doublon_flex, sync_id, is_dirty)
     VALUES (@noms, @prenoms, @ddn, @lieu, @rangement, 'EN STOCK', 'OK',
       @contact, @num_secu, @site_id, @centre_id, 'SYSTEM', @cle_doublon, @cle_doublon_flex, @sync_id, 0)`
  );

  const cardIds: Record<string, number> = {};

  function makeCarte(
    key: string, noms: string, prenoms: string, ddn: string | null,
    opts: {
      lieu?: string; rangement?: string; contact?: string | null; numSecu?: string | null;
      cardSiteId?: number; cardCentreId?: number;
    } = {}
  ) {
    const {
      lieu = '', rangement = 'QZ1', contact = '0100000000', numSecu = `ZZTEST-NUMSECU-${key.toUpperCase()}`,
      cardSiteId = siteId, cardCentreId = centreId
    } = opts;
    const cleDbl = `${noms}|${prenoms}|${ddn || ''}|${lieu}|${contact || ''}`;
    const id = insertCarte.run({
      noms, prenoms, ddn, lieu, rangement,
      contact, num_secu: numSecu,
      site_id: cardSiteId, centre_id: cardCentreId,
      cle_doublon: cleDbl, cle_doublon_flex: cleDbl,
      sync_id: `zztest-qualite-carte-${key}-${now}`
    }).lastInsertRowid as number;
    cardIds[key] = id;
    return id;
  }

  // ── Doublons Stricts (test 1) : même identité complète, ds_target d'abord
  // (id plus bas -> cards[0] -> targetCard côté UI) ───────────────────────
  makeCarte('ds_target', 'ZZTEST_DOUBLONSTRICT', 'DUPLIQUE', '1987-07-07', {
    lieu: 'ZZLIEU', rangement: '', contact: '0100000101', numSecu: null
  });
  makeCarte('ds_source', 'ZZTEST_DOUBLONSTRICT', 'DUPLIQUE', '1987-07-07', {
    lieu: 'ZZLIEU', rangement: 'DS-RANG', contact: '0100000101', numSecu: 'ZZTEST-DS-NUMSECU'
  });

  // ── Doublons Probables (tests 2/3) : même noms/prénoms/ddn, cle_doublon
  // distincts (lieu/contact différents) ────────────────────────────────────
  makeCarte('dp_a', 'ZZTEST_DOUBLONPROBABLE', 'PROBABLE', '1986-06-06', {
    lieu: 'ZZLIEUA', rangement: 'DP-A', contact: '0100000102', numSecu: 'ZZTEST-DP-A'
  });
  makeCarte('dp_b', 'ZZTEST_DOUBLONPROBABLE', 'PROBABLE', '1986-06-06', {
    lieu: 'ZZLIEUB', rangement: 'DP-B', contact: '0100000103', numSecu: 'ZZTEST-DP-B'
  });

  // ── Données Manquantes (tests 4 à 7) ────────────────────────────────────
  makeCarte('sans_secu', 'ZZTEST_SANSSECU', 'MANQUANT', '1989-09-09', {
    rangement: 'QZ2', contact: '0100000104', numSecu: null
  });
  makeCarte('sans_contact', 'ZZTEST_SANSCONTACT', 'MANQUANT', '1989-09-10', {
    rangement: 'QZ3', contact: null, numSecu: 'ZZTEST-SANSCONTACT'
  });
  makeCarte('sans_date', 'ZZTEST_SANSDATE', 'MANQUANT', '', {
    rangement: 'QZ4', contact: '0100000105', numSecu: 'ZZTEST-SANSDATE'
  });
  // "Sans Nom" : noms VIDE, prenoms porte le texte de repérage du spec.
  makeCarte('sans_nom', '', 'ZZTEST_SANSNOM_CINQ', '1989-09-11', {
    rangement: 'QZ5', contact: '0100000106', numSecu: 'ZZTEST-SANSNOM'
  });
  makeCarte('sans_rangement', 'ZZTEST_SANSRANGEMENT', 'MANQUANT', '1989-09-12', {
    rangement: '', contact: '0100000107', numSecu: 'ZZTEST-SANSRANGEMENT'
  });

  // ── Dates Invalides (test 8) : date non-ISO mais NON vide (8 caractères,
  // LENGTH<10) -> matche getInvalidDateRecords sans matcher getDatesVidesPage.
  // num_secu initial '0000000000001' : valeur "sensible" volontaire, à
  // corriger vers '1111111111111' pendant le test (déclenche la modale mot
  // de passe sur champ sensible). ────────────────────────────────────────
  makeCarte('date_invalide', 'ZZTEST_DATEINVALIDE', 'INVALIDE', '01-01-90', {
    rangement: 'QZ6', contact: '0100000108', numSecu: '0000000000001'
  });

  // ── Homonyme valide pour STATUT_INCONNU (test 9) : jamais touchée par
  // "Valider et Forcer en Stock" (qui ne fait que supprimer l'anomalie
  // jumelle ci-dessous, sans jamais écrire dans t_cartes). ────────────────
  makeCarte('statut_inconnu_stock', 'ZZTEST_STATUTINCONNU', 'CARTESTOCK', '1990-10-10', {
    rangement: 'QZ7', contact: '0100000109', numSecu: 'ZZTEST-STATUTSTOCK'
  });

  // ── Carte valide jumelle d'une anomalie (test 10, double casquette
  // "Carte en base" + "Anomalie à corriger" sur une même recherche). ──────
  makeCarte('sans_lieu', 'ZZTEST_SANSLIEU', 'CARTEVALIDE', '1990-10-11', {
    lieu: '', rangement: 'QZ8', contact: '0100000110', numSecu: 'ZZTEST-SANSLIEU-CARD'
  });

  // ── Cloisonnement site B (tests 11/13) ──────────────────────────────────
  for (let i = 1; i <= 3; i++) {
    makeCarte(`crossqualite_${i}`, `ZZTEST_CROSSQUALITE_${i}`, 'ETRANGER', '1991-11-11', {
      rangement: `XB${i}`, contact: `010000020${i}`, numSecu: `ZZTEST-CROSSQUALITE-${i}`,
      cardSiteId: siteBId, cardCentreId: centreBId
    });
  }

  // ── t_import_anomalies ───────────────────────────────────────────────────
  const insertAnomalie = db.prepare(
    `INSERT INTO t_import_anomalies (type_anomalie, description, erreur_message, noms, prenoms,
       date_de_naissance, lieu_de_naissance, num_secu, contact, rangement, statut, site_id, sync_id, is_dirty)
     VALUES (@type_anomalie, @description, @erreur_message, @noms, @prenoms,
       @ddn, @lieu, @num_secu, @contact, @rangement, @statut, @site_id, @sync_id, 0)`
  );

  function makeAnomalie(
    key: string, noms: string, prenoms: string, ddn: string | null,
    opts: { typeAnomalie?: string; contact?: string; lieu?: string; description?: string } = {}
  ) {
    const { typeAnomalie = 'CHAMP_MANQUANT', contact = '0100000200', lieu = '', description = `Anomalie ZZTEST ${key}` } = opts;
    const id = insertAnomalie.run({
      type_anomalie: typeAnomalie,
      description,
      erreur_message: description,
      noms, prenoms, ddn, lieu,
      num_secu: null,
      contact,
      rangement: '',
      statut: 'EN STOCK',
      site_id: siteId,
      sync_id: `zztest-qualite-anomalie-${key}-${now}`
    }).lastInsertRowid as number;
    cardIds[key] = id;
    return id;
  }

  makeAnomalie('anomalie_generique', 'ZZTEST_ANOMALIEGENERIQUE', 'GENERIQUE', '1992-02-02', {
    contact: '0100000201'
  });
  // Ligne vide : noms/prenoms/date_de_naissance tous vides (filtre "Afficher
  // uniquement lignes vides", AnomaliesBrutesView.tsx).
  makeAnomalie('anomalie_ligne_vide', '', '', '', { contact: '' });
  makeAnomalie('anomalie_statut_inconnu', 'ZZTEST_STATUTINCONNU', 'ANOMALIE', '1990-10-10', {
    typeAnomalie: 'STATUT_INCONNU', contact: '0100000202'
  });
  // Anomalie jumelle de la carte valide 'sans_lieu' (même noms, test 10).
  makeAnomalie('dual_search_anomalie', 'ZZTEST_SANSLIEU', 'ANOMALIEJUMELLE', '1990-10-11', {
    contact: '0100000203'
  });

  db.close();

  return { siteBId, centreBId, cardIds };
}

const EXTRA_SEED_QUALITE_MARKER = '__EXTRA_SEED_QUALITE_RESULT__:';

function isRunAsScript(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof require !== 'undefined' && require.main === module;
}

if (isRunAsScript()) {
  const userDataDir = process.argv[2];
  const siteIdArg = process.argv[3];
  const centreIdArg = process.argv[4];
  if (!userDataDir || !siteIdArg || !centreIdArg) {
    console.error('[EXTRA-SEED-QUALITE] Usage: extra-seed-qualite <userDataDir> <siteId> <centreId>');
    process.exit(1);
  }
  try {
    const result = extraSeedQualite(userDataDir, Number(siteIdArg), Number(centreIdArg));
    console.log(EXTRA_SEED_QUALITE_MARKER + JSON.stringify(result));
    process.exit(0);
  } catch (err: any) {
    console.error('[EXTRA-SEED-QUALITE] Échec du seed :', err?.stack || err?.message || err);
    process.exit(1);
  }
}

export { EXTRA_SEED_QUALITE_MARKER };
