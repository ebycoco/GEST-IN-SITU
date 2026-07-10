# Contraintes Système Globales & Sécurité Suprême

Ce document rassemble les verrous de sécurité fondamentaux à appliquer de façon transversale sur le projet GEST-IN-SITU.

---

## 1. Règle Anti-Build Automatique (Gouvernance Absolue)
> [!CAUTION]
> **INTERDICTION FORMELLE ET STRICTE DE COMPILATION AUTONOME**
> Aucun agent — en particulier l'Agent 0 (Chef d'Orchestre) et l'Agent 7 (Release Master) — n'est autorisé à exécuter la commande `npm run build`, `npm run make`, `electron-forge make`, ou tout script de compilation de sa propre initiative. Cette action est réservée exclusivement à une demande écrite et explicite du DG (Précieux).

---

## 2. Respect du Mode Asynchrone Low-Memory (RAM 8 Go)
> [!IMPORTANT]
> **OPTIMISATION DES RESSOURCES TERRAINS**
> L'application cible des parcs informatiques réels disposant de 8 Go de RAM.
> - **Interdiction d'écrire des boucles synchrones bloquantes** sur des volumes de données.
> - Utilisation de structures asynchrones segmentées (Yielders / Chunks de 500 max / `setImmediate` / `setTimeout`) pour préserver la réactivité de Windows.
> - Décharger systématiquement les états mémoire inutilisés et effectuer des nettoyages de cache locaux proactifs.

---

## 3. Isolation Territoriale & Sécurité Multi-Site
> [!IMPORTANT]
> **CLOISONNEMENT STRICT PAR SITE**
> Les données et notifications d'anomalies doivent être strictement isolées par identifiant de site (`site_id`/`id_site`).
> - Un consultant connecté sur un site donné ne doit recevoir aucune alerte ni notification concernant les anomalies d'un autre site.
> - La base de données et les requêtes doivent assurer ce cloisonnement pour respecter la sécurité territoriale (Mairie d'Abobo, etc.).
