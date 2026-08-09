import { app } from "electron"
import { initDatabase, closeDatabase, getDbPath } from "../database.js"
import { seedDemoDataIfNeeded } from "../services/demo-seed-service.js"
import fs from "fs"

app.whenReady().then(async () => {
  const dbPath = getDbPath()
  console.log(`Database path: ${dbPath}`)

  if (!fs.existsSync(dbPath)) {
    console.error("Database does not exist. Run 'npm run seed:master' first.")
    app.quit()
    return
  }

  await initDatabase()

  try {
    const result = seedDemoDataIfNeeded()
    console.log(result.skipped ? "Demo data already exists; no changes made." : "Demo data seeded successfully.")
    console.log(result.counts)
  } catch (e) {
    console.error("Failed to seed demo data:", e)
  }

  closeDatabase()
  app.quit()
})
