import Database from 'better-sqlite3';
import log from 'electron-log';
import { hashPassword } from '../auth/local-auth';

export const SCHEMA_VERSION = 49;

export function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;
  log.info(`[MIGRATION] Version du schÃ©ma actuelle : ${currentVersion}, cible : ${SCHEMA_VERSION}`);

  try {
    if (currentVersion < 1) {
      log.info('Running migration v1: Initial schema');
      migrateV1(db);
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
      log.info(`New database installation: schema directly set to version ${SCHEMA_VERSION}`);
      // Filet de sÃ©curitÃ© : garantir les colonnes mÃªme pour une install neuve
      migrateV27_safetyNet(db);
      log.info('All migrations complete');
      return;
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

    if (currentVersion < 19) {
      log.info('Running migration v19: Creating composite index idx_cartes_identite_civile');
      migrateV19(db);
    }

    if (currentVersion < 20) {
      log.info('Running migration v20: Optimizing indices and logs database performance');
      migrateV20(db);
    }

    if (currentVersion < 21) {
      log.info('Running migration v21: Creating audit_logs table');
      migrateV21(db);
    }

    if (currentVersion < 22) {
      log.info('Running migration v22: Creating t_user_roles table');
      migrateV22(db);
    }

    if (currentVersion < 23) {
      log.info('Running migration v23: Creating local indexes for mass upload optimization (cle_doublon, is_dirty, site_id)');
      migrateV23(db);
    }

    if (currentVersion < 24) {
      log.info('Running migration v24: Creating unique indexes for sync_id on t_cartes and t_users');
      migrateV24(db);
    }

    if (currentVersion < 25) {
      log.info('Running migration v25: Creating t_import_anomalies table');
      migrateV25(db);
    }

    if (currentVersion < 26) {
      log.info('Running migration v26: Indexing date_delivrance and created_at columns');
      migrateV26(db);
    }

    if (currentVersion < 27) {
      log.info('Running migration v27: Adding is_dirty NOT NULL and synced_at columns to t_users for existing field databases');
      migrateV27(db);
    }

    if (currentVersion < 28) {
      log.info('Running migration v28: Ensuring t_import_anomalies structure for stats dashboard');
      migrateV28(db);
    }

    if (currentVersion < 29) {
      log.info('Running migration v29: Ensuring t_import_anomalies and updating t_centres');
      migrateV29(db);
    }

    if (currentVersion < 30) {
      log.info('Running migration v30: Ensuring column numero with default 1 on t_centres');
      migrateV30(db);
    }

    if (currentVersion < 31) {
      log.info('Running migration v31: Ensuring column created_by with index on t_cartes');
      migrateV31(db);
    }

    if (currentVersion < 32) {
      log.info('Running migration v32: Creating t_outbox table for offline-first Outbox Pattern');
      migrateV32(db);
    }

    if (currentVersion < 34) {
      log.info('Running migration v34: Creating indexes for stats:get performance optimization');
      migrateV34(db);
    }

    if (currentVersion < 35) {
      log.info('Running migration v35: Replace V34 index with Covering index for DP, add KPI index');
      migrateV35(db);
    }

    if (currentVersion < 36) {
      log.info('Running migration v36: Add index for distribParJour query optimization');
      migrateV36(db);
    }

    if (currentVersion < 37) {
      log.info('Running migration v37: Adding note_signalement_absence and escalade_niveau to t_cartes');
      migrateV37(db);
    }

    if (currentVersion < 38) {
      log.info('Running migration v38: Add index for strict duplicates query optimization');
      migrateV38(db);
    }

    if (currentVersion < 39) {
      log.info('Running migration v39: Add contact_retirant column to t_cartes');
      migrateV39(db);
    }

    if (currentVersion < 40) {
      log.info('Running migration v40: Add expiry_date and is_permanent columns to t_sites');
      migrateV40(db);
    }

    if (currentVersion < 41) {
      log.info('Running migration v41: Add has_invalid_date flag + index + triggers for O(log n) invalid date queries');
      migrateV41(db);
    }

    if (currentVersion < 42) {
      log.info('Running migration v42: Allow DELETE operation in t_outbox');
      migrateV42(db);
    }

    if (currentVersion < 43) {
      log.info('Running migration v43: Add BROUILLON to statut CHECK constraint on t_cartes');
      migrateV43(db);
    }

    if (currentVersion < 44) {
      log.info('Running migration v44: Add is_dirty and updated_at to t_import_anomalies');
      migrateV44(db);
    }

    if (currentVersion < 45) {
      log.info('Running migration v45: Add is_dirty and updated_at to t_sites and t_centres');
      migrateV45(db);
    }

    if (currentVersion < 46) {
      log.info('Running migration v46: Add composite indexes for stats-worker performance');
      migrateV46(db);
    }

    if (currentVersion < 47) {
      log.info('Running migration v47: Add lieu_enrolement, statut, date_delivrance to t_import_anomalies');
      migrateV47(db);
    }

    if (currentVersion < 48) {
      log.info('Running migration v48: Add updated_by column to t_cartes');
      migrateV48(db);
    }

    if (currentVersion < 49) {
      log.info('Running migration v49: Create t_agent_archives table');
      migrateV49(db);
    }

    db.pragma(`user_version = ${SCHEMA_VERSION}`);

    // â”€â”€â”€ FILET DE SÃ‰CURITÃ‰ UNIVERSEL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // ExÃ©cutÃ© aprÃ¨s TOUTES les migrations pour corriger les bases corrompues
    migrateV27_safetyNet(db);
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    log.info('[MIGRATION] Toutes les migrations terminÃ©es avec succÃ¨s.');

  } catch (migrationError: any) {
    // â”€â”€â”€ CATCH GLOBAL : RECONSTRUCTION D'URGENCE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    log.error('[MIGRATION] Ã‰CHEC CRITIQUE du cycle de migration. DÃ©clenchement de la reconstruction d\'urgence.', migrationError);

    try {
      // Ã‰tape 1 : Sauvegarder la base corrompue
      const { join } = require('path');
      const { copyFileSync } = require('fs');
      const dbPath = (db as any).name as string;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = join(require('path').dirname(dbPath), `database_backup_emergency_${timestamp}.db`);
      try {
        copyFileSync(dbPath, backupPath);
        log.warn(`[MIGRATION] Sauvegarde d'urgence crÃ©Ã©e : ${backupPath}`);
      } catch (backupErr) {
        log.error('[MIGRATION] Impossible de crÃ©er la sauvegarde d\'urgence :', backupErr);
      }

      // Ã‰tape 2 : RÃ©initialisation forcÃ©e du schÃ©ma en V38 complet
      log.warn('[MIGRATION] Tentative de rÃ©installation complÃ¨te du schÃ©ma V38...');
      db.pragma('user_version = 0');
      migrateV1(db);
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
      migrateV29(db); // Garantit t_import_anomalies + colonnes t_centres (sans DROP destructeur)
      migrateV30(db); // Garantit la prÃ©sence de 'numero' avec DEFAULT 1 sur t_centres
      migrateV31(db); // Garantit la prÃ©sence de 'created_by' sur t_cartes
      migrateV32(db); // Garantit la prÃ©sence de t_outbox (Outbox Pattern offline-first)
      migrateV33(db); // Garantit les colonnes d'identitÃ© dans t_import_anomalies
      migrateV34(db); // Optimisation des requÃªtes stats:get
      migrateV35(db); // Covering index for DP, KPI index
      migrateV36(db); // Optimisation de la requÃªte distribParJour
      migrateV37(db); // Signalement absence et escalade
      migrateV38(db); // Index de performance pour les doublons stricts
      migrateV21(db); // Garantit audit_logs (V21)
      migrateV22(db); // Garantit t_user_roles (V22)
      migrateV39(db); // Add contact_retirant column to t_cartes
      migrateV40(db); // Add expiry_date and is_permanent to t_sites
      migrateV41(db); // has_invalid_date flag + index
      migrateV48(db); // Add updated_by to t_cartes
      migrateV27_safetyNet(db);
      log.info('[MIGRATION] Reconstruction d\'urgence terminÃ©e. SchÃ©ma rÃ©installÃ© en V38.');

    } catch (emergencyError: any) {
      log.error('[MIGRATION] Ã‰CHEC TOTAL de la reconstruction d\'urgence. L\'application peut Ãªtre inutilisable.', emergencyError);
      throw emergencyError;
    }
  }
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

  // Format YYYY-MM-DD (dÃ©jÃ  correct)
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

function migrateV41(db: Database.Database): void {
  try {
    log.info('[MIGRATION V41] Ajout de has_invalid_date sur t_cartes...');

    // 1. Ajouter la colonne flag si elle n'existe pas
    const tableInfo = db.pragma('table_info(t_cartes)') as any[];
    const hasFlag = tableInfo.some((col: any) => col.name === 'has_invalid_date');
    if (!hasFlag) {
      db.exec('ALTER TABLE t_cartes ADD COLUMN has_invalid_date INTEGER DEFAULT 0;');
      log.info('[MIGRATION V41] Colonne has_invalid_date ajoutee.');
    } else {
      log.info('[MIGRATION V41] Colonne has_invalid_date deja presente.');
    }

    // 2. CrÃ©er l'index composite couvrant (site_id, has_invalid_date)
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_site_invalid_date ON t_cartes(site_id, has_invalid_date);');
    log.info('[MIGRATION V41] Index idx_cartes_site_invalid_date cree.');

    // 3. CrÃ©er l'index composite pour doublons probables (noms, prenoms, date_de_naissance, site_id)
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_dp_identite ON t_cartes(site_id, noms, prenoms, date_de_naissance);');
    log.info('[MIGRATION V41] Index idx_cartes_dp_identite cree.');

    // 4. CrÃ©er les triggers pour maintenir le flag automatiquement
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_cartes_invalid_date_ai
      AFTER INSERT ON t_cartes
      BEGIN
        UPDATE t_cartes SET has_invalid_date = CASE
          WHEN NEW.date_de_naissance IS NULL OR NEW.date_de_naissance = ''
               OR length(NEW.date_de_naissance) != 10
               OR substr(NEW.date_de_naissance, 5, 1) != '-'
               OR substr(NEW.date_de_naissance, 8, 1) != '-'
          THEN 1 ELSE 0 END
        WHERE id_carte = NEW.id_carte;
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_cartes_invalid_date_au
      AFTER UPDATE OF date_de_naissance ON t_cartes
      BEGIN
        UPDATE t_cartes SET has_invalid_date = CASE
          WHEN NEW.date_de_naissance IS NULL OR NEW.date_de_naissance = ''
               OR length(NEW.date_de_naissance) != 10
               OR substr(NEW.date_de_naissance, 5, 1) != '-'
               OR substr(NEW.date_de_naissance, 8, 1) != '-'
          THEN 1 ELSE 0 END
        WHERE id_carte = NEW.id_carte;
      END;
    `);
    log.info('[MIGRATION V41] Triggers de maintenance du flag has_invalid_date crees.');

    // 5. Backfill : calculer et peupler le flag pour toutes les cartes existantes (one-shot)
    //    StratÃ©gie sans REGEXP pour compatibilitÃ© universelle.
    const backfillResult = db.prepare(`
      UPDATE t_cartes SET has_invalid_date = CASE
        WHEN date_de_naissance IS NULL OR date_de_naissance = ''
             OR length(date_de_naissance) != 10
             OR substr(date_de_naissance, 5, 1) != '-'
             OR substr(date_de_naissance, 8, 1) != '-'
        THEN 1 ELSE 0
      END
    `).run();
    log.info(`[MIGRATION V41] Backfill termine : ${backfillResult.changes} lignes mises a jour.`);

  } catch (e: any) {
    log.error('[MIGRATION V41] Echec:', e.message);
    throw e;
  }
}

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
      noms            TEXT,
      prenoms         TEXT,
      date_de_naissance TEXT,
      num_secu        TEXT,
      contact         TEXT,
      site_id         INTEGER,
      erreur_message  TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
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
      cle_doublon TEXT, cle_doublon_flex TEXT,
      site_id INTEGER, nom_retirant TEXT, num_retirant TEXT
    );
  `);
}

function migrateV38(db: Database.Database): void {
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_site_cle_doublon ON t_cartes(site_id, cle_doublon);');
    log.info('Migration V38: Created index idx_cartes_site_cle_doublon');
  } catch (e) {
    log.error('Migration V38 failed:', e);
    throw e;
  }
}

