import { ipcMain } from "electron"
import { repo } from "../repositories/index.js"
import { getDb, createDatabaseBackup, deleteDatabaseBackup, listDatabaseBackups, restoreDatabaseBackup } from "../database.js"
import { seedDemoDataIfNeeded } from "../services/demo-seed-service.js"
import { completeSale } from "../services/sale-service.js"
import { registerPayment } from "../services/payment-service.js"
import type { AllData, MasterDataAll } from "../../src/lib/db/mappers.js"
import type {
  Weapon, Shipment, Invoice, Accessory, Ammunition,
  Customer, Supplier, AuditLog, AppNotification, User, SystemSettings,
  SavedFilter, UserPreferences, StorageLocation,
  ProductAdditionalCostInput,
} from "../../src/lib/types.js"
import type { CurrencyRow, ExchangeRateOverrideRow, AuditLogEntry } from "../../src/lib/db/mappers.js"

import type {
  BulkIntakeInput, ShipmentInput, BulkShipmentCreateInput,
  PaymentInput, DueDateExtensionInput, AddStockInput,
  SaleInput, ReceiveAmmoByPackagesInput, ReceiveAmmoByRoundsInput,
  SellAmmoInput, UpdateAmmoPackageInput,
} from "../../src/lib/store.js"

import { backendCurrencyService } from "../services/currency-service.js"
import { nonNegativeMoney, positiveMoney, sumMoney } from "../services/money.js"
import { ammoTotalRounds } from "../../src/lib/types.js"
import type { ManifestConfirmInput, ManifestDetailsPatch, ManifestItemPatch, ManifestUploadInput } from "../../src/lib/shipment-manifest.js"
import {
  authorizeManifest, cancelManifest, confirmManifest, confirmScheduledArrival, deleteManifestReview, getManifestReview, listManifestReviews,
  processManifestUpload, rescheduleManifest, updateManifestDetails, updateManifestItem, updateManifestItems,
} from "../services/shipment-manifest-service.js"
import {
  finalizeInventoryCosts,
  finalizeStandaloneInventoryCost,
  insertShipmentCosts,
  insertShipmentItemBasis,
  listShipmentCosts,
  listProductCosts,
  prepareProductCosts,
  prepareShipmentCosts,
  replaceProductCosts,
  type ShipmentItemCostBasis,
} from "../services/product-cost-service.js"


function pad(num: number, size: number): string {
  return num.toString().padStart(size, "0")
}

function generateId(prefix: string, table: string): string {
  const db = getDb()

  const rows = db
    .prepare(`
      SELECT id
      FROM ${table}
      WHERE id LIKE ?
    `)
    .all(`${prefix}%`) as { id: string }[]

  let maxNumber = 0

  for (const row of rows) {
    const value = row.id.slice(prefix.length)
    const number = Number.parseInt(value, 10)

    if (Number.isFinite(number) && number > maxNumber) {
      maxNumber = number
    }
  }

  let next = maxNumber + 1
  let candidate = `${prefix}${pad(next, 5)}`

  while (
    db
      .prepare(`SELECT 1 FROM ${table} WHERE id = ? LIMIT 1`)
      .get(candidate)
  ) {
    next += 1
    candidate = `${prefix}${pad(next, 5)}`
  }

  return candidate
}

interface IpcResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

function ok<T>(data?: T): IpcResult<T> {
  return { success: true, data }
}
function fail(error: string): IpcResult<never> {
  return { success: false, error }
}

function normalizeCurrencyCode(value: unknown, fieldName = "Currency"): string {
  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value.trim())) {
    throw new Error(`${fieldName} must be a valid three-letter currency code`)
  }
  return value.trim().toUpperCase()
}

function requireActiveCurrency(code: unknown, fieldName = "Currency"): CurrencyRow {
  const normalized = normalizeCurrencyCode(code, fieldName)
  const currency = repo.getCurrencies().find((row) => row.iso_code === normalized)
  if (!currency) throw new Error(`${fieldName} is not registered: ${normalized}`)
  if (currency.is_active !== 1) throw new Error(`${fieldName} is inactive: ${normalized}`)
  return currency
}

function requirePositiveRate(value: unknown): number {
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Exchange rate must be a finite number greater than zero")
  return rate
}

function requireRateAdministrator(changedBy: unknown): string {
  if (typeof changedBy !== "string" || !changedBy.trim()) throw new Error("The administrator identity is required")
  const row = getDb().prepare("SELECT name, role FROM users WHERE name = ? COLLATE NOCASE LIMIT 1").get(changedBy.trim()) as { name: string; role: string } | undefined
  if (!row || row.role.toLowerCase() !== "admin") throw new Error("Administrator role is required to change exchange rates")
  return row.name
}

interface WeaponDisplayFields {
  weaponType: string
  subType: string
  caliber: string
  brand: string
  model: string
}

function resolveWeaponDisplayFields(input: {
  weaponTypeId: string
  weaponSubtypeId: string
  caliberId: string
  brandId: string
  modelId: string
}): WeaponDisplayFields {
  const db = getDb()
  const row = db.prepare(`
    SELECT
      wt.label AS weapon_type,
      ws.label AS sub_type,
      c.label AS caliber,
      b.label AS brand,
      m.label AS model
    FROM weapon_types wt
    JOIN weapon_subtypes ws
      ON ws.id = ? AND ws.weapon_type_id = wt.id
    JOIN calibers c
      ON c.id = ?
    JOIN brands b
      ON b.id = ?
    JOIN models m
      ON m.id = ? AND m.brand_id = b.id
    WHERE wt.id = ?
      AND EXISTS (
        SELECT 1
        FROM subtype_calibers sc
        WHERE sc.subtype_id = ws.id AND sc.caliber_id = c.id
      )
  `).get(
    input.weaponSubtypeId,
    input.caliberId,
    input.brandId,
    input.modelId,
    input.weaponTypeId,
  ) as {
    weapon_type: string
    sub_type: string
    caliber: string
    brand: string
    model: string
  } | undefined

  if (!row) {
    throw new Error(
      "Invalid weapon master-data selection: type, sub-type, caliber, brand, and model must reference valid related records.",
    )
  }

  return {
    weaponType: row.weapon_type,
    subType: row.sub_type,
    caliber: row.caliber,
    brand: row.brand,
    model: row.model,
  }
}

