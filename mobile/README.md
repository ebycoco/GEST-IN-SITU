# GEST-IN-SITU — client téléphone (v1)

Application web installable (PWA) réservée au rôle **OPERATEUR_VERIFICATION** : recherche d'une carte et enregistrement de son retrait, directement sur Supabase (fonctions `fn_mobile_rechercher_cartes` et `fn_mobile_delivrer_carte`). Connexion Internet obligatoire, aucune donnée de carte stockée sur le téléphone.

## Lancement local

Toutes les commandes se lancent **depuis `mobile/`** (jamais depuis la racine du dépôt) :

```bash
npm install
npx vite            # développement, http://localhost:5173
npx tsc --noEmit    # vérification des types
npx vitest run      # tests unitaires
npx vite build      # build dans mobile/dist (ignoré par git)
npx vite preview    # sert le build, http://localhost:4173
```

Les ports 5173 et 4173 sont ceux autorisés par défaut par la fonction `gis-login`.

## Variables

Copier `.env.example` en `.env.local` (ignoré par git) et renseigner :

| Variable | Rôle |
|---|---|
| `VITE_SUPABASE_URL` | URL du projet Supabase (https) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clé **publique** (publishable) — jamais la clé service_role |
| `VITE_GIS_LOGIN_URL` | Optionnel : URL de `gis-login` (par défaut `<URL>/functions/v1/gis-login`) |

## Consigne d'exploitation : téléphone partagé

Le téléphone peut passer d'un agent à l'autre. L'application demande au navigateur de ne pas pré-remplir le mot de passe, mais **aucun réglage d'une page web ne peut interdire à Chrome de proposer d'enregistrer un mot de passe**. Sur chaque téléphone, avant la mise en service :

1. Ouvrir **Chrome** → menu **⋮** → **Paramètres** → **Gestionnaire de mots de passe** (selon la version : **Mots de passe**) → **Paramètres**.
2. Désactiver **« Proposer d'enregistrer les mots de passe »**.
3. Désactiver **« Connexion automatique »**.
4. Si un mot de passe GEST-IN-SITU a déjà été enregistré : le supprimer de la liste.
5. Ne jamais répondre « Enregistrer » si Chrome le propose malgré tout.

Fermer la session (« Se déconnecter ») avant de remettre le téléphone à un autre agent. Après 15 minutes sans activité, l'écran se verrouille et le mot de passe est redemandé.

**Actualiser la page** (bouton ou geste « glisser vers le bas ») ne déconnecte plus : la session est gardée dans l'onglet (`sessionStorage`, jamais `localStorage`), effacée à la fermeture de l'onglet ou de l'appli, au verrou et à « Se déconnecter ». Le délai d'inactivité de 15 minutes reste respecté après une actualisation (l'heure de dernière activité est mémorisée avec la session). Contrepartie : tant que l'onglet est ouvert, le jeton de session est lisible dans les outils de développement du navigateur ; les cartes et résultats de recherche ne sont jamais stockés. Le geste « glisser vers le bas pour actualiser » de Chrome Android est désactivé (`overscroll-behavior-y`).
