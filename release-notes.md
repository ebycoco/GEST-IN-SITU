# GEST-IN-SITU — Prochaine version (non publiée)

### 🚨 Sécurité

- **Canal IPC `export:marquerExporte` sans contrôle d'accès** : contrairement à ses 4 canaux frères (`export:csv/excel/pdf/getRows`), il ne passait par aucun contrôle de rôle ni de cantonnement site. Aligné sur `assertExportAccess()` — canal confirmé inutilisé côté interface à ce jour, corrigé par cohérence et défense en profondeur.

### 🛠️ Corrections & Fiabilité

- **Filtres d'anomalie de la Centrale d'Exportation inopérants** : "Anomalie : Sans Rangement physique" et "Sans numéro de Sécurité Sociale" ciblaient des valeurs de statut qui n'existent pas dans le schéma de la base — l'export retournait donc toujours "aucune donnée" pour ces deux filtres, masquant silencieusement les vraies anomalies terrain. Appliquent désormais les mêmes conditions que les vues d'anomalies équivalentes.
- **Filtre "Rangement ciblé" de l'export ignoré** : accepté par l'interface mais jamais appliqué à la requête — un export "ciblé sur une boîte" exportait en réalité toute la base filtrée par statut seul. Corrigé.
- **Export en mode incrémental ("nouveautés uniquement") faisant systématiquement échouer l'export à l'écran** : le marquage interne des cartes déjà exportées plantait (identifiant de carte manquant dans la requête), alors que le fichier CSV/Excel/PDF avait déjà été généré avec succès sur le disque juste avant. L'utilisateur croyait son export raté et pouvait le relancer inutilement.
- **`cle_doublon`/`cle_doublon_flex` non recalculées après une correction Qualité de la date de naissance** sur une carte déjà en base — risquait de fausser la détection de doublons lors d'une fusion entre sites. Recalculées désormais, dans la même transaction que la correction.
- **Marquage "nouveautés déjà exportées" sans propagation automatique entre postes d'un même site** : ne suivait pas le circuit standard de synchronisation d'une mutation de carte (seul un envoi manuel en masse le propageait). Suit désormais ce circuit, avec traçabilité dans l'historique.
- **Export ciblé par rangement sur la page Cartes préservé** : le nouveau filtre exact de la Centrale d'Exportation aurait pu vider silencieusement cet export historique, qui utilise un filtre texte libre partiel — comportement d'origine conservé sur cette page.
- **Recherche de rangements pour un Super Administrateur sans site actif sélectionné** : échouait silencieusement (aucun message, liste vide en permanence). Corrigé.
- Précision du texte d'information sur la garantie anti-doublon de l'export : s'applique aux formats CSV/Excel, pas au PDF (document d'émargement imprimable).

### ⚡ Performances

- **Génération des exports CSV et Excel volumineux rendue non-bloquante** (écriture disque asynchrone, remplissage du classeur Excel par lots) : évite un gel de l'application sur un export "Toute la base" conséquent, en particulier sur les postes terrain à 8 Go de RAM.
