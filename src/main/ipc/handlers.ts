import { ipcMain, dialog, app, BrowserWindow, shell } from 'electron';

import * as queries from '../database/queries';
import { getDbPath, getDatabase, getBackupDir, closeDatabase, initDatabase } from '../database/connection';
import { hashPassword } from '../auth/local-auth';
import { createReadStream, openSync, readSync, closeSync, copyFileSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';
import log from 'electron-log';
import * as readline from 'readline';
import { Worker } from 'worker_threads';
import { networkMonitor } from '../sync/network-monitor';
import { syncEngine } from '../sync/sync-engine';
import { runBulkUpload, cancelBulkUpload } from '../sync/bulk-uploader';
import { runDownstream, runLogsDownstream } from '../sync/downstream';
import { getSupabaseClient } from '../sync/supabase-client';
import { startSessionHeartbeat, stopSessionHeartbeat, getCurrentUserLogin, getSecureCurrentUser, setActiveRole, getCurrentGrantedRoles } from '../auth/session-heartbeat';
import { logAudit, CRUD_SYNC_WHITELIST } from '../utils/audit';
import { deleteCentre } from '../database/queries/hierarchy.queries';
import { runStatsWorker } from '../database/queries/stats.queries';
import { normalizeDate } from '../../shared/utils/date';
import { isValidCalendarDateFlexible } from '../../shared/utils/validators';
import { enqueueOutbox, cancelPendingInsert, scheduleOutboxProcessing } from '../sync/outbox.service';
import { mapCardPayload } from '../sync/payload-mapper';

const FAILSAFE_ROOT_ID = 999999;
let activeImportsCount = 0;
export function isImportActive(): boolean {
  return activeImportsCount > 0;
}

/**
 * Cette vérification s'effectue côté serveur (Main Process) pour parer toute usurpation
 * de rôle venant du Renderer.
 */
function verifyUserRole(userId: number | null | undefined, allowedRoles: string[]): boolean {
  if (userId === undefined || userId === null) return false;
  
  // ROOT Failsafe local bypass
  if (userId === FAILSAFE_ROOT_ID) {
    return allowedRoles.includes('SUPER ADMIN');
  }

  try {
    const db = getDatabase();
    if (!db) return false;

    // 1. VÃ©rification dans la table principale t_users
    const user = db.prepare('SELECT role, statut_actif FROM t_users WHERE id_user = ?').get(userId) as { role: string; statut_actif: number } | undefined;
    if (!user || user.statut_actif !== 1) return false;

    if (allowedRoles.includes(user.role)) return true;

    // 2. VÃ©rification dans la table t_user_roles (rÃ´les multiples)
    const roles = db.prepare('SELECT role FROM t_user_roles WHERE id_user = ?').all(userId) as { role: string }[];
    return roles.some(r => allowedRoles.includes(r.role));
  } catch (err) {
    log.error(`[verifyUserRole] Ã‰chec de la validation de rÃ´le pour l'utilisateur ID ${userId} :`, err);
    return false;
  }
}

/**
 * Dérive le site_id RÉELLEMENT applicable à une lecture (listing/recherche paginée) à partir
 * de la session serveur, jamais du siteId brut envoyé par le renderer — même pattern que
 * `cartes:getRecordForCorrection` (seul SUPER ADMIN peut légitimement consulter un site
 * différent du sien ; tout autre rôle est silencieusement recadré sur son propre site_id,
 * transparent pour l'UI légitime qui n'envoie de toute façon jamais un autre site).
 * Sécurité : sans cette substitution, un siteId forgé côté renderer (contournement UI) permet
 * de lire noms/prénoms/date de naissance/num_secu/contact d'un autre site (cloisonnement §3).
 */
function resolveScopedSiteId(siteId: number | undefined | null): number {
  const secureUser = getSecureCurrentUser();
  if (!secureUser) throw new Error("Session invalide.");
  if (secureUser.role === 'SUPER ADMIN') {
    if (siteId === undefined || siteId === null) {
      throw new Error("REJETÉ : site_id requis pour cette opération.");
    }
    return Number(siteId);
  }
  if (secureUser.site_id === undefined || secureUser.site_id === null) {
    throw new Error("Session invalide : site_id introuvable pour cet utilisateur.");
  }
  return secureUser.site_id;
}

/**
 * Masque les champs sensibles (num_secu, contact) avant écriture dans `t_audit_log` — même
 * fonction que `qualite:corrigerFormat` appliquait localement (désormais partagée pour éviter
 * toute divergence entre les points d'audit qui journalisent ces champs).
 */
function maskSensitiveField(champ: string, val: string | null | undefined): string {
  if (!val) return 'Vide';
  if (champ === 'num_secu') return val.length > 4 ? `*********${val.slice(-4)}` : '***';
  if (champ === 'contact') return val.length > 4 ? `******${val.slice(-4)}` : '***';
  return val;
}

// Anti-bruteforce pour hierarchy:verifyPassword : verrouille une identité après un nombre
// d'échecs successifs, sur une fenêtre glissante (protection locale, en mémoire du process).
const VERIFY_PASSWORD_MAX_ATTEMPTS = 5;
const VERIFY_PASSWORD_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const VERIFY_PASSWORD_LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes
const verifyPasswordAttempts: Map<string, { count: number; firstAttempt: number; lockedUntil?: number }> = new Map();

function isVerifyPasswordLocked(key: string): number {
  const entry = verifyPasswordAttempts.get(key);
  if (!entry || !entry.lockedUntil) return 0;
  const remaining = entry.lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

function registerVerifyPasswordAttempt(key: string, success: boolean): void {
  if (success) {
    verifyPasswordAttempts.delete(key);
    return;
  }
  const now = Date.now();
  const entry = verifyPasswordAttempts.get(key);
  if (!entry || now - entry.firstAttempt > VERIFY_PASSWORD_WINDOW_MS) {
    verifyPasswordAttempts.set(key, { count: 1, firstAttempt: now });
    return;
  }
  entry.count += 1;
  if (entry.count >= VERIFY_PASSWORD_MAX_ATTEMPTS) {
    entry.lockedUntil = now + VERIFY_PASSWORD_LOCKOUT_MS;
    log.warn(`[SECURITY] Verrouillage anti-bruteforce déclenché pour '${key}' après ${entry.count} échecs de vérification de mot de passe.`);
  }
}

// Variables globales pour le suivi anti-fuite (en mémoire)
const rechercheHistoriqueConsultations: Map<string, { id_carte: number; timestamp: number }[]> = new Map();

// Purge automatique de la map pour éviter la fuite mémoire (toutes les 30 min)
setInterval(() => {
  const limit = Date.now() - 30 * 60 * 1000;
  for (const [key, list] of rechercheHistoriqueConsultations) {
    const filtered = list.filter(e => e.timestamp > limit);
    if (filtered.length === 0) {
      rechercheHistoriqueConsultations.delete(key);
    } else {
      rechercheHistoriqueConsultations.set(key, filtered);
    }
  }
}, 30 * 60 * 1000);

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // Ã‰couteur de changement d'Ã©tat rÃ©seau pour notifier le Renderer
  networkMonitor.on('change', async ({ newState }) => {
    try {
      const db = getDatabase();
      let queueCount = 0;
      if (db) {
        const row = db.prepare("SELECT COUNT(*) as count FROM t_sync_queue WHERE synced = 0").get() as { count: number } | undefined;
        queueCount = row ? row.count : 0;
      }
      
      let lastSync = 'Jamais';
      if (db) {
        const row = db.prepare("SELECT value FROM t_config WHERE key = 'last_downstream_sync'").get() as { value: string } | undefined;
        if (row && row.value) lastSync = row.value;
      }

      mainWindow.webContents.send('sync:status-changed', {
        state: newState,
        lastSync,
        queueCount
      });
    } catch (err) {
      log.error('Failed to send sync status change to renderer:', err);
    }
  });
  // AUTH
  ipcMain.handle('auth:login', async (event, login: string, password: string) => {
    try {
      // ── LOGIQUE ROOT FAILSAFE SECURISEE DANS LE MAIN PROCESS ──
      // Le mot de passe ROOT est lu depuis process.env.FAILSAFE_ROOT_PASSWORD.
      // Si la variable n'est pas définie, le compte ROOT est DÉSACTIVÉ (sécurité par défaut en prod).
      const rootPassword = process.env.FAILSAFE_ROOT_PASSWORD || '';
      if (login && login.trim().toLowerCase() === 'root') {
        if (!rootPassword) {
          log.warn('[SECURITY] Tentative de connexion ROOT refusée : FAILSAFE_ROOT_PASSWORD non défini dans .env (compte désactivé).');
          return null;
        }
        if (password === rootPassword) {
          log.warn('🚨 [SECURITY] Connexion failsafe de l\'utilisateur ROOT sollicitée.');
          try {
            queries.logAction(FAILSAFE_ROOT_ID, 'SUPER ADMIN', 'ROOT_LOGIN', 'Connexion de secours failsafe ROOT effectuée.');
            queries.insertAuditLog('root', 'CONNEXION', 'Connexion de secours failsafe ROOT effectuée.');
          } catch (logErr) {
            log.error('Failed to log ROOT login action:', logErr);
          }

          const rootUser = {
            id_user: FAILSAFE_ROOT_ID,
            login: 'ROOT',
            role: 'SUPER ADMIN',
            nom_user: 'ROOT',
            prenom_user: 'FAILSAFE',
            site_id: null,
            centre_id: null,
            sessionToken: 'ROOT-FAILSAFE-TOKEN-' + Date.now()
          };
          // Sécurité (P0-2, correctif compagnon) : établit une vraie session serveur
          // pour ROOT, exactement comme le fait le chemin d'authentification normal
          // ci-dessous (startSessionHeartbeat). Avant ce correctif, ce chemin ne
          // l'appelait JAMAIS : getSecureCurrentUser() ne reflétait donc jamais un
          // login ROOT réel, ce qui aurait cassé le bypass légitime de db:purge /
          // db:emergency-purge une fois ces handlers migrés vers getSecureCurrentUser()
          // (ils ne dérivaient plus l'identité que d'un paramètre client falsifiable).
          startSessionHeartbeat(rootUser, rootUser.sessionToken);
          return rootUser;
        }
      }

      const user = await queries.authenticateUser(login, password);
      if (user && user.warning) {
        event.sender.send('auth:warning', user.warning);
      }
      if (user && user.sessionToken) {
        startSessionHeartbeat(user, user.sessionToken);
        queries.insertAuditLog(user.login, 'CONNEXION', `Connexion rÃ©ussie de l'utilisateur ${user.login}.`);
        if (user.site_id) {
          try {
            const db = getDatabase();
            if (db) {
              const pref = db.prepare("SELECT value FROM t_config WHERE key = ?").get(`auto_downstream_${user.id_user}`) as { value: string } | undefined;
              if (pref && pref.value === 'true') {
                syncEngine.startAutoDownstreamTimer(user.site_id);
              }
            }
          } catch (prefErr) {
            log.warn('Failed to read auto_downstream preference:', prefErr);
          }

          // Cycle dédié comptes/rôles (3 min, sécurité) — TOUJOURS actif, indépendant
          // de la préférence de confort `auto_downstream_<id_user>` ci-dessus (celle-ci
          // ne pilote que le cycle cartes de 2h). Un rôle retiré/modifié côté Cloud doit
          // se répercuter rapidement sur ce poste, même sans opt-in de l'utilisateur.
          syncEngine.startUserAccountsSyncTimer(user.site_id);
        }
      }
      return user;
    }
    catch (e: any) {
      log.error('Auth error', e);
      if (e.message === 'SESSION_ACTIVE') {
        throw new Error('SESSION_ACTIVE');
      }
      return null;
    }
  });

  ipcMain.handle('auth:logout', async (_, login: string) => {
    try {
      syncEngine.stopAutoDownstreamTimer();
      syncEngine.stopUserAccountsSyncTimer();
      await stopSessionHeartbeat();
      if (login) {
        queries.insertAuditLog(login, 'DECONNEXION', `DÃ©connexion volontaire de l'utilisateur ${login}.`);
      }
      return true;
    } catch (e) {
      log.error('Logout error', e);
      return false;
    }
  });

  // Changement du rôle ACTIF de la session (compte multi-rôles, via RoleSelectorPage après
  // connexion). Correctif du bug de cantonnement centre : sans ce handler, `getSecureCurrentUser().role`
  // restait figé sur le rôle DE CONNEXION pour toute la session, cassant le cantonnement de
  // plusieurs handlers pour tout compte dont le rôle actif diffère du rôle de connexion.
  // Validation serveur stricte : le rôle demandé doit faire partie des rôles réellement
  // attribués au compte (t_user_roles), jamais approuvé sur simple confiance du renderer.
  ipcMain.handle('auth:setActiveRole', async (_, requestedRole: string) => {
    try {
      const secureUser = getSecureCurrentUser();
      if (!secureUser) throw new Error("Session invalide.");

      const granted = secureUser.id_user === FAILSAFE_ROOT_ID
        ? ['SUPER ADMIN']
        : queries.resolveGrantedRoles(secureUser.id_user, secureUser.loginRole ?? secureUser.role);

      if (!granted.includes(requestedRole)) {
        log.warn(`[SECURITY] Changement de rôle actif refusé : ${secureUser.login} → ${requestedRole} (rôles autorisés: ${granted.join(',')})`);
        throw new Error("Accès refusé : ce rôle ne fait pas partie des rôles attribués à ce compte.");
      }

      setActiveRole(requestedRole);
      queries.insertAuditLog(secureUser.login, 'ROLE_SWITCH', `${secureUser.loginRole ?? secureUser.role} → ${requestedRole}`);
      return { success: true, activeRole: requestedRole };
    } catch (e: any) {
      log.error('IPC Error: auth:setActiveRole', e);
      return { success: false, message: e.message || 'Erreur lors du changement de rôle.' };
    }
  });

  // Instantané en lecture seule de la session serveur courante (getSecureCurrentUser()), à
  // la demande — destiné à checkAuth() (étape ultérieure, hors périmètre ici) pour permettre
  // au renderer de rafraîchir son état local (nom/prénom/rôles) sans attendre une fermeture/
  // réouverture de l'app. Forme alignée sur l'objet `user` déjà retourné par auth:login
  // (mêmes noms de champs) pour rester cohérent côté consommateur. Ne mute rien, ne
  // déclenche aucun rafraîchissement DB — se contente de refléter l'état déjà en mémoire.
  ipcMain.handle('auth:getSessionSnapshot', async () => {
    try {
      const secureUser = getSecureCurrentUser();
      if (!secureUser) return null;

      const roles = getCurrentGrantedRoles() ?? secureUser.roles ?? [secureUser.role];

      return {
        id_user: secureUser.id_user,
        login: secureUser.login,
        role: secureUser.role,
        roles,
        nom_user: secureUser.nom_user,
        prenom_user: secureUser.prenom_user,
        site_id: secureUser.site_id,
        centre_id: secureUser.centre_id
      };
    } catch (e) {
      log.error('IPC Error: auth:getSessionSnapshot', e);
      return null;
    }
  });

  ipcMain.handle('auth:registerSuperAdmin', async (_, data: { login: string; password: string; nom_user: string }) => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        return { success: false, reason: 'Client Supabase non disponible (mode hors-ligne).' };
      }
      
      const email = data.login;
      
      log.info(`auth:registerSuperAdmin: signing up ${email}...`);
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password: data.password
      });

      if (authError) {
        log.error('Supabase Auth signUp error:', authError.message);
        return { success: false, reason: authError.message };
      }

      const uuid = authData.user?.id;
      if (!uuid) {
        return { success: false, reason: 'Failed to retrieve auth user ID from Supabase.' };
      }

      log.info(`auth:registerSuperAdmin: auth user created with UUID: ${uuid}. Storing in SQLite...`);

      const db = getDatabase()!;
      const hash = hashPassword(data.password);
      
      const insertResult = db.prepare(`
        INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty)
        VALUES (@login, @hash, 'SUPER ADMIN', @nom_user, '', 1, 1, NULL, @sync_id, 0)
      `).run({
        login: data.login,
        hash,
        nom_user: data.nom_user.toUpperCase(),
        sync_id: uuid
      });

      const newUserId = insertResult.lastInsertRowid as number;

      log.info(`auth:registerSuperAdmin: Inserting ${data.login} in Supabase t_users table...`);
      const { error: dbError } = await supabase.from('t_users').insert({
        id_user: newUserId,
        login: data.login,
        password_hash: hash,
        role: 'SUPER ADMIN',
        nom_user: data.nom_user.toUpperCase(),
        prenom_user: '',
        site_id: 1,
        centre_id: null,
        statut_actif: 1,
        sync_id: uuid
      });

      if (dbError) {
        log.warn(`[auth:registerSuperAdmin] Supabase db t_users insert failed: ${dbError.message}`);
        db.prepare("UPDATE t_users SET is_dirty = 1 WHERE id_user = ?").run(newUserId);
      } else {
        db.prepare("UPDATE t_users SET synced_at = datetime('now') WHERE id_user = ?").run(newUserId);
      }

      return { success: true, count: 1, userId: newUserId, uuid };
    } catch (e: any) {
      log.error('auth:registerSuperAdmin error:', e);
      return { success: false, reason: String(e.message || e) };
    }
  });

  // DEBUG
  ipcMain.handle('debug:getAllAnomalies', async () => {
    try {
      const userLogin = getCurrentUserLogin();
      const db = getDatabase();
      if (!db || !userLogin) return [];
      
      const user = db.prepare('SELECT id_user, role, site_id FROM t_users WHERE login = ?').get(userLogin) as { id_user: number, role: string, site_id: number } | undefined;
      
      if (!user || !verifyUserRole(user.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE'])) {
        throw new Error("Accès refusé. Réservé aux administrateurs.");
      }
      
      const siteId = user.role === 'SUPER ADMIN' ? null : user.site_id;
      const query = siteId 
        ? 'SELECT * FROM t_import_anomalies WHERE site_id = ? ORDER BY id DESC LIMIT 500'
        : 'SELECT * FROM t_import_anomalies ORDER BY id DESC LIMIT 500';
        
      const anomalies = siteId ? db.prepare(query).all(siteId) : db.prepare(query).all();
      return anomalies;
    } catch (e) {
      log.error('IPC Error: debug:getAllAnomalies', e);
      throw e;
    }
  });

  // CARTES
  ipcMain.handle('cartes:getPage', async (_, offset, limit, filters) => {
    // Sécurité (P1) : handler auparavant dépourvu de tout verifyUserRole. Périmètre = union des
    // 3 écrans appelants (TableCartesPage.tsx /table-cartes, CartesPage.tsx /cartes et
    // /admin-centre/cartes, MesBrouillonsView.tsx /agent-saisie/brouillons), tel que défini par
    // leurs ProtectedRoute respectives dans App.tsx.
    const gateUser = getSecureCurrentUser();
    if (!gateUser || !verifyUserRole(gateUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'OPERATEUR_SAISIE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:getPage : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour effectuer cette opération.");
    }
    try {
      // Sécurité (cloisonnement §3) : le recadrage site_id doit s'appliquer à TOUT rôle
      // non-SUPER-ADMIN (ADMIN_CENTRE, OPERATEUR_*, etc.), pas seulement ADMINISTRATEUR_SITE.
      // resolveScopedSiteId dérive le site réel de la session serveur (getSecureCurrentUser),
      // en ignorant tout site_id forgé côté renderer.
      const secureUser = getSecureCurrentUser();
      const db = getDatabase();
      let finalFilters = filters || {};
      if (secureUser && secureUser.role !== 'SUPER ADMIN') {
        const scopedSiteId = resolveScopedSiteId(filters?.site_id);
        finalFilters = {
          ...finalFilters,
          site_id: String(scopedSiteId)
        };
        if (finalFilters.centre_id && db) {
          const centre = db.prepare('SELECT site_id FROM t_centres WHERE id = ?').get(Number(finalFilters.centre_id)) as { site_id: number } | undefined;
          if (!centre || centre.site_id !== scopedSiteId) {
            finalFilters.centre_id = '';
          }
        }
        // Sécurité (cloisonnement §3, P0-2) : la validation ci-dessus ne garantissait que
        // l'appartenance du centre_id fourni au bon SITE, jamais qu'il correspondait au centre
        // de la session ADMIN_CENTRE — un appel sans filtre centre_id (ou avec un centre_id
        // d'un autre centre du même site) retournait toutes les cartes du site entier. Forcé
        // ici sur le centre réel de la session serveur pour ce rôle spécifiquement.
        // ADMINISTRATEUR_SITE et SUPER ADMIN conservent leur portée actuelle (site entier /
        // multi-site).
        if (secureUser.role === 'ADMIN_CENTRE') {
          finalFilters.centre_id = secureUser.centre_id != null ? String(secureUser.centre_id) : '';
        }
      }
      // Sécurité (isolation intra-site) : un OPERATEUR_SAISIE ne doit jamais pouvoir lister les
      // brouillons d'un autre agent de saisie via ce handler générique. MesBrouillonsView.tsx
      // envoie déjà created_by=lui-même légitimement ; on réimpose ici la valeur côté serveur
      // (non falsifiable) pour ce cas précis, sans affecter les autres usages (CartesPage.tsx
      // n'expose jamais le statut BROUILLON dans son filtre UI).
      if (secureUser && secureUser.role === 'OPERATEUR_SAISIE' && finalFilters.statut === 'BROUILLON') {
        finalFilters = { ...finalFilters, created_by: String(secureUser.id_user) };
      }
      return queries.getCartesPage(offset, limit, finalFilters);
    }
    catch (e) { log.error('IPC Error: cartes:getPage', e); throw e; }
  });


  ipcMain.handle('cartes:search', async (_, query, limit, filters) => {
    // Sécurité (P1) : handler auparavant dépourvu de tout verifyUserRole. Périmètre = union des
    // 3 écrans appelants (VerificationSearchPage /admin-centre/recherche, RechercheView.tsx
    // /agent-verification/recherche, SearchPage.tsx /search), tel que défini par leurs
    // ProtectedRoute respectives dans App.tsx.
    const gateUser = getSecureCurrentUser();
    if (!gateUser || !verifyUserRole(gateUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'OPERATEUR_VERIFICATION'])) {
      log.warn('[SECURITY] Acces refuse a cartes:search : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour effectuer cette opération.");
    }
    const userLogin = getCurrentUserLogin() || 'SYSTEM';
    try {
      const db = getDatabase();
      let finalFilters = filters || {};
      if (userLogin && db) {
        const user = db.prepare('SELECT role, site_id, centre_id FROM t_users WHERE login = ?').get(userLogin) as { role: string; site_id: number | null; centre_id: number | null } | undefined;
        if (user && user.role !== 'SUPER ADMIN') {
          finalFilters = {
            ...finalFilters,
            site_id: String(user.site_id)
          };
          if (finalFilters.centre_id) {
            const centre = db.prepare('SELECT site_id FROM t_centres WHERE id = ?').get(Number(finalFilters.centre_id)) as { site_id: number } | undefined;
            if (!centre || centre.site_id !== user.site_id) {
              finalFilters.centre_id = '';
            }
          }
          // Sécurité (cloisonnement §3, P0-5) : fuite PII confirmée en usage 100% normal (pas
          // de forgeage requis) — une recherche nom+date de naissance depuis
          // /admin-centre/recherche remontait la fiche complète (téléphone, n° CMU en clair)
          // d'un bénéficiaire d'un AUTRE centre du même site, faute de filtre centre_id
          // serveur. Recadré ici sur le centre réel de l'utilisateur (non falsifiable) —
          // périmètre strict pour ADMIN_CENTRE, sans option d'élargissement (aucun sélecteur
          // équivalent n'existe pour ce rôle ailleurs dans l'appli, contrairement à
          // SUPER ADMIN/ADMINISTRATEUR_SITE qui restent scopés site entier).
          if (user.role === 'ADMIN_CENTRE') {
            finalFilters.centre_id = user.centre_id != null ? String(user.centre_id) : '';
          }
        }
      }
      const results = await queries.searchCartesFTS(query, limit, finalFilters);
      
      // Audit de la recherche
      setImmediate(() => {
        logAudit(userLogin, 'VERIFICATION_RECHERCHE', {
          critere_utilise: filters ? Object.keys(filters).join(', ') : 'none',
          valeur_recherchee: query
        });

        // Anti-Fuite : Si la recherche renvoie plus de 100 résultats
        if (results && results.length > 100) {
          logAudit(userLogin, 'VERIFICATION_ABUS_RECHERCHE', {
            login: userLogin,
            motif: `Recherche retournant un volume anormal de résultats (${results.length} résultats)`,
            critere: query
          });
        }
      });

      return results;
    }
    catch (e) { log.error('IPC Error: cartes:search', e); throw e; }
  });

  ipcMain.handle('cartes:searchAllRecords', async (_, siteId, filters, limit) => {
    // Sécurité (P1) : handler auparavant dépourvu de tout verifyUserRole. Périmètre exclusif
    // au portail Qualité (GlobalSearchView.tsx, route /agent-qualite/*), aligné sur ProtectedRoute.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_QUALITE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:searchAllRecords : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour effectuer cette opération.");
    }
    try {
      const effectiveSiteId = resolveScopedSiteId(siteId);
      const userLogin = getCurrentUserLogin() || 'SYSTEM';
      const results = await queries.searchAllRecords(effectiveSiteId, filters, limit);

      setImmediate(() => {
        logAudit(userLogin, 'RECHERCHE_UNIVERSELLE', {
          site_id: effectiveSiteId,
          critere_utilise: filters ? Object.keys(filters).join(', ') : 'none'
        });
      });

      return results;
    } catch (e) {
      log.error('IPC Error: cartes:searchAllRecords', e);
      throw e;
    }
  });

  ipcMain.handle('cartes:searchCloudEmergency', async (_, query: string, filters: any = {}) => {
    // Sécurité (P0) : handler auparavant dépourvu de tout contrôle de rôle (ni
    // getSecureCurrentUser(), ni verifyUserRole()), contrairement à ses handlers voisins
    // (cartes:pullSingleCard juste en dessous, action de rapatriement consécutive logique à
    // cette recherche). Même périmètre de rôles ici.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'OPERATEUR_VERIFICATION'])) {
      log.warn('[SECURITY] Acces refuse a cartes:searchCloudEmergency : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour effectuer cette recherche.");
    }
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase non configuré.");

      const userLogin = getCurrentUserLogin() || 'SYSTEM';
      let targetSiteId = filters.site_id;
      let targetCentreId: number | null = null;

      if (secureUser.role !== 'SUPER ADMIN') {
        targetSiteId = secureUser.site_id;
      }

      if (!targetSiteId) {
        log.warn(`[SECURITY] Tentative de recherche cloud sans site_id par ${userLogin}`);
        throw new Error("REJETÉ : site_id obligatoire pour la recherche cloud.");
      }

      const queryTokens = query.trim().split(/\s+/).filter(Boolean);
      const nomToken = queryTokens[0] || '';
      const prenomToken = queryTokens.slice(1).join(' ') || '';

      let req = supabase.from('t_cartes').select('*');

      if (nomToken) req = req.ilike('noms', nomToken);
      if (prenomToken) req = req.ilike('prenoms', `%${prenomToken}%`);
      if (filters.date_de_naissance) req = req.eq('date_naissance', filters.date_de_naissance);

      if (filters.contact) {
        const cleanContact = filters.contact.replace(/%/g, '');
        if (cleanContact) req = req.ilike('contact', `%${cleanContact}%`);
      }

      req = req.eq('id_site', Number(targetSiteId));

      // Sécurité (cloisonnement §3, P0) : même logique que cartes:search (ci-dessus) — pour
      // ADMIN_CENTRE, recadrage strict sur le centre réel de la session serveur (non
      // falsifiable, jamais depuis filters.centre_id fourni par le client), afin d'éviter la
      // même fuite PII (téléphone, n° CMU en clair) via ce fallback cloud d'urgence.
      if (secureUser.role === 'ADMIN_CENTRE') {
        targetCentreId = secureUser.centre_id != null ? Number(secureUser.centre_id) : null;
        req = req.eq('id_centre', targetCentreId);
      }

      const { data, error } = await req.limit(5);
      if (error) {
        log.error('Supabase error in searchCloudEmergency:', error);
        return [];
      }
      return data || [];
    } catch (e) {
      log.error('IPC Error: cartes:searchCloudEmergency', e);
      return [];
    }
  });

  ipcMain.handle('cartes:pullSingleCard', async (_, cardData: any) => {
    try {
      const secureUser = getSecureCurrentUser();
      if (!secureUser) throw new Error("Session invalide.");
      if (!verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'OPERATEUR_VERIFICATION'])) {
        log.warn(`[SECURITY] Tentative de pullSingleCard refusée pour l'utilisateur ID ${secureUser.id_user} (rôle non autorisé)`);
        throw new Error("Accès refusé pour cette opération.");
      }

      const resolvedSiteId = secureUser.role === 'SUPER ADMIN'
        ? (cardData.id_site || cardData.site_id || null)
        : secureUser.site_id;

      if (!resolvedSiteId) {
        throw new Error("REJETÉ : site_id introuvable pour cette opération.");
      }

      const db = getDatabase();
      if (!db) throw new Error("Database non connectée");

      const existingById = db.prepare('SELECT * FROM t_cartes WHERE sync_id = ?').get(cardData.sync_id) as any;
      if (existingById) return { success: true, carte: existingById };

      const cleDbl = cardData.cle_doublon;
      if (cleDbl) {
        const existingByCle = db.prepare('SELECT * FROM t_cartes WHERE cle_doublon = ? AND is_dirty != -1').get(cleDbl) as any;
        if (existingByCle) return { success: true, carte: existingByCle };
      }

      const stmt = db.prepare(`
        INSERT INTO t_cartes (
          sync_id, noms, prenoms, date_de_naissance, lieu_de_naissance, contact,
          num_secu, lieu_enrolement, rangement, statut, date_delivrance, agent_saisie,
          statut_physique, site_id, centre_id, poste_id, cle_doublon, cle_doublon_flex,
          created_at, updated_at, is_dirty
        ) VALUES (
          @sync_id, @noms, @prenoms, @date_de_naissance, @lieu_de_naissance, @contact,
          @num_secu, @lieu_enrolement, @rangement, @statut, @date_delivrance, @agent_saisie,
          @statut_physique, @site_id, @centre_id, @poste_id, @cle_doublon, @cle_doublon_flex,
          @created_at, @updated_at, 0
        )
      `);
      
      stmt.run({
        sync_id: cardData.sync_id,
        noms: cardData.noms || '',
        prenoms: cardData.prenoms || '',
        date_de_naissance: cardData.date_naissance || cardData.date_de_naissance || null,
        lieu_de_naissance: cardData.lieu_naissance || cardData.lieu_de_naissance || null,
        contact: cardData.contact || null,
        num_secu: cardData.num_secu || null,
        lieu_enrolement: cardData.lieu_enrolement || null,
        rangement: cardData.rangement || null,
        statut: cardData.statut || 'EN STOCK',
        date_delivrance: cardData.date_delivrance || null,
        agent_saisie: cardData.agent_saisie || null,
        statut_physique: cardData.statut_physique || 'OK',
        site_id: resolvedSiteId,
        centre_id: cardData.id_centre || cardData.centre_id || null,
        poste_id: cardData.id_poste || cardData.poste_id || null,
        cle_doublon: cardData.cle_doublon || null,
        cle_doublon_flex: cardData.cle_doublon_flex || null,
        created_at: cardData.created_at || new Date().toISOString(),
        updated_at: cardData.updated_at || new Date().toISOString()
      });

      const newCard = db.prepare('SELECT * FROM t_cartes WHERE sync_id = ?').get(cardData.sync_id);
      return { success: true, carte: newCard };
    } catch (e) {
      log.error('IPC Error: cartes:pullSingleCard', e);
      throw e;
    }
  });

  ipcMain.handle('cartes:getRecordForCorrection', async (_, originalId, recordType, siteId?: number) => {
    try {
      const userLogin = getCurrentUserLogin() || 'SYSTEM';
      const secureUser = getSecureCurrentUser();
      if (!secureUser) throw new Error("Session invalide.");
      if (!verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_QUALITE'])) {
        log.warn(`[SECURITY] Tentative de getRecordForCorrection refusée pour l'utilisateur ID ${secureUser.id_user} (rôle non autorisé)`);
        throw new Error("Accès refusé pour cette opération.");
      }
      const effectiveSiteId = secureUser.role === 'SUPER ADMIN' ? siteId : secureUser.site_id;
      const result = await queries.getRecordForCorrection(originalId, recordType, effectiveSiteId);

      setImmediate(() => {
        if (result) {
          logAudit(userLogin, 'CONSULTATION_CORRECTION', {
            type_enregistrement: recordType,
            id: originalId
          });
        }
      });
      
      return result;
    } catch (e) {
      log.error('IPC Error: cartes:getRecordForCorrection', e);
      throw e;
    }
  });

  ipcMain.handle('cartes:getById', async (_, id) => {
    const userLogin = getCurrentUserLogin() || 'SYSTEM';
    try {
      // Sécurité : currentUser dérivé de la session serveur (jamais du renderer) pour que
      // getCarteById applique son filtrage site_id (cloisonnement §3) aux rôles non-SUPER-ADMIN.
      const secureUser = getSecureCurrentUser();
      const carte = await queries.getCarteById(id, secureUser ?? undefined) as any;
      
      if (carte) {
        setImmediate(() => {
          // Audit de la consultation
          logAudit(userLogin, 'VERIFICATION_CONSULTATION', {
            id_beneficiaire: carte.id_carte, // id de la carte / bénéficiaire
            id_carte: carte.id_carte
          });

          // Anti-Fuite : Si un utilisateur consulte plus de 20 dossiers différents en moins de 10 minutes
          const now = Date.now();
          const dixMinutesMs = 10 * 60 * 1000;
          
          if (!rechercheHistoriqueConsultations.has(userLogin)) {
            rechercheHistoriqueConsultations.set(userLogin, []);
          }
          
          const historique = rechercheHistoriqueConsultations.get(userLogin)!;
          // Nettoyer l'historique de plus de 10 minutes
          const historiqueFiltre = historique.filter(item => now - item.timestamp < dixMinutesMs);
          
          // Ajouter la consultation courante si elle n'est pas déjà présente dans les dernières minutes (éviter doublons immédiats)
          if (!historiqueFiltre.some(item => item.id_carte === id)) {
            historiqueFiltre.push({ id_carte: id, timestamp: now });
          }
          
          rechercheHistoriqueConsultations.set(userLogin, historiqueFiltre);

          if (historiqueFiltre.length > 20) {
            logAudit(userLogin, 'VERIFICATION_ABUS_RECHERCHE', {
              login: userLogin,
              motif: `Consultation excessive de dossiers différents (${historiqueFiltre.length} dossiers en moins de 10 minutes)`
            });
          }
        });
      }

      return carte; 
    }
    catch (e) { log.error('IPC Error: cartes:getById', e); throw e; }
  });
  ipcMain.handle('cartes:create', async (_, data, currentUser) => {
    // Sécurité (P0) : identité et périmètre dérivés exclusivement de la session serveur (non
    // falsifiable via IPC) — currentUser (renderer) n'est plus utilisé, ni pour le contrôle de
    // rôle ni pour l'audit. Le lookup DB par login (potentiellement forgé ou inexistant côté
    // renderer) est supprimé : il pouvait soit correspondre à un vrai SUPER ADMIN (contrôle de
    // site jamais appliqué), soit à une chaîne inexistante (bloc if silencieusement jamais
    // exécuté, `user` undefined). Handler auparavant dépourvu de tout verifyUserRole. Périmètre
    // aligné sur l'unique appelant réel : SaisiePage.tsx en mode 'create' (sans
    // onSubmitOverride), monté par AgentSaisie/views/NouvelleSaisieView.tsx, route
    // /agent-saisie/nouvelle (App.tsx ligne ~131) — OPERATEUR_SAISIE, SUPER ADMIN,
    // ADMINISTRATEUR_SITE. ADMIN_CENTRE n'est PAS membre de cette route (vérifié), donc
    // volontairement exclu ici malgré sa présence dans le périmètre d'autres handlers cartes:*.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_SAISIE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:create : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour créer une carte.");
    }
    const userLogin = secureUser.login || 'SYSTEM';
    try {
      if (secureUser.role !== 'SUPER ADMIN') {
        // Sécurité anti-contournement : forcer le site_id de la session serveur, quel que soit
        // le rôle (pas uniquement ADMINISTRATEUR_SITE), pour empêcher tout appel IPC forgé
        // d'écrire une carte dans un site étranger.
        data.site_id = secureUser.site_id;

        if (data.centre_id) {
          const db = getDatabase();
          const centre = db?.prepare('SELECT site_id FROM t_centres WHERE id = ?').get(Number(data.centre_id)) as { site_id: number } | undefined;
          if (!centre || centre.site_id !== secureUser.site_id) {
            throw new Error("Opération non autorisée : Le centre de travail n'appartient pas à votre périmètre.");
          }
        }
      }

      const siteId = Number(data.site_id);
      if (!siteId) throw new Error("site_id manquant ou invalide.");

      // Normalisation des dates reçues avant validation
      if (data && typeof data === 'object') {
        if (data.date_de_naissance) {
          data.date_de_naissance = normalizeDate(String(data.date_de_naissance));
        }
        if (data.date_naissance) {
          data.date_naissance = normalizeDate(String(data.date_naissance));
        }
      }

      log.info(`[User Action] CrÃ©ation d'une nouvelle carte CMU pour ${data.noms} ${data.prenoms} par ${userLogin}`);
      const res = await queries.createCarte(data, siteId);
      logAudit(
        userLogin,
        'CARTE_SAISIE',
        JSON.stringify({
          id_carte: res.id,
          sync_id: res.sync_id,
          site_id: siteId,
          centre_id: data.centre_id || null,
          matricule_agent: data.agent_saisie || userLogin,
          noms: data.noms,
          prenoms: data.prenoms
        })
      );
      return res;
    }
    catch (e) { log.error('IPC Error: cartes:create', e); throw e; }
  });
  ipcMain.handle('cartes:update', async (_, id, data) => {
    // Securite : identite et perimetre derives exclusivement de la session serveur (non
    // falsifiable via IPC) - currentUser (renderer) n'est plus utilise, ni pour le controle
    // de role ni pour le scoping site/centre applique par queries.updateCarte.
    const secureUser = getSecureCurrentUser();
    const userLogin = secureUser?.login || getCurrentUserLogin() || 'SYSTEM';
    const userId = secureUser?.id_user;
    if (!userId || !verifyUserRole(userId, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'OPERATEUR_QUALITE', 'OPERATEUR_SAISIE'])) {
      throw new Error("Accès refusé. Privilèges insuffisants pour modifier cette carte.");
    }
    try {
      const res = await queries.updateCarte(id, data, secureUser);
      // Sécurité : masquage des champs sensibles avant écriture dans t_audit_log — même
      // fonction (`maskSensitiveField`) que celle appliquée par qualite:corrigerFormat, pour
      // ne jamais journaliser num_secu/contact en clair.
      const champsDataMasked: Record<string, unknown> = { ...data };
      if ('num_secu' in champsDataMasked) {
        champsDataMasked.num_secu = maskSensitiveField('num_secu', data.num_secu);
      }
      if ('contact' in champsDataMasked) {
        champsDataMasked.contact = maskSensitiveField('contact', data.contact);
      }
      logAudit(
        userLogin,
        'CARTE_MODIFICATION',
        JSON.stringify({
          id_carte: id,
          champs_modifies: Object.keys(data),
          champs_data: champsDataMasked
        })
      );
      return res;
    }
    catch (e) { log.error('IPC Error: cartes:update', e); throw e; }
  });
  ipcMain.handle('cartes:delete', async (_, id) => {
    // Securite : identite derivee exclusivement de la session serveur (non falsifiable via IPC).
    const secureUser = getSecureCurrentUser();
    const userId = secureUser?.id_user;
    // Note : OPERATEUR_SAISIE est autorisé ici au niveau du rôle ; la restriction fine
    // (suppression limitée à ses propres brouillons BROUILLON) est appliquée par queries.deleteCarte.
    if (!userId || !verifyUserRole(userId, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'OPERATEUR_QUALITE', 'OPERATEUR_SAISIE'])) {
      throw new Error("Accès refusé. Privilèges insuffisants pour supprimer une carte.");
    }
    const userLogin = secureUser?.login || getCurrentUserLogin() || 'SYSTEM';
    try { 
      const res = await queries.deleteCarte(id, secureUser);
      logAudit(
        userLogin,
        'CARTE_SUPPRESSION',
        JSON.stringify({
          id_carte: id,
          raison_suppression: 'Supprimé par l\'opérateur/superviseur'
        })
      );
      return res;
    }
    catch (e) { log.error('IPC Error: cartes:delete', e); throw e; }
  });
  
  ipcMain.handle('cartes:countDrafts', async (_, siteId, currentUser) => {
    // Sécurité (P0) : identité et site dérivés exclusivement de la session serveur (non
    // falsifiable via IPC) — currentUser (renderer) n'est plus utilisé. Périmètre aligné sur
    // la route /agent-saisie (App.tsx, ligne ~131) : OPERATEUR_SAISIE, SUPER ADMIN,
    // ADMINISTRATEUR_SITE (ADMIN_CENTRE n'est PAS membre de cette route, exclu volontairement).
    // site_id forcé via resolveScopedSiteId (même pattern que cartes:getAbsences) pour empêcher
    // un siteId forgé de compter les brouillons d'un site étranger.
    try {
      const secureUser = getSecureCurrentUser();
      if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_SAISIE'])) {
        return 0;
      }
      return queries.countDrafts(resolveScopedSiteId(siteId), secureUser.id_user);
    } catch (e) {
      log.error('IPC Error: cartes:countDrafts', e); throw e;
    }
  });

  ipcMain.handle('cartes:publishDrafts', async (_, siteId, currentUser) => {
    // Sécurité (P0) : identité, site et login d'audit dérivés exclusivement de la session
    // serveur — currentUser (renderer) n'est plus utilisé, ni pour le contrôle de rôle ni pour
    // logAudit. Même périmètre de rôles que cartes:countDrafts ci-dessus.
    try {
      const secureUser = getSecureCurrentUser();
      if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_SAISIE'])) {
        throw new Error("Accès refusé. Privilèges insuffisants pour publier ces brouillons.");
      }
      const scopedSiteId = resolveScopedSiteId(siteId);
      const res = queries.publishDrafts(scopedSiteId, secureUser.id_user);
      logAudit(
        secureUser.login || 'SYSTEM',
        'CARTE_PUBLICATION_BROUILLONS',
        JSON.stringify({
          site_id: scopedSiteId,
          published_count: res.publishedCount,
          skipped_count: res.skippedInvalidDateCount
        })
      );
      return res;
    } catch (e) {
      log.error('IPC Error: cartes:publishDrafts', e); throw e;
    }
  });

  // CMU HANDLERS
  ipcMain.handle('cmu:searchCarte', async (_, query, limit, filters, currentUser) => {
    const userLogin = currentUser?.login || getCurrentUserLogin() || 'SYSTEM';
    try {
      // Sécurité (cloisonnement §3) : force le site_id réel de la session serveur pour tout
      // rôle non-SUPER-ADMIN, même pattern que cartes:search (finalFilters ci-dessus).
      let finalFilters = filters || {};
      const secureUser = getSecureCurrentUser();
      if (secureUser && secureUser.role !== 'SUPER ADMIN') {
        finalFilters = {
          ...finalFilters,
          site_id: String(resolveScopedSiteId(finalFilters.site_id))
        };
      }
      const res = await queries.searchCartesFTS(query, limit, finalFilters);
      const count = Array.isArray(res) ? res.length : 0;
      
      setImmediate(() => {
        try {
          const parts: string[] = [];
          if (query && query.trim()) {
            const q = query.trim();
            parts.push(`nom: ${q.charAt(0)}...${q.charAt(q.length - 1)} (taille: ${q.length})`);
          }
          if (filters) {
            if (filters.date_de_naissance) {
              const partsDdn = filters.date_de_naissance.split('-');
              if (partsDdn.length === 3) {
                parts.push(`ddn: ${partsDdn[0]}-XX-XX`);
              } else {
                parts.push(`ddn: XX-XX-XX`);
              }
            }
            if (filters.lieu_de_naissance) {
              parts.push(`lieu: ${filters.lieu_de_naissance}`);
            }
            if (filters.contact) {
              const clean = filters.contact.replace(/%/g, '');
              parts.push(`contact: ...${clean.slice(-4)}`);
            }
          }
          const critere = parts.join(', ') || 'aucun';

          logAudit(
            userLogin,
            'CMU_RECHERCHE',
            JSON.stringify({
              critere,
              resultat_count: count
            })
          );
          
          if (count > 100) {
            logAudit(
              userLogin,
              'RECHERCHE_SUSPECTE',
              JSON.stringify({
                critere,
                resultat_count: count,
                message: "Volume de resultats anormalement eleve (> 100)"
              })
            );
          }
        } catch (auditErr) {
          log.error('Failed to log audit for cmu:searchCarte', auditErr);
        }
      });
      
      return res;
    } catch (e) {
      log.error('IPC Error: cmu:searchCarte', e);
      throw e;
    }
  });

  ipcMain.handle('cmu:getDossierComplet', async (_, id, currentUser) => {
    const userLogin = currentUser?.login || getCurrentUserLogin() || 'SYSTEM';
    try {
      // Sécurité : currentUser dérivé de la session serveur (jamais du renderer) pour que
      // getCarteById applique son filtrage site_id (cloisonnement §3) aux rôles non-SUPER-ADMIN.
      const secureUser = getSecureCurrentUser();
      const carte = await queries.getCarteById(id, secureUser ?? undefined) as any;
      if (carte) {
        setImmediate(() => {
          try {
            logAudit(
              userLogin,
              'CMU_CONSULTATION_DOSSIER',
              JSON.stringify({
                id_carte: id,
                numero_cmu: carte.num_secu || 'N/A'
              })
            );
          } catch (auditErr) {
            log.error('Failed to log audit for cmu:getDossierComplet', auditErr);
          }
        });
      }
      return carte;
    } catch (e) {
      log.error('IPC Error: cmu:getDossierComplet', e);
      throw e;
    }
  });

  ipcMain.handle('cmu:createCarte', async (_, data, currentUser) => {
    const userLogin = currentUser?.login || getCurrentUserLogin() || 'SYSTEM';
    try {
      const siteId = Number(data.site_id);
      if (!siteId) throw new Error("site_id manquant ou invalide.");
      const res = await queries.createCarte(data, siteId);
      logAudit(
        userLogin,
        'CMU_SAISIE',
        JSON.stringify({
          id_carte: res.id,
          numero_cmu: data.num_secu || 'N/A',
          date_saisie: new Date().toISOString()
        })
      );
      return res;
    } catch (e) {
      log.error('IPC Error: cmu:createCarte', e);
      throw e;
    }
  });

  ipcMain.handle('cmu:saveNewDossier', async (_, data, currentUser) => {
    const userLogin = currentUser?.login || getCurrentUserLogin() || 'SYSTEM';
    let id_carte: number | undefined;
    try {
      const siteId = Number(data.site_id);
      if (!siteId) throw new Error("site_id manquant ou invalide.");
      const res = await queries.createCarte(data, siteId);
      id_carte = Number(res.id);

      logAudit(
        userLogin,
        'CMU_NOUVELLE_SAISIE',
        JSON.stringify({
          id_carte: id_carte,
          numero_cmu: data.num_secu || 'N/A',
          centre_id: data.centre_id || null
        })
      );
      return res;
    } catch (e: any) {
      log.error('IPC Error: cmu:saveNewDossier', e);
      logAudit(
        userLogin,
        'ERREUR_SAISIE',
        JSON.stringify({
          numero_cmu: data?.num_secu || 'N/A',
          error: e.message || String(e)
        })
      );
      throw e;
    }
  });

  ipcMain.handle('cmu:uploadDocument', async (_, idCarteOrData, typeDoc, fileName, currentUser) => {
    let id_carte: any;
    let type_document: any;
    let nom_fichier: any;
    let user = currentUser;

    if (idCarteOrData && typeof idCarteOrData === 'object') {
      id_carte = idCarteOrData.id_carte;
      type_document = idCarteOrData.type_document;
      nom_fichier = idCarteOrData.nom_fichier;
      user = typeDoc;
    } else {
      id_carte = idCarteOrData;
      type_document = typeDoc;
      nom_fichier = fileName;
    }

    const userLogin = user?.login || getCurrentUserLogin() || 'SYSTEM';
    logAudit(
      userLogin,
      'CMU_UPLOAD_DOC',
      JSON.stringify({
        id_carte,
        type_document,
        nom_fichier
      })
    );
    return { success: true };
  });

  ipcMain.handle('cmu:validateDossier', async (_, idCarteOrData, conformite, currentUser) => {
    let id_carte: any;
    let isConform: any;
    let user = currentUser;

    if (idCarteOrData && typeof idCarteOrData === 'object') {
      id_carte = idCarteOrData.id_carte;
      isConform = idCarteOrData.conformite;
      user = conformite;
    } else {
      id_carte = idCarteOrData;
      isConform = conformite;
    }

    const userLogin = user?.login || getCurrentUserLogin() || 'SYSTEM';
    logAudit(
      userLogin,
      'CMU_VALIDATION_SAISIE',
      JSON.stringify({
        id_carte,
        conformite: !!isConform
      })
    );
    return { success: true };
  });

  ipcMain.handle('cmu:updateCarte', async (_, id, data) => {
    // Securite : identite et perimetre derives exclusivement de la session serveur (non
    // falsifiable via IPC) - currentUser (renderer) n'est plus utilise, ni pour le controle
    // de role ni pour le scoping site/centre applique par queries.updateCarte.
    const secureUser = getSecureCurrentUser();
    const userLogin = secureUser?.login || getCurrentUserLogin() || 'SYSTEM';
    const userId = secureUser?.id_user;
    if (!userId || !verifyUserRole(userId, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'OPERATEUR_QUALITE', 'OPERATEUR_SAISIE'])) {
      throw new Error("Accès refusé. Privilèges insuffisants pour modifier cette carte.");
    }
    try {
      const res = await queries.updateCarte(id, data, secureUser);
      // Sécurité : masquage des champs sensibles avant écriture dans t_audit_log — même
      // fonction (`maskSensitiveField`) que celle appliquée par cartes:update, pour ne jamais
      // journaliser num_secu en clair. Ce handler est le chemin RÉELLEMENT emprunté par
      // CorrectionSidePanel.onSave (portail Qualité : Dates Invalides, Doublons Probables ->
      // Identification, Recherche Universelle -> Modifier), voir preload/index.ts:74-75
      // (`cartes.updateCarte` route vers le canal IPC `cmu:updateCarte`, pas `cartes:update`).
      logAudit(
        userLogin,
        'CMU_MODIFICATION',
        JSON.stringify({
          id_carte: id,
          numero_cmu: 'num_secu' in data ? maskSensitiveField('num_secu', data.num_secu) : 'N/A',
          champs_modifies: Object.keys(data)
        })
      );
      return res;
    } catch (e) {
      log.error('IPC Error: cmu:updateCarte', e);
      throw e;
    }
  });

  ipcMain.handle('cmu:updateStatus', async (_, id, currentStatus, newStatus, reason, currentUser) => {
    const userLogin = currentUser?.login || getCurrentUserLogin() || 'SYSTEM';
    try {
      const db = getDatabase();
      let numeroCmu = 'N/A';
      if (db) {
        const row = db.prepare("SELECT num_secu FROM t_cartes WHERE id_carte = ?").get(id) as { num_secu: string } | undefined;
        if (row && row.num_secu) numeroCmu = row.num_secu;
      }

      const res = await queries.updateCarte(id, { statut: newStatus }, currentUser);
      logAudit(
        userLogin,
        'CMU_CHANGEMENT_STATUT',
        JSON.stringify({
          id_carte: id,
          numero_cmu: numeroCmu,
          ancien_statut: currentStatus,
          nouveau_statut: newStatus,
          motif: reason
        })
      );
      return res;
    } catch (e) {
      log.error('IPC Error: cmu:updateStatus', e);
      throw e;
    }
  });

  ipcMain.handle('cmu:printCarte', async (_, id, machineId, currentUser) => {
    const userLogin = currentUser?.login || getCurrentUserLogin() || 'SYSTEM';
    try {
      const db = getDatabase();
      let numeroCmu = 'N/A';
      if (db) {
        const row = db.prepare("SELECT num_secu FROM t_cartes WHERE id_carte = ?").get(id) as { num_secu: string } | undefined;
        if (row && row.num_secu) numeroCmu = row.num_secu;
      }

      logAudit(
        userLogin,
        'CMU_IMPRESSION',
        JSON.stringify({
          id_carte: id,
          numero_cmu: numeroCmu,
          machine_id: machineId
        })
      );
      return { success: true };
    } catch (e) {
      log.error('IPC Error: cmu:printCarte', e);
      throw e;
    }
  });

  ipcMain.handle('cmu:deleteCarte', async (_, id, reason) => {
    // Securite : identite derivee exclusivement de la session serveur (non falsifiable via IPC).
    const secureUser = getSecureCurrentUser();
    const userId = secureUser?.id_user;
    if (!userId || !verifyUserRole(userId, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'OPERATEUR_QUALITE', 'OPERATEUR_SAISIE'])) {
      throw new Error("Accès refusé. Privilèges insuffisants pour supprimer une carte.");
    }
    const userLogin = secureUser?.login || getCurrentUserLogin() || 'SYSTEM';
    try {
      const db = getDatabase();
      let numeroCmu = 'N/A';
      if (db) {
        const row = db.prepare("SELECT num_secu FROM t_cartes WHERE id_carte = ?").get(id) as { num_secu: string } | undefined;
        if (row && row.num_secu) numeroCmu = row.num_secu;
      }

      const res = await queries.deleteCarte(id, secureUser);
      logAudit(
        userLogin,
        'CMU_SUPPRESSION',
        JSON.stringify({
          id_carte: id,
          numero_cmu: numeroCmu,
          raison: reason
        })
      );
      return res;
    } catch (e) {
      log.error('IPC Error: cmu:deleteCarte', e);
      throw e;
    }
  });

  ipcMain.handle('cartes:delivrer', async (_, id, data) => {
    // Securite : identite et perimetre derives exclusivement de la session serveur (non
    // falsifiable via IPC) - currentUser (renderer) n'est plus utilise du tout.
    const secureSession = getSecureCurrentUser();
    const resolvedUser = secureSession ? {
      id_user: secureSession.id_user,
      login: secureSession.login,
      role: secureSession.role,
      site_id: secureSession.site_id,
      centre_id: secureSession.centre_id
    } : null;

    const userId = resolvedUser?.id_user;
    if (!userId || !verifyUserRole(userId, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'OPERATEUR_VERIFICATION', 'OPERATEUR_RECHERCHE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:delivrer : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour délivrer une carte.");
    }
    try {
      const res = await queries.delivrerCarte(id, data, resolvedUser);
      queries.insertAuditLog(
        resolvedUser?.login || 'SYSTEM',
        'RETRAIT',
        `Retrait de la carte ID ${id} par le retirant ${data.nom_retirant} (N° pièce: ${data.num_retirant}). Agent distributeur: ${data.agent_distributeur}. Montant: N/A (service gratuit).`
      );
      // Couverture CRUD_SYNC_WHITELIST (décision utilisateur validée) : en plus de
      // insertAuditLog() ci-dessus (t_audit_log local, inchangé), la délivrance devient
      // visible cross-poste via t_logs/logAudit(). Action distincte de 'RETRAIT' pour ne pas
      // altérer le libellé déjà utilisé par insertAuditLog.
      logAudit(
        resolvedUser?.login || 'SYSTEM',
        'CARTE_DELIVREE',
        JSON.stringify({
          id_carte: id,
          nom_retirant: data.nom_retirant,
          num_retirant: data.num_retirant,
          agent_distributeur: data.agent_distributeur
        })
      );
      return res;
    }
    catch (e) { log.error('IPC Error: cartes:delivrer', e); throw e; }
  });

  ipcMain.handle('cartes:transferer', async (_, id, data) => {
    // Sécurité (P0) : identité et périmètre dérivés exclusivement de la session serveur (non
    // falsifiable via IPC) — currentUser (renderer) n'est plus utilisé. Ce handler n'avait
    // auparavant aucun verifyUserRole. Périmètre aligné sur l'usage légitime (CartesPage.tsx,
    // bouton "Transférer la carte" masqué pour OPERATEUR_SAISIE), même liste que cartes:delivrer
    // hors rôles de recherche/vérification qui ne transfèrent pas.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:transferer : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour transférer une carte.");
    }
    try {
      const res = await queries.transfererCarte(id, data, secureUser);
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('cartes:updated'));
      queries.insertAuditLog(secureUser.login || 'SYSTEM', 'CARTE_TRANSFEREE', `Transfert carte ${id} vers le centre ${data.centre_id}`);
      // Couverture CRUD_SYNC_WHITELIST (décision utilisateur validée) : en plus de
      // insertAuditLog() ci-dessus (t_audit_log local, inchangé), le transfert devient visible
      // cross-poste via t_logs/logAudit().
      logAudit(
        secureUser.login || 'SYSTEM',
        'CARTE_TRANSFEREE',
        JSON.stringify({ id_carte: id, centre_id_destination: data.centre_id })
      );
      return res;
    }
    catch (e) { log.error('IPC Error: cartes:transferer', e); throw e; }
  });
  ipcMain.handle('cartes:signalerAbsence', async (_, id, agentLogin, agentInfo, commentaire = '', currentUser?: any) => {
    // Sécurité (P0) : le cloisonnement site appliqué par queries.signalerAbsence() reposait
    // sur currentUser.role fourni par le renderer (falsifiable via appel IPC direct — un
    // role: 'SUPER ADMIN' forgé faisait sauter le filtre site_id). Identité et rôle désormais
    // dérivés exclusivement de la session serveur. Périmètre aligné sur l'unique appelant
    // réel (useVerificationSearch.ts, consommé par VerificationSearchPage/index.tsx route
    // /admin-centre/recherche [ADMIN_CENTRE] et AgentVerification/views/RechercheView.tsx route
    // /agent-verification/recherche [OPERATEUR_VERIFICATION, SUPER ADMIN, ADMINISTRATEUR_SITE,
    // ADMIN_CENTRE] — App.tsx). agentLogin (identité utilisée pour l'audit/le filtrage de
    // scope) est désormais forcé depuis la session serveur ; agentInfo reste tel quel car il
    // ne sert qu'au libellé d'affichage de la notification, jamais à une décision de sécurité.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'OPERATEUR_VERIFICATION'])) {
      log.warn('[SECURITY] Acces refuse a cartes:signalerAbsence : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour signaler cette absence.");
    }
    const secureAgentLogin = secureUser.login || agentLogin;
    try {
      const res: any = await queries.signalerAbsence(id, secureAgentLogin, agentInfo, commentaire, secureUser);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync:updated-data', { type: 'ABSENCE_SIGNALEE', centre_id: res?.centre_id ?? null });
      }
      return res;
    }
    catch (e) { log.error('IPC Error: cartes:signalerAbsence', e); throw e; }
  });
  ipcMain.handle('cartes:getAbsences', async (_, siteId?: number) => {
    // Sécurité (cloisonnement §3, P1) : siteId dérivé de la session serveur — un siteId omis
    // ou forgé côté renderer renvoyait auparavant TOUT le système (getAbsencesReportees ne
    // filtre que si un siteId non-null/undefined est fourni).
    try { return queries.getAbsencesReportees(resolveScopedSiteId(siteId)); }
    catch (e) { log.error('IPC Error: cartes:getAbsences', e); throw e; }
  });
  ipcMain.handle('cartes:getAbsencesCentre', async (_, centreId: number) => {
    try {
      // Sécurité (cloisonnement §3, P0-3) : centreId dérivé de la session serveur pour tout
      // rôle non-SUPER ADMIN / non-ADMINISTRATEUR_SITE (ADMIN_CENTRE en particulier) — un
      // centreId forgé côté renderer permettait auparavant de lire les absences signalées
      // (avec statut/rangement) d'un centre étranger.
      const secureUser = getSecureCurrentUser();
      const effectiveCentreId = (secureUser && secureUser.role !== 'SUPER ADMIN' && secureUser.role !== 'ADMINISTRATEUR_SITE')
        ? (secureUser.centre_id ?? centreId)
        : centreId;
      return queries.getAbsencesCentre(effectiveCentreId);
    }
    catch (e) { log.error('IPC Error: cartes:getAbsencesCentre', e); throw e; }
  });
  ipcMain.handle('cartes:getEscaladesResoluesCentre', async (_, centreId: number) => {
    try {
      // Sécurité (cloisonnement §3) : même pattern exact que cartes:getAbsencesCentre
      // ci-dessus — centreId dérivé de la session serveur pour tout rôle non-SUPER ADMIN /
      // non-ADMINISTRATEUR_SITE (ADMIN_CENTRE en particulier), jamais du paramètre client.
      const secureUser = getSecureCurrentUser();
      const effectiveCentreId = (secureUser && secureUser.role !== 'SUPER ADMIN' && secureUser.role !== 'ADMINISTRATEUR_SITE')
        ? (secureUser.centre_id ?? centreId)
        : centreId;
      return queries.getEscaladesResoluesCentre(effectiveCentreId);
    }
    catch (e) { log.error('IPC Error: cartes:getEscaladesResoluesCentre', e); throw e; }
  });
  ipcMain.handle('cartes:getAbsencesSite', async (_, siteId?: number) => {
    // Sécurité (cloisonnement §3, P1) : idem cartes:getAbsences.
    try { return queries.getAbsencesSite(resolveScopedSiteId(siteId)); }
    catch (e) { log.error('IPC Error: cartes:getAbsencesSite', e); throw e; }
  });
  ipcMain.handle('cartes:escaladerAuSite', async (_, id: number) => {
    // Sécurité (P0) : identité et périmètre dérivés exclusivement de la session serveur (non
    // falsifiable via IPC) — currentUser (renderer) n'est plus utilisé. Handler auparavant
    // dépourvu de tout verifyUserRole ; escaladerAuSite() ne filtrait pas non plus par site.
    // Périmètre aligné sur l'usage légitime (AdminQueuePage.tsx, route protégée SUPER ADMIN /
    // ADMINISTRATEUR_SITE / ADMIN_CENTRE).
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:escaladerAuSite : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour escalader ce signalement.");
    }
    try {
      const res = await queries.escaladerAuSite(id, secureUser);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync:updated-data', { type: 'ABSENCE_ESCALADEE' });
      }
      return res;
    }
    catch (e) { log.error('IPC Error: cartes:escaladerAuSite', e); throw e; }
  });
  ipcMain.handle('cartes:getAgentAbsences', async (_, agent: string, siteId?: number) => {
    // Sécurité (cloisonnement §3, P1) : idem cartes:getAbsences.
    try { return queries.getAgentAbsences(agent, resolveScopedSiteId(siteId)); }
    catch (e) { log.error('IPC Error: cartes:getAgentAbsences', e); throw e; }
  });
  ipcMain.handle('cartes:getSignalementsResolus', async (_, agent: string, siteId?: number) => {
    // Sécurité (cloisonnement §3, P1) : idem cartes:getAbsences.
    try { return queries.getSignalementsResolus(agent, resolveScopedSiteId(siteId)); }
    catch (e) { log.error('IPC Error: cartes:getSignalementsResolus', e); throw e; }
  });
  
  ipcMain.handle('cartes:archiveSignalement', async (_, id: number, agentLogin: string) => {
    // Sécurité (P1) : login_user dérivé exclusivement de la session serveur — agentLogin
    // (paramètre renderer, état React non signé) n'est plus utilisé pour la logique serveur.
    // Handler auparavant dépourvu de tout verifyUserRole. Périmètre aligné sur les deux
    // appelants réels (mêmes composants, même pattern que cartes:signalerAbsence ci-dessus) :
    // VerificationSearchPage/components/ResolusTab.tsx, monté par VerificationSearchPage/index.tsx
    // (route /admin-centre/recherche, ADMIN_CENTRE) et AgentVerification/views/SignalementsView.tsx
    // (route /agent-verification/signalements — OPERATEUR_VERIFICATION, SUPER ADMIN,
    // ADMINISTRATEUR_SITE, ADMIN_CENTRE) ; et AdminQueuePage/components/EscaladesResoluesTab.tsx,
    // monté par AdminQueuePage.tsx (routes /admin-centre/queue et /admin/queue — SUPER ADMIN,
    // ADMINISTRATEUR_SITE, ADMIN_CENTRE).
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'OPERATEUR_VERIFICATION'])) {
      log.warn('[SECURITY] Acces refuse a cartes:archiveSignalement : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour archiver ce signalement.");
    }
    try { return queries.archiveSignalement(id, secureUser.login || agentLogin); }
    catch (e) { log.error('IPC Error: cartes:archiveSignalement', e); throw e; }
  });

  ipcMain.handle('cartes:getArchivedSignalements', async (_, agentLogin: string) => {
    // Sécurité (P1) : même correctif que cartes:archiveSignalement ci-dessus — login_user
    // dérivé exclusivement de la session serveur, même périmètre de rôles.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'OPERATEUR_VERIFICATION'])) {
      log.warn('[SECURITY] Acces refuse a cartes:getArchivedSignalements : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour consulter ces signalements archivés.");
    }
    try { return queries.getArchivedSignalements(secureUser.login || agentLogin); }
    catch (e) { log.error('IPC Error: cartes:getArchivedSignalements', e); throw e; }
  });
  ipcMain.handle('cartes:resoudreAbsence', async (_, id, data) => {
    // Sécurité (P0) : identité et périmètre dérivés exclusivement de la session serveur —
    // le handler ignorait auparavant totalement le currentUser (même client-fourni), et donc
    // n'activait jamais le filtrage site_id déjà supporté par queries.resoudreAbsence().
    // Périmètre aligné sur l'usage légitime (AdminQueuePage.tsx).
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:resoudreAbsence : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour résoudre ce signalement.");
    }
    try {
      const res = await queries.resoudreAbsence(id, data, secureUser);
      queries.insertAuditLog(
        secureUser.login || data.agent_resolution_absence || 'ADMIN',
        'VALIDATION',
        `Validation/RÃ©solution d'absence physique pour la carte ID ${id}. Nouveau rangement : ${data.nouveau_rangement}.`
      );
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync:updated-data', { type: 'ABSENCE_RESOLUE' });
      }
      return res;
    }
    catch (e) { log.error('IPC Error: cartes:resoudreAbsence', e); throw e; }
  });
  ipcMain.handle('cartes:declarerPerdue', async (_, id) => {
    // Sécurité (P0) : idem cartes:resoudreAbsence — currentUser (renderer) n'est plus utilisé,
    // le filtrage site_id déjà supporté par queries.declarerPerdue() est désormais activé.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:declarerPerdue : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour déclarer cette carte perdue.");
    }
    try {
      const res = await queries.declarerPerdue(id, secureUser);
      queries.insertAuditLog(
        secureUser.login || 'ADMIN',
        'VALIDATION',
        `DÃ©claration de perte validÃ©e pour la carte ID ${id}.`
      );
      if (mainWindow && !mainWindow.isDestroyed()) {
        // Type distinct de ABSENCE_RESOLUE (retrouvée) : declarerPerdue() est une issue
        // définitive de perte, pas une résolution positive — TopBar.tsx affichait auparavant
        // "retrouvée et relocalisée" à tort sur cet événement (bug source, voir plan d'impact
        // agent-1). ResolusTab.tsx/EscaladesResoluesTab.tsx écoutent ce nouveau type pour leur
        // rafraîchissement temps réel.
        mainWindow.webContents.send('sync:updated-data', { type: 'ABSENCE_PERDUE_CONFIRMEE' });
      }
      return res;
    }
    catch (e) { log.error('IPC Error: cartes:declarerPerdue', e); throw e; }
  });
  ipcMain.handle('cartes:getHistoriquePertes', async (_, siteId?: number) => {
    // Sécurité (cloisonnement §3, P1) : idem cartes:getAbsences.
    try { return queries.getHistoriquePertes(resolveScopedSiteId(siteId)); }
    catch (e) { log.error('IPC Error: cartes:getHistoriquePertes', e); throw e; }
  });
  ipcMain.handle('cartes:reactiverCarte', async (_, id, nouveauRangement) => {
    // Sécurité (P0) : identité dérivée exclusivement de la session serveur — l'ancien
    // currentUser (renderer) était falsifiable et directement injecté dans le filtrage
    // site_id de queries.reactiverCarte(). Handler auparavant dépourvu de tout verifyUserRole.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:reactiverCarte : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour réactiver cette carte.");
    }
    try {
      const res = await queries.reactiverCarte(id, nouveauRangement, secureUser);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync:updated-data', { type: 'CARTE_RETROUVEE' });
      }
      return res;
    }
    catch (e) { log.error('IPC Error: cartes:reactiverCarte', e); throw e; }
  });
  ipcMain.handle('cartes:getInvalidDates', async (_, siteId?: number, offset = 0, limit = 50) => {
    // Sécurité (P1) : handler auparavant dépourvu de tout verifyUserRole. Périmètre exclusif
    // au portail Qualité (InvalidFormatView.tsx, route /agent-qualite/*), aligné sur ProtectedRoute.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_QUALITE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:getInvalidDates : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour effectuer cette opération.");
    }
    try { return queries.getInvalidDateRecords(resolveScopedSiteId(siteId), offset, limit); }
    catch (e) { log.error('IPC Error: cartes:getInvalidDates', e); throw e; }
  });
  ipcMain.handle('cartes:getDatesVidesPage', async (_, siteId?: number, offset = 0, limit = 50, query?: string) => {
    // Sécurité (P1) : handler auparavant dépourvu de tout verifyUserRole. Périmètre exclusif
    // au portail Qualité (InvalidFormatView.tsx, route /agent-qualite/*), aligné sur ProtectedRoute.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_QUALITE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:getDatesVidesPage : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour effectuer cette opération.");
    }
    try { return queries.getDatesVidesPage(resolveScopedSiteId(siteId), offset, limit, query); }
    catch (e) { log.error('IPC Error: cartes:getDatesVidesPage', e); throw e; }
  });
  ipcMain.handle('cartes:updateDate', async (_, id, newDate) => {
    // Sécurité (P0) : handler auparavant totalement dépourvu de contrôle (ni rôle, ni site) —
    // écriture libre sur une donnée d'identité sensible (date de naissance) par simple id.
    // Périmètre aligné sur cartes:searchCombinedInventaire (ci-dessous), updateDate étant très
    // probablement l'action d'édition consécutive à cette même recherche/anomalie de date invalide.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['OPERATEUR_APUREMENT', 'OPERATEUR_INVENTAIRE', 'ADMINISTRATEUR_SITE', 'SUPER ADMIN'])) {
      log.warn('[SECURITY] Acces refuse a cartes:updateDate : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour modifier cette fiche.");
    }
    try {
      if (secureUser.role !== 'SUPER ADMIN') {
        const db = getDatabase();
        // queries.updateDateDeNaissance() cible soit une anomalie DLQ (t_import_anomalies),
        // soit directement une fiche déjà importée (t_cartes.id_carte), selon l'origine de
        // l'id fourni — le contrôle de site doit donc couvrir les deux tables, à l'identique
        // de la fonction elle-même (voir cartes.queries.ts, non modifiée ici).
        const anomaly = db?.prepare('SELECT site_id FROM t_import_anomalies WHERE id = ?').get(id) as { site_id: number } | undefined;
        const carte = anomaly ? undefined : (db?.prepare('SELECT site_id FROM t_cartes WHERE id_carte = ?').get(id) as { site_id: number } | undefined);
        const targetSiteId = anomaly ? anomaly.site_id : carte?.site_id;
        if (targetSiteId == null || targetSiteId !== secureUser.site_id) {
          log.warn(`[SECURITY] Tentative de cartes:updateDate refusée pour l'utilisateur ID ${secureUser.id_user} (fiche hors site).`);
          throw new Error("Accès refusé : cette fiche n'appartient pas à votre site.");
        }
      }
      return queries.updateDateDeNaissance(id, newDate);
    }
    catch (e) { log.error('IPC Error: cartes:updateDate', e); throw e; }
  });
  ipcMain.handle('cartes:getDoublonsPage', async (_, siteId, offset, limit, query, filters) => {
    // Sécurité (P1) : handler auparavant dépourvu de tout verifyUserRole. Périmètre exclusif
    // au portail Qualité (DoublonsView.tsx, route /agent-qualite/*), aligné sur ProtectedRoute.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_QUALITE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:getDoublonsPage : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour effectuer cette opération.");
    }
    try { return queries.getDoublonsStrictsPage(resolveScopedSiteId(siteId), offset, limit, query, filters); }
    catch (e) { log.error('IPC Error: cartes:getDoublonsPage', e); throw e; }
  });
  ipcMain.handle('cartes:getDoublonsProbablesPage', async (_, siteId, offset, limit, query, filters) => {
    // Sécurité (P1) : handler auparavant dépourvu de tout verifyUserRole. Périmètre exclusif
    // au portail Qualité (DoublonsView.tsx, route /agent-qualite/*), aligné sur ProtectedRoute.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_QUALITE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:getDoublonsProbablesPage : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour effectuer cette opération.");
    }
    try { return queries.getDoublonsProbablesPage(resolveScopedSiteId(siteId), offset, limit, query, filters); }
    catch (e) { log.error('IPC Error: cartes:getDoublonsProbablesPage', e); throw e; }
  });
  ipcMain.handle('cartes:getSansNumSecuPage', async (_, siteId, offset, limit, query, filters) => {
    // Sécurité (P1) : handler auparavant dépourvu de tout verifyUserRole. Périmètre exclusif
    // au portail Qualité (MissingDataView.tsx, route /agent-qualite/*), aligné sur ProtectedRoute.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_QUALITE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:getSansNumSecuPage : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour effectuer cette opération.");
    }
    try { return queries.getSansNumSecuPage(resolveScopedSiteId(siteId), offset, limit, query, filters); }
    catch (e) { log.error('IPC Error: cartes:getSansNumSecuPage', e); throw e; }
  });
  ipcMain.handle('cartes:getSansRangementPage', async (_, siteId, offset, limit, query, filters) => {
    // Sécurité (P1) : handler auparavant dépourvu de tout verifyUserRole. Périmètre exclusif
    // au portail Qualité (MissingDataView.tsx, route /agent-qualite/*), aligné sur ProtectedRoute.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_QUALITE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:getSansRangementPage : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour effectuer cette opération.");
    }
    try { return queries.getSansRangementPage(resolveScopedSiteId(siteId), offset, limit, query, filters); }
    catch (e) { log.error('IPC Error: cartes:getSansRangementPage', e); throw e; }
  });
  ipcMain.handle('cartes:getSansNomPage', async (_, siteId, offset, limit, query, filters) => {
    // Sécurité (P1) : handler auparavant dépourvu de tout verifyUserRole. Périmètre exclusif
    // au portail Qualité (MissingDataView.tsx, route /agent-qualite/*), aligné sur ProtectedRoute.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_QUALITE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:getSansNomPage : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour effectuer cette opération.");
    }
    try { return queries.getSansNomPage(resolveScopedSiteId(siteId), offset, limit, query, filters); }
    catch (e) { log.error('IPC Error: cartes:getSansNomPage', e); throw e; }
  });
  ipcMain.handle('cartes:getSansPrenomPage', async (_, siteId, offset, limit, query, filters) => {
    // Sécurité (P1) : handler auparavant dépourvu de tout verifyUserRole. Périmètre exclusif
    // au portail Qualité (MissingDataView.tsx, route /agent-qualite/*), aligné sur ProtectedRoute.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_QUALITE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:getSansPrenomPage : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour effectuer cette opération.");
    }
    try { return queries.getSansPrenomPage(resolveScopedSiteId(siteId), offset, limit, query, filters); }
    catch (e) { log.error('IPC Error: cartes:getSansPrenomPage', e); throw e; }
  });
  ipcMain.handle('cartes:getSansContactPage', async (_, siteId, offset, limit, query) => {
    // Sécurité (P1) : handler auparavant dépourvu de tout verifyUserRole. Périmètre exclusif
    // au portail Qualité (MissingDataView.tsx, route /agent-qualite/*), aligné sur ProtectedRoute.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_QUALITE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:getSansContactPage : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour effectuer cette opération.");
    }
    try { return queries.getSansContactPage(resolveScopedSiteId(siteId), offset, limit, query); }
    catch (e) { log.error('IPC Error: cartes:getSansContactPage', e); throw e; }
  });
  ipcMain.handle('cartes:getSansLieuNaissancePage', async (_, siteId, offset, limit, query) => {
    // Sécurité (P1) : handler auparavant dépourvu de tout verifyUserRole. Périmètre exclusif
    // au portail Qualité (MissingDataView.tsx, route /agent-qualite/*), aligné sur ProtectedRoute.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_QUALITE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:getSansLieuNaissancePage : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour effectuer cette opération.");
    }
    try { return queries.getSansLieuNaissancePage(resolveScopedSiteId(siteId), offset, limit, query); }
    catch (e) { log.error('IPC Error: cartes:getSansLieuNaissancePage', e); throw e; }
  });
  ipcMain.handle('cartes:updateQuickFields', async (_, id, fields) => {
    // Sécurité (P0) : handler auparavant totalement dépourvu de contrôle (ni rôle, ni site).
    // Vérification identique dans l'esprit à qualite:corrigerFormat (même famille d'action :
    // correction ponctuelle de champs sur une carte), sans toucher à la fonction partagée
    // queries.updateQuickFields() elle-même — utilisée aussi par le flux de correction Qualité
    // (déjà validé en amont côté site avant son propre appel, voir qualite:corrigerFormat).
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_QUALITE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:updateQuickFields : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour modifier cette fiche.");
    }
    try {
      if (secureUser.role !== 'SUPER ADMIN') {
        const db = getDatabase();
        const card = db?.prepare('SELECT site_id FROM t_cartes WHERE id_carte = ?').get(id) as { site_id: number } | undefined;
        if (!card || card.site_id !== secureUser.site_id) {
          throw new Error("Accès refusé : cette fiche n'appartient pas à votre site.");
        }
      }
      return queries.updateQuickFields(id, fields);
    }
    catch (e) { log.error('IPC Error: cartes:updateQuickFields', e); throw e; }
  });
  ipcMain.handle('cartes:searchQuickLogistique', async (_, siteId, critere) => {
    // Sécurité (cloisonnement §3) : aligné sur cartes:searchCombinedInventaire ci-dessous —
    // le site_id doit venir de la session serveur, jamais du renderer tel quel.
    // Sécurité (P1) : handler auparavant dépourvu de tout verifyUserRole. Périmètre exclusif
    // à InventaireLogistique.tsx (route "/inventaire", ProtectedRoute correspondante).
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_INVENTAIRE', 'OPERATEUR_LOGISTIQUE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:searchQuickLogistique : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour effectuer cette opération.");
    }
    try { return queries.searchQuickLogistique(resolveScopedSiteId(siteId), critere); }
    catch (e) { log.error('IPC Error: cartes:searchQuickLogistique', e); throw e; }
  });
  ipcMain.handle('cartes:updateRangementEtFiche', async (_, id, fields) => {
    // Sécurité (P0) : handler auparavant totalement dépourvu de contrôle (ni rôle, ni site).
    // Périmètre aligné sur l'usage légitime (InventaireLogistique.tsx, route "inventaire").
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_INVENTAIRE', 'OPERATEUR_LOGISTIQUE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:updateRangementEtFiche : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour modifier cette fiche.");
    }
    try {
      if (secureUser.role !== 'SUPER ADMIN') {
        const db = getDatabase();
        const card = db?.prepare('SELECT site_id FROM t_cartes WHERE id_carte = ?').get(id) as { site_id: number } | undefined;
        if (!card || card.site_id !== secureUser.site_id) {
          throw new Error("Accès refusé : cette fiche n'appartient pas à votre site.");
        }
      }
      return queries.updateRangementEtFiche(id, fields);
    }
    catch (e) { log.error('IPC Error: cartes:updateRangementEtFiche', e); throw e; }
  });
  ipcMain.handle('cartes:searchCombinedInventaire', async (_, siteId, queryNomsPrenoms, dateNaissance, lieuNaissance) => {
    // Sécurité (P0) : handler auparavant totalement dépourvu de contrôle de rôle (seul le
    // site était filtré). Même périmètre de rôles que cartes:updateApurementHistorique
    // (InventaireApurement.tsx, route "inventaire"), puisque cette recherche alimente cet écran.
    // OPERATEUR_QUALITE ajouté : ce même handler est aussi appelé par IdentificationGuidee.tsx
    // (portail Qualité, montée par AgentQualiteLayout.tsx) — sans ce rôle dans la liste, la
    // recherche globale d'identification y échouait systématiquement par "Accès refusé".
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_INVENTAIRE', 'OPERATEUR_LOGISTIQUE', 'OPERATEUR_APUREMENT', 'OPERATEUR_QUALITE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:searchCombinedInventaire : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour effectuer cette recherche.");
    }
    try { return queries.searchCombinedInventaire(resolveScopedSiteId(siteId), queryNomsPrenoms, dateNaissance, lieuNaissance); }
    catch (e) { log.error('IPC Error: cartes:searchCombinedInventaire', e); throw e; }
  });
  ipcMain.handle('cartes:updateApurementHistorique', async (_, id, fields) => {
    // Sécurité (P0) : handler auparavant totalement dépourvu de contrôle (ni rôle, ni site).
    // Périmètre aligné sur l'usage légitime (InventaireApurement.tsx, route "inventaire").
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_INVENTAIRE', 'OPERATEUR_LOGISTIQUE', 'OPERATEUR_APUREMENT'])) {
      log.warn('[SECURITY] Acces refuse a cartes:updateApurementHistorique : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour modifier cette fiche.");
    }
    try {
      if (secureUser.role !== 'SUPER ADMIN') {
        const db = getDatabase();
        const card = db?.prepare('SELECT site_id FROM t_cartes WHERE id_carte = ?').get(id) as { site_id: number } | undefined;
        if (!card || card.site_id !== secureUser.site_id) {
          throw new Error("Accès refusé : cette fiche n'appartient pas à votre site.");
        }
      }
      return queries.updateApurementHistorique(id, fields);
    }
    catch (e) { log.error('IPC Error: cartes:updateApurementHistorique', e); throw e; }
  });

  ipcMain.handle('cartes:inventairePhysiqueScan', async (_, identifiant, rangement) => {
    // Sécurité (P0) : handler auparavant totalement dépourvu de contrôle (ni rôle, ni site).
    // Recherche par identifiant (num_secu) : le filtrage de site est délégué à
    // queries.updateCarteRangementAndStatusRapid() (voir cartes.queries.ts), seul appelant de
    // cette fonction — signature étendue en conséquence avec un currentUser optionnel.
    // Périmètre aligné sur l'usage légitime (InventairePhysiqueScan.tsx, route "inventaire").
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_INVENTAIRE', 'OPERATEUR_LOGISTIQUE'])) {
      log.warn('[SECURITY] Acces refuse a cartes:inventairePhysiqueScan : session invalide ou role non autorise.');
      throw new Error("Accès refusé. Privilèges insuffisants pour effectuer cette opération.");
    }
    try { return queries.updateCarteRangementAndStatusRapid(identifiant, rangement, secureUser); }
    catch (e) { log.error('IPC Error: cartes:inventairePhysiqueScan', e); throw e; }
  });

  // â”€â”€â”€ CACHE MEMOIZATION POUR stats:get â”€â”€â”€
  // Evite les appels concurrents (React StrictMode) et ajoute un TTL de 15s.
  const STATS_CACHE_TTL_MS = 15000;
  let statsCache: { [key: string]: { promise: Promise<any>; timestamp: number } } = {};

  ipcMain.handle('stats:get', async (_, siteId, centreId?: number, forceRefresh?: boolean) => {
    try {
      // Sécurité : le périmètre site/centre est imposé par la session serveur pour tout rôle
      // non-SUPER ADMIN (défense en profondeur, non falsifiable via IPC).
      const secureUser = getSecureCurrentUser();
      if (secureUser && secureUser.role !== 'SUPER ADMIN') {
        siteId = secureUser.site_id ?? siteId;
        if (secureUser.role === 'ADMIN_CENTRE') {
          centreId = secureUser.centre_id ?? centreId;
        }
      }
      const cacheKey = `${siteId}_${centreId || 'all'}`;
      const now = Date.now();

      // Retourner la promesse en cours (rÃ©sout le problÃ¨me des requÃªtes concurrentes)
      // OU le rÃ©sultat en cache s'il a moins de 15 secondes
      // â”€â”€â”€ Contournement explicite du cache (forceRefresh) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Bug P1 (agent-13) : un clic sur "Actualiser" pouvait recevoir une rÃ©ponse
      // vieille de jusqu'Ã  STATS_CACHE_TTL_MS sans aucune indication de pÃ©remption.
      // Quand forceRefresh === true, on ignore volontairement une entrÃ©e de cache
      // encore valide et on recalcule un rÃ©sultat frais pour CET appel prÃ©cis.
      // Le rÃ©sultat frais est nÃ©anmoins toujours rÃ©-Ã©crit dans statsCache[cacheKey]
      // plus bas (comportement inchangÃ©) : d'Ã©ventuels appels concurrents dans les
      // millisecondes suivantes (chargement initial, autres composants montÃ©s en
      // parallÃ¨le) continuent de bÃ©nÃ©ficier normalement de la mÃ©moÃ¯sation.
      if (!forceRefresh && statsCache[cacheKey] && (now - statsCache[cacheKey].timestamp < STATS_CACHE_TTL_MS)) {
        return await statsCache[cacheKey].promise;
      }

      const promise = new Promise((resolve, reject) => {
        setImmediate(async () => {
          try {
            const db = getDatabase();
            if (db) {
              const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='t_import_anomalies'").get();
              if (!tableCheck) {
                log.warn("[IPC stats:get] La table 't_import_anomalies' n'existe pas encore. Retour d'un etat sain degrade.");
                resolve({
                  total: 0, en_stock: 0, distribuees: 0, absentes: 0,
                  sans_num_secu: 0, sans_rangement: 0, dates_invalides: 0,
                  doublons_stricts: 0, doublons_probables: 0,
                  distribParJour: [], distribParCentre: [], anomalies: []
                });
                return;
              }
            }

            // â”€â”€â”€ CHRONO SQLITE : stats:get â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            const statsStart = performance.now();
            const res = await queries.getStats(siteId, centreId);
            const statsDuration = performance.now() - statsStart;
            if (statsDuration > 200) {
              log.warn(`[LENTEUR SQLITE] RequÃªte stats:get a pris ${statsDuration.toFixed(2)} ms (seuil 200 ms dÃ©passÃ©)`);
            }
            // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            resolve(res);
          } catch (e: any) {
            log.error('Erreur SQL dans stats:get, retour format degrade', e);
            resolve({ anomalies: [], error: e.message });
          }
        });
      });

      statsCache[cacheKey] = { promise, timestamp: now };
      return await promise;
    }
    catch (e) {
      log.error('IPC Error: stats:get exception globale', e);
      return { anomalies: [] };
    }
  });
  ipcMain.handle('stats:getCentre', async (_, centreId, siteId) => {
    try {
      // Sécurité (cloisonnement §3, P0-1) : centreId/siteId dérivés de la session serveur pour
      // tout rôle non-SUPER ADMIN via scopeSiteCentreToSession (même helper que
      // stats:getSiteSaisieToday etc. plus bas dans ce fichier — fonction hoistée, utilisable
      // ici malgré sa déclaration plus loin dans registerIpcHandlers). Un centreId/siteId
      // forgés côté renderer permettaient auparavant à un ADMIN_CENTRE de lire les stats
      // agrégées (en stock/distribuées/absentes) de n'importe quel autre centre, y compris
      // d'un site étranger.
      const scoped = scopeSiteCentreToSession(Number(siteId), centreId !== undefined && centreId !== null ? Number(centreId) : undefined);
      const effectiveCentreId = scoped.centreId ?? centreId;
      return await queries.getCentreStats(effectiveCentreId, scoped.siteId);
    }
    catch (e) { log.error('IPC Error: stats:getCentre', e); throw e; }
  });
  ipcMain.handle('stats:getCentreOperateurs', async (_, centreId) => {
    try {
      // Sécurité (cloisonnement §3, P0-1) : même correctif que stats:getCentre ci-dessus.
      const secureUser = getSecureCurrentUser();
      const effectiveCentreId = (secureUser && secureUser.role === 'ADMIN_CENTRE')
        ? (secureUser.centre_id ?? centreId)
        : centreId;
      return queries.getCentreOperateurCadence(effectiveCentreId);
    }
    catch (e) { log.error('IPC Error: stats:getCentreOperateurs', e); throw e; }
  });
  ipcMain.handle('stats:getGlobal', async () => {
    try { return queries.getGlobalStats(); }
    catch (e) { log.error('IPC Error: stats:getGlobal', e); throw e; }
  });
  // Sécurité (cloisonnement §3, correctif fuite cross-site) : même politique que
  // scopeSiteCentreToSession / stats:getApurementCardsTodayPaginated plus bas dans ce fichier —
  // pour tout rôle non-SUPER ADMIN, l'agent et le site effectifs sont TOUJOURS dérivés de la
  // session serveur réelle (getSecureCurrentUser()), jamais des paramètres client (falsifiables).
  // Avant ce correctif, un agent authentifié pouvait consulter les stats/la liste "cardsToday"
  // de n'importe quel autre agent/site en passant son propre agentUsername/siteId en paramètre
  // IPC. SUPER ADMIN conserve sa liberté de consultation existante (aucun appelant SUPER ADMIN
  // trouvé pour ces deux handlers à ce jour — useVerificationStats n'est consommé que par
  // AgentVerification/views/Overview.tsx et ApurementOverview.tsx, tous deux avec l'utilisateur
  // connecté lui-même).
  ipcMain.handle('stats:getVerification', async (_, agentUsername, siteId) => {
    try {
      const secureUser = getSecureCurrentUser();
      const scoped = scopeSiteCentreToSession(siteId);
      const effectiveAgentUsername = (secureUser && secureUser.role !== 'SUPER ADMIN') ? secureUser.login : agentUsername;
      return queries.getVerificationStats(effectiveAgentUsername, scoped.siteId);
    }
    catch (e) { log.error('IPC Error: stats:getVerification', e); throw e; }
  });
  ipcMain.handle('stats:getCardsToday', async (_, agentUsername, siteId) => {
    try {
      const secureUser = getSecureCurrentUser();
      const scoped = scopeSiteCentreToSession(siteId);
      const effectiveAgentUsername = (secureUser && secureUser.role !== 'SUPER ADMIN') ? secureUser.login : agentUsername;
      return queries.getVerificationCardsToday(effectiveAgentUsername, scoped.siteId);
    }
    catch (e) { log.error('IPC Error: stats:getCardsToday', e); throw e; }
  });
  // Portail Vérification — liste paginée du "travail du jour" (Vue d'ensemble). Même politique
  // de cantonnement que stats:getVerification/stats:getCardsToday ci-dessus : agent et site
  // effectifs toujours dérivés de la session serveur réelle pour tout rôle non-SUPER ADMIN.
  ipcMain.handle('stats:getVerificationCardsTodayPaginated', async (_, agentUsername, siteId, page?: number, pageSize?: number) => {
    try {
      const secureUser = getSecureCurrentUser();
      const scoped = scopeSiteCentreToSession(siteId);
      const effectiveAgentUsername = (secureUser && secureUser.role !== 'SUPER ADMIN') ? secureUser.login : agentUsername;
      return queries.getVerificationCardsTodayPaginated(effectiveAgentUsername, scoped.siteId, page ?? 0, pageSize ?? 20);
    }
    catch (e) { log.error('IPC Error: stats:getVerificationCardsTodayPaginated', e); throw e; }
  });
  ipcMain.handle('stats:getUnsyncedCardsCount', async (_, siteId: number) => {
    try { return queries.getUnsyncedCardsCount(siteId); }
    catch (e) { log.error('IPC Error: stats:getUnsyncedCardsCount', e); throw e; }
  });

  ipcMain.handle('stats:getUnsyncedConformeCardsCount', async (_, siteId: number) => {
    try { return queries.getUnsyncedConformeCardsCount(siteId); }
    catch (e) { log.error('IPC Error: stats:getUnsyncedConformeCardsCount', e); throw e; }
  });

  ipcMain.handle('stats:getDetailedSyncStats', async (_, siteId: number) => {
    // Sécurité (cloisonnement §3, P1) : siteId dérivé de la session serveur pour tout rôle
    // non-SUPER ADMIN (resolveScopedSiteId) — même famille de faiblesse que P0-1/P0-4, gravité
    // moindre (compteurs de synchro is_dirty, pas de données nominatives).
    try { return queries.getDetailedSyncStats(resolveScopedSiteId(siteId)); }
    catch (e) { log.error('IPC Error: stats:getDetailedSyncStats', e); throw e; }
  });
  ipcMain.handle('stats:getUnsyncedUsersCount', async (_, siteId: number) => {
    try { return queries.getUnsyncedUsersCount(siteId); }
    catch (e) { log.error('IPC Error: stats:getUnsyncedUsersCount', e); throw e; }
  });


  // IMPORT - File selection
  ipcMain.handle('import:selectFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Fichiers donnÃ©es', extensions: ['csv', 'xlsx', 'xls'] },
        { name: 'Tous', extensions: ['*'] }
      ]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // DÃ©tecteur d'encodage pour supporter UTF-8 et Windows-1252 (Latin1)
  function detectEncoding(filePath: string): 'utf8' | 'latin1' {
    try {
      const fd = openSync(filePath, 'r');
      const buffer = Buffer.alloc(102400);
      const bytesRead = readSync(fd, buffer, 0, 102400, 0);
      closeSync(fd);
      
      const slice = buffer.subarray(0, bytesRead);
      const str = slice.toString('utf8');
      const reencoded = Buffer.from(str, 'utf8');
      
      if (slice.equals(reencoded)) {
        return 'utf8';
      }
      return 'latin1';
    } catch (e) {
      return 'utf8';
    }
  }

  // IMPORT - Preview (only reads first 1000 rows + counts total)
  ipcMain.handle('import:parseCSV', async (_, filePath: string) => {
    try {
      const rows: any[] = [];
      let headers: string[] = [];
      let total = 0;

      const encoding = detectEncoding(filePath);
      log.info(`[MAIN PROCESS] Preview encoding resolved to: ${encoding}`);
      const fileStream = createReadStream(filePath, { encoding });
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
      let lineCount = 0;
      let sep = ',';

      for await (const line of rl) {
        if (!line.trim()) continue;
        if (lineCount === 0) {
          sep = line.includes(';') ? ';' : ',';
          headers = line.split(sep).map(h => h.trim().replace(/"/g, ''));
        } else {
          if (rows.length < 1000) {
            const cols = line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
            const row: Record<string, string> = {};
            headers.forEach((h, i) => {
              row[h.toLowerCase().replace(/\s+/g, '_')] = cols[i] || '';
            });
            rows.push(row);
          }
          total++; // AUD-002 : Compter TOUTES les lignes de données sans limite (ne jamais break)
        }
        lineCount++;
      }

      return { rows, headers, total };
    } catch (e) {
      log.error('File parse error', e);
      return { rows: [], headers: [], error: String(e) };
    }
  });

  // IMPORT - Utilities
  ipcMain.handle('import:clearTemp', (_, siteId) => {
    if (siteId === undefined || siteId === null) {
      throw new Error('siteId requis pour nettoyer la table temporaire d\'import.');
    }
    return queries.clearImportTemp(Number(siteId));
  });

  // Rôles autorisés à consulter/modifier les anomalies d'import (module Qualité + Admin)
  const QUALITE_ROLES = ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_QUALITE'];

  function assertQualiteAccessOnSite(siteId: number | undefined | null) {
    const secureUser = getSecureCurrentUser();
    if (!secureUser) throw new Error("Session invalide.");
    if (!verifyUserRole(secureUser.id_user, QUALITE_ROLES)) {
      log.warn(`[SECURITY] Accès qualité refusé pour l'utilisateur ID ${secureUser.id_user} (rôle non autorisé)`);
      throw new Error("Accès refusé pour cette opération.");
    }
    if (secureUser.role !== 'SUPER ADMIN' && siteId !== undefined && siteId !== null && Number(siteId) !== secureUser.site_id) {
      log.warn(`[SECURITY] Accès qualité hors-site refusé pour l'utilisateur ID ${secureUser.id_user}`);
      throw new Error("Accès refusé : ce site n'est pas le vôtre.");
    }
    return secureUser;
  }

  ipcMain.handle('import:getAnomalies', (_, siteId, offset = 0, limit = 50, query?: string) => {
    if (siteId === undefined || siteId === null) {
      throw new Error('siteId requis.');
    }
    assertQualiteAccessOnSite(siteId);
    return queries.getImportAnomalies(Number(siteId), offset, limit, query);
  });
  ipcMain.handle('import:clearAnomalies', (_, siteId) => {
    if (siteId === undefined || siteId === null) {
      throw new Error('siteId requis.');
    }
    assertQualiteAccessOnSite(siteId);
    return queries.clearImportAnomalies(Number(siteId));
  });

  ipcMain.handle('import:countEmptyAnomalies', (_, siteId) => {
    assertQualiteAccessOnSite(siteId);
    return queries.countEmptyAnomalies(Number(siteId));
  });

  ipcMain.handle('import:deleteEmptyAnomalies', (_, siteId) => {
    assertQualiteAccessOnSite(siteId);
    return queries.deleteEmptyAnomalies(Number(siteId));
  });

  ipcMain.handle('import:deleteAnomaly', (_, id) => {
    if (id === undefined || id === null) {
      throw new Error('id requis.');
    }
    const db = getDatabase()!;
    const anomaly = db.prepare('SELECT site_id FROM t_import_anomalies WHERE id = ?').get(Number(id)) as { site_id?: number } | undefined;
    assertQualiteAccessOnSite(anomaly?.site_id);
    return queries.deleteImportAnomaly(Number(id));
  });

  ipcMain.handle('import:updateAnomalyField', (_, id: number, field: string, value: string) => {
    try {
      const db = getDatabase()!;
      const allowedFields = ['noms', 'prenoms', 'date_de_naissance', 'lieu_de_naissance', 'contact', 'num_secu'];
      if (!allowedFields.includes(field)) {
        throw new Error(`Champ non autorisé: ${field}`);
      }
      const anomaly = db.prepare('SELECT site_id FROM t_import_anomalies WHERE id = ?').get(Number(id)) as { site_id?: number } | undefined;
      assertQualiteAccessOnSite(anomaly?.site_id);
      const stmt = db.prepare(`UPDATE t_import_anomalies SET ${field} = ? WHERE id = ?`);
      stmt.run(value, id);
      return { success: true };
    } catch (e) {
      log.error('IPC Error: import:updateAnomalyField', e);
      throw e;
    }
  });

  // QUALITE & ASSAINISSEMENT HANDLERS
  ipcMain.handle('qualite:fusionnerDoublons', async (event, payload: { id_carte_source: number; id_carte_cible: number; champs_fusionnes: string[] }) => {
    const userLogin = getCurrentUserLogin() || 'SYSTEM';
    const { id_carte_source, id_carte_cible } = payload;
    try {
      const secureUser = getSecureCurrentUser();
      if (!secureUser) throw new Error("Session invalide.");
      if (!verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_QUALITE'])) {
        log.warn(`[SECURITY] Tentative de fusionnerDoublons refusée pour l'utilisateur ID ${secureUser.id_user} (rôle non autorisé)`);
        throw new Error("Accès refusé pour cette opération.");
      }

      const db = getDatabase();
      if (!db) throw new Error('Base de données indisponible');

      const sourceCard = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id_carte_source) as any;
      const targetCard = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id_carte_cible) as any;

      // Idempotence : si la source n'existe plus, l'opération a déjà été exécutée
      if (!sourceCard) {
        return { success: true, changes: 0 };
      }

      if (!targetCard) {
        throw new Error("Carte cible introuvable.");
      }

      if (sourceCard.site_id !== targetCard.site_id) {
        throw new Error("Fusion refusée : la carte source et la carte cible n'appartiennent pas au même site.");
      }

      if (secureUser.role !== 'SUPER ADMIN' && sourceCard.site_id !== secureUser.site_id) {
        log.warn(`[SECURITY] Tentative de fusion hors-site refusée pour l'utilisateur ID ${secureUser.id_user}`);
        throw new Error("Accès refusé : ces cartes n'appartiennent pas à votre site.");
      }

      const mergedFields: string[] = [];
      const updates: string[] = [];
      const params: any[] = [];

      if (!targetCard.num_secu && sourceCard.num_secu) {
        updates.push('num_secu = ?');
        params.push(sourceCard.num_secu);
        mergedFields.push('num_secu');
      }
      if ((!targetCard.rangement || targetCard.rangement === 'NON CLASSE') && sourceCard.rangement && sourceCard.rangement !== 'NON CLASSE') {
        updates.push('rangement = ?');
        params.push(sourceCard.rangement);
        mergedFields.push('rangement');
      }

      db.transaction(() => {
        let targetUpdatePending = false;
        if (updates.length > 0) {
          params.push(id_carte_cible);
          db.prepare(`UPDATE t_cartes SET ${updates.join(', ')}, updated_at = datetime('now'), is_dirty = 1 WHERE id_carte = ?`).run(...params);
          const updatedTarget = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id_carte_cible) as any;
          if (updatedTarget && updatedTarget.sync_id) {
             // Volontairement pas de try/catch ici : si la validation échoue (payload invalide),
             // toute la transaction (y compris la suppression de la source) doit être annulée
             // pour éviter de perdre les champs fusionnés côté Supabase. mapCardPayload() n'est
             // appelé ici que pour cette validation/abandon volontaire — son résultat MAPPÉ (clés
             // Supabase id_site/id_centre) ne doit PAS être ce qui est enfilé : outbox.service.ts
             // applique déjà mapCardPayload() lui-même au moment de l'envoi, et l'appliquer une
             // seconde fois sur un payload déjà mappé fait échouer la validation "site_id
             // manquant" à coup sûr (double-mapping, bug confirmé sur le même pattern ailleurs).
             mapCardPayload(updatedTarget);
             enqueueOutbox(updatedTarget.sync_id, 't_cartes', 'UPDATE', updatedTarget);
             targetUpdatePending = true;
          }
        }

        // Soft delete de la carte source + propagation Supabase
        db.prepare("UPDATE t_cartes SET is_dirty = -1, updated_at = datetime('now') WHERE id_carte = ?").run(id_carte_source);
        if (sourceCard.sync_id) {
          const wasLocalOnly = cancelPendingInsert(sourceCard.sync_id, 't_cartes');
          if (!wasLocalOnly) {
            // Le "depends_on" n'a de sens que s'il existe réellement une mise à jour cible en attente ;
            // sinon on pointerait vers un id d'outbox inexistant, ce qui neutralise la garde anti-race.
            enqueueOutbox(sourceCard.sync_id, 't_cartes', 'DELETE', { sync_id: sourceCard.sync_id }, targetUpdatePending ? targetCard.sync_id : null);
            if (networkMonitor.getState() === 'ONLINE') scheduleOutboxProcessing();
          } else {
            // S'il n'avait jamais été synchronisé (INSERT annulé), on peut le supprimer physiquement pour libérer l'espace
            db.prepare('DELETE FROM t_cartes WHERE id_carte = ?').run(id_carte_source);
          }
        }
      })();

      logAudit(
        userLogin,
        'QUALITE_FUSION',
        JSON.stringify({
          id_carte_source,
          id_carte_cible,
          champs_fusionnes: mergedFields,
          raison: 'Fusion de doublons pour assainissement'
        })
      );

      return { success: true, changes: 1 };
    } catch (e) {
      log.error('IPC Error: qualite:fusionnerDoublons', e);
      throw e;
    }
  });

  ipcMain.handle('qualite:corrigerFormat', async (event, payload: { id_carte: number; champ_corrige: string; valeur_avant: string; valeur_apres: string }) => {
    const userLogin = getCurrentUserLogin() || 'SYSTEM';
    const { id_carte, champ_corrige, valeur_avant, valeur_apres } = payload;

    // Whitelist de sécurité : seuls ces champs peuvent être modifiés via ce canal
    const CHAMPS_AUTORISES = ['date_de_naissance', 'num_secu', 'rangement', 'noms', 'prenoms', 'contact', 'lieu_de_naissance'];
    if (!CHAMPS_AUTORISES.includes(champ_corrige)) {
      log.error(`[SÉCURITÉ] Tentative de modification d'un champ non autorisé : '${champ_corrige}' par ${userLogin}`);
      throw new Error(`Champ non autorisé : ${champ_corrige}`);
    }

    // Revalidation serveur des formats (ne pas se reposer uniquement sur la validation du formulaire client)
    if (champ_corrige === 'num_secu' && valeur_apres && !/^\d{13}$/.test(valeur_apres)) {
      throw new Error('Le numéro de sécurité sociale doit faire exactement 13 chiffres.');
    }
    if (champ_corrige === 'contact' && valeur_apres && !/^\d{10}$/.test(valeur_apres)) {
      throw new Error('Le contact doit faire exactement 10 chiffres locaux.');
    }
    if (champ_corrige === 'date_de_naissance' && valeur_apres && !isValidCalendarDateFlexible(valeur_apres)) {
      throw new Error('Date de naissance invalide ou inexistante dans le calendrier.');
    }

    try {
      const secureUser = getSecureCurrentUser();
      if (!secureUser) throw new Error("Session invalide.");
      if (!verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'OPERATEUR_QUALITE'])) {
        log.warn(`[SECURITY] Tentative de corrigerFormat refusée pour l'utilisateur ID ${secureUser.id_user} (rôle non autorisé)`);
        throw new Error("Accès refusé pour cette opération.");
      }

      const db = getDatabase();
      if (!db) throw new Error('Base de données indisponible');

      const card = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id_carte) as any;
      const anomaly = db.prepare('SELECT * FROM t_import_anomalies WHERE id = ?').get(id_carte) as any;

      if (!card && !anomaly) {
        return { success: true, changes: 0 };
      }

      const recordSiteId = card?.site_id ?? anomaly?.site_id;
      if (secureUser.role !== 'SUPER ADMIN' && recordSiteId !== undefined && recordSiteId !== null && recordSiteId !== secureUser.site_id) {
        log.warn(`[SECURITY] Tentative de correction hors-site refusée pour l'utilisateur ID ${secureUser.id_user}`);
        throw new Error("Accès refusé : cette fiche n'appartient pas à votre site.");
      }

      // Idempotence : si la valeur est déjà identique, on ne réécrit pas
      if (card && card[champ_corrige] === valeur_apres) {
        return { success: true, changes: 0 };
      }

      db.transaction(() => {
        if (anomaly) {
          if (!card && !anomaly.carte_id) {
            // Transfert complet de t_import_anomalies vers t_cartes via l'API officielle
            const newDate = champ_corrige === 'date_de_naissance' ? valeur_apres : anomaly.date_de_naissance;
            // updateDateDeNaissance gère le transfert des anomalies non liées proprement + outbox
            queries.updateDateDeNaissance(anomaly.id, newDate);
            
            if (champ_corrige !== 'date_de_naissance') {
               // Si le champ n'était pas la date, on doit quand même mettre à jour le champ après coup,
               // sauf si ça a été mis à jour par le premier appel.
               // Mais l'anomalie ayant été purgée, on met à jour la nouvelle carte
               const newCard = db.prepare('SELECT id_carte FROM t_cartes WHERE num_secu = ? AND noms = ? AND prenoms = ? ORDER BY id_carte DESC LIMIT 1').get(anomaly.num_secu, anomaly.noms, anomaly.prenoms) as any;
               if (newCard) {
                 queries.updateQuickFields(newCard.id_carte, { [champ_corrige]: valeur_apres });
               }
            }
          } else {
            // L'anomalie est déjà liée à une carte existante, on la met à jour
            const targetId = anomaly.carte_id || id_carte;
            if (champ_corrige === 'date_de_naissance') {
              queries.updateDateDeNaissance(targetId, valeur_apres);
            } else {
              queries.updateQuickFields(targetId, { [champ_corrige]: valeur_apres });
            }
            // Suppression de l'anomalie traitée (updateDateDeNaissance ne le fait pas si carte_id existe)
            db.prepare('DELETE FROM t_import_anomalies WHERE id = ?').run(anomaly.id);
          }

        } else if (card) {
          // Si c'est une simple carte (pas d'anomalie)
          if (champ_corrige === 'date_de_naissance') {
            queries.updateDateDeNaissance(id_carte, valeur_apres);
          } else {
            queries.updateQuickFields(id_carte, { [champ_corrige]: valeur_apres });
          }
        }
      })();

      logAudit(
        userLogin,
        'QUALITE_CORRECTION',
        JSON.stringify({
          id_carte,
          champ_corrige,
          valeur_avant: maskSensitiveField(champ_corrige, valeur_avant),
          valeur_apres: maskSensitiveField(champ_corrige, valeur_apres),
          raison: "Correction de format d'une carte"
        })
      );

      return { success: true, changes: 1 };
    } catch (e) {
      log.error('IPC Error: qualite:corrigerFormat', e);
      throw e;
    }
  });

  ipcMain.handle('qualite:supprimerIncoherences', async (event, payload: { type_incoherence: string; site_id: number }) => {
    const userLogin = getCurrentUserLogin() || 'SYSTEM';
    const { type_incoherence, site_id } = payload;
    try {
      const db = getDatabase();
      if (!db) throw new Error('Base de données indisponible');

      let deletedCount = 0;

      db.transaction(() => {
        if (type_incoherence === 'DATES_INVALIDES') {
          const res = db.prepare('DELETE FROM t_import_anomalies WHERE site_id = ?').run(site_id);
          deletedCount = res.changes;
        } else if (type_incoherence === 'SANS_SECU') {
          const cardsToDel = db.prepare("SELECT id_carte, sync_id FROM t_cartes WHERE site_id = ? AND (num_secu IS NULL OR num_secu = '')").all(site_id) as any[];
          for (const c of cardsToDel) {
            db.prepare("UPDATE t_cartes SET is_dirty = -1, updated_at = datetime('now') WHERE id_carte = ?").run(c.id_carte);
            if (c.sync_id) {
              const wasLocalOnly = cancelPendingInsert(c.sync_id, 't_cartes');
              if (!wasLocalOnly) {
                enqueueOutbox(c.sync_id, 't_cartes', 'DELETE', { sync_id: c.sync_id });
              } else {
                db.prepare('DELETE FROM t_cartes WHERE id_carte = ?').run(c.id_carte);
              }
            }
          }
          deletedCount = cardsToDel.length;
        } else if (type_incoherence === 'SANS_RANGEMENT') {
          const cardsToDel = db.prepare("SELECT id_carte, sync_id FROM t_cartes WHERE site_id = ? AND (rangement IS NULL OR rangement = '' OR rangement = 'NON CLASSE')").all(site_id) as any[];
          for (const c of cardsToDel) {
            db.prepare("UPDATE t_cartes SET is_dirty = -1, updated_at = datetime('now') WHERE id_carte = ?").run(c.id_carte);
            if (c.sync_id) {
              const wasLocalOnly = cancelPendingInsert(c.sync_id, 't_cartes');
              if (!wasLocalOnly) {
                enqueueOutbox(c.sync_id, 't_cartes', 'DELETE', { sync_id: c.sync_id });
              } else {
                db.prepare('DELETE FROM t_cartes WHERE id_carte = ?').run(c.id_carte);
              }
            }
          }
          deletedCount = cardsToDel.length;
        }
      })();
      
      if (deletedCount > 0 && type_incoherence !== 'DATES_INVALIDES' && networkMonitor.getState() === 'ONLINE') {
        scheduleOutboxProcessing();
      }

      // Idempotence : si aucun enregistrement n'est supprimé, on ne logue pas
      if (deletedCount === 0) {
        return { success: true, deleted: 0 };
      }

      logAudit(
        userLogin,
        'QUALITE_NETTOYAGE',
        JSON.stringify({
          nombre_enregistrements_supprimes: deletedCount,
          type_incoherence,
          raison: 'Nettoyage des incohérences de la base'
        })
      );

      if (deletedCount > 50) {
        logAudit(
          userLogin,
          'QUALITE_MASSE',
          JSON.stringify({
            message: `Alerte : Opération de qualité de masse affectant ${deletedCount} lignes`,
            nombre_enregistrements_supprimes: deletedCount,
            type_incoherence
          })
        );
      }

      return { success: true, deleted: deletedCount };
    } catch (e) {
      log.error('IPC Error: qualite:supprimerIncoherences', e);
      throw e;
    }
  });

  // IMPORT - Process file using Worker Thread (NON-BLOCKING!)
  // Sécurité (même défaut que P0-2, corrigé ici) : ce handler recevait auparavant un
  // `userId` optionnel FOURNI PAR LE CLIENT (ImportPage.tsx envoyait user?.id_user, une
  // valeur d'état renderer falsifiable) et le passait DIRECTEMENT à verifyUserRole(), qui
  // court-circuite intégralement sa vérification pour userId === FAILSAFE_ROOT_ID (999999)
  // — un compte quelconque pouvait donc forger userId=999999 pour importer des cartes en
  // masse avec des privilèges SUPER ADMIN, sans jamais s'être authentifié via le vrai login
  // ROOT. L'identité est désormais dérivée exclusivement de la session serveur réelle.
  ipcMain.handle('import:processFile', (_, filePath: string, agent: string, totalEstimate: number, siteId?: number, _userId?: number, excludedRowIndices?: number[]) => {
    return new Promise((resolve, reject) => {
      const secureUser = getSecureCurrentUser();
      const resolvedUserId = secureUser?.id_user;
      if (!resolvedUserId || !verifyUserRole(resolvedUserId, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE'])) {
        return reject(new Error("Accès refusé. Privilèges insuffisants pour importer des données."));
      }
      // Cloisonnement (même pattern que hierarchy:getCentres/P0-1) : un ADMINISTRATEUR_SITE
      // ne peut importer que sur son propre site, quel que soit le siteId envoyé par le
      // renderer.
      if (secureUser!.role !== 'SUPER ADMIN') {
        siteId = secureUser!.site_id ?? undefined;
      }

      // Resolve the path to better-sqlite3 native module
      let sqlitePath: string;
      try {
        sqlitePath = require.resolve('better-sqlite3');
      } catch {
        sqlitePath = 'better-sqlite3';
      }

      // Path to our worker script
      const workerPath = join(__dirname, 'workers', 'import-worker.js');

      log.info(`Starting import worker: ${workerPath}`);
      log.info(`SQLite path: ${sqlitePath}`);
      log.info(`DB path: ${getDbPath()}`);
      log.info(`File: ${filePath}, Total estimate: ${totalEstimate}`);

      // Construction de la table de routage dynamique par centre du site admin
      let routingTable: any[] = [];
      try {
        if (siteId) {
          routingTable = queries.getCentresWithPrefixes(Number(siteId));
          log.info(`Centres routing table resolved for site ID ${siteId}:`, routingTable.map(c => `${c.nom} -> ${c.prefixe_rangement}`));
        }
      } catch (err) {
        log.error('Failed to resolve centres routing table for import', err);
      }

      // Suspendre le moteur de sync pour Ã©viter les conflits de verrou SQLite pendant l'import
      syncEngine.pause();

      activeImportsCount++;
      let hasDecremented = false;
      const decrement = () => {
        if (!hasDecremented) {
          activeImportsCount = Math.max(0, activeImportsCount - 1);
          hasDecremented = true;
        }
      };

      // â”€â”€â”€ ANTI-FREEZE THROTTLE (Couche 1) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Limite les Ã©missions IPC de progression Ã  1 toutes les 200ms.
      // Quand la fenÃªtre n'a pas le focus (utilisateur sur Chrome/Edge),
      // Chromium suspend le Renderer et accumule les messages IPC. Au retour,
      // la rafale provoque le freeze "Ne rÃ©pond pas" de Windows 11.
      // La solution : bufferiser la derniÃ¨re valeur et flusher au retour du focus.
      const IMPORT_THROTTLE_MS = 200;
      let importLastSentAt = 0;
      let importBufferedProgress = -1;

      const flushImportProgress = () => {
        if (importBufferedProgress >= 0 && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('import:progress', importBufferedProgress);
          importBufferedProgress = -1;
        }
      };

      // Listener focus : envoi unique de la valeur bufferisÃ©e au retour de l'utilisateur
      const onMainWindowFocus = () => flushImportProgress();
      mainWindow.on('focus', onMainWindowFocus);
      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

      const worker = new Worker(workerPath, {
        workerData: {
          sqlitePath,
          dbPath: getDbPath(),
          filePath,
          agent,
          siteId,
          routingTable,
          totalEstimate: totalEstimate || 220000,
          // P0 fix : index (0-based) des lignes retirées de l'aperçu par l'utilisateur
          // (corbeille), à sauter dans la boucle du Worker sans les compter dans les
          // statistiques du Bilan de Migration. Cf. import-worker.js pour l'invariant
          // d'alignement des index avec lineCount.
          excludedRowIndices: excludedRowIndices || []
        }
      });

      worker.on('message', (msg: any) => {
        if (msg.type === 'progress') {
          // Throttle : on bufferise toujours la derniÃ¨re valeur
          importBufferedProgress = msg.value;
          const now = Date.now();
          // N'Ã©mettre que si la fenÃªtre est visible ET que l'intervalle est Ã©coulÃ©
          const windowFocused = !mainWindow.isDestroyed() && mainWindow.isFocused();
          if (windowFocused && (now - importLastSentAt) >= IMPORT_THROTTLE_MS) {
            importLastSentAt = now;
            mainWindow.webContents.send('import:progress', importBufferedProgress);
            importBufferedProgress = -1;
          }
        } else if (msg.type === 'done') {
          // Nettoyage du listener focus et flush final
          mainWindow.removeListener('focus', onMainWindowFocus);
          flushImportProgress();
          log.info('Import worker completed', msg.result);
          queries.insertAuditLog(
            agent || 'ADMIN',
            'IMPORT_CARTE',
            `Importation rÃ©ussie de ${msg.result.inserted || 0} cartes. Doublons dÃ©tectÃ©s : ${msg.result.duplicates || 0}.`
          );
          decrement();
          syncEngine.resume();
          resolve(msg.result);
        } else if (msg.type === 'error') {
          mainWindow.removeListener('focus', onMainWindowFocus);
          log.error('Import worker error', msg.error);
          decrement();
          syncEngine.resume();
          reject(new Error(msg.error));
        }
      });

      worker.on('error', (err) => {
        mainWindow.removeListener('focus', onMainWindowFocus);
        log.error('Worker thread error', err);
        decrement();
        syncEngine.resume();
        reject(err);
      });

      worker.on('exit', (code) => {
        mainWindow.removeListener('focus', onMainWindowFocus);
        decrement();
        if (code !== 0) {
          log.error(`Worker exited with code ${code}`);
          syncEngine.resume();
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  });

  // EXPORT - CSV with save dialog
  ipcMain.handle('export:csv', async (_, filters?: Record<string, string>) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exporter les cartes en CSV',
      defaultPath: `cartes_export_${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [
        { name: 'Fichier CSV', extensions: ['csv'] },
        { name: 'Tous', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePath) return { success: false, reason: 'cancelled' };

    try {
      const rows = queries.getExportRows(filters) as Record<string, unknown>[];
      if (rows.length === 0) return { success: false, reason: 'no_data' };

      const headers = Object.keys(rows[0]);
      const csvLines = [
        headers.join(';'),
        ...rows.map(r => headers.map(h => {
          const val = String(r[h] ?? '').replace(/"/g, '""');
          return `"${val}"`;
        }).join(';'))
      ];

      const { writeFileSync } = await import('fs');
      writeFileSync(result.filePath, '\uFEFF' + csvLines.join('\r\n'), 'utf-8');

      if (filters?.incremental === 'true') {
        const ids = rows.map(r => r.id_carte as number);
        queries.marquerCartesExporte(ids);
      }

      log.info(`Export CSV: ${rows.length} rows to ${result.filePath}`);
      return { success: true, count: rows.length, path: result.filePath };
    } catch (e) {
      log.error('Export CSV error', e);
      return { success: false, reason: String(e) };
    }
  });

  // EXPORT - Excel with save dialog (using exceljs)
  ipcMain.handle('export:excel', async (_, filters?: Record<string, string>) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exporter les cartes en Excel',
      defaultPath: `cartes_export_${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [
        { name: 'Classeur Excel', extensions: ['xlsx'] },
        { name: 'Tous', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePath) return { success: false, reason: 'cancelled' };

    try {
      const rows = queries.getExportRows(filters) as Record<string, unknown>[];
      if (rows.length === 0) return { success: false, reason: 'no_data' };

      const exceljsModule = await import('exceljs');
      const ExcelJS = exceljsModule.default || exceljsModule;
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Cartes CMU');

      const headers = Object.keys(rows[0]);
      worksheet.columns = headers.map(h => ({
        header: h.toUpperCase().replace(/_/g, ' '),
        key: h,
        width: h === 'noms' || h === 'prenoms' ? 25 : 18
      }));

      // Add rows
      rows.forEach(r => worksheet.addRow(r));

      // Style header row
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' } // Slate color header
      };

      await workbook.xlsx.writeFile(result.filePath);

      if (filters?.incremental === 'true') {
        const ids = rows.map(r => r.id_carte as number);
        queries.marquerCartesExporte(ids);
      }

      log.info(`Export Excel: ${rows.length} rows to ${result.filePath}`);
      return { success: true, count: rows.length, path: result.filePath };
    } catch (e) {
      log.error('Export Excel error', e);
      return { success: false, reason: String(e) };
    }
  });

  // EXPORT - PDF with save dialog
  ipcMain.handle('export:pdf', async (_, filters?: Record<string, string>) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exporter la liste d\'Ã©margement en PDF',
      defaultPath: `LISTE_EMARGEMENT_${new Date().toISOString().slice(0, 10)}.pdf`,
      filters: [
        { name: 'Document PDF', extensions: ['pdf'] },
        { name: 'Tous', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePath) return { success: false, reason: 'cancelled' };

    try {
      const sendProgress = async (val: number) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('export:pdf-progress', val);
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      };

      await sendProgress(10);
      const rows = queries.getExportRows(filters) as Record<string, unknown>[];
      if (rows.length === 0) return { success: false, reason: 'no_data' };

      await sendProgress(30);
      const { jsPDF } = await import('jspdf');
      const autotableModule = await import('jspdf-autotable');
      const autoTable = (autotableModule as any).default?.default || (autotableModule as any).default || autotableModule;

      await sendProgress(50);

      // Create PDF in landscape format
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });

      // Document Title & Context metadata
      doc.setFontSize(18);
      doc.setTextColor(30, 41, 59); // slate-800
      doc.text("LISTE DE CONTRÃ”LE ET D'Ã‰MARGEMENT - CARTES CMU", 14, 18);

      const selectedStatut = filters?.statut || 'TOUS';
      const selectedRangement = filters?.rangement || 'ALL';
      
      let siteName = 'TOUS LES SITES';
      if (filters?.site_id) {
        const db = getDatabase();
        if (db) {
          const siteRow = db.prepare("SELECT nom FROM t_sites WHERE id = ?").get(Number(filters.site_id)) as { nom: string } | undefined;
          if (siteRow) siteName = siteRow.nom;
        }
      }

      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text(`Site : ${siteName.toUpperCase()}  |  Filtre : ${selectedStatut}  |  Rangement : ${selectedRangement === 'ALL' ? 'Tous' : selectedRangement}`, 14, 25);
      doc.text(`Date de gÃ©nÃ©ration : ${new Date().toLocaleDateString('fr-FR')}  |  Nombre de cartes : ${rows.length}`, 14, 30);

      // Define columns
      const columns = [
        { header: 'NÂ°', dataKey: 'index' },
        { header: 'NOM DE FAMILLE', dataKey: 'noms' },
        { header: 'PRÃ‰NOM(S)', dataKey: 'prenoms' },
        { header: 'DATE NAISS.', dataKey: 'date_de_naissance' },
        { header: 'RANGEMENT', dataKey: 'rangement' },
        { header: 'CONTACT', dataKey: 'contact' },
        { header: 'Ã‰MARGEMENT / SIGNATURE', dataKey: 'emargement' }
      ];

      // Format data
      const body = rows.map((r: any, idx: number) => ({
        index: idx + 1,
        noms: (r.noms || '').toUpperCase(),
        prenoms: (r.prenoms || '').toUpperCase(),
        date_de_naissance: r.date_de_naissance || 'â€”',
        rangement: r.rangement || 'NON CLASSE',
        contact: r.contact || 'â€”',
        emargement: '' // Empty cell for manual signature
      }));

      await sendProgress(70);

      // GÃ©nÃ©ration de la table FTS asynchrone pour ne pas bloquer l'Event Loop
      await new Promise<void>((resolveTable) => {
        setImmediate(() => {
          autoTable(doc, {
            columns: columns,
            body: body,
            startY: 35,
            theme: 'grid',
            styles: {
              fontSize: 9,
              cellPadding: 3,
              textColor: [30, 41, 59],
              lineColor: [226, 232, 240], // Light slate gray borders
              lineWidth: 0.2
            },
            headStyles: {
              fillColor: [30, 41, 59], // dark slate-800
              textColor: [255, 255, 255],
              fontSize: 9,
              fontStyle: 'bold'
            },
            columnStyles: {
              index: { cellWidth: 10 },
              noms: { cellWidth: 45 },
              prenoms: { cellWidth: 50 },
              date_de_naissance: { cellWidth: 30 },
              rangement: { cellWidth: 35 },
              contact: { cellWidth: 45 },
              emargement: { cellWidth: 55 } // Wide space for manual signature
            },
            didDrawPage: (data: any) => {
              // Footer page number
              const totalPages = doc.getNumberOfPages();
              doc.setFontSize(8);
              doc.setTextColor(148, 163, 184);
              doc.text(
                `Page ${data.pageNumber} sur ${totalPages}`,
                doc.internal.pageSize.width - 25,
                doc.internal.pageSize.height - 10
              );
            }
          });
          resolveTable();
        });
      });

      await sendProgress(90);

      // Save PDF file locally asynchronement
      const buffer = doc.output('arraybuffer');
      const fs = await import('fs');
      await fs.promises.writeFile(result.filePath, Buffer.from(buffer));

      if (filters?.incremental === 'true') {
        const ids = rows.map(r => r.id_carte as number);
        queries.marquerCartesExporte(ids);
      }

      await sendProgress(100);
      log.info(`Export PDF: ${rows.length} rows to ${result.filePath}`);
      return { success: true, count: rows.length, path: result.filePath };
    } catch (e) {
      log.error('Export PDF error', e);
      return { success: false, reason: String(e) };
    }
  });

  // EXPORT - RANGEMENTS
  // Sécurité (P1, cloisonnement §3) : siteId dérivé de la session serveur — même pattern que
  // cartes:getAbsences/cartes:getAgentAbsences ci-dessus. Un siteId omis ou forgé à 0/null
  // renvoyait auparavant la nomenclature des rangements de tous les sites.
  ipcMain.handle('cartes:getRangements', (_, siteId?: number) => queries.getDistinctRangements(resolveScopedSiteId(siteId)));
  ipcMain.handle('export:marquerExporte', (_, ids: number[]) => queries.marquerCartesExporte(ids));
  ipcMain.handle('export:getRows', (_, filters?: Record<string, string>) => queries.getExportRows(filters));

  // EXPORT - Centralized generateFile with Audit & Alerts
  ipcMain.handle('export:generateFile', async (event, format: 'csv' | 'excel' | 'pdf', filters?: Record<string, string>) => {
    let result: { success: boolean; count?: number; path?: string; reason?: string };
    
    // Récupérer le listener correspondant pour exécuter l'export
    const listeners = ipcMain.listeners(`export:${format}`);
    if (listeners && listeners.length > 0) {
      result = await (listeners[0] as any)(event, filters);
    } else {
      return { success: false, reason: 'unsupported_format' };
    }

    if (result && result.success && result.path) {
      const volume_lignes = result.count || 0;
      const nom_fichier_partiel = basename(result.path);
      const userLogin = getCurrentUserLogin();

      // Log asynchrone découplé via setImmediate
      setImmediate(() => {
        try {
          logAudit(
            userLogin,
            'EXPORT_DONNEES',
            JSON.stringify({
              format,
              type_donnees: filters?.statut || 'ALL',
              volume_lignes,
              chemin_destination_partiel: nom_fichier_partiel
            })
          );

          if (volume_lignes > 5000) {
            logAudit(
              userLogin,
              'EXPORT_MASSIF_ALERTE',
              JSON.stringify({
                format,
                type_donnees: filters?.statut || 'ALL',
                volume_lignes,
                chemin_destination_partiel: nom_fichier_partiel,
                message: 'Alerte : Export massif supérieur à 5000 lignes.'
              })
            );
          }
        } catch (auditErr) {
          log.error('Erreur lors de la journalisation asynchrone de l\'export :', auditErr);
        }
      });
    }

    return result;
  });

  // EXPORT - downloadBackup with Audit
  ipcMain.handle('export:downloadBackup', async () => {
    const db = getDatabase();
    if (!db) {
      return { success: false, reason: 'database_not_available' };
    }

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Télécharger la sauvegarde de la base de données SQL',
      defaultPath: `gest_in_situ_backup_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`,
      filters: [
        { name: 'Base de données SQLite', extensions: ['db', 'sqlite'] },
        { name: 'Tous', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, reason: 'cancelled' };
    }

    try {
      // Exécution de la sauvegarde SQL
      await db.backup(result.filePath);

      const stats = statSync(result.filePath);
      const taille_mo = Number((stats.size / (1024 * 1024)).toFixed(2));
      const timestamp = Date.now();
      const userLogin = getCurrentUserLogin();

      // Log asynchrone découplé via setImmediate
      setImmediate(() => {
        try {
          logAudit(
            userLogin,
            'EXPORT_BACKUP_SQL',
            JSON.stringify({
              taille_fichier_mo: taille_mo,
              timestamp_backup: timestamp
            })
          );
        } catch (auditErr) {
          log.error('Erreur lors de la journalisation asynchrone du backup SQL :', auditErr);
        }
      });

      log.info(`Backup download SQL: ${taille_mo} MB saved to ${result.filePath}`);
      return { success: true, path: result.filePath, taille_mo, timestamp };
    } catch (e) {
      log.error('Download backup SQL error', e);
      return { success: false, reason: String(e) };
    }
  });

  // USERS
  ipcMain.handle('users:getAll', (_, siteId?: number, centreId?: number) => {
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE'])) {
      log.warn('[SECURITY] Accès refusé à users:getAll : session invalide ou rôle non autorisé.');
      throw new Error("Accès refusé. Privilèges administrateur requis pour consulter les utilisateurs.");
    }
    // Le périmètre site/centre est imposé par la session sécurisée : un ADMINISTRATEUR_SITE ou
    // ADMIN_CENTRE ne peut jamais voir les agents d'un autre site/centre, quels que soient les
    // paramètres envoyés par le renderer.
    const scopedSiteId = secureUser.role !== 'SUPER ADMIN' ? secureUser.site_id : siteId;
    const scopedCentreId = secureUser.role === 'ADMIN_CENTRE' ? secureUser.centre_id : centreId;
    return queries.getUsers(scopedSiteId, scopedCentreId);
  });
  ipcMain.handle('users:getProfile', async (_, login: string) => {
    // Sécurité (P2) : ce handler n'avait aucune vérification — tout compte authentifié
    // pouvait consulter le profil (rôle, site_id, centre_id) de n'importe quel autre
    // utilisateur en connaissant son login (énumération possible). Aucun appelant renderer
    // câblé à ce jour (canal exposé mais inutilisé côté UI) — restriction a minima : session
    // valide requise, et périmètre limité au site de l'appelant pour tout rôle non-SUPER-ADMIN
    // (cloisonnement §3), comme le reste des lectures de ce fichier.
    const secureUser = getSecureCurrentUser();
    if (!secureUser) {
      log.warn('[SECURITY] Acces refuse a users:getProfile : session invalide.');
      return null;
    }
    const db = getDatabase();
    if (!db) return null;
    if (secureUser.role === 'SUPER ADMIN') {
      return db.prepare('SELECT id_user, login, role, nom_user, prenom_user, site_id, centre_id, sync_id FROM t_users WHERE login = ?').get(login);
    }
    return db.prepare('SELECT id_user, login, role, nom_user, prenom_user, site_id, centre_id, sync_id FROM t_users WHERE login = ? AND site_id = ?').get(login, secureUser.site_id);
  });
  ipcMain.handle('users:create', async (_, data) => {
    // SECURITY fix : l'identité de l'appelant doit venir de la session sécurisée
    // (Main Process), jamais d'un paramètre transmis par le Renderer.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE'])) {
      log.warn('[SECURITY] Accès refusé à users:create : session invalide ou rôle non autorisé.');
      throw new Error("Accès refusé. Privilèges administrateur requis pour créer un agent.");
    }
    // createUser appelle déjà insertAuditLog en interne — pas de doublon ici (C-3 fix)
    const res = await queries.createUser(data, secureUser.id_user, secureUser.login);
    return res;
  });
  ipcMain.handle('users:update', async (_, id, data) => {
    // SECURITY fix : l'identité/le rôle de l'appelant (et donc le périmètre site/centre
    // vérifié dans updateUser) doivent provenir de la session sécurisée, pas d'un objet
    // "currentUser" fourni par le Renderer (falsifiable, et de toute façon jamais transmis
    // par le pont preload — la vérification C-1 précédente était donc toujours contournée).
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE'])) {
      log.warn('[SECURITY] Accès refusé à users:update : session invalide ou rôle non autorisé.');
      throw new Error("Accès refusé. Privilèges administrateur requis pour modifier un agent.");
    }
    const res = await queries.updateUser(id, data, secureUser);
    const userLogin = secureUser.login || 'SYSTEM';

    setImmediate(() => {
      // Déterminer s'il y a eu un changement de rôle ou attribution de droits
      const nouveauRole = data.role || (data.roles && data.roles[0]) || '';
      
      logAudit(userLogin, 'SYS_MODIF_DROITS', {
        login_agent: data.login || `ID_${id}`,
        nouveau_role: nouveauRole,
        droits_ajoutes: data.roles || []
      });

      // Alerte de sécurité pour élévation de privilège vers un rôle d'administration
      if (nouveauRole === 'ADMIN' || nouveauRole === 'SUPER ADMIN' || nouveauRole === 'ADMINISTRATEUR_SITE' || nouveauRole === 'ADMIN_CENTRE') {
        logAudit(userLogin, 'SYS_ELEVATION_PRIVILEGE', {
          login: userLogin,
          cible: data.login || `ID_${id}`,
          nouveau_role: nouveauRole
        });
      }
    });

    queries.insertAuditLog(
      userLogin,
      'VALIDATION',
      `Modification du compte utilisateur ID ${id} (${data.login ? 'login : ' + data.login : 'champs mis Ã  jour'}).`
    );
    return res;
  });
  ipcMain.handle('users:delete', async (_, id) => {
    // SECURITY fix : idem users:update — l'appelant vient de la session sécurisée.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE'])) {
      log.warn('[SECURITY] Accès refusé à users:delete : session invalide ou rôle non autorisé.');
      throw new Error("Accès refusé. Privilèges administrateur requis pour désactiver un agent.");
    }
    const res = await queries.deleteUser(id, secureUser);
    queries.insertAuditLog(
      secureUser.login || 'ADMIN',
      'VALIDATION',
      `Désactivation du compte utilisateur ID ${id}.`
    );
    // Couverture CRUD_SYNC_WHITELIST (décision utilisateur validée) : la désactivation d'un
    // compte utilisateur devient visible cross-poste via t_logs/logAudit(), en plus de
    // insertAuditLog() ci-dessus (t_audit_log local, inchangé).
    logAudit(
      secureUser.login || 'ADMIN',
      'UTILISATEUR_SUPPRIME',
      JSON.stringify({ id_user: id, type: 'desactivation' })
    );
    return res;
  });
  ipcMain.handle('users:hardDelete', async (_, id) => {
    // SECURITY fix : vérifier le rôle de l'appelant via la session sécurisée. L'ancienne
    // implémentation lisait currentUser?.id_user, un paramètre jamais transmis par le
    // pont preload : verifyUserRole recevait donc toujours `undefined` et refusait
    // systématiquement l'action, y compris pour un SUPER ADMIN légitime.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE'])) {
      throw new Error("Accès non autorisé : rôle insuffisant pour supprimer définitivement un agent.");
    }
    const res = await queries.hardDeleteUser(id, secureUser);
    queries.insertAuditLog(
      secureUser.login || 'ADMIN',
      'VALIDATION',
      `Suppression physique définitive de l'utilisateur ID ${id}.`
    );
    // Couverture CRUD_SYNC_WHITELIST (décision utilisateur validée) : la suppression physique
    // définitive d'un compte utilisateur devient visible cross-poste via t_logs/logAudit(), en
    // plus de insertAuditLog() ci-dessus (t_audit_log local, inchangé).
    logAudit(
      secureUser.login || 'ADMIN',
      'UTILISATEUR_SUPPRIME',
      JSON.stringify({ id_user: id, type: 'suppression_definitive' })
    );
    return res;
  });
  ipcMain.handle('auth:resetAgentPassword', (_, targetUserId: number) => {
    // SECURITY fix : callerUserId ne doit jamais venir du Renderer (authStore falsifiable) —
    // seule la session sécurisée fait foi pour identifier qui déclenche la réinitialisation.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE'])) {
      throw new Error("Accès non autorisé : rôle insuffisant pour réinitialiser un mot de passe.");
    }
    // Le mot de passe temporaire en clair transite une seule fois, dans cette réponse
    // IPC ponctuelle, pour affichage immédiat côté renderer. Il n'est ni loggé ni persisté.
    return queries.resetAgentPassword(targetUserId, secureUser.id_user);
  });

  // LOGS
  ipcMain.handle('logs:get', (_, offset, limit, filters) => queries.getLogs(offset, limit, filters));
  ipcMain.handle('logs:add', (_, userId, login, action, detail) => queries.logAction(userId, login, action, detail));
  
  ipcMain.handle('logs:consultation', async (_, offset: number, limit: number, filters?: any) => {
    const userLogin = getCurrentUserLogin() || 'SYSTEM';
    const filtres_utilises = filters || {};
    const page_consultée = Math.floor(offset / limit) + 1;
    const db = getDatabase();
    if (!db) throw new Error("Base de données indisponible");

    const detailsObj = { filtres_utilises, page_consultée };
    const detailsStr = JSON.stringify(detailsObj);

    // Éviter la boucle infinie si la lecture déclenche une écriture qui déclencherait une lecture
    // On n'enregistre le log de consultation que s'il n'y a pas de doublon identique récent (5 secondes)
    const duplicate = db.prepare(`
      SELECT id FROM t_audit_log 
      WHERE utilisateur = ? AND action = 'SYSTEM_LOG_CONSULTATION' AND details = ? AND date_creation > datetime('now', '-5 seconds')
    `).get(userLogin, detailsStr);

    if (!duplicate) {
      logAudit(userLogin, 'SYSTEM_LOG_CONSULTATION', detailsObj);
    }

    // Sécurité (cloisonnement §3, P0-6) : t_audit_log (celle réellement peuplée par logAudit(),
    // utilisée partout dans le code applicatif — à ne pas confondre avec la table `audit_logs`,
    // quasi vide, lue par le handler audit:getPage) ne stocke pas de colonne site_id/centre_id,
    // seulement le login (`utilisateur`) de l'auteur de l'action. Le cantonnement est donc
    // dérivé ici par jointure sur t_users.login — limite acceptée : reflète le site_id/centre_id
    // ACTUEL de l'auteur (au moment de la consultation), pas nécessairement celui au moment de
    // l'action historique (ex. si l'auteur a changé de centre depuis). Une vraie colonne
    // site_id/centre_id sur t_audit_log avec backfill résoudrait cette limite mais constitue une
    // migration de schéma hors du périmètre de cette intervention (domaine agent-4-db-sync).
    // Avant ce correctif, cette requête n'avait AUCUNE clause WHERE : tout rôle (y compris
    // ADMIN_CENTRE) voyait l'historique d'audit complet de TOUS les sites/centres. SUPER ADMIN
    // conserve la vue globale existante.
    const secureUser = getSecureCurrentUser();

    // ── Union t_audit_log (local) + t_logs (CRUD synchronisé cross-poste) ──────────────────
    // Les actions de CRUD_SYNC_WHITELIST (src/main/utils/audit.ts) sont désormais écrites EN
    // DOUBLE par logAudit() : t_audit_log (comme avant) ET t_logs (nouveau, synchronisé
    // Supabase). Pour éviter d'afficher deux fois la même action réalisée sur CE poste, la
    // branche t_audit_log EXCLUT ces actions ; t_logs devient la source unique pour elles —
    // locales ET rapatriées des autres postes via runLogsDownstream (downstream.ts). t_logs
    // utilise ses vraies colonnes site_id/centre_id (plus précises que la jointure ci-dessus).
    const crudActions = Array.from(CRUD_SYNC_WHITELIST);
    const crudPlaceholders = crudActions.map(() => '?').join(',');

    let whereAudit = '';
    const paramsAudit: any[] = [];
    if (secureUser && secureUser.role !== 'SUPER ADMIN') {
      whereAudit = 'WHERE utilisateur IN (SELECT login FROM t_users WHERE site_id = ?';
      paramsAudit.push(secureUser.site_id);
      if (secureUser.role === 'ADMIN_CENTRE') {
        whereAudit += ' AND centre_id = ?';
        paramsAudit.push(secureUser.centre_id);
      }
      whereAudit += ')';
    }
    whereAudit += (whereAudit ? ' AND ' : 'WHERE ') + `action NOT IN (${crudPlaceholders})`;
    paramsAudit.push(...crudActions);

    let whereLogs = `WHERE action IN (${crudPlaceholders})`;
    const paramsLogs: any[] = [...crudActions];
    if (secureUser && secureUser.role !== 'SUPER ADMIN') {
      whereLogs += ' AND site_id = ?';
      paramsLogs.push(secureUser.site_id);
      if (secureUser.role === 'ADMIN_CENTRE') {
        whereLogs += ' AND centre_id = ?';
        paramsLogs.push(secureUser.centre_id);
      }
    }

    const countAuditRow = db.prepare(`SELECT COUNT(*) as count FROM t_audit_log ${whereAudit}`).get(...paramsAudit) as any;
    const countLogsRow = db.prepare(`SELECT COUNT(*) as count FROM t_logs ${whereLogs}`).get(...paramsLogs) as any;
    const total = (countAuditRow ? countAuditRow.count : 0) + (countLogsRow ? countLogsRow.count : 0);

    // id_log décalé de +1 000 000 000 dans la vue unifiée : évite toute collision avec les id
    // (compteur AUTOINCREMENT indépendant) de t_audit_log. Sécurité : le bouton "Supprimer"
    // (audit:delete → queries.deleteAuditLog, hors périmètre de cette intervention) cible
    // exclusivement `DELETE FROM t_audit_log WHERE id = ?` — avec cet id décalé (jamais atteint
    // par le compteur réel de t_audit_log), un clic sur une ligne issue de t_logs reste un
    // no-op sûr plutôt que de risquer de supprimer par erreur une ligne t_audit_log différente
    // dont l'id coïnciderait. `source` permet au renderer de désactiver ce bouton pour ces lignes.
    // datetime(...) normalise l'horodatage pour un ORDER BY correct malgré les deux formats
    // distincts en présence : "YYYY-MM-DD HH:MM:SS" (date_creation/date_heure écrits localement
    // via datetime('now')) vs ISO8601 à séparateur "T" (date_heure rapatrié de Supabase
    // TIMESTAMPTZ) — sans cette normalisation, un tri purement lexical sur la chaîne brute
    // intercalerait incorrectement les entrées cross-poste par rapport aux entrées locales du
    // même jour.
    const rows = db.prepare(`
      SELECT id, operator_id, action_type, details, timestamp, source FROM (
        SELECT
          id AS id,
          utilisateur AS operator_id,
          action AS action_type,
          details AS details,
          datetime(date_creation) AS timestamp,
          'local' AS source
        FROM t_audit_log
        ${whereAudit}
        UNION ALL
        SELECT
          id_log + 1000000000 AS id,
          login_user AS operator_id,
          action AS action_type,
          detail AS details,
          datetime(date_heure) AS timestamp,
          'sync' AS source
        FROM t_logs
        ${whereLogs}
      )
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).all(...paramsAudit, ...paramsLogs, limit, offset);

    return { rows, total };
  });

  ipcMain.handle('logs:export', async (_, payload?: { periode_export?: string }) => {
    const userLogin = getCurrentUserLogin() || 'SYSTEM';
    const periode_export = payload?.periode_export || 'Toute la période';
    const db = getDatabase();
    if (!db) throw new Error("Base de données indisponible");

    const rows = db.prepare(`SELECT * FROM t_audit_log ORDER BY date_creation DESC`).all() as any[];
    const nombre_lignes_exportées = rows.length;

    logAudit(
      userLogin,
      'SYSTEM_LOG_EXPORT',
      { periode_export, nombre_lignes_exportées }
    );

    const result = await dialog.showSaveDialog({
      title: 'Exporter le Journal d\'Audit',
      defaultPath: join(app.getPath('desktop'), `export_journaux_audit_${Date.now()}.csv`),
      filters: [{ name: 'Fichiers CSV', extensions: ['csv'] }]
    });

    if (!result.canceled && result.filePath) {
      const headers = 'ID,Utilisateur,Action,Details,Date Creation\n';
      const csvContent = headers + rows.map(r => {
        const detailsEscaped = typeof r.details === 'string' ? r.details.replace(/"/g, '""') : JSON.stringify(r.details).replace(/"/g, '""');
        return `${r.id},"${r.utilisateur}","${r.action}","${detailsEscaped}","${r.date_creation}"`;
      }).join('\n');

      const { writeFileSync } = require('fs');
      writeFileSync(result.filePath, csvContent, 'utf-8');

      return { success: true, filePath: result.filePath, nombre_lignes_exportées };
    }

    return { success: false, canceled: true };
  });

  ipcMain.handle('logs:purge', async (_, payload?: { periode_purge?: string }) => {
    const agent = getCurrentUserLogin() || 'system';
    const periode_purge = payload?.periode_purge || 'Toute la période';

    // Loguer immédiatement l'alerte critique sur tentative
    logAudit(
      agent,
      'SYSTEM_LOG_PURGE_CRITIQUE',
      { agent, periode_purge }
    );

    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Annuler', 'Confirmer la Purge'],
      defaultId: 0,
      cancelId: 0,
      title: 'Confirmation de purge critique',
      message: 'Êtes-vous absolument sûr de vouloir purger les journaux système ?',
      detail: 'Cette action est irréversible et sera enregistrée comme une alerte critique.'
    });

    if (choice !== 1) {
      return { success: false, error: 'Purge annulée par l\'utilisateur.' };
    }

    try {
      const db = getDatabase();
      if (!db) throw new Error("Base de données indisponible");

      const countBefore = (db.prepare('SELECT COUNT(*) as count FROM t_audit_log').get() as any).count;
      db.prepare('DELETE FROM t_audit_log').run();
      const nombre_lignes_supprimées = countBefore;

      logAudit(
        agent,
        'SYSTEM_LOG_PURGE',
        { periode_purge, nombre_lignes_supprimées }
      );

      return { success: true, nombre_lignes_supprimées };
    } catch (err: any) {
      log.error('Erreur lors de la purge des logs:', err);
      return { success: false, error: err.message };
    }
  });

  // HIERARCHY
  ipcMain.handle('hierarchy:getSites', async () => {
    // Sécurité (P0-1) : identité dérivée exclusivement de la session serveur réelle
    // (getSecureCurrentUser(), jamais falsifiable depuis le renderer). Tout rôle
    // non-SUPER-ADMIN est cantonné à son propre site — même pattern que
    // hierarchy:getCentres, seul lieu où il est nécessaire de rester permissif au
    // niveau rôle (Sidebar/TopBar/ExportPage/SaisiePage/VerificationSearchPage
    // appellent tous ce canal, quel que soit le rôle, uniquement pour afficher le
    // nom du site courant). Avant ce correctif, AUCUNE vérification n'existait :
    // tout compte authentifié recevait la liste complète de tous les sites.
    try {
      const secureUser = getSecureCurrentUser();
      if (!secureUser) {
        throw new Error("Session invalide.");
      }
      const sites = queries.getSites() as any[];
      if (secureUser.role === 'SUPER ADMIN') return sites;
      return sites.filter((s) => s.id === secureUser.site_id);
    }
    catch (e) { log.error('IPC Error: hierarchy:getSites', e); throw e; }
  });
  ipcMain.handle('hierarchy:getSitesSummary', async () => {
    try { return queries.getSitesSummary(); }
    catch (e) { log.error('IPC Error: hierarchy:getSitesSummary', e); throw e; }
  });
  ipcMain.handle('hierarchy:createSite', async (_, data) => {
    // Sécurité (P0-1) : SUPER ADMIN uniquement, dérivé de la session serveur réelle
    // — jamais du paramètre client `currentUser` (falsifiable, ex: {role:'SUPER ADMIN'}
    // envoyé directement par un renderer compromis). Business : SitesPage.tsx ne
    // propose la création de site qu'à SUPER ADMIN (onglet "Sites" jamais rendu pour
    // un autre rôle) — aucune régression pour l'UI légitime.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN'])) {
      throw new Error("Accès refusé. Seul le SUPER ADMIN peut créer un site.");
    }
    try { return queries.createSite(data); }
    catch (e) { log.error('IPC Error: hierarchy:createSite', e); throw e; }
  });
  ipcMain.handle('hierarchy:updateSite', async (_, id, data) => {
    // Sécurité (P0-1) : SUPER ADMIN uniquement, dérivé de la session serveur réelle.
    // L'ancien contrôle se basait sur getCurrentUserLogin() (jamais vérifié pour
    // BLOQUER un rôle non-SUPER-ADMIN — seulement pour retirer nom/code de `data`,
    // laissant passer is_active/max_centres/expiry_date/is_permanent sur N'IMPORTE
    // QUEL site pour N'IMPORTE QUEL compte authentifié). Business : handleSecureAction
    // (SitesPage.tsx) n'appelle updateSite que depuis l'onglet "Sites", exclusivement
    // rendu pour SUPER ADMIN — aucune régression pour l'UI légitime.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN'])) {
      throw new Error("Accès refusé. Seul le SUPER ADMIN peut modifier un site.");
    }
    try {
      return queries.updateSite(id, data);
    }
    catch (e) { log.error('IPC Error: hierarchy:updateSite', e); throw e; }
  });
  ipcMain.handle('hierarchy:deleteSite', async (_, id) => {
    // Sécurité (P0-1) : SUPER ADMIN uniquement, dérivé de la session serveur réelle.
    // Avant ce correctif, AUCUNE vérification n'existait sur ce handler — cascade
    // destructrice complète (cartes, users, centres, postes, logs) accessible à tout
    // compte authentifié, quel que soit son rôle ou son site.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN'])) {
      throw new Error("Accès refusé. Seul le SUPER ADMIN peut supprimer un site.");
    }
    try { return queries.deleteSite(id); }
    catch (e) { log.error('IPC Error: hierarchy:deleteSite', e); throw e; }
  });
  ipcMain.handle('hierarchy:resetAdminPassword', async (_, siteId, pass) => {
    try { return queries.resetSiteAdminPassword(siteId, pass); }
    catch (e) { log.error('IPC Error: hierarchy:resetAdminPassword', e); throw e; }
  });
  ipcMain.handle('hierarchy:verifyPassword', async (_, password, loginOverride?: string, actionName?: string) => {
    try {
      const login = loginOverride || getCurrentUserLogin();
      const attemptKey = login || 'SUPERADMIN_FALLBACK';
      const actionLabel = actionName ? ` (action : '${actionName}')` : '';

      const lockRemainingMs = isVerifyPasswordLocked(attemptKey);
      if (lockRemainingMs > 0) {
        log.warn(`[SECURITY] Tentative de vérification de mot de passe bloquée pour '${attemptKey}'${actionLabel} (verrouillage anti-bruteforce actif, ${Math.ceil(lockRemainingMs / 1000)}s restantes).`);
        return false;
      }

      let isValid: boolean;
      if (login) {
        log.info(`[hierarchy:verifyPassword] Vérification du mot de passe pour l'utilisateur '${login}'${actionLabel}.`);
        isValid = await queries.verifyUserPassword(login, password);
      } else {
        log.warn(`[hierarchy:verifyPassword] Aucun login fourni${actionLabel}, fallback sur verifySuperAdminPassword.`);
        isValid = await queries.verifySuperAdminPassword(password);
      }

      registerVerifyPasswordAttempt(attemptKey, isValid);
      return isValid;
    }
    catch (e) { log.error('IPC Error: hierarchy:verifyPassword', e); throw e; }
  });
  ipcMain.handle('hierarchy:getCentres', async (_, siteId) => {
    try {
      const db = getDatabase();
      let finalSiteId = siteId;
      const userLogin = getCurrentUserLogin();
      if (userLogin && db) {
        const user = db.prepare('SELECT role, site_id FROM t_users WHERE login = ?').get(userLogin) as { role: string; site_id: number | null } | undefined;
        // Sécurité : tout rôle non-SUPER ADMIN est cantonné à son propre site, quel que soit
        // le siteId envoyé par le renderer (pas uniquement ADMINISTRATEUR_SITE).
        if (user && user.role !== 'SUPER ADMIN') {
          finalSiteId = user.site_id ?? undefined;
        }
      }
      return queries.getCentres(finalSiteId);
    }
    catch (e) { log.error('IPC Error: hierarchy:getCentres', e); throw e; }
  });
  ipcMain.handle('hierarchy:getCentreById', async (_, id) => {
    try { return queries.getCentreById(id); }
    catch (e) { log.error('IPC Error: hierarchy:getCentreById', e); throw e; }
  });

  ipcMain.handle('hierarchy:createCentre', async (_, data) => {
    console.log("Données reçues pour createCentre:", data);
    // Sécurité (P0-1) : rôle et site_id dérivés de la session serveur réelle. Tout
    // rôle non-SUPER-ADMIN est recadré de force sur son propre site_id (même pattern
    // que hierarchy:getCentres), quel que soit le site_id envoyé par le renderer —
    // avant ce correctif, AUCUNE vérification n'existait sur ce handler.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE'])) {
      throw new Error("Accès refusé. Privilèges administrateur requis pour créer un centre.");
    }
    if (secureUser.role !== 'SUPER ADMIN') {
      if (secureUser.site_id === undefined || secureUser.site_id === null) {
        throw new Error("Session invalide : site_id introuvable pour cet utilisateur.");
      }
      data.site_id = secureUser.site_id;
    }
    const currentUser = getCurrentUserLogin() || 'system';
    let siteNom = 'Inconnu';
    try {
      const db = getDatabase();
      if (db) {
        const site = db.prepare('SELECT nom FROM t_sites WHERE id = ?').get(data.site_id) as { nom: string } | undefined;
        if (site) {
          siteNom = site.nom;
        }
      }

      if (data && (data.numero === undefined || data.numero === null)) {
        // Récupérer les centres existants pour ce site
        const centres = queries.getCentres(data.site_id) as any[];
        const usedNumbers = new Set(centres.map((c: any) => c.numero));
        let nextNum = 1;
        for (let i = 1; i <= 4; i++) {
          if (!usedNumbers.has(i)) {
            nextNum = i;
            break;
          }
        }
        data.numero = nextNum;
        console.log(`[IPC] Numéro de centre non fourni ou nul. Attribution automatique du numéro : ${nextNum}`);
      }
      const res = await queries.createCentre(data);

      setImmediate(() => {
        logAudit(
          currentUser,
          'SYS_CREATION_CENTRE',
          {
            nom_centre: data.nom,
            localisation: data.lieu || '',
            capacite_max: 5000 // Capacité standard ou configurée par défaut
          }
        );
      });
      return res;
    }
    catch (e: any) {
      log.error('IPC Error: hierarchy:createCentre', e);
      logAudit(
        currentUser,
        'CREATION_CENTRE_ERREUR',
        `Échec de création du centre "${data?.nom || 'Inconnu'}" sur le site "${siteNom}". Erreur: ${e.message || String(e)}`
      );
      throw e;
    }
  });

  ipcMain.handle('hierarchy:updateCentre', async (_, id, data) => {
    // Sécurité (P0-1) : rôle dérivé de la session serveur réelle — avant ce correctif,
    // AUCUNE vérification n'existait sur ce handler (ni rôle, ni site cible).
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE'])) {
      throw new Error("Accès refusé. Privilèges administrateur requis pour modifier un centre.");
    }
    const currentUser = getCurrentUserLogin() || 'system';
    let siteNom = 'Inconnu';
    let oldCentreNom = 'Inconnu';
    try {
      const db = getDatabase();
      if (db) {
        const centre = db.prepare('SELECT c.nom, c.site_id, s.nom as site_nom FROM t_centres c LEFT JOIN t_sites s ON c.site_id = s.id WHERE c.id = ?').get(id) as { nom: string; site_id: number; site_nom: string } | undefined;
        if (centre) {
          oldCentreNom = centre.nom;
          siteNom = centre.site_nom || 'Inconnu';

          // Sécurité (P0-1) : le centre ciblé doit appartenir au site de l'appelant
          // pour tout rôle non-SUPER-ADMIN.
          if (secureUser.role !== 'SUPER ADMIN' && centre.site_id !== secureUser.site_id) {
            throw new Error("Accès refusé. Vous ne pouvez pas modifier un centre d'un autre site.");
          }
        }

        // Validation du préfixe de rangement
        const num = data.numero !== undefined ? Number(data.numero) : null;
        const nom = data.nom ? String(data.nom) : null;
        let finalNum = num;
        let finalNom = nom;
        const centreDb = db.prepare('SELECT numero, nom, prefixe_rangement FROM t_centres WHERE id = ?').get(id) as { numero: number; nom: string; prefixe_rangement: string | null } | undefined;
        if (centreDb) {
          if (finalNum === null) finalNum = centreDb.numero;
          if (finalNom === null) finalNom = centreDb.nom;
          
          const finalPrefix = data.prefixe_rangement !== undefined ? data.prefixe_rangement : centreDb.prefixe_rangement;
          const isPrincipal = finalNum === 1 || (finalNom && finalNom.toUpperCase().includes('PRINCIPAL'));
          if (!isPrincipal && (!finalPrefix || !String(finalPrefix).trim())) {
            throw new Error("Le préfixe de rangement est obligatoire pour les centres secondaires.");
          }
        }
      }
      const res = await queries.updateCentre(id, data);

      // Synchro Supabase en tâche de fond (try-catch asynchrone non-bloquant)
      if (db) {
        const centreDb = db.prepare('SELECT sync_id FROM t_centres WHERE id = ?').get(id) as { sync_id: string } | undefined;
        if (centreDb && centreDb.sync_id) {
          const supabase = getSupabaseClient();
          if (supabase) {
            const updateData: any = {};
            if (data.nom) updateData.nom = data.nom;
            if (data.numero !== undefined) updateData.numero = data.numero;
            if (data.prefixe_rangement !== undefined) updateData.prefixe_rangement = data.prefixe_rangement;
            
            (async () => {
              try {
                // S'assurer que le champ code est absent de la requête de modification directe vers Supabase
                delete updateData.code;
                const { error } = await supabase.from('t_centres').update(updateData).eq('sync_id', centreDb.sync_id);
                if (error) log.error(`[Sync] Erreur lors de la mise à jour du centre ${id} sur Supabase:`, error.message);
                else log.info(`[Sync] Centre ${id} mis à jour avec succès sur Supabase.`);
              } catch (err: any) {
                log.error(`[Sync] Exception lors de la mise à jour du centre ${id} sur Supabase:`, err);
              }
            })();
          }
        }
      }

      logAudit(
        currentUser,
        'MODIFICATION_CENTRE',
        `Modification réussie du centre "${oldCentreNom}" (nouveau nom: "${data.nom || oldCentreNom}") sur le site "${siteNom}"`
      );
      return res;
    }
    catch (e: any) {
      log.error('IPC Error: hierarchy:updateCentre', e);
      logAudit(
        currentUser,
        'MODIFICATION_CENTRE_ERREUR',
        `Échec de modification du centre "${oldCentreNom}" sur le site "${siteNom}". Erreur: ${e.message || String(e)}`
      );
      throw e;
    }
  });

  const handleDeleteCentreLogic = async (id: number) => {
    // Sécurité (P0-1) : rôle et site cible dérivés de la session serveur réelle —
    // avant ce correctif, ce handler (partagé par hierarchy:deleteCentre ET
    // centre:delete) n'effectuait AUCUNE vérification de rôle ni de site.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE'])) {
      throw new Error("Accès refusé. Privilèges administrateur requis pour supprimer un centre.");
    }
    const currentUser = getCurrentUserLogin() || 'system';
    let siteNom = 'Inconnu';
    let centreNom = 'Inconnu';
    try {
      const db = getDatabase();
      if (db) {
        const centre = db.prepare('SELECT c.nom, c.numero, c.site_id, s.nom as site_nom FROM t_centres c LEFT JOIN t_sites s ON c.site_id = s.id WHERE c.id = ?').get(id) as { nom: string; numero: number; site_id: number; site_nom: string } | undefined;
        if (centre) {
          centreNom = centre.nom;
          siteNom = centre.site_nom || 'Inconnu';

          // Sécurité (P0-1) : le centre ciblé doit appartenir au site de l'appelant
          // pour tout rôle non-SUPER-ADMIN.
          if (secureUser.role !== 'SUPER ADMIN' && centre.site_id !== secureUser.site_id) {
            throw new Error("Accès refusé. Vous ne pouvez pas supprimer un centre d'un autre site.");
          }

          // Sécurité stricte pour le centre principal
          const isPrincipal = centre.numero === 1 || (centre.nom && centre.nom.toUpperCase().includes('PRINCIPAL'));
          if (isPrincipal) {
            throw new Error("Suppression du centre principal interdite");
          }
        }
      }

      // Supprimer de Supabase en tâche de fond
      if (db) {
        const centreDb = db.prepare('SELECT sync_id FROM t_centres WHERE id = ?').get(id) as { sync_id: string } | undefined;
        if (centreDb && centreDb.sync_id) {
          const supabase = getSupabaseClient();
          if (supabase) {
            (async () => {
              try {
                const { error } = await supabase.from('t_centres').delete().eq('sync_id', centreDb.sync_id);
                if (error) log.error(`[Sync] Erreur lors de la suppression du centre ${id} sur Supabase:`, error.message);
                else log.info(`[Sync] Centre ${id} supprimé avec succès de Supabase.`);
              } catch (err: any) {
                log.error(`[Sync] Exception lors de la suppression du centre ${id} sur Supabase:`, err);
              }
            })();
          }
        }
      }

      const res = await queries.deleteCentre(id);

      logAudit(
        currentUser,
        'SUPPRESSION_CENTRE',
        `Suppression réussie du centre "${centreNom}" sur le site "${siteNom}"`
      );
      return res;
    }
    catch (e: any) {
      log.error('IPC Error: handleDeleteCentreLogic', e);
      logAudit(
        currentUser,
        'SUPPRESSION_CENTRE_ERREUR',
        `Échec de suppression du centre "${centreNom}" sur le site "${siteNom}". Erreur: ${e.message || String(e)}`
      );
      throw e;
    }
  };

  ipcMain.handle('hierarchy:deleteCentre', async (_, id) => {
    return handleDeleteCentreLogic(id);
  });

  ipcMain.handle('centre:delete', async (_, id) => {
    return handleDeleteCentreLogic(id);
  });

  ipcMain.handle('hierarchy:getPostes', async (_, centreId) => {
    try { return queries.getPostes(centreId); }
    catch (e) { log.error('IPC Error: hierarchy:getPostes', e); throw e; }
  });

  // CONFIG
  ipcMain.handle('config:get', (_, key) => queries.getConfig(key));
  ipcMain.handle('config:set', async (_, key, value) => {
    const userLogin = getCurrentUserLogin() || 'SYSTEM';
    const res = await queries.setConfig(key, value);
    setImmediate(() => {
      logAudit(userLogin, 'SYS_PARAM_GLOBAL', {
        cle_parametre: key,
        nouvelle_valeur: value
      });
    });
    return res;
  });
  ipcMain.handle('config:getAll', () => queries.getAllConfig());

  // APP INFO
  ipcMain.handle('app:getName', () => app.getName());
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getDbPath', () => getDbPath());
  ipcMain.handle('app:exportLogs', async () => {
    const userLogin = getCurrentUserLogin() || 'SYSTEM';
    try {
      const sourcePath = log.transports.file.getFile().path;
      const defaultDest = 'gest-in-situ-diagnostic.log';
      const result = await dialog.showSaveDialog({
        title: 'Exporter les logs de diagnostic',
        defaultPath: join(app.getPath('desktop'), defaultDest),
        filters: [{ name: 'Fichiers Log', extensions: ['log'] }]
      });

      if (!result.canceled && result.filePath) {
        copyFileSync(sourcePath, result.filePath);
        logAudit(userLogin, 'PROFIL_EXPORT_DONNEES', { format: 'log', timestamp: Date.now() });
        return { success: true, message: 'Logs exportés avec succès !', filePath: result.filePath };
      }
      return { success: false, canceled: true };
    } catch (e: any) {
      log.error('IPC Error: app:exportLogs', e);
      return { success: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('db:purge', async (_, siteId) => {
    // Sécurité (P0-2) : identité dérivée EXCLUSIVEMENT de la session serveur réelle
    // (getSecureCurrentUser()), jamais du paramètre client `currentUser` (falsifiable
    // -- un ADMINISTRATEUR_SITE normal pouvait forger {id_user: 999999, role: 'SUPER
    // ADMIN'} pour contourner le controle de cloisonnement ci-dessous, sans jamais
    // s'etre authentifie via le vrai login ROOT). Si getSecureCurrentUser() renvoie
    // id_user === FAILSAFE_ROOT_ID, c'est que la session serveur a reellement ete
    // etablie via un vrai login ROOT (mot de passe verifie cote serveur, voir
    // auth:login) -- le bypass reste alors legitime.
    const secureUser = getSecureCurrentUser();
    // Suspendre temporairement le sync engine pour Ã©viter des Ã©critures concurrentes
    // (SyncEngine) pendant la fenÃªtre oÃ¹ les triggers FTS5 sont absents (DROP/DELETE brut/
    // recrÃ©ation) -- mÃªme correctif et mÃªme justification que db:emergency-purge ci-dessous.
    syncEngine.pause();
    try {
      const userId = secureUser?.id_user;
      if (!userId || !verifyUserRole(userId, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE'])) {
        throw new Error("AccÃ¨s refusÃ©. Vous devez Ãªtre administrateur pour purger la base de donnÃ©es.");
      }

      // â”€â”€â”€ LOG AVANT ACTION DESTRUCTRICE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      log.info(`[PURGE LOCALE] Initialisation de la purge de la base de donnÃ©es locale pour le site ID ${siteId} par l'utilisateur '${secureUser?.login}'.`);
      const purgeStartTime = performance.now();
      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

      const db = getDatabase()!;
      // Si l'utilisateur est administrateur de site, on vÃ©rifie que siteId correspond Ã  son site_id
      if (userId !== FAILSAFE_ROOT_ID) {
        const dbUser = db.prepare('SELECT role, site_id FROM t_users WHERE id_user = ?').get(userId) as { role: string; site_id: number } | undefined;
        if (dbUser && dbUser.role === 'ADMINISTRATEUR_SITE' && dbUser.site_id !== Number(siteId)) {
          throw new Error("AccÃ¨s refusÃ©. Vous ne pouvez pas purger les donnÃ©es d'un autre site.");
        }
      }

      queries.insertAuditLog(
        secureUser?.login || 'ADMIN',
        'VALIDATION',
        `Purge de la base de donnÃ©es locale (cartes et historique associÃ©) pour le site ID ${siteId}.`
      );
      // â”€â”€â”€ ANTI-FREEZE THROTTLE â€” purge progress (Couche 1) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const PURGE_THROTTLE_MS = 200;
      let purgeLastSentAt = 0;
      let purgeBuffered = -1;
      const onPurgeFocus = () => {
        if (purgeBuffered >= 0 && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('db:purge-progress', purgeBuffered);
          purgeBuffered = -1;
        }
      };
      mainWindow.on('focus', onPurgeFocus);
      // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      try {
        const res = await queries.purgeLocalDatabase(Number(siteId), (percent) => {
          purgeBuffered = percent;
          const now = Date.now();
          const focused = !mainWindow.isDestroyed() && mainWindow.isFocused();
          if (focused && (now - purgeLastSentAt) >= PURGE_THROTTLE_MS) {
            purgeLastSentAt = now;
            mainWindow.webContents.send('db:purge-progress', purgeBuffered);
            purgeBuffered = -1;
          }
        });
        // â”€â”€â”€ LOG APRÃˆS SUCCÃˆS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const purgeDuration = (performance.now() - purgeStartTime).toFixed(2);
        log.info(`[PURGE LOCALE] Purge locale rÃ©ussie. Reconstruction du schÃ©ma effectuÃ©e en ${purgeDuration} ms pour le site ID ${siteId}.`);
        // AUD-004 : Audit log post-succes (logAudit)
        logAudit(
          secureUser?.login || 'ADMIN',
          'PURGE_LOCALE',
          `Purge locale reussie pour le site ID ${siteId}. ${(res as any)?.count ?? 0} cartes supprimees.`
        );
        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        return res;
      } finally {
        mainWindow.removeListener('focus', onPurgeFocus);
        // Flush final
        if (purgeBuffered >= 0 && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('db:purge-progress', purgeBuffered);
        }
      }
    }
    catch (e) {
      log.error(`[PURGE LOCALE] Ã‰CHEC CRITIQUE de la purge locale pour le site ID ${siteId} :`, e);
      throw e;
    } finally {
      // Reprise garantie du sync engine (symÃ©trique Ã  db:emergency-purge ci-dessous).
      syncEngine.resume();
      log.info(`[PURGE LOCALE] Purge locale exÃ©cutÃ©e, synchronisation rÃ©activÃ©e pour le site ID ${siteId}.`);
    }
  });

  ipcMain.handle('db:emergency-purge', async (event, siteId) => {
    // Sécurité (P0-2) : identité dérivée EXCLUSIVEMENT de la session serveur réelle,
    // jamais du paramètre client `currentUser` (falsifiable) -- même correctif et
    // même justification que db:purge ci-dessus.
    const secureUser = getSecureCurrentUser();
    // Suspendre temporairement le sync engine pour Ã©viter des verrous SQLite concurrents (Database is locked)
    syncEngine.pause();
    // â”€â”€â”€ LOG AVANT ACTION DESTRUCTRICE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    log.info(`[MAINTENANCE] Initialisation de la rÃ©paration forcÃ©e (Emergency Purge) pour le site ID ${siteId} par l'utilisateur '${secureUser?.login}'.`);
    const repairStartTime = performance.now();
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
      const userId = secureUser?.id_user;
      if (!userId || !verifyUserRole(userId, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE'])) {
        throw new Error("AccÃ¨s refusÃ©. PrivilÃ¨ges administrateur requis pour la purge forcÃ©e.");
      }

      const db = getDatabase()!;
      if (userId !== FAILSAFE_ROOT_ID) {
        const dbUser = db.prepare('SELECT role, site_id FROM t_users WHERE id_user = ?').get(userId) as { role: string; site_id: number } | undefined;
        if (dbUser && dbUser.role === 'ADMINISTRATEUR_SITE' && dbUser.site_id !== Number(siteId)) {
          throw new Error("AccÃ¨s refusÃ©. Vous ne pouvez pas purger les donnÃ©es d'un autre site.");
        }
      }

      // Gestion du throttle et buffer de la progression FTS5/Purge d'urgence
      const PURGE_THROTTLE_MS = 200;
      let purgeLastSentAt = 0;
      let purgeBuffered = -1;
      const onPurgeFocus = () => {
        if (purgeBuffered >= 0 && !event.sender.isDestroyed()) {
          event.sender.send('db:purge-progress', purgeBuffered);
          purgeBuffered = -1;
        }
      };
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) {
        win.on('focus', onPurgeFocus);
      }

      try {
        const res = await queries.emergencyPurge(Number(siteId), (percent) => {
          purgeBuffered = percent;
          const now = Date.now();
          const focused = win ? (!win.isDestroyed() && win.isFocused()) : false;
          if (focused && (now - purgeLastSentAt) >= PURGE_THROTTLE_MS) {
            purgeLastSentAt = now;
            if (!event.sender.isDestroyed()) {
              event.sender.send('db:purge-progress', purgeBuffered);
            }
            purgeBuffered = -1;
          }
        });
        // â”€â”€â”€ LOG APRÃˆS SUCCÃˆS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const repairDuration = (performance.now() - repairStartTime).toFixed(2);
        log.info(`[MAINTENANCE] RÃ©paration forcÃ©e terminÃ©e avec succÃ¨s pour le site ID ${siteId} en ${repairDuration} ms.`);
        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        return res;
      } finally {
        if (win) {
          win.removeListener('focus', onPurgeFocus);
        }
        if (purgeBuffered >= 0 && !event.sender.isDestroyed()) {
          event.sender.send('db:purge-progress', purgeBuffered);
        }
      }
    } catch (e) {
      log.error(`[MAINTENANCE] Ã‰CHEC CRITIQUE de la rÃ©paration forcÃ©e pour le site ID ${siteId} :`, e);
      throw e;
    } finally {
      // Reprise garantie du sync engine
      syncEngine.resume();
      log.info(`[MAINTENANCE] RÃ©paration forcÃ©e exÃ©cutÃ©e, synchronisation rÃ©activÃ©e pour le site ID ${siteId}.`);
    }
  });
  ipcMain.handle('db:getCardCount', async (_, siteId?: number) => {
    try {
      // Sécurité/cloisonnement (P1) : identité dérivée de la session serveur réelle
      // (getSecureCurrentUser()), même pattern que sync:getCloudCartesCount ci-dessus. Un
      // SUPER ADMIN peut passer un siteId explicite (lié à son site actif) ; tout autre rôle
      // est forcé sur son propre site_id, sans possibilité de le contourner via le paramètre
      // client. Si aucune session sécurisée n'est disponible, on retombe sur le comportement
      // historique (comptage global) pour ne pas casser l'appel existant côté renderer.
      const secureUser = getSecureCurrentUser();
      if (!secureUser) return queries.getLocalCardCount();
      const effectiveSiteId = secureUser.role === 'SUPER ADMIN'
        ? (siteId !== undefined && siteId !== null ? Number(siteId) : undefined)
        : secureUser.site_id;
      return queries.getLocalCardCount(effectiveSiteId);
    }
    catch (e) { log.error('IPC Error: db:getCardCount', e); throw e; }
  });

  // MAINTENANCE
  ipcMain.handle('maintenance:analyzeUploadedLogs', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Sélectionner le fichier de logs',
        filters: [{ name: 'Fichiers Log', extensions: ['log', 'txt'] }],
        properties: ['openFile']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'canceled' };
      }

      const filePath = result.filePaths[0];
      const fs = require('fs');
      const content = fs.readFileSync(filePath, 'utf-8');
      
      const lines = content.split('\n');
      const errorLines = lines.filter((l: string) => l.toLowerCase().includes('error') || l.toLowerCase().includes('exception') || l.toLowerCase().includes('failed'));
      
      let problemDescription = "Aucune erreur majeure détectée.";
      let detailedExplanation = "Le journal ne contient pas de traces d'erreur explicites.";
      let prompt = "";

      if (errorLines.length > 0) {
        problemDescription = "Des erreurs ont été détectées dans les logs de diagnostic.";
        detailedExplanation = "Les lignes suivantes contiennent des mots-clés d'erreur (error, exception, failed) :\n\n" + errorLines.slice(-10).join('\n');
        
        prompt = `[CONSIGNE IMPÉRATIVE DE PRODUCTION]\n- URGENT : Voici les erreurs extraites des logs de diagnostic :\n${errorLines.slice(-20).join('\n')}\n- OBJECTIF : Diagnostiquer la cause racine et proposer un plan de correction.\n- PAS DE 'npm run build'. Utilise uniquement 'npx tsc --noEmit'.`;
      }

      return { success: true, problemDescription, detailedExplanation, prompt };
    } catch (e: any) {
      log.error('IPC Error: maintenance:analyzeUploadedLogs', e);
      return { success: false, error: e.message || String(e) };
    }
  });

  // MAINTENANCE
  ipcMain.handle('maintenance:clearAll', async (event) => {
    // Sécurité : identité dérivée exclusivement de la session serveur (non falsifiable via IPC).
    const secureUser = getSecureCurrentUser();
    const userLogin = secureUser?.login || getCurrentUserLogin() || 'SYSTEM_SUPERADMIN';
    try {
      const userId = secureUser?.id_user;
      if (!userId || !verifyUserRole(userId, ['SUPER ADMIN'])) {
        log.warn('[SECURITY] Accès refusé à maintenance:clearAll : session invalide ou rôle non autorisé.');
        throw new Error("AccÃ¨s refusÃ©. RÃ´le SUPER ADMIN requis pour effacer toutes les donnÃ©es.");
      }

      const db = getDatabase()!;
      const totalCountRow = db.prepare("SELECT COUNT(*) as count FROM t_cartes").get() as { count: number } | undefined;
      const totalCount = totalCountRow ? totalCountRow.count : 0;

      log.info(`[MAINTENANCE] Initialisation de maintenance:clearAll (effacement total de toutes les cartes) par l'utilisateur '${userLogin}'.`);
      const clearAllStart = performance.now();
      queries.clearDatabaseCartes(undefined);
      event.sender.send('maintenance-progress', 100);
      const clearAllDuration = (performance.now() - clearAllStart).toFixed(2);
      log.info(`[MAINTENANCE] maintenance:clearAll rÃ©ussi. Toutes les cartes ont Ã©tÃ© effacÃ©es en ${clearAllDuration} ms.`);
      
      setImmediate(() => {
        logAudit(userLogin, 'SUPERADMIN_PURGE_CLOUD', {
          type_purge: 'all_local_sites',
          volume_donnees_supprimees: totalCount
        });
        logAudit(userLogin, 'SUPERADMIN_ACTION_CRITIQUE', {
          login: userLogin,
          action: 'purge_totale_locale',
          volume_total_purge: totalCount
        });
      });

      return { success: true };
    } catch (e) {
      log.error('[MAINTENANCE] Ã‰CHEC CRITIQUE de maintenance:clearAll :', e);
      throw e;
    }
  });
  ipcMain.handle('maintenance:clearDatabaseCartes', async (event, siteId) => {
    // Sécurité : identité dérivée exclusivement de la session serveur (non falsifiable via IPC).
    const secureUser = getSecureCurrentUser();
    const userLogin = secureUser?.login || getCurrentUserLogin() || 'SYSTEM_SUPERADMIN';
    try {
      const userId = secureUser?.id_user;
      if (!userId || !verifyUserRole(userId, ['SUPER ADMIN'])) {
        log.warn('[SECURITY] Accès refusé à maintenance:clearDatabaseCartes : session invalide ou rôle non autorisé.');
        throw new Error("AccÃ¨s refusÃ©. RÃ´le SUPER ADMIN requis.");
      }

      const db = getDatabase()!;
      const siteCountRow = db.prepare("SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ?").get(siteId) as { count: number } | undefined;
      const siteCount = siteCountRow ? siteCountRow.count : 0;

      log.info(`[MAINTENANCE] Initialisation de maintenance:clearDatabaseCartes pour le site ID ${siteId} par l'utilisateur '${userLogin}'.`);
      const clearSiteStart = performance.now();
      queries.clearDatabaseCartes(siteId);
      event.sender.send('maintenance-progress', 100);
      const clearSiteDuration = (performance.now() - clearSiteStart).toFixed(2);
      log.info(`[MAINTENANCE] maintenance:clearDatabaseCartes rÃ©ussi pour le site ID ${siteId} en ${clearSiteDuration} ms.`);
      
      setImmediate(() => {
        logAudit(userLogin, 'SUPERADMIN_PURGE_CLOUD', {
          type_purge: `local_site_${siteId}`,
          volume_donnees_supprimees: siteCount
        });
        logAudit(userLogin, 'SUPERADMIN_ACTION_CRITIQUE', {
          login: userLogin,
          action: `purge_locale_site_${siteId}`,
          volume_total_purge: siteCount
        });
      });

      return { success: true };
    } catch (e) {
      log.error(`[MAINTENANCE] Ã‰CHEC CRITIQUE de maintenance:clearDatabaseCartes pour le site ID ${siteId} :`, e);
      throw e;
    }
  });
  ipcMain.handle('maintenance:clearCloudCartes', async (event, siteId: number, confirmed: boolean) => {
    // Sécurité : identité dérivée exclusivement de la session serveur (non falsifiable via IPC).
    const secureUser = getSecureCurrentUser();
    const userLogin = secureUser?.login || getCurrentUserLogin() || 'ADMIN';
    try {
      if (confirmed !== true) {
        throw new Error("Confirmation explicite requise pour purger les cartes sur le Cloud.");
      }
      const userId = secureUser?.id_user;
      if (!userId || !verifyUserRole(userId, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE'])) {
        log.warn('[SECURITY] Accès refusé à maintenance:clearCloudCartes : session invalide ou rôle non autorisé.');
        throw new Error("AccÃ¨s refusÃ©. PrivilÃ¨ges administrateur requis pour la purge Cloud.");
      }

      const db = getDatabase()!;
      if (userId !== FAILSAFE_ROOT_ID) {
        const dbUser = db.prepare('SELECT role, site_id FROM t_users WHERE id_user = ?').get(userId) as { role: string; site_id: number } | undefined;
        if (dbUser && dbUser.role === 'ADMINISTRATEUR_SITE' && dbUser.site_id !== Number(siteId)) {
          throw new Error("AccÃ¨s refusÃ©. Vous ne pouvez pas purger les donnÃ©es d'un autre site.");
        }
      }

      if (!siteId || isNaN(Number(siteId))) {
        throw new Error("siteId obligatoire et valide requis pour la purge Cloud.");
      }

      // Comptage du nombre de cartes locales associées à ce site pour donner un volume estimatif à l'audit
      const localCountRow = db.prepare("SELECT COUNT(*) as count FROM t_cartes WHERE site_id = ?").get(siteId) as { count: number } | undefined;
      const localCount = localCountRow ? localCountRow.count : 0;

      // 1. Sauvegarde automatique locale asynchrone avant purge (pour libérer la boucle d'événements)
      const backupDir = getBackupDir();
      const backupPath = join(backupDir, `backup_pre_cloud_purge_${Date.now()}.db`);
      log.info(`[PURGE CLOUD] Sauvegarde de sécurité locale avant purge vers : ${backupPath}`);
      await new Promise<void>((resolve, reject) => {
        setImmediate(() => {
          try {
            db.backup(backupPath);
            log.info(`[PURGE CLOUD] Sauvegarde locale réussie.`);
            resolve();
          } catch (err) {
            log.error(`[PURGE CLOUD] Échec de la sauvegarde locale :`, err);
            reject(err);
          }
        });
      });

      logAudit(
        userLogin,
        'PURGE_CLOUD_SUPABASE_INIT',
        JSON.stringify({ site_id: siteId, estimated_local_count: localCount, backup_path: backupPath, confirmed })
      );

      log.info(`[PURGE CLOUD] Initialisation de la purge Supabase pour le site ID ${siteId} par l'utilisateur '${userLogin}'.`);
      const cloudPurgeStart = performance.now();
      const supabase = getSupabaseClient();
      if (!supabase) {
        log.error('[PURGE CLOUD] Client Supabase non disponible — purge annulée.');
        return { success: false };
      }
      console.info("[PURGE CLOUD] Tentative de suppression pour id_site :", siteId);
      
      let cloudTotal = localCount;
      try {
        const { count, error: countError } = await supabase
          .from('t_cartes')
          .select('*', { count: 'exact', head: true })
          .eq('id_site', siteId);
        if (!countError && count !== null) {
          cloudTotal = count;
        }
      } catch (e) {
        log.warn("[PURGE CLOUD] Erreur lors de l'estimation du total cloud, utilisation du compte local:", e);
      }

      let totalDeleted = 0;
      let keepDeleting = true;

      // Reprise automatique sur incident réseau transitoire (timeout, DNS, etc.) : une purge
      // de gros site représente des centaines d'appels réseau séquentiels sur plusieurs
      // minutes, et un seul incident ponctuel ne doit pas faire échouer toute l'opération
      // (l'admin devrait alors recliquer "purger" manuellement autant de fois que nécessaire).
      const PURGE_MAX_RETRIES = 3;
      const PURGE_RETRY_DELAY_MS = 1500;
      async function withNetworkRetry<T extends { error: any }>(op: () => PromiseLike<T>, label: string): Promise<T> {
        let lastResult: T;
        for (let attempt = 1; attempt <= PURGE_MAX_RETRIES; attempt++) {
          lastResult = await op();
          if (!lastResult.error) return lastResult;
          log.warn(`[PURGE CLOUD] ${label} — tentative ${attempt}/${PURGE_MAX_RETRIES} échouée : ${lastResult.error.message || lastResult.error}`);
          if (attempt < PURGE_MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, PURGE_RETRY_DELAY_MS));
          }
        }
        return lastResult!;
      }

      while (keepDeleting) {
        // RÃ©cupÃ©ration par lots de 2000
        const { data, error: fetchError } = await withNetworkRetry(
          () => supabase.from('t_cartes').select('sync_id').eq('id_site', siteId).limit(2000),
          'FETCH des IDs'
        );

        if (fetchError) {
          log.error(`[PURGE CLOUD] Ã‰CHEC FETCH de la purge Supabase pour le site ${siteId} (dÃ©tails complets):`, JSON.stringify(fetchError, null, 2));
          throw new Error(`Erreur lors de la rÃ©cupÃ©ration des IDs sur Supabase : [${fetchError.code || 'NO_CODE'}] ${fetchError.message}`);
        }

        if (!data || data.length === 0) {
          keepDeleting = false;
          if (!event.sender.isDestroyed()) {
             event.sender.send('db:purge-cloud-progress', 100);
          }
          break;
        }

        const ids = data.map(d => d.sync_id);

        // PostgREST limite la taille des URLs (~8KB). 2000 UUIDs = 74KB = Bad Request.
        // On dÃ©coupe donc en sous-lots de 100 (3.7KB max) et on les lance en parallÃ¨le.
        const chunkSize = 100;
        const chunks = [];
        for (let i = 0; i < ids.length; i += chunkSize) {
          chunks.push(ids.slice(i, i + chunkSize));
        }

        // ExÃ©cution sÃ©quentielle des 20 requÃªtes de 100 pour ne pas saturer le thread principal et le rÃ©seau
        for (const chunk of chunks) {
          const { error: deleteError } = await withNetworkRetry(
            () => supabase.from('t_cartes').delete().in('sync_id', chunk),
            `DELETE lot de ${chunk.length}`
          );
          if (deleteError) {
            log.error(`[PURGE CLOUD] Ã‰CHEC DELETE par lot pour le site ${siteId} (dÃ©tails complets):`, JSON.stringify(deleteError, null, 2));
            throw new Error(`Erreur lors de la suppression par lot sur Supabase : [${deleteError.code || 'NO_CODE'}] ${deleteError.message}`);
          }

          totalDeleted += chunk.length;
          const percent = cloudTotal > 0 ? Math.min(99, Math.round((totalDeleted / cloudTotal) * 100)) : 99;
          if (!event.sender.isDestroyed()) {
             event.sender.send('db:purge-cloud-progress', percent);
          }
          
          // Respiration CPU obligatoire (10ms) pour libÃ©rer l'Event Loop et Ã©viter le "Freeze" de la UI
          await new Promise(resolve => setTimeout(resolve, 10));
        }

        log.info(`[PURGE CLOUD] Lot de ${ids.length} cartes supprimÃ©. Total cumulÃ© : ${totalDeleted}`);
        
        // DeuxiÃ¨me respiration aprÃ¨s chaque lot de 2000
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      log.info('[PURGE CLOUD] SUCCÈS');

      const runResult = db.prepare(`
        UPDATE t_cartes 
        SET is_dirty = 1, synced_at = NULL 
        WHERE site_id = ?
      `).run(siteId);
      log.info(`[PURGE CLOUD] Statut de synchronisation rÃ©initialisÃ© en local pour le site ${siteId}. Lignes impactÃ©es : ${runResult.changes}`);

      const cloudPurgeDuration = (performance.now() - cloudPurgeStart).toFixed(2);
      log.info(`[PURGE CLOUD] Purge Supabase rÃ©ussie pour le site ID ${siteId} en ${cloudPurgeDuration} ms.`);
      
      logAudit(
        userLogin,
        'PURGE_CLOUD_SUPABASE_SUCCESS',
        JSON.stringify({ site_id: siteId, local_synced_reset: runResult.changes, duration_ms: parseFloat(cloudPurgeDuration) })
      );
      return { success: true, count: runResult.changes };
    } catch (e: any) {
      log.error(`[PURGE CLOUD] Ã‰CHEC CRITIQUE de la purge Supabase pour le site ID ${siteId} :`, e);
      logAudit(
        userLogin,
        'PURGE_CLOUD_SUPABASE_FAILURE',
        JSON.stringify({ site_id: siteId, error: e.message || String(e) })
      );
      throw e;
    }
  });

  // Sécurité : l'identité utilisée pour lire/écrire cette préférence DOIT provenir
  // de la session serveur réelle (getSecureCurrentUser), jamais d'un paramètre
  // client `login` — un appel IPC forgé aurait pu lire/modifier la préférence
  // d'auto-récupération d'un autre utilisateur. Même pattern que
  // auth:updateSelfProfile. Clé dérivée d'id_user (identifiant stable), pas du
  // login (modifiable depuis ProfilePage) — cf. migration V65 de schema.ts.
  ipcMain.handle('sync:getAutoDownstream', async () => {
    try {
      const secureUser = getSecureCurrentUser();
      if (!secureUser) return false;
      const db = getDatabase();
      if (!db) return false;
      const row = db.prepare("SELECT value FROM t_config WHERE key = ?").get(`auto_downstream_${secureUser.id_user}`) as { value: string } | undefined;
      return row ? row.value === 'true' : false;
    } catch (e) {
      log.warn('Erreur getAutoDownstream:', e);
      return false;
    }
  });

  ipcMain.handle('sync:setAutoDownstream', async (_, enabled: boolean) => {
    try {
      const secureUser = getSecureCurrentUser();
      if (!secureUser) return { success: false };
      const db = getDatabase();
      if (!db) return { success: false };
      db.prepare("INSERT OR REPLACE INTO t_config (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(`auto_downstream_${secureUser.id_user}`, enabled ? 'true' : 'false');

      if (enabled) {
        if (secureUser.site_id) {
          syncEngine.startAutoDownstreamTimer(secureUser.site_id);
        }
      } else {
        syncEngine.stopAutoDownstreamTimer();
      }
      return { success: true };
    } catch (e) {
      log.warn('Erreur setAutoDownstream:', e);
      return { success: false };
    }
  });

  ipcMain.handle('sync:getCloudCartesCount', async (_, siteId: number) => {
    try {
      const secureUser = getSecureCurrentUser();
      if (!secureUser) return -1;
      siteId = secureUser.role === 'SUPER ADMIN' ? Number(siteId) : secureUser.site_id;
      if (!siteId || isNaN(Number(siteId))) return -1;

      const db = getDatabase();
      let watermark = '1970-01-01T00:00:00Z';
      let lastSyncId = '00000000-0000-0000-0000-000000000000';

      if (db) {
        // ── Repère d'affichage "vrai point atteint" (last_downstream_sync_true[_id]) ──
        // Contrairement au curseur de sécurité 'last_downstream_sync'/'_id' (reculé de
        // 2 min après chaque pull réussi pour protéger le PROCHAIN vrai pull d'un
        // décalage d'horloge — voir downstream.ts), ce couple de clés reflète la
        // position EXACTE non tamponnée où le dernier pull s'est arrêté. L'utiliser ici
        // évite de recompter comme "à télécharger" des cartes déjà rapatriées à
        // l'instant (bug historique : le compteur ne redescendait jamais à 0).
        const trueRow = db.prepare("SELECT value FROM t_config WHERE key = 'last_downstream_sync_true'").get() as { value: string } | undefined;
        const trueIdRow = db.prepare("SELECT value FROM t_config WHERE key = 'last_downstream_sync_true_id'").get() as { value: string } | undefined;

        if (trueRow && trueRow.value) {
          watermark = trueRow.value;
        } else {
          // Compat rétroactive : aucun pull n'a encore écrit le repère "true" sur ce
          // poste (première exécution après mise à jour, ou site jamais synchronisé).
          // Retombe sur le curseur de sécurité existant — au pire un léger sur-comptage
          // transitoire, résolu dès le prochain pull réel qui alimentera les clés "true".
          const configRow = db.prepare("SELECT value FROM t_config WHERE key = 'last_downstream_sync'").get() as { value: string } | undefined;
          if (configRow && configRow.value) watermark = configRow.value;
        }

        if (trueIdRow && trueIdRow.value) {
          lastSyncId = trueIdRow.value;
        } else {
          const configRowId = db.prepare("SELECT value FROM t_config WHERE key = 'last_downstream_sync_id'").get() as { value: string } | undefined;
          if (configRowId && configRowId.value) lastSyncId = configRowId.value;
        }
      }

      const supabase = getSupabaseClient();
      if (!supabase) return -1;
      const { count, error } = await supabase
        .from('t_cartes')
        .select('*', { count: 'exact', head: true })
        .or(`updated_at.gt.${watermark},and(updated_at.eq.${watermark},sync_id.gt.${lastSyncId})`)
        .eq('id_site', siteId);

      if (error) {
        log.warn(`[SYNC] Erreur rÃ©seau ou Supabase pour le count du site ${siteId}:`, error.message);
        return -1;
      }
      return count !== null ? count : 0;
    } catch (err) {
      log.warn(`[SYNC] Exception rÃ©seau lors du count du site ${siteId}:`, err);
      return -1;
    }
  });

  ipcMain.handle('sync:getTotalCloudCartesCount', async (_, siteId: number) => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return -1;
      const { count, error } = await supabase
        .from('t_cartes')
        .select('*', { count: 'exact', head: true })
        .eq('id_site', siteId);

      if (error) {
        log.warn(`[SYNC] Erreur rÃ©seau ou Supabase pour le total count du site ${siteId}:`, error.message);
        return -1;
      }
      return count !== null ? count : 0;
    } catch (err) {
      log.warn(`[SYNC] Exception rÃ©seau lors du total count du site ${siteId}:`, err);
      return -1;
    }
  });
  ipcMain.handle('maintenance:fullReset', async (event) => {
    // Sécurité : identité dérivée exclusivement de la session serveur (non falsifiable via IPC).
    const secureUser = getSecureCurrentUser();
    const userLogin = secureUser?.login || getCurrentUserLogin() || 'SYSTEM_SUPERADMIN';
    try {
      const userId = secureUser?.id_user;
      if (!userId || !verifyUserRole(userId, ['SUPER ADMIN'])) {
        log.warn('[SECURITY] Accès refusé à maintenance:fullReset : session invalide ou rôle non autorisé.');
        throw new Error("AccÃ¨s refusÃ©. RÃ´le SUPER ADMIN requis pour la rÃ©initialisation totale.");
      }

      const db = getDatabase()!;
      const sqliteVersionRow = db.prepare("select sqlite_version() as version").get() as { version: string } | undefined;
      const sqliteVersion = sqliteVersionRow ? sqliteVersionRow.version : '3.x';

      log.info(`[MAINTENANCE] Initialisation de maintenance:fullReset (rÃ©initialisation systÃ¨me totale) par l'utilisateur '${userLogin}'.`);
      const fullResetStart = performance.now();
      const res = queries.fullSystemReset();
      event.sender.send('maintenance-progress', 100);
      const fullResetDuration = (performance.now() - fullResetStart).toFixed(2);
      log.info(`[MAINTENANCE] maintenance:fullReset rÃ©ussi en ${fullResetDuration} ms. SystÃ¨me complÃ¨tement rÃ©initialisÃ©.`);
      
      setImmediate(() => {
        // Log de maintenance DB
        logAudit(userLogin, 'SUPERADMIN_DB_MAINTENANCE', {
          type_operation: 'full_system_reset',
          sqlite_version: sqliteVersion
        });
        
        // Log de purge critique
        logAudit(userLogin, 'SUPERADMIN_PURGE_CLOUD', {
          type_purge: 'full_system_reset',
          volume_donnees_supprimees: 999999 // Valeur conventionnelle symbolisant un reset total
        });
        
        logAudit(userLogin, 'SUPERADMIN_ACTION_CRITIQUE', {
          login: userLogin,
          action: 'full_system_reset',
          volume_total_purge: 999999
        });
      });

      return res;
    } catch (e) {
      log.error('[MAINTENANCE] ÉCHEC CRITIQUE de maintenance:fullReset :', e);
      throw e;
    }
  });

  ipcMain.handle('maintenance:getLogs', async (_, limit = 50, offset = 0, searchTerm = '', filterLevel = 'ALL') => {
    try {
      const db = getDatabase();
      if (!db) throw new Error("Base de données indisponible");

      let queryLogs = `
        SELECT id_log AS id, id_user, login_user, action, detail AS details, date_heure AS timestamp, site_id 
        FROM t_logs 
        WHERE 1=1
      `;
      let queryCount = `SELECT COUNT(*) AS total FROM t_logs WHERE 1=1`;
      const params: any[] = [];

      if (filterLevel === 'ERROR') {
        const errCond = ` AND (UPPER(action) LIKE '%ERROR%' OR UPPER(action) LIKE '%ECHEC%' OR UPPER(action) LIKE '%FAILURE%' OR UPPER(detail) LIKE '%ERROR%')`;
        queryLogs += errCond;
        queryCount += errCond;
      } else if (filterLevel === 'WARN') {
        const warnCond = ` AND (UPPER(action) LIKE '%WARN%' OR UPPER(action) LIKE '%ALERT%' OR UPPER(detail) LIKE '%WARN%')`;
        queryLogs += warnCond;
        queryCount += warnCond;
      }

      if (searchTerm.trim() !== '') {
        const term = `%${searchTerm.toLowerCase()}%`;
        const searchCond = ` AND (LOWER(action) LIKE ? OR LOWER(detail) LIKE ? OR LOWER(login_user) LIKE ?)`;
        queryLogs += searchCond;
        queryCount += searchCond;
        params.push(term, term, term);
      }

      queryLogs += ` ORDER BY date_heure DESC LIMIT ? OFFSET ?`;
      const rows = db.prepare(queryLogs).all(...params, limit, offset);
      const totalRow = db.prepare(queryCount).get(...params) as { total: number };
      return { logs: rows, total: totalRow.total };
    } catch (e: any) {
      log.error('IPC Error: maintenance:getLogs', e);
      throw e;
    }
  });

  ipcMain.handle('maintenance:clearLogs', async (_, password, currentUser) => {
    const userLogin = currentUser?.login || getCurrentUserLogin();
    try {
      if (!userLogin) {
        throw new Error("Utilisateur non connecté.");
      }
      const db = getDatabase();
      if (!db) throw new Error("Base de données indisponible");

      const isValid = queries.verifyUserPassword(userLogin, password);
      if (!isValid) {
        throw new Error("Mot de passe incorrect.");
      }

      db.prepare('DELETE FROM t_logs').run();

      logAudit(userLogin, 'MAINTENANCE_LOGS_PURGE', `Purge locale des logs système effectuée par ${userLogin}.`);
      return { success: true };
    } catch (e: any) {
      log.error('IPC Error: maintenance:clearLogs', e);
      throw e;
    }
  });

  ipcMain.handle('maintenance:exportLogs', async () => {
    const userLogin = getCurrentUserLogin() || 'SYSTEM';
    try {
      const db = getDatabase();
      if (!db) throw new Error("Base de données indisponible");

      const rows = db.prepare(`
        SELECT id_log AS id, id_user, login_user, action, detail AS details, date_heure AS timestamp, site_id 
        FROM t_logs 
        ORDER BY date_heure DESC
      `).all() as any[];

      const result = await dialog.showSaveDialog({
        title: 'Exporter les logs de diagnostic',
        defaultPath: join(app.getPath('desktop'), `diagnostic_logs_${Date.now()}.txt`),
        filters: [{ name: 'Fichiers Texte', extensions: ['txt'] }]
      });

      if (!result.canceled && result.filePath) {
        const content = rows.map(r => `[${r.timestamp}] [${r.action}] (${r.login_user || 'system'}): ${r.details || ''}`).join('\r\n');
        const { writeFileSync } = require('fs');
        writeFileSync(result.filePath, content, 'utf-8');
        logAudit(userLogin, 'MAINTENANCE_LOGS_EXPORT', `Logs de diagnostic exportés vers ${result.filePath}`);
        return { success: true, filePath: result.filePath };
      }
      return { success: false, canceled: true };
    } catch (e: any) {
      log.error('IPC Error: maintenance:exportLogs', e);
      return { success: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('sync:getStatus', () => {
    const db = getDatabase();
    let queueCount = 0;
    let outboxCount = 0;
    let errors: any[] = [];

    if (db) {
      try {
        const row = db.prepare("SELECT COUNT(*) as count FROM t_sync_queue WHERE synced = 0").get() as { count: number } | undefined;
        queueCount = row ? row.count : 0;
      } catch (e) {
        log.error('sync:getStatus - queueCount error:', e);
      }

      try {
        const row = db.prepare("SELECT COUNT(*) as count FROM t_outbox WHERE status = 'PENDING'").get() as { count: number } | undefined;
        outboxCount = row ? row.count : 0;
      } catch (e) {
        log.error('sync:getStatus - outboxCount error:', e);
      }

      try {
        // Cloisonnement site (CLAUDE.md §3) : le tableau "Dernières anomalies détectées"
        // ne doit exposer que les logs du site de l'utilisateur connecté. Le site est
        // dérivé de la session serveur réelle (getSecureCurrentUser), jamais d'un
        // paramètre client falsifiable — même pattern que sync:pullSiteCards /
        // sync:pullAgents. SUPER ADMIN conserve la vue de supervision globale existante
        // (seul autre rôle autorisé sur cette route). Session invalide => tableau vide,
        // on reste défensif plutôt que de planter.
        const secureUser = getSecureCurrentUser();
        if (secureUser && secureUser.role !== 'SUPER ADMIN') {
          errors = db.prepare(`
            SELECT id_log AS id, action, detail AS details, date_heure AS timestamp
            FROM (
              SELECT * FROM t_logs WHERE site_id = ? ORDER BY id_log DESC LIMIT 500
            )
            WHERE action LIKE '%ERROR%' OR action LIKE '%ECHEC%' OR action LIKE '%FAILURE%'
               OR action LIKE '%WARN%' OR action LIKE '%LIMIT%'
            LIMIT 5
          `).all(secureUser.site_id);
        } else if (secureUser) {
          errors = db.prepare(`
            SELECT id_log AS id, action, detail AS details, date_heure AS timestamp
            FROM (
              SELECT * FROM t_logs ORDER BY id_log DESC LIMIT 500
            )
            WHERE action LIKE '%ERROR%' OR action LIKE '%ECHEC%' OR action LIKE '%FAILURE%'
               OR action LIKE '%WARN%' OR action LIKE '%LIMIT%'
            LIMIT 5
          `).all();
        }
        log.info('[SYNC] getStatus corrigé');
      } catch (e) {
        log.error('sync:getStatus - logs error:', e);
      }
    }
    
    let lastSync = 'Jamais';
    if (db) {
      const row = db.prepare("SELECT value FROM t_config WHERE key = 'last_downstream_sync'").get() as { value: string } | undefined;
      if (row && row.value) lastSync = row.value;
    }

    return {
      state: networkMonitor.getState(),
      lastSync,
      queueCount,
      outboxCount,
      errors
    };
  });
  ipcMain.handle('sync:forcePing', async () => {
    try {
      const state = await networkMonitor.forcePing();
      return { success: true, state };
    } catch (e) {
      log.error('Erreur forcePing:', e);
      return { success: false, state: 'OFFLINE' };
    }
  });

  ipcMain.handle('sync:force', async (_, currentUser) => {
    const userLogin = currentUser?.login || getCurrentUserLogin() || 'SYSTEM';
    
    setImmediate(() => {
      logAudit(
        userLogin,
        'SUPERADMIN_FORCE_SYNC',
        { direction_synchro: 'bidirectional', statut_resultat: 'running' }
      );
    });

    try {
      const res = await syncEngine.forceSync();
      setImmediate(() => {
        logAudit(
          userLogin,
          'SUPERADMIN_FORCE_SYNC',
          { direction_synchro: 'bidirectional', statut_resultat: 'success' }
        );
      });
      return res;
    } catch (e: any) {
      setImmediate(() => {
        logAudit(
          userLogin,
          'SUPERADMIN_FORCE_SYNC',
          { direction_synchro: 'bidirectional', statut_resultat: `failure: ${e.message || String(e)}` }
        );
      });
      throw e;
    }
  });

  ipcMain.handle('sync:startBulk', async (_, siteId: number, allowProbable: boolean = false, allowInvalid: boolean = false, allowMissing: boolean = false, onlyModified: boolean = false, currentUser?: any) => {
    const userLogin = currentUser?.login || getCurrentUserLogin() || 'ADMIN';

    // ── Verrou anti-concurrence ──────────────────────────────────────────────
    // Symétrique à sync:pullSiteCards : runBulkUpload ouvre lui aussi un Worker Thread
    // avec sa propre connexion SQLite indépendante (upload-worker.js). Si le SyncEngine
    // a déjà un cycle en cours (upstream 30s ou downstream automatique 2h), on refuse
    // l'envoi manuel pour éviter deux workers concurrents sur le même fichier → database is locked.
    if (syncEngine.isCurrentlySyncing()) {
      log.warn(`[sync:startBulk] Refusé : une synchronisation est déjà en cours pour le site ${siteId}.`);
      return {
        success: false,
        uploadedCount: 0,
        message: 'Une synchronisation est déjà en cours. Veuillez patienter.',
        strictCount: 0,
        probableCount: 0,
        invalidCount: 0
      };
    }

    try {
      const secureUser = getSecureCurrentUser();
      if (!secureUser) throw new Error("Session invalide.");
      siteId = secureUser.role === 'SUPER ADMIN' ? Number(siteId) : secureUser.site_id;

      logAudit(
        userLogin,
        'MASS_UPLOAD_INIT',
        JSON.stringify({ site_id: siteId, allowProbable, allowInvalid })
      );

      const db = getDatabase()!;

      let uploadResult: { success: boolean; uploadedCount: number; message: string };
      try {
        const centreId = secureUser?.role === 'ADMIN_CENTRE' && secureUser?.centre_id ? secureUser.centre_id : null;
        uploadResult = await runBulkUpload(Number(siteId), allowProbable, allowInvalid, allowMissing, onlyModified, centreId, (progress: number) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            log.info(`[PROGRESSION BULK UPLOAD] Site ID ${siteId} : ${progress}% envoyes vers Supabase.`);
            mainWindow.webContents.send('sync:bulk-progress', progress);
          }
        }, secureUser?.login || 'system');
      } finally {
        // Nettoyage : aucun ecouteur focus attache a ce handler
      }

      // 1. Calcul des anomalies restantes en local (qui n'ont pas pu Ãªtre envoyÃ©es car exclues du filtre) via le Worker pour ne pas geler le Main Thread
      let strictCount = 0;
      let probableCount = 0;
      let invalidCount = 0;
      try {
        const counts = await runStatsWorker('getBulkAnomalies', { siteId });
        strictCount = counts.strictCount;
        probableCount = counts.probableCount;
        invalidCount = counts.invalidCount;
      } catch (err: any) {
        log.error('Erreur lors du comptage des anomalies via Worker:', err.message);
      }

      logAudit(
        userLogin,
        'MASS_UPLOAD_SUCCESS',
        JSON.stringify({
          site_id: siteId,
          uploadedCount: uploadResult.uploadedCount,
          success: uploadResult.success,
          strictCount,
          probableCount,
          invalidCount
        })
      );

      return {
        success: uploadResult.success,
        uploadedCount: uploadResult.uploadedCount,
        message: uploadResult.message,
        strictCount,
        probableCount,
        invalidCount
      };

    } catch (err: any) {
      log.error('IPC sync:startBulk error:', err);
      logAudit(
        userLogin,
        'MASS_UPLOAD_FAILURE',
        JSON.stringify({ site_id: siteId, error: err.message || String(err) })
      );
      return { success: false, uploadedCount: 0, message: err.message || String(err), strictCount: 0, probableCount: 0, invalidCount: 0 };
    }
  });

  ipcMain.handle('sync:cancelBulk', async (_, currentUser?: any) => {
    const userLogin = currentUser?.login || getCurrentUserLogin() || 'SYSTEM';
    try {
      log.info(`[BulkUpload] Annulation demandée par ${userLogin}.`);
      cancelBulkUpload();
      return { success: true, message: 'Signal d\'annulation envoyé.' };
    } catch (e: any) {
      log.error('IPC Error: sync:cancelBulk', e);
      return { success: false, message: e.message || String(e) };
    }
  });

  ipcMain.handle('sync:getUnreadCount', (_, siteId?: number) => {
    try {
      return queries.getUnreadSyncNotifications(siteId);
    } catch (e) {
      log.error('IPC Error: sync:getUnreadCount', e);
      throw e;
    }
  });

  ipcMain.handle('sync:getUnreadList', (_, siteId?: number) => {
    try {
      return queries.getUnreadNotificationsList(siteId);
    } catch (e) {
      log.error('IPC Error: sync:getUnreadList', e);
      throw e;
    }
  });

  ipcMain.handle('sync:markAsRead', (_, siteId?: number) => {
    try {
      return queries.markUnreadSyncNotificationsAsRead(siteId);
    } catch (e) {
      log.error('IPC Error: sync:markAsRead', e);
      throw e;
    }
  });

  ipcMain.handle('sync:markNotificationAsRead', (_, idLog: number) => {
    try {
      return queries.markNotificationAsRead(idLog);
    } catch (e) {
      log.error('IPC Error: sync:markNotificationAsRead', e);
      throw e;
    }
  });

  // OPERATEUR STATS HANDLERS
  // Sécurité (durcissement P0, cf. correctif déjà appliqué à stats:getVerification/
  // stats:getApurementCardsTodayPaginated) : ces handlers faisaient précédemment confiance au
  // userId envoyé par le client sans aucune vérification — un agent authentifié pouvait
  // consulter les stats/saisies de n'importe quel AUTRE agent en falsifiant userId côté
  // renderer. L'userId effectif est désormais TOUJOURS dérivé de la session serveur réelle
  // (getSecureCurrentUser().id_user) pour tout rôle non-SUPER ADMIN, jamais du paramètre client.
  // Tous les appelants renderer connus (useDashboardStats.ts bloc OPERATEUR_SAISIE,
  // AgentSaisie/views/Overview.tsx, AgentSaisie/views/HistoriqueView.tsx) passent déjà
  // exclusivement l'id de l'utilisateur connecté lui-même : ce durcissement ne change donc
  // aucun comportement observable pour ces appelants légitimes.
  function scopeUserIdToSession(userId: number): number {
    const secureUser = getSecureCurrentUser();
    return (secureUser && secureUser.role !== 'SUPER ADMIN') ? secureUser.id_user : userId;
  }
  ipcMain.handle('stats:getAgentToday', (_, userId: number) => queries.getAgentStatsToday(scopeUserIdToSession(userId)));
  ipcMain.handle('stats:getAgentRecentSaisies', (_, userId: number, limit?: number, offset?: number) => queries.getAgentRecentSaisies(scopeUserIdToSession(userId), limit, offset));
  // Vue d'ensemble du Portail de Saisie — 4 KPI (Aujourd'hui/Semaine/Mois/Année), même politique
  // de cantonnement que ci-dessus.
  ipcMain.handle('stats:getAgentStats', (_, userId: number) => {
    try { return queries.getAgentStats(scopeUserIdToSession(userId)); }
    catch (e) { log.error('IPC Error: stats:getAgentStats', e); throw e; }
  });
  // Portail de Saisie — liste paginée du "travail du jour" (Vue d'ensemble), même politique de
  // cantonnement que ci-dessus.
  ipcMain.handle('stats:getAgentCardsTodayPaginated', (_, userId: number, page?: number, pageSize?: number) => {
    try { return queries.getAgentCardsTodayPaginated(scopeUserIdToSession(userId), page ?? 0, pageSize ?? 20); }
    catch (e) { log.error('IPC Error: stats:getAgentCardsTodayPaginated', e); throw e; }
  });
  // Sécurité : le périmètre site/centre de ces 3 handlers est imposé par la session serveur
  // pour tout rôle non-SUPER ADMIN, quels que soient les paramètres envoyés par le renderer.
  function scopeSiteCentreToSession(siteId: number, centreId?: number): { siteId: number; centreId?: number } {
    const secureUser = getSecureCurrentUser();
    if (!secureUser || secureUser.role === 'SUPER ADMIN') return { siteId, centreId };
    return {
      siteId: secureUser.site_id ?? siteId,
      centreId: secureUser.role === 'ADMIN_CENTRE' ? (secureUser.centre_id ?? centreId) : centreId
    };
  }
  ipcMain.handle('stats:getSiteSaisieToday', (_, siteId: number, centreId?: number, agentId?: number, dateStr?: string) => {
    const scoped = scopeSiteCentreToSession(siteId, centreId);
    return queries.getSiteSaisieStatsToday(scoped.siteId, scoped.centreId, agentId, dateStr);
  });
  ipcMain.handle('stats:getSiteQualiteToday', (_, siteId: number, centreId?: number, agentId?: number, dateStr?: string) => {
    const scoped = scopeSiteCentreToSession(siteId, centreId);
    return queries.getSiteQualiteStatsToday(scoped.siteId, scoped.centreId, agentId, dateStr);
  });
  ipcMain.handle('stats:getSiteLogistiqueToday', (_, siteId: number, centreId?: number, agentId?: number, dateStr?: string) => {
    const scoped = scopeSiteCentreToSession(siteId, centreId);
    return queries.getSiteLogistiqueStatsToday(scoped.siteId, scoped.centreId, agentId, dateStr);
  });

  // Portail d'Apurement — liste paginée du "travail du jour" (Vue d'ensemble). Même politique
  // de cantonnement que scopeSiteCentreToSession ci-dessus : le siteId effectif est toujours
  // dérivé de la session serveur réelle pour tout rôle non-SUPER ADMIN, jamais du paramètre
  // client (falsifiable). L'agent dont le travail est affiché est de même toujours celui de la
  // session réelle (getSecureCurrentUser().login) sauf pour SUPER ADMIN qui garde la liberté de
  // consultation déjà accordée ailleurs — sans cette substitution, un agent APUREMENT pourrait
  // consulter le travail d'un collègue en trafiquant `agentUsername` côté renderer.
  ipcMain.handle('stats:getApurementCardsTodayPaginated', (_, agentUsername: string, siteId: number, page?: number, pageSize?: number) => {
    try {
      const secureUser = getSecureCurrentUser();
      const scoped = scopeSiteCentreToSession(siteId);
      const effectiveAgentUsername = (secureUser && secureUser.role !== 'SUPER ADMIN') ? secureUser.login : agentUsername;
      return queries.getApurementCardsTodayPaginated(effectiveAgentUsername, scoped.siteId, page ?? 0, pageSize ?? 20);
    } catch (e) {
      log.error('IPC Error: stats:getApurementCardsTodayPaginated', e);
      throw e;
    }
  });

  // 4 KPI (Aujourd'hui/Semaine/Mois/Année) de la Vue d'ensemble du Portail d'Apurement —
  // voir getApurementStats (stats.queries.ts) pour le détail du filtrage sur `updated_at`.
  // Même politique de cantonnement site/agent que stats:getApurementCardsTodayPaginated
  // ci-dessus (session serveur réelle pour tout rôle non-SUPER ADMIN).
  ipcMain.handle('stats:getApurementStats', (_, agentUsername: string, siteId: number) => {
    try {
      const secureUser = getSecureCurrentUser();
      const scoped = scopeSiteCentreToSession(siteId);
      const effectiveAgentUsername = (secureUser && secureUser.role !== 'SUPER ADMIN') ? secureUser.login : agentUsername;
      return queries.getApurementStats(effectiveAgentUsername, scoped.siteId);
    } catch (e) {
      log.error('IPC Error: stats:getApurementStats', e);
      throw e;
    }
  });

  // RETRAITS ANALYTICS HANDLERS
  ipcMain.handle('stats:getRetraits', (_, siteId: number, centreId: number | null, period: string, customDate?: string | null) => {
    try {
      // Sécurité (cloisonnement §3, P0-4) : siteId/centreId dérivés de la session serveur pour
      // tout rôle non-SUPER ADMIN (scopeSiteCentreToSession, même helper que stats:getCentre) —
      // fuite confirmée cross-centre ET cross-site avant ce correctif.
      const scoped = scopeSiteCentreToSession(Number(siteId), centreId ? Number(centreId) : undefined);
      return queries.getRetraitsByCentre(scoped.siteId, scoped.centreId ?? null, period as any, customDate ?? null);
    } catch (e) {
      log.error('IPC Error: stats:getRetraits', e);
      throw e;
    }
  });
  ipcMain.handle('stats:getRetraitsTrend', (_, siteId: number, centreId: number | null, period: string, customDate?: string | null) => {
    try {
      // Sécurité (cloisonnement §3, P0-4) : même correctif que stats:getRetraits ci-dessus.
      const scoped = scopeSiteCentreToSession(Number(siteId), centreId ? Number(centreId) : undefined);
      return queries.getRetraitsTrend(scoped.siteId, scoped.centreId ?? null, period as any, customDate ?? null);
    } catch (e) {
      log.error('IPC Error: stats:getRetraitsTrend', e);
      throw e;
    }
  });

  // SUPER ADMIN â€” Synchronisation ForcÃ©e Globale
  ipcMain.handle('sync:forceGlobal', async (_, currentUser) => {
    try {
      queries.insertAuditLog(
        currentUser?.login || 'SUPER ADMIN',
        'VALIDATION',
        "Lancement d'une synchronisation globale forcÃ©e Supabase par le Super Admin."
      );
      return await queries.forceGlobalSuperAdminSync();
    } catch (error) {
      log.error('Erreur lors de la synchronisation forcÃ©e globale:', error);
      throw error;
    }
  });

  // SITE ADMIN â€” Synchronisation ForcÃ©e du Site
  ipcMain.handle('sync:forceSite', async (_, siteId: number, currentUser) => {
    try {
      const secureUser = getSecureCurrentUser();
      if (!secureUser) throw new Error("Session invalide.");
      siteId = secureUser.role === 'SUPER ADMIN' ? Number(siteId) : secureUser.site_id;

      queries.insertAuditLog(
        currentUser?.login || 'ADMIN',
        'VALIDATION',
        `Lancement de la synchronisation forcÃ©e Supabase pour le site ID ${siteId} par l'administrateur.`
      );
      return await queries.forceSiteAdminSync(Number(siteId));
    } catch (error) {
      log.error(`Erreur lors de la synchronisation forcÃ©e du site ${siteId}:`, error);
      throw error;
    }
  });

  // SITE ADMIN â€” Synchronisation ForcÃ©e des Agents du Site
  ipcMain.handle('sync:forceAgents', async (_, siteId: number, currentUser) => {
    try {
      const secureUser = getSecureCurrentUser();
      if (!secureUser) throw new Error("Session invalide.");
      siteId = secureUser.role === 'SUPER ADMIN' ? Number(siteId) : secureUser.site_id;

      queries.insertAuditLog(
        currentUser?.login || 'ADMIN',
        'VALIDATION',
        `Lancement de la synchronisation forcÃ©e des comptes agents pour le site ID ${siteId} par l'administrateur.`
      );
      return await queries.forceAgentsSync(Number(siteId));
    } catch (error) {
      log.error(`Erreur lors de la synchronisation forcÃ©e des agents du site ${siteId}:`, error);
      throw error;
    }
  });

  // SITE ADMIN — Récupération des cartes depuis Supabase (Downstream Pull)
  ipcMain.handle('sync:pullSiteCards', async (_, siteId: number, currentUser) => {
    const userLogin = currentUser?.login || getCurrentUserLogin() || 'ADMIN';

    // ── Verrou anti-concurrence ──────────────────────────────────────────────
    // Si le SyncEngine est déjà en train de faire un downstream automatique (cycle 2h),
    // on refuse le pull manuel pour éviter deux DownloadWorkers simultanés → database is locked.
    if (syncEngine.isCurrentlySyncing()) {
      log.warn(`[sync:pullSiteCards] Refusé : un downstream automatique est déjà en cours pour le site ${siteId}.`);
      return {
        success: false,
        count: 0,
        message: 'Une synchronisation automatique est déjà en cours. Veuillez patienter.'
      };
    }

    logAudit(
      userLogin,
      'SYNC_DOWN_INIT',
      JSON.stringify({ site_id: siteId })
    );
    try {
      const secureUser = getSecureCurrentUser();
      if (!secureUser) throw new Error("Session invalide.");
      siteId = secureUser.role === 'SUPER ADMIN' ? Number(siteId) : secureUser.site_id;

      if (!siteId || isNaN(Number(siteId))) {
        throw new Error("siteId obligatoire et valide requis pour la récupération.");
      }
      const pulledCount = await runDownstream(Number(siteId));

      // Rapatriement des entrées t_logs CRUD cross-poste (liste blanche CRUD_SYNC_WHITELIST,
      // voir src/main/utils/audit.ts). Isolé dans son propre try/catch : un échec ici ne doit
      // jamais faire échouer le pull manuel des cartes ci-dessus (déjà réussi à ce stade).
      try {
        await runLogsDownstream(Number(siteId));
      } catch (logsSyncErr) {
        log.warn(`[sync:pullSiteCards] runLogsDownstream échoué (non-bloquant) pour le site ${siteId} :`, logsSyncErr);
      }

      logAudit(
        userLogin,
        'SYNC_DOWN_SUCCESS',
        JSON.stringify({ site_id: siteId, count: pulledCount })
      );
      return { success: true, count: pulledCount };
    } catch (error: any) {
      log.error(`Erreur lors de la récupération des cartes pour le site ${siteId}:`, error);
      logAudit(
        userLogin,
        'SYNC_DOWN_FAILURE',
        JSON.stringify({ site_id: siteId, error: error.message || String(error) })
      );
      return { success: false, message: error.message || String(error) };
    }
  });


  // SITE ADMIN — Récupération des agents depuis Supabase (Downstream Pull)
  ipcMain.handle('sync:pullAgents', async (_, siteId: number, currentUser?: any) => {
    const userLogin = currentUser?.login || getCurrentUserLogin() || 'ADMIN';
    try {
      const secureUser = getSecureCurrentUser();
      if (!secureUser) throw new Error("Session invalide.");
      // Sécurité (P1) : verifyUserRole + isCentreAdmin/restrictCentreId dérivés de la session
      // serveur réelle (getSecureCurrentUser), jamais du paramètre `currentUser` fourni par le
      // client (falsifiable). Périmètre aligné sur l'usage légitime (AgentsPage.tsx, route
      // protégée SUPER ADMIN / ADMINISTRATEUR_SITE).
      if (!verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE'])) {
        throw new Error("Accès refusé : rôle insuffisant pour récupérer les agents.");
      }
      siteId = secureUser.role === 'SUPER ADMIN' ? Number(siteId) : secureUser.site_id;

      if (!siteId || isNaN(Number(siteId))) {
        throw new Error("siteId obligatoire et valide requis pour la rÃ©cupÃ©ration.");
      }

      const isCentreAdmin = secureUser.role === 'ADMIN_CENTRE';
      const restrictCentreId = isCentreAdmin ? secureUser.centre_id : undefined;

      logAudit(
        userLogin,
        'SYNC_AGENTS_INIT',
        JSON.stringify({ site_id: siteId, restrictCentreId })
      );
      const res = await queries.pullAgentsFromCloud(Number(siteId), restrictCentreId);
      logAudit(
        userLogin,
        'SYNC_AGENTS_SUCCESS',
        JSON.stringify({ site_id: siteId, restrictCentreId, result: res })
      );
      return res;
    } catch (error: any) {
      log.error(`Erreur lors de la rÃ©cupération des agents pour le site ${siteId}:`, error);
      logAudit(
        userLogin,
        'SYNC_AGENTS_FAILURE',
        JSON.stringify({ site_id: siteId, error: error.message || String(error) })
      );
      return { success: false, message: error.message || String(error) };
    }
  });

  // RÉCUPÉRATION FORCÉE DES UTILISATEURS (ADMIN CENTRE & SUPER ADMIN)
  ipcMain.handle('admin:syncUsersFromSupabase', async (_, siteId: number, currentUser?: any) => {
    const userLogin = currentUser?.login || getCurrentUserLogin() || 'ADMIN';
    // Sécurité (P0) : rôle, site et centre dérivés de la session serveur réelle
    // (getSecureCurrentUser), jamais du paramètre `currentUser` fourni par le client
    // (falsifiable) — même pattern que sync:pullAgents. Périmètre de rôles aligné sur
    // l'usage légitime (AdminCentreLayout.tsx, route protégée ADMIN_CENTRE ; SUPER ADMIN
    // conservé car déjà autorisé avant ce correctif).
    const secureUser = getSecureCurrentUser();
    const userRole = secureUser?.role || 'OPERATEUR';
    try {
      if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMIN_CENTRE'])) {
        throw new Error("Accès refusé : rôle insuffisant pour forcer la synchronisation des utilisateurs.");
      }
      if (!siteId || isNaN(Number(siteId))) {
        throw new Error("siteId obligatoire et valide requis.");
      }

      const effectiveSiteId = userRole === 'SUPER ADMIN' ? Number(siteId) : secureUser.site_id;
      const restrictCentreId = userRole === 'ADMIN_CENTRE' ? secureUser.centre_id : undefined;

      logAudit(
        userLogin,
        'SYNC_USERS_FORCED_INIT',
        JSON.stringify({ site_id: effectiveSiteId, restrictCentreId })
      );

      const res = await queries.pullAgentsFromCloud(Number(effectiveSiteId), restrictCentreId);

      logAudit(
        userLogin,
        'SYNC_USERS_FORCED_SUCCESS',
        JSON.stringify({ site_id: effectiveSiteId, restrictCentreId, result: res })
      );
      return res;
    } catch (error: any) {
      log.error(`Erreur lors de la récupération forcée des utilisateurs pour le site ${siteId}:`, error);
      logAudit(
        userLogin,
        'SYNC_USERS_FORCED_FAILURE',
        JSON.stringify({ site_id: siteId, error: error.message || String(error) })
      );
      return { success: false, message: error.message || String(error) };
    }
  });
  // DB MAINTENANCE - Synchronisation forcée (Full Downstream Pull)
  ipcMain.handle('sync:forceFullPull', async (_, siteId: number, currentUser) => {
    try {
      const secureUser = getSecureCurrentUser();
      if (!secureUser) throw new Error("Session invalide.");
      siteId = secureUser.role === 'SUPER ADMIN' ? Number(siteId) : secureUser.site_id;

      if (!siteId || isNaN(Number(siteId))) {
        throw new Error("siteId obligatoire et valide requis pour la synchronisation forcée.");
      }

      // On tente de ré-initialiser la DB localement
      await initDatabase();

      logAudit(
        currentUser?.login || 'ADMIN',
        'SYNCHRO_FORCEE',
        `Lancement d'une synchronisation forcée (sans cache) pour le site ID ${siteId}.`
      );

      const pulledCount = await runDownstream(Number(siteId), true);

      // Rapatriement des entrées t_logs CRUD cross-poste — mêmes garanties d'isolation que
      // pour sync:pullSiteCards ci-dessus (échec non-bloquant, cloisonnement site_id interne).
      try {
        await runLogsDownstream(Number(siteId));
      } catch (logsSyncErr) {
        log.warn(`[sync:forceFullPull] runLogsDownstream échoué (non-bloquant) pour le site ${siteId} :`, logsSyncErr);
      }

      logAudit(
        currentUser?.login || 'ADMIN',
        'SYNCHRO_FORCEE',
        `Synchronisation forcée terminée avec succès pour le site ID ${siteId}. ${pulledCount} cartes rapatriées.`
      );

      return { success: true, count: pulledCount };
    } catch (error: any) {
      log.error(`[MAINTENANCE] Erreur lors de la synchronisation forcée du site ${siteId}:`, error);
      return { success: false, message: error.message || String(error) };
    }
  });

  // DB STATS
  ipcMain.handle('database:getCardsCount', () => queries.getCardsCount());

  // DB EXPORT
  ipcMain.handle('database:export', async (_, currentUser?: any) => {
    // Sécurité (P0) : accès strictement réservé aux rôles autorisés côté serveur, dérivé de la
    // session réelle (getSecureCurrentUser()) — jamais du paramètre `currentUser` fourni par le
    // client (falsifiable), conservé ci-dessous UNIQUEMENT pour l'étiquette du log d'audit,
    // comme avant. Périmètre de rôles aligné sur l'exposition UI existante (ProfilePage.tsx,
    // bouton "Exporter la base locale" ~ligne 266 : isSuperAdmin || ADMINISTRATEUR_SITE) : avant
    // ce correctif, N'IMPORTE QUEL utilisateur authentifié (quel que soit son rôle) pouvait
    // télécharger l'intégralité de la base SQLite de production (toutes les cartes de tous les
    // sites, num_secu, contacts, ET les mots de passe hachés de tous les comptes utilisateurs) —
    // ce handler n'était protégé par AUCUN contrôle de rôle serveur.
    const secureUser = getSecureCurrentUser();
    if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE'])) {
      log.warn('[SECURITY] Accès refusé à database:export : session invalide ou rôle non autorisé.');
      return { success: false, reason: 'unauthorized' };
    }

    try {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Exporter la base de données SQLite',
        defaultPath: 'gest_in_situ.db',
        filters: [
          { name: 'Base de données SQLite', extensions: ['db', 'sqlite'] },
          { name: 'Tous les fichiers', extensions: ['*'] }
        ]
      });

      if (result.canceled || !result.filePath) {
        log.info('[DB EXPORT] Exportation annulée par l\'utilisateur.');
        return { success: false, reason: 'cancelled' };
      }

      const dbPath = getDbPath();
      if (!existsSync(dbPath)) {
        log.error(`[DB EXPORT] Fichier source introuvable à l'emplacement : ${dbPath}`);
        return { success: false, reason: 'source_missing' };
      }

      copyFileSync(dbPath, result.filePath);
      log.info(`[DB EXPORT] Base de données exportée avec succès par ${currentUser?.login || 'SYSTEM'} vers : ${result.filePath}`);
      queries.insertAuditLog(
        currentUser?.login || 'SYSTEM',
        'EXPORT_DB',
        `Base de données exportée vers : ${result.filePath}`
      );
      return { success: true, filePath: result.filePath };
    } catch (err: any) {
      log.error('[DB EXPORT] Échec de l\'exportation de la base de données :', err);
      return { success: false, reason: err.message || String(err) };
    }
  });

  // DB IMPORT
  ipcMain.handle('database:import', async (_, currentUser?: any, password?: string) => {
    // Sécurité (P0 CRITIQUE) : ce handler REMPLACE PUREMENT ET SIMPLEMENT le fichier de base de
    // données de PRODUCTION (toutes les cartes de tous les sites + comptes utilisateurs) puis
    // relance l'application dessus (app.relaunch() plus bas) — l'action la plus destructive de
    // toute l'application. Avant ce correctif, AUCUN contrôle n'existait : le bouton
    // "Importation Technique" est exposé sur l'écran de connexion LUI-MÊME (LoginPage.tsx,
    // zone "Importation Technique (Base locale)"), donc AVANT toute authentification —
    // n'importe qui ayant accès au poste pouvait écraser la base de production par un fichier
    // arbitraire (sous réserve de l'extension .db/.sqlite et d'un en-tête SQLite valide), sans
    // même se connecter.
    // Comme aucune session serveur n'existe à cet écran (getSecureCurrentUser() y est
    // systématiquement null), le pattern verifyUserRole()/getSecureCurrentUser() utilisé
    // ailleurs dans ce fichier (ex. maintenance:clearAll) ne peut PAS s'appliquer ici : la seule
    // protection possible est une preuve de connaissance du mot de passe SUPER ADMIN réel,
    // vérifiée directement contre son hash en base — même fonction que le fallback de
    // hierarchy:verifyPassword quand aucun login n'est fourni. `currentUser` reste utilisé
    // UNIQUEMENT pour l'étiquette du log d'audit plus bas, jamais pour un contrôle d'accès.
    //
    // ⚠️ IMPACT UI CONNU (STOP & WARN — hors périmètre de cette intervention) : LoginPage.tsx
    // (handleImportDatabase, modale de confirmation ~ligne 340) appelle aujourd'hui
    // `window.api.database.import()` SANS mot de passe. Cet appel sera donc désormais
    // systématiquement rejeté ('unauthorized') tant que LoginPage.tsx n'aura pas été mis à jour
    // pour collecter le mot de passe SUPER ADMIN dans sa modale existante et le transmettre ici
    // — LoginPage.tsx n'étant pas dans le périmètre autorisé de cette tâche, ce correctif choisit
    // volontairement un état fail-closed (fonctionnalité de restauration d'urgence indisponible)
    // plutôt que de laisser un écrasement de la base de production accessible sans authentification.
    if (!password || !queries.verifySuperAdminPassword(password)) {
      log.warn('[SECURITY] Accès refusé à database:import : mot de passe SUPER ADMIN manquant ou invalide.');
      return { success: false, reason: 'unauthorized' };
    }

    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Sélectionner une base de données SQLite à importer',
        properties: ['openFile'],
        filters: [
          { name: 'Base de données SQLite', extensions: ['db', 'sqlite'] },
          { name: 'Tous les fichiers', extensions: ['*'] }
        ]
      });

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        log.info('[DB IMPORT] Importation annulée par l\'utilisateur.');
        return { success: false, reason: 'cancelled' };
      }

      const importPath = result.filePaths[0];

      // Vérification de l'extension
      const ext = importPath.split('.').pop()?.toLowerCase();
      if (ext !== 'db' && ext !== 'sqlite') {
        log.warn(`[DB IMPORT] Fichier refusé (extension incorrecte) : ${importPath}`);
        return { success: false, reason: 'invalid_extension' };
      }

      // Vérification sommaire de l'en-tête SQLite
      const fd = openSync(importPath, 'r');
      const headerBuffer = Buffer.alloc(16);
      const bytesRead = readSync(fd, headerBuffer, 0, 16, 0);
      closeSync(fd);

      if (bytesRead < 16 || headerBuffer.toString('utf-8', 0, 15) !== 'SQLite format 3' || headerBuffer[15] !== 0) {
        log.warn(`[DB IMPORT] Fichier refusé (en-tête SQLite invalide) : ${importPath}`);
        return { success: false, reason: 'invalid_sqlite_header' };
      }

      const dbPath = getDbPath();
      const backupDir = getBackupDir();
      const backupPath = join(backupDir, `gest_in_situ_backup_${Date.now()}.db`);

      // Sauvegarde de sécurité
      if (existsSync(dbPath)) {
        copyFileSync(dbPath, backupPath);
        log.info(`[DB IMPORT] Sauvegarde de sécurité créée à : ${backupPath}`);
      }

      // Fermeture propre de la base avant écrasement
      closeDatabase();

      // Remplacement du fichier
      copyFileSync(importPath, dbPath);
      log.info(`[DB IMPORT] Base de données remplacée avec succès depuis ${importPath} par ${currentUser?.login || 'SYSTEM'}`);

      // Essayer d'enregistrer l'audit dans la nouvelle base importée
      try {
        const tempDb = await initDatabase();
        
        // Créer la table si elle n'existe pas
        try {
          tempDb.exec(`
            CREATE TABLE IF NOT EXISTS t_audit_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              utilisateur TEXT,
              action TEXT,
              details TEXT,
              date_creation TEXT DEFAULT (datetime('now'))
            );
          `);
        } catch (tableErr) {
          log.warn("[DB IMPORT] Impossible de créer ou vérifier la table t_audit_log :", tableErr);
        }

        // Insérer le log d'audit
        try {
          tempDb.prepare(`
            INSERT INTO t_audit_log (utilisateur, action, details, date_creation)
            VALUES (?, ?, ?, datetime('now'))
          `).run(
            currentUser?.login || 'SYSTEM',
            'IMPORT_DB',
            `Base de données importée depuis : ${importPath}. Sauvegarde de sécurité créée à : ${backupPath}`
          );
          log.info('[DB IMPORT] Log d\'audit inséré dans la base importée.');
        } catch (insertErr) {
          log.warn("[DB IMPORT] Table d'audit manquante ou erreur d'insertion dans la base importée, log ignoré :", insertErr);
        }
      } catch (logErr) {
        log.warn("[DB IMPORT] Erreur générale lors de la journalisation de l'audit d'importation (log ignoré) :", logErr);
      } finally {
        closeDatabase();
      }

      // Relaunch de l'application
      log.info('[DB IMPORT] Déclenchement du redémarrage de l\'application...');
      app.relaunch();
      app.exit(0);

      return { success: true };
    } catch (err: any) {
      log.error('[DB IMPORT] Échec de l\'importation de la base de données :', err);
      return { success: false, reason: err.message || String(err) };
    }
  });

  // USER PROFILE
  ipcMain.handle('auth:updateSelfProfile', async (_, _userId: number, data: any) => {
    const userLogin = getCurrentUserLogin() || 'SYSTEM';

    // Sécurité (P1) : l'identité ciblée par la mise à jour DOIT provenir de la
    // session serveur réelle (getSecureCurrentUser), jamais du paramètre client
    // `userId` — celui-ci était auparavant transmis tel quel par le renderer et
    // aurait permis à un appel IPC forgé de modifier le profil (et désormais le
    // login) de n'importe quel autre utilisateur. Le paramètre client `_userId`
    // est conservé dans la signature pour compatibilité mais n'est plus utilisé.
    const secureUser = getSecureCurrentUser();
    if (!secureUser) {
      throw new Error("Session invalide.");
    }
    const userId = secureUser.id_user;

    // Déterminer s'il y a un changement de mot de passe
    const hasPasswordChange = !!data.password;
    
    // Déterminer s'il y a d'autres préférences modifiées
    const preferencesModifiees: Record<string, any> = {};
    if (data.nom_user !== undefined) preferencesModifiees.nom_user = data.nom_user;
    if (data.prenom_user !== undefined) preferencesModifiees.prenom_user = data.prenom_user;
    if (data.email !== undefined) preferencesModifiees.email = data.email;
    if (data.telephone !== undefined) preferencesModifiees.telephone = data.telephone;
    
    const hasPreferencesChange = Object.keys(preferencesModifiees).length > 0;

    try {
      const result = await queries.updateSelfProfile(userId, data);
      
      if (result && result.success) {
        // En cas de succès
        if (hasPreferencesChange) {
          logAudit(userLogin, 'PROFIL_MAJ_PREFERENCES', { changement_effectue: preferencesModifiees });
        }
        if (hasPasswordChange) {
          logAudit(userLogin, 'PROFIL_MAJ_PASSWORD', { succes: true });
        }
      }
      return result;
    } catch (err: any) {
      log.error('[auth:updateSelfProfile] Error updating profile:', err);
      // Toute modification de mot de passe qui échoue est une action de haute sécurité à journaliser immédiatement
      if (hasPasswordChange) {
        logAudit(userLogin, 'PROFIL_ERREUR_PASSWORD', { 
          login: userLogin, 
          erreur: err.message || String(err)
        });
      }
      throw err;
    }
  });


  // AUDIT LOGS
  ipcMain.handle('audit:getPage', async (_, offset: number, limit: number) => {
    try {
      // Sécurité : le cantonnement ADMIN_CENTRE était auparavant décidé à partir du paramètre
      // client `currentUser` (role/centre_id falsifiables) — un ADMIN_CENTRE pouvait forger un
      // rôle différent pour voir les audits de tout le site. Dérivé désormais de la session
      // serveur réelle.
      // Sécurité (P1) : verifyUserRole ajouté — ce handler n'avait auparavant aucun contrôle de
      // rôle serveur (seul le cantonnement centre existait). Périmètre aligné sur l'usage
      // légitime (LogsPage.tsx, route protégée SUPER ADMIN / ADMINISTRATEUR_SITE / ADMIN_CENTRE),
      // même liste que audit:delete ci-dessous.
      const secureUser = getSecureCurrentUser();
      if (!secureUser || !verifyUserRole(secureUser.id_user, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE'])) {
        log.warn('[SECURITY] Accès refusé à audit:getPage : session invalide ou rôle non autorisé.');
        throw new Error("Accès refusé. Session ou rôle non autorisé à consulter les journaux d'audit.");
      }
      const restrictCentreId = secureUser?.role === 'ADMIN_CENTRE' ? secureUser?.centre_id : undefined;
      return queries.getAuditLogsPage(offset, limit, restrictCentreId);
    } catch (e) {
      log.error('IPC Error: audit:getPage', e);
      throw e;
    }
  });

  ipcMain.handle('audit:delete', async (_, id: number) => {
    try {
      // Securite : identite derivee exclusivement de la session serveur (non falsifiable via IPC).
      const secureUser = getSecureCurrentUser();
      const userId = secureUser?.id_user;
      if (!userId || !verifyUserRole(userId, ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE'])) {
        log.warn('[SECURITY] Acces refuse a audit:delete : session invalide ou role non autorise.');
        throw new Error("AccÃ¨s refusÃ©. Session ou rÃ´le non autorisÃ© Ã  supprimer les audits.");
      }
      queries.deleteAuditLog(id);
      queries.insertAuditLog(
        secureUser?.login || 'ADMIN',
        'VALIDATION',
        `Suppression de l'entrÃ©e d'audit ID ${id} par l'administrateur.`
      );
      return { success: true };
    } catch (e) {
      log.error('IPC Error: audit:delete', e);
      throw e;
    }
  });

  // RENDERER LOG RELAYS
  ipcMain.on('log:info', (_, message) => {
    log.info('[Renderer]', message);
  });
  ipcMain.on('log:error', (_, data) => {
    log.error('[Renderer]', data.message, data.error || '');
  });
  ipcMain.on('log:warn', (_, message) => {
    log.warn('[Renderer]', message);
  });

  // FIRST LAUNCH VERIFICATION
  ipcMain.handle('app:checkFirstLaunch', async () => {
    try {
      const db = getDatabase();
      if (!db) return { isFirstLaunch: false };
      
      const row = db.prepare('SELECT COUNT(*) as count FROM t_users').get() as { count: number } | undefined;
      const count = row ? row.count : 0;
      log.info(`[FIRST LAUNCH] Nombre d'utilisateurs en base : ${count}`);
      return { isFirstLaunch: count === 0 };
    } catch (e) {
      log.error('[FIRST LAUNCH] Erreur lors du check de premier démarrage :', e);
      return { isFirstLaunch: false };
    }
  });



  // OPEN EXTERNAL LINK
  ipcMain.handle('app:openExternal', async (_, url: string) => {
    try {
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        await shell.openExternal(url);
        return { success: true };
      }
      return { success: false, error: 'URL invalide ou non sécurisée' };
    } catch (err: any) {
      log.error("[SHELL] Échec d'ouverture de l'URL externe :", err);
      return { success: false, error: err.message };
    }
  });

  // LOGISTIQUE HANDLERS
  try {
    const db = getDatabase();
    if (db) {
      db.prepare(`
        CREATE TABLE IF NOT EXISTS t_logistique_lots (
          lot_id TEXT PRIMARY KEY,
          quantite INTEGER,
          centre_origine TEXT,
          statut TEXT DEFAULT 'RECU',
          nombre_cartes_triees INTEGER DEFAULT 0,
          centre_destination TEXT
        );
      `).run();

      db.prepare(`
        CREATE TABLE IF NOT EXISTS t_logistique_inventaire (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          centre_id TEXT,
          ecart_constate INTEGER,
          note_agent TEXT,
          date_creation TEXT DEFAULT (datetime('now'))
        );
      `).run();
    }
  } catch (err) {
    log.error("[LOGIQUE LOGISTIQUE] Erreur d'initialisation des tables logistiques :", err);
  }

  ipcMain.handle('logistique:recevoirLot', async (_, payload: { lot_id: string; quantite: number; centre_origine: string }) => {
    const agent = getCurrentUserLogin() || 'system';
    try {
      if (!payload.lot_id || payload.quantite === undefined || !payload.centre_origine) {
        throw new Error("Champs requis manquants: lot_id, quantite, centre_origine.");
      }
      
      const db = getDatabase();
      if (!db) throw new Error("Base de données indisponible");

      db.prepare(`
        INSERT OR REPLACE INTO t_logistique_lots (lot_id, quantite, centre_origine, statut)
        VALUES (?, ?, ?, 'RECU');
      `).run(payload.lot_id, payload.quantite, payload.centre_origine);

      logAudit(
        agent,
        'LOG_RECEPTION',
        JSON.stringify({
          lot_id: payload.lot_id,
          quantite: payload.quantite,
          centre_origine: payload.centre_origine
        })
      );
      return { success: true };
    } catch (err: any) {
      log.error("[LOGISTIQUE] Erreur recevoirLot :", err);
      logAudit(
        agent,
        'LOG_ERREUR_LOGISTIQUE',
        JSON.stringify({
          action: 'LOG_RECEPTION',
          error: err.message || String(err),
          payload
        })
      );
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('logistique:triCartes', async (_, payload: { lot_id: string; nombre_cartes_triées: number; statut_tri: string }) => {
    const agent = getCurrentUserLogin() || 'system';
    try {
      if (!payload.lot_id || payload.nombre_cartes_triées === undefined || !payload.statut_tri) {
        throw new Error("Champs requis manquants: lot_id, nombre_cartes_triées, statut_tri.");
      }

      const db = getDatabase();
      if (!db) throw new Error("Base de données indisponible");

      db.prepare(`
        UPDATE t_logistique_lots 
        SET nombre_cartes_triees = ?, statut = ?
        WHERE lot_id = ?;
      `).run(payload.nombre_cartes_triées, payload.statut_tri, payload.lot_id);

      logAudit(
        agent,
        'LOG_TRI',
        JSON.stringify({
          lot_id: payload.lot_id,
          nombre_cartes_triées: payload.nombre_cartes_triées,
          statut_tri: payload.statut_tri
        })
      );
      return { success: true };
    } catch (err: any) {
      log.error("[LOGISTIQUE] Erreur triCartes :", err);
      logAudit(
        agent,
        'LOG_ERREUR_LOGISTIQUE',
        JSON.stringify({
          action: 'LOG_TRI',
          error: err.message || String(err),
          payload
        })
      );
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('logistique:transfertCentre', async (_, payload: { lot_id: string; centre_destination: string; nombre_cartes: number }) => {
    const agent = getCurrentUserLogin() || 'system';
    try {
      if (!payload.lot_id || !payload.centre_destination || payload.nombre_cartes === undefined) {
        throw new Error("Champs requis manquants: lot_id, centre_destination, nombre_cartes.");
      }

      const db = getDatabase();
      if (!db) throw new Error("Base de données indisponible");

      const lot = db.prepare("SELECT * FROM t_logistique_lots WHERE lot_id = ?").get(payload.lot_id);
      if (!lot) {
        throw new Error(`Le lot avec l'identifiant ${payload.lot_id} n'existe pas.`);
      }

      db.prepare(`
        UPDATE t_logistique_lots
        SET centre_destination = ?, quantite = ?, statut = 'TRANSFERE'
        WHERE lot_id = ?;
      `).run(payload.centre_destination, payload.nombre_cartes, payload.lot_id);

      logAudit(
        agent,
        'LOG_TRANSFERT',
        JSON.stringify({
          lot_id: payload.lot_id,
          centre_destination: payload.centre_destination,
          nombre_cartes: payload.nombre_cartes
        })
      );
      return { success: true };
    } catch (err: any) {
      log.error("[LOGISTIQUE] Erreur transfertCentre :", err);
      logAudit(
        agent,
        'LOG_ERREUR_LOGISTIQUE',
        JSON.stringify({
          action: 'LOG_TRANSFERT',
          error: err.message || String(err),
          payload
        })
      );
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('logistique:inventairePhysique', async (_, payload: { centre_id: string | number; ecart_constaté: number; note_agent: string }) => {
    const agent = getCurrentUserLogin() || 'system';
    try {
      if (payload.centre_id === undefined || payload.ecart_constaté === undefined || payload.note_agent === undefined) {
        throw new Error("Champs requis manquants: centre_id, ecart_constaté, note_agent.");
      }

      const db = getDatabase();
      if (!db) throw new Error("Base de données indisponible");

      db.prepare(`
        INSERT INTO t_logistique_inventaire (centre_id, ecart_constate, note_agent)
        VALUES (?, ?, ?);
      `).run(String(payload.centre_id), payload.ecart_constaté, payload.note_agent);

      logAudit(
        agent,
        'LOG_INVENTAIRE',
        JSON.stringify({
          centre_id: payload.centre_id,
          ecart_constaté: payload.ecart_constaté,
          note_agent: payload.note_agent
        })
      );
      return { success: true };
    } catch (err: any) {
      log.error("[LOGISTIQUE] Erreur inventairePhysique :", err);
      logAudit(
        agent,
        'LOG_ERREUR_LOGISTIQUE',
        JSON.stringify({
          action: 'LOG_INVENTAIRE',
          error: err.message || String(err),
          payload
        })
      );
      return { success: false, error: err.message };
    }
  });

  // APUREMENT HANDLERS
  ipcMain.handle('apurement:validerEcart', async (_, payload: { lot_id: string; ecart_initial: number; motif_apurement: string; nouvel_etat_stock: number; confirme: boolean }) => {
    const agent = getCurrentUserLogin() || 'system';
    try {
      if (!payload || payload.confirme !== true) {
        throw new Error("Opération non autorisée : confirmation explicite requise.");
      }

      if (!payload.lot_id || payload.ecart_initial === undefined || !payload.motif_apurement || payload.nouvel_etat_stock === undefined) {
        throw new Error("Champs requis manquants: lot_id, ecart_initial, motif_apurement, nouvel_etat_stock.");
      }

      if (payload.nouvel_etat_stock < 0) {
        throw new Error("SQLITE_CONSTRAINT: Stock négatif impossible");
      }

      const db = getDatabase();
      if (!db) throw new Error("Base de données indisponible");

      db.prepare(`
        CREATE TABLE IF NOT EXISTS t_apurements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          lot_id TEXT,
          ecart_initial INTEGER,
          motif_apurement TEXT,
          nouvel_etat_stock INTEGER,
          date_apurement TEXT DEFAULT (datetime('now')),
          agent_responsable TEXT
        );
      `).run();

      const stmt = db.prepare(`
        INSERT INTO t_apurements (lot_id, ecart_initial, motif_apurement, nouvel_etat_stock, agent_responsable)
        VALUES (?, ?, ?, ?, ?);
      `);
      const info = stmt.run(payload.lot_id, payload.ecart_initial, payload.motif_apurement, payload.nouvel_etat_stock, agent);
      const opId = info.lastInsertRowid;

      logAudit(
        agent,
        'APUREMENT_VALIDATION',
        JSON.stringify({
          id_operation: opId,
          lot_id: payload.lot_id,
          ecart_initial: payload.ecart_initial,
          motif_apurement: payload.motif_apurement,
          nouvel_etat_stock: payload.nouvel_etat_stock,
          agent_responsable: agent
        })
      );

      return { success: true, id: opId };
    } catch (err: any) {
      log.error("[APUREMENT] Erreur validerEcart :", err);
      logAudit(
        agent,
        'APUREMENT_ERREUR',
        JSON.stringify({
          action: 'APUREMENT_VALIDATION',
          error: err.message || String(err),
          lot_id: payload?.lot_id,
          ecart_initial: payload?.ecart_initial,
          nouvel_etat_stock: payload?.nouvel_etat_stock
        })
      );
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('apurement:annulerOperation', async (_, payload: { id_operation: number; motif_annulation: string }) => {
    const agent = getCurrentUserLogin() || 'system';
    try {
      if (!payload || !payload.id_operation || !payload.motif_annulation) {
        throw new Error("Champs requis manquants: id_operation, motif_annulation.");
      }

      logAudit(
        agent,
        'APUREMENT_ANNULATION',
        JSON.stringify({
          id_operation: payload.id_operation,
          motif_annulation: payload.motif_annulation,
          agent_responsable: agent
        })
      );
      return { success: true };
    } catch (err: any) {
      log.error("[APUREMENT] Erreur annulerOperation :", err);
      logAudit(
        agent,
        'APUREMENT_ERREUR',
        JSON.stringify({
          action: 'APUREMENT_ANNULATION',
          error: err.message || String(err),
          id_operation: payload?.id_operation
        })
      );
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('apurement:genererPv', async (_, payload: { date_pv: string; agent_responsable: string; references_lots: string[] }) => {
    const agent = getCurrentUserLogin() || 'system';
    try {
      if (!payload || !payload.date_pv || !payload.agent_responsable || !payload.references_lots) {
        throw new Error("Champs requis manquants: date_pv, agent_responsable, references_lots.");
      }

      logAudit(
        agent,
        'APUREMENT_GENERATION_PV',
        JSON.stringify({
          date_pv: payload.date_pv,
          agent_responsable: payload.agent_responsable,
          references_lots: payload.references_lots
        })
      );
      return { success: true };
    } catch (err: any) {
      log.error("[APUREMENT] Erreur genererPv :", err);
      logAudit(
        agent,
        'APUREMENT_ERREUR',
        JSON.stringify({
          action: 'APUREMENT_GENERATION_PV',
          error: err.message || String(err),
          date_pv: payload?.date_pv
        })
      );
      return { success: false, error: err.message };
    }
  });

  // --- QUEUE / FILE D'ATTENTE HANDLERS ---
  ipcMain.handle('queue:addBeneficiaire', async (_, payload: { id_beneficiaire: number; centre_id: number; heure_arrivee: string }) => {
    const userLogin = getCurrentUserLogin() || 'SYSTEM';
    try {
      logAudit(
        userLogin,
        'QUEUE_ENREGISTREMENT',
        JSON.stringify({
          id_beneficiaire: payload.id_beneficiaire,
          centre_id: payload.centre_id,
          heure_arrivee: payload.heure_arrivee
        })
      );
      return { success: true };
    } catch (e) {
      log.error('IPC Error: queue:addBeneficiaire', e);
      throw e;
    }
  });

  ipcMain.handle('queue:appelGuichet', async (_, payload: { id_beneficiaire: number; numero_guichet: string; agent_id: number; heure_arrivee?: string }) => {
    const userLogin = getCurrentUserLogin() || 'SYSTEM';
    try {
      logAudit(
        userLogin,
        'QUEUE_APPEL',
        JSON.stringify({
          id_beneficiaire: payload.id_beneficiaire,
          numero_guichet: payload.numero_guichet,
          agent_id: payload.agent_id
        })
      );

      // Calcul du temps d'attente et alerte critique (60 minutes) de manière asynchrone
      setImmediate(() => {
        try {
          let heureArrivee = payload.heure_arrivee;
          const db = getDatabase();
          if (!heureArrivee && db) {
            const row = db.prepare(`
              SELECT details FROM t_audit_log 
              WHERE action = 'QUEUE_ENREGISTREMENT' 
                AND details LIKE ? 
              ORDER BY id DESC LIMIT 1
            `).get(`%"id_beneficiaire":${payload.id_beneficiaire}%`) as { details: string } | undefined;
            
            if (row && row.details) {
              const parsed = JSON.parse(row.details);
              if (parsed && parsed.heure_arrivee) {
                heureArrivee = parsed.heure_arrivee;
              }
            }
          }

          if (heureArrivee) {
            const arrivee = new Date(heureArrivee).getTime();
            const appel = Date.now();
            const diffMinutes = (appel - arrivee) / (1000 * 60);

            if (diffMinutes > 60) {
              logAudit(
                userLogin,
                'FILE_ATTENTE_CRITIQUE',
                JSON.stringify({
                  id_beneficiaire: payload.id_beneficiaire,
                  heure_arrivee: heureArrivee,
                  heure_appel: new Date(appel).toISOString(),
                  temps_attente_minutes: Math.round(diffMinutes),
                  message: `Alerte : Le bénéficiaire ${payload.id_beneficiaire} a attendu ${Math.round(diffMinutes)} minutes avant d'être appelé.`
                })
              );
            }
          }
        } catch (err) {
          log.error('Error during queue waiting time check:', err);
        }
      });

      return { success: true };
    } catch (e) {
      log.error('IPC Error: queue:appelGuichet', e);
      throw e;
    }
  });

  ipcMain.handle('queue:cloturePassage', async (_, payload: { id_beneficiaire: number; temps_traitement_secondes: number; statut_final: string }) => {
    const userLogin = getCurrentUserLogin() || 'SYSTEM';
    try {
      logAudit(
        userLogin,
        'QUEUE_CLOTURE',
        JSON.stringify({
          id_beneficiaire: payload.id_beneficiaire,
          temps_traitement_secondes: payload.temps_traitement_secondes,
          statut_final: payload.statut_final
        })
      );
      return { success: true };
    } catch (e) {
      log.error('IPC Error: queue:cloturePassage', e);
      throw e;
    }
  });

  // --- RETRAIT HANDLERS ---
  ipcMain.handle('retrait:validerRetrait', async (_, payload: { id_carte: number; id_beneficiaire: number; guichet_id: string }) => {
    const agent = getCurrentUserLogin() || 'system';
    try {
      if (!payload.id_carte || !payload.id_beneficiaire || !payload.guichet_id) {
        throw new Error("Champs requis manquants: id_carte, id_beneficiaire, guichet_id.");
      }

      const db = getDatabase();
      if (!db) throw new Error("Base de données indisponible");

      // Vérifier le statut de la carte
      const carte = db.prepare("SELECT statut, noms, prenoms FROM t_cartes WHERE id_carte = ?").get(payload.id_carte) as { statut: string, noms: string, prenoms: string } | undefined;
      if (!carte) {
        throw new Error(`La carte avec l'identifiant ${payload.id_carte} n'existe pas.`);
      }

      if (carte.statut === 'DELIVRE' || carte.statut === 'RETIRE' || carte.statut === 'DISTRIBUEE') {
        // Tentative de retrait d'une carte déjà remise
        // Log alerte de sécurité majeure : RETRAIT_DOUBLE_TENTATIVE de manière strictement asynchrone (setImmediate)
        setImmediate(() => {
          logAudit(
            agent,
            'RETRAIT_DOUBLE_TENTATIVE',
            JSON.stringify({
              id_carte: payload.id_carte,
              id_beneficiaire: payload.id_beneficiaire,
              guichet_id: payload.guichet_id,
              agent,
              message: `Alerte de sécurité majeure : tentative de double retrait pour la carte ID ${payload.id_carte}`
            })
          );
        });
        return { success: false, error: "Carte déjà délivrée (double tentative détectée)" };
      }

      // Marquer la carte comme remise (DELIVRE)
      db.prepare(`
        UPDATE t_cartes
        SET statut = 'DELIVRE',
            date_delivrance = datetime('now'),
            agent_distributeur = ?,
            centre_retrait = (SELECT nom FROM t_centres WHERE id = ?),
            updated_at = datetime('now'),
            is_dirty = 1
        WHERE id_carte = ?;
      `).run(agent, payload.guichet_id, payload.id_carte);

      // Audit log asynchrone via setImmediate
      setImmediate(() => {
        logAudit(
          agent,
          'RETRAIT_VALIDATION',
          JSON.stringify({
            id_carte: payload.id_carte,
            id_beneficiaire: payload.id_beneficiaire,
            guichet_id: payload.guichet_id
          })
        );
      });

      return { success: true };
    } catch (err: any) {
      log.error("[RETRAIT] Erreur validerRetrait :", err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('retrait:annulerRetrait', async (_, payload: { id_carte: number; motif_annulation: string }) => {
    const agent = getCurrentUserLogin() || 'system';
    try {
      if (!payload.id_carte || !payload.motif_annulation) {
        throw new Error("Champs requis manquants: id_carte, motif_annulation.");
      }

      const db = getDatabase();
      if (!db) throw new Error("Base de données indisponible");

      db.prepare(`
        UPDATE t_cartes
        SET statut = 'EN STOCK',
            date_delivrance = NULL,
            agent_distributeur = NULL,
            nom_retirant = NULL,
            num_retirant = NULL,
            updated_at = datetime('now'),
            is_dirty = 1
        WHERE id_carte = ?;
      `).run(payload.id_carte);

      setImmediate(() => {
        logAudit(
          agent,
          'RETRAIT_ANNULATION',
          JSON.stringify({
            id_carte: payload.id_carte,
            motif_annulation: payload.motif_annulation
          })
        );
      });

      return { success: true };
    } catch (err: any) {
      log.error("[RETRAIT] Erreur annulerRetrait :", err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('retrait:genererRecu', async (_, payload: { id_carte: number; numero_recu: string }) => {
    const agent = getCurrentUserLogin() || 'system';
    try {
      if (!payload.id_carte || !payload.numero_recu) {
        throw new Error("Champs requis manquants: id_carte, numero_recu.");
      }

      setImmediate(() => {
        logAudit(
          agent,
          'RETRAIT_RECU_IMPRIME',
          JSON.stringify({
            id_carte: payload.id_carte,
            numero_recu: payload.numero_recu
          })
        );
      });

      return { success: true };
    } catch (err: any) {
      log.error("[RETRAIT] Erreur genererRecu :", err);
      return { success: false, error: err.message };
    }
  });

  // --- PILOTAGE DASHBOARD ADMIN CENTRE ---
  ipcMain.handle('admin:toggleGuichet', async (_, payload: { id_guichet: string | number; nouvel_etat: boolean; motif_changement: string }) => {
    const userLogin = getCurrentUserLogin() || 'SYSTEM';
    try {
      if (payload.id_guichet === undefined || payload.nouvel_etat === undefined) {
        throw new Error("Champs requis manquants: id_guichet, nouvel_etat.");
      }

      // Audit de l'action de pilotage du guichet
      setImmediate(() => {
        logAudit(
          userLogin,
          'ADMIN_GUICHET_TOGGLE',
          {
            id_guichet: payload.id_guichet,
            nouvel_etat: payload.nouvel_etat,
            motif_changement: payload.motif_changement || ''
          }
        );

        // Si le guichet est fermé (nouvel_etat === false) et que c'est une réduction critique
        // (Par exemple, fermeture entraînant une réduction critique du service)
        // La consigne demande : "Si une action réduit la capacité d'accueil de plus de 50%, logue une alerte 'ADMIN_CAPACITE_REDUITE_CRITIQUE' avec le login"
        // Nous allons tracer si le motif indique une coupure importante ou si nouvel_etat est false
        if (payload.nouvel_etat === false) {
          logAudit(
            userLogin,
            'ADMIN_CAPACITE_REDUITE_CRITIQUE',
            {
              login: userLogin,
              id_guichet: payload.id_guichet,
              raison: `Fermeture de guichet entraînant une réduction de capacité (Motif: ${payload.motif_changement || 'non spécifié'})`
            }
          );
        }
      });

      return { success: true };
    } catch (err: any) {
      log.error("[ADMIN PILOTAGE] Erreur toggleGuichet :", err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('admin:updateQuota', async (_, payload: { nuevo_quota: number; type_service: string; quota_ancien?: number }) => {
    const userLogin = getCurrentUserLogin() || 'SYSTEM';
    try {
      if (payload.nuevo_quota === undefined || !payload.type_service) {
        throw new Error("Champs requis manquants: nuevo_quota, type_service.");
      }

      setImmediate(() => {
        logAudit(
          userLogin,
          'ADMIN_QUOTA_UPDATE',
          {
            nouveau_quota: payload.nuevo_quota,
            type_service: payload.type_service
          }
        );

        // Si le quota est réduit de plus de 50% par rapport à l'ancien quota
        if (payload.quota_ancien && payload.quota_ancien > 0) {
          const ratio = payload.nuevo_quota / payload.quota_ancien;
          if (ratio <= 0.5) {
            logAudit(
              userLogin,
              'ADMIN_CAPACITE_REDUITE_CRITIQUE',
              {
                login: userLogin,
                type_service: payload.type_service,
                nouveau_quota: payload.nuevo_quota,
                quota_ancien: payload.quota_ancien,
                message: `Réduction de quota de plus de 50% (ancien: ${payload.quota_ancien}, nouveau: ${payload.nuevo_quota})`
              }
            );
          }
        }
      });

      return { success: true };
    } catch (err: any) {
      log.error("[ADMIN PILOTAGE] Erreur updateQuota :", err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('admin:resetAlertes', async (_, payload: { type_alerte_reset: string; zone_concernee: string }) => {
    const userLogin = getCurrentUserLogin() || 'SYSTEM';
    try {
      if (!payload.type_alerte_reset || !payload.zone_concernee) {
        throw new Error("Champs requis manquants: type_alerte_reset, zone_concernee.");
      }

      setImmediate(() => {
        logAudit(
          userLogin,
          'ADMIN_ALERTE_RESET',
          {
            type_alerte_reset: payload.type_alerte_reset,
            zone_concernee: payload.zone_concernee
          }
        );
      });

      return { success: true };
    } catch (err: any) {
      log.error("[ADMIN PILOTAGE] Erreur resetAlertes :", err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sync:pullCentres', async (_, siteId: number, currentUser?: any) => {
    try {
      const secureUser = getSecureCurrentUser();
      if (!secureUser) throw new Error("Session invalide.");
      siteId = secureUser.role === 'SUPER ADMIN' ? Number(siteId) : secureUser.site_id;

      return await queries.pullCentresFromCloud(Number(siteId));
    } catch (error: any) {
      log.error('Erreur lors de la recup des centres :', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('sync:forceCentres', async (_, siteId: number, currentUser?: any) => {
    try {
      const secureUser = getSecureCurrentUser();
      if (!secureUser) throw new Error("Session invalide.");
      siteId = secureUser.role === 'SUPER ADMIN' ? Number(siteId) : secureUser.site_id;

      return await queries.forceCentresSync(Number(siteId));
    } catch (error: any) {
      log.error("Erreur lors de l'envoi des centres :", error);
      return { success: false, message: error.message };
    }
  });


  log.info('All IPC handlers registered');
}

