import Database from 'better-sqlite3';
import log from 'electron-log';
const SCHEMA_VERSION = 18;

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

  if (currentVersion < 8) {
    log.info('Running migration v8: Adding composite index (site_id, statut) to t_cartes');
    migrateV8(db);
  }

  if (currentVersion < 9) {
    log.info('Running migration v9: Migrating date formats from DD/MM/YYYY to YYYY-MM-DD');
    migrateV9(db);
  }

  if (currentVersion < 10) {
    log.info('Running migration v10: Updating t_cartes statut_physique check constraint to allow PERDUE');
    migrateV10(db);
  }

  if (currentVersion < 11) {
    log.info('Running migration v11: Adding prefixe_rangement to t_sites');
    migrateV11(db);
  }

  if (currentVersion < 12) {
    log.info('Running migration v12: Moving prefixe_rangement to t_centres');
    migrateV12(db);
  }

  if (currentVersion < 13) {
    log.info('Running migration v13: Adding is_exported column to t_cartes');
    migrateV13(db);
  }

  if (currentVersion < 14) {
    log.info('Running migration v14: Adding created_by column to t_cartes and refactoring AJOUTANT role to OPERATEUR_SAISIE');
    migrateV14(db);
  }

  if (currentVersion < 15) {
    log.info('Running migration v15: Refactoring CONSULTANT role to OPERATEUR_VERIFICATION');
    migrateV15(db);
  }

  if (currentVersion < 16) {
    log.info('Running migration v16: Adding OPERATEUR_INVENTAIRE check constraint and role');
    migrateV16(db);
  }

  if (currentVersion < 17) {
    log.info('Running migration v17: Renaming EDITEUR role to OPERATEUR_QUALITE');
    migrateV17(db);
  }

  if (currentVersion < 18) {
    log.info('Running migration v18: Renaming ADMINISTRATEUR role to ADMINISTRATEUR_SITE and adding ADMIN_CENTRE');
    migrateV18(db);
  }

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  log.info('All migrations complete');
}

function migrateV9(db: Database.Database): void {
  db.transaction(() => {
    // 1. Migrer t_cartes
    const cartes = db.prepare('SELECT id_carte, date_de_naissance FROM t_cartes WHERE date_de_naissance IS NOT NULL').all() as any[];
    const updateCarte = db.prepare('UPDATE t_cartes SET date_de_naissance = ? WHERE id_carte = ?');
    
    for (const c of cartes) {
      const isoDate = convertToIsoDate(c.date_de_naissance);
      updateCarte.run(isoDate, c.id_carte);
    }

    // 2. Migrer t_import_temp
    const tempCartes = db.prepare('SELECT id_tmp, date_de_naissance FROM t_import_temp WHERE date_de_naissance IS NOT NULL').all() as any[];
    const updateTemp = db.prepare('UPDATE t_import_temp SET date_de_naissance = ? WHERE id_tmp = ?');
    
    for (const tc of tempCartes) {
      const isoDate = convertToIsoDate(tc.date_de_naissance);
      updateTemp.run(isoDate, tc.id_tmp);
    }
  })();
}

function convertToIsoDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const s = dateStr.trim();
  
  // Format DD/MM/YYYY
  const ddmmyyyyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyyMatch) {
    const day = ddmmyyyyMatch[1].padStart(2, '0');
    const month = ddmmyyyyMatch[2].padStart(2, '0');
    const year = ddmmyyyyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Format YYYY-MM-DD (déjà correct)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }

  // Invalide ou corrompu (N/A, 0, etc.)
  return null;
}