function migrateV10(db: Database.Database): void {
  db.transaction(() => {
    // 1. Renommer la table existante
    db.exec('ALTER TABLE t_cartes RENAME TO t_cartes_old;');

    // 2. CrÃ©er la nouvelle table avec le CHECK mis Ã  jour (incluant 'PERDUE')
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
        statut TEXT DEFAULT 'EN STOCK' CHECK(statut IN ('EN STOCK','DELIVRE','DISTRIBUEE','RETIRE','ANNULE','BROUILLON')),
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

    // 3. Copier les donnÃ©es de l'ancienne table vers la nouvelle
    db.exec('INSERT INTO t_cartes SELECT * FROM t_cartes_old;');

    // 4. Supprimer l'ancienne table
    db.exec('DROP TABLE t_cartes_old;');

    // 5. RecrÃ©er les index sur la nouvelle table t_cartes
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

    // 6. RecrÃ©er les triggers FTS
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

    // 2. PrÃ©-remplir les prÃ©fixes d'Abobo s'ils existent
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
    // 1. Ajouter la colonne prefixe_rangement Ã  t_centres
    try {
      db.exec('ALTER TABLE t_centres ADD COLUMN prefixe_rangement TEXT DEFAULT NULL;');
      log.info('Added column prefixe_rangement to t_centres');
    } catch (e: any) {
      log.warn('Could not add prefixe_rangement column to t_centres (might already exist):', e.message);
    }

    // 2. PrÃ©-remplir les prÃ©fixes d'Abobo s'ils existent
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

    // 2. Mettre Ã  jour les rÃ´les dans t_users
    try {
      db.prepare("UPDATE t_users SET role = 'OPERATEUR_SAISIE' WHERE role = 'AJOUTANT'").run();
      log.info('Migration V14: Updated AJOUTANT user roles to OPERATEUR_SAISIE');
    } catch (e: any) {
      log.error('Migration V14: Failed to update AJOUTANT roles:', e.message);
    }
  })();
}

