import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { backup, DatabaseSync } from "node:sqlite"
import { pathToFileURL } from "node:url"

process.env.NODE_ENV = "test"

const workspace = path.resolve(import.meta.dirname, "../..")
const compiled = (relativePath) => import(pathToFileURL(path.join(workspace, "dist-electron", relativePath)).href)
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "armory-sqlite-provider-"))
const testDbPath = path.join(tempRoot, "new-install", "database", "app.db")
const summary = {
  temporaryRoot: tempRoot,
  initialization: {},
  authentication: {},
  crud: {},
  relationsAndTransactions: {},
  integrity: {},
  performance: {},
  legacyMigration: { tested: false },
}

const databaseModule = await compiled("electron/database.js")
const auth = await compiled("electron/services/local-auth-service.js")
const commands = await compiled("electron/services/sqlite-command-service.js")
const providerMigration = await compiled("electron/services/provider-migration-service.js")

const op = (operation, ...args) => commands.executeSqliteDatabaseOperation(operation, args)
const db = () => databaseModule.getDb()
const tableCount = (table) => Number(db().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)

function expectThrows(operation, pattern) {
  let thrown = null
  try { operation() } catch (error) { thrown = error }
  assert.ok(thrown, "Expected the operation to throw")
  if (pattern) assert.match(String(thrown.message ?? thrown), pattern)
}

