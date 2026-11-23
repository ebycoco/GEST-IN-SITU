# Maquettes mobile v1 — notes (étape E1, 2026-11-23)

Fichier : `maquettes_v1.html` (statique, aucun script, aucune ressource externe, données fictives).
Rôle : `OPERATEUR_VERIFICATION`. Plan de référence : `docs/PLAN_MOBILE_V1.md`.

## Écrans livrés (cadres de 360 px)
1a-1d Connexion (normal, envoi, 401, catalogue 429 / 403 suspendu / 403 licence / hors-ligne / rôle non autorisé) ·
2a-2c Recherche (nom + date, téléphone, aucun résultat / hors-ligne) · 3 Résultats + légende des badges ·
4a-4d Fiche (EN STOCK, DÉLIVRÉE avec preuve, DOUBLON, variantes ABSENTE / PERDUE / hors centre / non classée) ·
5a-5d Délivrance (assuré, tiers, récapitulatif, envoi en cours) · 6a-6c Résultat (succès, refus + textes par code, résultat inconnu) ·
7 Verrou d'inactivité.

## Structure commune
- Barre du haut fixe (fond nuit `#0a0e27`, liseré jaune) : ligne 1 « GEST-IN-SITU » + **Se déconnecter** (toujours visible, Q4) ; ligne 2 retour + titre.
- Corps défilant, pied fixe avec les boutons d'action (zone du pouce) — même principe que le gabarit des modaux terrain (`modal-adaptatif-terrain`).
- Une seule action principale par écran, en jaune Plein Soleil.

## Couleurs
| Usage | Couleur | Source |
|---|---|---|
| Bouton principal | fond `#FFE600`, texte `#000000` | `src/renderer/src/pages/VerificationSearchPage/index.tsx:365-367`, `AgentVerification/AgentVerificationLayout.tsx:205-207` (`.btn-plein-soleil`) |
| Barre du haut, verrou | `#0a0e27` / `#151a3d` | `src/renderer/src/assets/styles/modules/variables.css:3,5` |
| Texte clair sur nuit | `#e8eaf6` | `variables.css:26` |
| Corps de page | `#f1f5f9`, cartes `#ffffff`, texte `#0f172a` / `#334155` / `#475569` | choix mobile (voir ci-dessous) |
| EN STOCK / DÉLIVRÉE / DOUBLON / ABSENTE / PERDUE | `#065f46` / `#1e3a8a` / `#991b1b` / `#9a3412` / `#111827`, texte blanc | teintes de `SearchResults.tsx:312-326` assombries pour atteindre ≥ 7:1 |

**Choix à valider :** l'appli Windows est sombre ; le téléphone utilise un **corps clair** (texte noir sur blanc), plus lisible en plein soleil (reflets moindres), et garde la nuit + le jaune pour la barre, le rangement et les boutons. Seul le verrou est entièrement sombre, pour être reconnu d'un coup d'œil.

## Contrastes (calcul WCAG 2.x)
| Paire | Ratio | Niveau |
|---|---|---|
| `#000` sur `#FFE600` (bouton, rangement) | 16,57:1 | AAA |
| `#0f172a` sur `#ffffff` (texte principal) | 17,85:1 | AAA |
| `#0f172a` sur `#f1f5f9` | 16,30:1 | AAA |
| `#334155` sur `#ffffff` (texte secondaire) | 10,35:1 | AAA |
| `#475569` sur `#ffffff` (aides, indications de champ) | 7,58:1 | AAA |
| `#ffffff` sur `#0a0e27` (barre) | 19,00:1 | AAA |
| `#FFE600` sur `#0a0e27` (Se déconnecter, onglet actif) | 15,00:1 | AAA |
| blanc sur EN STOCK `#065f46` | 7,68:1 | AAA |
| blanc sur DÉLIVRÉE `#1e3a8a` | 10,36:1 | AAA |
| blanc sur DOUBLON `#991b1b` | 8,31:1 | AAA |
| blanc sur ABSENTE `#9a3412` | 7,31:1 | AAA |
| blanc sur PERDUE `#111827` | 17,74:1 | AAA |
| erreur `#7f1d1d` sur `#fef2f2` | ≥ 7,60:1 | AAA |
| alerte `#713f12` sur `#fef9c3` | 8,07:1 | AAA |
| info `#1e3a8a` sur `#dbeafe` | 8,49:1 | AAA |
| succès `#065f46` sur `#d1fae5` | 6,78:1 | AA (texte ≥ 16 px gras) |
| bouton désactivé `#1e293b` sur `#cbd5e1`/`#e2e8f0` | ≥ 9,85:1 | AAA |

Pour comparaison, le bouton violet de Windows (blanc sur `#6c63ff`) n'est qu'à 4,32:1 : il n'est pas repris.
Le statut n'est jamais porté par la couleur seule (symbole + mot : ✓ EN STOCK, ● DÉLIVRÉE, ⛔ DOUBLON, ⚠ ABSENTE, ✕ PERDUE).

## Tailles
- Texte courant 16-18 px, champs 19 px gras, titres 17-24 px ; rien sous 16 px pour le texte utile (13-14 px seulement pour les mentions secondaires de la maquette et les intitulés en capitales).
- Cibles tactiles : boutons 56 px (principal), 64 px (« Confirmer le retrait », « Vérifier »), secondaires 48 px, champs 56 px, onglets 56 px, choix du retirant 64 px.
- Rangement : 42 px gras sur fiche, 34 px sur récapitulatif, 16 px en pastille dans la liste.
- Police : Inter (comme Windows, `variables.css:65`) si présente, sinon police système — **aucun téléchargement de police**.

