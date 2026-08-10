# GEST-IN-SITU — Release v2.12.0

> **Date de publication :** 10 août 2026
> **Statut :** Production — Postes opérationnels en Côte d'Ivoire
> **SCHEMA_VERSION :** 62 (inchangé — aucune migration BDD requise)

## 🔴 Corrections critiques (P0)

- **Fuite de données inter-sites sur le Monitoring Synchronisation** : le tableau des anomalies (`t_logs`) de la page `/sync/status` n'appliquait aucun filtrage `site_id` côté serveur — un ADMINISTRATEUR_SITE pouvait consulter les logs de synchronisation d'un autre site (le SUPER ADMIN conserve légitimement sa vue globale sur l'ensemble des sites). Corrigé.
- **Fuite intra-site sur le Portail de Saisie** : un opérateur de saisie pouvait, via un appel IPC forgé, consulter les brouillons d'un autre agent du même site — le serveur ne réimposait pas l'identité réelle de la session. Corrigé.
- **Risque de corruption SQLite en production (`SQLITE_CORRUPT_VTAB`) sur le Centre de Migration** : un enchaînement Réparation d'urgence + Purge pouvait provoquer une corruption transitoire de la base, causée par un `VACUUM` non synchronisé combiné à une reconstruction complète de l'index de recherche (FTS5) pendant la réparation d'urgence. Corrigé par un `VACUUM` désormais synchrone et une purge incrémentale de l'index ; effet de bord corrigé au passage — l'ancien code effaçait aussi l'index de recherche des **autres sites** lors d'une réparation d'urgence.
- **Risque métier — perte silencieuse du statut "Délivrée" sur le Portail de Saisie** : une correction mineure (ex. rangement) sur une carte déjà délivrée mais pas encore synchronisée la faisait repasser silencieusement au statut "En Stock" — risque de double-délivrance et d'incohérence d'inventaire physique sur le terrain. Corrigé : le statut d'une carte n'est désormais plus jamais écrasé lors d'une simple correction de champ.
- **Corbeille de suppression de ligne inopérante à l'aperçu d'import (Centre de Migration)** : exclure une ligne à l'aperçu ne l'excluait pas réellement de l'import — la carte était tout de même importée. L'exclusion est désormais effective jusqu'au moteur d'import.
- **Brouillon sans date de naissance impossible à sauvegarder (Portail de Saisie)** : le serveur exigeait une date de naissance même en mode brouillon, alors que l'interface promet explicitement que les informations manquantes sont tolérées à ce stade. Corrigé — en contrepartie, un brouillon à date invalide ou manquante ne peut désormais plus être promu en "En Stock" sans être revalidé au préalable : il reste en brouillon et l'agent est averti du nombre ignoré lors d'une promotion en masse.
- **Page "Mes Brouillons" bloquée indéfiniment sur "Chargement en cours..." (Portail de Saisie)** : le site actif de l'agent n'était jamais résolu correctement pour ce rôle. Corrigé.
- **Écran de Monitoring Synchronisation pouvant rester figé indéfiniment** derrière l'écran de chargement global si un SUPER ADMIN y naviguait avant la fin du chargement initial du Tableau de bord — corrigé.
- **Filtres Agent et Date du "Pilotage des Activités de Terrain" sans aucun effet** sur le Tableau de bord (seul le filtre Centre fonctionnait réellement) — corrigé.

## 🟠 Corrections importantes (P1)

- Logs de type Avertissement/Limite (`WARN`/`WARNING`/`LIMIT`) jamais affichés dans le tableau du Monitoring Synchronisation — corrigé.
- Message trompeur "Synchronisation terminée avec des avertissements" affiché même quand la synchronisation n'avait jamais démarré (cas hors-ligne) — affiche désormais le véritable message d'échec.
- Détection des "doublons probables" à l'import structurellement inopérante — corrigée.
- Compteur de cartes locales du Centre de Migration non filtré par site (activait/désactivait à tort le bouton de purge) — corrigé.
- Texte de la modale de réparation d'urgence incomplet : ne mentionnait pas la suppression des cartes locales qu'elle effectue réellement — rendu honnête.
- Message de doublon strict affiché de façon générique au lieu du message spécifique sur le Portail de Saisie — corrigé.
- Bouton "Télécharger depuis le Cloud" non désactivé hors-ligne sur le Portail de Saisie, incohérence avec les autres portails déjà corrigés — corrigé.

## 🟡 Optimisations & fiabilité (P2)

- Alias d'en-tête CSV "N° SECU" (sans accent) manquant à l'import, colonne silencieusement vide — ajouté. Libellé "Rejetées/Erreurs" ambigu clarifié en "Anomalies Signalées".
- Toasts de rafraîchissement pouvant s'empiler sur clics rapprochés (Monitoring Synchronisation) — corrigé.

## 🧹 Nettoyage

- Retrait de la fonctionnalité "Auditer les Dates Invalides" du Tableau de bord (bouton, traitement backend, exposition associée) — retrait demandé explicitement, fonctionnalité totalement supprimée sans remplacement.
- Retrait d'un bloc de code mort ("Synchronisation Cloud — Centre") et de branches conditionnelles associées au rôle ADMIN_CENTRE sur le Tableau de bord, confirmé inatteignable sur cette page (ce rôle dispose de son propre portail dédié).

## ℹ️ Mise à jour automatique

Cette release est distribuée via le système d'auto-update Electron.
Les postes connectés recevront la notification de mise à jour automatiquement.
**Aucune action manuelle n'est requise sur les centres en production.**
