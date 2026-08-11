; ─────────────────────────────────────────────────────────────────────────
; GEST-IN-SITU — Script NSIS personnalisé (electron-builder `nsis.include`)
;
; Contexte : la mise à jour de l'application est désormais déclenchée
; automatiquement à la fermeture (installeur oneClick, non silencieux,
; visible pendant la copie des fichiers — voir src/main/auto-updater.ts).
; Filet de sécurité : empêcher un agent terrain de fermer manuellement la
; fenêtre de l'installeur (bouton système [X]) pendant la copie des
; fichiers (page MUI_PAGE_INSTFILES), ce qui laisserait l'installation
; GEST-IN-SITU dans un état partiel/corrompu sur le poste.
;
; Technique standard NSIS (documentée, aucune dépendance à un plugin tiers
; — System::Call est fourni nativement par NSIS) :
;   1. Sur l'affichage (MUI_PAGE_CUSTOMFUNCTION_SHOW) de la page de copie,
;      on récupère le menu système de la fenêtre installeur (GetSystemMenu)
;      et on grise l'entrée "Fermer" (SC_CLOSE = 0xF060) via EnableMenuItem
;      avec le flag MF_GRAYED.
;   2. Sur la sortie de la page (MUI_PAGE_CUSTOMFUNCTION_LEAVE), on
;      réactive l'entrée pour ne pas impacter les pages suivantes.
;
; Portée : ces défines s'appliquent uniquement à la/les page(s)
; MUI_PAGE_INSTFILES / MUI_UNPAGE_INSTFILES insérées par les templates
; electron-builder (oneClick.nsh) — aucune autre page n'est concernée, NSIS
; MUI2 dé-définit MUI_PAGE_CUSTOMFUNCTION_SHOW/LEAVE après consommation.
;
; ⚠️ Ce script n'a volontairement PAS été testé par une compilation réelle
; (npm run build/build:win interdit sans instruction explicite de
; l'utilisateur — voir CLAUDE.md §1). Un build de test est requis avant
; toute diffusion large sur le parc terrain.
; ─────────────────────────────────────────────────────────────────────────

!define SC_CLOSE 0xF060
!define MF_BYCOMMAND 0x00000000
!define MF_GRAYED 0x00000001
!define MF_ENABLED 0x00000000

!define MUI_PAGE_CUSTOMFUNCTION_SHOW GestInSitu_InstFilesShow
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE GestInSitu_InstFilesLeave

Function GestInSitu_InstFilesShow
  ; Grise le bouton [X] de la fenêtre installeur pendant la copie des fichiers
  System::Call 'user32::GetSystemMenu(i $HWNDPARENT, i 0) i .r0'
  System::Call 'user32::EnableMenuItem(i r0, i ${SC_CLOSE}, i ${MF_BYCOMMAND}|${MF_GRAYED})'
FunctionEnd

Function GestInSitu_InstFilesLeave
  ; Réactive le bouton [X] une fois la copie terminée (n'affecte pas la
  ; page de copie elle-même, seulement les pages suivantes le cas échéant)
  System::Call 'user32::GetSystemMenu(i $HWNDPARENT, i 0) i .r0'
  System::Call 'user32::EnableMenuItem(i r0, i ${SC_CLOSE}, i ${MF_BYCOMMAND}|${MF_ENABLED})'
FunctionEnd
