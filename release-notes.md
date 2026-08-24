# GEST-IN-SITU — Prochaine version (non publiée)

> **Statut :** brouillon cumulatif, alimenté à chaque commit depuis la dernière release (v2.18.0, 24 août 2026).
> Sera figé en `# GEST-IN-SITU — Release vX.Y.Z` par agent-11-release-manager au prochain `npm run build:win` (voir `CLAUDE.md` §8).

## 🛠️ Corrections & Fiabilité

- Suppression d'un site : les entrées de la file de synchronisation (outbox) des centres, agents et rôles rattachés au site supprimé sont désormais correctement nettoyées, évitant qu'ils ne soient recréés côté cloud lors de la prochaine synchronisation.