export function registerIpcHandlers(): void {
  console.log('ipc: registerIpcHandlers called')
  // ===== Read =====
  ipcMain.handle("db:getAll", (): IpcResult<AllData> => {
    try { return ok(repo.getAll()) } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("db:getMasterData", (): IpcResult<MasterDataAll> => {
    try { return ok(repo.getMasterData()) } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("db:getSettings", (): IpcResult<SystemSettings> => {
    try { return ok(repo.getSettings()) } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("db:getUserPreferences", (_, userId: string): IpcResult<UserPreferences | null> => {
    try { return ok(repo.getUserPreferences(userId)) } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("db:getCurrencies", (): IpcResult<CurrencyRow[]> => {
    try { return ok(repo.getCurrencies()) } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("db:getOverrides", (): IpcResult<ExchangeRateOverrideRow[]> => {
    try { return ok(repo.getOverrides()) } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("db:getRateAuditLog", (_, limit: number): IpcResult<AuditLogEntry[]> => {
    try { return ok(repo.getRateAuditLog(limit)) } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("db:listBackups", (): IpcResult => {
    try { return ok(listDatabaseBackups()) } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("db:createBackup", async (): Promise<IpcResult> => {
    try { return ok(await createDatabaseBackup()) } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("db:restoreBackup", async (_, fileName: string): Promise<IpcResult> => {
    try {
      await restoreDatabaseBackup(fileName)
      return ok()
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle("db:deleteBackup", (_, fileName: string): IpcResult => {
    try { deleteDatabaseBackup(fileName); return ok() } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("db:seedDemoData", (): IpcResult => {
    try { return ok(seedDemoDataIfNeeded()) } catch (e) { return fail(String(e)) }
  })

  // ===== Settings & Preferences =====
  ipcMain.handle("settings:update", (_, updates: Partial<SystemSettings>): IpcResult<SystemSettings> => {
    try {
      return getDb().transaction(() => {
        const current = repo.getSettings()
        const merged = { ...current, ...updates }
        const transactionCurrency = requireActiveCurrency(merged.currencyCode, "Default transaction currency")
        const accountingCurrency = requireActiveCurrency(merged.accountingCurrencyCode, "Accounting currency")
        const rateBaseCurrency = requireActiveCurrency(merged.rateBaseCurrencyCode, "Rate base currency")
        requireActiveCurrency(merged.preferredDisplayCurrency ?? transactionCurrency.iso_code, "Display currency")
        if (!Number.isFinite(merged.taxPercent) || merged.taxPercent < 0 || merged.taxPercent > 100) {
          throw new Error("Tax percent must be between 0 and 100")
        }
        if (!Number.isFinite(merged.minProfitMarginPercent) || merged.minProfitMarginPercent < 0 || merged.minProfitMarginPercent > 100) {
          throw new Error("Minimum profit margin must be between 0 and 100")
        }
        if (rateBaseCurrency.iso_code !== current.rateBaseCurrencyCode) {
          throw new Error("Rate base currency cannot be changed without an explicit atomic rebase of every stored exchange rate")
        }
        if (accountingCurrency.iso_code !== current.accountingCurrencyCode) {
          const financialRows = getDb().prepare(`
            SELECT
              (SELECT COUNT(*) FROM invoices) +
              (SELECT COUNT(*) FROM payment_records) +
              (SELECT COUNT(*) FROM weapons WHERE purchase_price_valuation IS NOT NULL OR retail_price_valuation IS NOT NULL OR wholesale_price_valuation IS NOT NULL) +
              (SELECT COUNT(*) FROM accessories WHERE price_valuation IS NOT NULL) +
              (SELECT COUNT(*) FROM ammunition WHERE price_valuation IS NOT NULL) +
              (SELECT COUNT(*) FROM shipments WHERE total_cost_valuation IS NOT NULL) +
              (SELECT COUNT(*) FROM inventory_transactions) AS count
          `).get() as { count: number }
          if (financialRows.count > 0) {
            throw new Error("Accounting currency cannot be changed after financial transactions exist; migrate historical ledgers explicitly")
          }
        }
        const activeCodes = repo.getCurrencies().filter((row) => row.is_active === 1).map((row) => row.iso_code)
        const validated: SystemSettings = {
          ...merged,
          currencyCode: transactionCurrency.iso_code,
          currencySymbol: transactionCurrency.symbol,
          accountingCurrencyCode: accountingCurrency.iso_code,
          rateBaseCurrencyCode: rateBaseCurrency.iso_code,
          supportedCurrencies: activeCodes,
          preferredDisplayCurrency: normalizeCurrencyCode(merged.preferredDisplayCurrency ?? transactionCurrency.iso_code, "Display currency"),
        }
        repo.updateSettings(validated)
        return ok(validated)
      })()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("userPreferences:upsert", (_, prefs: UserPreferences): IpcResult<UserPreferences> => {
    try {
      if (!prefs.userId || !getDb().prepare("SELECT 1 FROM users WHERE id = ?").get(prefs.userId)) throw new Error("User not found")
      if (prefs.displayCurrency) requireActiveCurrency(prefs.displayCurrency, "Display currency")
      if (!new Set(["original", "accounting", "display"]).has(prefs.reportViewMode)) throw new Error("Invalid report view mode")
      repo.upsertUserPreferences({
        ...prefs,
        displayCurrency: prefs.displayCurrency ? normalizeCurrencyCode(prefs.displayCurrency, "Display currency") : undefined,
      })
      return ok(prefs)
    } catch (e) { return fail(String(e)) }
  })

  // ===== Weapons =====
  ipcMain.handle("weapon:bulkInsert", (_, input: BulkIntakeInput, currentUser: { id: string; name: string }): IpcResult<{ added: number; duplicates: string[] }> => {
    try {
      const db = getDb()
      return db.transaction(() => {
        const all = repo.getAll()
        if (!currentUser?.id || !currentUser.name?.trim()) throw new Error("A valid current user is required")
        if (!all.suppliers.some((supplier) => supplier.id === input.supplierId)) throw new Error("Supplier not found")
        const existingSerials = new Set(all.weapons.map((w) => w.serialNumber.toLowerCase()))
        const duplicates: string[] = []
        const newWeapons: Weapon[] = []
        const batchId = `BATCH-${Date.now()}`
        const display = resolveWeaponDisplayFields(input)
        let serialCounter = all.weapons.length + 1
        const today = new Date().toISOString().split("T")[0]
        const currency = input.currency?.trim().toUpperCase() || backendCurrencyService.getDefaultTransactionCurrency()
        const purchaseRateSnapshot = backendCurrencyService.getRateSnapshot(currency)

        // Validate the reusable per-product cost template before any inventory
        // row is written. Each created serial receives its own traceable rows.
        prepareProductCosts("weapon", "validation-only", input.purchasePrice, purchaseRateSnapshot, input.additionalCosts ?? [], currentUser.id)

        // ── Look up the storage location details once for the whole batch ──
        let location: StorageLocation = { warehouse: "", shelf: "", bin: "" }
        if (input.storageLocationId) {
          const locRow = db.prepare(`
          SELECT w.label AS warehouse, sl.shelf, sl.bin
          FROM storage_locations sl
          JOIN warehouses w ON w.id = sl.warehouse_id
          WHERE sl.id = ?
        `).get(input.storageLocationId) as { warehouse: string; shelf: string; bin: string } | undefined
          if (locRow) {
            location = { warehouse: locRow.warehouse, shelf: locRow.shelf, bin: locRow.bin }
          }
        }

        for (const sn of input.serialNumbers) {
          const trimmed = sn.trim()
          if (!trimmed) continue
          if (existingSerials.has(trimmed.toLowerCase())) { duplicates.push(trimmed); continue }
          existingSerials.add(trimmed.toLowerCase())
          positiveMoney(input.purchasePrice, "Purchase price")
          positiveMoney(input.retailPrice, "Retail price")
          positiveMoney(input.wholesalePrice, "Wholesale price")
          const purchaseValuation = backendCurrencyService.createValuationFromSnapshot(input.purchasePrice, purchaseRateSnapshot)
          const retailValuation = backendCurrencyService.createValuationFromSnapshot(input.retailPrice, purchaseRateSnapshot)
          const wholesaleValuation = backendCurrencyService.createValuationFromSnapshot(input.wholesalePrice, purchaseRateSnapshot)
          newWeapons.push({
            id: `W${pad(serialCounter, 5)}`,
            serialNumber: trimmed,
            // FK fields
            weaponTypeId: input.weaponTypeId,
            weaponSubtypeId: input.weaponSubtypeId,
            caliberId: input.caliberId,
            brandId: input.brandId,
            modelId: input.modelId,
            storageLocationId: input.storageLocationId,
            // Display labels are resolved from normalized master-data IDs.
            weaponType: display.weaponType,
            subType: display.subType,
            caliber: display.caliber,
            brand: display.brand,
            model: display.model,
            // ── Populated location from DB lookup ──
            location,
            condition: input.condition,
            status: "Available",
            purchasePrice: purchaseValuation.originalAmount,
            retailPrice: retailValuation.originalAmount,
            wholesalePrice: wholesaleValuation.originalAmount,
            actualFinalPrice: null,
            supplierId: input.supplierId,
            shipmentId: input.shipmentId,
            dateAdded: today,
            batchId,
            notes: input.notes,
            images: [],
            movementHistory: [{
              id: `MV${pad(serialCounter, 5)}`, timestamp: new Date().toISOString(),
              fromStatus: "Available", toStatus: "Available",
              userId: currentUser.id, userName: currentUser.name,
              reason: "Initial intake via bulk intake wizard",
            }],
            purchasePriceValuation: purchaseValuation,
            retailPriceValuation: retailValuation,
            wholesalePriceValuation: wholesaleValuation,
          })
          serialCounter++
        }


        if (newWeapons.length > 0) {
          repo.bulkInsertWeapons(newWeapons)
          const costSnapshots = newWeapons.map((weapon) => finalizeStandaloneInventoryCost(
            "weapon", weapon.id, weapon.purchasePrice, purchaseRateSnapshot,
            input.additionalCosts ?? [], currentUser.id,
          ))
          const desc = `Bulk intake: ${newWeapons.length} ${input.brandLabel ?? input.brandId} ${input.modelLabel ?? input.modelId} (${input.weaponTypeLabel ?? input.weaponTypeId}/${input.subTypeLabel ?? input.weaponSubtypeId}) — Batch: ${batchId}`
          repo.insertAuditLog({
            id: generateId("LOG", "audit_logs"), timestamp: new Date().toISOString(), date: today,
            userId: currentUser.id, actionType: "Intake",
            description: desc,
            metadata: JSON.stringify({
              schemaVersion: 2,
              actorName: currentUser.name,
              entityType: "intakeBatch",
              entityId: batchId,
              batchId,
              brand: input.brandLabel ?? input.brandId,
              model: input.modelLabel ?? input.modelId,
              weaponType: input.weaponTypeLabel ?? input.weaponTypeId,
              weaponSubtype: input.subTypeLabel ?? input.weaponSubtypeId,
              count: newWeapons.length,
              shipmentId: input.shipmentId,
              currency: newWeapons[0].purchasePriceValuation?.originalCurrency,
              purchasePrice: newWeapons[0].purchasePrice,
              retailPrice: newWeapons[0].retailPrice,
              wholesalePrice: newWeapons[0].wholesalePrice,
              accountingCurrency: newWeapons[0].purchasePriceValuation?.accountingCurrency,
              productAdditionalCosts: input.additionalCosts?.length ?? 0,
              finalLandedBaseAmount: costSnapshots[0]?.finalLandedBaseAmount,
              additionalCosts: (input.additionalCosts ?? []).map((cost) => ({
                name: cost.name,
                calculationType: cost.calculationType,
                currency: cost.currency,
              })),
            }),
          })
        }

        return ok({ added: newWeapons.length, duplicates })
      })()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("weapon:update", (_, weapon: Weapon): IpcResult => {
    try {
      const existing = repo.getWeaponById(weapon.id)
      if (!existing) return fail("Weapon not found")
      repo.updateWeapon({
        ...weapon,
        purchasePrice: existing.purchasePrice,
        retailPrice: existing.retailPrice,
        wholesalePrice: existing.wholesalePrice,
        actualFinalPrice: existing.actualFinalPrice,
        purchasePriceValuation: existing.purchasePriceValuation,
        retailPriceValuation: existing.retailPriceValuation,
        wholesalePriceValuation: existing.wholesalePriceValuation,
        actualFinalPriceValuation: existing.actualFinalPriceValuation,
        salePriceValuation: existing.salePriceValuation,
      })
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("weapon:updateStatus", (_, weaponId: string, status: string, reason: string, currentUser: { id: string; name: string }): IpcResult => {
    try {
      const db = getDb()
      db.transaction(() => {
        if (!currentUser?.id || !currentUser.name?.trim()) throw new Error("A valid current user is required")
        if (!new Set(["Available", "Reserved"]).has(status)) {
          throw new Error("Sold and returned statuses may only be changed by their dedicated financial workflows")
        }
        const all = repo.getAll()
        const weapon = all.weapons.find((w) => w.id === weaponId)
        if (!weapon) throw new Error("Weapon not found")
        if (weapon.status === "Sold") throw new Error("A sold weapon cannot be changed outside the return/refund workflow")
        const updated = {
          ...weapon, status: status as Weapon["status"],
          movementHistory: [...weapon.movementHistory, {
            id: `MV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, timestamp: new Date().toISOString(),
            fromStatus: weapon.status, toStatus: status as Weapon["status"],
            userId: currentUser.id, userName: currentUser.name,
            reason: reason || `Status changed to ${status}`,
          }],
        }
        repo.updateWeapon(updated)
        repo.insertAuditLog({
          id: generateId("LOG", "audit_logs"), timestamp: new Date().toISOString(),
          date: new Date().toISOString().split("T")[0], userId: currentUser.id,
          actionType: "Update",
          description: `${weapon.brand} ${weapon.model} (SN: ${weapon.serialNumber}) status → ${status}`,
          metadata: JSON.stringify({
            schemaVersion: 2,
            actorName: currentUser.name,
            entityType: "weapon",
            entityId: weaponId,
            weaponId,
            serialNumber: weapon.serialNumber,
            itemName: `${weapon.brand} ${weapon.model}`,
            from: weapon.status,
            to: status,
            reason: reason || `Status changed to ${status}`,
          }),
        })
      })
      return ok()
    } catch (e) { return fail(String(e)) }
  })


  // ===== Sales =====
  ipcMain.handle("sale:complete", (_, input: SaleInput, currentUser: { id: string; name: string }): IpcResult<{ invoiceId: string; invoiceNumber: string }> => {
    try {
      const result = completeSale(input, currentUser)
      if (!result.success) return fail(result.error!)
      return ok({ invoiceId: result.invoiceId!, invoiceNumber: result.invoiceNumber! })
    } catch (e) { return fail(String(e)) }
  })

  // ===== Shipments =====
  ipcMain.handle("shipment:create", (_, input: ShipmentInput, currentUser: { id: string; name: string }): IpcResult<{ shipmentId: string }> => {
    try {
      const db = getDb()
      return db.transaction(() => {
        const all = repo.getAll()
        if (!currentUser?.id || !currentUser.name?.trim()) throw new Error("A valid current user is required")
        if (!input.shipmentNumber?.trim()) throw new Error("Shipment number is required")
        if (!Number.isInteger(input.totalExpectedItems) || input.totalExpectedItems < 0) throw new Error("Expected item count must be a non-negative integer")
        if (!all.suppliers.some((supplier) => supplier.id === input.supplierId)) throw new Error("Supplier not found")
        if (all.shipments.find((s) => s.shipmentNumber === input.shipmentNumber))
          return fail("Shipment number already exists")
        const shipmentId = generateId("SHP", "shipments")
        const shipmentCurrency = input.currency?.trim().toUpperCase() || backendCurrencyService.getDefaultTransactionCurrency()
        backendCurrencyService.requireCurrency(shipmentCurrency, true)
        const newShipment: Shipment = {
          id: shipmentId, shipmentNumber: input.shipmentNumber, supplierId: input.supplierId,
          shipmentDate: input.shipmentDate, expectedArrivalDate: input.expectedArrivalDate,
          totalExpectedItems: input.totalExpectedItems, attachments: input.attachments,
          notes: input.notes, status: "Pending",
          timeline: [{
            id: `STL-${Date.now()}`, timestamp: new Date().toISOString(),
            status: "Pending", userId: currentUser.id, userName: currentUser.name,
            notes: "Shipment created", eventType: "ShipmentCreated",
          }],
          purchaseOrderNumber: input.purchaseOrderNumber,
          invoiceNumber: input.invoiceNumber,
          shippingCarrier: input.shippingCarrier,
          containerNumber: input.containerNumber,
          currency: shipmentCurrency,
          purchaseDate: input.purchaseDate,
          actualArrivalDate: input.actualArrivalDate,
          lineItems: [], documents: [],
        }
        repo.insertShipment(newShipment)
        repo.insertAuditLog({
          id: generateId("LOG", "audit_logs"), timestamp: new Date().toISOString(),
          date: new Date().toISOString().split("T")[0], userId: currentUser.id,
          actionType: "Shipment",
          description: `Shipment ${input.shipmentNumber} created — ${input.totalExpectedItems} items expected`,
          metadata: JSON.stringify({
            schemaVersion: 2,
            actorName: currentUser.name,
            entityType: "shipment",
            entityId: shipmentId,
            shipmentId,
            shipmentNumber: input.shipmentNumber,
            supplierId: input.supplierId,
            totalExpectedItems: input.totalExpectedItems,
            purchaseDate: input.purchaseDate,
            expectedArrivalDate: input.expectedArrivalDate,
            currency: shipmentCurrency,
          }),
        })
        return ok({ shipmentId })
      })()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("shipment:bulkCreate", (_, input: BulkShipmentCreateInput, currentUser: { id: string; name: string }): IpcResult<{ shipmentId: string }> => {
    try {
      const db = getDb()
      return db.transaction(() => {
        const all = repo.getAll()
        if (!currentUser?.id || !currentUser.name?.trim()) throw new Error("A valid current user is required")
        if (!input.shipment.shipmentNumber?.trim()) throw new Error("Shipment number is required")
        if (!all.suppliers.some((supplier) => supplier.id === input.shipment.supplierId)) throw new Error("Supplier not found")
        if (all.shipments.find((s) => s.shipmentNumber === input.shipment.shipmentNumber))
          return fail("Shipment number already exists")
        if (input.lineItems.length === 0)
          return fail("At least one line item is required")

        const shipmentCurrency = input.shipment.currency?.trim().toUpperCase() || backendCurrencyService.getDefaultTransactionCurrency()
        backendCurrencyService.requireCurrency(shipmentCurrency, true)

        const shipmentId = generateId("SHP", "shipments")
        const today = new Date().toISOString().split("T")[0]
        const batchId = `BATCH-${Date.now()}`
        const existingSerials = new Set(all.weapons.map((w) => w.serialNumber.toLowerCase()))
        const newWeapons: Weapon[] = []
        const newAccessories: Accessory[] = []
        const newAmmunition: Ammunition[] = []
        const inventoryReceipts: Array<{ itemType: "weapon" | "accessory" | "ammunition"; itemId: string; quantity: number; unitAmount: number; currency: string }> = []
        let serialCounter = all.weapons.length + 1
        let accessoryCounter = Number.parseInt(generateId("ACC", "accessories").slice(3), 10)
        let ammunitionCounter = Number.parseInt(generateId("AMM", "ammunition").slice(3), 10)
        let lineItemCounter = 0
        const lineItems: Shipment["lineItems"] = []
        const costBasisItems: ShipmentItemCostBasis[] = []
        const seenLineItemIds = new Set<string>()

        for (const item of input.lineItems) {
          if (!new Set(["weapon", "accessory", "ammunition"]).has(item.productType)) throw new Error("Invalid shipment product type")
          if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error("Shipment item quantity must be a positive integer")
          if (item.productType === "weapon" && item.serialNumbers.filter((serial) => serial.trim()).length !== item.quantity) {
            throw new Error("Serialized weapon quantity must match the number of serial numbers")
          }
          nonNegativeMoney(item.purchasePrice, "Shipment purchase price")
          nonNegativeMoney(item.retailPrice, "Shipment retail price")
          nonNegativeMoney(item.wholesalePrice, "Shipment wholesale price")
          const itemCurrency = item.currency?.trim().toUpperCase() || shipmentCurrency
          const itemRateSnapshot = backendCurrencyService.getRateSnapshot(itemCurrency)
          const itemPurchaseValuation = backendCurrencyService.createValuationFromSnapshot(item.purchasePrice, itemRateSnapshot)
          const itemRetailValuation = backendCurrencyService.createValuationFromSnapshot(item.retailPrice, itemRateSnapshot)
          const itemWholesaleValuation = backendCurrencyService.createValuationFromSnapshot(item.wholesalePrice, itemRateSnapshot)
          const lineItemId = item.id?.trim() || `SLI${pad(++lineItemCounter, 4)}`
          if (seenLineItemIds.has(lineItemId)) throw new Error("Shipment line item IDs must be unique")
          seenLineItemIds.add(lineItemId)
          const productIds: string[] = []
          // Determine location for non‑weapon items
          const loc: StorageLocation = item.location ?? { warehouse: "Main", shelf: "", bin: "" }

          if (item.productType === "weapon") {
            const display = resolveWeaponDisplayFields(item)
            for (const sn of item.serialNumbers) {
              const trimmed = sn.trim()
              if (!trimmed) continue
              if (existingSerials.has(trimmed.toLowerCase())) throw new Error(`Duplicate weapon serial number: ${trimmed}`)
              existingSerials.add(trimmed.toLowerCase())
              nonNegativeMoney(item.purchasePrice, "Shipment purchase price")
              nonNegativeMoney(item.retailPrice, "Shipment retail price")
              nonNegativeMoney(item.wholesalePrice, "Shipment wholesale price")
              const weaponId = `W${pad(serialCounter, 5)}`
              newWeapons.push({
                id: weaponId,
                serialNumber: trimmed,
                weaponTypeId: item.weaponTypeId,
                weaponSubtypeId: item.weaponSubtypeId,
                caliberId: item.caliberId,
                brandId: item.brandId,
                modelId: item.modelId,
                storageLocationId: item.storageLocationId,
                weaponType: display.weaponType,
                subType: display.subType,
                caliber: display.caliber,
                brand: display.brand,
                model: display.model,
                // Use the location object computed earlier (or a lookup fallback)
                location: item.location ??
                  (() => {
                    // Optional: if no explicit location given, attempt to fetch from storageLocationId
                    if (item.storageLocationId) {
                      const locRow = db.prepare(`
              SELECT w.label AS warehouse, sl.shelf, sl.bin
              FROM storage_locations sl
              JOIN warehouses w ON w.id = sl.warehouse_id
              WHERE sl.id = ?
            `).get(item.storageLocationId) as { warehouse: string; shelf: string; bin: string } | undefined
                      if (locRow) return { warehouse: locRow.warehouse, shelf: locRow.shelf, bin: locRow.bin }
                    }
                    return { warehouse: "Main", shelf: "", bin: "" }
                  })(),
                condition: "Excellent",
                status: "Available",
                purchasePrice: itemPurchaseValuation.originalAmount,
                retailPrice: itemRetailValuation.originalAmount,
                wholesalePrice: itemWholesaleValuation.originalAmount,
                actualFinalPrice: null,
                supplierId: input.shipment.supplierId,
                shipmentId,
                dateAdded: today,
                batchId,
                notes: "",
                images: [],
                movementHistory: [{
                  id: `MV${pad(serialCounter, 5)}`, timestamp: new Date().toISOString(),
                  fromStatus: "Available", toStatus: "Available",
                  userId: currentUser.id, userName: currentUser.name,
                  reason: "Initial intake via shipment wizard",
                }],
                purchasePriceValuation: itemPurchaseValuation,
                retailPriceValuation: itemRetailValuation,
                wholesalePriceValuation: itemWholesaleValuation,
              })
              productIds.push(weaponId)
              inventoryReceipts.push({ itemType: "weapon", itemId: weaponId, quantity: 1, unitAmount: itemPurchaseValuation.originalAmount, currency: itemCurrency })
              serialCounter++
            }
          } else if (item.productType === "accessory") {
            const accessoryId = `ACC${pad(accessoryCounter++, 5)}`
            newAccessories.push({
              id: accessoryId,
              name: `${item.brandLabel ?? ''} ${item.modelLabel ?? ''}`.trim() || "Accessory",
              type: item.subTypeLabel ?? "",
              quantity: item.quantity,
              safetyThreshold: 5,
              price: itemRetailValuation.originalAmount,
              priceCurrency: itemCurrency,
              priceValuation: itemRetailValuation,
              location: loc,
              dateAdded: today,
            })
            productIds.push(accessoryId)
            inventoryReceipts.push({ itemType: "accessory", itemId: accessoryId, quantity: item.quantity, unitAmount: itemPurchaseValuation.originalAmount, currency: itemCurrency })
          } else if (item.productType === "ammunition") {
            const ammunitionId = `AMM${pad(ammunitionCounter++, 5)}`
            newAmmunition.push({
              id: ammunitionId,
              caliber: item.caliberLabel ?? "",
              packageType: "Box",
              unitsPerPackage: 50,
              fullPackages: Math.floor(item.quantity / 50),
              looseRounds: item.quantity % 50,
              safetyThreshold: 100,
              price: itemRetailValuation.originalAmount,
              priceCurrency: itemCurrency,
              priceValuation: itemRetailValuation,
              location: loc,
              dateAdded: today,
            })
            productIds.push(ammunitionId)
            inventoryReceipts.push({ itemType: "ammunition", itemId: ammunitionId, quantity: item.quantity, unitAmount: itemPurchaseValuation.originalAmount, currency: itemCurrency })
          }

          // Build the shipment line-item snapshot. Labels are intentionally stored as historical display data.
          const purchasePriceValuation = itemPurchaseValuation
          const retailPriceValuation = itemRetailValuation
          const wholesalePriceValuation = itemWholesaleValuation
          lineItems.push({
            id: lineItemId,
            productType: item.productType,
            weaponType: item.weaponTypeLabel ?? "",
            subType: item.subTypeLabel ?? "",
            brand: item.brandLabel ?? "",
            model: item.modelLabel ?? "",
            caliber: item.caliberLabel ?? "",
            quantity: item.quantity,
            purchasePrice: purchasePriceValuation.originalAmount,
            retailPrice: retailPriceValuation.originalAmount,
            wholesalePrice: wholesalePriceValuation.originalAmount,
            location: loc,
            serialNumbers: item.serialNumbers,
            received: item.productType === "weapon" ? item.serialNumbers.length : item.quantity,
            purchasePriceValuation,
            retailPriceValuation,
            wholesalePriceValuation,
            productAdditionalCosts: item.additionalCosts ?? [],
          })
          costBasisItems.push({
            id: lineItemId,
            productType: item.productType,
            description: `${item.brandLabel ?? ""} ${item.modelLabel ?? ""}`.trim() || item.productType,
            quantity: String(item.quantity),
            unitPurchaseAmount: String(item.purchasePrice),
            currency: itemCurrency,
            snapshot: itemRateSnapshot,
            productIds,
            productAdditionalCosts: item.additionalCosts ?? [],
          })
        }

        // Validate every product and shipment cost before the first inventory row
        // is written. The surrounding transaction remains the final rollback guard.
        for (const basis of costBasisItems) {
          for (const productId of basis.productIds) {
            prepareProductCosts(basis.productType, productId, basis.unitPurchaseAmount, basis.snapshot, basis.productAdditionalCosts ?? [], currentUser.id)
          }
        }
        const preparedShipmentCosts = prepareShipmentCosts(
          shipmentId,
          costBasisItems,
          input.additionalCosts ?? [],
          currentUser.id,
        )

        const totalItems = lineItems.reduce((sum, li) => sum + li.quantity, 0)
        const newShipment: Shipment = {
          id: shipmentId, shipmentNumber: input.shipment.shipmentNumber,
          supplierId: input.shipment.supplierId, shipmentDate: input.shipment.shipmentDate,
          expectedArrivalDate: input.shipment.expectedArrivalDate, totalExpectedItems: totalItems,
          attachments: input.shipment.attachments, notes: input.shipment.notes, status: "Arrived",
          timeline: [
            { id: `STL-${Date.now()}-1`, timestamp: new Date().toISOString(), status: "Pending", userId: currentUser.id, userName: currentUser.name, notes: "Shipment created", eventType: "ShipmentCreated" },
            { id: `STL-${Date.now()}-2`, timestamp: new Date().toISOString(), status: "Arrived", userId: currentUser.id, userName: currentUser.name, notes: "Shipment arrived with all items", eventType: "Arrived" },
          ],
          purchaseOrderNumber: input.shipment.purchaseOrderNumber, invoiceNumber: input.shipment.invoiceNumber,
          shippingCarrier: input.shipment.shippingCarrier, containerNumber: input.shipment.containerNumber,
          currency: shipmentCurrency, purchaseDate: input.shipment.purchaseDate,
          actualArrivalDate: input.shipment.actualArrivalDate, lineItems, documents: [],
          totalCostValuation: (() => {
            const baseTotal = sumMoney(costBasisItems.map((basis) =>
              nonNegativeMoney(basis.unitPurchaseAmount).times(basis.quantity).dividedBy(basis.snapshot.exchangeRate),
            ))
            const additionalBase = sumMoney(preparedShipmentCosts.map((cost) => cost.baseAmount))
            return backendCurrencyService.createValuation(sumMoney([baseTotal, additionalBase]).toString(), backendCurrencyService.getAccountingCurrency())
          })(),
        }
        repo.insertShipment(newShipment)
        for (const basis of costBasisItems) insertShipmentItemBasis(basis, shipmentId)
        insertShipmentCosts(preparedShipmentCosts)
        for (const cost of preparedShipmentCosts) {
          repo.insertAuditLog({
            id: generateId("LOG", "audit_logs"), timestamp: new Date().toISOString(), date: today,
            userId: currentUser.id, actionType: "Shipment",
            description: `Shipment cost added: ${cost.name}`,
            metadata: JSON.stringify({
              schemaVersion: 3, event: "SHIPMENT_COST_ADDED", shipmentId, costId: cost.id,
              amount: cost.calculatedAmount, currency: cost.currency, baseAmount: cost.baseAmount,
              baseCurrency: cost.baseCurrency, exchangeRate: cost.exchangeRate,
              exchangeRateDate: cost.exchangeRateDate, rateSource: cost.rateSource,
              scope: cost.scope, allocationMethod: cost.allocationMethod,
              selectedShipmentItemIds: cost.selectedShipmentItemIds,
              manualOverrides: cost.allocations.filter((allocation) => allocation.manualOverride).map((allocation) => ({
                shipmentItemId: allocation.shipmentItemId,
                automaticAmount: allocation.automaticAmount,
                finalAmount: allocation.finalAmount,
                difference: allocation.difference,
              })),
            }),
          })
        }
        if (newWeapons.length > 0) repo.bulkInsertWeapons(newWeapons)
        for (const a of newAccessories) repo.insertAccessory(a)
        for (const a of newAmmunition) repo.insertAmmunition(a)
        const finalizedCosts = finalizeInventoryCosts(shipmentId, costBasisItems, preparedShipmentCosts, currentUser.id)
        for (const receipt of inventoryReceipts) {
          recordInventoryTransaction({
            itemType: receipt.itemType,
            itemId: receipt.itemId,
            transactionType: "receipt",
            quantityDelta: receipt.quantity,
            unitAmount: receipt.unitAmount,
            currency: receipt.currency,
            shipmentId,
            userId: currentUser.id,
            notes: `Received through shipment ${newShipment.shipmentNumber}`,
          })
        }
        repo.insertAuditLog({
          id: generateId("LOG", "audit_logs"), timestamp: new Date().toISOString(), date: today,
          userId: currentUser.id, actionType: "Shipment",
          description: `Shipment ${input.shipment.shipmentNumber} created with ${lineItems.length} line items — ${totalItems} total items`,
          metadata: JSON.stringify({
            schemaVersion: 2,
            actorName: currentUser.name,
            entityType: "shipment",
            entityId: shipmentId,
            shipmentId,
            shipmentNumber: input.shipment.shipmentNumber,
            lineItems: lineItems.length,
            weapons: newWeapons.length,
            batchId,
            currency: shipmentCurrency,
            totalCost: newShipment.totalCostValuation?.originalAmount,
            accountingAmount: newShipment.totalCostValuation?.accountingAmount,
            accountingCurrency: newShipment.totalCostValuation?.accountingCurrency,
            exchangeRate: newShipment.totalCostValuation?.exchangeRate,
            exchangeRateDate: newShipment.totalCostValuation?.exchangeRateDate,
            rateSource: newShipment.totalCostValuation?.rateSource,
            shipmentAdditionalCosts: preparedShipmentCosts.length,
            shipmentAdditionalCostsBase: sumMoney(preparedShipmentCosts.map((cost) => cost.baseAmount)).toString(),
            inventoryCostSnapshots: finalizedCosts.length,
          }),
        })
        repo.insertNotification({
          id: generateId("NTF", "app_notifications"), type: "System",
          title: "Shipment Arrived", message: `Shipment ${input.shipment.shipmentNumber} arrived with ${totalItems} items`,
          date: today, read: false, entityId: shipmentId,
        })
        return ok({ shipmentId })
      })()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("shipment:update", (_, shipment: Shipment): IpcResult => {
    try {
      const existing = repo.getAll().shipments.find((candidate) => candidate.id === shipment.id)
      if (!existing) return fail("Shipment not found")
      repo.updateShipment({
        ...shipment,
        currency: existing.currency,
        lineItems: existing.lineItems,
        totalCostValuation: existing.totalCostValuation,
      })
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("cost:shipment:list", (_, shipmentId: string): IpcResult => {
    try {
      if (typeof shipmentId !== "string" || !shipmentId.trim()) throw new Error("Shipment ID is required")
      return ok(listShipmentCosts(shipmentId))
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("cost:product:replace", (_, productType: string, productId: string, drafts: ProductAdditionalCostInput[], currentUser: { id: string; name: string }): IpcResult => {
    try {
      if (typeof productType !== "string" || !productType.trim()) throw new Error("Product type is required")
      if (typeof productId !== "string" || !productId.trim()) throw new Error("Product ID is required")
      if (!Array.isArray(drafts)) throw new Error("Product costs must be an array")
      return getDb().transaction(() => {
        const before = listProductCosts(productType, productId)
        const snapshot = replaceProductCosts(productType, productId, drafts, currentUser.id)
        repo.insertAuditLog({
          id: generateId("LOG", "audit_logs"), timestamp: new Date().toISOString(), date: new Date().toISOString().slice(0, 10),
          userId: currentUser.id, actionType: "Update", description: `Product costs updated for ${productType} ${productId}`,
          metadata: JSON.stringify({
            schemaVersion: 3, event: "PRODUCT_COSTS_REPLACED", productType, productId,
            before: before.map((cost) => ({ id: cost.id, name: cost.name, baseAmount: cost.baseAmount })),
            after: drafts.map((cost) => ({ id: cost.id, name: cost.name, amount: cost.amount, percentageRate: cost.percentageRate, currency: cost.currency })),
            finalLandedBaseAmount: snapshot.finalLandedBaseAmount, baseCurrency: snapshot.baseCurrency,
          }),
        })
        return ok(snapshot)
      })()
    } catch (e) { return fail(String(e)) }
  })

  // ===== Production shipment manifest import =====
  ipcMain.handle("manifest:upload", async (event, input: ManifestUploadInput, currentUser: { id: string; name: string }): Promise<IpcResult> => {
    try {
      const review = await processManifestUpload(input, currentUser, (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send("manifest:progress", progress)
      })
      return ok(review)
    } catch (error) {
      console.error(JSON.stringify({ scope: "shipment-manifest", event: "processing-failed", error: error instanceof Error ? error.stack ?? error.message : String(error) }))
      return fail(error instanceof Error ? error.message : "Unable to extract shipment data")
    }
  })

  ipcMain.handle("manifest:get", (_, importId: string, currentUser: { id: string; name: string }): IpcResult => {
    try { authorizeManifest(currentUser, "shipment.review"); return ok(getManifestReview(importId)) }
    catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
  })

  ipcMain.handle("manifest:list", (_, limit: number, currentUser: { id: string; name: string }): IpcResult => {
    try { authorizeManifest(currentUser, "shipment.review"); return ok(listManifestReviews(limit)) }
    catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
  })

  ipcMain.handle("manifest:updateItem", (_, importId: string, itemId: string, patch: ManifestItemPatch, currentUser: { id: string; name: string }): IpcResult => {
    try { return ok(updateManifestItem(importId, itemId, patch, currentUser)) }
    catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
  })

  ipcMain.handle("manifest:updateItems", (_, importId: string, itemIds: string[], patch: ManifestItemPatch, currentUser: { id: string; name: string }): IpcResult => {
    try { return ok(updateManifestItems(importId, itemIds, patch, currentUser)) }
    catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
  })

  ipcMain.handle("manifest:updateDetails", (_, importId: string, patch: ManifestDetailsPatch, currentUser: { id: string; name: string }): IpcResult => {
    try { return ok(updateManifestDetails(importId, patch, currentUser)) }
    catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
  })

  ipcMain.handle("manifest:deleteReview", (_, importId: string, currentUser: { id: string; name: string }): IpcResult => {
    try { deleteManifestReview(importId, currentUser); return ok() }
    catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
  })

  ipcMain.handle("manifest:confirm", (_, input: ManifestConfirmInput, currentUser: { id: string; name: string }): IpcResult => {
    try { return ok(confirmManifest(input, currentUser)) }
    catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
  })

  ipcMain.handle("manifest:confirmArrival", (_, importId: string, currentUser: { id: string; name: string }): IpcResult => {
    try { return ok(confirmScheduledArrival(importId, currentUser)) }
    catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
  })

  ipcMain.handle("manifest:reschedule", (_, importId: string, expectedArrivalDate: string, reason: string, currentUser: { id: string; name: string }): IpcResult => {
    try { return ok(rescheduleManifest(importId, expectedArrivalDate, reason, currentUser)) }
    catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
  })

  ipcMain.handle("manifest:cancel", (_, importId: string, reason: string, currentUser: { id: string; name: string }): IpcResult => {
    try { return ok(cancelManifest(importId, reason, currentUser)) }
    catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
  })


  // ===== Invoices & Payments =====
  ipcMain.handle("invoice:update", (_, invoice: Invoice): IpcResult => {
    try {
      const existing = repo.getAll().invoices.find((candidate) => candidate.id === invoice.id)
      if (!existing) return fail("Invoice not found")
      repo.updateInvoice({
        ...existing,
        notes: invoice.notes,
        attachments: invoice.attachments,
      })
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("invoice:void", (_, invoiceId: string, currentUser: { id: string; name: string }): IpcResult => {
    try {
      const db = getDb()
      db.transaction(() => {
        const all = repo.getAll()
        const invoice = all.invoices.find((i) => i.id === invoiceId)
        if (!invoice) throw new Error("Invoice not found")
        if (!currentUser?.id || !currentUser.name?.trim()) throw new Error("A valid current user is required")
        if (invoice.voided) throw new Error("Invoice is already voided")
        const payments = all.payments.filter((payment) => payment.invoiceId === invoice.id)
        if (payments.length > 0 || invoice.totalPaid > 0) {
          throw new Error("A paid invoice cannot be voided without an explicit refund/reversal workflow")
        }
        if (invoice.type === "Sale") {
          for (const item of invoice.lineItems) {
            if (item.itemType === "weapon") {
              const weapon = all.weapons.find((candidate) => candidate.id === item.itemId)
              if (!weapon || weapon.status !== "Sold") throw new Error(`Cannot safely restore weapon ${item.itemId}`)
              repo.updateWeapon({
                ...weapon,
                status: "Available",
                actualFinalPrice: null,
                actualFinalPriceValuation: undefined,
                salePriceValuation: undefined,
                movementHistory: [...weapon.movementHistory, {
                  id: `MV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  timestamp: new Date().toISOString(),
                  fromStatus: "Sold",
                  toStatus: "Available",
                  userId: currentUser.id,
                  userName: currentUser.name,
                  reason: `Unpaid invoice ${invoice.invoiceNumber} voided`,
                }],
              })
            } else if (item.itemType === "accessory") {
              const accessory = repo.getAccessoryById(item.itemId)
              if (!accessory) throw new Error(`Cannot safely restore accessory ${item.itemId}`)
              repo.updateAccessory({ ...accessory, quantity: accessory.quantity + item.quantity })
              recordInventoryTransaction({ itemType: "accessory", itemId: item.itemId, transactionType: "return", quantityDelta: item.quantity, userId: currentUser.id })
            } else if (item.itemType === "ammunition") {
              const ammo = repo.getAmmunitionById(item.itemId)
              if (!ammo) throw new Error(`Cannot safely restore ammunition ${item.itemId}`)
              const total = ammoTotalRounds(ammo) + item.quantity
              repo.updateAmmunition({ ...ammo, fullPackages: Math.floor(total / ammo.unitsPerPackage), looseRounds: total % ammo.unitsPerPackage })
              recordInventoryTransaction({ itemType: "ammunition", itemId: item.itemId, transactionType: "return", quantityDelta: item.quantity, userId: currentUser.id })
            } else {
              throw new Error("Invoice contains an invalid line item type")
            }
          }
        }
        repo.updateInvoice({ ...invoice, voided: true, status: "Void" })
        repo.insertAuditLog({
          id: generateId("LOG", "audit_logs"), timestamp: new Date().toISOString(),
          date: new Date().toISOString().split("T")[0], userId: currentUser.id, actionType: "Void",
          description: `Invoice ${invoice.invoiceNumber} voided. All history preserved.`,
          metadata: JSON.stringify({
            schemaVersion: 2,
            actorName: currentUser.name,
            entityType: "invoice",
            entityId: invoiceId,
            invoiceId,
            invoiceNumber: invoice.invoiceNumber,
            originalBalance: invoice.balance,
            currency: invoice.currency,
            accountingCurrency: invoice.accountingCurrency,
          }),
        })
      })
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("invoice:extendDueDate", (_, input: DueDateExtensionInput, currentUser: { id: string; name: string }): IpcResult => {
    try {
      const db = getDb()
      db.transaction(() => {
        const all = repo.getAll()
        const invoice = all.invoices.find((i) => i.id === input.invoiceId)
        if (!invoice) throw new Error("Invoice not found")
        if (invoice.voided) throw new Error("Cannot extend voided invoice")
        const oldDate = invoice.dueDate
        const updatedInvoice = {
          ...invoice, dueDate: input.newDueDate,
          status: new Date(input.newDueDate) < new Date() && invoice.balance > 0 ? "Overdue" as const : invoice.status,
        }
        repo.updateInvoice(updatedInvoice)
        repo.insertAuditLog({
          id: generateId("LOG", "audit_logs"), timestamp: new Date().toISOString(),
          date: new Date().toISOString().split("T")[0], userId: currentUser.id, actionType: "DueDateExtension",
          description: `Due date extended for ${invoice.invoiceNumber}: ${oldDate} → ${input.newDueDate}. Reason: ${input.reason}`,
          metadata: JSON.stringify({
            schemaVersion: 2,
            actorName: currentUser.name,
            entityType: "invoice",
            entityId: input.invoiceId,
            invoiceId: input.invoiceId,
            invoiceNumber: invoice.invoiceNumber,
            oldDate,
            newDate: input.newDueDate,
            reason: input.reason,
          }),
        })
      })
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("payment:register", (_, input: PaymentInput, currentUser: { id: string; name: string }): IpcResult<{ newBalance: number }> => {
    const result = registerPayment(input, currentUser)
    return result.success ? ok({ newBalance: result.newBalance! }) : fail(result.error ?? "Payment failed")
  })

  // ===== Customers & Suppliers =====
  ipcMain.handle("customer:insert", (_, customer: Customer): IpcResult<Customer> => {
    try { repo.insertCustomer(customer); return ok(customer) } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("customer:delete", (_, customerId: string): IpcResult => {
    try {
      const all = repo.getAll()
      if (all.invoices.some((i) => i.customerId === customerId && !i.voided))
        return fail("Cannot delete customer with active invoices")
      repo.deleteCustomer(customerId)
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("supplier:insert", (_, supplier: Supplier): IpcResult<Supplier> => {
    try { repo.insertSupplier(supplier); return ok(supplier) } catch (e) { return fail(String(e)) }
  })

  // ===== Accessories & Ammunition =====
  ipcMain.handle("accessory:insert", (_, accessory: Accessory, currentUser: { id: string; name: string }): IpcResult => {
    try {
      getDb().transaction(() => {
        if (!currentUser?.id) throw new Error("A valid current user is required")
        nonNegativeMoney(accessory.price, "Accessory price")
        const currency = accessory.priceCurrency?.trim().toUpperCase() || backendCurrencyService.getDefaultTransactionCurrency()
        const snapshot = backendCurrencyService.getRateSnapshot(currency)
        const drafts = (accessory as Accessory & { additionalCostInputs?: import("../../src/lib/types.js").ProductAdditionalCostInput[] }).additionalCostInputs ?? []
        prepareProductCosts("accessory", accessory.id, accessory.price, snapshot, drafts, currentUser.id)
        repo.insertAccessory({ ...accessory, priceCurrency: currency, priceValuation: backendCurrencyService.createValuationFromSnapshot(accessory.price, snapshot) })
        finalizeStandaloneInventoryCost("accessory", accessory.id, accessory.price, snapshot, drafts, currentUser.id)
      })()
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("accessory:update", (_, accessory: Accessory): IpcResult => {
    try {
      const existing = repo.getAccessoryById(accessory.id)
      if (!existing) return fail("Accessory not found")
      nonNegativeMoney(accessory.price, "Accessory price")
      const currency = accessory.priceCurrency?.trim().toUpperCase()
        || existing.priceCurrency
        || backendCurrencyService.getDefaultTransactionCurrency()
      backendCurrencyService.requireCurrency(currency, true)
      const priceValuation = accessory.price === existing.price && currency === existing.priceCurrency && existing.priceValuation
        ? existing.priceValuation
        : backendCurrencyService.createValuation(accessory.price, currency)
      repo.updateAccessory({ ...accessory, priceCurrency: currency, priceValuation })
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("ammunition:insert", (_, ammo: Ammunition, currentUser: { id: string; name: string }): IpcResult => {
    try {
      getDb().transaction(() => {
        if (!currentUser?.id) throw new Error("A valid current user is required")
        nonNegativeMoney(ammo.price, "Ammunition price")
        const currency = ammo.priceCurrency?.trim().toUpperCase() || backendCurrencyService.getDefaultTransactionCurrency()
        const snapshot = backendCurrencyService.getRateSnapshot(currency)
        const drafts = (ammo as Ammunition & { additionalCostInputs?: import("../../src/lib/types.js").ProductAdditionalCostInput[] }).additionalCostInputs ?? []
        prepareProductCosts("ammunition", ammo.id, ammo.price, snapshot, drafts, currentUser.id)
        repo.insertAmmunition({ ...ammo, priceCurrency: currency, priceValuation: backendCurrencyService.createValuationFromSnapshot(ammo.price, snapshot) })
        finalizeStandaloneInventoryCost("ammunition", ammo.id, ammo.price, snapshot, drafts, currentUser.id)
      })()
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("ammunition:update", (_, ammo: Ammunition): IpcResult => {
    try {
      const existing = repo.getAmmunitionById(ammo.id)
      if (!existing) return fail("Ammunition not found")
      nonNegativeMoney(ammo.price, "Ammunition price")
      const currency = ammo.priceCurrency?.trim().toUpperCase()
        || existing.priceCurrency
        || backendCurrencyService.getDefaultTransactionCurrency()
      backendCurrencyService.requireCurrency(currency, true)
      const priceValuation = ammo.price === existing.price && currency === existing.priceCurrency && existing.priceValuation
        ? existing.priceValuation
        : backendCurrencyService.createValuation(ammo.price, currency)
      repo.updateAmmunition({ ...ammo, priceCurrency: currency, priceValuation })
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("inventory:addStock", (_, input: AddStockInput, currentUser: { id: string; name: string }): IpcResult => {
    try {
      const db = getDb();
      db.transaction(() => {
        if (!currentUser?.id || !currentUser.name?.trim()) throw new Error("A valid current user is required")
        if (input.price !== undefined) nonNegativeMoney(input.price, "Price")
        if (input.purchasePrice !== undefined) nonNegativeMoney(input.purchasePrice, "Purchase price")
        const transactionCurrency = input.currency?.trim().toUpperCase() || backendCurrencyService.getDefaultTransactionCurrency()
        if (input.itemType !== "accessory" && input.itemType !== "ammunition") throw new Error("Invalid inventory item type")
        if (input.itemType === "accessory") {
          const qty = input.quantity ?? 0;
          if (!Number.isInteger(qty) || qty <= 0) throw new Error("Quantity must be a positive integer.");
          const item = repo.getAccessoryById(input.itemId);
          if (!item) throw new Error("Accessory not found.");
          const oldPrice = item.price;
          const newQty = item.quantity + qty;
          const updated = { ...item, quantity: newQty };
          if (input.price !== undefined) {
            updated.price = input.price;
            updated.priceCurrency = transactionCurrency
            updated.priceValuation = backendCurrencyService.createValuation(input.price, transactionCurrency)
          }
          if (input.location) updated.location = input.location;
          repo.updateAccessory(updated);
          recordInventoryTransaction({
            itemType: "accessory", itemId: item.id, transactionType: "receipt", quantityDelta: qty,
            unitAmount: input.purchasePrice ?? input.price, currency: transactionCurrency,
            shipmentId: input.shipmentId, notes: input.notes, userId: currentUser.id,
          })
          // Audit
          repo.insertAuditLog({
            id: generateId("LOG", "audit_logs"),
            timestamp: new Date().toISOString(),
            date: new Date().toISOString().split("T")[0],
            userId: currentUser.id,
            actionType: "StockAdjustment",
            description: `Accessory stock added: +${qty} units to "${item.name}". New stock: ${newQty}. ${input.price !== undefined ? `Price changed: ${oldPrice} → ${input.price}` : ""
              }`,
            metadata: JSON.stringify({
              schemaVersion: 2,
              actorName: currentUser.name,
              entityType: "accessory",
              entityId: input.itemId,
              itemId: input.itemId,
              itemName: item.name,
              addedQuantity: qty,
              newQuantity: newQty,
              oldPrice,
              oldPriceCurrency: item.priceCurrency,
              newPrice: input.price,
              newPriceCurrency: input.price === undefined ? undefined : transactionCurrency,
              currency: transactionCurrency,
              accountingAmount: updated.priceValuation?.accountingAmount,
              accountingCurrency: updated.priceValuation?.accountingCurrency,
              location: input.location,
            }),
          });
        } else {
          // ammunition
          const item = repo.getAmmunitionById(input.itemId);
          if (!item) throw new Error("Ammunition not found.");
          const pkgs = input.packages ?? 0;
          const loose = input.looseRounds ?? 0;
          if (!Number.isInteger(pkgs) || !Number.isInteger(loose) || pkgs < 0 || loose < 0) throw new Error("Packages and loose rounds must be non-negative integers.");
          const addedRounds = pkgs * item.unitsPerPackage + loose;
          if (addedRounds <= 0) throw new Error("At least one round must be added.");
          const currentTotal = ammoTotalRounds(item);
          const newTotal = currentTotal + addedRounds;
          // Normalise
          const newFull = Math.floor(newTotal / item.unitsPerPackage);
          const newLoose = newTotal % item.unitsPerPackage;
          const oldPrice = item.price;
          const updated = { ...item, fullPackages: newFull, looseRounds: newLoose };
          if (input.price !== undefined) {
            updated.price = input.price;
            updated.priceCurrency = transactionCurrency
            updated.priceValuation = backendCurrencyService.createValuation(input.price, transactionCurrency)
          }
          if (input.location) updated.location = input.location;
          repo.updateAmmunition(updated);
          recordInventoryTransaction({
            itemType: "ammunition", itemId: item.id, transactionType: "receipt", quantityDelta: addedRounds,
            unitAmount: input.purchasePrice ?? input.price, currency: transactionCurrency,
            shipmentId: input.shipmentId, notes: input.notes, userId: currentUser.id,
          })
          // Audit
          repo.insertAuditLog({
            id: generateId("LOG", "audit_logs"),
            timestamp: new Date().toISOString(),
            date: new Date().toISOString().split("T")[0],
            userId: currentUser.id,
            actionType: "StockAdjustment",
            description: `Ammo stock added: ${pkgs} packs + ${loose} loose rounds to "${item.caliber} (${item.packageType})"
              ". Added rounds: ${addedRounds}. New total: ${newTotal} rounds.${input.price !== undefined ? ` Price changed: ${oldPrice} → ${input.price}` : ""
              }`,
            metadata: JSON.stringify({
              schemaVersion: 2,
              actorName: currentUser.name,
              entityType: "ammunition",
              entityId: input.itemId,
              itemId: input.itemId,
              caliber: item.caliber,
              packageType: item.packageType,
              unitsPerPackage: item.unitsPerPackage,
              packages: pkgs,
              looseRounds: loose,
              addedRounds,
              oldTotalRounds: currentTotal,
              newTotalRounds: newTotal,
              oldPrice,
              oldPriceCurrency: item.priceCurrency,
              newPrice: input.price,
              newPriceCurrency: input.price === undefined ? undefined : transactionCurrency,
              currency: transactionCurrency,
              accountingAmount: updated.priceValuation?.accountingAmount,
              accountingCurrency: updated.priceValuation?.accountingCurrency,
              location: input.location,
            }),
          });
        }
      })();
      return ok();
    } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle("inventory:receiveAmmoByPackages", (_, input: ReceiveAmmoByPackagesInput, currentUser: { id: string; name: string }): IpcResult => {
    try {
      getDb().transaction(() => {
        if (!currentUser?.id) throw new Error("A valid current user is required")
        if (!Number.isInteger(input.numberOfPackages) || input.numberOfPackages <= 0) throw new Error("Number of packages must be a positive integer")
        if (!Number.isInteger(input.unitsPerPackage) || input.unitsPerPackage <= 0) throw new Error("Units per package must be a positive integer")
        nonNegativeMoney(input.purchasePrice, "Purchase price")
        const item = repo.getAmmunitionById(input.itemId)
        if (!item) throw new Error("Ammunition not found")
        const addedRounds = input.numberOfPackages * input.unitsPerPackage
        const totalRounds = ammoTotalRounds(item) + addedRounds
        repo.updateAmmunition({
          ...item,
          unitsPerPackage: input.unitsPerPackage,
          fullPackages: Math.floor(totalRounds / input.unitsPerPackage),
          looseRounds: totalRounds % input.unitsPerPackage,
          location: input.location ?? item.location,
        })
        recordInventoryTransaction({
          itemType: "ammunition", itemId: item.id, transactionType: "receipt", quantityDelta: addedRounds,
          unitAmount: input.purchasePrice, currency: input.currency, shipmentId: input.shipmentId,
          notes: input.notes, userId: currentUser.id,
        })
      })()
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("inventory:receiveAmmoByRounds", (_, input: ReceiveAmmoByRoundsInput, currentUser: { id: string; name: string }): IpcResult => {
    try {
      getDb().transaction(() => {
        if (!currentUser?.id) throw new Error("A valid current user is required")
        if (!Number.isInteger(input.totalRounds) || input.totalRounds <= 0) throw new Error("Total rounds must be a positive integer")
        nonNegativeMoney(input.purchasePrice, "Purchase price")
        const item = repo.getAmmunitionById(input.itemId)
        if (!item) throw new Error("Ammunition not found")
        const totalRounds = ammoTotalRounds(item) + input.totalRounds
        repo.updateAmmunition({
          ...item,
          fullPackages: Math.floor(totalRounds / item.unitsPerPackage),
          looseRounds: totalRounds % item.unitsPerPackage,
          location: input.location ?? item.location,
        })
        recordInventoryTransaction({
          itemType: "ammunition", itemId: item.id, transactionType: "receipt", quantityDelta: input.totalRounds,
          unitAmount: input.purchasePrice, currency: input.currency, shipmentId: input.shipmentId,
          notes: input.notes, userId: currentUser.id,
        })
      })()
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("inventory:sellAmmo", (_, _input: SellAmmoInput, _currentUser: { id: string; name: string }): IpcResult => {
    return fail("Ammunition sales must be completed through the atomic sale and invoice workflow")
  })

  ipcMain.handle("inventory:updateAmmoPackage", (_, input: UpdateAmmoPackageInput, currentUser: { id: string; name: string }): IpcResult => {
    try {
      getDb().transaction(() => {
        if (!currentUser?.id) throw new Error("A valid current user is required")
        if (!Number.isInteger(input.unitsPerPackage) || input.unitsPerPackage <= 0) throw new Error("Units per package must be a positive integer")
        const item = repo.getAmmunitionById(input.itemId)
        if (!item) throw new Error("Ammunition not found")
        const rounds = ammoTotalRounds(item)
        repo.updateAmmunition({
          ...item,
          packageType: input.packageType,
          unitsPerPackage: input.unitsPerPackage,
          fullPackages: Math.floor(rounds / input.unitsPerPackage),
          looseRounds: rounds % input.unitsPerPackage,
        })
      })()
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  // ===== Users =====
  ipcMain.handle("user:insert", (_, user: User): IpcResult => {
    try { repo.insertUser(user); return ok() } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("user:update", (_, user: User): IpcResult => {
    try { repo.updateUser(user); return ok() } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("user:delete", (_, id: string): IpcResult => {
    try { repo.deleteUser(id); return ok() } catch (e) { return fail(String(e)) }
  })

  // ===== Notifications =====
  ipcMain.handle("notification:update", (_, n: AppNotification): IpcResult => {
    try { repo.updateNotification(n); return ok() } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("notification:delete", (_, id: string): IpcResult => {
    try { repo.deleteNotification(id); return ok() } catch (e) { return fail(String(e)) }
  })

  // ===== Audit Logs =====
  ipcMain.handle("auditLog:insert", (_, a: AuditLog): IpcResult => {
    try { repo.insertAuditLog(a); return ok() } catch (e) { return fail(String(e)) }
  })

  // ===== Saved Filters =====
  ipcMain.handle("savedFilter:insert", (_, f: SavedFilter): IpcResult => {
    try { repo.insertSavedFilter(f); return ok() } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("savedFilter:delete", (_, id: string): IpcResult => {
    try { repo.deleteSavedFilter(id); return ok() } catch (e) { return fail(String(e)) }
  })

  // ===== Currency =====
  ipcMain.handle("currency:updateRate", (_, code: string, rate: number): IpcResult => {
    try {
      getDb().transaction(() => {
        const currency = requireActiveCurrency(code)
        const normalizedRate = requirePositiveRate(rate)
        const oldRate = currency.last_known_rate == null ? null : Number(currency.last_known_rate)
        const now = new Date().toISOString()
        repo.updateCurrencyRate(currency.iso_code, normalizedRate, now)
        repo.recordRateHistory(currency.iso_code, normalizedRate, "api")
        repo.recordRateAuditLog(currency.iso_code, oldRate, normalizedRate, "system", "Automatic rate update", now, "api")
      })()
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("currency:recordRateHistory", (_, code: string, rate: number, source: string): IpcResult => {
    try {
      const currency = requireActiveCurrency(code)
      const normalizedRate = requirePositiveRate(rate)
      if (!new Set(["manual", "api", "cache", "default"]).has(source)) throw new Error("Invalid exchange-rate source")
      repo.recordRateHistory(currency.iso_code, normalizedRate, source)
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("currency:setManualOverride", (_, code: string, rate: number, changedBy: string, reason: string): IpcResult => {
    try {
      const db = getDb()
      db.transaction(() => {
        const currency = requireActiveCurrency(code)
        const normalizedRate = requirePositiveRate(rate)
        const administrator = requireRateAdministrator(changedBy)
        if (typeof reason !== "string" || !reason.trim()) throw new Error("A reason is required for a manual exchange-rate change")
        const currentRate = currency.last_known_rate != null ? Number(currency.last_known_rate) : null
        const now = new Date().toISOString()
        repo.setManualOverride(currency.iso_code, normalizedRate, administrator, reason.trim(), now)
        repo.updateCurrencyRate(currency.iso_code, normalizedRate, now)
        repo.recordRateHistory(currency.iso_code, normalizedRate, "manual")
        repo.recordRateAuditLog(currency.iso_code, currentRate, normalizedRate, administrator, reason.trim(), now, "manual")
      })()
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("currency:setAutomatic", (_, code: string, changedBy: string): IpcResult => {
    try {
      getDb().transaction(() => {
        const currency = requireActiveCurrency(code)
        const administrator = requireRateAdministrator(changedBy)
        const now = new Date().toISOString()
        repo.setAutomaticMode(currency.iso_code, administrator, now)
        repo.recordRateAuditLog(currency.iso_code, currency.last_known_rate == null ? null : Number(currency.last_known_rate), null, administrator, "Switched to automatic mode", now, "api")
      })()
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("currency:add", (_, isoCode: string, name: string, symbol: string, decimalPrecision: number, initialRate: number): IpcResult => {
    try {
      const code = normalizeCurrencyCode(isoCode)
      if (typeof name !== "string" || !name.trim()) throw new Error("Currency name is required")
      if (typeof symbol !== "string" || !symbol.trim()) throw new Error("Currency symbol is required")
      if (!Number.isInteger(decimalPrecision) || decimalPrecision < 0 || decimalPrecision > 4) throw new Error("Decimal precision must be an integer between 0 and 4")
      const rate = requirePositiveRate(initialRate)
      getDb().transaction(() => {
        repo.addCurrency(code, name.trim(), symbol.trim(), decimalPrecision, rate)
        repo.recordRateHistory(code, rate, "manual")
        repo.recordRateAuditLog(code, null, rate, "system", `Currency ${code} added`, new Date().toISOString(), "manual")
      })()
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("currency:toggleActive", (_, code: string, isActive: boolean): IpcResult => {
    try {
      const currency = repo.getCurrencies().find((row) => row.iso_code === normalizeCurrencyCode(code))
      if (!currency) throw new Error(`Currency is not registered: ${code}`)
      if (!isActive) {
        const settings = repo.getSettings()
        const protectedCodes = new Set([settings.currencyCode, settings.accountingCurrencyCode, settings.rateBaseCurrencyCode])
        if (protectedCodes.has(currency.iso_code)) throw new Error(`Currency ${currency.iso_code} is currently configured as a system currency and cannot be deactivated`)
      }
      repo.toggleCurrencyActive(currency.iso_code, Boolean(isActive))
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("currency:recordRateAuditLog", (_, code: string, oldRate: number | null, newRate: number | null, changedBy: string, reason: string, _changedAt: string): IpcResult => {
    try {
      const currency = requireActiveCurrency(code)
      const administrator = requireRateAdministrator(changedBy)
      const validOld = oldRate == null ? null : requirePositiveRate(oldRate)
      const validNew = newRate == null ? null : requirePositiveRate(newRate)
      if (typeof reason !== "string" || !reason.trim()) throw new Error("Audit reason is required")
      repo.recordRateAuditLog(currency.iso_code, validOld, validNew, administrator, reason.trim(), new Date().toISOString())
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("currency:delete", (_, code: string): IpcResult => {
    try {
      const currency = repo.getCurrencies().find((row) => row.iso_code === normalizeCurrencyCode(code))
      if (!currency) throw new Error(`Currency is not registered: ${code}`)
      const settings = repo.getSettings()
      const protectedCodes = new Set([settings.currencyCode, settings.accountingCurrencyCode, settings.rateBaseCurrencyCode])
      if (protectedCodes.has(currency.iso_code)) throw new Error(`Currency ${currency.iso_code} is currently configured as a system currency and cannot be removed`)
      // Currency rows are audit identities. Deletion is intentionally implemented as
      // deactivation so historical snapshots and rate logs remain resolvable.
      repo.toggleCurrencyActive(currency.iso_code, false)
      return ok();
    } catch (e) {
      return fail(String(e));
    }
  });

  // ===== Master Data CRUD =====
  ipcMain.handle("masterData:insertWeaponType", (_e, label: string, sortOrder: number): IpcResult<string> => {
    try {
      const id = repo.getOrCreateWeaponType(label.trim(), sortOrder)
      return ok(id)
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("masterData:insertWeaponSubtype", (_e, weaponTypeId: string, label: string, sortOrder: number): IpcResult<string> => {
    try {
      const id = repo.getOrCreateWeaponSubtype(weaponTypeId, label.trim(), sortOrder)
      return ok(id)
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("masterData:insertCaliber", (_e, label: string): IpcResult<string> => {
    try {
      const id = repo.getOrCreateCaliber(label.trim())
      return ok(id)
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("masterData:linkSubtypeCaliber", (_e, subtypeId: string, caliberId: string): IpcResult => {
    try { repo.linkSubtypeCaliber(subtypeId, caliberId); return ok() } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("masterData:insertBrand", (_e, label: string): IpcResult<string> => {
    try {
      const id = repo.getOrCreateBrand(label.trim())
      return ok(id)
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle("masterData:insertModel", (_e, label: string, brandId: string | null): IpcResult<string> => {
    try {
      if (!brandId) {
        // brandId is required in the normalized schema – throw a clear error
        throw new Error("Brand ID is required to create or find a model.")
      }
      const id = repo.getOrCreateModel(label.trim(), brandId)
      return ok(id)
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("masterData:insertWarehouse", (_e, label: string): IpcResult<string> => {
    try {
      const id = repo.getOrCreateWarehouse(label.trim())
      return ok(id)
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("masterData:insertStorageLocation", (_e, warehouseId: string, shelf: string, bin: string): IpcResult<string> => {
    try {
      const id = repo.getOrCreateStorageLocation(warehouseId, shelf.trim(), bin.trim())
      return ok(id)
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("masterData:deleteRow", (_e, table: string, id: string): IpcResult => {
    try { repo.deleteMasterRow(table, id); return ok() } catch (e) { return fail(String(e)) }
  })
}

function recordInventoryTransaction(input: {
  itemType: "weapon" | "accessory" | "ammunition"
  itemId: string
  transactionType: "receipt" | "adjustment" | "sale" | "return"
  quantityDelta: number
  unitAmount?: number
  currency?: string
  shipmentId?: string | null
  notes?: string
  userId: string
}): void {
  const valuation = input.unitAmount == null
    ? undefined
    : backendCurrencyService.createValuation(
      input.unitAmount,
      input.currency?.trim().toUpperCase() || backendCurrencyService.getDefaultTransactionCurrency(),
    )
  getDb().prepare(`
    INSERT INTO inventory_transactions
      (id, item_type, item_id, transaction_type, quantity_delta, unit_amount,
       currency, valuation, shipment_id, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    generateId("ITX", "inventory_transactions"),
    input.itemType,
    input.itemId,
    input.transactionType,
    input.quantityDelta,
    valuation == null ? null : String(valuation.originalAmount),
    valuation?.originalCurrency ?? null,
    valuation ? JSON.stringify(valuation) : null,
    input.shipmentId ?? null,
    input.notes ?? "",
    input.userId,
  )
}