function migrateV15(db: Database.Database): void {
  // PRAGMA foreign_keys doit s'exÃ©cuter HORS transaction sous SQLite
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.transaction(() => {
      try {
        log.info('Migration V15: Reconstructing t_users to update CHECK constraint...');

        // Sauvegarder les donnÃ©es
        db.exec('CREATE TABLE t_users_backup AS SELECT * FROM t_users;');

        // Supprimer l\'ancienne table
        db.exec('DROP TABLE t_users;');

        // RecrÃ©er la table avec la nouvelle contrainte CHECK + colonnes is_dirty et synced_at
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
            sync_id TEXT,
            is_dirty INTEGER DEFAULT 0,
            synced_at TEXT
          );
        `);

        // Restaurer les donnÃ©es en remplaÃ§ant 'CONSULTANT' par 'OPERATEUR_VERIFICATION'
        db.exec(`
          INSERT INTO t_users (
            id_user, login, password_hash, role, nom_user, prenom_user, email, telephone,
            statut_actif, site_id, centre_id, poste_id, avatar_url, last_login, created_at, updated_at, sync_id,
            is_dirty, synced_at
          )
          SELECT
            id_user, login, password_hash,
            CASE WHEN role = 'CONSULTANT' THEN 'OPERATEUR_VERIFICATION' ELSE role END,
            nom_user, prenom_user, email, telephone,
            statut_actif, site_id, centre_id, poste_id, avatar_url, last_login, created_at, updated_at, sync_id,
            COALESCE(is_dirty, 0), synced_at
          FROM t_users_backup;
        `);

        // Supprimer la table de backup
        db.exec('DROP TABLE t_users_backup;');

        log.info('Migration V15: Reconstructed t_users successfully â€” is_dirty et synced_at inclus.');
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
  // PRAGMA foreign_keys doit s'exÃ©cuter HORS transaction sous SQLite
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.transaction(() => {
      try {
        log.info('Migration V16: Reconstructing t_users to update CHECK constraint with OPERATEUR_INVENTAIRE...');

        // Sauvegarder les donnÃ©es
        db.exec('CREATE TABLE t_users_backup AS SELECT * FROM t_users;');

        // Supprimer l\'ancienne table
        db.exec('DROP TABLE t_users;');

        // RecrÃ©er la table avec la nouvelle contrainte CHECK + colonnes is_dirty et synced_at
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
            sync_id TEXT,
            is_dirty INTEGER DEFAULT 0,
            synced_at TEXT
          );
        `);

        // Restaurer les donnÃ©es
        db.exec(`
          INSERT INTO t_users (
            id_user, login, password_hash, role, nom_user, prenom_user, email, telephone,
            statut_actif, site_id, centre_id, poste_id, avatar_url, last_login, created_at, updated_at, sync_id,
            is_dirty, synced_at
          )
          SELECT
            id_user, login, password_hash, role, nom_user, prenom_user, email, telephone,
            statut_actif, site_id, centre_id, poste_id, avatar_url, last_login, created_at, updated_at, sync_id,
            COALESCE(is_dirty, 0), synced_at
          FROM t_users_backup;
        `);

        // Supprimer la table de backup
        db.exec('DROP TABLE t_users_backup;');

        log.info('Migration V16: Reconstructed t_users successfully â€” is_dirty et synced_at inclus.');
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
  // PRAGMA foreign_keys doit s'exÃ©cuter HORS transaction sous SQLite
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.transaction(() => {
      try {
        log.info('Migration V17: Reconstructing t_users to rename EDITEUR to OPERATEUR_QUALITE...');

        // Sauvegarder les donnÃ©es
        db.exec('CREATE TABLE t_users_backup AS SELECT * FROM t_users;');

        // Supprimer l\'ancienne table
        db.exec('DROP TABLE t_users;');

        // RecrÃ©er la table avec EDITEUR renommÃ© en OPERATEUR_QUALITE + colonnes is_dirty et synced_at
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
            sync_id TEXT,
            is_dirty INTEGER DEFAULT 0,
            synced_at TEXT
          );
        `);

        // Restaurer les donnÃ©es en convertissant 'EDITEUR' en 'OPERATEUR_QUALITE'
        db.exec(`
          INSERT INTO t_users (
            id_user, login, password_hash, role, nom_user, prenom_user, email, telephone,
            statut_actif, site_id, centre_id, poste_id, avatar_url, last_login, created_at, updated_at, sync_id,
            is_dirty, synced_at
          )
          SELECT
            id_user, login, password_hash,
            CASE WHEN role = 'EDITEUR' THEN 'OPERATEUR_QUALITE' ELSE role END,
            nom_user, prenom_user, email, telephone,
            statut_actif, site_id, centre_id, poste_id, avatar_url, last_login, created_at, updated_at, sync_id,
            COALESCE(is_dirty, 0), synced_at
          FROM t_users_backup;
        `);

        // Supprimer la table de backup
        db.exec('DROP TABLE t_users_backup;');

        log.info('Migration V17: Reconstructed t_users successfully â€” EDITEUR renamed to OPERATEUR_QUALITE, is_dirty et synced_at inclus.');
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

        // Sauvegarder les donnÃ©es
        db.exec('CREATE TABLE t_users_backup AS SELECT * FROM t_users;');

        // Supprimer l\'ancienne table
        db.exec('DROP TABLE t_users;');

        // RecrÃ©er la table avec la nouvelle contrainte CHECK
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

        // Restaurer les donnÃ©es en convertissant 'ADMINISTRATEUR' en 'ADMINISTRATEUR_SITE'
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

        log.info('Migration V18: Reconstructed t_users successfully â€” ADMINISTRATEUR renamed to ADMINISTRATEUR_SITE');
      } catch (e: any) {
        log.error('Migration V18: Failed to reconstruct t_users:', e.message);
        throw e;
      }
    })();
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

function migrateV19(db: Database.Database): void {
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_identite_civile ON t_cartes (noms, prenoms, date_de_naissance, site_id);');
    log.info('Migration V19: Created composite index idx_cartes_identite_civile successfully');
  } catch (e: any) {
    log.error('Migration V19 failed:', e.message);
    throw e;
  }
}

function migrateV20(db: Database.Database): void {
  try {
    // 1. Indexation t_cartes
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_site_statut_physique ON t_cartes (site_id, statut);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_cle_doublon ON t_cartes (cle_doublon);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_noms_prenoms_ddn ON t_cartes (noms, prenoms, date_de_naissance);');
    
    // 2. Ajout de la colonne is_read sur t_logs
    try {
      db.exec('ALTER TABLE t_logs ADD COLUMN is_read INTEGER DEFAULT 0;');
      log.info('Migration V20: Column is_read added to t_logs');
    } catch (e) {
      log.warn('Migration V20: Column is_read might already exist in t_logs');
    }
    
    // 3. Indexation t_logs
    db.exec('CREATE INDEX IF NOT EXISTS idx_logs_is_read ON t_logs (is_read);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_logs_action ON t_logs (action);');
    
    // 4. Initialisation : Mettre is_read = 1 pour les anciennes notifications marquÃ©es lues dans valeur_apres
    db.exec(`
      UPDATE t_logs 
      SET is_read = 1 
      WHERE action IN ('SYNC_UPDATE', 'CARTE_ABSENTE_SIGNALEE', 'CARTE_ABSENTE_RETROUVEE', 'CARTE_PERDUE_CONFIRMEE', 'CARTE_PERDUE_RETROUVEE') 
        AND (valeur_apres NOT LIKE '%"read":false%' AND valeur_apres NOT LIKE '%"read": false%')
    `);
    
    log.info('Migration V20 complete successfully');
  } catch (err: any) {
    log.error('Migration V20 failed:', err);
    throw err;
  }
}

function migrateV21(db: Database.Database): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operator_id TEXT,
        action_type TEXT,
        details TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    log.info('Migration V21: Created table audit_logs successfully');
  } catch (e: any) {
    log.error('Migration V21 failed:', e.message);
    throw e;
  }
}

function migrateV22(db: Database.Database): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS t_user_roles (
        id_user INTEGER NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('SUPER ADMIN','ADMINISTRATEUR_SITE','ADMIN_CENTRE','OPERATEUR_VERIFICATION','OPERATEUR_QUALITE','OPERATEUR_SAISIE','OPERATEUR_LOGISTIQUE','OPERATEUR_INVENTAIRE')),
        PRIMARY KEY (id_user, role),
        FOREIGN KEY (id_user) REFERENCES t_users(id_user) ON DELETE CASCADE
      );
    `);
    log.info('Migration V22: Created table t_user_roles successfully');
  } catch (e: any) {
    log.error('Migration V22 failed:', e.message);
    throw e;
  }
}

function migrateV23(db: Database.Database): void {
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_t_cartes_cle_doublon ON t_cartes(cle_doublon);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_t_cartes_is_dirty ON t_cartes(is_dirty);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_t_cartes_site_id ON t_cartes(site_id);');
    log.info('Migration V23: Created indexes idx_t_cartes_cle_doublon, idx_t_cartes_is_dirty, and idx_t_cartes_site_id successfully');
  } catch (e: any) {
    log.error('Migration V23 failed:', e.message);
    throw e;
  }
}

