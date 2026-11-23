// ============================================================================
// Logique PURE du clic sur une case de rôle du formulaire Agents (aucun import natif,
// aucun accès IPC/DOM : testable seule, modèle agentsLastLogin.ts).
//
// Règles :
//  1. décocher le dernier rôle restant est refusé (« Au moins un rôle est requis. ») ;
//  2. le rôle principal est conservé tant qu'il reste coché ;
//  3. s'il est décoché, il est remplacé par le premier rôle restant qui n'est PAS
//     'SUPER ADMIN'. Un compte historique peut porter SUPER ADMIN en rôle secondaire
//     (exemption de cad45ad) alors qu'aucune case SUPER ADMIN n'existe à l'écran : sans
//     cette règle, décocher le principal promouvait SUPER ADMIN en principal en gardant
//     le site du compte ;
//  4. si le principal est décoché et qu'il ne reste que 'SUPER ADMIN', le clic est refusé
//     (le formulaire n'afficherait plus aucune case cochée).
// Sans SUPER ADMIN dans les rôles, le résultat est identique à l'ancien calcul inline.
// Protection écran seulement : le main (updateUser) n'est pas modifié ici.
// ============================================================================

export const ROLE_REQUIRED_MESSAGE = 'Au moins un rôle est requis.';
export const ROLE_VISIBLE_REQUIRED_MESSAGE =
  'Au moins un rôle autre que Super Admin est requis : cochez un autre rôle avant de décocher celui-ci.';

export type RoleToggleResult =
  | { ok: true; roles: string[]; role: string }
  | { ok: false; error: string };

/**
 * Calcule les rôles et le rôle principal après un clic sur la case `role`.
 * Ne modifie pas `currentRoles` (copie interne).
 */
export function computeRoleToggle(currentRoles: readonly string[], currentPrimary: string, role: string): RoleToggleResult {
  const roles = [...currentRoles];
  const index = roles.indexOf(role);
  if (index > -1) {
    if (roles.length <= 1) {
      return { ok: false, error: ROLE_REQUIRED_MESSAGE };
    }
    roles.splice(index, 1);
  } else {
    roles.push(role);
  }

  if (roles.includes(currentPrimary)) {
    return { ok: true, roles, role: currentPrimary };
  }

  const replacement = roles.find(r => r !== 'SUPER ADMIN');
  if (replacement === undefined) {
    return { ok: false, error: ROLE_VISIBLE_REQUIRED_MESSAGE };
  }
  return { ok: true, roles, role: replacement };
}
