import { createHash, randomUUID } from "node:crypto"
import {
  createDatabaseBackup,
  deleteDatabaseBackup,
  getDb,
  listDatabaseBackups,
  restoreDatabaseBackup,
} from "../database.js"
import { repo } from "../repositories/index.js"
import { completeSale } from "./sale-service.js"
import { registerPayment } from "./payment-service.js"
import { backendCurrencyService } from "./currency-service.js"
import {
  finalizeStandaloneInventoryCost,
  replaceProductCosts,
} from "./product-cost-service.js"
import {
  createLocalActivationCode,
  requireLocalSession,
} from "./local-auth-service.js"
import { mappers } from "../../src/lib/db/mappers.js"
import { canonicalSupplierName } from "../../src/lib/supplier-identity.js"
import type {
  Accessory,
  Ammunition,
  AppNotification,
  AuditLog,
  Customer,
  Invoice,
  PaymentRecord,
  ProductAdditionalCostInput,
  SavedFilter,
  Shipment,
  ShipmentDocument,
  ShipmentLineItem,
  ShipmentTimelineEntry,
  Supplier,
  SystemSettings,
  User,
  UserPreferences,
  Weapon,
  WeaponStatus,
} from "../../src/lib/types.js"
import type {
  AddStockInput,
  BulkIntakeInput,
  BulkShipmentCreateInput,
  DueDateExtensionInput,
  PaymentInput,
  ReceiveAmmoByPackagesInput,
  ReceiveAmmoByRoundsInput,
  ShipmentInput,
  ShipmentLineItemInput,
  UpdateAmmoPackageInput,
} from "../../src/lib/store-inputs.js"
import { DATABASE_OPERATION_NAMES, type DatabaseOperationName } from "../../src/lib/database-provider.js"
import { deleteDemoData, resetDemoData } from "./demo-data-service.js"

export const SQLITE_DATABASE_OPERATIONS = DATABASE_OPERATION_NAMES
export type SqliteDatabaseOperation = DatabaseOperationName

function value<T>(args: readonly unknown[], index: number): T {
  if (index >= args.length) throw new Error(`Missing argument ${index + 1}`)
  return args[index] as T
}

function text(args: readonly unknown[], index: number, field: string): string {
  const result = value<unknown>(args, index)
  if (typeof result !== "string" || result.length > 2_000_000) throw new Error(`${field} is invalid`)
  return result
}

function finiteNumber(args: readonly unknown[], index: number, field: string): number {
  const result = value<unknown>(args, index)
  if (typeof result !== "number" || !Number.isFinite(result)) throw new Error(`${field} must be a finite number`)
  return result
}

function currentUser(): { id: string; name: string } {
  const active = requireLocalSession()
  return { id: active.userId, name: active.name }
}

function requireAdmin(): void {
  if (requireLocalSession().role !== "Admin") throw new Error("Administrator permission is required")
}

function requireInventoryEdit(): void {
  const session = requireLocalSession()
  if (session.role === "Admin") return
  const row = getDb().prepare("SELECT permissions FROM users WHERE id = ?").get(session.userId) as { permissions?: string } | undefined
  let permissions: Record<string, unknown> = {}
  try { permissions = JSON.parse(row?.permissions ?? "{}") as Record<string, unknown> } catch { /* invalid permissions grant nothing */ }
  if (permissions["inventory.edit"] !== true) throw new Error("Inventory edit permission is required")
}

function updateWeaponStatusControlled(weaponId: string, nextStatus: WeaponStatus, reason: string): void {
  requireInventoryEdit()
  const allowed: Record<WeaponStatus, WeaponStatus[]> = {
    Available: ["Reserved"], Reserved: ["Available"], Sold: ["Returned"], Returned: ["Available"],
  }
  const weapon = repo.getAll().weapons.find((item) => item.id === weaponId)
  if (!weapon) throw new Error("Weapon not found")
  if (weapon.status === nextStatus) return
  if (!allowed[weapon.status].includes(nextStatus)) throw new Error(`Invalid weapon status transition: ${weapon.status} to ${nextStatus}`)
  const user = currentUser()
  repo.updateWeapon({
    ...weapon,
    status: nextStatus,
    movementHistory: [...weapon.movementHistory, {
      id: `MV-${randomUUID()}`, timestamp: new Date().toISOString(), fromStatus: weapon.status,
      toStatus: nextStatus, userId: user.id, userName: user.name, reason: reason.trim() || "Controlled status update",
    }],
  })
  repo.insertAuditLog({
    id: `AUD-${randomUUID()}`, timestamp: new Date().toISOString(), date: new Date().toISOString().slice(0, 10),
    userId: user.id, actionType: "Update", description: `Weapon ${weapon.serialNumber}: ${weapon.status} to ${nextStatus}`,
    metadata: JSON.stringify({ entityType: "weapon", entityId: weapon.id, previousStatus: weapon.status, newStatus: nextStatus, reason }),
  })
}

function updateJsonArray(table: "weapons" | "shipments", column: "images" | "documents" | "timeline", id: string, update: (items: unknown[]) => unknown[]): void {
  const row = getDb().prepare(`SELECT ${column} FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined
  if (!row) throw new Error("Record not found")
  let items: unknown[] = []
  try { items = JSON.parse(String(row[column] ?? "[]")) as unknown[] } catch { items = [] }
  getDb().prepare(`UPDATE ${table} SET ${column} = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(update(items)), id)
}

function nextId(prefix: string): string {
  const row = getDb().prepare(`
    INSERT INTO business_id_counters(prefix, last_value) VALUES (?, 1)
    ON CONFLICT(prefix) DO UPDATE SET last_value = last_value + 1
    RETURNING last_value
  `).get(prefix) as { last_value: number }
  return `${prefix}${String(row.last_value).padStart(5, "0")}`
}

