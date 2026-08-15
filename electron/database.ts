// electron/database.ts
import Database from "./sqlite-adapter.js"
import path from "node:path"
import electron from "electron"
import fs from "node:fs"
import { randomUUID } from "node:crypto"
import type { DatabaseHealthResult } from "../src/lib/database-provider.js"

import {
  CREATE_TABLES_SQL,
  CONFIGURE_INITIAL_CURRENCIES_V5_SQL,
  SEED_MASTER_DATA_SQL,
  SCHEMA_VERSION,
} from "../src/lib/db/schema.js"

let db: Database.Database | null = null
let initializationPromise: Promise<void> | null = null
let databasePathOverride: string | null = null
const electronApp = electron.app

// ============== Configuration ==============

const DB_FILE_NAME = "armory_store.db"
const DATABASE_MODE = process.env.NODE_ENV === "test" ? "test" : "production"

// ============== Utility functions ==============

export interface DatabaseBackupInfo {
  fileName: string
  createdAt: string
  sizeBytes: number
}

function log(level: "info" | "warn" | "error", event: string, details: Record<string, unknown> = {}): void {
  const payload = { scope: "database", event, timestamp: new Date().toISOString(), ...details }
  console[level](JSON.stringify(payload))
}

function formatBackupTimestamp(date: Date = new Date()): string {
  return date.toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-")
}

function isBackupName(fileName: string): boolean {
  return /^backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:_pre_migration)?(?:_\d+)?\.db$/.test(fileName)
}

