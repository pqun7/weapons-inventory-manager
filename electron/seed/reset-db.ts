import { app } from "electron"
import fs from "fs"
import { initDatabase, closeDatabase, getDbPath } from "../database.js"

app.setName('armory-store')

function removeDatabaseArtifacts(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const filePath = suffix ? `${dbPath}${suffix}` : dbPath
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }
}

app.whenReady().then(async () => {
  console.log("Resetting database by recreating the SQLite file...")

  const dbPath = getDbPath()

  console.log("RESET DATABASE PATH:", dbPath)
  console.log("Electron userData:", app.getPath("userData"))

  closeDatabase()

  removeDatabaseArtifacts(dbPath)

  await initDatabase()

  closeDatabase()

  console.log(
    "Database reset completed with schema migrations and initial master data."
  )

  app.quit()
})