function nextShipmentNumber(): string {
  const prefix = `SHP-${new Date().getFullYear()}`
  const rows = getDb().prepare("SELECT shipment_number FROM shipments WHERE shipment_number LIKE ?")
    .all(`${prefix}%`) as Array<{ shipment_number: string }>
  const next = rows.reduce((maximum, row) => {
    const suffix = Number(row.shipment_number.slice(prefix.length))
    return Number.isInteger(suffix) ? Math.max(maximum, suffix) : maximum
  }, 0) + 1
  return `${prefix}${String(next).padStart(4, "0")}`
}

function shipmentLineItem(input: ShipmentLineItemInput, index: number): ShipmentLineItem {
  return {
    id: input.id ?? `SLI${String(index + 1).padStart(4, "0")}`,
    productType: input.productType,
    weaponType: input.weaponTypeLabel ?? "",
    subType: input.subTypeLabel ?? "",
    brand: input.brandLabel ?? "",
    model: input.modelLabel ?? "",
    caliber: input.caliberLabel ?? "",
    quantity: input.quantity,
    purchasePrice: input.purchasePrice,
    retailPrice: input.retailPrice,
    wholesalePrice: input.wholesalePrice,
    retailPriceMode: input.retailPriceMode,
    wholesalePriceMode: input.wholesalePriceMode,
    weaponTypeId: input.weaponTypeId || undefined,
    weaponSubtypeId: input.weaponSubtypeId || undefined,
    caliberId: input.caliberId || undefined,
    brandId: input.brandId || undefined,
    modelId: input.modelId || undefined,
    storageLocationId: input.storageLocationId || undefined,
    location: input.location,
    serialNumbers: input.serialNumbers,
    received: 0,
    additionalCosts: input.additionalCosts,
  }
}

function createShipment(input: ShipmentInput): string {
  const shipmentNumber = input.shipmentNumber.trim() || nextShipmentNumber()
  if (getDb().prepare("SELECT 1 FROM shipments WHERE shipment_number = ?").get(shipmentNumber)) {
    throw new Error("Shipment number already exists")
  }
  let supplierId = input.supplierId
  if (input.newSupplier) {
    const draftName = input.newSupplier.name.trim().replace(/\s+/g, " ")
    if (!draftName) throw new Error("Supplier name is required")
    const existingSupplier = repo.getAll().suppliers.find((supplier) => canonicalSupplierName(supplier.name) === canonicalSupplierName(draftName))
    if (existingSupplier) supplierId = existingSupplier.id
    else {
      supplierId = nextId("SUP")
      repo.insertSupplier({
        id: supplierId,
        name: draftName,
        contactPerson: input.newSupplier.contactPerson.trim(),
        phone: input.newSupplier.phone.trim(),
        email: input.newSupplier.email.trim().toLocaleLowerCase("en"),
        address: input.newSupplier.address.trim(),
        dateAdded: new Date().toISOString().slice(0, 10),
      })
    }
  }
  if (!supplierId || !getDb().prepare("SELECT 1 FROM suppliers WHERE id = ?").get(supplierId)) throw new Error("Supplier not found")
  const id = nextId("SH")
  const shipment: Shipment = {
    id,
    shipmentNumber,
    supplierId,
    shipmentDate: input.shipmentDate,
    expectedArrivalDate: input.expectedArrivalDate,
    totalExpectedItems: input.totalExpectedItems,
    attachments: input.attachments,
    notes: input.notes,
    status: input.status ?? "Pending",
    timeline: [],
    purchaseOrderNumber: input.purchaseOrderNumber,
    invoiceNumber: input.invoiceNumber,
    shippingCarrier: input.shippingCarrier,
    containerNumber: input.containerNumber,
    currency: input.currency,
    purchaseDate: input.purchaseDate,
    actualArrivalDate: input.actualArrivalDate,
    lineItems: (input.lineItems ?? []).map(shipmentLineItem),
    documents: [],
    workflowStatus: input.expectedArrivalDate > new Date().toISOString().slice(0, 10) ? "scheduled" : "arrived",
    plannedCosts: input.additionalCosts ?? [],
    createdAt: new Date().toISOString(),
  }
  repo.insertShipment(shipment)
  return id
}

