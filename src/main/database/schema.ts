import Database from 'better-sqlite3';
import log from 'electron-log';

const SCHEMA_VERSION = 7;

export function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;
  log.info(`Database schema version: ${currentVersion}, target: ${SCHEMA_VERSION}`);

  if (currentVersion < 1) {
    log.info('Running migration v1: Initial schema');
    migrateV1(db);
  }
  
  if (currentVersion < 2) {
    log.info('Running migration v2: Ensuring tables');
    migrateV2(db);
  }

  if (currentVersion < 3) {
    log.info('Running migration v3: Adding retirant columns to temp table');
    migrateV3(db);
  }

  if (currentVersion < 4) {
    log.info('Running migration v4: Adding quotas to sites');
    migrateV4(db);
  }

  if (currentVersion < 5) {
    log.info('Running migration v5: Adding active status to sites');
    migrateV5(db);
  }

  if (currentVersion < 6) {
    log.info('Running migration v6: Catch-up site_id columns');
    migrateV6(db);
  }

  if (currentVersion < 7) {
    log.info('Running migration v7: Final schema consistency check');
    migrateV7(db);
  }

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  log.info('All migrations complete');
}

function migrateV7(db: Database.Database): void {
  // Final safety check for missing columns used in new Dashboard
  const checks = [
    { table: 't_sites', col: 'is_active', type: 'INTEGER DEFAULT 1' },
    { table: 't_sites', col: 'max_centres', type: 'INTEGER DEFAULT 4' },
    { table: 't_users', col: 'site_id', type: 'INTEGER DEFAULT 1' },
    { table: 't_cartes', col: 'site_id', type: 'INTEGER DEFAULT 1' },
    { table: 't_import_temp', col: 'site_id', type: 'INTEGER' },
    { table: 't_logs', col: 'site_id', type: 'INTEGER DEFAULT 1' },
    { table: 't_centres', col: 'lieu', type: 'TEXT' }
  ];

  for (const check of checks) {
    try {
      // Try to add the column, it will throw if it exists
      db.exec(`ALTER TABLE ${check.table} ADD COLUMN ${check.col} ${check.type};`);
      log.info(`Migration V7: Added missing column ${check.col} to ${check.table}`);
    } catch (e) {
      // Ignore if column already exists
    }
  }
}

function migrateV6(db: Database.Database): void {
  // Catch-up for tables that might be missing site_id due to legacy v1 installs
  const tables = ['t_cartes', 't_users', 't_import_temp', 't_logs'];
  for (const table of tables) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN site_id INTEGER DEFAULT 1;`);
      log.info(`Migration V6: Added site_id to ${table}`);
    } catch (e) {
      log.warn(`Migration V6: site_id already exists or error in ${table}: ${e.message}`);
    }
  }
}

function migrateV5(db: Database.Database): void {
  try {
    db.exec(`
      ALTER TABLE t_sites ADD COLUMN is_active INTEGER DEFAULT 1;
    `);
  } catch (e) {
    log.warn('Migration V5: Column might already exist');
  }
}

function migrateV4(db: Database.Database): void {
  try {
    db.exec(`
      ALTER TABLE t_sites ADD COLUMN max_centres INTEGER DEFAULT 4;
    `);
    db.exec(`
      ALTER TABLE t_import_temp ADD COLUMN site_id INTEGER;
    `);
  } catch (e) {
    log.warn('Migration V4: Columns might already exist');
  }
}

function migrateV3(db: Database.Database): void {
  try {
    db.exec(`
      ALTER TABLE t_import_temp ADD COLUMN nom_retirant TEXT;
    `);
    db.exec(`
      ALTER TABLE t_import_temp ADD COLUMN num_retirant TEXT;
    `);
  } catch (e) {
    log.warn('Migration V3: Columns might already exist');
  }
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
      is_active INTEGER DEFAULT 1,
      max_centres INTEGER DEFAULT 4,
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
      site_id INTEGER DEFAULT 1,
      centre_id INTEGER,
      poste_id INTEGER,
      avatar_url TEXT,
      last_login TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      sync_id TEXT,
      is_dirty INTEGER DEFAULT 0,
      synced_at TEXT,
      FOREIGN KEY (site_id) REFERENCES t_sites(id),
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

    CREATE INDEX IF NOT EXISTS idx_import_temp_cle ON t_import_temp(cle_doublon);

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
    -- Seed data removed for clean multi-tenant deployment. 
    -- Super Admin must create sites and centers manually.

    -- Compte Super Admin par défaut (identifiants: superadmin / admin)
    INSERT OR IGNORE INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif)
    VALUES (1, 'superadmin', 'admin', 'SUPER ADMIN', 'Super Administrateur', 1);

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

function migrateV2(db: Database.Database): void {
  // Ensure all tables from v1 exist even if user was on an intermediate v1
  db.exec(`
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

    CREATE TABLE IF NOT EXISTS t_import_temp (
      id_tmp INTEGER PRIMARY KEY AUTOINCREMENT,
      noms TEXT, prenoms TEXT, date_de_naissance TEXT,
      num_secu TEXT, lieu_de_naissance TEXT, contact TEXT,
      lieu_enrolement TEXT, rangement TEXT, statut TEXT,
      date_delivrance TEXT, agent_saisie TEXT,
      cle_doublon TEXT, cle_doublon_flex TEXT
    );
  `);
}
