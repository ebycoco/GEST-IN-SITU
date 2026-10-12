// ============================================================================
// Logique PURE de la colonne « Dernière co. » de la page Agents (aucun import natif,
// aucun accès IPC/DOM : testable seule, modèle agentsPresenceStatus.ts).
//
// Règle (cloud puis repli local) :
//  1. rôle principal non suivi (SUPER ADMIN, ADMINISTRATEUR_SITE...) -> « Non suivi » ;
//  2. sinon last_login_at cloud (Map<sync_id, ISO>) -> date cloud ;
//  3. sinon t_users.last_login local (SQLite « YYYY-MM-DD HH:MM:SS » en UTC, sans suffixe) -> date locale marquée ;
//  4. sinon « Jamais ».
// ============================================================================

/**
 * ATTENTION : copie dupliquée de PRESENCE_ROLES (src/main/sync/presence.service.ts) — le module
 * main n'est pas importable côté renderer. Toute évolution doit être répercutée des deux côtés ;
 * tests/agents-last-login.test.ts détecte la dérive contre isPresenceTrackedRole().
 */
export const PRESENCE_TRACKED_ROLES: readonly string[] = [
  'OPERATEUR_VERIFICATION',
  'OPERATEUR_QUALITE',
  'OPERATEUR_SAISIE',
  'OPERATEUR_LOGISTIQUE',
  'OPERATEUR_INVENTAIRE',
  'OPERATEUR_APUREMENT',
  'ADMIN_CENTRE',
];

export type LastLoginSource = 'cloud' | 'local' | 'untracked' | 'never';

export interface LastLoginDisplay {
  source: LastLoginSource;
  /** Date ISO UTC (cloud ou local normalisé), null pour untracked/never. */
  iso: string | null;
}

/** ms epoch d'un ISO valide ; null sinon (jamais d'exception). */
function isoToMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Convertit un datetime SQLite « YYYY-MM-DD HH:MM:SS » (UTC, sans suffixe) en ISO UTC.
 * Une valeur déjà suffixée (Z / offset) est conservée telle quelle. null si invalide.
 */
export function sqliteUtcToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = value.trim();
  if (s === '') return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const candidate = hasZone ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}Z`;
  const ms = Date.parse(candidate);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Format court (heure locale du poste) pour la colonne étroite : « jj/mm HH:MM » si l'année est
 * l'année courante, sinon « jj/mm/aa HH:MM ». ISO invalide/absent -> chaîne vide. `now` injectable (tests).
 */
export function formatLastLoginShort(iso: string | null | undefined, now: Date = new Date()): string {
  const ms = isoToMs(iso);
  if (ms === null) return '';
  const d = new Date(ms);
  const datePart = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
  const yearPart = d.getFullYear() === now.getFullYear() ? '' : `/${pad2(d.getFullYear() % 100)}`;
  return `${datePart}${yearPart} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Libellé d'origine affiché sous la date (null pour cloud/untracked/never : rien à signaler). */
export function lastLoginOriginBadge(source: LastLoginSource): string | null {
  return source === 'local' ? '• local' : null;
}

export function resolveLastLogin(
  primaryRole: string | null | undefined,
  syncId: string | null | undefined,
  localLastLogin: string | null | undefined,
  cloudByUser: ReadonlyMap<string, string>,
): LastLoginDisplay {
  if (!primaryRole || !PRESENCE_TRACKED_ROLES.includes(primaryRole)) {
    return { source: 'untracked', iso: null };
  }
  const cloud = syncId ? cloudByUser.get(syncId) : undefined;
  const cloudMs = isoToMs(cloud);
  if (cloudMs !== null) return { source: 'cloud', iso: new Date(cloudMs).toISOString() };
  const localIso = sqliteUtcToIso(localLastLogin);
  if (localIso) return { source: 'local', iso: localIso };
  return { source: 'never', iso: null };
}