function bulkIntake(input: BulkIntakeInput): { added: number; duplicates: string[] } {
  const database = getDb()
  return database.transaction(() => {
    const master = repo.getMasterData()
    const weaponType = master.weaponTypes.find((row) => row.id === input.weaponTypeId)
    const subtype = master.weaponSubtypes.find((row) => row.id === input.weaponSubtypeId && row.weapon_type_id === input.weaponTypeId)
    const caliber = master.calibers.find((row) => row.id === input.caliberId)
    const brand = master.brands.find((row) => row.id === input.brandId)
    const model = master.models.find((row) => row.id === input.modelId && row.brand_id === input.brandId)
    if (!weaponType || !subtype || !caliber || !brand || !model) throw new Error("Invalid related weapon master data")
    if (!master.subtypeCalibers.some((row) => row.subtype_id === subtype.id && row.caliber_id === caliber.id)) throw new Error("The selected caliber is not linked to the selected subtype")
    const locationRow = input.storageLocationId
      ? database.prepare(`SELECT wh.label AS warehouse, sl.shelf, sl.bin FROM storage_locations sl JOIN warehouses wh ON wh.id = sl.warehouse_id WHERE sl.id = ?`).get(input.storageLocationId) as { warehouse: string; shelf: string; bin: string } | undefined
      : { warehouse: "", shelf: "", bin: "" }
    if (!locationRow) throw new Error("Storage location not found")
    const existing = new Set((database.prepare("SELECT serial_number FROM weapons").all() as Array<{ serial_number: string }>).map((row) => row.serial_number.toLocaleLowerCase("en")))
    const duplicates: string[] = []
    const weapons: Weapon[] = []
    const snapshot = backendCurrencyService.getRateSnapshot(input.currency ?? backendCurrencyService.getDefaultTransactionCurrency())
    for (const rawSerial of input.serialNumbers) {
      const serial = rawSerial.trim()
      if (!serial || existing.has(serial.toLocaleLowerCase("en"))) { if (serial) duplicates.push(serial); continue }
      existing.add(serial.toLocaleLowerCase("en"))
      const purchase = backendCurrencyService.createValuationFromSnapshot(input.purchasePrice, snapshot)
      const retail = backendCurrencyService.createValuationFromSnapshot(input.retailPrice, snapshot)
      const wholesale = backendCurrencyService.createValuationFromSnapshot(input.wholesalePrice, snapshot)
      weapons.push({
        id: nextId("W"), serialNumber: serial, weaponTypeId: weaponType.id, weaponSubtypeId: subtype.id,
        caliberId: caliber.id, brandId: brand.id, modelId: model.id, storageLocationId: input.storageLocationId ?? null,
        weaponType: weaponType.label, subType: subtype.label, caliber: caliber.label, brand: brand.label, model: model.label,
        location: locationRow, condition: input.condition, status: "Available", purchasePrice: input.purchasePrice,
        retailPrice: input.retailPrice, wholesalePrice: input.wholesalePrice, retailPriceMode: input.retailPriceMode ?? "manual",
        wholesalePriceMode: input.wholesalePriceMode ?? "manual", actualFinalPrice: null, supplierId: input.supplierId,
        shipmentId: input.shipmentId, dateAdded: new Date().toISOString().slice(0, 10), batchId: `BATCH-${Date.now()}`,
        notes: input.notes, images: [], movementHistory: [], purchasePriceValuation: purchase,
        retailPriceValuation: retail, wholesalePriceValuation: wholesale,
      })
    }
    repo.bulkInsertWeapons(weapons)
    for (const weapon of weapons) finalizeStandaloneInventoryCost("weapon", weapon.id, input.purchasePrice, snapshot, input.additionalCosts ?? [], currentUser().id)
    return { added: weapons.length, duplicates }
  })()
}