function migrateV8(db: Database.Database): void {
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_site_statut ON t_cartes (site_id, statut);');
    log.info('Migration V8: Created index idx_cartes_site_statut');
  } catch (e) {
    log.error('Migration V8 failed:', e);
    throw e;
  }
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
      const message = e instanceof Error ? e.message : String(e);
      log.warn(`Migration V6: site_id already exists or error in ${table}: ${message}`);
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
      role TEXT NOT NULL CHECK(role IN ('SUPER ADMIN','ADMINISTRATEUR_SITE','ADMIN_CENTRE','OPERATEUR_VERIFICATION','OPERATEUR_QUALITE','OPERATEUR_SAISIE','OPERATEUR_LOGISTIQUE','OPERATEUR_INVENTAIRE')),
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
      DELETE FROM t_cartes_fts WHERE rowid = old.id_carte;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_cartes_au AFTER UPDATE ON t_cartes BEGIN
      DELETE FROM t_cartes_fts WHERE rowid = old.id_carte;
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

function migrateV10(db: Database.Database): void {
  db.transaction(() => {
    // 1. Renommer la table existante
    db.exec('ALTER TABLE t_cartes RENAME TO t_cartes_old;');

    // 2. Créer la nouvelle table avec le CHECK mis à jour (incluant 'PERDUE')
    db.exec(`
      CREATE TABLE t_cartes (
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
        nom_retirant TEXT,
        num_retirant TEXT,
        agent_distributeur TEXT,
        centre_retrait TEXT,
        cle_doublon TEXT,
        cle_doublon_flex TEXT,
        statut_physique TEXT DEFAULT 'OK' CHECK(statut_physique IN ('OK','ABSENT','RETROUVE','PERDUE')),
        agent_signalement_absence TEXT,
        date_signalement_absence TEXT,
        date_resolution_absence TEXT,
        agent_resolution_absence TEXT,
        note_resolution TEXT,
        notif_lue INTEGER DEFAULT 1,
        site_id INTEGER DEFAULT 1,
        centre_id INTEGER,
        poste_id INTEGER,
        qr_code_data TEXT,
        sync_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        synced_at TEXT,
        is_dirty INTEGER DEFAULT 0,
        FOREIGN KEY (site_id) REFERENCES t_sites(id),
        FOREIGN KEY (centre_id) REFERENCES t_centres(id),
        FOREIGN KEY (poste_id) REFERENCES t_postes(id)
      );
    `);

    // 3. Copier les données de l'ancienne table vers la nouvelle
    db.exec('INSERT INTO t_cartes SELECT * FROM t_cartes_old;');

    // 4. Supprimer l'ancienne table
    db.exec('DROP TABLE t_cartes_old;');

    // 5. Recréer les index sur la nouvelle table t_cartes
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_noms ON t_cartes(noms);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_prenoms ON t_cartes(prenoms);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_num_secu ON t_cartes(num_secu);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_rangement ON t_cartes(rangement);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_statut ON t_cartes(statut);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_statut_physique ON t_cartes(statut_physique);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_cle_doublon ON t_cartes(cle_doublon);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_cle_flex ON t_cartes(cle_doublon_flex);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_centre ON t_cartes(centre_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_sync ON t_cartes(is_dirty, synced_at);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_updated ON t_cartes(updated_at);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_contact ON t_cartes(contact);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_site_statut ON t_cartes(site_id, statut);');

    // 6. Recréer les triggers FTS
    db.exec('DROP TRIGGER IF EXISTS trg_cartes_ai;');
    db.exec('DROP TRIGGER IF EXISTS trg_cartes_ad;');
    db.exec('DROP TRIGGER IF EXISTS trg_cartes_au;');

    db.exec(`
      CREATE TRIGGER trg_cartes_ai AFTER INSERT ON t_cartes BEGIN
        INSERT INTO t_cartes_fts(rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
        VALUES (new.id_carte, new.noms, new.prenoms, new.num_secu, new.contact, new.lieu_de_naissance, new.rangement);
      END;
    `);

    db.exec(`
      CREATE TRIGGER trg_cartes_ad AFTER DELETE ON t_cartes BEGIN
        DELETE FROM t_cartes_fts WHERE rowid = old.id_carte;
      END;
    `);

    db.exec(`
      CREATE TRIGGER trg_cartes_au AFTER UPDATE ON t_cartes BEGIN
        DELETE FROM t_cartes_fts WHERE rowid = old.id_carte;
        INSERT INTO t_cartes_fts(rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
        VALUES (new.id_carte, new.noms, new.prenoms, new.num_secu, new.contact, new.lieu_de_naissance, new.rangement);
      END;
    `);
  })();
}

function migrateV11(db: Database.Database): void {
  db.transaction(() => {
    // 1. Ajouter la colonne prefixe_rangement
    try {
      db.exec('ALTER TABLE t_sites ADD COLUMN prefixe_rangement TEXT DEFAULT NULL;');
      log.info('Added column prefixe_rangement to t_sites');
    } catch (e: any) {
      log.warn('Could not add prefixe_rangement column (might already exist):', e.message);
    }

    // 2. Pré-remplir les préfixes d'Abobo s'ils existent
    try {
      db.prepare("UPDATE t_sites SET prefixe_rangement = 'CH' WHERE code = 'ABOBO_FHB'").run();
      db.prepare("UPDATE t_sites SET prefixe_rangement = 'MAIRIE' WHERE code = 'ABOBO_MAIRIE'").run();
      db.prepare("UPDATE t_sites SET prefixe_rangement = 'PK18' WHERE code = 'ABOBO_PK18'").run();
      log.info('Pre-populated prefixe_rangement for Abobo sites');
    } catch (e: any) {
      log.error('Failed to pre-populate prefixe_rangement:', e.message);
    }
  })();
}

function migrateV12(db: Database.Database): void {
  db.transaction(() => {
    // 1. Ajouter la colonne prefixe_rangement à t_centres
    try {
      db.exec('ALTER TABLE t_centres ADD COLUMN prefixe_rangement TEXT DEFAULT NULL;');
      log.info('Added column prefixe_rangement to t_centres');
    } catch (e: any) {
      log.warn('Could not add prefixe_rangement column to t_centres (might already exist):', e.message);
    }

    // 2. Pré-remplir les préfixes d'Abobo s'ils existent
    try {
      db.prepare("UPDATE t_centres SET prefixe_rangement = 'CH' WHERE nom LIKE '%FHB%' OR nom LIKE '%HOUPHOUET%'").run();
      db.prepare("UPDATE t_centres SET prefixe_rangement = 'MAIRIE' WHERE nom LIKE '%MAIRIE%'").run();
      db.prepare("UPDATE t_centres SET prefixe_rangement = 'PK18' WHERE nom LIKE '%PK18%'").run();
      log.info('Pre-populated prefixe_rangement for Abobo centres');
    } catch (e: any) {
      log.error('Failed to pre-populate prefixe_rangement for centres:', e.message);
    }
  })();
}

function migrateV13(db: Database.Database): void {
  db.transaction(() => {
    try {
      db.exec('ALTER TABLE t_cartes ADD COLUMN is_exported INTEGER DEFAULT 0;');
      db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_is_exported ON t_cartes (is_exported);');
      log.info('Migration V13: Added is_exported to t_cartes and created index');
    } catch (e: any) {
      log.warn('Migration V13 warnings (column might already exist):', e.message);
    }
  })();
}

function migrateV14(db: Database.Database): void {
  db.transaction(() => {
    // 1. Ajouter created_by
    try {
      db.exec('ALTER TABLE t_cartes ADD COLUMN created_by INTEGER DEFAULT NULL;');
      db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_created_by ON t_cartes (created_by);');
      log.info('Migration V14: Added created_by to t_cartes and created index');
    } catch (e: any) {
      log.warn('Migration V14: created_by column might already exist:', e.message);
    }

    // 2. Mettre à jour les rôles dans t_users
    try {
      db.prepare("UPDATE t_users SET role = 'OPERATEUR_SAISIE' WHERE role = 'AJOUTANT'").run();
      log.info('Migration V14: Updated AJOUTANT user roles to OPERATEUR_SAISIE');
    } catch (e: any) {
      log.error('Migration V14: Failed to update AJOUTANT roles:', e.message);
    }
  })();
}

function migrateV15(db: Database.Database): void {
  // PRAGMA foreign_keys doit s'exécuter HORS transaction sous SQLite
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.transaction(() => {
      try {
        log.info('Migration V15: Reconstructing t_users to update CHECK constraint...');

        // Sauvegarder les données
        db.exec('CREATE TABLE t_users_backup AS SELECT * FROM t_users;');

        // Supprimer l\'ancienne table
        db.exec('DROP TABLE t_users;');

        // Recréer la table avec la nouvelle contrainte CHECK
        db.exec(`
          CREATE TABLE t_users (
            id_user INTEGER PRIMARY KEY AUTOINCREMENT,
            login TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('SUPER ADMIN','ADMINISTRATEUR','OPERATEUR_VERIFICATION','EDITEUR','OPERATEUR_SAISIE','OPERATEUR_LOGISTIQUE')),
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
            sync_id TEXT
          );
        `);

        // Restaurer les données en remplaçant 'CONSULTANT' par 'OPERATEUR_VERIFICATION'
        db.exec(`
          INSERT INTO t_users (
            id_user, login, password_hash, role, nom_user, prenom_user, email, telephone,
            statut_actif, site_id, centre_id, poste_id, avatar_url, last_login, created_at, updated_at, sync_id
          )
          SELECT
            id_user, login, password_hash,
            CASE WHEN role = 'CONSULTANT' THEN 'OPERATEUR_VERIFICATION' ELSE role END,
            nom_user, prenom_user, email, telephone,
            statut_actif, site_id, centre_id, poste_id, avatar_url, last_login, created_at, updated_at, sync_id
          FROM t_users_backup;
        `);

        // Supprimer la table de backup
        db.exec('DROP TABLE t_users_backup;');

        log.info('Migration V15: Reconstructed t_users successfully with OPERATEUR_LOGISTIQUE check constraint');
      } catch (e: any) {
        log.error('Migration V15: Failed to reconstruct t_users:', e.message);
        throw e;
      }
    })();
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

function migrateV16(db: Database.Database): void {
  // PRAGMA foreign_keys doit s'exécuter HORS transaction sous SQLite
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.transaction(() => {
      try {
        log.info('Migration V16: Reconstructing t_users to update CHECK constraint with OPERATEUR_INVENTAIRE...');

        // Sauvegarder les données
        db.exec('CREATE TABLE t_users_backup AS SELECT * FROM t_users;');

        // Supprimer l\'ancienne table
        db.exec('DROP TABLE t_users;');

        // Recréer la table avec la nouvelle contrainte CHECK
        db.exec(`
          CREATE TABLE t_users (
            id_user INTEGER PRIMARY KEY AUTOINCREMENT,
            login TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('SUPER ADMIN','ADMINISTRATEUR','OPERATEUR_VERIFICATION','EDITEUR','OPERATEUR_SAISIE','OPERATEUR_LOGISTIQUE','OPERATEUR_INVENTAIRE')),
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
            sync_id TEXT
          );
        `);

        // Restaurer les données
        db.exec(`
          INSERT INTO t_users (
            id_user, login, password_hash, role, nom_user, prenom_user, email, telephone,
            statut_actif, site_id, centre_id, poste_id, avatar_url, last_login, created_at, updated_at, sync_id
          )
          SELECT
            id_user, login, password_hash, role, nom_user, prenom_user, email, telephone,
            statut_actif, site_id, centre_id, poste_id, avatar_url, last_login, created_at, updated_at, sync_id
          FROM t_users_backup;
        `);

        // Supprimer la table de backup
        db.exec('DROP TABLE t_users_backup;');

        log.info('Migration V16: Reconstructed t_users successfully with OPERATEUR_INVENTAIRE check constraint');
      } catch (e: any) {
        log.error('Migration V16: Failed to reconstruct t_users:', e.message);
        throw e;
      }
    })();
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

function migrateV17(db: Database.Database): void {
  // PRAGMA foreign_keys doit s'exécuter HORS transaction sous SQLite
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.transaction(() => {
      try {
        log.info('Migration V17: Reconstructing t_users to rename EDITEUR to OPERATEUR_QUALITE...');

        // Sauvegarder les données
        db.exec('CREATE TABLE t_users_backup AS SELECT * FROM t_users;');

        // Supprimer l\'ancienne table
        db.exec('DROP TABLE t_users;');

        // Recréer la table avec la nouvelle contrainte CHECK (EDITEUR remplacé par OPERATEUR_QUALITE)
        db.exec(`
          CREATE TABLE t_users (
            id_user INTEGER PRIMARY KEY AUTOINCREMENT,
            login TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('SUPER ADMIN','ADMINISTRATEUR','OPERATEUR_VERIFICATION','OPERATEUR_QUALITE','OPERATEUR_SAISIE','OPERATEUR_LOGISTIQUE','OPERATEUR_INVENTAIRE')),
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
            sync_id TEXT
          );
        `);

        // Restaurer les données en convertissant 'EDITEUR' en 'OPERATEUR_QUALITE'
        db.exec(`
          INSERT INTO t_users (
            id_user, login, password_hash, role, nom_user, prenom_user, email, telephone,
            statut_actif, site_id, centre_id, poste_id, avatar_url, last_login, created_at, updated_at, sync_id
          )
          SELECT
            id_user, login, password_hash,
            CASE WHEN role = 'EDITEUR' THEN 'OPERATEUR_QUALITE' ELSE role END,
            nom_user, prenom_user, email, telephone,
            statut_actif, site_id, centre_id, poste_id, avatar_url, last_login, created_at, updated_at, sync_id
          FROM t_users_backup;
        `);

        // Supprimer la table de backup
        db.exec('DROP TABLE t_users_backup;');

        log.info('Migration V17: Reconstructed t_users successfully — EDITEUR renamed to OPERATEUR_QUALITE');
    } catch (e: any) {
      log.error('Migration V17: Failed to reconstruct t_users:', e.message);
      throw e;
    }
  })();
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

function migrateV18(db: Database.Database): void {
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.transaction(() => {
      try {
        log.info('Migration V18: Reconstructing t_users to update CHECK constraint and rename role...');

        // Sauvegarder les données
        db.exec('CREATE TABLE t_users_backup AS SELECT * FROM t_users;');

        // Supprimer l\'ancienne table
        db.exec('DROP TABLE t_users;');

        // Recréer la table avec la nouvelle contrainte CHECK
        db.exec(`
          CREATE TABLE t_users (
            id_user INTEGER PRIMARY KEY AUTOINCREMENT,
            login TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('SUPER ADMIN','ADMINISTRATEUR_SITE','ADMIN_CENTRE','OPERATEUR_VERIFICATION','OPERATEUR_QUALITE','OPERATEUR_SAISIE','OPERATEUR_LOGISTIQUE','OPERATEUR_INVENTAIRE')),
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
            synced_at TEXT
          );
        `);

        // Restaurer les données en convertissant 'ADMINISTRATEUR' en 'ADMINISTRATEUR_SITE'
        db.exec(`
          INSERT INTO t_users (
            id_user, login, password_hash, role, nom_user, prenom_user, email, telephone,
            statut_actif, site_id, centre_id, poste_id, avatar_url, last_login, created_at, updated_at, sync_id, is_dirty, synced_at
          )
          SELECT
            id_user, login, password_hash,
            CASE WHEN role = 'ADMINISTRATEUR' THEN 'ADMINISTRATEUR_SITE' ELSE role END,
            nom_user, prenom_user, email, telephone,
            statut_actif, site_id, centre_id, poste_id, avatar_url, last_login, created_at, updated_at, sync_id,
            COALESCE(is_dirty, 0), synced_at
          FROM t_users_backup;
        `);

        // Supprimer la table de backup
        db.exec('DROP TABLE t_users_backup;');

        log.info('Migration V18: Reconstructed t_users successfully — ADMINISTRATEUR renamed to ADMINISTRATEUR_SITE');
      } catch (e: any) {
        log.error('Migration V18: Failed to reconstruct t_users:', e.message);
        throw e;
      }
    })();
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}
