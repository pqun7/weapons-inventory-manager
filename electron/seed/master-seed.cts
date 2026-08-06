import { app } from "electron"
import fs from "fs"
import path from "path"
import { initDatabase, closeDatabase, getDbPath, getDb, databaseExists } from "../database.js"

function removeDatabaseArtifacts(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const filePath = suffix ? `${dbPath}${suffix}` : dbPath
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }
}

app.whenReady().then(async () => {
  const dbPath = getDbPath()
  console.log(`Database path: ${dbPath}`)

  if (databaseExists()) {
    console.log("Removing existing database before master seed...")
    closeDatabase()
    removeDatabaseArtifacts(dbPath)
  }

  await initDatabase()

  const db = getDb()
  const tables = ["weapon_types", "weapon_subtypes", "calibers", "brands", "models", "warehouses", "storage_locations", "currencies", "users", "system_settings"]
  console.log("Master data seeded successfully:")
  for (const tableName of tables) {
    const countRow = db.prepare(`SELECT COUNT(*) as c FROM ${tableName}`).get() as { c: number }
    console.log(`  ${tableName}: ${countRow.c} rows`)
  }

  closeDatabase()
  app.quit()
})
