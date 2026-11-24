import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

/**
 * Alerte « double délivrance » (P1-2, pilote version téléphone, 2026-11-24).
 *
 * Scénario : ce poste délivre une carte hors ligne ; une autre délivrance (téléphone via
 * fn_mobile_delivrer_carte, ou autre poste) est arrivée au cloud avant. À l'envoi, la garde cloud
 * trg_t_cartes_status_guard (supabase/migrations/0006) garde la première délivrance et renvoie
 * son bloc statut ; le poste l'applique localement (_applyCloudStatusBlock, outbox.service.ts /
 * applyCloudStatusBlock, upload-worker.js) et trace CONFLIT_SYNC_STATUT. Jusqu'ici rien n'était
 * montré à l'opérateur : il croyait avoir remis la carte.
 *
 * Point de détection retenu : la RÉPONSE de l'envoi (upsert ... select) — c'est le seul moment
 * où le poste connaît à la fois SA délivrance (envoyée) et celle gardée par le cloud. Le
 * téléchargement (download-worker.js) ne voit jamais ce cas : une carte locale DELIVRE encore
 * is_dirty = 1 face à une carte cloud DELIVRE a la même priorité de statut (pas de fusion), et
 * une fois l'envoi fait, la carte locale porte déjà la preuve cloud (rien à comparer).
 *
 * Journal : une ligne t_logs ALERTE_DOUBLE_DELIVRANCE, LOCALE (is_dirty = 0, jamais mise en file
 * t_outbox, hors CRUD_SYNC_WHITELIST) : le cloud trace déjà l'arbitrage dans t_sync_conflicts ;
 * l'alerte concerne l'opérateur de CE poste, la remonter consommerait du quota pour rien et la
 * ferait apparaître sur les autres postes. Écrite dans la MÊME transaction que l'alignement de la
 * carte. is_read = 0 tant que l'alerte n'est pas acquittée ; l'acquittement passe is_read à 1 et
 * ajoute une ligne ALERTE_DOUBLE_DELIVRANCE_ACQUITTEE (qui, quand), elle aussi locale.
 *
 * Anti-doublon : une seule alerte par carte (sync_id de la carte, même site), même si les deux
 * chemins d'envoi (outbox et envoi en masse) voient le conflit.
 *
 * DUPLICATION VOLONTAIRE de detectDoubleDelivery/recordDoubleDeliveryAlert dans
 * src/main/workers/upload-worker.js (worker copié sans bundler, ne peut pas importer ce module).
 * Tenir les deux copies alignées.
 */
export const DOUBLE_DELIVERY_ALERT_ACTION = 'ALERTE_DOUBLE_DELIVRANCE';
export const DOUBLE_DELIVERY_ALERT_ACK_ACTION = 'ALERTE_DOUBLE_DELIVRANCE_ACQUITTEE';

/** Canal IPC main -> renderer : « la liste des alertes a peut-être changé, relisez-la ». */
export const DOUBLE_DELIVERY_ALERT_CHANNEL = 'sync:double-delivery-alert';

/** Colonnes de la preuve de retrait conservées dans l'alerte. */
const PROOF_COLUMNS = ['date_delivrance', 'agent_distributeur', 'centre_retrait', 'nom_retirant', 'num_retirant'] as const;

export type DeliveryProof = Record<(typeof PROOF_COLUMNS)[number], string | null>;

export interface DoubleDeliveryInfo {
  carteSyncId: string;
  noms: string;
  prenoms: string;
  garde: DeliveryProof;
  ecarte: DeliveryProof;
}

function proofOf(row: Record<string, unknown>): DeliveryProof {
  const out = {} as DeliveryProof;
  for (const c of PROOF_COLUMNS) {
    const v = row[c];
    out[c] = v === undefined || v === null || v === '' ? null : String(v);
  }
  return out;
}

/**
 * Fonction pure. Double délivrance = la carte a été envoyée DELIVRE, le cloud a gardé une
 * délivrance DELIVRE, et la preuve diffère sur la date ou l'agent (diffColumns = colonnes du bloc
 * statut qui diffèrent, déjà normalisées par l'appelant). Une simple correction de retirant
 * (apurement, même date et même agent) ou un statut cloud autre que DELIVRE ne déclenche rien ici
 * (reste tracé par CONFLIT_SYNC_STATUT).
 */