function deleteSidecarFiles(dbPath: string): void {
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${dbPath}${suffix}`
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar)
  }
}

export function closeDatabase(): void {
  if (!db) return

  try {
    db.close()
  } finally {
    db = null
    initializationPromise = null
  }

  log("info", "database-closed")
}

// ============== Public API ==============

export function getDbDirectory(): string {
  const dbDir = databasePathOverride ? path.dirname(databasePathOverride) : path.join(electronApp.getPath("userData"), "db")
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })
  return dbDir
}

export function getDbPath(): string {
  return databasePathOverride ?? path.join(getDbDirectory(), DB_FILE_NAME)
}

export function getExpectedDbPath(): string {
  return databasePathOverride ?? path.join(electronApp.getPath("userData"), "db", DB_FILE_NAME)
}

export function setDatabasePathForTests(filename: string | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("Database path overrides are restricted to tests")
  if (db) throw new Error("Close the database before changing the test database path")
  databasePathOverride = filename == null ? null : path.resolve(filename)
}

export function getDb(): Database.Database {
  if (!db) throw new Error("Database not initialized. Call initDatabase() first.")
  return db
}

export function isDatabaseInitialized(): boolean {
  return db !== null
}

export function databaseHealthCheck(runIntegrityChecks = false): DatabaseHealthResult {
  const database = getDb()
  const probeId = randomUUID()
  database.transaction(() => {
    database.prepare("INSERT INTO database_health_probes(id) VALUES (?)").run(probeId)
    const found = database.prepare("SELECT id FROM database_health_probes WHERE id = ?").get(probeId) as { id: string } | undefined
    if (found?.id !== probeId) throw new Error("SQLite read/write probe did not return the inserted row")
    database.prepare("DELETE FROM database_health_probes WHERE id = ?").run(probeId)
  })()

  const details: DatabaseHealthResult["details"] = { connection: "ok", readWrite: "ok" }
  if (runIntegrityChecks) {
    const integrity = database.prepare("PRAGMA integrity_check").all() as Array<Record<string, unknown>>
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== "ok") throw new Error("SQLite integrity check failed")
    const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all()
    if (foreignKeyViolations.length > 0) throw new Error(`SQLite foreign-key check found ${foreignKeyViolations.length} violation(s)`)
    details.integrity = "ok"
    details.foreignKeys = "ok"
  }
  return {
    provider: "sqlite",
    healthy: true,
    schemaVersion: String(getSchemaVersion(database)),
    details,
  }
}

export function databaseExists(): boolean {
  return fs.existsSync(getExpectedDbPath())
}

export function listDatabaseBackups(): DatabaseBackupInfo[] {
  const dbDir = getDbDirectory()
  if (!fs.existsSync(dbDir)) return []
  return fs.readdirSync(dbDir)
    .filter(isBackupName)
    .map((fileName) => {
      const fullPath = path.join(dbDir, fileName)
      const stat = fs.statSync(fullPath)
      return { fileName, createdAt: stat.mtime.toISOString(), sizeBytes: stat.size }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function createDatabaseBackup(): DatabaseBackupInfo {
  if (!db) throw new Error("Database not initialized")
  const dbPath = getDbPath()
  if (!fs.existsSync(dbPath)) throw new Error("Database file not found")

  const timestamp = formatBackupTimestamp()
  let fileName = `backup_${timestamp}.db`
  let suffix = 1
  while (fs.existsSync(path.join(getDbDirectory(), fileName))) {
    fileName = `backup_${timestamp}_${suffix}.db`
    suffix++
  }

  const backupPath = path.join(getDbDirectory(), fileName)
  try { db.pragma("wal_checkpoint(FULL)") } catch (err) {
    log("warn", "backup-wal-checkpoint-failed", { error: String(err) })
  }
  fs.copyFileSync(dbPath, backupPath)
  const stat = fs.statSync(backupPath)
  const info = { fileName, createdAt: stat.mtime.toISOString(), sizeBytes: stat.size }
  log("info", "backup-created", info)
  return info
}

export function restoreDatabaseBackup(fileName: string): void {
  const safeFileName = path.basename(fileName)
  if (!isBackupName(safeFileName)) throw new Error("Invalid backup file name")
  const backupPath = path.join(getDbDirectory(), safeFileName)
  if (!fs.existsSync(backupPath)) throw new Error("Backup file not found")

  const dbPath = getDbPath()
  log("info", "backup-restore-started", { fileName: safeFileName })
  closeDatabase()
  deleteSidecarFiles(dbPath)
  fs.copyFileSync(backupPath, dbPath)
  deleteSidecarFiles(dbPath)
  initDatabaseSync()
  log("info", "backup-restore-completed", { fileName: safeFileName })
}

export function deleteDatabaseBackup(fileName: string): void {
  const safeFileName = path.basename(fileName)
  if (!isBackupName(safeFileName)) throw new Error("Invalid backup file name")
  const backupPath = path.join(getDbDirectory(), safeFileName)
  if (!fs.existsSync(backupPath)) throw new Error("Backup file not found")
  fs.unlinkSync(backupPath)
  log("info", "backup-deleted", { fileName: safeFileName })
}

// ============== Connection setup ==============

function openDatabase(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  const database = new Database(dbPath)

  try {
    database.pragma("journal_mode = WAL")
    database.pragma("synchronous = NORMAL")
    database.pragma("foreign_keys = ON")
    database.pragma("busy_timeout = 5000")
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

function getSchemaVersion(database: Database.Database): number {
  return Number(database.pragma("user_version", { simple: true }) ?? 0)
}

// ============== Initialization ==============

function initDatabaseSync(): void {
  if (db) return

  try {
    normalStartup()

    const database = getDb()
    ensureDefaultUserPreferences(database)
    validateFinalSchema(database)
  } catch (error) {
    closeDatabase()
    throw error
  }
}

export async function initDatabase(): Promise<void> {
  if (db) return
  if (initializationPromise) return initializationPromise

  initializationPromise = Promise.resolve().then(() => {
    initDatabaseSync()
    log("info", "database-initialized", {
      path: getDbPath(),
      schemaVersion: getSchemaVersion(getDb()),
      mode: DATABASE_MODE,
    })
  }).catch(error => {
    log("error", "database-initialization-failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }).finally(() => {
    initializationPromise = null
  })

  return initializationPromise
}

// ============== Production / normal startup ==============

function normalStartup(): void {
  const dbPath = getDbPath()
  const isFirstLaunch = !fs.existsSync(dbPath)

  log("info", "database-open-start", { dbPath, exists: fs.existsSync(dbPath), isFirstLaunch, DATABASE_MODE })
  db = openDatabase(dbPath)
  log("info", "database-open-success", { dbPath })

  if (isFirstLaunch) {
    db.exec(CREATE_TABLES_SQL)
    addColumnsIfMissing(db)
    ensureProviderSchema(db)
    db.exec(SEED_MASTER_DATA_SQL)
    db.pragma(`user_version = ${SCHEMA_VERSION}`)
    log("info", "database-schema-created", { schemaVersion: SCHEMA_VERSION })
  } else {
    runMigrations(db)
  }
}

// ============== Migration system (production only) ==============
// ============================================================
// Production Migration System
// V1 -> V3
// ============================================================

/**
 * Runs all database migrations required to bring the database
 * to the current schema version.
 *
 * Important:
 * - Migration is atomic.
 * - A backup is created ONLY when an actual migration is required.
 * - No rows are silently discarded.
 * - FK conversion is validated before rebuilding weapons.
 * - user_version is updated only after successful migration.
 */
function runMigrations(database: Database.Database): void {
  const currentVersion = getSchemaVersion(database)

  if (currentVersion > SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than the application version ${SCHEMA_VERSION}.`
    )
  }

  // ----------------------------------------------------------
  // 1. Database is already current
  // ----------------------------------------------------------

  if (currentVersion === SCHEMA_VERSION) {
    // The schema should already exist.
    // CREATE_TABLES_SQL is idempotent and acts as a final
    // integrity/safety pass.
    addColumnsIfMissing(database);
    database.exec(CREATE_TABLES_SQL);
    ensureProviderSchema(database);
    ensureDefaultUserPreferences(database);

    validateFinalSchema(database);

    return;
  }

  // ----------------------------------------------------------
  // 2. Validate the database before changing anything
  // ----------------------------------------------------------

  validateMigrationSource(database, currentVersion);

  // ----------------------------------------------------------
  // 3. Backup BEFORE migration
  // ----------------------------------------------------------

  createMigrationBackupSync(database);

  // ----------------------------------------------------------
  // 4. Atomic migration
  // ----------------------------------------------------------

  const migrate = database.transaction(() => {
    // ========================================================
    // V0/V1 -> V3
    // ========================================================

    migrateWeaponsToNormalizedSchema(database);

    migrateAmmunitionToV3(database);

    migrateCompatibilityTablesToV3(database);

    // Fix legacy payment method values while staying on schema V3.
    // migratePaymentMethodsToV3(database)

    // Ensure all current schema objects exist.
    //
    // This is intentionally executed INSIDE the migration
    // transaction so that failure rolls everything back.
    addColumnsIfMissing(database);
    database.exec(CREATE_TABLES_SQL);
    ensureProviderSchema(database);

    ensureDefaultUserPreferences(database);

    if (currentVersion < 5) {
      configureInitialCurrenciesV5(database);
    }

    // --------------------------------------------------------
    // Validate final schema BEFORE committing version
    // --------------------------------------------------------

    validateFinalSchema(database);

    // --------------------------------------------------------
    // Update user_version LAST
    // --------------------------------------------------------

    database.pragma(`user_version = ${SCHEMA_VERSION}`);
  });

  // Execute atomic migration.
  migrate();

  // ----------------------------------------------------------
  // 5. Final verification AFTER transaction
  // ----------------------------------------------------------

  const finalVersion = Number(
    database.pragma("user_version", { simple: true }) ?? 0
  );

  if (finalVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Migration completed but schema version is incorrect: ` +
      `expected ${SCHEMA_VERSION}, got ${finalVersion} `
    );
  }

  validateFinalSchema(database);
}

/**
 * V5 keeps every registered currency and all historical references, while
 * limiting new transactions to the initial four-currency operating set.
 * Any stale display preference is moved to USD so renderer startup cannot
 * attempt a conversion through a currency that has just become inactive.
 */
function configureInitialCurrenciesV5(database: Database.Database): void {
  database.exec(CONFIGURE_INITIAL_CURRENCIES_V5_SQL)
}


// ============================================================
// Migration source validation
// ============================================================

function validateMigrationSource(
  database: Database.Database,
  currentVersion: number
): void {
  const tables = getExistingTables(database);

  if (!tables.has("weapons")) {
    throw new Error(
      `Migration aborted: weapons table does not exist. ` +
      `Database version = ${currentVersion}.`
    );
  }

  const weaponsColumns = getTableColumns(database, "weapons");

  const hasLegacySchema =
    weaponsColumns.has("brand") &&
    weaponsColumns.has("model") &&
    weaponsColumns.has("weapon_type") &&
    weaponsColumns.has("sub_type") &&
    weaponsColumns.has("caliber") &&
    weaponsColumns.has("warehouse") &&
    weaponsColumns.has("shelf") &&
    weaponsColumns.has("bin");

  const hasNormalizedSchema =
    weaponsColumns.has("brand_id") &&
    weaponsColumns.has("model_id") &&
    weaponsColumns.has("weapon_type_id") &&
    weaponsColumns.has("weapon_subtype_id") &&
    weaponsColumns.has("caliber_id");

  // Already-normalized database but old user_version.
  // We must NOT try to run the legacy conversion again.
  if (hasNormalizedSchema && !hasLegacySchema) {
    return;
  }

  // Expected legacy database.
  if (hasLegacySchema) {
    return;
  }

  throw new Error(
    `Migration aborted: unsupported weapons schema for database` +
    `version ${currentVersion}.` +
    `The database is neither a recognized legacy schema nor a ` +
    `recognized normalized schema.`
  );
}


// ============================================================
// V1 -> V3 Weapons Migration
// ============================================================

function migrateWeaponsToNormalizedSchema(
  database: Database.Database
): void {
  const columns = getTableColumns(database, "weapons");

  // ----------------------------------------------------------
  // Already normalized
  // ----------------------------------------------------------

  const alreadyNormalized =
    columns.has("brand_id") &&
    columns.has("model_id") &&
    columns.has("weapon_type_id") &&
    columns.has("weapon_subtype_id") &&
    columns.has("caliber_id");

  const hasLegacyColumns =
    columns.has("brand") ||
    columns.has("model") ||
    columns.has("weapon_type") ||
    columns.has("sub_type") ||
    columns.has("caliber") ||
    columns.has("warehouse") ||
    columns.has("shelf") ||
    columns.has("bin");

  if (alreadyNormalized && !hasLegacyColumns) {
    // Nothing to rebuild.
    return;
  }

  // ----------------------------------------------------------
  // Verify legacy schema before migration
  // ----------------------------------------------------------

  verifyWeaponsTableSchema(database);

  // ----------------------------------------------------------
  // Add temporary migration columns if missing
  // ----------------------------------------------------------

  addColumnIfMissing(
    database,
    "weapons",
    "created_at",
    "TEXT NOT NULL DEFAULT (datetime('now'))"
  );

  addColumnIfMissing(
    database,
    "weapons",
    "updated_at",
    "TEXT NOT NULL DEFAULT (datetime('now'))"
  );

  addColumnIfMissing(
    database,
    "weapons",
    "weapon_type_id",
    "TEXT"
  );

  addColumnIfMissing(
    database,
    "weapons",
    "weapon_subtype_id",
    "TEXT"
  );

  addColumnIfMissing(
    database,
    "weapons",
    "caliber_id",
    "TEXT"
  );

  addColumnIfMissing(
    database,
    "weapons",
    "brand_id",
    "TEXT"
  );

  addColumnIfMissing(
    database,
    "weapons",
    "model_id",
    "TEXT"
  );

  addColumnIfMissing(
    database,
    "weapons",
    "storage_location_id",
    "TEXT"
  );

  // ----------------------------------------------------------
  // Populate timestamps
  // ----------------------------------------------------------

  database.exec(`
    UPDATE weapons
SET
created_at = COALESCE(created_at, datetime('now')),
  updated_at = COALESCE(updated_at, datetime('now'))
    WHERE created_at IS NULL
       OR updated_at IS NULL
  `);

  // ----------------------------------------------------------
  // Convert legacy text references -> FK IDs
  // ----------------------------------------------------------

  populateFkColumns(database);

  // ----------------------------------------------------------
  // CRITICAL:
  // Never silently drop rows.
  //
  // If any FK cannot be resolved, abort the migration.
  // ----------------------------------------------------------

  validateFkColumns(database);

  // ----------------------------------------------------------
  // Preserve exact row count
  // ----------------------------------------------------------

  const rowCountBefore = getTableRowCount(
    database,
    "weapons"
  );

  // ----------------------------------------------------------
  // Rebuild normalized table
  // ----------------------------------------------------------

  rebuildWeaponsTable(database);

  const rowCountAfter = getTableRowCount(
    database,
    "weapons"
  );

  if (rowCountBefore !== rowCountAfter) {
    throw new Error(
      `Migration aborted: weapons row count changed ` +
      `during rebuild: ${rowCountBefore} -> ${rowCountAfter} `
    );
  }

  // ----------------------------------------------------------
  // Verify no duplicate serial numbers appeared
  // ----------------------------------------------------------

  const duplicateSerials = database
    .prepare(`
      SELECT serial_number, COUNT(*) AS count
      FROM weapons
      GROUP BY serial_number
      HAVING COUNT(*) > 1
      LIMIT 1
    `)
    .get() as { serial_number: string; count: number } | undefined;

  if (duplicateSerials) {
    throw new Error(
      `Migration aborted: duplicate serial number detected: ` +
      `${duplicateSerials.serial_number} `
    );
  }
}


// ============================================================
// V3 Ammunition Migration
// ============================================================

function migrateAmmunitionToV3(
  database: Database.Database
): void {
  const tables = getExistingTables(database);

  if (!tables.has("ammunition")) {
    return;
  }

  const columns = getTableColumns(
    database,
    "ammunition"
  );

  // V2 databases may not have name.
  if (!columns.has("name")) {
    database.exec(`
      ALTER TABLE ammunition
      ADD COLUMN name TEXT NOT NULL DEFAULT ''
  `);

    // Existing V2 ammunition records:
    // use caliber as the initial display name.
    database.exec(`
      UPDATE ammunition
      SET name = caliber
      WHERE name = ''
  `);
  }
}


// ============================================================
// V3 Compatibility Tables
// ============================================================

function migrateCompatibilityTablesToV3(
  database: Database.Database
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ammunition_weapon_compatibility(
    ammunition_id TEXT NOT NULL
        REFERENCES ammunition(id)
        ON DELETE CASCADE,

    weapon_id TEXT NOT NULL
        REFERENCES weapons(id)
        ON DELETE RESTRICT,

    PRIMARY KEY(ammunition_id, weapon_id)
  ) STRICT;

    CREATE INDEX IF NOT EXISTS
idx_awc_ammo
      ON ammunition_weapon_compatibility(ammunition_id);

    CREATE INDEX IF NOT EXISTS
idx_awc_weapon
      ON ammunition_weapon_compatibility(weapon_id);


    CREATE TABLE IF NOT EXISTS accessory_weapon_compatibility(
  accessory_id TEXT NOT NULL
        REFERENCES accessories(id)
        ON DELETE CASCADE,

  weapon_id TEXT NOT NULL
        REFERENCES weapons(id)
        ON DELETE RESTRICT,

  PRIMARY KEY(accessory_id, weapon_id)
) STRICT;

    CREATE INDEX IF NOT EXISTS
idx_accwc_acc
      ON accessory_weapon_compatibility(accessory_id);

    CREATE INDEX IF NOT EXISTS
idx_accwc_weapon
      ON accessory_weapon_compatibility(weapon_id);
`);
}

