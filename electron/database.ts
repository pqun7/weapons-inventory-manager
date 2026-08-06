// electron/database.ts
import Database from "better-sqlite3"
import path from "node:path"
import { app } from "electron"
import fs from "node:fs"

// ---- Static schema import (no dynamic loading) ----
// These must be compiled together with the main process.
// Adjust tsconfig.electron.json to include "src/lib/db/schema.ts".
import {
  CREATE_TABLES_SQL,
  SEED_MASTER_DATA_SQL,
  SCHEMA_VERSION,
} from "../src/lib/db/schema.js"

let db: Database.Database | null = null

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

function clearDatabaseSidecars(dbPath: string): void {
  for (const suffix of ["-wal", "-shm"]) {
    const sidecarPath = `${dbPath}${suffix}`
    if (fs.existsSync(sidecarPath)) {
      fs.unlinkSync(sidecarPath)
    }
  }
}

// ============== Public API ==============

export function getDbDirectory(): string {
  const dbDir = path.join(app.getPath("userData"), "db")
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
  if (!isBackupName(safeFileName)) throw new Error("Invalid backup file name")
  const backupPath = path.join(getDbDirectory(), safeFileName)
  if (!fs.existsSync(backupPath)) throw new Error("Backup file not found")

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
  if (!isBackupName(safeFileName)) throw new Error("Invalid backup file name")
  const backupPath = path.join(getDbDirectory(), safeFileName)
  if (!fs.existsSync(backupPath)) throw new Error("Backup file not found")
  fs.unlinkSync(backupPath)
  log("info", "backup-deleted", { fileName: safeFileName })
}

// ---- Initialization (now fully synchronous after static import) ----
export async function initDatabase(): Promise<void> {
  if (db) return

  // Schema is already available via static import – no async loading needed.
  const dbPath = getDbPath()
  const isFirstLaunch = !fs.existsSync(dbPath)

  log("info", "database-open-start", { dbPath, exists: fs.existsSync(dbPath), isFirstLaunch })
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

  ensureDefaultUserPreferences(db)
  log("info", "database-default-preferences-ensured")
}

function runMigrations(database: Database.Database): void {
  database.exec(CREATE_TABLES_SQL)
  const currentVersion = database.pragma("user_version", { simple: true }) as number
  if (currentVersion < SCHEMA_VERSION) {
    addColumnsIfMissing(database)
    database.pragma(`user_version = ${SCHEMA_VERSION}`)
  }
}

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