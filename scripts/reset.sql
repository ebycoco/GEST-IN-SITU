DELETE FROM t_cartes;
DELETE FROM t_import_temp;
DELETE FROM t_sync_queue;
DELETE FROM t_logs;
DELETE FROM t_users WHERE role != 'SUPER ADMIN';
VACUUM;
