import { app } from "electron"
import { initDatabase, closeDatabase, getDb } from "../database"

app.whenReady().then(() => {
  console.log("Resetting business data (preserving master data and settings)...")

  initDatabase()

  const db = getDb()
  db.transaction(() => {
    db.exec("DELETE FROM weapons")
    db.exec("DELETE FROM shipments")
    db.exec("DELETE FROM invoices")
    db.exec("DELETE FROM payment_records")
    db.exec("DELETE FROM accessories")
    db.exec("DELETE FROM ammunition")
    db.exec("DELETE FROM customers")
    db.exec("DELETE FROM suppliers")
    db.exec("DELETE FROM audit_logs")
    db.exec("DELETE FROM app_notifications")
  })

  console.log("Business data cleared. Master data and settings preserved.")
  closeDatabase()
  app.quit()
})
