/**
 * e2e/fixtures/seeds/seed-centrefilter.ts
 *
 * Seed dédié (agent-13, QA terrain) pour
 * centrefilter-total-badge.e2e.spec.ts — vérifie si le "total de cartes en
 * local" (badge d'en-tête + totalCards de RechercheView) reste au niveau
 * SITE ou est filtré à tort par CENTRE.
 *
 * Topologie (documentée dans l'en-tête du spec appelant) : 1 site
 * ZZTEST_CENTREFILTER_SITE, 3 centres :
 *   - ZZTEST_CENTRE_PRINCIPAL (numero=1, "principal") -> 30 cartes ZZTEST_
 *   - ZZTEST_CENTRE_SECOND    (numero=2, non principal) -> 12 cartes ZZTEST_
 *   - ZZTEST_CENTRE_EMPTY     (numero=3, non principal) -> 0 carte
 *   Total SITE attendu = 42.
 * 4 comptes : ZZTEST_OPV_SECOND, ZZTEST_OPV_PRINCIPAL, ZZTEST_OPQ_SECOND,
 * ZZTEST_OPV_EMPTY (voir affectations centre_id ci-dessous).
 *
 * Reconstruit depuis la documentation inline du spec appelant — le script
 * original (scratchpad d'une session Claude Code passée) a disparu du
 * disque. Les cartes n'ont pas besoin d'identité/nom individuels précis
 * (le spec ne vérifie que des COMPTES par centre_id, jamais un nom de
 * carte précis) : un simple gabarit numéroté ZZTEST_CARTE_<centre>_<n>
 * suffit à satisfaire `noms LIKE 'ZZTEST_CARTE_%'` et les comptages
 * `GROUP BY centre_id`.
 *
 * Même contrainte ABI que e2e/fixtures/seed-database.ts (better-sqlite3,
 * bundlé par esbuild puis exécuté via electron.exe ELECTRON_RUN_AS_NODE=1
 * — voir le spec appelant). Doit être seedé AVANT le lancement de l'app
 * (même précaution anti-corruption SQLite que verification-search-3centres,
 * cf. commentaire du beforeAll du spec appelant).
 */
import Database from 'better-sqlite3';
import { join } from 'path';
import { hashPassword } from '../../../src/main/auth/local-auth';

interface SeedCentreFilterResult {
  siteId: number;
  centrePrincipalId: number;
  centreSecondId: number;
  centreEmptyId: number;
  nPrincipal: number;
  nSecond: number;
  totalSite: number;
  opvSecond: { login: string; password: string; id: number };
  opvPrincipal: { login: string; password: string; id: number };
  opqSecond: { login: string; password: string; id: number };
  opvEmpty: { login: string; password: string; id: number };
}

const TEST_PASSWORD = 'ZZTEST_Pwd_QaTerrain_2026!';
const N_PRINCIPAL = 30;
const N_SECOND = 12;

function dbPathOf(userDataDir: string): string {
  return join(userDataDir, 'data', 'gest_in_situ.db');
}

