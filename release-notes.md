## GEST-IN-SITU v2.6.0 — Notes de Version

**Date de publication :** 20 Juillet 2026  
**Type de release :** Mineure (MINOR)  
**Validé par :** Agent 12 (Validateur QA) ✅

---

### ✨ Nouvelles Fonctionnalités

- **Splash Screen de démarrage :** Une fenêtre légère et élégante s'affiche instantanément au lancement de l'application, éliminant définitivement les écrans noirs d'attente lors du démarrage et des mises à jour.
- **Système de chargement global sécurisé :** Overlay animé (spinner "Plein Soleil") avec verrouillage temporaire de la navigation pendant les chargements initiaux pour éviter toute race condition et navigation anarchique.
- **Skeleton Loading (Opérateur & Admin Site) :** Les tableaux de bord affichent des indicateurs de chargement animés (cartes skeleton) plutôt que des zéros trompeurs pendant la récupération des statistiques.

---

### ⚡ Optimisations de Performance

- **Stratégie Cache-First (RAM Shield) :** Navigation instantanée sur toutes les pages déjà visitées — les données en cache (`useCacheStore`) sont servies immédiatement sans solliciter SQLite, avec libération immédiate du verrou de la Sidebar.
- **Chargements SQLite exclusivement au premier accès :** Les modules Qualité, Retraits, Importation, Sites et tous les dashboards ne rechargent la base de données que lors d'un vrai premier chargement ou d'un rafraîchissement explicite.

---

### 🐛 Correctifs

- **Auto-healing SQLite :** Détection et correction automatique des colonnes manquantes au démarrage (`lieu`, `prefixe_rangement` dans `t_centres`).
- **Synchronisation Supabase :** Le champ `lieu` des centres est maintenant correctement inclus lors des upserts vers Supabase.
- **Z-Index des modales :** Les fenêtres modales s'affichent correctement au-dessus de tous les overlays (`z-index: 110000`).
- **Isolation multi-sites :** Les données d'import et de correction qualité sont strictement filtrées par `site_id`.

---

### 📦 Installation / Mise à jour

- **Nouvelle installation :** Télécharger `GEST-IN-SITU-Setup-v2.6.0.exe` et exécuter l'installateur.
- **Mise à jour automatique :** L'application se met à jour silencieusement en arrière-plan via `electron-updater`. Un Splash Screen de mise à jour s'affiche pendant l'application des fichiers, puis l'application redémarre automatiquement.

---

> _GEST-IN-SITU — Application de gestion logistique des cartes CMU — © Ebychoco 2026_
