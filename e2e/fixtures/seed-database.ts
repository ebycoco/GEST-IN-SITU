/**
 * e2e/fixtures/seed-database.ts
 *
 * ⚠️ CONTRAINTE D'EXÉCUTION CRITIQUE ⚠️
 * Ce module importe `better-sqlite3`, un module natif compilé contre l'ABI
 * Node.js embarquée dans Electron (NODE_MODULE_VERSION 132 pour Electron 34.x
 * au moment de l'écriture), et NON contre l'ABI du Node.js système utilisé
 * par le test-runner Playwright (ex: NODE_MODULE_VERSION 137 sous Node 24).
 *
 * Conséquence empiriquement vérifiée (spike de validation) : `require('better-sqlite3')`
 * plante avec `ERR_DLOPEN_FAILED` / "was compiled against a different Node.js version"
 * si ce fichier est exécuté tel quel sous le Node système.
 *
 * Ce fichier ne doit donc JAMAIS être importé directement par un fichier de
 * spec Playwright (lequel s'exécute sous Node système). Il doit être invoqué
 * exclusivement via `seed-runner.ts`, qui le bundle avec esbuild puis
 * l'exécute via le binaire Electron lancé en mode `ELECTRON_RUN_AS_NODE=1`
 * (même ABI native que l'application réelle, sans dépendre d'aucune API
 * `electron` comme `app`/`BrowserWindow` — voir vérification ci-dessous).
 *
 * Aucune modification de `src/main/database/connection.ts` ni de
 * `src/main/index.ts` n'a été nécessaire pour résoudre ce point : la vraie
 * fonction `runMigrations()` de `schema.ts` est appelée telle quelle, sur
 * une base SQLite neuve, garantissant un schéma de test rigoureusement
 * identique (v60) à celui de production — jamais dupliqué/dérivé.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { runMigrations } from '../../src/main/database/schema';
import { TEST_USERS } from './test-users';

export interface SeedResult {
  dbPath: string;
  siteId: number;
  centreId: number;
  userIds: Record<string, number>;
}

/**
 * Reproduit la disposition de `getDbPath()` (connection.ts) : le fichier
 * de base de données vit toujours sous `<userData>/data/gest_in_situ.db`.
 * Ce chemin n'est jamais codé en dur ailleurs — il est dérivé ici du
 * `userDataDir` fourni par l'appelant (répertoire temporaire jetable créé
 * par `seed-runner.ts` via `fs.mkdtempSync`).
 */
export function resolveDbPathFromUserData(userDataDir: string): string {
  const dataDir = join(userDataDir, 'data');
  mkdirSync(dataDir, { recursive: true });
  return join(dataDir, 'gest_in_situ.db');
}

/**
 * Seed complet : schéma réel v60 + 1 site de test + 1 centre rattaché +
 * les utilisateurs de test déclarés dans test-users.ts.
 *
 * Insertion SQL directe (pas de passage par l'outbox/sync) : la base est
 * locale, isolée, et jetable — aucune synchronisation Supabase n'est
 * souhaitée ni possible dans ce contexte de test.
 */
export function seedDatabase(userDataDir: string): SeedResult {
  const dbPath = resolveDbPathFromUserData(userDataDir);

  const db = new Database(dbPath, { timeout: 30000 });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Schéma réel de production — jamais un schéma dupliqué/dérivé.
  runMigrations(db);

  const now = Date.now();

  // ── 1 site de test permanent et actif (aucune expiration de licence) ────
  const siteResult = db
    .prepare(
      `INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id)
       VALUES (?, ?, 1, 4, 1, ?)`
    )
    .run('Site E2E Test', `E2E-SITE-${now}`, `e2e-site-${now}`);
  const siteId = siteResult.lastInsertRowid as number;

  // ── 1 centre rattaché au site de test ────────────────────────────────────
  const centreResult = db
    .prepare(
      `INSERT INTO t_centres (site_id, nom, numero, sync_id)
       VALUES (?, ?, 1, ?)`
    )
    .run(siteId, 'Centre E2E Test', `e2e-centre-${now}`);
  const centreId = centreResult.lastInsertRowid as number;

  // ── Utilisateurs de test (1 par rôle couvert dans cet incrément) ────────
  const insertUser = db.prepare(
    `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
     VALUES (@login, @hash, @role, @nom, @prenom, 1, @site_id, @centre_id, @sync_id, 0)`
  );
  const insertRole = db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)');

  const userIds: Record<string, number> = {};

  for (const testUser of TEST_USERS) {
    const result = insertUser.run({
      login: testUser.login,
      hash: testUser.passwordHash,
      role: testUser.role,
      nom: testUser.nom,
      prenom: testUser.prenom,
      site_id: siteId,
      // Les ADMINISTRATEUR_SITE n'ont pas de centre assigné en base : le centre
      // "principal" leur est résolu dynamiquement à la connexion (voir
      // authenticateUser() dans users.queries.ts). On reproduit ce même état.
      centre_id: testUser.siteOnly ? null : centreId,
      sync_id: `e2e-user-${testUser.key}-${now}`
    });
    const userId = result.lastInsertRowid as number;
    insertRole.run(userId, testUser.role);
    userIds[testUser.key] = userId;
  }

  db.close();

  return { dbPath, siteId, centreId, userIds };
}

// ─── Point d'entrée en exécution directe (via seed-runner.ts) ──────────────
// Une fois bundlé par esbuild et exécuté par `electron.exe` en mode
// ELECTRON_RUN_AS_NODE=1, ce module se comporte comme un script CLI :
// argv[2] = userDataDir. Le résultat est imprimé sur stdout, préfixé par un
// marqueur unique, pour permettre au process parent (seed-runner.ts, sous
// Node système) de le distinguer des logs electron-log qui partagent le
// même flux stdout.
const SEED_RESULT_MARKER = '__E2E_SEED_RESULT__:';

function isRunAsScript(): boolean {
  // Sous CommonJS (sortie du bundle esbuild), require.main === module
  // indique une exécution directe plutôt qu'un import.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof require !== 'undefined' && require.main === module;
}

if (isRunAsScript()) {
  const userDataDir = process.argv[2];
  if (!userDataDir) {
    console.error('[SEED] Usage: seed-database <userDataDir>');
    process.exit(1);
  }
  try {
    const result = seedDatabase(userDataDir);
    console.log(SEED_RESULT_MARKER + JSON.stringify(result));
    process.exit(0);
  } catch (err: any) {
    console.error('[SEED] Échec du seed :', err?.stack || err?.message || err);
    process.exit(1);
  }
}

export { SEED_RESULT_MARKER };
