# GEST-IN-SITU — Prochaine version (non publiée)

## 🚨 Sécurité
- **Compte « superadmin » par défaut neutralisé** : le compte local au mot de passe d'origine est désactivé automatiquement au démarrage (et créé désactivé sur un poste neuf). L'importation technique de base n'accepte plus que le mot de passe d'un SUPER ADMIN actif et synchronisé avec le cloud.
- **Limite de tentatives** : la connexion et l'importation de base sont bloquées 5 minutes après 5 mots de passe erronés. L'écran de connexion affiche en clair le délai d'attente.

- **Compte de secours ROOT par empreinte chiffrée** : il n'utilise plus de mot de passe en clair ; il est vérifié par une empreinte bcrypt intégrée à l'installeur (générée avec `node scripts/set-root-password.mjs`) et reste protégé par le verrou anti-tentatives. Il fonctionne désormais aussi sur les postes installés une fois l'empreinte définie avant la compilation.
- **Secrets retirés du code** : code d'authentification Supabase inutilisé et ses mots de passe de repli supprimés, mots de passe retirés de l'installeur, fichiers de notes et scripts de dépannage sortis de Git.

- **Création de Super Admin sécurisée** : suppression du canal `auth:registerSuperAdmin` (création de Super Admin sans session, qui rattachait le compte au site 1). Seul le compte ROOT peut désormais créer un Super Admin, depuis le bouton « Créer un SUPER ADMIN » de la page Agents, avec confirmation par son mot de passe ROOT. Les comptes d'un autre niveau ne voient plus les boutons de gestion d'un compte qui détient aussi le rôle Super Admin.
- **Réinitialisation des mots de passe des administrateurs** : le compte de secours ROOT peut désormais réinitialiser le mot de passe d'un Super Admin ou d'un Administrateur de site (de n'importe quel site). Un Super Admin peut réinitialiser celui d'un Administrateur de site ; il ne peut plus réinitialiser celui d'un autre Super Admin (réservé à ROOT). Une confirmation renforcée avec mot de passe est demandée avant de toucher à un Super Admin. Même règle via la modification d'un agent : seul ROOT peut poser un mot de passe sur un Super Admin autre que soi. **À savoir** : un Super Admin créé ou réinitialisé par ROOT n'arrive sur les autres postes qu'à leur prochain démarrage de l'application.
- **Garde-fou de compilation** : `npm run build:win` et `npm run release` s'arrêtent avec un message clair si le `.env` est incomplet (adresse ou clé Supabase absentes, empreinte ROOT absente ou mal écrite), au lieu de produire un installeur sans synchronisation et sans compte de secours. Une Release GitHub qui reconstruit l'installeur sans `.env` échouera désormais.

## 🚀 Nouveautés & Ergonomie
- **Page Agents** : le compte ROOT dispose d'un bouton « Créer un SUPER ADMIN » (identifiant, nom, mot de passe d'au moins 12 caractères, confirmation par le mot de passe ROOT).

## 🛠️ Corrections & Fiabilité
- **Verrou de confirmation du mot de passe dans tous les écrans** : les purges de la base locale et du cloud, la réinitialisation du mot de passe d'un site, le changement de statut d'un site et la gestion des sites affichent désormais « Trop de tentatives… Réessayez dans N minute(s) » au lieu d'une erreur générique ou technique.
- **Confirmation par mot de passe** : quand le verrou anti-tentatives est actif, la fenêtre de confirmation affiche « Trop de tentatives… Réessayez dans N minute(s) » au lieu de « Mot de passe incorrect » ; les réinitialisations successives n'empilent plus les notifications de mot de passe temporaire (la plus récente remplace la précédente) ; la création d'un Super Admin laisse une trace explicite dans le journal d'audit.
- **ROOT peut de nouveau confirmer une action sensible par son mot de passe** (réinitialisation du mot de passe d'un agent ou d'un Super Admin depuis l'interface) : la confirmation refusait le bon mot de passe ROOT.
- **Poste démarré hors ligne sans compte actif** : le rapatriement des comptes se relance tout seul au retour du réseau, jusqu'à réussir (y compris quand le réseau reste stable après une tentative manquée : nouvel essai différé, espacé progressivement jusqu'à 10 minutes).
