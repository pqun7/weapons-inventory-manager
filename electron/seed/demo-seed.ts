import { app } from "electron"
import { initDatabase, closeDatabase, getDbPath } from "../database"
import { repo } from "../repositories"
import { generateMockData } from "../../src/lib/mock-data"
import fs from "fs"

app.whenReady().then(() => {
  const dbPath = getDbPath()
  console.log(`Database path: ${dbPath}`)

  if (!fs.existsSync(dbPath)) {
    console.error("Database does not exist. Run 'npm run seed:master' first.")
    app.quit()
    return
  }

  initDatabase()

  const mock = generateMockData()

  try {
    for (const w of mock.weapons) repo.insertWeapon(w)
    for (const s of mock.shipments) repo.insertShipment(s)
    for (const inv of mock.invoices) repo.insertInvoice(inv)
    for (const p of mock.payments) repo.insertPayment(p)
    for (const a of mock.accessories) repo.insertAccessory(a)
    for (const a of mock.ammunition) repo.insertAmmunition(a)
    for (const c of mock.customers) repo.insertCustomer(c)
    for (const s of mock.suppliers) repo.insertSupplier(s)
    for (const l of mock.auditLogs) repo.insertAuditLog(l)
    for (const n of mock.notifications) repo.insertNotification(n)

    console.log("Demo data seeded successfully:")
    console.log(`  weapons: ${mock.weapons.length}`)
    console.log(`  shipments: ${mock.shipments.length}`)
    console.log(`  invoices: ${mock.invoices.length}`)
    console.log(`  payments: ${mock.payments.length}`)
    console.log(`  accessories: ${mock.accessories.length}`)
    console.log(`  ammunition: ${mock.ammunition.length}`)
    console.log(`  customers: ${mock.customers.length}`)
    console.log(`  suppliers: ${mock.suppliers.length}`)
    console.log(`  auditLogs: ${mock.auditLogs.length}`)
    console.log(`  notifications: ${mock.notifications.length}`)
  } catch (e) {
    console.error("Failed to seed demo data:", e)
  }

  closeDatabase()
  app.quit()
})
