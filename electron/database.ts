// electron/database.ts
import Database from "better-sqlite3"
import path from "node:path"
import { app } from "electron"
import fs from "node:fs"

import {
  CREATE_TABLES_SQL,
  SEED_MASTER_DATA_SQL,
  SCHEMA_VERSION,
} from "../src/lib/db/schema.js"

let db: Database.Database | null = null

// ============== Configuration ==============

const DATABASE_MODE = (process.env.DATABASE_MODE ?? "production") as "development" | "production"
const RESET_ON_START = process.env.RESET_DATABASE_ON_START === "true"

const DB_FILE_NAME = "armory_store.db"

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
  return /^backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:_\d+)?\.db$/.test(fileName)
}

function deleteSidecarFiles(dbPath: string): void {
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${dbPath}${suffix}`
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar)
  }
}

// ============== Public API ==============

export function getDbDirectory(): string {
  const dbDir = path.join(app.getPath("userData"), "db")
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })
  return dbDir
}

export function getDbPath(): string {
  return path.join(getDbDirectory(), DB_FILE_NAME)
}

export function getDb(): Database.Database {
  if (!db) throw new Error("Database not initialized. Call initDatabase() first.")
  return db
}

export function isDatabaseInitialized(): boolean {
  return db !== null
}

export function databaseExists(): boolean {
  return fs.existsSync(getDbPath())
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

export async function createDatabaseBackup(): Promise<DatabaseBackupInfo> {
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

export async function restoreDatabaseBackup(fileName: string): Promise<void> {
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
  await initDatabase()
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

// ============== Initialization ==============

export async function initDatabase(): Promise<void> {
  if (db) return

  const useDevReset = DATABASE_MODE === "development" && RESET_ON_START

  if (useDevReset) {
    await resetAndCreateFresh()
  } else {
    await normalStartup()
  }

  ensureDefaultUserPreferences(db!)
  log("info", "database-default-preferences-ensured")
}

// ============== Development: full reset ==============

async function resetAndCreateFresh(): Promise<void> {
  log("info", "dev-reset-started", { DATABASE_MODE, RESET_ON_START })

  closeDatabase()

  const dbPath = getDbPath()
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  deleteSidecarFiles(dbPath)

  const dbDir = getDbDirectory()
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

  db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.pragma("synchronous = NORMAL")
  db.pragma("foreign_keys = ON")

  db.exec(CREATE_TABLES_SQL)
  db.exec(SEED_MASTER_DATA_SQL)
  db.pragma(`user_version = ${SCHEMA_VERSION}`)

  log("info", "dev-reset-completed", { schemaVersion: SCHEMA_VERSION })
}

// ============== Production / normal startup ==============

async function normalStartup(): Promise<void> {
  const dbPath = getDbPath()
  const isFirstLaunch = !fs.existsSync(dbPath)

  log("info", "database-open-start", { dbPath, exists: fs.existsSync(dbPath), isFirstLaunch, DATABASE_MODE })
  db = new Database(dbPath)
  log("info", "database-open-success", { dbPath })

  db.pragma("journal_mode = WAL")
  db.pragma("synchronous = NORMAL")
  db.pragma("foreign_keys = ON")

  if (isFirstLaunch) {
    db.exec(CREATE_TABLES_SQL)
    db.exec(SEED_MASTER_DATA_SQL)
    db.pragma(`user_version = ${SCHEMA_VERSION}`)
    log("info", "database-schema-created", { schemaVersion: SCHEMA_VERSION })
  } else {
    runMigrations(db)
  }
}

// ============== Migration system (production only) ==============

function runMigrations(database: Database.Database): void {
  createMigrationBackupSync(database)

  const currentVersion = database.pragma("user_version", { simple: true }) as number

  if (currentVersion >= SCHEMA_VERSION) {
    database.exec(CREATE_TABLES_SQL)
    addColumnsIfMissing(database)
    return
  }

  const migrate = database.transaction(() => {
    verifyWeaponsTableSchema(database)
    addColumnIfMissing(database, "weapons", "created_at", "TEXT NOT NULL DEFAULT (datetime('now'))")
    addColumnIfMissing(database, "weapons", "updated_at", "TEXT NOT NULL DEFAULT (datetime('now'))")
    database.exec("UPDATE weapons SET created_at = datetime('now'), updated_at = datetime('now') WHERE created_at IS NULL")
    addColumnIfMissing(database, "weapons", "weapon_type_id", "TEXT")
    addColumnIfMissing(database, "weapons", "weapon_subtype_id", "TEXT")
    addColumnIfMissing(database, "weapons", "caliber_id", "TEXT")
    addColumnIfMissing(database, "weapons", "brand_id", "TEXT")
    addColumnIfMissing(database, "weapons", "model_id", "TEXT")
    addColumnIfMissing(database, "weapons", "storage_location_id", "TEXT")
    populateFkColumns(database)
    validateFkColumns(database)
    const rowCountBefore = (database.prepare("SELECT COUNT(*) AS cnt FROM weapons").get() as { cnt: number }).cnt
    rebuildWeaponsTable(database)
    const rowCountAfter = (database.prepare("SELECT COUNT(*) AS cnt FROM weapons").get() as { cnt: number }).cnt
    if (rowCountBefore !== rowCountAfter) {
      throw new Error(`Row count mismatch during rebuild: ${rowCountBefore} → ${rowCountAfter}`)
    }
    database.pragma(`user_version = ${SCHEMA_VERSION}`)
  })

  migrate()
  database.exec(CREATE_TABLES_SQL)
  addColumnsIfMissing(database)
}

// ============== Migration helpers (unchanged) ==============

function addColumnsIfMissing(database: Database.Database): void {
  const settingsCols = database.prepare("PRAGMA table_info(system_settings)").all() as { name: string }[]
  const colNames = new Set(settingsCols.map(c => c.name))
  const newCols: [string, string][] = [
    ["number_format", "TEXT NOT NULL DEFAULT 'en-US'"],
    ["company_name", "TEXT NOT NULL DEFAULT ''"],
    ["company_address", "TEXT NOT NULL DEFAULT ''"],
    ["company_phone", "TEXT NOT NULL DEFAULT ''"],
    ["company_email", "TEXT NOT NULL DEFAULT ''"],
    ["company_tax_id", "TEXT NOT NULL DEFAULT ''"],
    ["theme", "TEXT NOT NULL DEFAULT 'system'"],
  ]
  for (const [col, def] of newCols) {
    if (!colNames.has(col)) {
      database.exec(`ALTER TABLE system_settings ADD COLUMN ${col} ${def}`)
    }
  }
}

function ensureDefaultUserPreferences(database: Database.Database): void {
  const users = database.prepare("SELECT id FROM users").all() as { id: string }[]
  const insertPref = database.prepare(`INSERT OR IGNORE INTO user_preferences (user_id, report_view_mode) VALUES (?, 'accounting')`)
  for (const u of users) insertPref.run(u.id)
}

export function closeDatabase(): void {
  if (db) { db.close(); db = null }
}

function addColumnIfMissing(d: Database.Database, table: string, column: string, definition: string) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some(c => c.name === column)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

function verifyWeaponsTableSchema(d: Database.Database) {
  const required = ["brand", "model", "weapon_type", "sub_type", "caliber", "warehouse", "shelf", "bin"]
  const cols = d.prepare("PRAGMA table_info(weapons)").all() as { name: string }[]
  const missing = required.filter(c => !cols.some(x => x.name === c))
  if (missing.length > 0) throw new Error(`Migration aborted: old weapons schema is missing required columns: ${missing.join(", ")}. Expected a V1 database.`)
}

function populateFkColumns(d: Database.Database) {
  d.exec(`UPDATE weapons SET weapon_type_id = (SELECT id FROM weapon_types WHERE label = weapons.weapon_type) WHERE weapon_type_id IS NULL`)
  d.exec(`UPDATE weapons SET weapon_subtype_id = (SELECT ws.id FROM weapon_subtypes ws JOIN weapon_types wt ON ws.weapon_type_id = wt.id WHERE wt.label = weapons.weapon_type AND ws.label = weapons.sub_type) WHERE weapon_subtype_id IS NULL`)
  d.exec(`UPDATE weapons SET caliber_id = (SELECT id FROM calibers WHERE label = weapons.caliber) WHERE caliber_id IS NULL`)
  d.exec(`UPDATE weapons SET brand_id = (SELECT id FROM brands WHERE label = weapons.brand) WHERE brand_id IS NULL`)
  d.exec(`UPDATE weapons SET model_id = (SELECT m.id FROM models m JOIN brands b ON m.brand_id = b.id WHERE b.label = weapons.brand AND m.label = weapons.model) WHERE model_id IS NULL`)
  d.exec(`UPDATE weapons SET storage_location_id = (SELECT sl.id FROM storage_locations sl JOIN warehouses w ON sl.warehouse_id = w.id WHERE w.label = weapons.warehouse AND sl.shelf = weapons.shelf AND sl.bin = weapons.bin) WHERE storage_location_id IS NULL`)
}

function validateFkColumns(d: Database.Database) {
  const required = ["weapon_type_id", "weapon_subtype_id", "caliber_id", "brand_id", "model_id"]
  const errors: string[] = []
  for (const col of required) {
    const row = d.prepare(`SELECT COUNT(*) AS cnt FROM weapons WHERE ${col} IS NULL`).get() as { cnt: number }
    if (row.cnt > 0) errors.push(`Missing ${col}: ${row.cnt} rows`)
  }
  const locNulls = d.prepare("SELECT COUNT(*) AS cnt FROM weapons WHERE storage_location_id IS NULL").get() as { cnt: number }
  if (locNulls.cnt > 0) errors.push(`Missing storage_location_id (optional): ${locNulls.cnt} rows`)
  if (errors.length > 0) throw new Error("Migration aborted.\n" + errors.join("\n"))
}

function rebuildWeaponsTable(d: Database.Database) {
  d.exec(`
    CREATE TABLE weapons_new (
      id TEXT PRIMARY KEY, serial_number TEXT NOT NULL UNIQUE,
      weapon_type_id TEXT NOT NULL, weapon_subtype_id TEXT NOT NULL,
      brand_id TEXT NOT NULL, model_id TEXT NOT NULL, caliber_id TEXT NOT NULL,
      storage_location_id TEXT, supplier_id TEXT, shipment_id TEXT,
      condition TEXT NOT NULL DEFAULT 'Excellent' CHECK (condition IN ('Excellent','Good','Fair','Poor')),
      status TEXT NOT NULL DEFAULT 'Available' CHECK (status IN ('Available','Reserved','Sold','Returned')),
      purchase_price REAL NOT NULL DEFAULT 0, retail_price REAL NOT NULL DEFAULT 0,
      wholesale_price REAL NOT NULL DEFAULT 0, actual_final_price REAL,
      date_added TEXT NOT NULL, batch_id TEXT, notes TEXT NOT NULL DEFAULT '',
      images TEXT NOT NULL DEFAULT '[]', movement_history TEXT NOT NULL DEFAULT '[]',
      purchase_price_valuation TEXT, retail_price_valuation TEXT, sale_price_valuation TEXT,
      deleted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (weapon_type_id, weapon_subtype_id) REFERENCES weapon_subtypes(weapon_type_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (weapon_subtype_id, caliber_id) REFERENCES subtype_calibers(subtype_id, caliber_id) ON DELETE RESTRICT,
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE RESTRICT,
      FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE RESTRICT,
      FOREIGN KEY (storage_location_id) REFERENCES storage_locations(id) ON DELETE SET NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
      FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE SET NULL
    ) STRICT;
  `)
  d.exec(`INSERT INTO weapons_new (id,serial_number,weapon_type_id,weapon_subtype_id,brand_id,model_id,caliber_id,storage_location_id,supplier_id,shipment_id,condition,status,purchase_price,retail_price,wholesale_price,actual_final_price,date_added,batch_id,notes,images,movement_history,purchase_price_valuation,retail_price_valuation,sale_price_valuation,deleted_at,created_at,updated_at) SELECT id,serial_number,weapon_type_id,weapon_subtype_id,brand_id,model_id,caliber_id,storage_location_id,supplier_id,shipment_id,condition,status,purchase_price,retail_price,wholesale_price,actual_final_price,date_added,batch_id,notes,images,movement_history,purchase_price_valuation,retail_price_valuation,sale_price_valuation,deleted_at,created_at,updated_at FROM weapons`)
  d.exec("DROP TABLE weapons")
  d.exec("ALTER TABLE weapons_new RENAME TO weapons")
  d.exec(`
    CREATE INDEX IF NOT EXISTS idx_weapons_serial ON weapons(serial_number);
    CREATE INDEX IF NOT EXISTS idx_weapons_status ON weapons(status);
    CREATE INDEX IF NOT EXISTS idx_weapons_condition ON weapons(condition);
    CREATE INDEX IF NOT EXISTS idx_weapons_date_added ON weapons(date_added);
    CREATE INDEX IF NOT EXISTS idx_weapons_created_at ON weapons(created_at);
    CREATE INDEX IF NOT EXISTS idx_weapons_type ON weapons(weapon_type_id);
    CREATE INDEX IF NOT EXISTS idx_weapons_subtype ON weapons(weapon_subtype_id);
    CREATE INDEX IF NOT EXISTS idx_weapons_brand ON weapons(brand_id);
    CREATE INDEX IF NOT EXISTS idx_weapons_model ON weapons(model_id);
    CREATE INDEX IF NOT EXISTS idx_weapons_caliber ON weapons(caliber_id);
    CREATE INDEX IF NOT EXISTS idx_weapons_location ON weapons(storage_location_id);
    CREATE INDEX IF NOT EXISTS idx_weapons_supplier ON weapons(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_weapons_shipment ON weapons(shipment_id);
    CREATE INDEX IF NOT EXISTS idx_weapons_type_status ON weapons(weapon_type_id, status);
    CREATE INDEX IF NOT EXISTS idx_weapons_subtype_status ON weapons(weapon_subtype_id, status);
    CREATE INDEX IF NOT EXISTS idx_weapons_brand_status ON weapons(brand_id, status);
  `)
}

function createMigrationBackupSync(database: Database.Database) {
  const dbPath = getDbPath()
  const timestamp = formatBackupTimestamp()
  let fileName = `backup_${timestamp}_pre_migration.db`
  const backupDir = getDbDirectory()
  let counter = 1
  while (fs.existsSync(path.join(backupDir, fileName))) {
    fileName = `backup_${timestamp}_pre_migration_${counter}.db`
    counter++
  }
  const backupPath = path.join(backupDir, fileName)
  try { database.pragma("wal_checkpoint(FULL)") } catch { /* ignore */ }
  fs.copyFileSync(dbPath, backupPath)
  log("info", "migration-backup-created", { fileName })
}