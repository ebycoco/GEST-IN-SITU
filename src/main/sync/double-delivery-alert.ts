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
 * carte, sous un point de sauvegarde : un échec de l'alerte n'annule jamais l'alignement (P2-4).
 * is_read = 0 tant que l'alerte n'est pas acquittée ; l'acquittement passe is_read à 1 et
 * ajoute une ligne ALERTE_DOUBLE_DELIVRANCE_ACQUITTEE (qui, quand), elle aussi locale.
 *
 * Anti-doublon : une seule alerte par carte (sync_id de la carte, même site), même si les deux
 * chemins d'envoi (outbox et envoi en masse) voient le conflit.
 *
 * DUPLICATION VOLONTAIRE de parseTimestampMs/isUnacknowledgedLocalDelivery/readLocalSyncedAt/
 * detectDoubleDelivery/recordDoubleDeliveryAlert/recordDoubleDeliveryAlertSafely dans
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
 * Horodatage -> ms epoch. Accepte l'ISO (date_delivrance, avec Z ou +00:00) et le format SQLite
 * datetime('now') « YYYY-MM-DD HH:MM:SS » (synced_at local), lu en UTC comme SQLite l'écrit.
 * NaN si vide ou illisible.
 */
export function parseTimestampMs(value: unknown): number {
  if (value === null || value === undefined || value === '') return NaN;
  const s = String(value).trim();
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s) ? s.replace(' ', 'T') + 'Z' : s;
  return Date.parse(iso);
}

/**
 * P2-1 (audit 2026-11-24) : la délivrance envoyée est-elle une remise faite sur CE poste et pas
 * encore acceptée par le cloud ?
 *
 * Critère : synced_at LOCAL de la carte, lu AVANT l'alignement sur le bloc cloud, comparé à la
 * date_delivrance envoyée, à la seconde (synced_at est tronqué à la seconde).
 *  - synced_at vide : carte jamais synchronisée -> la délivrance est forcément locale -> true.
 *  - date_delivrance dans une seconde strictement postérieure au dernier synced_at : la remise a
 *    eu lieu sur ce poste depuis son dernier échange avec le cloud -> true.
 *  - sinon (date_delivrance <= synced_at) : le poste a déjà échangé la carte avec le cloud APRÈS
 *    cette remise (sa propre remise déjà acceptée, ou copie DELIVRE reçue d'un autre poste) : le
 *    renvoi n'est qu'une copie périmée du bloc statut (ex. date corrigée ailleurs par
 *    corrigerApurementRetirant, puis carte modifiée ici pour une autre raison) -> false.
 * Horloges : remise locale -> date_delivrance et synced_at viennent toutes deux de l'horloge de ce
 * poste (delivrerCarte / datetime('now')) ; copie téléchargée -> synced_at = updated_at cloud
 * (download-worker.js), posé par le même poste que la date_delivrance reçue.
 * Date illisible : true (prudence : une alerte à vérifier plutôt qu'une double remise passée sous
 * silence). Limite assumée : un émargement rétroactif (updateApurementHistorique, date saisie
 * dans le passé) n'est pas reconnu comme remise locale ; le conflit reste tracé par
 * CONFLIT_SYNC_STATUT.
 */
export function isUnacknowledgedLocalDelivery(sentDateDelivrance: unknown, localSyncedAt: unknown): boolean {
  if (localSyncedAt === null || localSyncedAt === undefined || localSyncedAt === '') return true;
  const synced = parseTimestampMs(localSyncedAt);
  const delivered = parseTimestampMs(sentDateDelivrance);
  if (Number.isNaN(synced) || Number.isNaN(delivered)) return true;
  return Math.floor(delivered / 1000) > Math.floor(synced / 1000);
}

/**
 * synced_at local de la carte (filtre sync_id + site_id, comme l'alignement). À lire AVANT
 * d'appliquer le bloc cloud (qui le remet à maintenant). undefined si la carte est introuvable
 * ou si la lecture échoue (jamais bloquant pour l'alignement).
 */