function migrateV24(db: Database.Database): void {
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_t_cartes_sync_id ON t_cartes(sync_id);');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_t_users_sync_id ON t_users(sync_id);');
    log.info('Migration V24: Created unique indexes on sync_id successfully');
  } catch (e: any) {
    log.error('Migration V24 failed:', e.message);
    throw e;
  }
}

function migrateV25(db: Database.Database): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS t_import_anomalies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        noms TEXT,
        prenoms TEXT,
        date_de_naissance TEXT,
        date_delivrance TEXT,
        num_secu TEXT,
        lieu_de_naissance TEXT,
        contact TEXT,
        lieu_enrolement TEXT,
        rangement TEXT,
        statut TEXT,
        erreur_message TEXT,
        date_import TEXT DEFAULT CURRENT_TIMESTAMP,
        site_id INTEGER
      );
    `);
    log.info('Migration V25: Created table t_import_anomalies successfully');
  } catch (e: any) {
    log.error('Migration V25 failed:', e.message);
    throw e;
  }
}

function migrateV26(db: Database.Database): void {
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_t_cartes_date_delivrance ON t_cartes(date_delivrance);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_t_cartes_created_at ON t_cartes(created_at);');
    log.info('Migration V26: Created indexes on date_delivrance and created_at successfully');
  } catch (e: any) {
    log.error('Migration V26 failed:', e.message);
    throw e;
  }
}

// =====================================================
// MIGRATION V27 : Ajout de is_dirty (NOT NULL) et synced_at sur t_users
// Cible les bases de terrain crÃ©Ã©es avant l'introduction de ces colonnes
// (antÃ©rieures Ã  la V15 ou ayant subi une reconstruction partielle).
// =====================================================
function migrateV27(db: Database.Database): void {
  /**
   * StratÃ©gie ALTER TABLE idempotente :
   * SQLite ne supporte pas `ADD COLUMN IF NOT EXISTS`, donc on attrape
   * silencieusement l'erreur "duplicate column name" pour garantir
   * l'idempotence de cette migration sur toutes les bases terrain.
   */
  const safeAlter = (table: string, col: string, definition: string): void => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition};`);
      log.info(`[MIGRATION V27] Colonne '${col}' ajoutÃ©e Ã  '${table}'.`);
    } catch (e: any) {
      if (e?.message?.includes('duplicate column name')) {
        log.info(`[MIGRATION V27] Colonne '${col}' dÃ©jÃ  prÃ©sente sur '${table}' â€” ignorÃ©.`);
      } else {
        // Toute autre erreur est remontÃ©e pour ne pas masquer un problÃ¨me rÃ©el
        throw e;
      }
    }
  };

  try {
    // Ajout de is_dirty : marqueur de synchronisation (0 = synchronisÃ©, 1 = modifiÃ© localement)
    safeAlter('t_users', 'is_dirty', 'INTEGER DEFAULT 0 NOT NULL');
    // Ajout de synced_at : horodatage ISO de la derniÃ¨re synchronisation Supabase rÃ©ussie
    safeAlter('t_users', 'synced_at', 'TEXT');

    // Initialiser is_dirty = 0 pour tous les enregistrements existants afin
    // d'Ã©viter des valeurs NULL rÃ©siduelles sur des bases trÃ¨s anciennes.
    db.exec(`UPDATE t_users SET is_dirty = 0 WHERE is_dirty IS NULL;`);

    log.info('[MIGRATION V27] Colonnes is_dirty et synced_at garanties sur t_users â€” migration terminÃ©e.');
  } catch (e: any) {
    log.error('[MIGRATION V27] Ã‰chec :', e.message);
    throw e;
  }
}

// =====================================================
// MIGRATION V28 : CrÃ©ation ou rÃ©paration de t_import_anomalies
// Indispensable pour Ã©viter que stats:get Ã©choue en production.
// =====================================================
function migrateV28(db: Database.Database): void {
  try {
    // Supprimer l'ancienne table si elle a Ã©tÃ© crÃ©Ã©e avec l'ancien schÃ©ma temporaire
    // pour Ã©viter des conflits de colonnes
    db.exec('DROP TABLE IF EXISTS t_import_anomalies;');
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS t_import_anomalies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        carte_id TEXT,
        type_anomalie TEXT,
        description TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    log.info('Migration V28: Table t_import_anomalies ensured successfully.');
  } catch (e: any) {
    log.error('Migration V28 failed:', e.message);
    throw e;
  }
}

// =====================================================
// MIGRATION V29 : CrÃ©ation t_import_anomalies et ajout de colonnes dans t_centres
// =====================================================
function migrateV29(db: Database.Database): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS t_import_anomalies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        carte_id TEXT,
        type_anomalie TEXT,
        description TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    log.info('Migration V29: Table t_import_anomalies ensured.');

    const tableInfo = db.prepare("PRAGMA table_info(t_centres)").all() as { name: string }[];
    const hasColumn = (colName: string) => tableInfo.some(col => col.name === colName);

    if (!hasColumn('code')) {
      db.exec("ALTER TABLE t_centres ADD COLUMN code TEXT;");
      log.info("Migration V29: Column 'code' added to t_centres.");
    }
    if (!hasColumn('prefixe_rangement')) {
      db.exec("ALTER TABLE t_centres ADD COLUMN prefixe_rangement TEXT;");
      log.info("Migration V29: Column 'prefixe_rangement' added to t_centres.");
    }
  } catch (e: any) {
    log.error('Migration V29 failed:', e.message);
    throw e;
  }
}