export function detectDoubleDelivery(
  sent: Record<string, unknown>,
  cloud: Record<string, unknown>,
  diffColumns: readonly string[]
): DoubleDeliveryInfo | null {
  if (sent.statut !== 'DELIVRE' || cloud.statut !== 'DELIVRE') return null;
  if (!diffColumns.includes('date_delivrance') && !diffColumns.includes('agent_distributeur')) return null;
  const carteSyncId = sent.sync_id ? String(sent.sync_id) : '';
  if (!carteSyncId) return null;
  return {
    carteSyncId,
    noms: sent.noms ? String(sent.noms) : '',
    prenoms: sent.prenoms ? String(sent.prenoms) : '',
    garde: proofOf(cloud),
    ecarte: proofOf(sent)
  };
}

/** jj/mm/aaaa hh:mm (heure locale du poste) ; texte brut si la date est illisible. */
export function formatProofDate(value: string | null): string {
  if (!value) return 'date inconnue';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function buildDoubleDeliveryMessage(info: Pick<DoubleDeliveryInfo, 'noms' | 'prenoms' | 'garde'>): string {
  const nom = [info.prenoms, info.noms].filter(Boolean).join(' ').trim() || 'sans nom';
  const agent = info.garde.agent_distributeur || 'un autre agent';
  return `Carte ${nom} déjà remise par ${agent} le ${formatProofDate(info.garde.date_delivrance)} — ` +
    `votre retrait sur ce poste n'a pas été retenu, vérifiez auprès du retirant.`;
}

/**
 * Écrit l'alerte (une seule par carte et par site). À appeler DANS la transaction qui aligne la
 * carte sur le bloc cloud. Retourne true si une nouvelle alerte a été créée.
 */
export function recordDoubleDeliveryAlert(
  db: Database.Database,
  info: DoubleDeliveryInfo,
  siteId: number | null,
  centreId: number | null
): boolean {
  const exists = db.prepare(`
    SELECT 1 FROM t_logs
    WHERE action = ? AND site_id IS ? AND json_extract(valeur_apres, '$.carte_sync_id') = ?
    LIMIT 1
  `).get(DOUBLE_DELIVERY_ALERT_ACTION, siteId, info.carteSyncId);
  if (exists) return false;

  db.prepare(`
    INSERT INTO t_logs (id_user, login_user, action, detail, valeur_avant, valeur_apres, sync_id, is_dirty, is_read, site_id, centre_id)
    VALUES (NULL, 'SYSTEM', ?, ?, ?, ?, ?, 0, 0, ?, ?)
  `).run(
    DOUBLE_DELIVERY_ALERT_ACTION,
    buildDoubleDeliveryMessage(info),
    JSON.stringify({ carte_sync_id: info.carteSyncId, ecarte: info.ecarte }),
    JSON.stringify({ carte_sync_id: info.carteSyncId, noms: info.noms, prenoms: info.prenoms, garde: info.garde }),
    uuidv4(),
    siteId,
    centreId
  );
  return true;
}

// ─── Lecture / acquittement (handlers IPC) ──────────────────────────────────

export interface DoubleDeliveryScope {
  /** null uniquement si allSites (SUPER ADMIN sans site). */
  siteId: number | null;
  /** Filtre centre (rôles de centre) ; null = tout le site. */
  centreId: number | null;
  allSites: boolean;
}

/** Rôles qui voient tout leur site (ADMINISTRATEUR_SITE reçoit un centre_id « principal » au login). */
const SITE_WIDE_ROLES: ReadonlySet<string> = new Set(['SUPER ADMIN', 'ADMINISTRATEUR_SITE']);

/**
 * Portée dérivée de la session serveur (getSecureCurrentUser(), rôle ACTIF — CLAUDE.md §3).
 * null = aucune alerte visible (pas de session, ou compte sans site hors SUPER ADMIN).
 */
export function resolveDoubleDeliveryScope(
  user: { role?: string | null; site_id?: number | null; centre_id?: number | null } | null | undefined
): DoubleDeliveryScope | null {
  if (!user) return null;
  const role = user.role ?? '';
  if (!user.site_id) {
    return role === 'SUPER ADMIN' ? { siteId: null, centreId: null, allSites: true } : null;
  }
  const centreId = !SITE_WIDE_ROLES.has(role) && user.centre_id != null ? Number(user.centre_id) : null;
  return { siteId: Number(user.site_id), centreId, allSites: false };
}

function scopeClause(scope: DoubleDeliveryScope): { sql: string; params: number[] } {
  if (scope.allSites) return { sql: '', params: [] };
  if (scope.centreId != null) {
    // Carte sans centre (non classée) délivrée depuis ce site : visible aussi par les rôles de centre.
    return { sql: ' AND site_id = ? AND (centre_id = ? OR centre_id IS NULL)', params: [scope.siteId as number, scope.centreId] };
  }
  return { sql: ' AND site_id = ?', params: [scope.siteId as number] };
}

export interface DoubleDeliveryAlert {
  id_log: number;
  date_heure: string | null;
  carte_sync_id: string;
  noms: string;
  prenoms: string;
  garde: DeliveryProof;
  ecarte: DeliveryProof | null;
  message: string;
}

const MAX_ALERTS = 50;

/** Alertes non acquittées de la portée, plus récentes d'abord (bornées, Low-Memory). */
export function listPendingDoubleDeliveryAlerts(db: Database.Database, scope: DoubleDeliveryScope): DoubleDeliveryAlert[] {
  const { sql, params } = scopeClause(scope);
  const rows = db.prepare(`
    SELECT id_log, date_heure, detail, valeur_avant, valeur_apres FROM t_logs
    WHERE action = ? AND is_read = 0${sql}
    ORDER BY id_log DESC
    LIMIT ${MAX_ALERTS}
  `).all(DOUBLE_DELIVERY_ALERT_ACTION, ...params) as Array<{
    id_log: number; date_heure: string | null; detail: string | null; valeur_avant: string | null; valeur_apres: string | null;
  }>;

  const out: DoubleDeliveryAlert[] = [];
  for (const r of rows) {
    try {
      const apres = JSON.parse(r.valeur_apres || '{}');
      const avant = r.valeur_avant ? JSON.parse(r.valeur_avant) : null;
      out.push({
        id_log: r.id_log,
        date_heure: r.date_heure,
        carte_sync_id: String(apres.carte_sync_id || ''),
        noms: String(apres.noms || ''),
        prenoms: String(apres.prenoms || ''),
        garde: proofOf(apres.garde || {}),
        ecarte: avant && avant.ecarte ? proofOf(avant.ecarte) : null,
        message: r.detail || ''
      });
    } catch {
      // Ligne illisible : ignorée (jamais bloquante pour l'affichage des autres).
    }
  }
  return out;
}

/**
 * Acquitte une alerte de la portée (is_read = 1) et trace l'acquittement (ligne locale), dans une
 * seule transaction. false si l'alerte n'existe pas, est hors portée ou déjà acquittée.
 */
export function acknowledgeDoubleDeliveryAlert(
  db: Database.Database,
  idLog: number,
  scope: DoubleDeliveryScope,
  actor: { id_user: number | null; login: string }
): boolean {
  if (!Number.isInteger(idLog) || idLog <= 0) return false;
  const { sql, params } = scopeClause(scope);
  return db.transaction(() => {
    const row = db.prepare(`
      SELECT id_log, site_id, centre_id, valeur_apres FROM t_logs
      WHERE id_log = ? AND action = ? AND is_read = 0${sql}
    `).get(idLog, DOUBLE_DELIVERY_ALERT_ACTION, ...params) as
      | { id_log: number; site_id: number | null; centre_id: number | null; valeur_apres: string | null }
      | undefined;
    if (!row) return false;

    db.prepare('UPDATE t_logs SET is_read = 1 WHERE id_log = ?').run(idLog);
    let carteSyncId: string | null = null;
    try { carteSyncId = JSON.parse(row.valeur_apres || '{}').carte_sync_id ?? null; } catch { /* ignoré */ }
    db.prepare(`
      INSERT INTO t_logs (id_user, login_user, action, detail, valeur_apres, sync_id, is_dirty, is_read, site_id, centre_id)
      VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
    `).run(
      actor.id_user,
      actor.login,
      DOUBLE_DELIVERY_ALERT_ACK_ACTION,
      `Alerte double délivrance acquittée (carte ${carteSyncId ?? 'inconnue'}).`,
      JSON.stringify({ alerte_id_log: idLog, carte_sync_id: carteSyncId }),
      uuidv4(),
      row.site_id,
      row.centre_id
    );
    return true;
  })();
}