export function readLocalSyncedAt(db: Database.Database, syncId: unknown, siteId: unknown): string | null | undefined {
  try {
    const row = db.prepare('SELECT synced_at FROM t_cartes WHERE sync_id = ? AND site_id = ?')
      .get(String(syncId), siteId as number) as { synced_at: string | null } | undefined;
    return row ? row.synced_at : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fonction pure. Double délivrance = la carte a été envoyée DELIVRE, le cloud a gardé une
 * délivrance DELIVRE, la preuve diffère sur la date ou l'agent (diffColumns = colonnes du bloc
 * statut qui diffèrent, déjà normalisées par l'appelant) ET la remise envoyée a réellement été
 * faite sur ce poste sans avoir encore été acceptée (isUnacknowledgedLocalDelivery, P2-1 ;
 * localSyncedAt = synced_at local lu avant l'alignement). Une simple correction de retirant
 * (même date et même agent), un statut cloud autre que DELIVRE ou une copie périmée ne
 * déclenchent rien ici (reste tracé par CONFLIT_SYNC_STATUT).
 */
export function detectDoubleDelivery(
  sent: Record<string, unknown>,
  cloud: Record<string, unknown>,
  diffColumns: readonly string[],
  localSyncedAt: string | null | undefined
): DoubleDeliveryInfo | null {
  if (sent.statut !== 'DELIVRE' || cloud.statut !== 'DELIVRE') return null;
  if (!diffColumns.includes('date_delivrance') && !diffColumns.includes('agent_distributeur')) return null;
  const carteSyncId = sent.sync_id ? String(sent.sync_id) : '';
  if (!carteSyncId) return null;
  if (!isUnacknowledgedLocalDelivery(sent.date_delivrance, localSyncedAt)) return null;
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
 * Écrit l'alerte (une seule par carte et par site). Les chemins d'envoi l'appellent via
 * recordDoubleDeliveryAlertSafely (point de sauvegarde, P2-4). Retourne true si une nouvelle
 * alerte a été créée.
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

/**
 * P2-4 (audit 2026-11-24) : écriture « au mieux ». À appeler DANS la transaction d'alignement :
 * l'écriture passe par une transaction imbriquée better-sqlite3, c'est-à-dire un SAVEPOINT. En cas
 * d'échec, seul ce point de sauvegarde est annulé, l'erreur est remise à onError (journal) et
 * l'alignement de la carte se poursuit. Retourne true si une nouvelle alerte a été créée.
 */
export function recordDoubleDeliveryAlertSafely(
  db: Database.Database,
  info: DoubleDeliveryInfo,
  siteId: number | null,
  centreId: number | null,
  onError: (err: unknown) => void
): boolean {
  try {
    return db.transaction(() => recordDoubleDeliveryAlert(db, info, siteId, centreId))();
  } catch (err) {
    try { onError(err); } catch { /* journal indisponible : ignoré */ }
    return false;
  }
}

// ─── Lecture / acquittement (handlers IPC) ──────────────────────────────────

export interface DoubleDeliveryScope {
  /** null uniquement si allSites (SUPER ADMIN sans site). */
  siteId: number | null;
  allSites: boolean;
}

/**
 * P2-3 (audit 2026-11-24) : rôles qui délivrent (même liste que le contrôle de cartes:delivrer,
 * handlers.ts). Eux seuls voient et acquittent les alertes.
 */
export const DOUBLE_DELIVERY_ROLES: readonly string[] = ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'OPERATEUR_VERIFICATION'];

/**
 * Portée dérivée de la session serveur (getSecureCurrentUser(), rôle ACTIF — CLAUDE.md §3).
 * null = aucune alerte visible (pas de session, rôle actif qui ne délivre pas, ou compte sans
 * site hors SUPER ADMIN).
 *
 * P2-2 (audit 2026-11-24) : filtre sur le SITE seul, rôles de centre compris. L'alerte est propre
 * au poste et porte le centre de la carte, qui peut être un autre centre du même site (carte non
 * classée remise avec un rangement d'urgence : centre déduit du préfixe, delivrerCarte dans
 * cartes.queries.ts). Le cloisonnement par site (CLAUDE.md §3) est conservé.
 */
export function resolveDoubleDeliveryScope(
  user: { role?: string | null; site_id?: number | null; centre_id?: number | null } | null | undefined
): DoubleDeliveryScope | null {
  if (!user) return null;
  const role = user.role ?? '';
  if (!DOUBLE_DELIVERY_ROLES.includes(role)) return null;
  if (!user.site_id) {
    return role === 'SUPER ADMIN' ? { siteId: null, allSites: true } : null;
  }
  return { siteId: Number(user.site_id), allSites: false };
}

function scopeClause(scope: DoubleDeliveryScope): { sql: string; params: number[] } {
  if (scope.allSites) return { sql: '', params: [] };
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
