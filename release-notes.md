# GEST-IN-SITU — Release v2.26.0 (2026-11-01)

## 🚨 Sécurité
- **Compte « superadmin » par défaut neutralisé** : le compte local au mot de passe d'origine est désactivé automatiquement au démarrage (et créé désactivé sur un poste neuf). Utilisez un compte SUPER ADMIN personnel. L'importation technique de base n'accepte plus que le mot de passe d'un SUPER ADMIN actif et synchronisé avec le cloud.
- **Limite de tentatives** : la connexion et l'importation de base sont bloquées 5 minutes après 5 mots de passe erronés. Tous les écrans concernés (connexion, confirmation par mot de passe, purges, réinitialisations, gestion des sites) affichent en clair « Trop de tentatives… Réessayez dans N minute(s) ».
- **Compte de secours ROOT renforcé** : il n'utilise plus de mot de passe en clair ; il est vérifié par une empreinte chiffrée intégrée à l'installeur et reste protégé par le verrou anti-tentatives. Il fonctionne désormais aussi sur les postes installés. Sur un poste neuf, un premier démarrage avec accès Internet est nécessaire.
- **Secrets retirés du code** : anciens codes d'accès et mots de passe de repli supprimés, fichiers de notes et journaux de dépannage sortis du dépôt.
- **Création de SUPER ADMIN sécurisée** : l'ancienne création de SUPER ADMIN sans connexion est supprimée. Seul le compte ROOT peut créer un SUPER ADMIN. Les comptes d'un autre niveau ne voient plus les boutons de gestion d'un compte qui détient aussi le rôle SUPER ADMIN.
- **Mots de passe des administrateurs mieux protégés** : seul ROOT peut poser ou réinitialiser le mot de passe d'un SUPER ADMIN, y compris via la modification d'un agent. Une confirmation renforcée par mot de passe est demandée avant de toucher à un SUPER ADMIN.

## 🚀 Nouveautés & Ergonomie
- **Réinitialisation des mots de passe des administrateurs** : ROOT peut réinitialiser le mot de passe d'un SUPER ADMIN et d'un Administrateur de site (de n'importe quel site). Un SUPER ADMIN peut réinitialiser celui d'un Administrateur de site.
- **Page Agents** : le compte ROOT dispose d'un bouton « Créer un SUPER ADMIN » (identifiant, nom, mot de passe d'au moins 12 caractères, confirmation par le mot de passe ROOT).
- **À savoir** : un SUPER ADMIN créé ou réinitialisé par ROOT n'apparaît sur les autres postes qu'après le redémarrage de l'application sur ces postes.

## 🛠️ Corrections & Fiabilité
- **Confirmation par mot de passe** : quand le verrou anti-tentatives est actif, la fenêtre de confirmation affiche le message d'attente au lieu de « Mot de passe incorrect » ; les réinitialisations successives n'empilent plus les notifications de mot de passe temporaire (la plus récente remplace la précédente) ; la création d'un SUPER ADMIN laisse une trace dans le journal d'audit.
- **ROOT peut de nouveau confirmer une action sensible par son mot de passe** (réinitialisation du mot de passe d'un agent ou d'un SUPER ADMIN) : la confirmation refusait le bon mot de passe ROOT.
- **Poste démarré hors ligne sans compte actif** : le rapatriement des comptes se relance tout seul au retour du réseau, jusqu'à réussir (nouvel essai espacé progressivement jusqu'à 10 minutes si la tentative a échoué).
- **Compilation de l'installeur** : la fabrication d'un installeur s'arrête avec un message clair si la configuration est incomplète, au lieu de produire un installeur sans synchronisation et sans compte de secours.