## Clavier (`inputmode`)
| Champ | Attributs |
|---|---|
| Date de naissance | `type="text" inputmode="numeric" maxlength="10"`, masque JJ/MM/AAAA (les « / » s'ajoutent seuls) |
| Téléphone (recherche, retirant) | `type="tel" inputmode="tel"`, préfixe « +225 » fixe, 10 chiffres groupés par 2, compteur « 9 / 10 » |
| Nom, rangement d'urgence | `type="text" autocapitalize="characters"` (majuscules, comme Windows) |
| Identifiant | `autocapitalize="none" autocomplete="username"` |
| Mot de passe | `autocomplete="current-password"`, bouton « Voir » 48 px |

## Libellés repris de l'appli Windows
- Connexion : « Identifiant », « Mot de passe », « Entrez votre identifiant / mot de passe », « Se connecter », « Connexion... », « GESTION CARTES IN-SITU », « Système de Gestion des Cartes CMU » (`pages/LoginPage.tsx:356-357,424-458`) ; erreurs « Connexion échouée / Identifiant ou mot de passe incorrect » (`:285-286`), « Licence expirée » (`:302-303`), « Accès suspendu » (`:309-310`), « Connexion temporairement bloquée / Trop de tentatives… » (`:324-325`) ; « Hors-ligne » (`:392`).
- Recherche : « Nom & Prénoms * », « Ex: KOFFI KOFFI KAN », « Date de Naissance * », « JJ/MM/AAAA », « Numéro de Téléphone Ivoirien * », « +225 01 02 03 04 05 », « Rechercher la Carte », « Rechercher par Téléphone », « Effacer » (`VerificationSearchPage/components/SearchForm.tsx:95-226`). Onglets renommés « Nom + date de naissance » / « Téléphone » (demande E1 ; Windows : « Recherche par État Civil / par Téléphone », `:69,86`).
- Fiche : « Emplacement de rangement exact », « Avez-vous trouvé la carte physiquement dans le rangement ? », « Oui, j'ai la carte », « Vérification Physique », « Validation du Retrait » (`components/DeliveryModal.tsx:97,123,167,184`) ; « Aucun rangement renseigné pour cette carte » (`utils/rangementDisplay.ts:7`) ; « DÉCLARÉE PERDUE », « SIGNALÉE ABSENTE », « En cours de traitement par l'administration », texte doublon (`SearchResults.tsx:326,439,446`).
- Délivrance : « Bénéficiaire du retrait », « L'assuré lui-même », « Un tiers (Mandataire) », « Nom complet du retirant * », « NOM ET PRÉNOMS », « Contact téléphonique * », « RANGEMENT D'URGENCE OBLIGATOIRE (Carte sans rangement) », « Ex: C1-B4-P3 (Box/Colonne/Parapheur) » (`DeliveryModal.tsx:212-302`).
- Preuve : « Preuve de Retrait », « Détails de la transaction », « Date & Heure exactes », « Centre de distribution », « Agent distributeur », « Identité du Retirant », « Qualité du Retirant », « ASSURÉ LUI-MÊME » / « TIERS MANDATÉ », « Fermer » (`components/DeliveryProofModal.tsx:25,46-139`).
- Texte de succès : imposé par la demande E1.
- Textes nouveaux (pas d'équivalent Windows, à valider) : refus par code serveur (6b bis), « Résultat inconnu » (6c), verrou (7), « Accès réservé », « Carte hors de votre centre » (fiche), « Aucune carte trouvée ».

## Points à valider par l'utilisateur
1. **Corps clair** au lieu du fond sombre de Windows (barre et boutons gardent la charte).
2. **Téléphone de l'assuré pour « L'assuré lui-même »** : Q6 interdit d'afficher le numéro complet, donc le champ ne peut pas être pré-rempli en clair. Maquette : numéro masqué en lecture seule, le serveur réutilise le numéro enregistré ; lien « Saisir un autre numéro ». Implique que `fn_mobile_delivrer_carte` accepte un téléphone vide = numéro de la fiche (à arbitrer en E3).
3. **Contact du retirant dans la preuve (4b)** : masqué aussi (2 derniers chiffres) par cohérence avec Q6 — Windows l'affiche en entier.
4. **Verrou à 15 min** : re-saisie du mot de passe (maquette 7) ou déconnexion complète ?
5. **« Non, absente » / « doublon »** depuis le téléphone : absents de la v1 (non demandés). À confirmer.
6. **6c Résultat inconnu** : pas de bouton « Nouvelle recherche » tant que « Vérifier » n'a pas répondu (oblige à lever le doute).
7. **Envoi en cours** : « Se déconnecter » est grisé pendant l'envoi (quelques secondes) — exception à « toujours visible » (il reste visible, mais inactif).
8. Textes nouveaux listés ci-dessus (refus, verrou, hors centre, rôle non autorisé).

## Non vérifié
- Rendu sur un vrai téléphone en plein soleil (seulement calcul des contrastes et contrôle dans un navigateur de bureau).
- Présence de la police Inter sur les téléphones visés (sinon police système, Roboto sur Android).
- Durée « N min » du 429 : dépend du serveur (`gis-login`), affichée telle que renvoyée.
