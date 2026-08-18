# GEST-IN-SITU

Application desktop offline-first pour la gestion du cycle de vie des cartes CMU (Couverture Maladie Universelle) : saisie, vérification, délivrance, apurement et suivi qualité, avec synchronisation cloud résiliente.

## Aperçu

- **Offline-first** : fonctionne sans connexion réseau permanente, avec synchronisation automatique en arrière-plan dès que le réseau est disponible (téléchargement et envoi indépendamment réglables).
- **Multi-sites / multi-centres** : cloisonnement strict des données par site et par centre.
- **Cycle de vie complet de la carte** : saisie, contrôle qualité (doublons, données manquantes, formats invalides), vérification et délivrance, apurement du cahier d'émargement, suivi logistique et inventaire physique.
- **Import et export en masse** : import de lots de cartes avec détection de doublons, export des données.
- **Recherche avancée** : recherche plein texte (nom, prénom, date de naissance, lieu de naissance, contact) avec tolérance aux fautes de frappe et aux inversions nom/prénom.
- **Gestion des rôles** : plusieurs profils opérateurs (saisie, vérification, qualité, apurement, logistique, inventaire) et niveaux d'administration (centre, site, super administrateur), avec support des comptes multi-rôles.
- **Supervision** : tableaux de bord de synchronisation, suivi des retraits, présence des agents connectés, journal d'audit.
- **Auto-update** : mise à jour automatique des postes de terrain via GitHub Releases.

## Stack technique

- [Electron](https://www.electronjs.org/) + [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [SQLite](https://www.sqlite.org/) (stockage local, moteur `better-sqlite3`) avec recherche plein texte (FTS5)
- [Supabase](https://supabase.com/) (PostgreSQL) pour la synchronisation cloud
- [Vite](https://vitejs.dev/) / [electron-vite](https://electron-vite.org/) pour le build
- [Playwright](https://playwright.dev/) pour les tests de bout en bout

## Structure du projet

```
src/
  main/       # Processus principal Electron (base de données, synchronisation, handlers IPC)
  preload/    # Pont sécurisé entre le processus principal et le renderer
  renderer/   # Interface utilisateur (React)
  shared/     # Types et utilitaires partagés
e2e/          # Tests de bout en bout (Playwright)
```

## Développement

```bash
npm install
npm run dev
```

### Scripts utiles

| Commande | Description |
|---|---|
| `npm run dev` | Lance l'application en mode développement |
| `npm run lint` | Analyse statique du code |
| `npm test` | Tests unitaires |
| `npm run test:e2e` | Tests de bout en bout (Playwright) |

Le build de production (`build:win`) et la publication de release ne sont déclenchés que manuellement, en dehors du flux de développement courant.

## Configuration

L'application nécessite un fichier `.env` (non versionné) avec les identifiants de connexion à l'instance Supabase du projet. Voir l'équipe du projet pour obtenir les valeurs de configuration.

## Auteur

**EBYCHOCO** — [github.com/ebycoco](https://github.com/ebycoco)

## Licence

MIT — voir le champ `license` de `package.json`.
