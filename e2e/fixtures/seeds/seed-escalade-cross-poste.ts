/**
 * e2e/fixtures/seeds/seed-escalade-cross-poste.ts
 *
 * Seed dédié (agent-13, QA terrain) pour valider le correctif cross-poste des
 * escalades ABSENCE_SIGNALEE -> ABSENCE_ESCALADEE (SITE) -> RESOLU (retrouvée
 * ou PERDUE), qui ne quittaient jamais le poste local avant ce correctif.
 *
 * Topologie : 1 site ZZTEST, 2 centres (A et B, pour la vérification de
 * cloisonnement du Scénario 4), 4 comptes :
 *   - ZZTEST_OPV_A          OPERATEUR_VERIFICATION, centre A
 *   - ZZTEST_ADMIN_CENTRE_A ADMIN_CENTRE, centre A
 *   - ZZTEST_ADMIN_CENTRE_B ADMIN_CENTRE, centre B (jamais impliqué dans le
 *     scénario métier — sert uniquement à prouver qu'il ne voit jamais les
 *     données du centre A après un pull cloud réel)
 *   - ZZTEST_ADMIN_SITE     ADMINISTRATEUR_SITE (siteOnly, centre_id NULL,
 *     comme le vrai comportement — voir authenticateUser())
 *
 * Même contrainte ABI que e2e/fixtures/seed-database.ts : ce fichier importe
 * better-sqlite3 et DOIT être exécuté via le binaire Electron en mode
 * ELECTRON_RUN_AS_NODE=1 (jamais sous le Node système du test-runner
 * Playwright), après bundling esbuild — reproduit à l'identique dans le
 * spec appelant (voir bundleSeedScript/runCustomSeed dans le spec
 * absence-escalade-cross-poste-real.e2e.spec.ts).
 *
 * Relocalisé depuis le scratchpad temporaire d'une session Claude Code vers
 * cet emplacement permanent versionné du dépôt (les imports absolus vers
 * D:/... ont été convertis en imports relatifs à ce fichier).
 *
 * Exécuté deux fois (une fois par userDataDir jetable, poste 1 et poste 2) :
 * sur une base SQLite fraîche, l'auto-incrément est déterministe (schéma
 * identique, même ordre d'insertion) -> mêmes id numériques des deux côtés,
 * condition nécessaire pour que Poste 2 puisse pull-er depuis le même
 * site_id/centre_id que Poste 1 sur le projet Supabase e2e-cloud partagé.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { runMigrations } from '../../../src/main/database/schema';
import { hashPassword } from '../../../src/main/auth/local-auth';

interface SeedEscaladeResult {
  dbPath: string;
  siteId: number;
  centreAId: number;
  centreBId: number;
  opvA: { login: string; password: string; id: number };
  adminCentreA: { login: string; password: string; id: number };
  adminCentreB: { login: string; password: string; id: number };
  adminSite: { login: string; password: string; id: number };
}

const TEST_PASSWORD = 'ZZTEST_Pwd_QaTerrain_2026!';

function resolveDbPathFromUserData(userDataDir: string): string {
  const dataDir = join(userDataDir, 'data');
  mkdirSync(dataDir, { recursive: true });
  return join(dataDir, 'gest_in_situ.db');
}

export function seedEscaladeCrossPoste(userDataDir: string): SeedEscaladeResult {
  const dbPath = resolveDbPathFromUserData(userDataDir);
  const db = new Database(dbPath, { timeout: 30000 });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Schéma réel de production (jamais dupliqué/dérivé).
  runMigrations(db);

  const now = Date.now();

  const siteResult = db
    .prepare(`INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`)
    .run('ZZTEST_Site_Escalade_QA', `ZZTEST-SITE-ESCALADE-${now}`, `zztest-site-escalade-${now}`);
  const siteId = siteResult.lastInsertRowid as number;

  const centreAResult = db
    .prepare(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, 1, ?)`)
    .run(siteId, 'ZZTEST_CENTRE_A', `zztest-centre-a-escalade-${now}`);
  const centreAId = centreAResult.lastInsertRowid as number;

  const centreBResult = db
    .prepare(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, 2, ?)`)
    .run(siteId, 'ZZTEST_CENTRE_B', `zztest-centre-b-escalade-${now}`);
  const centreBId = centreBResult.lastInsertRowid as number;

  const insertUser = db.prepare(
    `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
     VALUES (@login, @hash, @role, @nom, @prenom, 1, @site_id, @centre_id, @sync_id, 0)`
  );
  const insertRole = db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)');
  const passwordHash = hashPassword(TEST_PASSWORD);

  function makeUser(login: string, role: string, nom: string, prenom: string, centreId: number | null) {
    const result = insertUser.run({
      login,
      hash: passwordHash,
      role,
      nom,
      prenom,
      site_id: siteId,
      centre_id: centreId,
      sync_id: `zztest-user-${login}-${now}`
    });
    const id = result.lastInsertRowid as number;
    insertRole.run(id, role);
    return { login, password: TEST_PASSWORD, id };
  }

  const opvA = makeUser('ZZTEST_OPV_A', 'OPERATEUR_VERIFICATION', 'ZZTEST', 'OpvA', centreAId);
  const adminCentreA = makeUser('ZZTEST_ADMIN_CENTRE_A', 'ADMIN_CENTRE', 'ZZTEST', 'AdminCentreA', centreAId);
  const adminCentreB = makeUser('ZZTEST_ADMIN_CENTRE_B', 'ADMIN_CENTRE', 'ZZTEST', 'AdminCentreB', centreBId);
  // ADMINISTRATEUR_SITE : centre_id NULL en base (comportement réel — voir
  // seed-database.ts / authenticateUser(), le centre "principal" est résolu
  // dynamiquement à la connexion).
  const adminSite = makeUser('ZZTEST_ADMIN_SITE', 'ADMINISTRATEUR_SITE', 'ZZTEST', 'AdminSite', null);

  db.close();

  return { dbPath, siteId, centreAId, centreBId, opvA, adminCentreA, adminCentreB, adminSite };
}

const SEED_RESULT_MARKER = '__SEED_ESCALADE_CROSS_POSTE_RESULT__:';

function isRunAsScript(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof require !== 'undefined' && require.main === module;
}

if (isRunAsScript()) {
  const userDataDir = process.argv[2];
  if (!userDataDir) {
    console.error('[SEED-ESCALADE] Usage: seed-escalade-cross-poste <userDataDir>');
    process.exit(1);
  }
  try {
    const result = seedEscaladeCrossPoste(userDataDir);
    console.log(SEED_RESULT_MARKER + JSON.stringify(result));
    process.exit(0);
  } catch (err: any) {
    console.error('[SEED-ESCALADE] Échec du seed :', err?.stack || err?.message || err);
    process.exit(1);
  }
}

export { SEED_RESULT_MARKER };
