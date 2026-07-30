function migrateV1(db: Database.Database): void {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    -- =====================================================
    -- SITES / CENTRES / POSTES (HiÃ©rarchie)
    -- =====================================================
    CREATE TABLE IF NOT EXISTS t_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      is_active INTEGER DEFAULT 1,
      max_centres INTEGER DEFAULT 4,
      created_at TEXT DEFAULT (datetime('now')),
      sync_id TEXT,
      expiry_date TEXT,
      is_permanent INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS t_centres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      nom TEXT NOT NULL,
      numero INTEGER DEFAULT 1 CHECK(numero BETWEEN 1 AND 4),
      created_at TEXT DEFAULT (datetime('now')),
      sync_id TEXT,
      code TEXT,
      prefixe_rangement TEXT,
      lieu TEXT,
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
      site_id INTEGER,
      centre_id INTEGER,
      poste_id INTEGER,
      avatar_url TEXT,
      last_login TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      sync_id TEXT,
      is_dirty INTEGER DEFAULT 0 NOT NULL,
      synced_at TEXT,
      FOREIGN KEY (site_id) REFERENCES t_sites(id),
      FOREIGN KEY (centre_id) REFERENCES t_centres(id),
      FOREIGN KEY (poste_id) REFERENCES t_postes(id)
    );

    -- =====================================================
    -- ROLES MULTIPLES DES UTILISATEURS
    -- =====================================================
    CREATE TABLE IF NOT EXISTS t_user_roles (
      id_user INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('SUPER ADMIN','ADMINISTRATEUR_SITE','ADMIN_CENTRE','OPERATEUR_VERIFICATION','OPERATEUR_QUALITE','OPERATEUR_SAISIE','OPERATEUR_LOGISTIQUE','OPERATEUR_INVENTAIRE')),
      PRIMARY KEY (id_user, role),
      FOREIGN KEY (id_user) REFERENCES t_users(id_user) ON DELETE CASCADE
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
      statut TEXT DEFAULT 'EN STOCK' CHECK(statut IN ('EN STOCK','DELIVRE','DISTRIBUEE','RETIRE','ANNULE','BROUILLON')),
      date_delivrance TEXT,
      agent_saisie TEXT,
      -- DÃ©livrance
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
      note_signalement_absence TEXT,
      escalade_niveau TEXT DEFAULT 'CENTRE' CHECK(escalade_niveau IN ('CENTRE', 'SITE', 'RESOLU')),
      date_resolution_absence TEXT,
      agent_resolution_absence TEXT,
      note_resolution TEXT,
      notif_lue INTEGER DEFAULT 1,
      -- HiÃ©rarchie
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
      created_by INTEGER DEFAULT NULL,
      updated_by INTEGER DEFAULT NULL,
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
    CREATE INDEX IF NOT EXISTS idx_cartes_site_statut ON t_cartes(site_id, statut);
    CREATE INDEX IF NOT EXISTS idx_cartes_stats_dp_v2 ON t_cartes(site_id, noms, prenoms, date_de_naissance, cle_doublon);
    CREATE INDEX IF NOT EXISTS idx_cartes_stats_kpi ON t_cartes(site_id, statut, statut_physique, num_secu, rangement);
    CREATE INDEX IF NOT EXISTS idx_cartes_site_date_delivrance ON t_cartes(site_id, date_delivrance);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_t_cartes_sync_id ON t_cartes(sync_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_t_users_sync_id ON t_users(sync_id);

    -- =====================================================
    -- FTS5 : Recherche instantanÃ©e full-text
    -- =====================================================
    CREATE VIRTUAL TABLE IF NOT EXISTS t_cartes_fts USING fts5(
      noms, prenoms, num_secu, contact, lieu_de_naissance, rangement,
      content='t_cartes', content_rowid='id_carte'
    );

    -- Triggers pour garder FTS synchronisÃ©
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

    -- FTS5 pour t_import_anomalies
    CREATE VIRTUAL TABLE IF NOT EXISTS t_anomalies_fts USING fts5(
      noms, prenoms, num_secu, contact, lieu_de_naissance, rangement,
      content='t_import_anomalies', content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS trg_anomalies_ai AFTER INSERT ON t_import_anomalies BEGIN
      INSERT INTO t_anomalies_fts(rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
      VALUES (new.id, new.noms, new.prenoms, new.num_secu, new.contact, new.lieu_de_naissance, new.rangement);
    END;

    CREATE TRIGGER IF NOT EXISTS trg_anomalies_ad AFTER DELETE ON t_import_anomalies BEGIN
      DELETE FROM t_anomalies_fts WHERE rowid = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_anomalies_au AFTER UPDATE ON t_import_anomalies BEGIN
      DELETE FROM t_anomalies_fts WHERE rowid = old.id;
      INSERT INTO t_anomalies_fts(rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
      VALUES (new.id, new.noms, new.prenoms, new.num_secu, new.contact, new.lieu_de_naissance, new.rangement);
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
      is_read INTEGER DEFAULT 0,
      site_id INTEGER DEFAULT 1,
      FOREIGN KEY (id_user) REFERENCES t_users(id_user)
    );


    CREATE INDEX IF NOT EXISTS idx_logs_date ON t_logs(date_heure);
    CREATE INDEX IF NOT EXISTS idx_logs_action ON t_logs(action);
    CREATE INDEX IF NOT EXISTS idx_logs_user ON t_logs(id_user);

    CREATE TABLE IF NOT EXISTS t_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      utilisateur TEXT,
      action TEXT,
      details TEXT,
      date_creation TEXT DEFAULT (datetime('now'))
    );

    -- =====================================================
    -- TABLE TEMPORAIRE IMPORT
    -- =====================================================
    CREATE TABLE IF NOT EXISTS t_import_temp (
      id_tmp INTEGER PRIMARY KEY AUTOINCREMENT,
      noms TEXT, prenoms TEXT, date_de_naissance TEXT,
      num_secu TEXT, lieu_de_naissance TEXT, contact TEXT,
      lieu_enrolement TEXT, rangement TEXT, statut TEXT,
      date_delivrance TEXT, agent_saisie TEXT,
      cle_doublon TEXT, cle_doublon_flex TEXT,
      site_id INTEGER, nom_retirant TEXT, num_retirant TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_import_temp_cle ON t_import_temp(cle_doublon);

    -- =====================================================
    -- SYNC QUEUE (File d'attente offline â€” cartes CMU)
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
    -- OUTBOX (EntitÃ©s structurelles : sites, centres, users)
    -- UUID PRIMARY KEY garantit l'idempotence lors des tentatives
    -- multiples de synchronisation (Offline-First Pattern).
    -- =====================================================
    CREATE TABLE IF NOT EXISTS t_outbox (
      id          TEXT    PRIMARY KEY,
      table_name  TEXT    NOT NULL,
      operation   TEXT    NOT NULL CHECK(operation IN ('INSERT','UPDATE','DELETE')),
      payload     TEXT    NOT NULL,
      created_at  TEXT    DEFAULT (datetime('now')),
      status      TEXT    NOT NULL DEFAULT 'PENDING'
                          CHECK(status IN ('PENDING','SYNCED','ERROR')),
      error_msg   TEXT,
      attempts    INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_outbox_status ON t_outbox(status, created_at);

    -- =====================================================
    -- TABLE DES ANOMALIES D'IMPORTATION (DLQ)
    -- =====================================================
    CREATE TABLE IF NOT EXISTS t_import_anomalies (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      carte_id        TEXT,
      type_anomalie   TEXT,
      description     TEXT,
      erreur_message  TEXT,
      noms            TEXT,
      prenoms         TEXT,
      date_de_naissance TEXT,
      lieu_de_naissance TEXT,
      num_secu        TEXT,
      lieu_enrolement TEXT,
      contact         TEXT,
      rangement       TEXT,
      statut          TEXT,
      date_delivrance TEXT,
      agent_saisie    TEXT,
      nom_retirant    TEXT,
      num_retirant    TEXT,
      agent_distributeur TEXT,
      centre_retrait  TEXT,
      cle_doublon     TEXT,
      cle_doublon_flex TEXT,
      statut_physique TEXT,
      agent_signalement_absence TEXT,
      date_signalement_absence TEXT,
      note_signalement_absence TEXT,
      escalade_niveau TEXT,
      date_resolution_absence TEXT,
      agent_resolution_absence TEXT,
      note_resolution TEXT,
      notif_lue       INTEGER,
      site_id         INTEGER,
      centre_id       INTEGER,
      poste_id        INTEGER,
      qr_code_data    TEXT,
      sync_id         TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now')),
      synced_at       TEXT,
      is_dirty        INTEGER DEFAULT 0,
      created_by      INTEGER DEFAULT NULL,
      updated_by      INTEGER DEFAULT NULL,
      has_invalid_date INTEGER DEFAULT 0,
      is_exported     INTEGER DEFAULT 0,
      contact_retirant TEXT
    );

    -- =====================================================
    -- ARCHIVES DES AGENTS
    -- =====================================================
    CREATE TABLE IF NOT EXISTS t_agent_archives (
      id_carte INTEGER NOT NULL,
      login_user TEXT NOT NULL,
      archived_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_carte, login_user)
    );

    -- =====================================================
    -- APP CONFIG
    -- =====================================================
    CREATE TABLE IF NOT EXISTS t_config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- =====================================================
    -- SEED DATA : Site + Centres + Postes par dÃ©faut
    -- =====================================================
    -- Seed data removed for clean multi-tenant deployment. 
    -- Super Admin must create sites and centers manually.

    -- Compte Super Admin par dÃ©faut (identifiants: superadmin / admin)
    -- NOTE: Le hash est gÃ©nÃ©rÃ© dynamiquement par hashPassword() ci-dessous (voir code TypeScript).

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

  // â”€â”€ Seed Super Admin avec mot de passe hashÃ© (bcrypt) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Le hash est gÃ©nÃ©rÃ© Ã  l'exÃ©cution pour ne jamais stocker de mot de passe en clair.
  try {
    const defaultHash = hashPassword('admin');
    db.prepare(`
      INSERT OR IGNORE INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif)
      VALUES (1, 'superadmin', ?, 'SUPER ADMIN', 'Super Administrateur', 1)
    `).run(defaultHash);
    log.info('[MIGRATION V1] Compte superadmin crÃ©Ã© avec mot de passe hashÃ© (bcrypt).');
  } catch (e: any) {
    log.warn('[MIGRATION V1] Impossible de crÃ©er le compte superadmin (dÃ©jÃ  existant ?) :', e.message);
  }
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  db.exec('PRAGMA foreign_keys = ON;');

  log.info('Migration v1 complete: All tables, indexes, FTS5, and seed data created');
}
