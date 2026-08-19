/**
 * e2e/fixtures/seeds/seed-2-centres-sync.ts
 *
 * Seed dédié (agent-13, QA terrain) pour
 * two-centres-offline-sync-real.e2e.spec.ts — topologie minimale requise par
 * ce spec cloud réel : 1 site ZZTEST_SITE_SYNC, 2 centres (ZZTEST_CENTRE_A,
 * ZZTEST_CENTRE_B), 2 comptes OPERATEUR_VERIFICATION distincts (un par
 * centre). Aucune carte n'est pré-seedée : le spec crée/délivre/signale ses
 * propres cartes via l'application réelle (createCardViaApp/deliverCardViaApp
 * /signalerAbsenceViaApp, appels IPC window.api.cartes.*).
 *
 * Reconstruit depuis la documentation inline du spec appelant — le script
 * original (scratchpad d'une session Claude Code passée) a disparu du
 * disque.
 *
 * Même contrainte ABI que e2e/fixtures/seed-database.ts (better-sqlite3,
 * bundlé par esbuild puis exécuté via electron.exe ELECTRON_RUN_AS_NODE=1
 * — voir le spec appelant, technique dupliquée localement dans ce spec
 * exactement comme absence-escalade-cross-poste-real.e2e.spec.ts).
 *
 * Exécuté deux fois (une fois par userDataDir jetable, Centre A et Centre B) :
 * sur une base SQLite fraîche, l'auto-incrément est déterministe (schéma
 * identique, même ordre d'insertion) -> mêmes id numériques des deux côtés,
 * condition nécessaire pour que le Centre B puisse pull-er depuis le même
 * site_id/centre_id que le Centre A sur le projet Supabase e2e-cloud partagé.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { runMigrations } from '../../../src/main/database/schema';
import { hashPassword } from '../../../src/main/auth/local-auth';

interface Seed2CentresResult {
  dbPath: string;
  siteId: number;
  centreAId: number;
  centreBId: number;
  opvA: { login: string; password: string; id: number };
  opvB: { login: string; password: string; id: number };
}

const TEST_PASSWORD = 'ZZTEST_Pwd_QaTerrain_2026!';

function resolveDbPathFromUserData(userDataDir: string): string {
  const dataDir = join(userDataDir, 'data');
  mkdirSync(dataDir, { recursive: true });
  return join(dataDir, 'gest_in_situ.db');
}

export function seed2CentresSync(userDataDir: string): Seed2CentresResult {
  const dbPath = resolveDbPathFromUserData(userDataDir);
  const db = new Database(dbPath, { timeout: 30000 });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Schéma réel de production (jamais dupliqué/dérivé) — cette base est
  // encore vierge (contrairement à seed-3-centres.ts/seed-centrefilter.ts,
  // ce script n'est jamais précédé de runSeedInElectronNode()).
  runMigrations(db);

  const now = Date.now();

  const siteId = db
    .prepare(`INSERT INTO t_sites (nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (?, ?, 1, 4, 1, ?)`)
    .run('ZZTEST_SITE_SYNC', `ZZTEST-SITE-SYNC-${now}`, `zztest-site-sync-${now}`)
    .lastInsertRowid as number;

  const insertCentre = db.prepare(`INSERT INTO t_centres (site_id, nom, numero, sync_id) VALUES (?, ?, ?, ?)`);
  const centreAId = insertCentre.run(siteId, 'ZZTEST_CENTRE_A', 1, `zztest-2c-centre-a-${now}`).lastInsertRowid as number;
  const centreBId = insertCentre.run(siteId, 'ZZTEST_CENTRE_B', 2, `zztest-2c-centre-b-${now}`).lastInsertRowid as number;

  const passwordHash = hashPassword(TEST_PASSWORD);
  const insertUser = db.prepare(
    `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
     VALUES (@login, @hash, @role, @nom, @prenom, 1, @site_id, @centre_id, @sync_id, 0)`
  );
  const insertRole = db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)');

  function makeUser(login: string, prenom: string, centreId: number) {
    const id = insertUser.run({
      login, hash: passwordHash, role: 'OPERATEUR_VERIFICATION', nom: 'ZZTEST', prenom,
      site_id: siteId, centre_id: centreId, sync_id: `zztest-2c-user-${login}-${now}`
    }).lastInsertRowid as number;
    insertRole.run(id, 'OPERATEUR_VERIFICATION');
    return { login, password: TEST_PASSWORD, id };
  }

  const opvA = makeUser('ZZTEST_OPV_CENTRE_A', 'OpvCentreA', centreAId);
  const opvB = makeUser('ZZTEST_OPV_CENTRE_B', 'OpvCentreB', centreBId);

  db.close();

  return { dbPath, siteId, centreAId, centreBId, opvA, opvB };
}

const SEED_2_CENTRES_MARKER = '__SEED_2_CENTRES_RESULT__:';

function isRunAsScript(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof require !== 'undefined' && require.main === module;
}

if (isRunAsScript()) {
  const userDataDir = process.argv[2];
  if (!userDataDir) {
    console.error('[SEED-2CENTRES] Usage: seed-2-centres-sync <userDataDir>');
    process.exit(1);
  }
  try {
    const result = seed2CentresSync(userDataDir);
    console.log(SEED_2_CENTRES_MARKER + JSON.stringify(result));
    process.exit(0);
  } catch (err: any) {
    console.error('[SEED-2CENTRES] Échec du seed :', err?.stack || err?.message || err);
    process.exit(1);
  }
}

export { SEED_2_CENTRES_MARKER };
