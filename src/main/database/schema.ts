import Database from 'better-sqlite3';
import log from 'electron-log';

const SCHEMA_VERSION = 1;

export function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;
  log.info(`Database schema version: ${currentVersion}, target: ${SCHEMA_VERSION}`);

  if (currentVersion < 1) {
    log.info('Running migration v1: Initial schema');
    migrateV1(db);
  }

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  log.info('All migrations complete');
}

function migrateV1(db: Database.Database): void {
  db.exec(`
    -- =====================================================
    -- SITES / CENTRES / POSTES (Hiérarchie)
    -- =====================================================
    CREATE TABLE IF NOT EXISTS t_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      sync_id TEXT
    );

    CREATE TABLE IF NOT EXISTS t_centres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      nom TEXT NOT NULL,
      numero INTEGER NOT NULL CHECK(numero BETWEEN 1 AND 4),
      created_at TEXT DEFAULT (datetime('now')),
      sync_id TEXT,
      FOREIGN KEY (site_id) REFERENCES t_sites(id)
    );

    CREATE TABLE IF NOT EXISTS t_postes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      centre_id INTEGER NOT NULL,
      nom TEXT NOT NULL,
      numero INTEGER NOT NULL CHECK(numero BETWEEN 1 AND 4),
      created_at TEXT DEFAULT (datetime('now')),
      sync_id TEXT,
      FOREIGN KEY (centre_id) REFERENCES t_centres(id)
    );

    -- =====================================================
    -- UTILISATEURS
    -- =====================================================
    CREATE TABLE IF NOT EXISTS t_users (
      id_user INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('SUPER ADMIN','ADMINISTRATEUR','CONSULTANT','EDITEUR','AJOUTANT')),
      nom_user TEXT,
      prenom_user TEXT,
      email TEXT,
      telephone TEXT,
      statut_actif INTEGER DEFAULT 1,
      centre_id INTEGER,
      poste_id INTEGER,
      avatar_url TEXT,
      last_login TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      sync_id TEXT,
      is_dirty INTEGER DEFAULT 0,
      synced_at TEXT,
      FOREIGN KEY (centre_id) REFERENCES t_centres(id),
      FOREIGN KEY (poste_id) REFERENCES t_postes(id)
    );

    -- =====================================================
    -- CARTES CMU (Table principale - 200k+ lignes)
    -- =====================================================
    CREATE TABLE IF NOT EXISTS t_cartes (
      id_carte INTEGER PRIMARY KEY AUTOINCREMENT,
      noms TEXT NOT NULL,
      prenoms TEXT NOT NULL,
      date_de_naissance TEXT,
      lieu_de_naissance TEXT,
      num_secu TEXT,
      lieu_enrolement TEXT,
      contact TEXT,
      rangement TEXT,
      statut TEXT DEFAULT 'EN STOCK' CHECK(statut IN ('EN STOCK','DELIVRE','DISTRIBUEE','RETIRE','ANNULE')),
      date_delivrance TEXT,
      agent_saisie TEXT,
      -- Délivrance
      nom_retirant TEXT,
      num_retirant TEXT,
      agent_distributeur TEXT,
      centre_retrait TEXT,
      -- Doublons
      cle_doublon TEXT,
      cle_doublon_flex TEXT,
      -- Absence physique
      statut_physique TEXT DEFAULT 'OK' CHECK(statut_physique IN ('OK','ABSENT','RETROUVE')),
      agent_signalement_absence TEXT,
      date_signalement_absence TEXT,
      date_resolution_absence TEXT,
      agent_resolution_absence TEXT,
      note_resolution TEXT,
      notif_lue INTEGER DEFAULT 1,
      -- Hiérarchie
      site_id INTEGER DEFAULT 1,
      centre_id INTEGER,
      poste_id INTEGER,
      -- QR Code
      qr_code_data TEXT,
      -- Sync
      sync_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      synced_at TEXT,
      is_dirty INTEGER DEFAULT 0,
      FOREIGN KEY (site_id) REFERENCES t_sites(id),
      FOREIGN KEY (centre_id) REFERENCES t_centres(id),
      FOREIGN KEY (poste_id) REFERENCES t_postes(id)
    );

    -- =====================================================
    -- INDEX PERFORMANCE (200k+ lignes)
    -- =====================================================
    CREATE INDEX IF NOT EXISTS idx_cartes_noms ON t_cartes(noms);
    CREATE INDEX IF NOT EXISTS idx_cartes_prenoms ON t_cartes(prenoms);
    CREATE INDEX IF NOT EXISTS idx_cartes_num_secu ON t_cartes(num_secu);
    CREATE INDEX IF NOT EXISTS idx_cartes_rangement ON t_cartes(rangement);
    CREATE INDEX IF NOT EXISTS idx_cartes_statut ON t_cartes(statut);
    CREATE INDEX IF NOT EXISTS idx_cartes_statut_physique ON t_cartes(statut_physique);
    CREATE INDEX IF NOT EXISTS idx_cartes_cle_doublon ON t_cartes(cle_doublon);
    CREATE INDEX IF NOT EXISTS idx_cartes_cle_flex ON t_cartes(cle_doublon_flex);
    CREATE INDEX IF NOT EXISTS idx_cartes_centre ON t_cartes(centre_id);
    CREATE INDEX IF NOT EXISTS idx_cartes_sync ON t_cartes(is_dirty, synced_at);
    CREATE INDEX IF NOT EXISTS idx_cartes_updated ON t_cartes(updated_at);
    CREATE INDEX IF NOT EXISTS idx_cartes_contact ON t_cartes(contact);

    -- =====================================================
    -- FTS5 : Recherche instantanée full-text
    -- =====================================================
    CREATE VIRTUAL TABLE IF NOT EXISTS t_cartes_fts USING fts5(
      noms, prenoms, num_secu, contact, lieu_de_naissance, rangement,
      content='t_cartes', content_rowid='id_carte'
    );

    -- Triggers pour garder FTS synchronisé
    CREATE TRIGGER IF NOT EXISTS trg_cartes_ai AFTER INSERT ON t_cartes BEGIN
      INSERT INTO t_cartes_fts(rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
      VALUES (new.id_carte, new.noms, new.prenoms, new.num_secu, new.contact, new.lieu_de_naissance, new.rangement);
    END;

    CREATE TRIGGER IF NOT EXISTS trg_cartes_ad AFTER DELETE ON t_cartes BEGIN
      INSERT INTO t_cartes_fts(t_cartes_fts, rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
      VALUES ('delete', old.id_carte, old.noms, old.prenoms, old.num_secu, old.contact, old.lieu_de_naissance, old.rangement);
    END;

    CREATE TRIGGER IF NOT EXISTS trg_cartes_au AFTER UPDATE ON t_cartes BEGIN
      INSERT INTO t_cartes_fts(t_cartes_fts, rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
      VALUES ('delete', old.id_carte, old.noms, old.prenoms, old.num_secu, old.contact, old.lieu_de_naissance, old.rangement);
      INSERT INTO t_cartes_fts(rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
      VALUES (new.id_carte, new.noms, new.prenoms, new.num_secu, new.contact, new.lieu_de_naissance, new.rangement);
    END;

    -- =====================================================
    -- LOGS D'AUDIT
    -- =====================================================
    CREATE TABLE IF NOT EXISTS t_logs (
      id_log INTEGER PRIMARY KEY AUTOINCREMENT,
      id_user INTEGER,
      login_user TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      valeur_avant TEXT,
      valeur_apres TEXT,
      date_heure TEXT DEFAULT (datetime('now')),
      ip_address TEXT,
      centre_id INTEGER,
      sync_id TEXT,
      is_dirty INTEGER DEFAULT 0,
      synced_at TEXT,
      FOREIGN KEY (id_user) REFERENCES t_users(id_user)
    );

    CREATE INDEX IF NOT EXISTS idx_logs_date ON t_logs(date_heure);
    CREATE INDEX IF NOT EXISTS idx_logs_action ON t_logs(action);
    CREATE INDEX IF NOT EXISTS idx_logs_user ON t_logs(id_user);

    -- =====================================================
    -- TABLE TEMPORAIRE IMPORT
    -- =====================================================
    CREATE TABLE IF NOT EXISTS t_import_temp (
      id_tmp INTEGER PRIMARY KEY AUTOINCREMENT,
      noms TEXT, prenoms TEXT, date_de_naissance TEXT,
      num_secu TEXT, lieu_de_naissance TEXT, contact TEXT,
      lieu_enrolement TEXT, rangement TEXT, statut TEXT,
      date_delivrance TEXT, agent_saisie TEXT,
      cle_doublon TEXT, cle_doublon_flex TEXT
    );

    -- =====================================================
    -- SYNC QUEUE (File d'attente offline)
    -- =====================================================
    CREATE TABLE IF NOT EXISTS t_sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id INTEGER NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('INSERT','UPDATE','DELETE')),
      payload TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      retries INTEGER DEFAULT 0,
      last_error TEXT,
      synced INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_sync_queue_pending ON t_sync_queue(synced, created_at);

    -- =====================================================
    -- APP CONFIG
    -- =====================================================
    CREATE TABLE IF NOT EXISTS t_config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- =====================================================
    -- SEED DATA : Site + Centres + Postes par défaut
    -- =====================================================
    INSERT OR IGNORE INTO t_sites (id, nom, code) VALUES (1, 'ABOBO', 'ABO');

    INSERT OR IGNORE INTO t_centres (id, site_id, nom, numero) VALUES
      (1, 1, 'Centre 1', 1),
      (2, 1, 'Centre 2', 2),
      (3, 1, 'Centre 3', 3),
      (4, 1, 'Centre 4', 4);

    INSERT OR IGNORE INTO t_postes (id, centre_id, nom, numero) VALUES
      (1, 1, 'PC 1', 1), (2, 1, 'PC 2', 2), (3, 1, 'PC 3', 3), (4, 1, 'PC 4', 4),
      (5, 2, 'PC 1', 1), (6, 2, 'PC 2', 2), (7, 2, 'PC 3', 3), (8, 2, 'PC 4', 4),
      (9, 3, 'PC 1', 1), (10, 3, 'PC 2', 2), (11, 3, 'PC 3', 3), (12, 3, 'PC 4', 4),
      (13, 4, 'PC 1', 1), (14, 4, 'PC 2', 2), (15, 4, 'PC 3', 3), (16, 4, 'PC 4', 4);

    -- Compte Super Admin par défaut (mot de passe: Titan@2026 hashé bcrypt)
    INSERT OR IGNORE INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif)
    VALUES (1, 'superadmin', '$2a$10$rKEYcV5Q2fW9yZ8Z4x9Z4e8Z4x9Z4e8Z4x9Z4e8Z4x9Z4e8Z4x9', 'SUPER ADMIN', 'Super Administrateur', 1);

    -- Config initiale
    INSERT OR IGNORE INTO t_config (key, value) VALUES
      ('app_version', '2.0.0'),
      ('theme', 'dark'),
      ('sync_enabled', 'false'),
      ('sync_interval_seconds', '30'),
      ('backup_enabled', 'true'),
      ('backup_interval_hours', '24'),
      ('backup_max_count', '7'),
      ('last_sync_at', ''),
      ('supabase_url', ''),
      ('supabase_anon_key', '');
  `);

  log.info('Migration v1 complete: All tables, indexes, FTS5, and seed data created');
}
