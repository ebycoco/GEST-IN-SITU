/**
 * e2e/fixtures/test-users.ts
 *
 * Définition déclarative des comptes de test utilisés par la suite E2E.
 *
 * ── Portée ────────────────────────────────────────────────────────────────
 * Ce module est importé à la fois :
 *  - par `seed-database.ts` (exécuté dans le contexte Node "façon Electron",
 *    voir seed-runner.ts) pour insérer les utilisateurs en base,
 *  - par les specs Playwright (exécutées sous Node standard) pour récupérer
 *    le login/mot de passe en clair au moment de remplir le formulaire.
 *
 * `bcryptjs` est une implémentation 100% JavaScript (pas de binding natif),
 * contrairement à `better-sqlite3` : ce module peut donc être importé et
 * exécuté indifféremment sous Node standard ou sous le runtime Node
 * d'Electron, sans problème d'ABI (NODE_MODULE_VERSION). Voir seed-runner.ts
 * pour le détail du problème d'ABI rencontré avec better-sqlite3.
 *
 * Tous les logins sont préfixés `E2E_` pour ne jamais entrer en collision
 * avec des comptes réels, et pour être trivialement identifiables/purgeables
 * dans n'importe quel export de diagnostic.
 */
import { hashPassword } from '../../src/main/auth/local-auth';

export type E2ERole =
  | 'SUPER ADMIN'
  | 'ADMINISTRATEUR_SITE'
  | 'ADMIN_CENTRE'
  | 'OPERATEUR_VERIFICATION'
  | 'OPERATEUR_QUALITE'
  | 'OPERATEUR_SAISIE'
  | 'OPERATEUR_LOGISTIQUE'
  | 'OPERATEUR_INVENTAIRE';

export interface E2ETestUser {
  /** Identifiant unique du compte, utilisé dans les specs pour le retrouver. */
  key: string;
  login: string;
  /** Mot de passe en clair — utilisé uniquement par les specs pour remplir le formulaire. */
  password: string;
  /** Hash bcrypt du mot de passe ci-dessus — utilisé uniquement par le seed pour l'insertion SQL. */
  passwordHash: string;
  role: E2ERole;
  nom: string;
  prenom: string;
  /**
   * Si true, l'utilisateur est rattaché uniquement au site de test (centre_id NULL),
   * conformément au comportement réel des ADMINISTRATEUR_SITE (voir
   * authenticateUser() dans users.queries.ts qui leur assigne dynamiquement
   * le premier centre du site à la connexion).
   */
  siteOnly?: boolean;
}

/**
 * Premier incrément (Étape 1 du plan E2E) : couverture minimale
 * OPERATEUR_VERIFICATION + un rôle admin (ADMINISTRATEUR_SITE).
 * L'extension aux autres rôles réels (voir RoleRedirect.tsx) est prévue
 * pour les incréments suivants, non traités ici.
 */
export const TEST_USERS: E2ETestUser[] = [
  {
    key: 'operateurVerification',
    login: 'E2E_OPERATEUR_VERIFICATION',
    password: 'E2E_Test_Pwd_2026!',
    passwordHash: hashPassword('E2E_Test_Pwd_2026!'),
    role: 'OPERATEUR_VERIFICATION',
    nom: 'E2E',
    prenom: 'Verification'
  },
  {
    key: 'administrateurSite',
    login: 'E2E_ADMINISTRATEUR_SITE',
    password: 'E2E_Test_Pwd_2026!',
    passwordHash: hashPassword('E2E_Test_Pwd_2026!'),
    role: 'ADMINISTRATEUR_SITE',
    nom: 'E2E',
    prenom: 'AdminSite',
    siteOnly: true
  },
  // Ajouté pour la couverture QA Terrain (agent-13) du portail /agent-qualite
  // (OPERATEUR_QUALITE) — même schéma que operateurVerification (rattaché au
  // centre du site de test, pas siteOnly).
  {
    key: 'operateurQualite',
    login: 'E2E_OPERATEUR_QUALITE',
    password: 'E2E_Test_Pwd_2026!',
    passwordHash: hashPassword('E2E_Test_Pwd_2026!'),
    role: 'OPERATEUR_QUALITE',
    nom: 'E2E',
    prenom: 'Qualite'
  }
];

export function getTestUser(key: string): E2ETestUser {
  const user = TEST_USERS.find((u) => u.key === key);
  if (!user) throw new Error(`[E2E] Utilisateur de test introuvable pour la clé "${key}"`);
  return user;
}
