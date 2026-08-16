/**
 * e2e/specs/cloud/_session-refresh-shared.ts
 *
 * Helpers partagés par les 4 specs `session-refresh-*-real.e2e.spec.ts`
 * (agent-13, revalidation vivante du chantier "rafraîchissement de session",
 * commits 6c5df9f -> dcd0bb7). Voir le commentaire de tête de
 * `session-refresh-role-removed-real.e2e.spec.ts` pour le contexte complet.
 *
 * ── ADAPTATION EMPIRIQUE (contrainte RAM réelle du poste de test) ──────────
 * Conception initiale : deux instances Electron GUI réelles simultanées
 * ("Poste A" session active + "Poste B" admin), reliées via Supabase dev.
 * Constat empirique reproductible sur CE poste de test (deux tentatives
 * indépendantes, échec identique à chaque fois) : le SECOND `electron.launch()`
 * échoue systématiquement (`waitForLoadState('domcontentloaded')` dépassé,
 * 30s) dès lors qu'une première instance GUI complète (main + gpu + utility +
 * renderer, ~150-300 Mo à elle seule) tourne déjà. Cause identifiée : RAM
 * totale ~7,9 Go, ~1,4-1,5 Go SEULEMENT disponibles au moment du test (déjà
 * sous pression avant même le lancement, cf. rapport final) — cohérent avec
 * la politique Low-Memory documentée dans CLAUDE.md §2 pour le parc terrain
 * (8 Go RAM), ici rencontrée concrètement côté poste de développement/test.
 *
 * Adaptation retenue : UNE SEULE instance Electron GUI réelle ("Poste A",
 * la session dont on observe la réaction — c'est elle le sujet du test).
 * L'action admin ("Poste B") est simulée par une écriture DIRECTE sur
 * Supabase dev (`simulateAdminRoleChange` / `simulateAdminDisable`),
 * reproduisant EXACTEMENT la forme du payload que produirait le vrai chemin
 * applicatif (`updateUser()` / `deleteUser()`, users.queries.ts + outbox.
 * service.ts — payloads lus dans le code source, pas devinés). Le mécanisme
 * sous test ici (commits 6c5df9f -> dcd0bb7) est intégralement côté PULL
 * (syncUsersFromCloud, syncCurrentUserActiveStatus, refreshSecureCurrentUser,
 * invalidation fail-closed, notification renderer) — ce chantier ne modifie
 * PAS le chemin d'upload (outbox/updateUser/deleteUser, code préexistant,
 * déjà éprouvé ailleurs). Cette simulation ne teste donc PAS le chemin push
 * lui-même (limitation assumée, documentée dans le rapport final), mais
 * teste intégralement et fidèlement le chemin sous test.
 */
import type { Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import { supabaseDev } from '../../fixtures/supabase-dev-client';

export const QA_PWD = 'QaTerrain_CrossPoste_2026!';

// ── Utilitaires DB (sqlite3 CLI — même technique que qualite-offline-sync-real.e2e.spec.ts) ──
export function queryDb(dbPath: string, sql: string): string {
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' }).trim();
}

export function execDb(dbPath: string, sql: string): void {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8' });
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) execFileSync('sqlite3', [dbPath, 'SELECT 1;']);
    }
  }
  throw lastErr;
}

export async function login(window: Page, loginStr: string, password: string): Promise<void> {
  await window.getByTestId('login-input').fill(loginStr);
  await window.getByTestId('password-input').fill(password);
  await window.getByTestId('login-submit').click();
}

export async function waitLoggedIn(window: Page, timeoutMs = 20000): Promise<void> {
  await window.waitForURL((url) => !url.href.includes('#/login'), { timeout: timeoutMs });
}

export async function getNetworkState(window: Page): Promise<string> {
  const status = await window.evaluate(() => (window as any).api.sync.getStatus());
  return status?.state;
}

export async function waitForNetworkOnline(window: Page, timeoutMs: number): Promise<string> {
  const start = Date.now();
  let state = await getNetworkState(window);
  while (state !== 'ONLINE' && Date.now() - start < timeoutMs) {
    await window.waitForTimeout(1500);
    state = await getNetworkState(window);
  }
  return state;
}

/**
 * Crée un compte de test QA_TERRAIN_ localement (Poste A uniquement — voir
 * adaptation ci-dessus) ET upserte une ligne COMPLÈTE correspondante sur
 * Supabase (mêmes colonnes que le payload réel de `updateUser()`).
 */
export async function createCrossPosteUser(
  dbPathA: string,
  siteId: number,
  centreId: number,
  loginStr: string,
  role: string,
  syncId: string,
  pwdHash: string
): Promise<void> {
  execDb(
    dbPathA,
    `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty) ` +
    `VALUES ('${loginStr}', '${pwdHash}', '${role}', 'QA_TERRAIN', 'CrossPoste', 1, ${siteId}, ${centreId}, '${syncId}', 0);`
  );
  execDb(
    dbPathA,
    `INSERT INTO t_user_roles (id_user, role) VALUES ((SELECT id_user FROM t_users WHERE login='${loginStr}'), '${role}');`
  );
  const { error: uErr } = await supabaseDev.from('t_users').upsert(
    {
      sync_id: syncId,
      login: loginStr,
      password_hash: pwdHash,
      role,
      nom_user: 'QA_TERRAIN',
      prenom_user: 'CrossPoste',
      statut_actif: 1,
      site_id: siteId,
      centre_id: centreId,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'sync_id' }
  );
  if (uErr) throw new Error(`[SETUP] Échec upsert cloud t_users pour ${loginStr} : ${uErr.message}`);
  const { error: rErr } = await supabaseDev
    .from('t_user_roles')
    .upsert({ user_sync_id: syncId, role }, { onConflict: 'user_sync_id,role' });
  if (rErr) throw new Error(`[SETUP] Échec upsert cloud t_user_roles pour ${loginStr} : ${rErr.message}`);
  console.log(`[SETUP] Compte croisé créé : ${loginStr} (role=${role}, sync_id=${syncId}) — posteA local + Cloud.`);
}