// ============================================================
// Add missing columns to current schema
// ============================================================

function addColumnsIfMissing(
  database: Database.Database
): void {
  const tables = getExistingTables(database);

  if (tables.has("users")) {
    const usersSql = String((database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get() as { sql?: string } | undefined)?.sql ?? "")
    const userColumns = getTableColumns(database, "users")
    const usesLegacyRoleConstraint = /Read-Only|Manager|Accountant|Inventory|Sales/.test(usersSql)
    if (usesLegacyRoleConstraint && userColumns.has("role") && !userColumns.has("legacy_role")) {
      database.exec(`
        ALTER TABLE users RENAME COLUMN role TO legacy_role;
        ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'Employee' CHECK (role IN ('Admin','Employee'));
        UPDATE users SET role = CASE WHEN legacy_role = 'Admin' THEN 'Admin' ELSE 'Employee' END;
      `)
    }
  }

  const settingsColumns: Array<[string, string]> = [
    [
      "number_format",
      "TEXT NOT NULL DEFAULT 'en-US'"
    ],
    [
      "company_name",
      "TEXT NOT NULL DEFAULT ''"
    ],
    [
      "company_address",
      "TEXT NOT NULL DEFAULT ''"
    ],
    [
      "company_phone",
      "TEXT NOT NULL DEFAULT ''"
    ],
    [
      "company_email",
      "TEXT NOT NULL DEFAULT ''"
    ],
    [
      "company_tax_id",
      "TEXT NOT NULL DEFAULT ''"
    ],
    [
      "theme",
      "TEXT NOT NULL DEFAULT 'system'"
    ],
    [
      "accounting_currency_code",
      "TEXT NOT NULL DEFAULT 'USD'"
    ],
    [
      "rate_base_currency_code",
      "TEXT NOT NULL DEFAULT 'USD'"
    ],
  ];

  const additions: Record<string, Array<[string, string]>> = {
    system_settings: settingsColumns,
    weapons: [
      ["wholesale_price_valuation", "TEXT"],
      ["actual_final_price_valuation", "TEXT"],
      ["retail_price_mode", "TEXT NOT NULL DEFAULT 'manual'"],
      ["wholesale_price_mode", "TEXT NOT NULL DEFAULT 'manual'"],
    ],
    invoices: [
      ["currency", "TEXT"],
      ["accounting_currency", "TEXT"],
      ["exchange_rate", "TEXT"],
      ["exchange_rate_date", "TEXT"],
      ["rate_source", "TEXT"],
      ["total_original_accounting", "TEXT"],
      ["total_negotiated_accounting", "TEXT"],
      ["total_paid_accounting", "TEXT"],
      ["balance_accounting", "TEXT"],
      ["tax_amount_accounting", "TEXT"],
    ],
    payment_records: [
      ["currency", "TEXT"],
      ["accounting_amount", "TEXT"],
      ["accounting_currency", "TEXT"],
      ["exchange_rate", "TEXT"],
      ["exchange_rate_date", "TEXT"],
      ["rate_source", "TEXT"],
      ["rate_id", "TEXT"],
    ],
    accessories: [
      ["price_currency", "TEXT"],
      ["price_valuation", "TEXT"],
      ["retail_price", "REAL NOT NULL DEFAULT 0"],
      ["wholesale_price", "REAL NOT NULL DEFAULT 0"],
      ["retail_price_valuation", "TEXT"],
      ["wholesale_price_valuation", "TEXT"],
      ["retail_price_mode", "TEXT NOT NULL DEFAULT 'manual'"],
      ["wholesale_price_mode", "TEXT NOT NULL DEFAULT 'manual'"],
    ],
    ammunition: [
      ["price_currency", "TEXT"],
      ["price_valuation", "TEXT"],
      ["retail_price", "REAL NOT NULL DEFAULT 0"],
      ["wholesale_price", "REAL NOT NULL DEFAULT 0"],
      ["retail_price_valuation", "TEXT"],
      ["wholesale_price_valuation", "TEXT"],
      ["retail_price_mode", "TEXT NOT NULL DEFAULT 'manual'"],
      ["wholesale_price_mode", "TEXT NOT NULL DEFAULT 'manual'"],
    ],
    exchange_rate_audit_log: [
      ["source", "TEXT NOT NULL DEFAULT 'manual'"],
    ],
    shipments: [
      ["workflow_status", "TEXT NOT NULL DEFAULT 'draft'"],
      ["import_id", "TEXT"],
      ["arrival_note", "TEXT"],
      ["delay_reason", "TEXT"],
      ["last_arrival_prompt_at", "TEXT"],
      ["planned_costs", "TEXT NOT NULL DEFAULT '[]'"],
      ["created_at", "TEXT NOT NULL DEFAULT ''"],
      ["updated_at", "TEXT NOT NULL DEFAULT ''"],
    ],
    shipment_imports: [
      ["review_note", "TEXT"],
      ["additional_costs", "TEXT NOT NULL DEFAULT '[]'"],
    ],
    shipment_import_items: [
      ["retail_price", "REAL"],
      ["wholesale_price", "REAL"],
      ["retail_price_mode", "TEXT NOT NULL DEFAULT 'manual'"],
      ["wholesale_price_mode", "TEXT NOT NULL DEFAULT 'manual'"],
      ["additional_costs", "TEXT NOT NULL DEFAULT '[]'"],
    ],
    customers: [
      ["notes", "TEXT NOT NULL DEFAULT ''"],
      ["custom_fields", "TEXT NOT NULL DEFAULT '{}'"],
    ],
    users: [
      ["email", "TEXT"],
      ["login_email", "TEXT"],
      ["is_active", "INTEGER NOT NULL DEFAULT 1"],
      ["is_primary_admin", "INTEGER NOT NULL DEFAULT 0"],
      ["activation_token_hash", "TEXT"],
      ["activation_expires_at", "TEXT"],
      ["failed_login_attempts", "INTEGER NOT NULL DEFAULT 0"],
      ["locked_until", "TEXT"],
      ["created_at", "TEXT NOT NULL DEFAULT ''"],
      ["updated_at", "TEXT NOT NULL DEFAULT ''"],
    ],
    audit_logs: [
      ["entity_type", "TEXT"],
      ["entity_id", "TEXT"],
      ["entity_name", "TEXT"],
      ["previous_values", "TEXT"],
      ["new_values", "TEXT"],
      ["reason", "TEXT"],
      ["user_name", "TEXT"],
      ["event_key", "TEXT"],
      ["details", "TEXT NOT NULL DEFAULT '{}'"],
      ["item_count", "INTEGER NOT NULL DEFAULT 1"],
      ["importance", "INTEGER NOT NULL DEFAULT 1"],
      ["is_visible", "INTEGER NOT NULL DEFAULT 1"],
    ],
    app_notifications: [
      ["user_id", "TEXT"],
    ],
    saved_filters: [
      ["user_id", "TEXT"],
      ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ],
    user_preferences: [
      ["inventory_visible_columns", "TEXT NOT NULL DEFAULT '[]'"],
    ],
    shipment_status_history: [
      ["import_id", "TEXT"],
      ["old_status", "TEXT"],
      ["new_status", "TEXT"],
      ["reason", "TEXT"],
    ],
  };

  for (const [table, columns] of Object.entries(additions)) {
    if (!tables.has(table)) continue
    const existing = getTableColumns(database, table)
    for (const [column, definition] of columns) {
      if (!existing.has(column)) addColumnIfMissing(database, table, column, definition)
    }
  }

  backfillLegacyFinancialSnapshots(database)

  database.exec(`
    UPDATE shipments SET created_at = COALESCE(NULLIF(created_at, ''), shipment_date), updated_at = COALESCE(NULLIF(updated_at, ''), shipment_date);
    UPDATE saved_filters SET created_at = datetime('now') WHERE created_at = '';
    UPDATE users SET created_at = COALESCE(NULLIF(created_at, ''), datetime('now')), updated_at = COALESCE(NULLIF(updated_at, ''), datetime('now'));
    UPDATE users SET is_primary_admin = 1
      WHERE id = (SELECT id FROM users WHERE role = 'Admin' ORDER BY id LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM users WHERE is_primary_admin = 1);
  `)
}

function ensureProviderSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_installation (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      installation_id TEXT NOT NULL,
      store_name TEXT NOT NULL DEFAULT '',
      schema_version TEXT NOT NULL,
      setup_completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    ) STRICT;

    CREATE TABLE IF NOT EXISTS inventory_product_types (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK (category IN ('accessory','ammunition')),
      name TEXT NOT NULL COLLATE NOCASE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(category, name)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS app_backups (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      file_name TEXT NOT NULL UNIQUE,
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    ) STRICT;

    CREATE TABLE IF NOT EXISTS account_auth_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      identifier_hash TEXT NOT NULL,
      succeeded INTEGER NOT NULL CHECK (succeeded IN (0,1)),
      attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
    ) STRICT;

    CREATE TABLE IF NOT EXISTS business_id_counters (
      prefix TEXT PRIMARY KEY,
      last_value INTEGER NOT NULL CHECK (last_value >= 0)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS database_health_probes (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_users_username_nocase ON users(username COLLATE NOCASE);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_email_unique ON users(login_email COLLATE NOCASE) WHERE login_email IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_weapons_serial_search ON weapons(serial_number COLLATE NOCASE) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_shipments_workflow_date ON shipments(workflow_status, expected_arrival_date);
    CREATE INDEX IF NOT EXISTS idx_invoices_status_date ON invoices(status, date DESC);
    CREATE INDEX IF NOT EXISTS idx_payments_invoice_date ON payment_records(invoice_id, date DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_entity_time ON audit_logs(entity_type, entity_id, timestamp DESC);

    CREATE TRIGGER IF NOT EXISTS trg_shipments_supplier_insert
    BEFORE INSERT ON shipments
    WHEN NEW.supplier_id <> '' AND NOT EXISTS (SELECT 1 FROM suppliers WHERE id = NEW.supplier_id)
    BEGIN SELECT RAISE(ABORT, 'shipment supplier foreign key violation'); END;
    CREATE TRIGGER IF NOT EXISTS trg_shipments_supplier_update
    BEFORE UPDATE OF supplier_id ON shipments
    WHEN NEW.supplier_id <> '' AND NOT EXISTS (SELECT 1 FROM suppliers WHERE id = NEW.supplier_id)
    BEGIN SELECT RAISE(ABORT, 'shipment supplier foreign key violation'); END;
    CREATE TRIGGER IF NOT EXISTS trg_payments_invoice_insert
    BEFORE INSERT ON payment_records
    WHEN NOT EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id)
    BEGIN SELECT RAISE(ABORT, 'payment invoice foreign key violation'); END;
    CREATE TRIGGER IF NOT EXISTS trg_payments_invoice_update
    BEFORE UPDATE OF invoice_id ON payment_records
    WHEN NOT EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id)
    BEGIN SELECT RAISE(ABORT, 'payment invoice foreign key violation'); END;
  `)

  const installationId = `local-${randomUUID()}`
  database.prepare(`
    INSERT OR IGNORE INTO app_installation(singleton, installation_id, schema_version)
    VALUES (1, ?, ?)
  `).run(installationId, String(SCHEMA_VERSION))
  database.prepare("UPDATE app_installation SET schema_version = ?, updated_at = datetime('now') WHERE singleton = 1")
    .run(String(SCHEMA_VERSION))
}

function backfillLegacyFinancialSnapshots(database: Database.Database): void {
  const tables = getExistingTables(database)
  if (!tables.has("invoices") || !tables.has("payment_records")) return

  database.exec(`
    UPDATE invoices
    SET
      currency = json_extract(total_valuation, '$.originalCurrency'),
      accounting_currency = COALESCE(
        json_extract(total_valuation, '$.accountingCurrency'),
        CASE WHEN json_type(total_valuation, '$.accountingAmountUSD') IS NOT NULL THEN 'USD' END
      ),
      exchange_rate = CAST(json_extract(total_valuation, '$.exchangeRate') AS TEXT),
      exchange_rate_date = json_extract(total_valuation, '$.exchangeRateDate'),
      rate_source = json_extract(total_valuation, '$.rateSource'),
      total_negotiated_accounting = CAST(COALESCE(
        json_extract(total_valuation, '$.accountingAmount'),
        json_extract(total_valuation, '$.accountingAmountUSD')
      ) AS TEXT),
      total_original_accounting = CAST(
        total_original / CAST(json_extract(total_valuation, '$.exchangeRate') AS REAL)
        AS TEXT
      ),
      total_paid_accounting = CAST(
        total_paid / CAST(json_extract(total_valuation, '$.exchangeRate') AS REAL)
        AS TEXT
      ),
      balance_accounting = CAST(
        balance / CAST(json_extract(total_valuation, '$.exchangeRate') AS REAL)
        AS TEXT
      ),
      tax_amount_accounting = CAST(
        tax_amount / CAST(json_extract(total_valuation, '$.exchangeRate') AS REAL)
        AS TEXT
      )
    WHERE total_valuation IS NOT NULL
      AND json_valid(total_valuation) = 1
      AND CAST(json_extract(total_valuation, '$.exchangeRate') AS REAL) > 0
      AND currency IS NULL;

    UPDATE payment_records
    SET
      currency = (SELECT i.currency FROM invoices i WHERE i.id = payment_records.invoice_id),
      accounting_currency = (SELECT i.accounting_currency FROM invoices i WHERE i.id = payment_records.invoice_id),
      exchange_rate = (SELECT i.exchange_rate FROM invoices i WHERE i.id = payment_records.invoice_id),
      exchange_rate_date = (SELECT i.exchange_rate_date FROM invoices i WHERE i.id = payment_records.invoice_id),
      rate_source = (SELECT i.rate_source FROM invoices i WHERE i.id = payment_records.invoice_id),
      accounting_amount = CAST(
        amount / CAST((SELECT i.exchange_rate FROM invoices i WHERE i.id = payment_records.invoice_id) AS REAL)
        AS TEXT
      )
    WHERE currency IS NULL
      AND EXISTS (
        SELECT 1 FROM invoices i
        WHERE i.id = payment_records.invoice_id
          AND i.currency IS NOT NULL
          AND CAST(i.exchange_rate AS REAL) > 0
      );
  `)

  if (tables.has("financial_data_issues")) {
    database.exec(`
      INSERT OR IGNORE INTO financial_data_issues
        (id, entity_type, entity_id, field_name, issue_code, details)
      SELECT
        'FDI-invoice-' || id,
        'invoice', id, 'currency', 'MISSING_HISTORICAL_CURRENCY',
        'Legacy invoice has no trustworthy currency or exchange-rate snapshot'
      FROM invoices
      WHERE currency IS NULL
         OR accounting_currency IS NULL
         OR exchange_rate IS NULL
         OR exchange_rate_date IS NULL
         OR rate_source IS NULL;

      INSERT OR IGNORE INTO financial_data_issues
        (id, entity_type, entity_id, field_name, issue_code, details)
      SELECT
        'FDI-payment-' || id,
        'payment', id, 'currency', 'MISSING_HISTORICAL_CURRENCY',
        'Legacy payment could not inherit a trustworthy invoice currency snapshot'
      FROM payment_records
      WHERE currency IS NULL
         OR accounting_currency IS NULL
         OR exchange_rate IS NULL
         OR exchange_rate_date IS NULL
         OR rate_source IS NULL;

      INSERT OR IGNORE INTO financial_data_issues
        (id, entity_type, entity_id, field_name, issue_code, details)
      SELECT 'FDI-weapon-purchase-' || id, 'weapon', id, 'purchasePrice',
        'MISSING_HISTORICAL_VALUATION', 'Legacy weapon purchase price has no trustworthy currency snapshot'
      FROM weapons WHERE purchase_price_valuation IS NULL;

      INSERT OR IGNORE INTO financial_data_issues
        (id, entity_type, entity_id, field_name, issue_code, details)
      SELECT 'FDI-weapon-retail-' || id, 'weapon', id, 'retailPrice',
        'MISSING_HISTORICAL_VALUATION', 'Legacy weapon retail price has no trustworthy currency snapshot'
      FROM weapons WHERE retail_price_valuation IS NULL;

      INSERT OR IGNORE INTO financial_data_issues
        (id, entity_type, entity_id, field_name, issue_code, details)
      SELECT 'FDI-weapon-wholesale-' || id, 'weapon', id, 'wholesalePrice',
        'MISSING_HISTORICAL_VALUATION', 'Legacy weapon wholesale price has no trustworthy currency snapshot'
      FROM weapons WHERE wholesale_price_valuation IS NULL;

      INSERT OR IGNORE INTO financial_data_issues
        (id, entity_type, entity_id, field_name, issue_code, details)
      SELECT 'FDI-accessory-' || id, 'accessory', id, 'price',
        'MISSING_HISTORICAL_VALUATION', 'Legacy accessory price has no trustworthy currency snapshot'
      FROM accessories WHERE price_valuation IS NULL;

      INSERT OR IGNORE INTO financial_data_issues
        (id, entity_type, entity_id, field_name, issue_code, details)
      SELECT 'FDI-ammunition-' || id, 'ammunition', id, 'price',
        'MISSING_HISTORICAL_VALUATION', 'Legacy ammunition price has no trustworthy currency snapshot'
      FROM ammunition WHERE price_valuation IS NULL;

      INSERT OR IGNORE INTO financial_data_issues
        (id, entity_type, entity_id, field_name, issue_code, details)
      SELECT 'FDI-shipment-' || id, 'shipment', id, 'totalCostValuation',
        'MISSING_HISTORICAL_VALUATION', 'Legacy priced shipment has no trustworthy currency snapshot'
      FROM shipments
      WHERE total_cost_valuation IS NULL
        AND json_valid(line_items) = 1
        AND json_array_length(line_items) > 0;
    `)
  }
}


// ============================================================
// User Preferences
// ============================================================

function ensureDefaultUserPreferences(
  database: Database.Database
): void {
  const tables = getExistingTables(database);

  if (
    !tables.has("users") ||
    !tables.has("user_preferences")
  ) {
    return;
  }

  const users = database
    .prepare(`SELECT id FROM users`)
    .all() as Array<{ id: string }>;

  const insertPreference = database.prepare(`
    INSERT OR IGNORE INTO user_preferences(
  user_id,
  report_view_mode
)
VALUES(?, 'accounting')
  `);

  for (const user of users) {
    insertPreference.run(user.id);
  }
}


// ============================================================
// Weapons schema verification
// ============================================================

function verifyWeaponsTableSchema(
  database: Database.Database
): void {
  const requiredLegacyColumns = [
    "brand",
    "model",
    "weapon_type",
    "sub_type",
    "caliber",
    "warehouse",
    "shelf",
    "bin",
  ];

  const columns = getTableColumns(
    database,
    "weapons"
  );

  const missing = requiredLegacyColumns.filter(
    column => !columns.has(column)
  );

  if (missing.length > 0) {
    throw new Error(
      `Migration aborted: legacy weapons schema is incomplete. ` +
      `Missing columns: ${missing.join(", ")} `
    );
  }
}


// ============================================================
// Populate normalized FK columns
// ============================================================

function populateFkColumns(
  database: Database.Database
): void {
  database.exec(`
    UPDATE weapons
    SET weapon_type_id = (
  SELECT wt.id
      FROM weapon_types wt
      WHERE wt.label = weapons.weapon_type
      LIMIT 1
    )
    WHERE weapon_type_id IS NULL
  `);

  database.exec(`
    UPDATE weapons
    SET weapon_subtype_id = (
  SELECT ws.id
      FROM weapon_subtypes ws
      INNER JOIN weapon_types wt
        ON wt.id = ws.weapon_type_id
      WHERE wt.label = weapons.weapon_type
        AND ws.label = weapons.sub_type
      LIMIT 1
    )
    WHERE weapon_subtype_id IS NULL
  `);

  database.exec(`
    UPDATE weapons
    SET caliber_id = (
  SELECT c.id
      FROM calibers c
      WHERE c.label = weapons.caliber
      LIMIT 1
    )
    WHERE caliber_id IS NULL
  `);

  database.exec(`
    UPDATE weapons
    SET brand_id = (
  SELECT b.id
      FROM brands b
      WHERE b.label = weapons.brand
      LIMIT 1
    )
    WHERE brand_id IS NULL
  `);

  database.exec(`
    UPDATE weapons
    SET model_id = (
  SELECT m.id
      FROM models m
      INNER JOIN brands b
        ON b.id = m.brand_id
      WHERE b.label = weapons.brand
        AND m.label = weapons.model
      LIMIT 1
    )
    WHERE model_id IS NULL
  `);

  database.exec(`
    UPDATE weapons
    SET storage_location_id = (
  SELECT sl.id
      FROM storage_locations sl
      INNER JOIN warehouses w
        ON w.id = sl.warehouse_id
      WHERE w.label = weapons.warehouse
        AND sl.shelf = weapons.shelf
        AND sl.bin = weapons.bin
      LIMIT 1
    )
    WHERE storage_location_id IS NULL
  `);
}


// ============================================================
// FK validation
// ============================================================

function validateFkColumns(
  database: Database.Database
): void {
  const requiredColumns = [
    "weapon_type_id",
    "weapon_subtype_id",
    "caliber_id",
    "brand_id",
    "model_id",
  ];

  const errors: string[] = [];

  for (const column of requiredColumns) {
    const row = database
      .prepare(`
        SELECT COUNT(*) AS count
        FROM weapons
        WHERE ${column} IS NULL
           OR TRIM(${column}) = ''
  `)
      .get() as { count: number };

    if (row.count > 0) {
      errors.push(
        `${column}: ${row.count} unresolved rows`
      );
    }
  }

  // Storage location is optional.
  //
  // Therefore NULL is allowed.
  //
  // We still validate that non-null IDs actually exist.
  const invalidLocations = database
    .prepare(`
      SELECT COUNT(*) AS count
      FROM weapons w
      WHERE w.storage_location_id IS NOT NULL
        AND NOT EXISTS(
    SELECT 1
          FROM storage_locations sl
          WHERE sl.id = w.storage_location_id
  )
    `)
    .get() as { count: number };

  if (invalidLocations.count > 0) {
    errors.push(
      `storage_location_id: ${invalidLocations.count} invalid references`
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Migration aborted.FK conversion failed: \n` +
      errors.join("\n")
    );
  }
}