// =====================================================
// MIGRATION V30 : SÃ©curisation de la colonne numero de t_centres
// =====================================================
function migrateV30(db: Database.Database): void {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(t_centres)").all() as { name: string }[];
    const hasColumn = tableInfo.some(col => col.name === 'numero');

    if (!hasColumn) {
      db.exec("ALTER TABLE t_centres ADD COLUMN numero INTEGER DEFAULT 1 CHECK(numero BETWEEN 1 AND 4);");
      log.info("Migration V30: Column 'numero' added to t_centres.");
    } else {
      log.info("Migration V30: Column 'numero' already exists on t_centres.");
    }
  } catch (e: any) {
    log.error('Migration V30 failed:', e.message);
    throw e;
  }
}

// =====================================================
// MIGRATION V31 : Ajout de la colonne created_by et de son index sur t_cartes
// =====================================================
function migrateV31(db: Database.Database): void {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(t_cartes)").all() as { name: string }[];
    const hasColumn = tableInfo.some(col => col.name === 'created_by');

    if (!hasColumn) {
      db.exec("ALTER TABLE t_cartes ADD COLUMN created_by INTEGER DEFAULT NULL;");
      log.info("Migration V31: Column 'created_by' added to t_cartes.");
    } else {
      log.info("Migration V31: Column 'created_by' already exists on t_cartes.");
    }
    
    // Indexation
    db.exec("CREATE INDEX IF NOT EXISTS idx_cartes_created_by ON t_cartes (created_by);");
    log.info("Migration V31: Index 'idx_cartes_created_by' guaranteed.");
  } catch (e: any) {
    log.error('Migration V31 failed:', e.message);
    throw e;
  }
}

// =====================================================
// MIGRATION V32 : CrÃ©ation de la table t_outbox (Outbox Pattern offline-first)
// UUID TEXT PRIMARY KEY garantit l'idempotence : un mÃªme record ne peut
// Ãªtre enfilÃ© qu'une seule fois, mÃªme en cas de double appel.
// =====================================================
function migrateV32(db: Database.Database): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS t_outbox (
        id          TEXT    PRIMARY KEY,
        table_name  TEXT    NOT NULL,
        operation   TEXT    NOT NULL CHECK(operation IN ('INSERT','UPDATE')),
        payload     TEXT    NOT NULL,
        created_at  TEXT    DEFAULT (datetime('now')),
        status      TEXT    NOT NULL DEFAULT 'PENDING'
                            CHECK(status IN ('PENDING','SYNCED','ERROR')),
        error_msg   TEXT,
        attempts    INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_outbox_status ON t_outbox(status, created_at);
    `);
    log.info("Migration V32: Table 't_outbox' et index 'idx_outbox_status' garantis.");
  } catch (e: any) {
    log.error('Migration V32 failed:', e.message);
    throw e;
  }
}

// =====================================================
// MIGRATION V33 : Enrichissement de t_import_anomalies avec les donnÃ©es d'identitÃ©
// Permet Ã  l'onglet "Dates Invalides" d'afficher Nom, PrÃ©nom, Contact de l'assurÃ©.
// Utilise safe ALTER TABLE (idempotent) car DROP TABLE V28 a effacÃ© les colonnes V25.
// =====================================================
function migrateV33(db: Database.Database): void {
  log.info('[MIGRATION V33] Enrichissement de t_import_anomalies...');

  const safeAlter = (col: string, definition: string): void => {
    try {
      const tableInfo = db.prepare('PRAGMA table_info(t_import_anomalies)').all() as { name: string }[];
      const hasColumn = tableInfo.some(c => c.name === col);
      if (!hasColumn) {
        db.exec(`ALTER TABLE t_import_anomalies ADD COLUMN ${col} ${definition};`);
        log.info(`[MIGRATION V33] Colonne '${col}' ajoutÃ©e Ã  t_import_anomalies.`);
      } else {
        log.info(`[MIGRATION V33] Colonne '${col}' dÃ©jÃ  prÃ©sente â€” ignorÃ©.`);
      }
    } catch (e: any) {
      log.warn(`[MIGRATION V33] Impossible d'ajouter la colonne '${col}' :`, e.message);
    }
  };

  safeAlter('noms', 'TEXT');
  safeAlter('prenoms', 'TEXT');
  safeAlter('date_de_naissance', 'TEXT');
  safeAlter('num_secu', 'TEXT');
  safeAlter('contact', 'TEXT');
  safeAlter('site_id', 'INTEGER');
  safeAlter('erreur_message', 'TEXT');
  safeAlter('lieu_de_naissance', 'TEXT');
  safeAlter('rangement', 'TEXT');

  log.info('[MIGRATION V33] Table t_import_anomalies enrichie avec succÃ¨s.');
}

