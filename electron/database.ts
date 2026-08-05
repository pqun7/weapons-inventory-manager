import Database from "better-sqlite3"
import path from "path"
import { pathToFileURL, fileURLToPath } from "url"
import { app } from "electron"
import fs from "fs"

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


let db: Database.Database | null = null

let CREATE_TABLES_SQL: string | null = null
let SEED_MASTER_DATA_SQL: string | null = null
let SCHEMA_VERSION: number | null = null

async function loadSchema(): Promise<void> {
  if (CREATE_TABLES_SQL !== null) return


  const schemaPath = path.join(__dirname, "../src/lib/db/schema.js")
  const fileUrl = pathToFileURL(schemaPath).href

  try {
    console.log('--- loadSchema: about to import schema ---')
    console.log('module specifier to import:', fileUrl)
    try { console.log('process.cwd():', process.cwd()) } catch (e) { console.log('process.cwd() error:', e) }
    console.log('computed schemaPath:', schemaPath)
    try { console.log('fs.existsSync(schemaPath):', fs.existsSync(schemaPath)) } catch (e) { console.log('fs.existsSync(schemaPath) failed:', e) }
    console.log('final URL passed to import():', fileUrl)
    const mod = await import(fileUrl)
    console.log('loadSchema: import succeeded for', fileUrl)
    CREATE_TABLES_SQL = mod.CREATE_TABLES_SQL
    SEED_MASTER_DATA_SQL = mod.SEED_MASTER_DATA_SQL
    SCHEMA_VERSION = mod.SCHEMA_VERSION
  } catch (err) {
    console.error('loadSchema: import failed for', fileUrl, err)
    throw err
  }
}

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

function clearDatabaseSidecars(dbPath: string): void {
  for (const suffix of ["-wal", "-shm"]) {
    const sidecarPath = `${dbPath}${suffix}`
    if (fs.existsSync(sidecarPath)) {
      fs.unlinkSync(sidecarPath)
    }
  }
}

export function getDbDirectory(): string {
  const dbDir = path.join(app.getPath("userData"), "db");
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }
  return dbDir
}

export function getDbPath(): string {
  return path.join(getDbDirectory(), "armory_store.db")
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
    .filter((fileName) => isBackupName(fileName))
    .map((fileName) => {
      const fullPath = path.join(dbDir, fileName)
      const stat = fs.statSync(fullPath)
      return {
        fileName,
        createdAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
      }
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export async function createDatabaseBackup(): Promise<DatabaseBackupInfo> {
  if (!db) throw new Error("Database not initialized. Call initDatabase() first.")

  const dbPath = getDbPath()
  if (!fs.existsSync(dbPath)) throw new Error("Database file not found")

  const timestamp = formatBackupTimestamp()
  const baseName = `backup_${timestamp}.db`
  let fileName = baseName
  let suffix = 1
  while (fs.existsSync(path.join(getDbDirectory(), fileName))) {
    fileName = `backup_${timestamp}_${suffix}.db`
    suffix += 1
  }

  const backupPath = path.join(getDbDirectory(), fileName)

  try {
    db.pragma("wal_checkpoint(FULL)")
  } catch (err) {
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
  if (!isBackupName(safeFileName)) {
    throw new Error("Invalid backup file name")
  }

  const backupPath = path.join(getDbDirectory(), safeFileName)
  if (!fs.existsSync(backupPath)) {
    throw new Error("Backup file not found")
  }

  const dbPath = getDbPath()
  log("info", "backup-restore-started", { fileName: safeFileName })
  closeDatabase()
  clearDatabaseSidecars(dbPath)
  fs.copyFileSync(backupPath, dbPath)
  clearDatabaseSidecars(dbPath)
  await initDatabase()
  log("info", "backup-restore-completed", { fileName: safeFileName })
}

export function deleteDatabaseBackup(fileName: string): void {
  const safeFileName = path.basename(fileName)
  if (!isBackupName(safeFileName)) {
    throw new Error("Invalid backup file name")
  }

  const backupPath = path.join(getDbDirectory(), safeFileName)
  if (!fs.existsSync(backupPath)) {
    throw new Error("Backup file not found")
  }

  fs.unlinkSync(backupPath)
  log("info", "backup-deleted", { fileName: safeFileName })
}

export async function initDatabase(): Promise<void> {
  if (db) return
  await loadSchema();

  const dbPath = getDbPath()
  const isFirstLaunch = !fs.existsSync(dbPath)

  try {
    log("info", "database-open-start", { dbPath, exists: fs.existsSync(dbPath), isFirstLaunch })
    db = new Database(dbPath)
    log("info", "database-open-success", { dbPath })
  } catch (err) {
    console.error('database.initDatabase: failed to open database', err)
    throw err
  }

  try {
    db.pragma("journal_mode = WAL")
    db.pragma("synchronous = NORMAL")
    db.pragma("foreign_keys = ON")
    log("info", "database-pragmas-applied", { dbPath })
  } catch (err) {
    console.error('database.initDatabase: failed to set pragmas', err)
    throw err
  }

  if (isFirstLaunch) {
    if (!CREATE_TABLES_SQL || !SEED_MASTER_DATA_SQL || SCHEMA_VERSION == null) {
      const e = new Error('Schema not loaded before initializing database')
      console.error('database.initDatabase:', e)
      throw e
    }
    try {
      db.exec(CREATE_TABLES_SQL)
      log("info", "database-schema-created", { dbPath })
      db.exec(SEED_MASTER_DATA_SQL)
      log("info", "database-master-seed-applied", { dbPath })
      db.pragma(`user_version = ${SCHEMA_VERSION}`)
      log("info", "database-version-set", { dbPath, schemaVersion: SCHEMA_VERSION })
    } catch (err) {
      console.error('database.initDatabase: error during first-launch setup', err)
      throw err
    }
  } else {
    try {
      runMigrations(db)
      log("info", "database-migrations-completed", { dbPath, schemaVersion: SCHEMA_VERSION })
    } catch (err) {
      console.error('database.initDatabase: migrations failed', err)
      throw err
    }
  }

  try {
    ensureDefaultUserPreferences(db)
    log("info", "database-default-preferences-ensured", { dbPath })
  } catch (err) {
    console.error('database.initDatabase: ensureDefaultUserPreferences failed', err)
    throw err
  }
}

function runMigrations(database: Database.Database): void {
  database.exec(CREATE_TABLES_SQL!)

  const currentVersion = database.pragma("user_version", { simple: true }) as number
  if (currentVersion < (SCHEMA_VERSION!)) {
    addColumnsIfMissing(database)
    database.pragma(`user_version = ${SCHEMA_VERSION}`)
  }
}

function addColumnsIfMissing(database: Database.Database): void {
  const settingsCols = database.prepare("PRAGMA table_info(system_settings)").all() as { name: string }[]
  const colNames = new Set(settingsCols.map((c) => c.name))

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
  const insertPref = database.prepare(
    `INSERT OR IGNORE INTO user_preferences (user_id, report_view_mode) VALUES (?, 'accounting')`
  )
  for (const u of users) {
    insertPref.run(u.id)
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}