// ============================================================
// Rebuild normalized weapons table
// ============================================================

function rebuildWeaponsTable(
  database: Database.Database
): void {
  database.exec(`
    DROP TABLE IF EXISTS weapons_new;

    CREATE TABLE weapons_new(
    id TEXT PRIMARY KEY,
    serial_number TEXT NOT NULL UNIQUE,

    weapon_type_id TEXT NOT NULL,
    weapon_subtype_id TEXT NOT NULL,

    brand_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    caliber_id TEXT NOT NULL,

    storage_location_id TEXT,
    supplier_id TEXT,
    shipment_id TEXT,

    condition TEXT NOT NULL DEFAULT 'Excellent'
        CHECK(
      condition IN(
        'Excellent',
        'Good',
        'Fair',
        'Poor'
      )
    ),

    status TEXT NOT NULL DEFAULT 'Available'
        CHECK(
      status IN(
        'Available',
        'Reserved',
        'Sold',
        'Returned'
      )
    ),

    purchase_price REAL NOT NULL DEFAULT 0,
    retail_price REAL NOT NULL DEFAULT 0,
    wholesale_price REAL NOT NULL DEFAULT 0,
    actual_final_price REAL,

    date_added TEXT NOT NULL,

    batch_id TEXT,
    notes TEXT NOT NULL DEFAULT '',

    images TEXT NOT NULL DEFAULT '[]',
    movement_history TEXT NOT NULL DEFAULT '[]',

    purchase_price_valuation TEXT,
    retail_price_valuation TEXT,
    sale_price_valuation TEXT,

    deleted_at TEXT,

    created_at TEXT NOT NULL DEFAULT(datetime('now')),
    updated_at TEXT NOT NULL DEFAULT(datetime('now')),

    FOREIGN KEY(
      weapon_type_id,
      weapon_subtype_id
    )
      REFERENCES weapon_subtypes(
      weapon_type_id,
      id
    )
      ON DELETE RESTRICT,

    FOREIGN KEY(
      weapon_subtype_id,
      caliber_id
    )
      REFERENCES subtype_calibers(
      subtype_id,
      caliber_id
    )
      ON DELETE RESTRICT,

    FOREIGN KEY(brand_id)
        REFERENCES brands(id)
        ON DELETE RESTRICT,

    FOREIGN KEY(model_id)
        REFERENCES models(id)
        ON DELETE RESTRICT,

    FOREIGN KEY(storage_location_id)
        REFERENCES storage_locations(id)
        ON DELETE SET NULL,

    FOREIGN KEY(supplier_id)
        REFERENCES suppliers(id)
        ON DELETE SET NULL,

    FOREIGN KEY(shipment_id)
        REFERENCES shipments(id)
        ON DELETE SET NULL
  ) STRICT;
`);

  // ----------------------------------------------------------
  // IMPORTANT:
  // NEVER use SELECT * here.
  //
  // The old V1 table contains legacy text columns.
  // The new table does not.
  // ----------------------------------------------------------

  database.exec(`
    INSERT INTO weapons_new(
  id,
  serial_number,

  weapon_type_id,
  weapon_subtype_id,

  brand_id,
  model_id,
  caliber_id,

  storage_location_id,
  supplier_id,
  shipment_id,

  condition,
  status,

  purchase_price,
  retail_price,
  wholesale_price,
  actual_final_price,

  date_added,
  batch_id,
  notes,

  images,
  movement_history,

  purchase_price_valuation,
  retail_price_valuation,
  sale_price_valuation,

  deleted_at,
  created_at,
  updated_at
)
SELECT
id,
  serial_number,

  weapon_type_id,
  weapon_subtype_id,

  brand_id,
  model_id,
  caliber_id,

  storage_location_id,
  supplier_id,
  shipment_id,

  condition,
  status,

  purchase_price,
  retail_price,
  wholesale_price,
  actual_final_price,

  date_added,
  batch_id,
  notes,

  images,
  movement_history,

  purchase_price_valuation,
  retail_price_valuation,
  sale_price_valuation,

  deleted_at,
  created_at,
  updated_at
    FROM weapons
  `);

  // ----------------------------------------------------------
  // Verify transfer BEFORE replacing original table
  // ----------------------------------------------------------

  const oldCount = getTableRowCount(
    database,
    "weapons"
  );

  const newCount = getTableRowCount(
    database,
    "weapons_new"
  );

  if (oldCount !== newCount) {
    throw new Error(
      `Weapons rebuild aborted: ` +
      `old = ${oldCount}, new= ${newCount} `
    );
  }

  // ----------------------------------------------------------
  // Replace table
  // ----------------------------------------------------------

  database.exec(`
    DROP TABLE weapons;

    ALTER TABLE weapons_new
    RENAME TO weapons;
`);

  // ----------------------------------------------------------
  // Recreate indexes
  // ----------------------------------------------------------

  database.exec(`
    CREATE INDEX IF NOT EXISTS
idx_weapons_serial
      ON weapons(serial_number);

    CREATE INDEX IF NOT EXISTS
idx_weapons_status
      ON weapons(status);

    CREATE INDEX IF NOT EXISTS
idx_weapons_condition
      ON weapons(condition);

    CREATE INDEX IF NOT EXISTS
idx_weapons_date_added
      ON weapons(date_added);

    CREATE INDEX IF NOT EXISTS
idx_weapons_created_at
      ON weapons(created_at);

    CREATE INDEX IF NOT EXISTS
idx_weapons_type
      ON weapons(weapon_type_id);

    CREATE INDEX IF NOT EXISTS
idx_weapons_subtype
      ON weapons(weapon_subtype_id);

    CREATE INDEX IF NOT EXISTS
idx_weapons_brand
      ON weapons(brand_id);

    CREATE INDEX IF NOT EXISTS
idx_weapons_model
      ON weapons(model_id);

    CREATE INDEX IF NOT EXISTS
idx_weapons_caliber
      ON weapons(caliber_id);

    CREATE INDEX IF NOT EXISTS
idx_weapons_location
      ON weapons(storage_location_id);

    CREATE INDEX IF NOT EXISTS
idx_weapons_supplier
      ON weapons(supplier_id);

    CREATE INDEX IF NOT EXISTS
idx_weapons_shipment
      ON weapons(shipment_id);

    CREATE INDEX IF NOT EXISTS
idx_weapons_type_status
      ON weapons(weapon_type_id, status);

    CREATE INDEX IF NOT EXISTS
idx_weapons_subtype_status
      ON weapons(weapon_subtype_id, status);

    CREATE INDEX IF NOT EXISTS
idx_weapons_brand_status
      ON weapons(brand_id, status);
`);
}