function updateInventoryStock(input: AddStockInput): void {
  const database = getDb()
  database.transaction(() => {
    const operationId = input.operationId?.trim()
    if (!operationId || !/^[0-9a-f-]{36}$/i.test(operationId)) throw new Error("A valid stock operation ID is required")
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex")
    const completed = database.prepare("SELECT request_hash FROM stock_operations WHERE operation_id = ?")
      .get(operationId) as { request_hash: string } | undefined
    if (completed) {
      if (completed.request_hash !== requestHash) throw new Error("This stock operation ID was already used for a different request")
      return
    }

    const quantityDelta = input.quantityDelta
    if (!Number.isInteger(quantityDelta) || quantityDelta < 0) throw new Error("Quantity cannot be negative")
    if (!input.costUpdate && quantityDelta === 0) throw new Error("Stock or current cost must change")

    const cost = input.costUpdate
    if (cost && (!Number.isFinite(cost.amount) || cost.amount < 0 || !cost.currency?.trim())) {
      throw new Error("Current cost and currency are invalid")
    }
    const snapshot = cost ? backendCurrencyService.getRateSnapshot(cost.currency) : undefined
    const valuation = cost && snapshot
      ? backendCurrencyService.createValuationFromSnapshot(cost.amount, snapshot)
      : undefined
    const location = input.location
    const table = input.itemType === "accessory" ? "accessories" : "ammunition"
    const existing = database.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(input.itemId) as Record<string, unknown> | undefined
    if (!existing) throw new Error(input.itemType === "accessory" ? "Accessory not found" : "Ammunition not found")

    if (input.itemType === "accessory") {
      database.prepare(`
        UPDATE accessories SET
          quantity = quantity + ?,
          price = ?, price_currency = ?, price_valuation = ?,
          warehouse = ?, shelf = ?, bin = ?
        WHERE id = ?
      `).run(
        quantityDelta,
        cost?.amount ?? existing.price,
        snapshot?.transactionCurrency ?? existing.price_currency,
        valuation ? JSON.stringify(valuation) : existing.price_valuation,
        location?.warehouse ?? existing.warehouse,
        location?.shelf ?? existing.shelf,
        location?.bin ?? existing.bin,
        input.itemId,
      )
    } else {
      const packageSize = Number(existing.units_per_package)
      const total = Number(existing.full_packages) * packageSize + Number(existing.loose_rounds) + quantityDelta
      database.prepare(`
        UPDATE ammunition SET
          full_packages = ?, loose_rounds = ?,
          price = ?, price_currency = ?, price_valuation = ?,
          warehouse = ?, shelf = ?, bin = ?
        WHERE id = ?
      `).run(
        Math.floor(total / packageSize), total % packageSize,
        cost?.amount ?? existing.price,
        snapshot?.transactionCurrency ?? existing.price_currency,
        valuation ? JSON.stringify(valuation) : existing.price_valuation,
        location?.warehouse ?? existing.warehouse,
        location?.shelf ?? existing.shelf,
        location?.bin ?? existing.bin,
        input.itemId,
      )
    }

    if (cost && snapshot) {
      const existingCost = database.prepare(`
        SELECT product_costs_base_amount, shipment_costs_base_amount, shipment_id, shipment_item_id
        FROM inventory_cost_snapshots WHERE product_type = ? AND product_id = ?
      `).get(input.itemType, input.itemId) as {
        product_costs_base_amount: string; shipment_costs_base_amount: string;
        shipment_id: string | null; shipment_item_id: string | null;
      } | undefined
      const productCostsBase = Number(existingCost?.product_costs_base_amount ?? 0)
      const shipmentCostsBase = Number(existingCost?.shipment_costs_base_amount ?? 0)
      const originalBase = Number(valuation!.accountingAmount)
      const finalBase = originalBase + productCostsBase + shipmentCostsBase
      database.prepare(`
        INSERT INTO inventory_cost_snapshots
          (product_type, product_id, shipment_id, shipment_item_id, original_amount,
           original_currency_code, original_exchange_rate, original_base_amount,
           product_costs_base_amount, shipment_costs_base_amount, final_landed_base_amount,
           base_currency_code, exchange_rate_date, rate_source, finalized_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(product_type, product_id) DO UPDATE SET
          original_amount=excluded.original_amount, original_currency_code=excluded.original_currency_code,
          original_exchange_rate=excluded.original_exchange_rate, original_base_amount=excluded.original_base_amount,
          final_landed_base_amount=excluded.final_landed_base_amount, base_currency_code=excluded.base_currency_code,
          exchange_rate_date=excluded.exchange_rate_date, rate_source=excluded.rate_source,
          finalized_at=datetime('now'), finalized_by=excluded.finalized_by
      `).run(
        input.itemType, input.itemId, existingCost?.shipment_id ?? input.shipmentId ?? null,
        existingCost?.shipment_item_id ?? null, String(cost.amount), snapshot.transactionCurrency,
        String(snapshot.exchangeRate), originalBase.toFixed(4), productCostsBase.toFixed(4),
        shipmentCostsBase.toFixed(4), finalBase.toFixed(4), snapshot.accountingCurrency,
        snapshot.exchangeRateDate, snapshot.rateSource, currentUser().id,
      )
    }
    if (quantityDelta > 0) {
      database.prepare(`
        INSERT INTO inventory_transactions
          (id, item_type, item_id, transaction_type, quantity_delta, unit_amount,
           currency, valuation, shipment_id, notes, created_by)
        VALUES (?, ?, ?, 'receipt', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `ITX-${randomUUID()}`, input.itemType, input.itemId, quantityDelta,
        cost?.amount ?? null, snapshot?.transactionCurrency ?? null,
        valuation ? JSON.stringify(valuation) : null,
        input.shipmentId ?? null, input.notes?.trim() ?? "", currentUser().id,
      )
    }
    repo.insertAuditLog({
      id: `LOG-${randomUUID()}`,
      timestamp: new Date().toISOString(),
      date: new Date().toISOString().slice(0, 10),
      userId: currentUser().id,
      actionType: "StockAdjustment",
      description: quantityDelta > 0 ? `Added ${quantityDelta} units to ${input.itemId}` : `Updated current cost for ${input.itemId}`,
      metadata: JSON.stringify({ operationId, itemType: input.itemType, itemId: input.itemId, quantityDelta, costUpdate: cost ?? null }),
    })
    database.prepare("INSERT INTO stock_operations (operation_id, request_hash, item_type, item_id) VALUES (?, ?, ?, ?)")
      .run(operationId, requestHash, input.itemType, input.itemId)
  })()
}

function receiveAmmunition(input: ReceiveAmmoByPackagesInput | ReceiveAmmoByRoundsInput): void {
  const packages = "numberOfPackages" in input ? input.numberOfPackages : 0
  const units = "unitsPerPackage" in input ? input.unitsPerPackage : 0
  const rounds = "totalRounds" in input ? input.totalRounds : packages * units
  if (!Number.isInteger(rounds) || rounds <= 0) throw new Error("Ammunition rounds must be a positive integer")
  const row = getDb().prepare("SELECT units_per_package, full_packages, loose_rounds FROM ammunition WHERE id = ?").get(input.itemId) as { units_per_package: number; full_packages: number; loose_rounds: number } | undefined
  if (!row) throw new Error("Ammunition not found")
  const unitsPerPackage = units || row.units_per_package
  const total = row.full_packages * row.units_per_package + row.loose_rounds + rounds
  getDb().prepare("UPDATE ammunition SET units_per_package = ?, full_packages = ?, loose_rounds = ? WHERE id = ?")
    .run(unitsPerPackage, Math.floor(total / unitsPerPackage), total % unitsPerPackage, input.itemId)
}

export function executeSqliteDatabaseOperation(operation: SqliteDatabaseOperation, args: readonly unknown[]): unknown {
  const user = currentUser()
  switch (operation) {
    case "dbGetCurrentUserId": return user.id
    case "dbGetAll": return repo.getAll()
    case "dbGetMasterData": return repo.getMasterData()
    case "dbGetSettings": return repo.getSettings()
    case "dbUpdateSettings": repo.updateSettings(value<SystemSettings>(args, 0)); return undefined
    case "dbGetUserPreferences": return repo.getUserPreferences(text(args, 0, "User ID"))
    case "dbUpsertUserPreferences": repo.upsertUserPreferences(value<UserPreferences>(args, 0)); return undefined
    case "dbInsertWeapon": repo.insertWeapon(value<Weapon>(args, 0)); return undefined
    case "dbBulkInsertWeapons": repo.bulkInsertWeapons(value<Weapon[]>(args, 0)); return undefined
    case "dbUpdateWeapon": requireInventoryEdit(); repo.updateWeapon(value<Weapon>(args, 0)); return undefined
    case "dbInsertShipment": repo.insertShipment(value<Shipment>(args, 0)); return undefined
    case "dbUpdateShipment": repo.updateShipment(value<Shipment>(args, 0)); return undefined
    case "dbInsertInvoice": repo.insertInvoice(value<Invoice>(args, 0)); return undefined
    case "dbUpdateInvoice": repo.updateInvoice(value<Invoice>(args, 0)); return undefined
    case "dbInsertPayment": repo.insertPayment(value<PaymentRecord>(args, 0)); return undefined
    case "dbInsertAccessory": repo.insertAccessory(value<Accessory>(args, 0)); return undefined
    case "dbUpdateAccessory": repo.updateAccessory(value<Accessory>(args, 0)); return undefined
    case "dbInsertAmmunition": repo.insertAmmunition(value<Ammunition>(args, 0)); return undefined
    case "dbUpdateAmmunition": repo.updateAmmunition(value<Ammunition>(args, 0)); return undefined
    case "dbInsertCustomer": repo.insertCustomer(value<Customer>(args, 0)); return undefined
    case "dbUpdateCustomer": {
      const id = text(args, 0, "Customer ID")
      const patch = value<Partial<Customer>>(args, 1)
      const existing = repo.getAll().customers.find((item) => item.id === id)
      if (!existing) throw new Error("Customer not found")
      const row = mappers.customerToRow({ ...existing, ...patch })
      getDb().prepare(`UPDATE customers SET name=@name,phone=@phone,email=@email,address=@address,is_wholesale_buyer=@is_wholesale_buyer,wholesale_discount_percent=@wholesale_discount_percent,notes=@notes,custom_fields=@custom_fields WHERE id=@id`).run(row)
      return undefined
    }
    case "dbDeleteCustomer": repo.deleteCustomer(text(args, 0, "Customer ID")); return undefined
    case "dbInsertSupplier": repo.insertSupplier(value<Supplier>(args, 0)); return undefined
    case "dbInsertAuditLog": repo.insertAuditLog(value<AuditLog>(args, 0)); return undefined
    case "dbInsertNotification": repo.insertNotification(value<AppNotification>(args, 0)); return undefined
    case "dbUpdateNotification": repo.updateNotification(value<AppNotification>(args, 0)); return undefined
    case "dbMarkAllNotificationsRead": getDb().prepare("UPDATE app_notifications SET is_read = 1 WHERE user_id IS NULL OR user_id = ?").run(user.id); return undefined
    case "dbDeleteNotification": repo.deleteNotification(text(args, 0, "Notification ID")); return undefined
    case "dbCreateNotification": repo.insertNotification({ id: `N-${randomUUID()}`, type: text(args, 0, "Type") as AppNotification["type"], title: text(args, 1, "Title"), message: text(args, 2, "Message"), date: new Date().toISOString(), read: false, entityId: typeof args[3] === "string" ? args[3] : null }); return undefined
    case "dbFlagOverdueShipments": getDb().prepare("UPDATE shipments SET status = 'Delayed' WHERE expected_arrival_date < date('now') AND status NOT IN ('Received','Cancelled')").run(); return undefined
    case "dbWriteAuditEvent": repo.insertAuditLog({ id: `AUD-${randomUUID()}`, timestamp: new Date().toISOString(), date: new Date().toISOString().slice(0, 10), userId: user.id, actionType: text(args, 0, "Action") as AuditLog["actionType"], description: text(args, 1, "Description"), metadata: typeof args[2] === "string" ? args[2] : "" }); return undefined
    case "dbInsertUser": {
      requireAdmin()
      const input = value<User>(args, 0)
      if (!input.username.trim() || !input.name.trim()) throw new Error("User account and name are required")
      const id = input.id || `U-${randomUUID()}`
      return getDb().transaction(() => {
        getDb().prepare(`INSERT INTO users(id,username,email,name,role,permissions,password_set,password_hash,is_active,is_primary_admin,created_at,updated_at) VALUES(?,?,?,?,?,?,0,'',1,0,datetime('now'),datetime('now'))`)
          .run(id, input.username.trim().toLocaleLowerCase("en"), input.email ?? null, input.name.trim(), input.role, JSON.stringify(input.permissions))
        const activationCode = createLocalActivationCode(id)
        return { activationCode, userId: id }
      })()
    }
    case "dbUpdateUser": {
      requireAdmin()
      const input = value<User>(args, 0)
      const row = getDb().prepare("SELECT is_primary_admin FROM users WHERE id = ?").get(input.id) as { is_primary_admin: number } | undefined
      if (!row) throw new Error("User not found")
      if (row.is_primary_admin === 1 && input.role !== "Admin") throw new Error("The primary administrator role cannot be changed")
      getDb().prepare("UPDATE users SET username=?,email=?,name=?,role=?,permissions=?,updated_at=datetime('now') WHERE id=?")
        .run(input.username, input.email ?? null, input.name, input.role, JSON.stringify(input.permissions), input.id)
      return undefined
    }
    case "dbDeleteUser": {
      requireAdmin(); const id = text(args, 0, "User ID")
      if (id === user.id) throw new Error("You cannot delete the signed-in account")
      const row = getDb().prepare("SELECT is_primary_admin FROM users WHERE id = ?").get(id) as { is_primary_admin: number } | undefined
      if (!row) throw new Error("User not found")
      if (row?.is_primary_admin === 1) throw new Error("The primary administrator cannot be deleted")
      repo.deleteUser(id); return undefined
    }
    case "dbResetUserActivation": {
      requireAdmin()
      const id = text(args, 0, "User ID")
      const target = getDb().prepare("SELECT password_set, is_active FROM users WHERE id = ?").get(id) as { password_set: number; is_active: number } | undefined
      if (!target || target.is_active !== 1) throw new Error("User not found or inactive")
      if (target.password_set === 1) throw new Error("This account already completed password setup")
      return createLocalActivationCode(id)
    }
    case "dbUpdateOwnEmail": getDb().prepare("UPDATE users SET email=?,updated_at=datetime('now') WHERE id=?").run(args[0] == null ? null : text(args, 0, "Email"), user.id); return undefined
    case "dbListBackups": return listDatabaseBackups().map((backup) => ({ id: backup.fileName, scope: "system", owner_user_id: null, created_by_name: user.name, label: backup.fileName, created_at: backup.createdAt, restored_at: null, item_count: 0, size_bytes: backup.sizeBytes, status: "completed", completed_at: backup.createdAt, error_message: null }))
    case "dbCreateSystemBackup": requireAdmin(); createDatabaseBackup(); return undefined
    case "dbRestoreSystemBackup": requireAdmin(); restoreDatabaseBackup(text(args, 0, "Backup ID")); return null
    case "dbDeleteBackup": requireAdmin(); deleteDatabaseBackup(text(args, 0, "Backup ID")); return undefined
    case "dbInsertSavedFilter": repo.insertSavedFilter(value<SavedFilter>(args, 0)); return undefined
    case "dbDeleteSavedFilter": repo.deleteSavedFilter(text(args, 0, "Filter ID")); return undefined
    case "dbInsertMasterWeaponType": return repo.getOrCreateWeaponType(text(args, 0, "Label"), finiteNumber(args, 1, "Sort order"))
    case "dbInsertMasterWeaponSubtype": return repo.getOrCreateWeaponSubtype(text(args, 0, "Weapon type"), text(args, 1, "Label"), finiteNumber(args, 2, "Sort order"))
    case "dbInsertMasterCaliber": return repo.getOrCreateCaliber(text(args, 0, "Label"))
    case "dbLinkSubtypeCaliber": repo.linkSubtypeCaliber(text(args, 0, "Subtype"), text(args, 1, "Caliber")); return undefined
    case "dbInsertMasterBrand": return repo.getOrCreateBrand(text(args, 0, "Label"))
    case "dbInsertMasterModel": return repo.getOrCreateModel(text(args, 0, "Label"), text(args, 1, "Brand"))
    case "dbInsertMasterWarehouse": return repo.getOrCreateWarehouse(text(args, 0, "Label"))
    case "dbInsertMasterStorageLocation": return repo.getOrCreateStorageLocation(text(args, 0, "Warehouse"), text(args, 1, "Shelf"), text(args, 2, "Bin"))
    case "dbDeleteMasterRow": repo.deleteMasterRow(text(args, 0, "Table"), text(args, 1, "ID")); return undefined
    case "dbGetCurrencies": return repo.getCurrencies()
    case "dbGetOverrides": return repo.getOverrides()
    case "dbUpdateCurrencyRate": repo.updateCurrencyRate(text(args, 0, "Currency"), finiteNumber(args, 1, "Rate"), text(args, 2, "Updated at")); return undefined
    case "dbRecordRateHistory": repo.recordRateHistory(text(args, 0, "Currency"), finiteNumber(args, 1, "Rate"), text(args, 2, "Source")); return undefined
    case "dbSetManualOverride": repo.setManualOverride(text(args, 0, "Currency"), finiteNumber(args, 1, "Rate"), user.name, text(args, 3, "Reason"), text(args, 4, "Updated at")); return undefined
    case "dbSetAutomaticMode": repo.setAutomaticMode(text(args, 0, "Currency"), user.name, text(args, 2, "Updated at")); return undefined
    case "dbGetRateAuditLog": return repo.getRateAuditLog(args[0] == null ? 50 : finiteNumber(args, 0, "Limit"))
    case "dbAddCurrency": repo.addCurrency(text(args, 0, "Currency"), text(args, 1, "Name"), text(args, 2, "Symbol"), finiteNumber(args, 3, "Precision"), finiteNumber(args, 4, "Rate")); return undefined
    case "dbToggleCurrencyActive": repo.toggleCurrencyActive(text(args, 0, "Currency"), value<boolean>(args, 1)); return undefined
    case "dbRecordRateAuditLog": repo.recordRateAuditLog(text(args, 0, "Currency"), args[1] as number | null, args[2] as number | null, user.name, text(args, 4, "Reason"), text(args, 5, "Changed at")); return undefined
    case "dbDeleteCurrency": requireAdmin(); getDb().prepare("DELETE FROM currencies WHERE iso_code = ?").run(text(args, 0, "Currency")); return undefined
    case "dbCompleteSale": {
      const result = completeSale(value<Parameters<typeof completeSale>[0]>(args, 0), user)
      if (!result.success || !result.invoiceId || !result.invoiceNumber) throw new Error(result.error ?? "Sale failed")
      return { invoiceId: result.invoiceId, invoiceNumber: result.invoiceNumber }
    }
    case "dbRegisterPayment": {
      const result = registerPayment(value<PaymentInput>(args, 0), user)
      if (!result.success || result.newBalance == null) throw new Error(result.error ?? "Payment failed")
      return { newBalance: result.newBalance }
    }
    case "dbUpdateWeaponStatus": updateWeaponStatusControlled(text(args, 0, "Weapon ID"), text(args, 1, "Status") as WeaponStatus, text(args, 2, "Reason")); return undefined
    case "dbUpdateWeaponNotes": requireInventoryEdit(); getDb().prepare("UPDATE weapons SET notes=? WHERE id=? AND deleted_at IS NULL").run(text(args, 1, "Notes"), text(args, 0, "Weapon ID")); return undefined
    case "dbUpdateWeaponLocation": requireInventoryEdit(); getDb().prepare("UPDATE weapons SET storage_location_id=? WHERE id=? AND deleted_at IS NULL").run(typeof args[1] === "string" && args[1].trim() ? args[1] : null, text(args, 0, "Weapon ID")); return undefined
    case "dbAppendWeaponImage": updateJsonArray("weapons", "images", text(args, 0, "Weapon ID"), (items) => [...items, text(args, 1, "Image")]); return undefined
    case "dbBindWeaponToShipment": getDb().prepare("UPDATE weapons SET shipment_id=? WHERE id=? AND deleted_at IS NULL").run(text(args, 1, "Shipment ID"), text(args, 0, "Weapon ID")); return undefined
    case "dbSetShipmentStatus": getDb().prepare("UPDATE shipments SET status=?,notes=CASE WHEN ?='' THEN notes ELSE notes||char(10)||? END,updated_at=datetime('now') WHERE id=?").run(text(args, 1, "Status"), text(args, 2, "Notes"), text(args, 2, "Notes"), text(args, 0, "Shipment ID")); return undefined
    case "dbUpdateShipmentDetails": {
      const id = text(args, 0, "Shipment ID"), patch = value<Partial<Shipment>>(args, 1)
      const shipment = repo.getAll().shipments.find((item) => item.id === id); if (!shipment) throw new Error("Shipment not found")
      repo.updateShipment({ ...shipment, ...patch }); return undefined
    }
    case "dbDeleteShipment": getDb().prepare("DELETE FROM shipments WHERE id = ?").run(text(args, 0, "Shipment ID")); return undefined
    case "dbAddShipmentDocument": updateJsonArray("shipments", "documents", text(args, 0, "Shipment ID"), (items) => [...items, value<ShipmentDocument>(args, 1)]); return undefined
    case "dbDeleteShipmentDocument": updateJsonArray("shipments", "documents", text(args, 0, "Shipment ID"), (items) => items.filter((item) => typeof item !== "object" || item == null || (item as { id?: unknown }).id !== args[1])); return undefined
    case "dbAddShipmentTimelineEvent": updateJsonArray("shipments", "timeline", text(args, 0, "Shipment ID"), (items) => [...items, { id: randomUUID(), timestamp: new Date().toISOString(), status: "Pending", eventType: text(args, 1, "Event") as ShipmentTimelineEntry["eventType"], notes: text(args, 2, "Notes"), userId: user.id, userName: user.name } satisfies ShipmentTimelineEntry]); return undefined
    case "dbUpdateInvoiceNotes": getDb().prepare("UPDATE invoices SET notes=? WHERE id=?").run(text(args, 1, "Notes"), text(args, 0, "Invoice ID")); return undefined
    case "dbUpdateInventoryProduct": {
      const type = text(args, 0, "Product type"), id = text(args, 1, "Product ID"), patch = value<Record<string, unknown>>(args, 2)
      const allowed = type === "accessory" ? new Set(["name", "type", "quantity", "safety_threshold", "warehouse", "shelf", "bin"]) : new Set(["name", "caliber", "package_type", "units_per_package", "full_packages", "loose_rounds", "safety_threshold", "warehouse", "shelf", "bin"])
      const entries = Object.entries(patch).filter(([key]) => allowed.has(key)); if (!entries.length) return undefined
      getDb().prepare(`UPDATE ${type === "accessory" ? "accessories" : "ammunition"} SET ${entries.map(([key]) => `${key}=?`).join(",")} WHERE id=?`).run(...entries.map(([, item]) => item), id); return undefined
    }
    case "dbBulkIntakeWeapons": return bulkIntake(value<BulkIntakeInput>(args, 0))
    case "dbCreateShipmentRpc": return getDb().transaction(() => createShipment(value<ShipmentInput>(args, 0)))()
    case "dbBulkCreateShipment": {
      const input = value<BulkShipmentCreateInput>(args, 0)
      return getDb().transaction(() => {
        const id = createShipment({ ...input.shipment, lineItems: input.lineItems })
        const created = getDb().prepare("SELECT supplier_id FROM shipments WHERE id = ?").get(id) as { supplier_id: string }
        for (const item of input.lineItems.filter((line) => line.productType === "weapon")) bulkIntake({ ...item, serialNumbers: item.serialNumbers, condition: "Excellent", supplierId: created.supplier_id, shipmentId: id, notes: input.shipment.notes })
        return id
      })()
    }
    case "dbReceiveScheduledShipment": { const id = text(args, 0, "Shipment ID"); getDb().prepare("UPDATE shipments SET status='Arrived',workflow_status='received',actual_arrival_date=date('now'),updated_at=datetime('now') WHERE id=?").run(id); return id }
    case "dbRescheduleShipment": getDb().prepare("UPDATE shipments SET expected_arrival_date=?,delay_reason=?,workflow_status='scheduled',updated_at=datetime('now') WHERE id=?").run(text(args, 1, "Arrival date"), text(args, 2, "Reason"), text(args, 0, "Shipment ID")); return undefined
    case "dbUpdateScheduledShipment": {
      const id = text(args, 0, "Shipment ID")
      const input = value<ShipmentInput>(args, 1)
      const existing = repo.getAll().shipments.find((item) => item.id === id)
      if (!existing) throw new Error("Shipment not found")
      if (existing.workflowStatus !== "scheduled") throw new Error("Only scheduled shipments can be edited")
      if (!input.supplierId || !getDb().prepare("SELECT 1 FROM suppliers WHERE id = ?").get(input.supplierId)) throw new Error("Supplier not found")
      repo.updateShipment({
        ...existing,
        shipmentNumber: input.shipmentNumber.trim() || existing.shipmentNumber,
        supplierId: input.supplierId,
        shipmentDate: input.shipmentDate,
        expectedArrivalDate: input.expectedArrivalDate,
        totalExpectedItems: input.totalExpectedItems,
        attachments: input.attachments,
        notes: input.notes,
        purchaseOrderNumber: input.purchaseOrderNumber,
        invoiceNumber: input.invoiceNumber,
        shippingCarrier: input.shippingCarrier,
        containerNumber: input.containerNumber,
        currency: input.currency,
        purchaseDate: input.purchaseDate,
        lineItems: input.lineItems?.map(shipmentLineItem) ?? existing.lineItems,
        plannedCosts: input.additionalCosts ?? existing.plannedCosts,
      })
      return undefined
    }
    case "dbAdjustInventoryStock": updateInventoryStock(value<AddStockInput>(args, 0)); return undefined
    case "dbReceiveAmmoByPackages": receiveAmmunition(value<ReceiveAmmoByPackagesInput>(args, 0)); return undefined
    case "dbReceiveAmmoByRounds": receiveAmmunition(value<ReceiveAmmoByRoundsInput>(args, 0)); return undefined
    case "dbUpdateAmmoPackage": { const input = value<UpdateAmmoPackageInput>(args, 0); if (!Number.isInteger(input.unitsPerPackage) || input.unitsPerPackage <= 0) throw new Error("Units per package must be positive"); const row = repo.getAmmunitionById(input.itemId); if (!row) throw new Error("Ammunition not found"); const rounds = row.fullPackages * row.unitsPerPackage + row.looseRounds; getDb().prepare("UPDATE ammunition SET package_type=?,units_per_package=?,full_packages=?,loose_rounds=? WHERE id=?").run(input.packageType, input.unitsPerPackage, Math.floor(rounds / input.unitsPerPackage), rounds % input.unitsPerPackage, input.itemId); return undefined }
    case "dbExtendInvoiceDueDate": { const input = value<DueDateExtensionInput>(args, 0); getDb().prepare("UPDATE invoices SET due_date=? WHERE id=? AND voided=0").run(input.newDueDate, input.invoiceId); return undefined }
    case "dbVoidInvoice": { const id = text(args, 0, "Invoice ID"); getDb().transaction(() => { const invoice = repo.getAll().invoices.find((item) => item.id === id); if (!invoice) throw new Error("Invoice not found"); if (invoice.voided) throw new Error("Invoice is already voided"); for (const weaponId of invoice.weaponIds) getDb().prepare("UPDATE weapons SET status='Available',actual_final_price=NULL WHERE id=?").run(weaponId); getDb().prepare("UPDATE invoices SET voided=1,status='Void',balance=0 WHERE id=?").run(id) })(); return undefined }
    case "dbCreateAccessory": { const item = value<Accessory>(args, 0), costs = value<ProductAdditionalCostInput[]>(args, 1); getDb().transaction(() => { repo.insertAccessory(item); const snapshot = backendCurrencyService.getRateSnapshot(item.priceCurrency ?? backendCurrencyService.getDefaultTransactionCurrency()); finalizeStandaloneInventoryCost("accessory", item.id, item.price, snapshot, costs, user.id) })(); return undefined }
    case "dbCreateAmmunition": { const item = value<Ammunition>(args, 0), costs = value<ProductAdditionalCostInput[]>(args, 1); getDb().transaction(() => { repo.insertAmmunition(item); const snapshot = backendCurrencyService.getRateSnapshot(item.priceCurrency ?? backendCurrencyService.getDefaultTransactionCurrency()); finalizeStandaloneInventoryCost("ammunition", item.id, item.price, snapshot, costs, user.id) })(); return undefined }
    case "dbCreateInventoryProductType": { const category = text(args, 0, "Category") as "accessory" | "ammunition", name = text(args, 1, "Name").trim(); if (!new Set(["accessory", "ammunition"]).has(category) || !name) throw new Error("Invalid product type"); const existing = getDb().prepare("SELECT id,category,name FROM inventory_product_types WHERE category=? AND name=? COLLATE NOCASE").get(category, name) as { id: string; category: "accessory" | "ammunition"; name: string } | undefined; if (existing) return { ...existing, created: false }; const id = `ipt-${randomUUID()}`; getDb().prepare("INSERT INTO inventory_product_types(id,category,name) VALUES(?,?,?)").run(id, category, name); return { id, category, name, created: true } }
    case "dbUpdateProductPricing": { const input = value<{ productType: "weapon" | "accessory" | "ammunition"; productId: string; retailPrice: number; wholesalePrice: number; currency: string; retailMode: "auto" | "manual"; wholesaleMode: "auto" | "manual" }>(args, 0); const table = input.productType === "weapon" ? "weapons" : input.productType === "accessory" ? "accessories" : "ammunition"; getDb().prepare(`UPDATE ${table} SET retail_price=?,wholesale_price=?,retail_price_mode=?,wholesale_price_mode=? WHERE id=?`).run(input.retailPrice, input.wholesalePrice, input.retailMode, input.wholesaleMode, input.productId); return undefined }
    case "dbReplaceProductCosts": replaceProductCosts(text(args, 0, "Product type"), text(args, 1, "Product ID"), value<ProductAdditionalCostInput[]>(args, 2), user.id); return undefined
    case "dbResetDemoData": requireAdmin(); resetDemoData(user.id); return undefined
    case "dbDeleteDemoData": requireAdmin(); deleteDemoData(); return undefined
  }
}