try {
  databaseModule.setDatabasePathForTests(testDbPath)
  const initializationStarted = performance.now()
  await databaseModule.initDatabase()
  summary.initialization.firstOpenMs = Math.round(performance.now() - initializationStarted)
  assert.equal(fs.existsSync(testDbPath), true)
  assert.equal(path.dirname(testDbPath), databaseModule.getDbDirectory())
  assert.equal(Number(db().pragma("user_version", { simple: true })), 15)
  assert.equal(Number(db().pragma("foreign_keys", { simple: true })), 1)
  assert.equal(String(db().pragma("journal_mode", { simple: true })).toLowerCase(), "wal")
  assert.equal(Number(db().pragma("busy_timeout", { simple: true })), 5000)
  summary.initialization.tables = tableCount("sqlite_schema")

  const requiredTables = [
    "users", "weapons", "weapon_types", "weapon_subtypes", "calibers", "brands", "models",
    "warehouses", "storage_locations", "suppliers", "customers", "shipments", "invoices",
    "payment_records", "accessories", "ammunition", "audit_logs", "system_settings",
    "app_notifications", "saved_filters", "user_preferences", "inventory_product_types",
    "app_installation", "database_health_probes",
  ]
  const actualTables = new Set(db().prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map((row) => row.name))
  for (const table of requiredTables) assert.ok(actualTables.has(table), `Missing table ${table}`)

  const firstHealth = databaseModule.databaseHealthCheck(true)
  assert.equal(firstHealth.healthy, true)
  summary.integrity.initial = firstHealth.details

  databaseModule.closeDatabase()
  await databaseModule.initDatabase()
  assert.equal(Number(db().pragma("user_version", { simple: true })), 15)
  summary.initialization.idempotentReopen = true

  const administrator = auth.configureLocalAdministrator({
    storeName: "SQLite Contract Test Store",
    adminName: "Contract Administrator",
    adminUsername: "contract.admin",
    adminPassword: "StrongPass123",
  })
  const storedPassword = db().prepare("SELECT password_hash FROM users WHERE id = ?").get(administrator.userId).password_hash
  assert.match(storedPassword, /^scrypt-v1\$/)
  assert.equal(storedPassword.includes("StrongPass123"), false)
  const session = auth.signInLocal("contract.admin", "StrongPass123")
  assert.equal(session.role, "Admin")
  assert.equal(auth.resolveLocalAccount("contract.admin").requiresActivation, false)
  summary.authentication = { passwordHash: "scrypt-v1", mainOwnedSession: true, primaryAdminId: session.userId }
  assert.ok(db().prepare("SELECT id FROM invoices WHERE id = 'DEMO-INVOICE'").get())

  // Pre-DEMO-namespace installations used these deterministic IDs. A failed
  // deletion used to flip show_demo_data to 0 while leaving every row behind.
  const cloneDemoRow = (table, sourceId, overrides) => {
    const row = { ...db().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(sourceId), ...overrides }
    const columns = Object.keys(row)
    db().prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...columns.map((column) => row[column]))
  }
  cloneDemoRow("suppliers", "DEMO-SUPPLIER", { id: "SUP001", name: "Global Arms Distributors" })
  cloneDemoRow("customers", "DEMO-CUSTOMER", { id: "CUST0001", name: "James Mitchell" })
  cloneDemoRow("accessories", "DEMO-ACCESSORY", { id: "ACC001", name: "Pistol Case" })
  cloneDemoRow("ammunition", "DEMO-AMMUNITION", { id: "AMM001", caliber: "9x19" })
  cloneDemoRow("shipments", "DEMO-SHIPMENT", { id: "SHP0001", shipment_number: "SHP-LEGACY-0001", supplier_id: "SUP001" })
  cloneDemoRow("invoices", "DEMO-INVOICE", { id: "INV00001", invoice_number: "INV-LEGACY-0001", customer_id: "CUST0001" })
  cloneDemoRow("payment_records", "DEMO-PAYMENT", { id: "PAY00001", invoice_id: "INV00001", invoice_number: "INV-LEGACY-0001" })
  db().prepare("INSERT INTO audit_logs(id,timestamp,date,user_id,action_type,description,metadata) VALUES('LOG00001','2025-01-01T00:00:00Z','2025-01-01',?,'Sale','Legacy demo invoice',?)")
    .run(session.userId, JSON.stringify({ invoiceId: "INV00001" }))
  db().prepare("INSERT INTO app_notifications(id,type,title,message,date,entity_id) VALUES('NTF0001','OverdueDebt','Legacy demo','Legacy demo','2025-01-01','INV00001')").run()
  op("dbDeleteDemoData")
  assert.equal(db().prepare("SELECT id FROM invoices WHERE id = 'DEMO-INVOICE'").get(), undefined)
  for (const [table, id] of [["invoices", "INV00001"], ["payment_records", "PAY00001"], ["shipments", "SHP0001"], ["accessories", "ACC001"], ["ammunition", "AMM001"], ["customers", "CUST0001"], ["suppliers", "SUP001"], ["audit_logs", "LOG00001"], ["app_notifications", "NTF0001"]]) {
    assert.equal(db().prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id), undefined, `${table}.${id} should be deleted`)
  }
  assert.equal(db().prepare("SELECT show_demo_data FROM system_settings WHERE id = 1").get().show_demo_data, 0)
  op("dbResetDemoData")
  assert.ok(db().prepare("SELECT id FROM invoices WHERE id = 'DEMO-INVOICE'").get())
  summary.demoLifecycle = { freshInstallSeeded: true, deleteScoped: true, resetVerified: true }

  const weaponTypeId = op("dbInsertMasterWeaponType", "Test Pistol", 900)
  const subtypeId = op("dbInsertMasterWeaponSubtype", weaponTypeId, "Test 9mm", 900)
  const caliberId = op("dbInsertMasterCaliber", "Test 9x19")
  op("dbLinkSubtypeCaliber", subtypeId, caliberId)
  const brandId = op("dbInsertMasterBrand", "Contract Brand")
  const modelId = op("dbInsertMasterModel", "Contract Model", brandId)
  const warehouseId = op("dbInsertMasterWarehouse", "Contract Warehouse")
  const locationId = op("dbInsertMasterStorageLocation", warehouseId, "S-01", "B-01")
  const master = op("dbGetMasterData")
  assert.ok(master.weaponTypes.some((row) => row.id === weaponTypeId))
  assert.ok(master.weaponSubtypes.some((row) => row.id === subtypeId && row.weapon_type_id === weaponTypeId))
  assert.ok(master.subtypeCalibers.some((row) => row.subtype_id === subtypeId && row.caliber_id === caliberId))

  const today = new Date().toISOString().slice(0, 10)
  const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  const valuation = (amount) => ({ originalAmount: amount, originalCurrency: "SAR", exchangeRate: 3.75, accountingAmount: amount / 3.75, accountingCurrency: "USD", exchangeRateDate: today, rateSource: "default" })
  const supplier = { id: "SUP-CONTRACT", name: "Contract Supplier", contactPerson: "Supplier User", phone: "100", email: "supplier@example.test", address: "Test", dateAdded: today }
  const customer = { id: "CUS-CONTRACT", name: "Contract Customer", phone: "200", email: "customer@example.test", address: "Test", isWholesaleBuyer: false, wholesaleDiscountPercent: 0, notes: "created", customFields: { license: "L-1" }, dateAdded: today }
  op("dbInsertSupplier", supplier)
  op("dbInsertCustomer", customer)
  op("dbUpdateCustomer", customer.id, { notes: "updated", phone: "201", customFields: { license: "L-2" } })

  const shipment = {
    id: "SH-CONTRACT", shipmentNumber: "SHIP-CONTRACT-1", supplierId: supplier.id, shipmentDate: today,
    expectedArrivalDate: future, totalExpectedItems: 1, attachments: [], notes: "test", status: "Pending",
    timeline: [], currency: "SAR", lineItems: [], documents: [], workflowStatus: "scheduled", plannedCosts: [], createdAt: new Date().toISOString(),
  }
  op("dbInsertShipment", shipment)
  op("dbUpdateScheduledShipment", shipment.id, {
    shipmentNumber: shipment.shipmentNumber, supplierId: supplier.id, shipmentDate: today,
    expectedArrivalDate: future, totalExpectedItems: 0, attachments: [], notes: "partial draft",
    currency: "SAR", lineItems: [{
      id: "SLI-PARTIAL", productType: "weapon", weaponTypeId: "", weaponSubtypeId: "",
      caliberId: "", brandId: "", modelId: "", storageLocationId: null,
      quantity: 0, purchasePrice: 0, retailPrice: 0, wholesalePrice: 0,
      serialNumbers: [], weaponTypeLabel: "", subTypeLabel: "", caliberLabel: "",
      brandLabel: "", modelLabel: "",
    }],
  })
  const savedDraftLines = JSON.parse(db().prepare("SELECT line_items FROM shipments WHERE id = ?").get(shipment.id).line_items)
  assert.equal(savedDraftLines[0].id, "SLI-PARTIAL")
  assert.equal(savedDraftLines[0].storageLocationId ?? null, null)

  const weapon = {
    id: "W-CONTRACT", serialNumber: "SERIAL-CONTRACT-0001", weaponTypeId, weaponSubtypeId: subtypeId,
    caliberId, brandId, modelId, storageLocationId: locationId, weaponType: "Test Pistol", subType: "Test 9mm",
    caliber: "Test 9x19", brand: "Contract Brand", model: "Contract Model",
    location: { warehouse: "Contract Warehouse", shelf: "S-01", bin: "B-01" }, condition: "Excellent",
    status: "Available", purchasePrice: 1000, retailPrice: 1500, wholesalePrice: 1300,
    retailPriceMode: "manual", wholesalePriceMode: "manual", actualFinalPrice: null, supplierId: supplier.id,
    shipmentId: shipment.id, dateAdded: today, batchId: "B-CONTRACT", notes: "created", images: [], movementHistory: [],
    purchasePriceValuation: valuation(1000), retailPriceValuation: valuation(1500), wholesalePriceValuation: valuation(1300),
  }
  const accessory = {
    id: "ACC-CONTRACT", name: "Contract Case", type: "Case", quantity: 10, safetyThreshold: 2, price: 50,
    priceCurrency: "SAR", retailPrice: 60, wholesalePrice: 55, retailPriceMode: "manual", wholesalePriceMode: "manual",
    priceValuation: valuation(50), retailPriceValuation: valuation(60), wholesalePriceValuation: valuation(55),
    dateAdded: today, location: { warehouse: "Contract Warehouse", shelf: "S-01", bin: "B-01" },
  }
  const ammunition = {
    id: "AMMO-CONTRACT", name: "Contract Ammo", caliber: "Test 9x19", packageType: "Box", unitsPerPackage: 50,
    fullPackages: 4, looseRounds: 5, safetyThreshold: 20, price: 2, priceCurrency: "SAR", retailPrice: 3,
    wholesalePrice: 2.5, retailPriceMode: "manual", wholesalePriceMode: "manual", dateAdded: today,
    priceValuation: valuation(2), retailPriceValuation: valuation(3), wholesalePriceValuation: valuation(2.5),
    location: { warehouse: "Contract Warehouse", shelf: "S-01", bin: "B-01" },
  }
  op("dbInsertWeapon", weapon)
  op("dbInsertAccessory", accessory)
  op("dbInsertAmmunition", ammunition)
  op("dbUpdateWeapon", { ...weapon, notes: "updated" })
  op("dbUpdateWeaponDetails", weapon.id, {
    serialNumber: "SERIAL-CONTRACT-EDITED", weaponTypeId, weaponSubtypeId: subtypeId, caliberId, brandId, modelId,
    storageLocationId: locationId, supplierId: supplier.id, condition: "Good", purchasePrice: 1000,
    retailPrice: 1500, wholesalePrice: 1300, retailPriceMode: "manual", wholesalePriceMode: "manual", currency: "SAR",
  })
  const editedWeapon = db().prepare("SELECT serial_number, condition, purchase_price_valuation FROM weapons WHERE id = ?").get(weapon.id)
  assert.equal(editedWeapon.serial_number, "SERIAL-CONTRACT-EDITED")
  assert.equal(editedWeapon.condition, "Good")
  assert.equal(JSON.parse(editedWeapon.purchase_price_valuation).accountingCurrency, "USD")
  expectThrows(() => op("dbUpdateWeaponDetails", weapon.id, {
    serialNumber: "SERIAL-CONTRACT-EDITED", weaponTypeId, weaponSubtypeId: subtypeId, caliberId, brandId, modelId,
    storageLocationId: locationId, supplierId: supplier.id, condition: "Good", purchasePrice: 1000,
    retailPrice: 1200, wholesalePrice: 1300, retailPriceMode: "manual", wholesalePriceMode: "manual", currency: "SAR",
  }), /wholesale price/i)
  op("dbUpdateAccessory", { ...accessory, quantity: 12, retailPrice: 65 })
  op("dbUpdateAmmunition", { ...ammunition, looseRounds: 10, retailPrice: 3.25 })
  const intakeWithoutLocation = op("dbBulkIntakeWeapons", {
    serialNumbers: ["SERIAL-NO-LOCATION-0001"], weaponTypeId, weaponSubtypeId: subtypeId,
    caliberId, brandId, modelId, storageLocationId: null, condition: "Excellent",
    purchasePrice: 900, retailPrice: 1200, wholesalePrice: 1100, supplierId: supplier.id,
    shipmentId: null, currency: "SAR", notes: "optional location contract", additionalCosts: [],
  })
  assert.equal(intakeWithoutLocation.added, 1)
  assert.equal(db().prepare("SELECT storage_location_id FROM weapons WHERE serial_number = ?").get("SERIAL-NO-LOCATION-0001").storage_location_id, null)

  op("dbInsertAuditLog", { id: "AUD-CONTRACT", timestamp: new Date().toISOString(), date: today, userId: session.userId, actionType: "Update", description: "contract audit", metadata: "{}" })
  op("dbInsertNotification", { id: "NTF-CONTRACT", type: "System", title: "Contract", message: "notification", date: today, read: false, entityId: weapon.id })
  op("dbInsertSavedFilter", { id: "FILTER-CONTRACT", name: "Available", entityType: "weapons", filterState: { status: "Available" } })
  op("dbUpsertUserPreferences", { userId: session.userId, displayCurrency: "SAR", reportViewMode: "accounting", language: "ar", dateFormat: "yyyy-MM-dd", inventoryVisibleColumns: ["serialNumber", "status"] })
  assert.deepEqual(op("dbGetUserPreferences", session.userId).inventoryVisibleColumns, ["serialNumber", "status"])

  const createdUser = op("dbInsertUser", {
    id: "U-EMPLOYEE", username: "employee.contract", name: "Contract Employee", role: "Employee",
    permissions: { canImportExcel: false, canExportData: false, canViewReports: false, canManageUsers: false, canRegisterPayments: false, canVoidInvoices: false, canExtendDueDates: false, canDeleteRecords: false },
    passwordSet: false, passwordHash: "",
  })
  assert.match(createdUser.activationCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  auth.signOutLocal()
  const employeeSession = auth.claimLocalAccount("employee.contract", createdUser.activationCode, "EmployeePass123")
  assert.equal(employeeSession.userId, createdUser.userId)
  expectThrows(() => auth.createLocalActivationCode(createdUser.userId), /completed password setup/i)
  auth.signOutLocal()
  auth.signInLocal("contract.admin", "StrongPass123")

  op("dbDeleteUser", createdUser.userId)
  expectThrows(() => auth.resolveLocalAccount("employee.contract"), /not found|inactive/i)
  const recreatedUser = op("dbInsertUser", {
    id: "U-EMPLOYEE-REUSED", username: "employee.contract", name: "Contract Employee", role: "Employee",
    permissions: { canImportExcel: false, canExportData: false, canViewReports: false, canManageUsers: false, canRegisterPayments: false, canVoidInvoices: false, canExtendDueDates: false, canDeleteRecords: false },
    passwordSet: false, passwordHash: "",
  })
  assert.match(recreatedUser.activationCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  assert.equal(db().prepare("SELECT is_active FROM users WHERE id = ?").get(createdUser.userId).is_active, 0)

  const all = op("dbGetAll")
  const expectedContractKeys = ["weapons", "accessories", "ammunition", "shipments", "invoices", "payments", "customers", "suppliers", "auditLogs", "notifications", "users", "settings", "savedFilters", "inventoryProductTypes"]
  assert.deepEqual(Object.keys(all).sort(), expectedContractKeys.sort())
  assert.equal(all.weapons.find((row) => row.id === weapon.id).notes, "updated")
  assert.equal(all.accessories.find((row) => row.id === accessory.id).retailPrice, 65)
  assert.equal(all.ammunition.find((row) => row.id === ammunition.id).name, "Contract Ammo")
  assert.equal(all.customers.find((row) => row.id === customer.id).customFields.license, "L-2")
  assert.equal(all.users.some((row) => row.id === createdUser.userId), false)
  assert.equal(all.users.some((row) => row.id === recreatedUser.userId), true)
  summary.crud = {
    entities: ["users", "weapons", "weapon types", "subtypes", "calibers", "brands", "models", "storage locations", "suppliers", "customers", "shipments", "accessories", "ammunition", "audit logs", "settings", "notifications", "saved filters", "preferences"],
    providerContractKeys: expectedContractKeys,
  }

  expectThrows(() => op("dbInsertWeapon", { ...weapon, id: "W-DUPLICATE", serialNumber: "SERIAL-CONTRACT-EDITED", notes: "duplicate" }), /UNIQUE|unique/i)
  expectThrows(() => op("dbInsertWeapon", { ...weapon, id: "W-BAD-FK", serialNumber: "BAD-FK-SERIAL", brandId: "missing-brand" }), /FOREIGN KEY/i)
  expectThrows(() => db().prepare("INSERT INTO customers(id, name, date_added) VALUES ('CUS-BAD', NULL, ?)").run(today), /NOT NULL/i)

  const transactionBefore = tableCount("customers")
  expectThrows(() => db().transaction(() => {
    db().prepare("INSERT INTO customers(id,name,phone,email,address,is_wholesale_buyer,wholesale_discount_percent,date_added) VALUES('CUS-ROLLBACK','Rollback','','','',0,0,?)").run(today)
    db().prepare("INSERT INTO shipments(id,shipment_number,supplier_id,shipment_date,expected_arrival_date,total_expected_items,attachments,notes,status,timeline,currency) VALUES('SH-BAD','SH-BAD','NO-SUPPLIER',?,?,0,'[]','','Pending','[]','SAR')").run(today, future)
  })(), /FOREIGN KEY/i)
  assert.equal(tableCount("customers"), transactionBefore)
  assert.equal(db().prepare("SELECT id FROM customers WHERE id='CUS-ROLLBACK'").get(), undefined)

  const settings = op("dbGetSettings")
  const tax = Number(settings.taxPercent)
  const saleInput = {
    operationId: crypto.randomUUID(),
    weaponIds: [weapon.id],
    lineItems: [{ itemType: "weapon", itemId: weapon.id, name: weapon.serialNumber, quantity: 1, unitPrice: 1500, total: 1500 }],
    customerId: customer.id, customerName: customer.name, mode: "Retail", invoiceNumber: "INV-CONTRACT-SALE",
    totalNegotiated: 1500, totalOriginal: 1500, dueDate: future, attachments: [], notes: "atomic sale",
    taxAmount: Number((1500 * tax / 100).toFixed(2)), paidAmount: 0, paymentMethod: "cash", date: today, currency: "SAR",
  }
  const sale = op("dbCompleteSale", saleInput)
  assert.ok(sale.invoiceId)
  const capturedSaleLine = JSON.parse(db().prepare("SELECT line_items FROM invoices WHERE id = ?").get(sale.invoiceId).line_items)[0]
  assert.ok(Math.abs(capturedSaleLine.unitLandedCostAccounting - (1000 / 3.75)) < 0.01)
  assert.equal(capturedSaleLine.costSnapshotSource, "trusted-base-valuation")
  assert.equal(db().prepare("SELECT status FROM weapons WHERE id = ?").get(weapon.id).status, "Sold")
  const retriedSale = op("dbCompleteSale", saleInput)
  assert.deepEqual(retriedSale, sale)
  assert.equal(Number(db().prepare("SELECT COUNT(*) AS count FROM invoices WHERE id = ?").get(sale.invoiceId).count), 1)
  expectThrows(() => op("dbCompleteSale", { ...saleInput, operationId: crypto.randomUUID(), invoiceNumber: "INV-CONTRACT-DUPLICATE" }), /already sold|not available/i)
  assert.equal(Number(db().prepare("SELECT COUNT(*) AS count FROM invoices WHERE invoice_number LIKE 'INV-CONTRACT-%'").get().count), 1)
  const invoiceBeforePayment = op("dbGetAll").invoices.find((row) => row.id === sale.invoiceId)
  const payment = op("dbRegisterPayment", { invoiceId: sale.invoiceId, amount: invoiceBeforePayment.balance, currency: "SAR", method: "cash", notes: "settled" })
  assert.equal(payment.newBalance, 0)
  assert.equal(db().prepare("SELECT status FROM invoices WHERE id = ?").get(sale.invoiceId).status, "Paid")

  const atomicCustomerInput = {
    operationId: crypto.randomUUID(), weaponIds: [],
    lineItems: [{ itemType: "accessory", itemId: accessory.id, name: accessory.name, quantity: 1, unitPrice: 60, total: 60 }],
    newCustomer: { name: "Atomic Customer", phone: "+966 555 100", email: "Atomic@Example.Test", address: "Riyadh", isWholesaleBuyer: false, wholesaleDiscountPercent: 0 },
    mode: "Retail", invoiceNumber: "INV-ATOMIC-CUSTOMER", totalNegotiated: 60, totalOriginal: 60,
    dueDate: future, attachments: [], notes: "rollback test", taxAmount: Number((60 * tax / 100).toFixed(2)),
    paidAmount: 0, paymentMethod: "cash", date: today, currency: "SAR",
  }
  db().exec("CREATE TRIGGER reject_atomic_invoice BEFORE INSERT ON invoices WHEN NEW.invoice_number = 'INV-ATOMIC-CUSTOMER' BEGIN SELECT RAISE(ABORT, 'forced invoice failure'); END")
  expectThrows(() => op("dbCompleteSale", atomicCustomerInput), /forced invoice failure/i)
  assert.equal(db().prepare("SELECT id FROM customers WHERE lower(email) = 'atomic@example.test'").get(), undefined)
  assert.equal(db().prepare("SELECT quantity FROM accessories WHERE id = ?").get(accessory.id).quantity, 12)
  db().exec("DROP TRIGGER reject_atomic_invoice")
  const atomicCustomerSale = op("dbCompleteSale", atomicCustomerInput)
  assert.ok(atomicCustomerSale.invoiceId)
  assert.equal(Number(db().prepare("SELECT COUNT(*) AS count FROM customers WHERE lower(email) = 'atomic@example.test'").get().count), 1)
  const atomicCustomerRetry = op("dbCompleteSale", atomicCustomerInput)
  assert.deepEqual(atomicCustomerRetry, atomicCustomerSale)

  const priceOnlyStock = {
    operationId: crypto.randomUUID(), itemType: "accessory", itemId: accessory.id,
    quantityDelta: 0, costUpdate: { amount: 52, currency: "SAR" },
    shipmentId: null, notes: "price-only correction", location: accessory.location,
  }
  const stockBefore = db().prepare("SELECT quantity FROM accessories WHERE id = ?").get(accessory.id).quantity
  op("dbAdjustInventoryStock", priceOnlyStock)
  assert.equal(db().prepare("SELECT quantity FROM accessories WHERE id = ?").get(accessory.id).quantity, stockBefore)
  assert.equal(db().prepare("SELECT price FROM accessories WHERE id = ?").get(accessory.id).price, 52)
  const priceAuditCount = tableCount("audit_logs")
  op("dbAdjustInventoryStock", priceOnlyStock)
  assert.equal(tableCount("audit_logs"), priceAuditCount)
  expectThrows(() => op("dbAdjustInventoryStock", { ...priceOnlyStock, quantityDelta: 1 }), /different request/i)
  const quantityOnlyStock = { ...priceOnlyStock, operationId: crypto.randomUUID(), quantityDelta: 3, costUpdate: undefined, notes: "quantity-only receipt" }
  op("dbAdjustInventoryStock", quantityOnlyStock)
  assert.equal(db().prepare("SELECT quantity FROM accessories WHERE id = ?").get(accessory.id).quantity, stockBefore + 3)
  summary.relationsAndTransactions = {
    foreignKeys: "enforced",
    uniqueSerials: "enforced",
    rollback: "verified",
    atomicSale: "verified",
    idempotentSaleRetry: "verified",
    atomicCustomerRollbackAndRetry: "verified",
    independentIdempotentStockChanges: "verified",
    duplicateSale: "prevented",
    invoicePayment: "atomic",
  }

  op("dbDeleteNotification", "NTF-CONTRACT")
  op("dbDeleteSavedFilter", "FILTER-CONTRACT")
  op("dbDeleteCustomer", customer.id)
  assert.equal(db().prepare("SELECT id FROM customers WHERE id = ?").get(customer.id), undefined)
  assert.equal(db().prepare("SELECT id FROM saved_filters WHERE id = 'FILTER-CONTRACT'").get(), undefined)

  const bulkInsert = db().prepare(`INSERT INTO weapons(
    id,serial_number,weapon_type_id,weapon_subtype_id,brand_id,model_id,caliber_id,storage_location_id,supplier_id,shipment_id,
    condition,status,purchase_price,retail_price,wholesale_price,actual_final_price,date_added,notes,images,movement_history,
    purchase_price_valuation,retail_price_valuation,wholesale_price_valuation
  ) VALUES(?,?,?,?,?,?,?,?,?,NULL,'Excellent','Available',100,150,125,NULL,?,'bulk','[]','[]',?,?,?)`)
  const bulkStarted = performance.now()
  db().transaction(() => {
    for (let index = 0; index < 5_000; index++) {
      bulkInsert.run(`W-BULK-${index}`, `BULK-SERIAL-${String(index).padStart(7, "0")}`, weaponTypeId, subtypeId, brandId, modelId, caliberId, locationId, supplier.id, today, valuation(100), valuation(150), valuation(125))
    }
  })()
  const bulkMs = Math.round(performance.now() - bulkStarted)
  const searchStarted = performance.now()
  const foundSerial = db().prepare("SELECT id,serial_number,status FROM weapons WHERE serial_number = ? COLLATE NOCASE AND deleted_at IS NULL").get("bulk-serial-0004321")
  const searchMs = Number((performance.now() - searchStarted).toFixed(3))
  assert.equal(foundSerial.id, "W-BULK-4321")
  const page = db().prepare("SELECT id,serial_number,status FROM weapons WHERE status = ? AND deleted_at IS NULL ORDER BY date_added DESC, id LIMIT ? OFFSET ?").all("Available", 50, 100)
  assert.equal(page.length, 50)
  const plan = db().prepare("EXPLAIN QUERY PLAN SELECT id FROM weapons WHERE serial_number = ? COLLATE NOCASE AND deleted_at IS NULL").all("bulk-serial-0004321")
  assert.ok(plan.some((row) => /idx_weapons_serial_search/i.test(String(row.detail))))
  summary.performance = { rowsInserted: 5_000, bulkInsertMs: bulkMs, serialSearchMs: searchMs, paginationRows: page.length, serialIndexUsed: true }

  const portableSnapshot = providerMigration.exportSqliteProviderSnapshotForTests()
  portableSnapshot.sourceProvider = "supabase"
  portableSnapshot.tables.users = portableSnapshot.tables.users.map((row) => ({
    ...row,
    permissions: typeof row.permissions === "string" ? JSON.parse(row.permissions) : row.permissions,
    is_active: row.is_active === 1,
    is_primary_admin: row.is_primary_admin === 1,
    password_set: row.password_set === 1,
  }))
  providerMigration.importSupabaseProviderSnapshotForTests(portableSnapshot, {
    administratorEmail: "contract.admin@example.test",
    administratorPassword: "CloudAdminPass123",
    localStoreName: "Migrated SQLite Contract Store",
    localAdministratorName: "Migrated Contract Administrator",
    localAdministratorUsername: "migrated.admin",
    localAdministratorPassword: "MigratedLocalPass123",
    confirmation: "MIGRATE",
  })
  auth.signOutLocal()
  const migratedSession = auth.signInLocal("migrated.admin", "MigratedLocalPass123")
  assert.equal(migratedSession.role, "Admin")
  assert.equal(auth.resolveLocalAccount("employee.contract").requiresActivation, true)
  assert.equal(db().prepare("SELECT id FROM weapons WHERE id = 'W-BULK-4321'").get().id, "W-BULK-4321")
  summary.providerMigration = {
    direction: "supabase-to-sqlite",
    rowsImported: Object.values(portableSnapshot.manifest).reduce((total, count) => total + count, 0),
    primaryAdminCredentialRecreated: true,
    otherUsersRequireReactivation: true,
  }

  const finalHealth = databaseModule.databaseHealthCheck(true)
  assert.equal(finalHealth.healthy, true)
  summary.integrity.final = finalHealth.details
  assert.equal(db().prepare("PRAGMA integrity_check").get().integrity_check, "ok")
  assert.equal(db().prepare("PRAGMA foreign_key_check").all().length, 0)

  databaseModule.closeDatabase()
  await databaseModule.initDatabase()
  assert.equal(db().prepare("SELECT id FROM weapons WHERE id = 'W-BULK-4321'").get().id, "W-BULK-4321")
  summary.initialization.dataPersistsAfterRestart = true
  databaseModule.closeDatabase()

  const legacySource = process.env.LEGACY_SQLITE_PATH || (process.env.APPDATA ? path.join(process.env.APPDATA, "armory-store", "db", "armory_store.db") : "")
  if (legacySource && fs.existsSync(legacySource)) {
    const legacyCopy = path.join(tempRoot, "legacy-migration", "armory_store.db")
    fs.mkdirSync(path.dirname(legacyCopy), { recursive: true })
    const source = new DatabaseSync(legacySource, { readOnly: true })
    try { await backup(source, legacyCopy) } finally { source.close() }
    databaseModule.setDatabasePathForTests(legacyCopy)
    const before = new DatabaseSync(legacyCopy, { readOnly: true })
    const beforeVersion = Number(before.prepare("PRAGMA user_version").get().user_version)
    const beforeUsers = Number(before.prepare("SELECT COUNT(*) AS count FROM users").get().count)
    before.close()
    await databaseModule.initDatabase()
    const afterVersion = Number(db().pragma("user_version", { simple: true }))
    assert.equal(afterVersion, 14)
    assert.equal(tableCount("users"), beforeUsers)
    assert.equal(db().prepare("PRAGMA integrity_check").get().integrity_check, "ok")
    assert.equal(db().prepare("PRAGMA foreign_key_check").all().length, 0)
    const usersSql = String(db().prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='users'").get().sql)
    assert.match(usersSql, /legacy_role|Employee/)
    databaseModule.closeDatabase()
    summary.legacyMigration = { tested: true, sourceVersion: beforeVersion, targetVersion: afterVersion, preservedUsers: beforeUsers }
  }

  process.stdout.write(`${JSON.stringify({ success: true, summary }, null, 2)}\n`)
} catch (error) {
  try { databaseModule.closeDatabase() } catch { /* ignore test cleanup errors */ }
  process.stderr.write(`${JSON.stringify({ success: false, error: error instanceof Error ? error.stack : String(error), summary }, null, 2)}\n`)
  process.exitCode = 1
}
