# GEST-IN-SITU — Prochaine version (non publiée)

## 🚨 Sécurité
- **Compte « superadmin » par défaut neutralisé** : le compte local au mot de passe d'origine est désactivé automatiquement au démarrage (et créé désactivé sur un poste neuf). L'importation technique de base n'accepte plus que le mot de passe d'un SUPER ADMIN actif et synchronisé avec le cloud.
- **Limite de tentatives** : la connexion et l'importation de base sont bloquées 5 minutes après 5 mots de passe erronés. L'écran de connexion affiche en clair le délai d'attente.

- **Compte de secours ROOT par empreinte chiffrée** : il n'utilise plus de mot de passe en clair ; il est vérifié par une empreinte bcrypt intégrée à l'installeur (générée avec `node scripts/set-root-password.mjs`) et reste protégé par le verrou anti-tentatives. Il fonctionne désormais aussi sur les postes installés une fois l'empreinte définie avant la compilation.
- **Secrets retirés du code** : code d'authentification Supabase inutilisé et ses mots de passe de repli supprimés, mots de passe retirés de l'installeur, fichiers de notes et scripts de dépannage sortis de Git.

- **Réinitialisation des mots de passe des administrateurs** : le compte de secours ROOT peut désormais réinitialiser le mot de passe d'un Super Admin ou d'un Administrateur de site (de n'importe quel site). Un Super Admin peut réinitialiser celui d'un Administrateur de site ; il ne peut plus réinitialiser celui d'un autre Super Admin (réservé à ROOT). Une confirmation renforcée avec mot de passe est demandée avant de toucher à un Super Admin.

## 🛠️ Corrections & Fiabilité
- **Poste démarré hors ligne sans compte actif** : le rapatriement des comptes se relance tout seul au retour du réseau, jusqu'à réussir (y compris quand le réseau reste stable après une tentative manquée : nouvel essai différé, espacé progressivement jusqu'à 10 minutes).
