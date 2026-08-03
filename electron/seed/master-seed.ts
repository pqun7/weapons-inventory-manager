import { app } from "electron"
import { initDatabase, closeDatabase, getDbPath } from "../database"
import { CREATE_TABLES_SQL, SEED_MASTER_DATA_SQL, SCHEMA_VERSION } from "../../src/lib/db/schema"
import fs from "fs"

app.whenReady().then(() => {
  const dbPath = getDbPath()
  console.log(`Database path: ${dbPath}`)

  if (fs.existsSync(dbPath)) {
    console.log("Database already exists. Dropping and re-seeding master data...")
    fs.unlinkSync(dbPath)
    const walPath = dbPath + "-wal"
    const shmPath = dbPath + "-shm"
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath)
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath)
  }

  initDatabase()

  const db = (globalThis as any).__db
  if (!db) {
    console.error("Failed to initialize database")
    app.quit()
    return
  }

  console.log("Master data seeded successfully:")
  const tables = ["weapon_types", "weapon_subtypes", "calibers", "brands", "models", "warehouses", "storage_locations", "currencies", "users", "system_settings"]
  for (const t of tables) {
    const count = (globalThis as any).__db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get().c
    console.log(`  ${t}: ${count} rows`)
  }

  closeDatabase()
  app.quit()
})