// =====================================================
// FILET DE SÃ‰CURITÃ‰ UNIVERSEL (exÃ©cutÃ© aprÃ¨s chaque cycle de migration)
// Garantit la prÃ©sence des colonnes critiques sur toutes les bases de terrain,
// mÃªme celles corrompues entre deux versions de migration.
// =====================================================
function migrateV27_safetyNet(db: Database.Database): void {
  // R6: Optimisation conditionnelle pour Ã©viter de multiplier les appels PRAGMA au dÃ©marrage
  const tableInfos: Record<string, string[]> = {};

  const safeAlter = (table: string, col: string, definition: string) => {
    try {
      if (!tableInfos[table]) {
        const tableInfo = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
        tableInfos[table] = tableInfo.map(c => c.name);
      }
      
      const hasColumn = tableInfos[table].includes(col);
      if (!hasColumn) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition};`);
        tableInfos[table].push(col); // Met Ã  jour le cache
        log.info(`[SAFETY NET] Colonne '${col}' ajoutÃ©e Ã  '${table}'.`);
      }
    } catch (e: any) {
      log.warn(`[SAFETY NET] Impossible de vÃ©rifier/ajouter la colonne '${col}' sur '${table}' :`, e.message);
    }
  };

  // t_users : colonnes de synchronisation et mise Ã  jour
  safeAlter('t_users', 'is_dirty', 'INTEGER DEFAULT 0');
  safeAlter('t_users', 'synced_at', 'TEXT');
  safeAlter('t_users', 'updated_at', 'TEXT');

  // t_logs : colonnes de notification et de site
  safeAlter('t_logs', 'is_read', 'INTEGER DEFAULT 0');
  safeAlter('t_logs', 'site_id', 'INTEGER DEFAULT 1');

  // t_cartes : colonne d'export, created_by, et synchronisation
  safeAlter('t_cartes', 'is_exported', 'INTEGER DEFAULT 0');
  safeAlter('t_cartes', 'created_by', 'INTEGER DEFAULT NULL');
  safeAlter('t_cartes', 'is_dirty', 'INTEGER DEFAULT 0');
  safeAlter('t_cartes', 'updated_at', 'TEXT');
  safeAlter('t_cartes', 'updated_by', 'INTEGER DEFAULT NULL');
  // Colonnes de dÃ©livrance (V39) â€” garanties mÃªme si la DB a Ã©tÃ© crÃ©Ã©e directement Ã  une version > 39
  safeAlter('t_cartes', 'contact_retirant', 'TEXT');
  safeAlter('t_cartes', 'nom_retirant', 'TEXT');
  safeAlter('t_cartes', 'num_retirant', 'TEXT');
  safeAlter('t_cartes', 'agent_distributeur', 'TEXT');
  safeAlter('t_cartes', 'centre_retrait', 'TEXT');
  safeAlter('t_cartes', 'date_delivrance', 'TEXT');
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_cartes_created_by ON t_cartes (created_by);");
  } catch (indexErr: any) {
    log.warn("[SAFETY NET] Impossible de crÃ©er l'index idx_cartes_created_by :", indexErr.message);
  }

  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_t_cartes_sync_id ON t_cartes(sync_id);");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_t_users_sync_id ON t_users(sync_id);");
  } catch (indexErr: any) {
    log.warn("[SAFETY NET] Impossible de crÃ©er les index de synchronisation :", indexErr.message);
  }

  // t_centres et t_sites : colonnes code, prefixe_rangement, is_dirty, et updated_at (V45 + sÃ©curitÃ© permanente)
  safeAlter('t_centres', 'code', 'TEXT');
  safeAlter('t_centres', 'prefixe_rangement', 'TEXT');
  safeAlter('t_centres', 'is_dirty', 'INTEGER DEFAULT 0');
  safeAlter('t_centres', 'updated_at', 'TEXT');
  safeAlter('t_sites', 'is_dirty', 'INTEGER DEFAULT 0');
  safeAlter('t_sites', 'updated_at', 'TEXT');

  // t_import_anomalies : colonnes d'identitÃ© (V33)
  safeAlter('t_import_anomalies', 'noms', 'TEXT');
  safeAlter('t_import_anomalies', 'prenoms', 'TEXT');
  safeAlter('t_import_anomalies', 'date_de_naissance', 'TEXT');
  safeAlter('t_import_anomalies', 'num_secu', 'TEXT');
  safeAlter('t_import_anomalies', 'contact', 'TEXT');
  safeAlter('t_import_anomalies', 'site_id', 'INTEGER');
  safeAlter('t_import_anomalies', 'erreur_message', 'TEXT');
  safeAlter('t_import_anomalies', 'lieu_de_naissance', 'TEXT');
  safeAlter('t_import_anomalies', 'rangement', 'TEXT');

  // â”€â”€ audit_logs : table de logs d'audit (V21) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Garantie universelle : crÃ©e la table si elle n'existe pas (bases prÃ©-V21
  // ou reconstructions d'urgence qui auraient omis migrateV21).
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operator_id TEXT,
        action_type TEXT,
        details TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    log.info('[SAFETY NET] Table audit_logs garantie.');
  } catch (e: any) {
    log.warn('[SAFETY NET] Impossible de garantir audit_logs :', e.message);
  }

  // VÃ©rification et suppression automatique de l'ancienne contrainte CHECK sur action_type (pour bases existantes)
  try {
    const tableSqlRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_logs'").get() as { sql?: string } | undefined;
    if (tableSqlRow?.sql && tableSqlRow.sql.includes('CHECK(action_type IN')) {
      log.info('[SAFETY NET] Table audit_logs possÃ¨de une ancienne contrainte CHECK restrictive sur action_type. Reconstruction sans CHECK...');
      db.exec('PRAGMA foreign_keys = OFF;');
      db.transaction(() => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS audit_logs_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operator_id TEXT,
            action_type TEXT,
            details TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);
        db.exec(`INSERT INTO audit_logs_new (id, operator_id, action_type, details, timestamp) SELECT id, operator_id, action_type, details, timestamp FROM audit_logs;`);
        db.exec(`DROP TABLE audit_logs;`);
        db.exec(`ALTER TABLE audit_logs_new RENAME TO audit_logs;`);
      })();
      db.exec('PRAGMA foreign_keys = ON;');
      log.info('[SAFETY NET] Table audit_logs reconfigurÃ©e avec succÃ¨s sans contrainte CHECK.');
    }
  } catch (fixErr: any) {
    log.warn('[SAFETY NET] Erreur lors de la reconfiguration de audit_logs :', fixErr.message || fixErr);
  }

  // â”€â”€ t_user_roles : table des rÃ´les multiples (V22) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS t_user_roles (
        id_user INTEGER NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('SUPER ADMIN','ADMINISTRATEUR_SITE','ADMIN_CENTRE','OPERATEUR_VERIFICATION','OPERATEUR_QUALITE','OPERATEUR_SAISIE','OPERATEUR_LOGISTIQUE','OPERATEUR_INVENTAIRE')),
        PRIMARY KEY (id_user, role),
        FOREIGN KEY (id_user) REFERENCES t_users(id_user) ON DELETE CASCADE
      );
    `);
    log.info('[SAFETY NET] Table t_user_roles garantie.');
  } catch (e: any) {
    log.warn('[SAFETY NET] Impossible de garantir t_user_roles :', e.message);
  }

  log.info('[SAFETY NET] VÃ©rification des colonnes critiques terminÃ©e.');
}

// =====================================================
// MIGRATION V34 : Optimisation de la requÃªte stats:get
// CrÃ©ation d'index composÃ©s pour soulager les GROUP BY
// sur les doublons stricts et probables.
// =====================================================
function migrateV34(db: Database.Database): void {
  try {
    // Optimise "doublons_probables" : WHERE site_id = ? GROUP BY noms, prenoms, date_de_naissance
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_stats_doublons_probables ON t_cartes(site_id, noms, prenoms, date_de_naissance);');
    // Optimise "doublons_stricts" : WHERE site_id = ? GROUP BY cle_doublon
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_stats_cle_doublon ON t_cartes(site_id, cle_doublon);');
    
    log.info('[MIGRATION V34] Index d\'optimisation pour stats:get crÃ©Ã©s avec succÃ¨s.');
  } catch (e: any) {
    log.error('[MIGRATION V34] Ã‰chec lors de la crÃ©ation des index d\'optimisation :', e.message);
    throw e;
  }
}

// =====================================================
// MIGRATION V35 : Remplacement de l'index V34 par un Covering Index 
// complet pour Ã©viter le gel du thread principal. 
// L'index V34 exigeait encore un "table lookup" pour extraire "cle_doublon"
// =====================================================
function migrateV35(db: Database.Database): void {
  try {
    log.info('[MIGRATION V35] DÃ©marrage de la migration V35...');
    
    // Covering index parfait pour la requÃªte des doublons probables
    // SQLite n'a plus besoin d'accÃ©der Ã  la table principale.
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_stats_dp_v2 ON t_cartes(site_id, noms, prenoms, date_de_naissance, cle_doublon);');
    
    // Covering index parfait pour la requÃªte des KPI globaux
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_stats_kpi ON t_cartes(site_id, statut, statut_physique, num_secu, rangement);');
    
    log.info('[MIGRATION V35] Nouveaux index couvrants (Covering Index) crÃ©Ã©s avec succÃ¨s.');
  } catch (e: any) {
    log.error('[MIGRATION V35] Ã‰chec lors de la crÃ©ation des index couvrants :', e.message);
    throw e;
  }
}

function migrateV36(db: Database.Database): void {
  try {
    log.info('[MIGRATION V36] DÃ©marrage de la migration V36...');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_site_date_delivrance ON t_cartes(site_id, date_delivrance);');
    log.info('[MIGRATION V36] Index idx_cartes_site_date_delivrance created.');
  } catch (e: any) {
    log.error('[MIGRATION V36] Failed to create index:', e.message);
    throw e;
  }
}

