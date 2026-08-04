# GEST-IN-SITU — Release v2.11.1

> **Date de publication :** 4 août 2026
> **Statut :** Production — Postes opérationnels en Côte d'Ivoire
> **SCHEMA_VERSION :** 62 (inchangé depuis v2.11.0 — aucune migration BDD requise)

## 🔴 Corrections critiques (P0)

- **Rôle actif non synchronisé avec le serveur pour les comptes multi-rôles** : sur un compte cumulant plusieurs rôles (ex. `ADMIN_CENTRE` + `OPERATEUR_VERIFICATION`), le choix d'un rôle sur l'écran de sélection ne mettait à jour que l'affichage côté client — le serveur continuait d'appliquer les règles de cantonnement du rôle de connexion pour toute la session. Un agent basculé en Vérification alors que son rôle de connexion était `ADMIN_CENTRE` voyait ses statistiques, listes d'agents, journaux d'audit et tirages d'agents bridés à tort au périmètre de son seul centre au lieu du site entier. Corrigé par un nouveau canal serveur qui revalide le rôle demandé par rapport aux rôles réellement attribués au compte avant de synchroniser la session ; aucune fuite inter-site possible dans l'ancien comme le nouveau comportement, le site et le centre restant toujours attachés au compte, jamais au rôle choisi.
