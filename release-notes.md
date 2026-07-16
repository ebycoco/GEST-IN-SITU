# GEST-IN-SITU v2.5.3

## Corrigé
- **Sync/Base de Données :** L'OutboxService traduit désormais correctement les colonnes `centre_id`, `site_id`, et `poste_id` (format SQLite) en `id_centre`, `id_site`, et `id_poste` avant de transmettre les données en temps réel au serveur Supabase. Fin des rejets de synchronisation (erreur `Could not find the 'centre_id' column of 't_cartes'`).