function migrateV37(db: Database.Database): void {

  try {

    log.info('[MIGRATION V37] Demarrage de la migration V37...');

    const tableInfo = db.pragma('table_info(t_cartes)') as any[];

    const hasNoteSignalement = tableInfo.some((col: any) => col.name === 'note_signalement_absence');

    if (!hasNoteSignalement) {

      db.exec('ALTER TABLE t_cartes ADD COLUMN note_signalement_absence TEXT;');

      log.info('[MIGRATION V37] Colonne note_signalement_absence ajoutee.');

    }

    const hasEscaladeNiveau = tableInfo.some((col: any) => col.name === 'escalade_niveau');

    if (!hasEscaladeNiveau) {

      db.exec("ALTER TABLE t_cartes ADD COLUMN escalade_niveau TEXT DEFAULT 'CENTRE' CHECK(escalade_niveau IN ('CENTRE', 'SITE', 'RESOLU'));");

      log.info('[MIGRATION V37] Colonne escalade_niveau ajoutee.');

    }

  } catch (e: any) {

    log.error('[MIGRATION V37] Failed to alter table:', e.message);

    throw e;

  }

}



function migrateV39(db: Database.Database): void {

  try {

    log.info('[MIGRATION V39] Ajout de la colonne contact_retirant a t_cartes...');

    const tableInfo = db.pragma('table_info(t_cartes)') as any[];

    const hasContactRetirant = tableInfo.some((col: any) => col.name === 'contact_retirant');

    if (!hasContactRetirant) {

      db.exec('ALTER TABLE t_cartes ADD COLUMN contact_retirant TEXT;');

      log.info('[MIGRATION V39] Colonne contact_retirant ajoutee.');

    } else {

      log.info('[MIGRATION V39] Colonne contact_retirant deja presente, migration ignoree.');

    }

  } catch (e: any) {

    log.error('[MIGRATION V39] Failed to alter table:', e.message);

    throw e;

  }

}

function migrateV40(db: Database.Database): void {
  try {
    log.info('[MIGRATION V40] Ajout de expiry_date et is_permanent a t_sites...');
    const tableInfo = db.pragma('table_info(t_sites)') as any[];
    
    const hasExpiryDate = tableInfo.some((col: any) => col.name === 'expiry_date');
    if (!hasExpiryDate) {
      db.exec('ALTER TABLE t_sites ADD COLUMN expiry_date TEXT;');
      log.info('[MIGRATION V40] Colonne expiry_date ajoutee.');
    } else {
      log.info('[MIGRATION V40] Colonne expiry_date deja presente, migration ignoree.');
    }

    const hasIsPermanent = tableInfo.some((col: any) => col.name === 'is_permanent');
    if (!hasIsPermanent) {
      db.exec('ALTER TABLE t_sites ADD COLUMN is_permanent INTEGER DEFAULT 0;');
      log.info('[MIGRATION V40] Colonne is_permanent ajoutee.');
    } else {
      log.info('[MIGRATION V40] Colonne is_permanent deja presente, migration ignoree.');
    }
  } catch (e: any) {
    log.error('[MIGRATION V40] Failed to alter table t_sites:', e.message);
    throw e;
  }
}

function migrateV42(db: Database.Database): void {
  try {
    log.info('[MIGRATION V42] Modification de t_outbox pour autoriser DELETE...');
    // Renommer la table existante
    db.exec('ALTER TABLE t_outbox RENAME TO t_outbox_old;');
    
    // RecrÃ©er la table avec la contrainte mise Ã  jour
    db.exec(`
      CREATE TABLE t_outbox (
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
    `);

    // Migrer les donnÃ©es
    db.exec('INSERT INTO t_outbox SELECT * FROM t_outbox_old;');

    // Supprimer l'ancienne table
    db.exec('DROP TABLE t_outbox_old;');
    
    log.info('[MIGRATION V42] t_outbox modifiÃ©e avec succÃ¨s.');
  } catch (e: any) {
    log.error('[MIGRATION V42] Erreur :', e.message);
    throw e;
  }
}

function migrateV43(db: Database.Database): void {
  try {
    log.info('[MIGRATION V43] Reconstruction de t_cartes pour ajouter BROUILLON au CHECK statut...');

    // Ã‰tape 1 : Renommer la table existante
    db.exec('ALTER TABLE t_cartes RENAME TO t_cartes_v42_backup;');

    // Ã‰tape 2 : RecrÃ©er la table avec la contrainte Ã©tendue
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
        statut TEXT DEFAULT 'EN STOCK' CHECK(statut IN ('EN STOCK','DELIVRE','DISTRIBUEE','RETIRE','ANNULE','BROUILLON')),
        date_delivrance TEXT,
        agent_saisie TEXT,
        nom_retirant TEXT,
        num_retirant TEXT,
        agent_distributeur TEXT,
        centre_retrait TEXT,
        cle_doublon TEXT,
        cle_doublon_flex TEXT,
        statut_physique TEXT DEFAULT 'OK' CHECK(statut_physique IN ('OK','ABIMEE','PERDUE')),
        site_id INTEGER,
        centre_id INTEGER,
        poste_id INTEGER,
        sync_id TEXT UNIQUE,
        is_dirty INTEGER DEFAULT 1,
        is_exported INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        synced_at TEXT,
        qr_code_data TEXT,
        created_by INTEGER,
        note_signalement_absence TEXT,
        escalade_niveau TEXT,
        contact_retirant TEXT,
        has_invalid_date INTEGER DEFAULT 0,
        FOREIGN KEY (site_id) REFERENCES t_sites(id),
        FOREIGN KEY (centre_id) REFERENCES t_centres(id)
      );
    `);

    // Ã‰tape 3 : Copier toutes les donnÃ©es
    db.exec(`
      INSERT INTO t_cartes
      SELECT
        id_carte, noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu,
        lieu_enrolement, contact, rangement, statut, date_delivrance, agent_saisie,
        nom_retirant, num_retirant, agent_distributeur, centre_retrait,
        cle_doublon, cle_doublon_flex, statut_physique, site_id, centre_id, poste_id,
        sync_id, is_dirty, is_exported, created_at, updated_at, synced_at, qr_code_data,
        created_by, note_signalement_absence, escalade_niveau,
        CASE WHEN typeof(contact_retirant) = 'text' THEN contact_retirant ELSE NULL END,
        CASE WHEN typeof(has_invalid_date) = 'integer' THEN has_invalid_date ELSE 0 END
      FROM t_cartes_v42_backup;
    `);

    // Ã‰tape 4 : RecrÃ©er les indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cartes_site_statut ON t_cartes(site_id, statut);
      CREATE INDEX IF NOT EXISTS idx_cartes_sync_id ON t_cartes(sync_id);
      CREATE INDEX IF NOT EXISTS idx_cartes_is_dirty ON t_cartes(is_dirty);
      CREATE INDEX IF NOT EXISTS idx_cartes_cle_doublon ON t_cartes(cle_doublon);
      CREATE INDEX IF NOT EXISTS idx_cartes_created_by ON t_cartes(created_by);
      CREATE INDEX IF NOT EXISTS idx_cartes_date_delivrance ON t_cartes(date_delivrance);
      CREATE INDEX IF NOT EXISTS idx_cartes_created_at ON t_cartes(created_at);
      CREATE INDEX IF NOT EXISTS idx_cartes_identite_civile ON t_cartes(noms, prenoms, date_de_naissance);
      CREATE INDEX IF NOT EXISTS idx_cartes_cle_doublon_strict ON t_cartes(cle_doublon, site_id, is_dirty);
      CREATE INDEX IF NOT EXISTS idx_cartes_has_invalid_date ON t_cartes(has_invalid_date) WHERE has_invalid_date = 1;
    `);

    // Ã‰tape 5 : Supprimer la table de sauvegarde
    db.exec('DROP TABLE t_cartes_v42_backup;');

    log.info('[MIGRATION V43] Contrainte statut Ã©tendue avec BROUILLON avec succÃ¨s.');
  } catch (e: any) {
    log.error('[MIGRATION V43] Erreur :', e.message);
    // Rollback de la table de sauvegarde si elle existe
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='t_cartes_v42_backup'").get();
      if (tables) {
        const mainExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='t_cartes'").get();
        if (!mainExists) {
          db.exec('ALTER TABLE t_cartes_v42_backup RENAME TO t_cartes;');
          log.warn('[MIGRATION V43] Rollback effectuÃ© : t_cartes restaurÃ©e depuis la sauvegarde.');
        }
      }
    } catch (rollbackErr) {
      log.error('[MIGRATION V43] Erreur pendant le rollback :', rollbackErr);
    }
    throw e;
  }
}

