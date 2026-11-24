// Lecture des claims gis_* du jeton d'acces (hook custom_access_token_hook, migration 0011).
// AFFICHAGE et garde d'ecran seulement : le serveur reste l'autorite (fn_mobile_operateur
// relit t_users a chaque appel, 0020). Aucune verification de signature ici.

export const ROLE_V1 = 'OPERATEUR_VERIFICATION';

export interface GisClaims {
  syncId: string;
  siteId: number | null;
  centreId: number | null;
  primaryRole: string | null;
  roles: string[];
}

/** Decode la partie charge utile (base64url) d'un JWT ; null si illisible. */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const obj: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return obj !== null && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toId(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  return null;
}

/** Claims gis_* du jeton, ou null si absentes (jeton sans hook, gis_v manquant). */
export function readGisClaims(jwt: string): GisClaims | null {
  const p = decodeJwtPayload(jwt);
  if (!p || p['gis_v'] === undefined || p['role'] !== 'authenticated') return null;
  const syncId = p['gis_sync_id'];
  if (typeof syncId !== 'string' || syncId === '') return null;
  const rawRoles = p['gis_roles'];
  const roles = Array.isArray(rawRoles) ? rawRoles.filter((r): r is string => typeof r === 'string') : [];
  const primary = p['gis_primary_role'];
  return {
    syncId,
    siteId: toId(p['gis_site_id']),
    centreId: toId(p['gis_centre_id']),
    primaryRole: typeof primary === 'string' ? primary : null,
    roles,
  };
}

/** v1 (Q3) : OPERATEUR_VERIFICATION parmi les roles du jeton, et un site. */
export function isAllowedV1(c: GisClaims | null): c is GisClaims {
  return c !== null && c.siteId !== null && c.roles.includes(ROLE_V1);
}
