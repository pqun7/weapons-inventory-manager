import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { app } from "electron"

process.env.NODE_ENV = "test"

const readinessWatchdog = setTimeout(() => {
  process.stderr.write("Electron did not reach app.whenReady() within 20 seconds.\n")
  app.exit(2)
}, 20_000)
await app.whenReady()
clearTimeout(readinessWatchdog)
const root = path.resolve(import.meta.dirname, "../..")
const database = await import(pathToFileURL(path.join(root, "dist-electron", "electron", "database.js")).href)
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "armory-electron-lifecycle-"))
const filename = path.join(temporary, "database", "app.db")

try {
  database.setDatabasePathForTests(filename)
  await database.initDatabase()
  const health = database.databaseHealthCheck(true)
  if (!health.healthy || !fs.existsSync(filename)) throw new Error("Electron SQLite lifecycle health check failed")
  database.closeDatabase()
  await database.initDatabase()
  if (!database.databaseHealthCheck(false).healthy) throw new Error("Electron SQLite reopen failed")
  database.closeDatabase()
  process.stdout.write("Electron SQLite lifecycle smoke test passed.\n")
  app.exit(0)
} catch (error) {
  try { database.closeDatabase() } catch { /* best-effort test cleanup */ }
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  app.exit(1)
}