// =====================================================
// MIGRATION V44 : Ajout de is_dirty et updated_at sur t_import_anomalies
// =====================================================
function migrateV44(db: Database.Database): void {
  try {
    log.info('[MIGRATION V44] Ajout de is_dirty et updated_at sur t_import_anomalies...');
    
    const tableInfo = db.prepare("PRAGMA table_info(t_import_anomalies)").all() as { name: string }[];
    const hasColumn = (colName: string) => tableInfo.some(col => col.name === colName);

    if (!hasColumn('is_dirty')) {
      db.exec("ALTER TABLE t_import_anomalies ADD COLUMN is_dirty INTEGER DEFAULT 0;");
      log.info("[MIGRATION V44] Column 'is_dirty' added to t_import_anomalies.");
    }
    if (!hasColumn('updated_at')) {
      db.exec("ALTER TABLE t_import_anomalies ADD COLUMN updated_at TEXT;");
      log.info("[MIGRATION V44] Column 'updated_at' added to t_import_anomalies.");
    }
    
    // Index pour la recherche des anomalies  synchroniser manuellement
    db.exec("CREATE INDEX IF NOT EXISTS idx_import_anomalies_is_dirty ON t_import_anomalies(is_dirty);");
    
    log.info('[MIGRATION V44] Migration V44 termine avec succs.');
  } catch (e: any) {
    log.error('[MIGRATION V44] Erreur :', e.message);
    throw e;
  }
}

// =====================================================
// MIGRATION V45 : Ajout de is_dirty et updated_at sur t_sites et t_centres
// =====================================================
function migrateV45(db: Database.Database): void {
  try {
    log.info('[MIGRATION V45] Ajout de is_dirty et updated_at sur t_sites et t_centres...');
    
    for (const table of ['t_sites', 't_centres']) {
      const tableInfo = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      const hasColumn = (colName: string) => tableInfo.some(col => col.name === colName);

      if (!hasColumn('is_dirty')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN is_dirty INTEGER DEFAULT 0;`);
        log.info(`[MIGRATION V45] Column 'is_dirty' added to ${table}.`);
      }
      if (!hasColumn('updated_at')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN updated_at TEXT;`);
        log.info(`[MIGRATION V45] Column 'updated_at' added to ${table}.`);
      }
    }
    
    log.info('[MIGRATION V45] Migration V45 terminÃ©e avec succÃ¨s.');
  } catch (e: any) {
    log.error('[MIGRATION V45] Erreur :', e.message);
    throw e;
  }
}

// =====================================================
// MIGRATION V46 : Index composites pour stats-worker (performance critique)
// Cible : remplacer les full-scan de 200k lignes par des lookups indexÃ©s < 10ms
// =====================================================
function migrateV46(db: Database.Database): void {
  try {
    log.info('[MIGRATION V46] CrÃ©ation des index composites pour le stats-worker...');

    // Index principal pour la CTE dirty_base : (site_id, is_dirty, statut)
    // AccÃ©lÃ¨re le filtre de base de toutes les requÃªtes getDetailedSyncStats
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_site_dirty_statut ON t_cartes(site_id, is_dirty, statut);');

    // Index pour la sÃ©paration clean/modified (filtre sur synced_at)
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_site_dirty_synced ON t_cartes(site_id, is_dirty, synced_at, statut);');

    // Index pour la dÃ©tection des doublons stricts (filtre sur cle_doublon par site)
    // DÃ©jÃ  couvert par idx_cartes_site_cle_doublon - vÃ©rification defensive
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_site_cle_doublon ON t_cartes(site_id, cle_doublon);');

    // Index pour la dÃ©tection des doublons probables (filtre identitÃ© par site)
    // DÃ©jÃ  couvert par idx_cartes_stats_dp_v2 - vÃ©rification defensive
    db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_site_identite ON t_cartes(site_id, noms, prenoms, date_de_naissance);');

    // Index pour t_import_anomalies (filtre site_id + type_anomalie)
    db.exec('CREATE INDEX IF NOT EXISTS idx_import_anomalies_site_type ON t_import_anomalies(site_id, type_anomalie);');

    log.info('[MIGRATION V46] Index composites crÃ©Ã©s avec succÃ¨s. Performance stats-worker optimisÃ©e.');
  } catch (e: any) {
    log.error('[MIGRATION V46] Erreur :', e.message);
    throw e;
  }
}

// =====================================================
// MIGRATION V47 : Ajout de lieu_enrolement, statut, date_delivrance sur t_import_anomalies
// =====================================================
function migrateV47(db: Database.Database): void {
  try {
    log.info('[MIGRATION V47] Ajout de lieu_enrolement, statut, date_delivrance sur t_import_anomalies...');
    
    const tableInfo = db.prepare("PRAGMA table_info(t_import_anomalies)").all() as { name: string }[];
    const hasColumn = (colName: string) => tableInfo.some(col => col.name === colName);

    if (!hasColumn('lieu_enrolement')) {
      db.exec("ALTER TABLE t_import_anomalies ADD COLUMN lieu_enrolement TEXT;");
      log.info("[MIGRATION V47] Column 'lieu_enrolement' added to t_import_anomalies.");
    }
    if (!hasColumn('statut')) {
      db.exec("ALTER TABLE t_import_anomalies ADD COLUMN statut TEXT;");
      log.info("[MIGRATION V47] Column 'statut' added to t_import_anomalies.");
    }
    if (!hasColumn('date_delivrance')) {
      db.exec("ALTER TABLE t_import_anomalies ADD COLUMN date_delivrance TEXT;");
      log.info("[MIGRATION V47] Column 'date_delivrance' added to t_import_anomalies.");
    }
    
    log.info('[MIGRATION V47] Migration V47 terminee avec succes.');
  } catch (e: any) {
    log.error('[MIGRATION V47] Erreur :', e.message);
    throw e;
  }
}

function migrateV48(db: Database.Database): void {
  try {
    db.exec('ALTER TABLE t_cartes ADD COLUMN updated_by INTEGER DEFAULT NULL;');
    log.info('Migration V48: Added updated_by to t_cartes');
  } catch (e) {
    log.warn('Migration V48: Column might already exist');
  }
}

function migrateV49(db: Database.Database): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS t_agent_archives (
        id_carte INTEGER NOT NULL,
        login_user TEXT NOT NULL,
        archived_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id_carte, login_user)
      );
    `);
    log.info('Migration V49: Created t_agent_archives table');
  } catch (e) {
    log.error('Migration V49 Error:', e);
  }
}
