---
name: modal-adaptatif-terrain
description: Gabarit de structure pour tout modal/formulaire de GEST-IN-SITU (overlay/header fixe/body déroulant/footer fixe), adapté aux petites résolutions terrain (1366x768), et les points de vérification correspondants côté audit. À charger par agent-2-designer pour concevoir ou modifier un modal, ou par agent-9-senior-auditor pour vérifier l'ergonomie d'un modal existant contre ce même gabarit.
---

# Gabarit de modal adaptatif terrain — GEST-IN-SITU

Un seul gabarit de référence, utilisé à la fois pour concevoir
(`agent-2-designer`) et pour auditer (`agent-9-senior-auditor`) — évite
qu'un modal soit conçu selon une règle et vérifié selon une autre.

## Architecture obligatoire (4 zones)

- **Overlay / Backdrop** : centré avec marge de sécurité (`max-h-[90vh]`,
  `overflow-y-auto` sur le conteneur global).
- **Header (fixe)** : titre clair, badge de statut et bouton de fermeture
  toujours visibles en haut, jamais scrollés hors champ.
- **Body (déroulant)** : contenu principal avec défilement interne fluide
  (`overflow-y-auto`), pour éviter que le modal ne dépasse de l'écran sur
  les petites résolutions terrain (1366x768).
- **Footer (fixe)** : boutons d'action (*Valider*, *Annuler*) ancrés en bas
  et **jamais coupés** — c'est le point de rupture le plus fréquent sur
  petit écran si le footer n'est pas explicitement sorti du flux
  scrollable.

## Mise en valeur des données critiques terrain

Les informations vitales pour l'agent sur le terrain (Code de Rangement,
Numéro de Fiche, Preuve de Retrait, Statut de Carte) doivent bénéficier
d'une typographie très marquée, de contrastes élevés et de badges colorés
d'identification immédiate — cohérent avec la charte "Plein Soleil"
(contrastes forts, jaune/noir/slate sombre, badges de statut distinctifs).

## Contrainte RAM 8 Go

Micro-animations légères et transitions CSS optimisées uniquement — aucune
animation lourde qui risquerait de ralentir les machines de terrain.

## Points de vérification côté audit (`agent-9-senior-auditor`)

Sur toute page contenant un modal, à 1366x768 :
- Aucun bouton d'action n'est coupé ou hors-champ (Header fixe, Body
  défilant `overflow-y-auto`, Footer fixe — les 3 zones respectées).
- Les statuts de carte (ex: `DELIVRE`) déclenchent des vues informatives
  complètes (modal de preuve de retrait avec date, heure, agent, retirant,
  contact) — pas une information partielle qui obligerait l'agent à
  chercher ailleurs.
- Aucun freeze d'UI, chargement bloquant ou comportement contre-intuitif
  à l'ouverture/fermeture du modal.

## Règle "STOP & WARN" spécifique

Si un ajustement de modal exige de modifier un fichier de style partagé
(`assets/styles/modules/` ou variables CSS globales) plutôt que le
composant/vue spécifié : ne rien modifier d'abord, avertir l'utilisateur de
l'impact prévu sur les autres pages en production, et consigner l'alerte
dans le rapport final (cf. `CLAUDE.md` §4).