export function seedCentreFilter(userDataDir: string): SeedCentreFilterResult {
  const dbPath = dbPathOf(userDataDir);
  const db = new Database(dbPath, { timeout: 30000 });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const now = Date.now();

  const siteId = db
    .prepare(`INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`)
    .run('ZZTEST_CENTREFILTER_SITE', `ZZTEST-CENTREFILTER-${now}`, `zztest-centrefilter-site-${now}`)
    .lastInsertRowid as number;

  const insertCentre = db.prepare(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, ?, ?)`);
  const centrePrincipalId = insertCentre.run(siteId, 'ZZTEST_CENTRE_PRINCIPAL', 1, `zztest-cf-principal-${now}`).lastInsertRowid as number;
  const centreSecondId = insertCentre.run(siteId, 'ZZTEST_CENTRE_SECOND', 2, `zztest-cf-second-${now}`).lastInsertRowid as number;
  const centreEmptyId = insertCentre.run(siteId, 'ZZTEST_CENTRE_EMPTY', 3, `zztest-cf-empty-${now}`).lastInsertRowid as number;

  const passwordHash = hashPassword(TEST_PASSWORD);
  const insertUser = db.prepare(
    `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
     VALUES (@login, @hash, @role, @nom, @prenom, 1, @site_id, @centre_id, @sync_id, 0)`
  );
  const insertRole = db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)');

  function makeUser(login: string, role: string, prenom: string, centreId: number) {
    const id = insertUser.run({
      login, hash: passwordHash, role, nom: 'ZZTEST', prenom,
      site_id: siteId, centre_id: centreId, sync_id: `zztest-cf-user-${login}-${now}`
    }).lastInsertRowid as number;
    insertRole.run(id, role);
    return { login, password: TEST_PASSWORD, id };
  }

  const opvSecond = makeUser('ZZTEST_OPV_SECOND', 'OPERATEUR_VERIFICATION', 'OpvSecond', centreSecondId);
  const opvPrincipal = makeUser('ZZTEST_OPV_PRINCIPAL', 'OPERATEUR_VERIFICATION', 'OpvPrincipal', centrePrincipalId);
  const opqSecond = makeUser('ZZTEST_OPQ_SECOND', 'OPERATEUR_QUALITE', 'OpqSecond', centreSecondId);
  const opvEmpty = makeUser('ZZTEST_OPV_EMPTY', 'OPERATEUR_VERIFICATION', 'OpvEmpty', centreEmptyId);

  const insertCarte = db.prepare(
    `INSERT INTO t_cartes (noms, prenoms, date_de_naissance, rangement, statut, statut_physique,
       contact, num_secu, site_id, centre_id, agent_saisie, cle_doublon, cle_doublon_flex, sync_id, is_dirty)
     VALUES (@noms, @prenoms, @ddn, @rangement, 'EN STOCK', 'OK',
       @contact, @num_secu, @site_id, @centre_id, 'SYSTEM', @cle_doublon, @cle_doublon_flex, @sync_id, 0)`
  );

  function makeCards(centreId: number, count: number, prefix: string) {
    for (let i = 1; i <= count; i++) {
      const noms = `ZZTEST_CARTE_${prefix}_${i}`;
      const prenoms = `TITULAIRE${i}`;
      const ddn = '1990-01-01';
      const contact = `010000${String(centreId).padStart(2, '0')}${String(i).padStart(2, '0')}`;
      const cleDbl = `${noms}|${prenoms}|${ddn}||${contact}`;
      insertCarte.run({
        noms, prenoms, ddn,
        rangement: `${prefix}${i}`,
        contact,
        num_secu: `ZZTEST-CF-${prefix}-${i}`,
        site_id: siteId, centre_id: centreId,
        cle_doublon: cleDbl, cle_doublon_flex: cleDbl,
        sync_id: `zztest-cf-carte-${prefix}-${i}-${now}`
      });
    }
  }

  makeCards(centrePrincipalId, N_PRINCIPAL, 'PRINC');
  makeCards(centreSecondId, N_SECOND, 'SEC');
  // centreEmptyId volontairement laissé sans carte.

  db.close();

  return {
    siteId, centrePrincipalId, centreSecondId, centreEmptyId,
    nPrincipal: N_PRINCIPAL, nSecond: N_SECOND, totalSite: N_PRINCIPAL + N_SECOND,
    opvSecond, opvPrincipal, opqSecond, opvEmpty
  };
}

const SEED_CENTREFILTER_MARKER = '__SEED_CENTREFILTER_RESULT__:';

function isRunAsScript(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof require !== 'undefined' && require.main === module;
}

if (isRunAsScript()) {
  const userDataDir = process.argv[2];
  if (!userDataDir) {
    console.error('[SEED-CENTREFILTER] Usage: seed-centrefilter <userDataDir>');
    process.exit(1);
  }
  try {
    const result = seedCentreFilter(userDataDir);
    console.log(SEED_CENTREFILTER_MARKER + JSON.stringify(result));
    process.exit(0);
  } catch (err: any) {
    console.error('[SEED-CENTREFILTER] Échec du seed :', err?.stack || err?.message || err);
    process.exit(1);
  }
}

export { SEED_CENTREFILTER_MARKER };
