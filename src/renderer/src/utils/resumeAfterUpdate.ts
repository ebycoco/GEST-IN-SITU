/**
 * Reprise de page après installation d'une mise à jour (flux « Installer maintenant »).
 *
 * Sauvegarde, juste avant la fermeture déclenchée par le bandeau de mise à jour, un
 * contexte minimal dans localStorage ; après la reconnexion MANUELLE de l'agent
 * (aucune connexion automatique), RoleRedirect consulte ce contexte et, si et seulement
 * si l'identité/portée concordent, redirige vers la route sauvegardée au lieu de
 * l'accueil du rôle. ProtectedRoute reste le garde d'accès final.
 *
 * Aucun canal IPC, aucune écriture BDD. Toute erreur de stockage est avalée
 * (localStorage peut être indisponible : la reprise est un confort, jamais un prérequis).
 */

const RESUME_KEY = 'gest-in-situ-resume-after-update';
const RESUME_MAX_AGE_MS = 30 * 60 * 1000;

export interface ResumeUserScope {
  id_user: number;
  role: string;
  site_id?: number | null;
  centre_id?: number | null;
}

interface ResumeContext {
  userId: number;
  role: string;
  siteId: number | null;
  centreId: number | null;
  route: string;
  savedAt: number;
}

/** Route interne exploitable (jamais /login, /role-selector, vide ou racine). */
function normalizeRoute(hash: string): string | null {
  const route = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!route.startsWith('/')) return null;
  const pathOnly = route.split('?')[0].replace(/\/+$/, '');
  if (pathOnly === '' || pathOnly === '/login' || pathOnly === '/role-selector') return null;
  return route;
}

/** Enregistre le contexte courant. Ne fait rien si la route n'est pas restaurable. */
export function saveResumeContext(user: ResumeUserScope | null, hash: string): void {
  try {
    if (!user) return;
    const route = normalizeRoute(hash);
    if (!route) return;
    const ctx: ResumeContext = {
      userId: user.id_user,
      role: user.role,
      siteId: user.site_id ?? null,
      centreId: user.centre_id ?? null,
      route,
      savedAt: Date.now()
    };
    localStorage.setItem(RESUME_KEY, JSON.stringify(ctx));
  } catch {
    // Stockage indisponible : la reprise est simplement abandonnée.
  }
}

/**
 * Lecture PURE (sans effet de bord, sûre en double rendu StrictMode) : retourne la route
 * à restaurer si le contexte sauvegardé correspond exactement à l'utilisateur courant
 * (même id, rôle actif, site, centre) et a moins de 30 min ; sinon null.
 */
export function peekResumeRoute(user: ResumeUserScope): string | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const ctx = JSON.parse(raw) as Partial<ResumeContext> | null;
    if (!ctx || typeof ctx.route !== 'string' || typeof ctx.savedAt !== 'number') return null;
    const age = Date.now() - ctx.savedAt;
    if (age < 0 || age >= RESUME_MAX_AGE_MS) return null;
    if (
      ctx.userId !== user.id_user ||
      ctx.role !== user.role ||
      (ctx.siteId ?? null) !== (user.site_id ?? null) ||
      (ctx.centreId ?? null) !== (user.centre_id ?? null)
    ) {
      return null;
    }
    return normalizeRoute('#' + ctx.route);
  } catch {
    return null;
  }
}

/** Supprime le contexte (usage unique : appelé après toute consultation, valide ou non). */
export function clearResumeContext(): void {
  try {
    localStorage.removeItem(RESUME_KEY);
  } catch {
    // Ignoré : voir en-tête.
  }
}
