DELETE FROM t_cartes;
DELETE FROM t_import_temp;
DELETE FROM t_cartes_fts;
DELETE FROM sqlite_sequence WHERE name='t_cartes';
DELETE FROM sqlite_sequence WHERE name='t_import_temp';
VACUUM;
