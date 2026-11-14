/**
 * Logique PURE (sans React, sans store, sans IPC) de « portée » des caches renderer
 * (tableau de bord, page Import). Testable en environnement node (tests/cache-portee-site.test.ts).
 *
 * Problème corrigé : `dashboardCache` / `importCache` n'étaient pas indexés par site. Un SUPER ADMIN
 * qui change de site actif retrouvait donc les chiffres du site précédent (ou un « 0 » hérité de la
 * vue gouvernance). Chaque instantané porte désormais une clé de portée (`scopeKey`) ; il n'est
 * restauré que si cette clé correspond à la portée courante.
 *
 * Formule du site effectif : identique à celle déjà utilisée par le hook et la page
 * (`role === 'SUPER ADMIN' ? activeSiteId : user.site_id`). Aucune décision de cantonnement n'est
 * prise ici : les handlers IPC dérivent toujours la portée réelle de `getSecureCurrentUser()`
 * (CLAUDE.md §3). Cette clé ne sert qu'à décider si un affichage mis en cache est encore valable.
 *
 * Mémoire (CLAUDE.md §2) : chaînes courtes uniquement, aucune rétention.
 */

/** Clé de la vue gouvernance du SUPER ADMIN (aucun site actif). */
export const GOVERNANCE_SCOPE_KEY = 'GLOBAL';

type NullableId = number | string | null | undefined;

export interface CacheScopeInput {
  /** Rôle ACTIF de la session (user.role du store, aligné sur le serveur par setActiveRole). */
  role?: string | null;
  /** Site actif choisi par le SUPER ADMIN (authStore.activeSiteId). */
  activeSiteId?: NullableId;
  /** Site de rattachement du compte (user.site_id). */
  userSiteId?: NullableId;
  /** Centre du compte (user.centre_id). */
  centreId?: NullableId;
  /** Vue gouvernance : SUPER ADMIN sans site actif. */
  isGovernanceView?: boolean;
}

const part = (v: NullableId): string => (v === null || v === undefined || v === '' ? 'none' : String(v));

/** Site effectif : même formule que useDashboardStats / ImportPage. */
export function resolveEffectiveSiteId(input: Pick<CacheScopeInput, 'role' | 'activeSiteId' | 'userSiteId'>): NullableId {
  return input.role === 'SUPER ADMIN' ? input.activeSiteId : input.userSiteId;
}

/**
 * Clé de portée du tableau de bord : `GLOBAL` (gouvernance) ou `SITE:<site>:<rôle actif>:<centre>`.
 * Le rôle actif et le centre sont inclus : un changement de rôle (setActiveRole) ne vide aucun cache.
 */
export function computeDashboardScopeKey(input: CacheScopeInput): string {
  if (input.isGovernanceView) return GOVERNANCE_SCOPE_KEY;
  return `SITE:${part(resolveEffectiveSiteId(input))}:${part(input.role)}:${part(input.centreId)}`;
}

/** Clé de portée de la page Import : `IMPORT:<site>:<rôle actif>` (le centre n'intervient pas). */
export function computeImportScopeKey(input: Pick<CacheScopeInput, 'role' | 'activeSiteId' | 'userSiteId'>): string {
  return `IMPORT:${part(resolveEffectiveSiteId(input))}:${part(input.role)}`;
}

/**
 * Un instantané n'est restaurable que s'il a été daté (cachedAt, remis à null par
 * invalidateDashboardCache) ET étiqueté de la MÊME portée. Un cache sans clé (hérité d'avant le
 * correctif, ou écrit par un appel sans scopeKey) est refusé : on recharge plutôt que de risquer
 * d'afficher les chiffres d'un autre site.
 */
export function shouldRestoreCache(
  cache: { cachedAt: number | null; scopeKey?: string | null } | null | undefined,
  scopeKey: string
): boolean {
  if (!cache || !cache.cachedAt) return false;
  if (cache.scopeKey === null || cache.scopeKey === undefined) return false;
  return cache.scopeKey === scopeKey;
}
