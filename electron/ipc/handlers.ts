import { ipcMain, type BrowserWindow } from "electron"
import { repo } from "../repositories"
import { getDb } from "../database"
import { completeSale } from "../services/sale-service"
import type { AllData, MasterDataAll } from "../../src/lib/db/mappers"
import type {
  Weapon, Shipment, Invoice, PaymentRecord, Accessory, Ammunition,
  Customer, Supplier, AuditLog, AppNotification, User, SystemSettings,
  SavedFilter, UserPreferences,
} from "../../src/lib/types"
import type { CurrencyRow, ExchangeRateOverrideRow, AuditLogEntry } from "../../src/lib/db/mappers"

import type {
  BulkIntakeInput, ShipmentInput, BulkShipmentCreateInput,
  PaymentInput, DueDateExtensionInput, AddStockInput,
  ReceiveAmmoByPackagesInput, ReceiveAmmoByRoundsInput, SellAmmoInput,
  UpdateAmmoPackageInput,
} from "../../src/lib/store"

import { CurrencyService } from "../../src/lib/currency-service"
import { ammoTotalRounds } from "../../src/lib/types"
import { generateMockData } from "../../src/lib/mock-data"

function pad(num: number, size: number): string {
  return num.toString().padStart(size, "0")
}

function generateId(prefix: string, table: string): string {
  const db = getDb()
  const row = db.prepare(`SELECT id FROM ${table} ORDER BY id DESC LIMIT 1`).get() as { id: string } | undefined
  if (!row) return `${prefix}${pad(1, 5)}`
  const num = parseInt(row.id.replace(/\D/g, ""), 10)
  return `${prefix}${pad(num + 1, 5)}`
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

export function registerIpcHandlers(_mainWindow: BrowserWindow): void {
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

  // ===== Settings & Preferences =====
  ipcMain.handle("settings:update", (_, updates: Partial<SystemSettings>): IpcResult<SystemSettings> => {
    try {
      const current = repo.getSettings()
      const merged = { ...current, ...updates }
      repo.updateSettings(merged)
      return ok(merged)
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("userPreferences:upsert", (_, prefs: UserPreferences): IpcResult<UserPreferences> => {
    try { repo.upsertUserPreferences(prefs); return ok(prefs) } catch (e) { return fail(String(e)) }
  })

  // ===== Weapons =====
  ipcMain.handle("weapon:bulkInsert", (_, input: BulkIntakeInput, currentUser: { id: string; name: string }): IpcResult<{ added: number; duplicates: string[] }> => {
    try {
      const db = getDb()
      return db.transaction(() => {
        const all = repo.getAll()
        const existingSerials = new Set(all.weapons.map((w) => w.serialNumber.toLowerCase()))
        const duplicates: string[] = []
        const newWeapons: Weapon[] = []
        const batchId = `BATCH-${Date.now()}`
        let serialCounter = all.weapons.length + 1
        const today = new Date().toISOString().split("T")[0]

        for (const sn of input.serialNumbers) {
          const trimmed = sn.trim()
          if (!trimmed) continue
          if (existingSerials.has(trimmed.toLowerCase())) { duplicates.push(trimmed); continue }
          existingSerials.add(trimmed.toLowerCase())
          const currency = input.currency || "USD"
          newWeapons.push({
            id: `W${pad(serialCounter, 5)}`,
            serialNumber: trimmed,
            brand: input.brand, model: input.model,
            weaponType: input.weaponType, subType: input.subType, caliber: input.caliber,
            condition: input.condition, status: "Available",
            purchasePrice: input.purchasePrice, retailPrice: input.retailPrice,
            wholesalePrice: input.wholesalePrice, actualFinalPrice: null,
            supplierId: input.supplierId, shipmentId: input.shipmentId,
            dateAdded: today, batchId, notes: input.notes, images: [],
            movementHistory: [{
              id: `MV${pad(serialCounter, 5)}`, timestamp: new Date().toISOString(),
              fromStatus: "Available", toStatus: "Available",
              userId: currentUser.id, userName: currentUser.name,
              reason: "Initial intake via bulk intake wizard",
            }],
            location: input.location,
            purchasePriceValuation: CurrencyService.createValuation(input.purchasePrice, currency),
            retailPriceValuation: CurrencyService.createValuation(input.retailPrice, currency),
          })
          serialCounter++
        }

        if (newWeapons.length > 0) {
          repo.bulkInsertWeapons(newWeapons)
          repo.insertAuditLog({
            id: generateId("LOG", "audit_logs"), timestamp: new Date().toISOString(), date: today,
            userId: currentUser.id, actionType: "Intake",
            description: `Bulk intake: ${newWeapons.length} ${input.brand} ${input.model} (${input.weaponType}/${input.subType}) — Batch: ${batchId}`,
            metadata: JSON.stringify({ batchId, count: newWeapons.length, shipmentId: input.shipmentId }),
          })
        }

        return ok({ added: newWeapons.length, duplicates })
      })
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("weapon:update", (_, weapon: Weapon): IpcResult => {
    try { repo.updateWeapon(weapon); return ok() } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("weapon:updateStatus", (_, weaponId: string, status: string, reason: string, currentUser: { id: string; name: string }): IpcResult => {
    try {
      const db = getDb()
      db.transaction(() => {
        const all = repo.getAll()
        const weapon = all.weapons.find((w) => w.id === weaponId)
        if (!weapon) throw new Error("Weapon not found")
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
          metadata: JSON.stringify({ weaponId, from: weapon.status, to: status }),
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
        if (all.shipments.find((s) => s.shipmentNumber === input.shipmentNumber))
          return fail("Shipment number already exists")
        const shipmentId = generateId("SHP", "shipments")
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
          currency: input.currency,
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
          metadata: JSON.stringify({ shipmentId, supplierId: input.supplierId }),
        })
        return ok({ shipmentId })
      })
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("shipment:bulkCreate", (_, input: BulkShipmentCreateInput, currentUser: { id: string; name: string }): IpcResult<{ shipmentId: string }> => {
    try {
      const db = getDb()
      return db.transaction(() => {
        const all = repo.getAll()
        if (all.shipments.find((s) => s.shipmentNumber === input.shipment.shipmentNumber))
          return fail("Shipment number already exists")
        if (input.lineItems.length === 0)
          return fail("At least one line item is required")

        const shipmentId = generateId("SHP", "shipments")
        const today = new Date().toISOString().split("T")[0]
        const batchId = `BATCH-${Date.now()}`
        const existingSerials = new Set(all.weapons.map((w) => w.serialNumber.toLowerCase()))
        const newWeapons: Weapon[] = []
        const newAccessories: Accessory[] = []
        const newAmmunition: Ammunition[] = []
        let serialCounter = all.weapons.length + 1
        let lineItemCounter = 0
        const lineItems: Shipment["lineItems"] = []

        for (const item of input.lineItems) {
          const lineItemId = `SLI${pad(++lineItemCounter, 4)}`
          if (item.productType === "weapon") {
            for (const sn of item.serialNumbers) {
              const trimmed = sn.trim()
              if (!trimmed) continue
              if (existingSerials.has(trimmed.toLowerCase())) continue
              existingSerials.add(trimmed.toLowerCase())
              const shipCurrency = input.shipment.currency || "USD"
              newWeapons.push({
                id: `W${pad(serialCounter, 5)}`, serialNumber: trimmed,
                brand: item.brand, model: item.model,
                weaponType: item.weaponType, subType: item.subType, caliber: item.caliber,
                condition: "Excellent", status: "Available",
                purchasePrice: item.purchasePrice, retailPrice: item.retailPrice,
                wholesalePrice: item.wholesalePrice, actualFinalPrice: null,
                supplierId: input.shipment.supplierId, shipmentId,
                dateAdded: today, batchId, notes: "", images: [],
                movementHistory: [{
                  id: `MV${pad(serialCounter, 5)}`, timestamp: new Date().toISOString(),
                  fromStatus: "Available", toStatus: "Available",
                  userId: currentUser.id, userName: currentUser.name,
                  reason: "Initial intake via shipment wizard",
                }],
                location: item.location,
                purchasePriceValuation: CurrencyService.createValuation(item.purchasePrice, shipCurrency),
                retailPriceValuation: CurrencyService.createValuation(item.retailPrice, shipCurrency),
              })
              serialCounter++
            }
          } else if (item.productType === "accessory") {
            newAccessories.push({
              id: generateId("ACC", "accessories"),
              name: `${item.brand} ${item.model}`, type: item.subType,
              quantity: item.quantity, safetyThreshold: 5, price: item.retailPrice,
              location: item.location, dateAdded: today,
            })
          } else if (item.productType === "ammunition") {
            newAmmunition.push({
              id: generateId("AMM", "ammunition"),
              caliber: item.caliber, packageType: "Box", unitsPerPackage: 50,
              fullPackages: Math.floor(item.quantity / 50), looseRounds: item.quantity % 50,
              safetyThreshold: 100, price: item.retailPrice,
              location: item.location, dateAdded: today,
            })
          }
          const liCurrency = input.shipment.currency || "USD"
          lineItems.push({
            id: lineItemId, productType: item.productType,
            weaponType: item.weaponType, subType: item.subType,
            brand: item.brand, model: item.model, caliber: item.caliber,
            quantity: item.quantity, purchasePrice: item.purchasePrice,
            retailPrice: item.retailPrice, wholesalePrice: item.wholesalePrice,
            location: item.location, serialNumbers: item.serialNumbers,
            received: item.productType === "weapon" ? item.serialNumbers.length : item.quantity,
            purchasePriceValuation: CurrencyService.createValuation(item.purchasePrice * item.quantity, liCurrency),
            retailPriceValuation: CurrencyService.createValuation(item.retailPrice * item.quantity, liCurrency),
          })
        }

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
          currency: input.shipment.currency, purchaseDate: input.shipment.purchaseDate,
          actualArrivalDate: input.shipment.actualArrivalDate, lineItems, documents: [],
          totalCostValuation: CurrencyService.createValuation(
            lineItems.reduce((sum, li) => sum + li.purchasePrice * li.quantity, 0),
            input.shipment.currency || "USD"
          ),
        }
        repo.insertShipment(newShipment)
        if (newWeapons.length > 0) repo.bulkInsertWeapons(newWeapons)
        for (const a of newAccessories) repo.insertAccessory(a)
        for (const a of newAmmunition) repo.insertAmmunition(a)
        repo.insertAuditLog({
          id: generateId("LOG", "audit_logs"), timestamp: new Date().toISOString(), date: today,
          userId: currentUser.id, actionType: "Shipment",
          description: `Shipment ${input.shipment.shipmentNumber} created with ${lineItems.length} line items — ${totalItems} total items`,
          metadata: JSON.stringify({ shipmentId, lineItems: lineItems.length, weapons: newWeapons.length, batchId }),
        })
        repo.insertNotification({
          id: generateId("NTF", "app_notifications"), type: "System",
          title: "Shipment Arrived", message: `Shipment ${input.shipment.shipmentNumber} arrived with ${totalItems} items`,
          date: today, read: false, entityId: shipmentId,
        })
        return ok({ shipmentId })
      })
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("shipment:update", (_, shipment: Shipment): IpcResult => {
    try { repo.updateShipment(shipment); return ok() } catch (e) { return fail(String(e)) }
  })

  // ===== Invoices & Payments =====
  ipcMain.handle("invoice:update", (_, invoice: Invoice): IpcResult => {
    try { repo.updateInvoice(invoice); return ok() } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("invoice:void", (_, invoiceId: string, currentUser: { id: string; name: string }): IpcResult => {
    try {
      const db = getDb()
      db.transaction(() => {
        const all = repo.getAll()
        const invoice = all.invoices.find((i) => i.id === invoiceId)
        if (!invoice) throw new Error("Invoice not found")
        if (!currentUser) throw new Error("User not found")
        repo.updateInvoice({ ...invoice, voided: true, status: "Void" })
        repo.insertAuditLog({
          id: generateId("LOG", "audit_logs"), timestamp: new Date().toISOString(),
          date: new Date().toISOString().split("T")[0], userId: currentUser.id, actionType: "Void",
          description: `Invoice ${invoice.invoiceNumber} voided. All history preserved.`,
          metadata: JSON.stringify({ invoiceId, originalBalance: invoice.balance }),
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
          metadata: JSON.stringify({ invoiceId: input.invoiceId, oldDate, newDate: input.newDueDate, reason: input.reason }),
        })
      })
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("payment:register", (_, input: PaymentInput, currentUser: { id: string; name: string }): IpcResult<{ newBalance: number }> => {
    try {
      const db = getDb()
      return db.transaction(() => {
        const all = repo.getAll()
        const invoice = all.invoices.find((i) => i.id === input.invoiceId)
        if (!invoice) return fail("Invoice not found")
        if (invoice.voided) return fail("Cannot pay a voided invoice")
        if (input.amount > invoice.balance) return fail("Amount paid cannot exceed the remaining balance")
        const newBalance = invoice.balance - input.amount
        let newStatus: Invoice["status"] = "Pending"
        if (newBalance <= 0) newStatus = "Paid"
        else if (new Date(invoice.dueDate) < new Date()) newStatus = "Overdue"
        const newPayment: PaymentRecord = {
          id: generateId("PAY", "payment_records"), invoiceId: input.invoiceId, invoiceNumber: invoice.invoiceNumber,
          date: new Date().toISOString().split("T")[0], amount: input.amount, method: input.method,
          employee: currentUser.name, notes: input.notes,
        }
        repo.insertPayment(newPayment)
        repo.updateInvoice({ ...invoice, totalPaid: invoice.totalPaid + input.amount, balance: newBalance, status: newStatus })
        repo.insertAuditLog({
          id: generateId("LOG", "audit_logs"), timestamp: new Date().toISOString(),
          date: new Date().toISOString().split("T")[0], userId: currentUser.id, actionType: "Payment",
          description: `Payment of ${input.amount} registered for ${invoice.invoiceNumber} via ${input.method}. Balance: ${newBalance}`,
          metadata: JSON.stringify({ invoiceId: input.invoiceId, amount: input.amount, newBalance }),
        })
        if (newBalance <= 0) {
          repo.insertNotification({
            id: generateId("NTF", "app_notifications"), type: "System",
            title: "Debt Fully Settled", message: `Invoice ${invoice.invoiceNumber} has been fully paid`,
            date: new Date().toISOString().split("T")[0], read: false, entityId: invoice.id,
          })
        }
        return ok({ newBalance })
      })
    } catch (e) { return fail(String(e)) }
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
  ipcMain.handle("accessory:insert", (_, accessory: Accessory): IpcResult => {
    try { repo.insertAccessory(accessory); return ok() } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("accessory:update", (_, accessory: Accessory): IpcResult => {
    try { repo.updateAccessory(accessory); return ok() } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("ammunition:insert", (_, ammo: Ammunition): IpcResult => {
    try { repo.insertAmmunition(ammo); return ok() } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("ammunition:update", (_, ammo: Ammunition): IpcResult => {
    try { repo.updateAmmunition(ammo); return ok() } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("inventory:addStock", (_, input: AddStockInput, currentUser: { id: string; name: string }): IpcResult => {
    try {
      const db = getDb()
      db.transaction(() => {
        const all = repo.getAll()
        if (input.itemType === "accessory") {
          const item = all.accessories.find((a) => a.id === input.itemId)
          if (!item) throw new Error("Accessory not found")
          repo.updateAccessory({
            ...item, quantity: item.quantity + input.quantity,
            location: input.location ?? item.location,
          })
        } else {
          const item = all.ammunition.find((a) => a.id === input.itemId)
          if (!item) throw new Error("Ammunition not found")
          const newPackages = Math.floor(input.quantity / item.unitsPerPackage)
          const newLoose = input.quantity % item.unitsPerPackage
          repo.updateAmmunition({
            ...item, fullPackages: item.fullPackages + newPackages, looseRounds: item.looseRounds + newLoose,
            location: input.location ?? item.location,
          })
        }
        repo.insertAuditLog({
          id: generateId("LOG", "audit_logs"), timestamp: new Date().toISOString(),
          date: new Date().toISOString().split("T")[0], userId: currentUser.id, actionType: "StockAdjustment",
          description: `Stock added: ${input.quantity} units to ${input.itemId} (${input.itemType})`,
          metadata: JSON.stringify(input),
        })
      })
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("inventory:receiveAmmoByPackages", (_, input: ReceiveAmmoByPackagesInput, currentUser: { id: string; name: string }): IpcResult => {
    try {
      const db = getDb()
      db.transaction(() => {
        const all = repo.getAll()
        const item = all.ammunition.find((a) => a.id === input.itemId)
        if (!item) throw new Error("Ammunition not found")
        if (input.numberOfPackages <= 0) throw new Error("Number of packages must be greater than 0")
        if (input.unitsPerPackage <= 0) throw new Error("Units per package must be greater than 0")
        const totalRounds = input.numberOfPackages * input.unitsPerPackage
        if (input.unitsPerPackage === item.unitsPerPackage) {
          repo.updateAmmunition({ ...item, fullPackages: item.fullPackages + input.numberOfPackages, location: input.location ?? item.location })
        } else {
          const allRounds = ammoTotalRounds(item) + totalRounds
          repo.updateAmmunition({
            ...item, unitsPerPackage: input.unitsPerPackage,
            fullPackages: Math.floor(allRounds / input.unitsPerPackage), looseRounds: allRounds % input.unitsPerPackage,
            location: input.location ?? item.location,
          })
        }
        repo.insertAuditLog({
          id: generateId("LOG", "audit_logs"), timestamp: new Date().toISOString(),
          date: new Date().toISOString().split("T")[0], userId: currentUser.id, actionType: "StockAdjustment",
          description: `Ammo received: ${input.numberOfPackages} packages x ${input.unitsPerPackage} = ${totalRounds} rounds (${item.caliber})`,
          metadata: JSON.stringify({ ...input, totalRounds }),
        })
      })
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("inventory:receiveAmmoByRounds", (_, input: ReceiveAmmoByRoundsInput, currentUser: { id: string; name: string }): IpcResult => {
    try {
      const db = getDb()
      db.transaction(() => {
        const all = repo.getAll()
        const item = all.ammunition.find((a) => a.id === input.itemId)
        if (!item) throw new Error("Ammunition not found")
        if (input.totalRounds <= 0) throw new Error("Total rounds must be greater than 0")
        const allRounds = ammoTotalRounds(item) + input.totalRounds
        repo.updateAmmunition({
          ...item, fullPackages: Math.floor(allRounds / item.unitsPerPackage), looseRounds: allRounds % item.unitsPerPackage,
          location: input.location ?? item.location,
        })
        repo.insertAuditLog({
          id: generateId("LOG", "audit_logs"), timestamp: new Date().toISOString(),
          date: new Date().toISOString().split("T")[0], userId: currentUser.id, actionType: "StockAdjustment",
          description: `Ammo received: ${input.totalRounds} loose rounds (${item.caliber})`,
          metadata: JSON.stringify(input),
        })
      })
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("inventory:sellAmmo", (_, input: SellAmmoInput): IpcResult => {
    try {
      const db = getDb()
      db.transaction(() => {
        const all = repo.getAll()
        const item = all.ammunition.find((a) => a.id === input.itemId)
        if (!item) throw new Error("Ammunition not found")
        if (input.rounds <= 0) throw new Error("Rounds to sell must be greater than 0")
        const currentTotal = ammoTotalRounds(item)
        if (input.rounds > currentTotal) throw new Error(`Insufficient stock: only ${currentTotal} rounds available`)
        const remaining = currentTotal - input.rounds
        repo.updateAmmunition({
          ...item, fullPackages: Math.floor(remaining / item.unitsPerPackage), looseRounds: remaining % item.unitsPerPackage,
        })
      })
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("inventory:updateAmmoPackage", (_, input: UpdateAmmoPackageInput, currentUser: { id: string; name: string }): IpcResult => {
    try {
      const db = getDb()
      db.transaction(() => {
        const all = repo.getAll()
        const item = all.ammunition.find((a) => a.id === input.itemId)
        if (!item) throw new Error("Ammunition not found")
        if (input.unitsPerPackage <= 0) throw new Error("Units per package must be greater than 0")
        const currentTotal = ammoTotalRounds(item)
        repo.updateAmmunition({
          ...item, packageType: input.packageType, unitsPerPackage: input.unitsPerPackage,
          fullPackages: Math.floor(currentTotal / input.unitsPerPackage), looseRounds: currentTotal % input.unitsPerPackage,
        })
        repo.insertAuditLog({
          id: generateId("LOG", "audit_logs"), timestamp: new Date().toISOString(),
          date: new Date().toISOString().split("T")[0], userId: currentUser.id, actionType: "Update",
          description: `Package settings updated for ${item.caliber}: ${input.packageType} x ${input.unitsPerPackage} rounds`,
          metadata: JSON.stringify(input),
        })
      })
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
  ipcMain.handle("currency:updateRate", (_, code: string, rate: number, updatedAt: string): IpcResult => {
    try { repo.updateCurrencyRate(code, rate, updatedAt); return ok() } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("currency:recordRateHistory", (_, code: string, rate: number, source: string): IpcResult => {
    try { repo.recordRateHistory(code, rate, source); return ok() } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("currency:setManualOverride", (_, code: string, rate: number, changedBy: string, reason: string, updatedAt: string): IpcResult => {
    try {
      const db = getDb()
      db.transaction(() => {
        const all = repo.getAll()
        const currentRate = all.settings.preferredDisplayCurrency ? null : null
        repo.setManualOverride(code, rate, changedBy, reason, updatedAt)
        repo.recordRateAuditLog(code, currentRate, rate, changedBy, reason, updatedAt)
      })
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("currency:setAutomatic", (_, code: string, changedBy: string, updatedAt: string): IpcResult => {
    try { repo.setAutomaticMode(code, changedBy, updatedAt); return ok() } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("currency:add", (_, isoCode: string, name: string, symbol: string, decimalPrecision: number, initialRate: number): IpcResult => {
    try { repo.addCurrency(isoCode, name, symbol, decimalPrecision, initialRate); return ok() } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("currency:toggleActive", (_, code: string, isActive: boolean): IpcResult => {
    try { repo.toggleCurrencyActive(code, isActive); return ok() } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("currency:recordRateAuditLog", (_, code: string, oldRate: number | null, newRate: number | null, changedBy: string, reason: string, changedAt: string): IpcResult => {
    try { repo.recordRateAuditLog(code, oldRate, newRate, changedBy, reason, changedAt); return ok() } catch (e) { return fail(String(e)) }
  })

  // ===== Demo seeding (manual only, never called during app startup) =====
  ipcMain.handle("db:seedDemoData", (): IpcResult => {
    try {
      const db = getDb()
      db.transaction(() => {
        const mock = generateMockData()
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
      })
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  ipcMain.handle("db:resetBusinessData", (): IpcResult => {
    try {
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
      return ok()
    } catch (e) { return fail(String(e)) }
  })

  // ===== Master Data CRUD =====
  ipcMain.handle("masterData:insertWeaponType", (_e, label: string, sortOrder: number): IpcResult<string> => {
    try { return ok(repo.insertMasterWeaponType(label, sortOrder)) } catch (e) { return fail(String(e)) }
  })
  ipcMain.handle("masterData:insertWeaponSubtype", (_e, weaponTypeId: string, label: string, sortOrder: number): IpcResult<string> => {
    try { return ok(repo.insertMasterWeaponSubtype(weaponTypeId, label, sortOrder)) } catch (e) { return fail(String(e)) }
  })
  ipcMain.handle("masterData:insertCaliber", (_e, label: string): IpcResult<string> => {
    try { return ok(repo.insertMasterCaliber(label)) } catch (e) { return fail(String(e)) }
  })
  ipcMain.handle("masterData:linkSubtypeCaliber", (_e, subtypeId: string, caliberId: string): IpcResult => {
    try { repo.linkSubtypeCaliber(subtypeId, caliberId); return ok() } catch (e) { return fail(String(e)) }
  })
  ipcMain.handle("masterData:insertBrand", (_e, label: string): IpcResult<string> => {
    try { return ok(repo.insertMasterBrand(label)) } catch (e) { return fail(String(e)) }
  })
  ipcMain.handle("masterData:insertModel", (_e, label: string, brandId: string | null): IpcResult<string> => {
    try { return ok(repo.insertMasterModel(label, brandId)) } catch (e) { return fail(String(e)) }
  })
  ipcMain.handle("masterData:insertWarehouse", (_e, label: string): IpcResult<string> => {
    try { return ok(repo.insertMasterWarehouse(label)) } catch (e) { return fail(String(e)) }
  })
  ipcMain.handle("masterData:insertStorageLocation", (_e, warehouseId: string, shelf: string, bin: string): IpcResult<string> => {
    try { return ok(repo.insertMasterStorageLocation(warehouseId, shelf, bin)) } catch (e) { return fail(String(e)) }
  })
  ipcMain.handle("masterData:deleteRow", (_e, table: string, id: string): IpcResult => {
    try { repo.deleteMasterRow(table, id); return ok() } catch (e) { return fail(String(e)) }
  }
}
