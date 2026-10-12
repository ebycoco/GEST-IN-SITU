# GEST-IN-SITU — Prochaine version (non publiée)

### 🛠️ Corrections & Fiabilité

- **Synchronisation des comptes : les comptes ignorés sont désormais expliqués dans le journal** — quand un téléchargement des comptes laisse de côté un compte (modification locale en attente, envoi en cours, compte supprimé, ou ligne locale plus récente que la lecture cloud), le journal indique le login et la raison exacte, ce qui facilite le diagnostic sur le terrain. Aucun mot de passe n’est journalisé et le volume est plafonné.
