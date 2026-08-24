# GEST-IN-SITU — Prochaine version (non publiée)

> **Statut :** brouillon cumulatif, alimenté à chaque commit depuis la dernière release (v2.18.0, 24 août 2026).
> Sera figé en `# GEST-IN-SITU — Release vX.Y.Z` par agent-11-release-manager au prochain `npm run build:win` (voir `CLAUDE.md` §8).

## 🛠️ Corrections & Fiabilité

- Suppression d'un site : les entrées de la file de synchronisation (outbox) des centres, agents et rôles rattachés au site supprimé sont désormais correctement nettoyées, évitant qu'ils ne soient recréés côté cloud lors de la prochaine synchronisation.
- Suppression d'un site ou d'un centre : élimination d'une fenêtre de course avec la synchronisation en cours qui pouvait, dans de rares cas, laisser une entité supprimée localement réapparaître depuis le cloud lors d'une synchronisation ultérieure.