// ============================================================
// Generic schema helpers
// ============================================================

function getExistingTables(
  database: Database.Database
): Set<string> {
  const rows = database
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
    `)
    .all() as Array<{ name: string }>;

  return new Set(rows.map(row => row.name));
}


function assertSafeIdentifier(identifier: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`)
  }
}

function getTableColumns(
  database: Database.Database,
  table: string
): Set<string> {
  assertSafeIdentifier(table)

  const rows = database
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>

  return new Set(rows.map(row => row.name))
}


function getTableRowCount(
  database: Database.Database,
  table: string
): number {
  assertSafeIdentifier(table)

  const row = database
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as { count: number }

  return row.count
}


function addColumnIfMissing(
  database: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  assertSafeIdentifier(table)
  assertSafeIdentifier(column)

  const columns = getTableColumns(database, table)

  if (!columns.has(column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}


// ============================================================
// Final schema validation
// ============================================================

function validateFinalSchema(
  database: Database.Database
): void {
  const requiredTables = [
    "weapon_types",
    "weapon_subtypes",
    "calibers",
    "subtype_calibers",
    "brands",
    "models",
    "warehouses",
    "storage_locations",

    "currencies",
    "exchange_rate_history",
    "exchange_rate_overrides",
    "exchange_rate_audit_log",

    "weapons",

    "suppliers",
    "customers",
    "shipments",

    "invoices",
    "payment_records",

    "accessories",
    "ammunition",

    "ammunition_weapon_compatibility",
    "accessory_weapon_compatibility",

    "audit_logs",
    "app_notifications",

    "users",
    "system_settings",
    "saved_filters",
    "user_preferences",
    "financial_data_issues",
    "inventory_transactions",
    "shipment_items",
    "product_costs",
    "shipment_costs",
    "shipment_cost_scope_items",
    "shipment_cost_allocations",
    "inventory_cost_snapshots",
    "shipment_imports",
    "shipment_documents",
    "shipment_import_items",
    "shipment_validation_issues",
    "shipment_item_changes",
    "shipment_status_history",
    "app_installation",
    "inventory_product_types",
    "app_backups",
    "account_auth_attempts",
    "business_id_counters",
    "database_health_probes",
  ];

  const tables = getExistingTables(database);

  const missingTables = requiredTables.filter(
    table => !tables.has(table)
  );

  if (missingTables.length > 0) {
    throw new Error(
      `Final schema validation failed.Missing tables: ` +
      missingTables.join(", ")
    );
  }

  // ----------------------------------------------------------
  // Validate weapons columns
  // ----------------------------------------------------------

  const weaponColumns = getTableColumns(
    database,
    "weapons"
  );

  const requiredWeaponColumns = [
    "id",
    "serial_number",

    "weapon_type_id",
    "weapon_subtype_id",
    "brand_id",
    "model_id",
    "caliber_id",

    "storage_location_id",
    "supplier_id",
    "shipment_id",

    "condition",
    "status",

    "purchase_price",
    "retail_price",
    "wholesale_price",
    "actual_final_price",

    "date_added",

    "batch_id",
    "notes",

    "images",
    "movement_history",

    "purchase_price_valuation",
    "retail_price_valuation",
    "wholesale_price_valuation",
    "actual_final_price_valuation",
    "sale_price_valuation",

    "deleted_at",

    "created_at",
    "updated_at",
  ];

  const missingWeaponColumns =
    requiredWeaponColumns.filter(
      column => !weaponColumns.has(column)
    );

  if (missingWeaponColumns.length > 0) {
    throw new Error(
      `Final weapons schema validation failed. ` +
      `Missing columns: ${missingWeaponColumns.join(", ")} `
    );
  }

  // ----------------------------------------------------------
  // Validate ammunition.name
  // ----------------------------------------------------------

  const ammunitionColumns = getTableColumns(
    database,
    "ammunition"
  );

  if (!ammunitionColumns.has("name")) {
    throw new Error(
      `Final schema validation failed: ` +
      `ammunition.name is missing`
    );
  }

  const requiredFinancialColumns: Record<string, string[]> = {
    invoices: [
      "currency", "accounting_currency", "exchange_rate", "exchange_rate_date", "rate_source",
      "total_original_accounting", "total_negotiated_accounting", "total_paid_accounting",
      "balance_accounting", "tax_amount_accounting",
    ],
    payment_records: [
      "currency", "accounting_amount", "accounting_currency", "exchange_rate",
      "exchange_rate_date", "rate_source", "rate_id",
    ],
    accessories: ["price_currency", "price_valuation"],
    ammunition: ["price_currency", "price_valuation"],
    system_settings: ["accounting_currency_code", "rate_base_currency_code"],
  }

  for (const [table, requiredColumns] of Object.entries(requiredFinancialColumns)) {
    const columns = getTableColumns(database, table)
    const missing = requiredColumns.filter((column) => !columns.has(column))
    if (missing.length > 0) {
      throw new Error(`Final financial schema validation failed for ${table}. Missing columns: ${missing.join(", ")}`)
    }
  }

  // ----------------------------------------------------------
  // Validate foreign keys
  // ----------------------------------------------------------

  const fkCheck = database
    .prepare(`PRAGMA foreign_key_check`)
    .all();

  if (fkCheck.length > 0) {
    throw new Error(
      `Final schema validation failed: ` +
      `${fkCheck.length} foreign - key violations detected.`
    );
  }
}


// ============================================================
// Migration backup
// ============================================================

function createMigrationBackupSync(
  database: Database.Database
): void {
  const dbPath = getDbPath();
  const backupDir = getDbDirectory();

  if (!fs.existsSync(dbPath)) {
    return;
  }

  fs.mkdirSync(backupDir, {
    recursive: true,
  });

  const timestamp = formatBackupTimestamp();

  let fileName =
    `backup_${timestamp}_pre_migration.db`;

  let counter = 1;

  while (
    fs.existsSync(
      path.join(backupDir, fileName)
    )
  ) {
    fileName =
      `backup_${timestamp}_pre_migration_${counter}.db`;

    counter++;
  }

  const backupPath = path.join(
    backupDir,
    fileName
  );

  try {
    database.pragma("wal_checkpoint(FULL)");
  } catch {
    // Best effort only.
  }

  fs.copyFileSync(
    dbPath,
    backupPath
  );

  log(
    "info",
    "migration-backup-created",
    {
      fileName,
      schemaVersion: getSchemaVersion(database),
    }
  );
}
