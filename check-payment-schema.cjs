const Database = require("better-sqlite3")
const path = require("path")
const os = require("os")

const dbPath = path.join(
    os.homedir(),
    "AppData",
    "Roaming",
    "armory-store",
    "db",
    "armory_store.db"
)

console.log("DB:", dbPath)

const db = new Database(dbPath)

const result = db
    .prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table'
      AND name = 'payment_records'
  `)
    .get()

console.log("\nPAYMENT_RECORDS SCHEMA:")
console.log(result?.sql)

console.log("\nDATABASE VERSION:")
console.log(
    db.pragma("user_version", { simple: true })
)

db.close()