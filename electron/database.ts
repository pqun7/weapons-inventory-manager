import Database from "better-sqlite3"
import path from "path"
import { app } from "electron"
import fs from "fs"
import { CREATE_TABLES_SQL, SEED_MASTER_DATA_SQL, SCHEMA_VERSION } from "../src/lib/db/schema"

let db: Database.Database | null = null

export function getDbPath(): string {
  return path.join(app.getPath("userData"), "armory_store.db")
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

export function initDatabase(): void {
  if (db) return

  const dbPath = getDbPath()
  const isFirstLaunch = !fs.existsSync(dbPath)

  db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.pragma("synchronous = NORMAL")
  db.pragma("foreign_keys = ON")

  if (isFirstLaunch) {
    db.exec(CREATE_TABLES_SQL)
    db.exec(SEED_MASTER_DATA_SQL)
    db.pragma(`user_version = ${SCHEMA_VERSION}`)
  } else {
    runMigrations(db)
  }

  ensureDefaultUserPreferences(db)
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
  const colNames = new Set(settingsCols.map((c) => c.name))

  const newCols: [string, string][] = [
    ["number_format", "TEXT NOT NULL DEFAULT 'en-US'"],
    ["company_name", "TEXT NOT NULL DEFAULT ''"],
    ["company_address", "TEXT NOT NULL DEFAULT ''"],
    ["company_phone", "TEXT NOT NULL DEFAULT ''"],
    ["company_email", "TEXT NOT NULL DEFAULT ''"],
    ["company_tax_id", "TEXT NOT NULL DEFAULT ''"],
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