/**
 * Simule le push Cloud d'un `users:update(id, { roles })` réel (Poste B),
 * reproduisant EXACTEMENT la forme des upserts produits par
 * `updateUser()`/`outbox.service.ts` (mêmes colonnes t_users, même DELETE+
 * INSERT sur t_user_roles, mêmes clés de conflit) — voir le commentaire
 * d'adaptation en tête de fichier pour le contexte de cette simulation.
 */
export async function simulateAdminRoleChange(
  syncId: string,
  loginStr: string,
  pwdHash: string,
  siteId: number,
  centreId: number,
  newRoles: string[]
): Promise<void> {
  const { error: uErr } = await supabaseDev.from('t_users').upsert(
    {
      sync_id: syncId,
      login: loginStr,
      password_hash: pwdHash,
      role: newRoles[0],
      nom_user: 'QA_TERRAIN',
      prenom_user: 'CrossPoste',
      statut_actif: 1,
      site_id: siteId,
      centre_id: centreId,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'sync_id' }
  );
  if (uErr) throw new Error(`[ADMIN-SIM] Échec upsert cloud t_users (rôle) pour ${loginStr} : ${uErr.message}`);

  const { error: delErr } = await supabaseDev.from('t_user_roles').delete().eq('user_sync_id', syncId);
  if (delErr) throw new Error(`[ADMIN-SIM] Échec delete cloud t_user_roles pour ${loginStr} : ${delErr.message}`);

  for (const r of newRoles) {
    const { error: rErr } = await supabaseDev
      .from('t_user_roles')
      .upsert({ user_sync_id: syncId, role: r }, { onConflict: 'user_sync_id,role' });
    if (rErr) throw new Error(`[ADMIN-SIM] Échec upsert cloud t_user_roles (${r}) pour ${loginStr} : ${rErr.message}`);
  }
  console.log(`[ADMIN-SIM] Poste B simulé -> ${loginStr} rôles Cloud = [${newRoles.join(', ')}] (sync_id=${syncId}).`);
}

/**
 * Simule le push Cloud d'un `users:delete(id)` réel (Poste B, désactivation) —
 * UPDATE ciblé sur `statut_actif` uniquement (même forme partielle que le
 * payload réel de `deleteUser()`), sur une ligne Cloud déjà existante et
 * complète (créée par `createCrossPosteUser`).
 */
export async function simulateAdminDisable(syncId: string, loginStr: string): Promise<void> {
  const { error } = await supabaseDev
    .from('t_users')
    .update({ statut_actif: 0, updated_at: new Date().toISOString() })
    .eq('sync_id', syncId);
  if (error) throw new Error(`[ADMIN-SIM] Échec update cloud t_users (désactivation) pour ${loginStr} : ${error.message}`);
  console.log(`[ADMIN-SIM] Poste B simulé -> ${loginStr} désactivé côté Cloud (sync_id=${syncId}).`);
}

/** Nettoyage local (Poste A) des comptes QA_TERRAIN_, avec revérification. */
export function cleanupLocalCrossPosteUsers(dbPathA: string): { remainingA: number } {
  execDb(dbPathA, `DELETE FROM t_user_roles WHERE id_user IN (SELECT id_user FROM t_users WHERE login LIKE 'QA_TERRAIN_%');`);
  execDb(dbPathA, `DELETE FROM t_users WHERE login LIKE 'QA_TERRAIN_%';`);
  return {
    remainingA: Number(queryDb(dbPathA, `SELECT COUNT(*) FROM t_users WHERE login LIKE 'QA_TERRAIN_%';`))
  };
}

/** Nettoyage Cloud (Supabase dev) des comptes QA_TERRAIN_, avec revérification. */
export async function cleanupCloudCrossPosteUsers(): Promise<{ residualUsers: number; residualRoles: number }> {
  await supabaseDev.from('t_user_roles').delete().ilike('user_sync_id', 'qa-terrain-crossposte-%');
  await supabaseDev.from('t_users').delete().ilike('login', 'QA_TERRAIN_%');
  const { count: residualUsers } = await supabaseDev
    .from('t_users').select('id_user', { count: 'exact', head: true }).ilike('login', 'QA_TERRAIN_%');
  const { count: residualRoles } = await supabaseDev
    .from('t_user_roles').select('id', { count: 'exact', head: true }).ilike('user_sync_id', 'qa-terrain-crossposte-%');
  return { residualUsers: residualUsers || 0, residualRoles: residualRoles || 0 };
}
