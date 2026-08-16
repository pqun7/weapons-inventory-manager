import { getDb } from "../database.js"
import { repo } from "../repositories/index.js"
import { backendCurrencyService } from "./currency-service.js"
import { finalizeStandaloneInventoryCost } from "./product-cost-service.js"
import type { Accessory, Ammunition, Customer, Invoice, PaymentRecord, Shipment, Supplier } from "../../src/lib/types.js"

const PREFIX = "DEMO-"

// Older SQLite installations were populated by src/lib/mock-data.ts before
// demo records received the dedicated DEMO- namespace. Keep the exact ID
// ranges here so those installations can be cleaned without treating later
// user-created records as demonstration data.
const LEGACY_DEMO_IDS = {
  weapons: Array.from({ length: 140 }, (_, index) => `W${String(index + 1).padStart(5, "0")}`),
  invoices: Array.from({ length: 65 }, (_, index) => `INV${String(index + 1).padStart(5, "0")}`),
  payments: Array.from({ length: 55 }, (_, index) => `PAY${String(index + 1).padStart(5, "0")}`),
  shipments: Array.from({ length: 12 }, (_, index) => `SHP${String(index + 1).padStart(4, "0")}`),
  accessories: Array.from({ length: 6 }, (_, index) => `ACC${String(index + 1).padStart(3, "0")}`),
  ammunition: Array.from({ length: 7 }, (_, index) => `AMM${String(index + 1).padStart(3, "0")}`),
  customers: [
    ...Array.from({ length: 15 }, (_, index) => `CUST${String(index + 1).padStart(4, "0")}`),
    ...Array.from({ length: 4 }, (_, index) => `WB${String(index + 1).padStart(3, "0")}`),
  ],
  suppliers: Array.from({ length: 8 }, (_, index) => `SUP${String(index + 1).padStart(3, "0")}`),
} as const

function dateOffset(days: number): string {
  const value = new Date()
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function placeholders(values: readonly string[]): string {
  return values.map(() => "?").join(",")
}

function hasLegacyDemoFingerprint(): boolean {
  const db = getDb()
  const row = db.prepare(`
    SELECT
      EXISTS(SELECT 1 FROM suppliers WHERE id = 'SUP001' AND name = 'Global Arms Distributors') AS supplier_match,
      EXISTS(SELECT 1 FROM accessories WHERE id = 'ACC001' AND name = 'Pistol Case') AS accessory_match,
      EXISTS(SELECT 1 FROM ammunition WHERE id = 'AMM001' AND caliber = '9x19') AS ammunition_match
  `).get() as { supplier_match: number; accessory_match: number; ammunition_match: number }
  return Number(row.supplier_match) + Number(row.accessory_match) + Number(row.ammunition_match) === 3
}

function deleteLegacyDemoRows(): void {
  const db = getDb()
  const ids = LEGACY_DEMO_IDS
  const productIds = [...ids.weapons, ...ids.accessories, ...ids.ammunition]
  const notificationEntityIds = [...productIds, ...ids.invoices, ...ids.shipments, ...ids.customers, ...ids.suppliers]

  db.prepare(`DELETE FROM sale_operations WHERE invoice_id IN (${placeholders(ids.invoices)})`).run(...ids.invoices)
  db.prepare(`DELETE FROM payment_records WHERE id IN (${placeholders(ids.payments)}) OR invoice_id IN (${placeholders(ids.invoices)})`).run(...ids.payments, ...ids.invoices)
  db.prepare(`DELETE FROM audit_logs WHERE
    (id GLOB 'LOG[0-9]*' AND description = 'Admin User logged into the system') OR
    (id GLOB 'LOG[0-9]*' AND CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.invoiceId') END IN (${placeholders(ids.invoices)}))
  `).run(...ids.invoices)
  db.prepare(`DELETE FROM app_notifications WHERE id GLOB 'NTF[0-9]*' AND
    (entity_id IN (${placeholders(notificationEntityIds)}) OR (type = 'BackupOmission' AND title = 'Backup Reminder'))
  `).run(...notificationEntityIds)
  db.prepare(`DELETE FROM invoices WHERE id IN (${placeholders(ids.invoices)})`).run(...ids.invoices)
  db.prepare(`DELETE FROM inventory_transactions WHERE item_id IN (${placeholders(productIds)})`).run(...productIds)
  db.prepare(`DELETE FROM stock_operations WHERE item_id IN (${placeholders([...ids.accessories, ...ids.ammunition])})`).run(...ids.accessories, ...ids.ammunition)
  db.prepare(`DELETE FROM product_costs WHERE product_id IN (${placeholders(productIds)})`).run(...productIds)
  db.prepare(`DELETE FROM inventory_cost_snapshots WHERE product_id IN (${placeholders(productIds)})`).run(...productIds)
  db.prepare(`DELETE FROM ammunition_weapon_compatibility WHERE ammunition_id IN (${placeholders(ids.ammunition)}) OR weapon_id IN (${placeholders(ids.weapons)})`).run(...ids.ammunition, ...ids.weapons)
  db.prepare(`DELETE FROM accessory_weapon_compatibility WHERE accessory_id IN (${placeholders(ids.accessories)}) OR weapon_id IN (${placeholders(ids.weapons)})`).run(...ids.accessories, ...ids.weapons)
  db.prepare(`DELETE FROM weapons WHERE id IN (${placeholders(ids.weapons)})`).run(...ids.weapons)
  db.prepare(`DELETE FROM shipments WHERE id IN (${placeholders(ids.shipments)})`).run(...ids.shipments)
  db.prepare(`DELETE FROM accessories WHERE id IN (${placeholders(ids.accessories)})`).run(...ids.accessories)
  db.prepare(`DELETE FROM ammunition WHERE id IN (${placeholders(ids.ammunition)})`).run(...ids.ammunition)
  db.prepare(`DELETE FROM customers WHERE id IN (${placeholders(ids.customers)})`).run(...ids.customers)
  db.prepare(`DELETE FROM suppliers WHERE id IN (${placeholders(ids.suppliers)})`).run(...ids.suppliers)
}

function countRemainingNamespacedDemoRows(): number {
  const db = getDb()
  const row = db.prepare(`SELECT
    (SELECT count(*) FROM invoices WHERE id LIKE 'DEMO-%') +
    (SELECT count(*) FROM shipments WHERE id LIKE 'DEMO-%') +
    (SELECT count(*) FROM accessories WHERE id LIKE 'DEMO-%') +
    (SELECT count(*) FROM ammunition WHERE id LIKE 'DEMO-%') +
    (SELECT count(*) FROM customers WHERE id LIKE 'DEMO-%') +
    (SELECT count(*) FROM suppliers WHERE id LIKE 'DEMO-%') AS count
  `).get() as { count: number }
  return Number(row.count)
}

function deleteDemoRows(): void {
  const db = getDb()
  const legacyDemoDetected = hasLegacyDemoFingerprint()
  db.prepare("DELETE FROM sale_operations WHERE invoice_id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM payment_records WHERE id LIKE 'DEMO-%' OR invoice_id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM invoices WHERE id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM inventory_transactions WHERE id LIKE 'DEMO-%' OR item_id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM stock_operations WHERE item_id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM product_costs WHERE product_id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM inventory_cost_snapshots WHERE product_id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM shipment_items WHERE shipment_id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM shipments WHERE id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM accessories WHERE id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM ammunition WHERE id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM customers WHERE id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM suppliers WHERE id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM audit_logs WHERE id LIKE 'DEMO-%'").run()
  db.prepare("DELETE FROM app_notifications WHERE id LIKE 'DEMO-%'").run()
  if (legacyDemoDetected) deleteLegacyDemoRows()

  const settingsUpdate = db.prepare("UPDATE system_settings SET show_demo_data = 0 WHERE id = 1").run()
  if (settingsUpdate.changes !== 1 || countRemainingNamespacedDemoRows() !== 0 || (legacyDemoDetected && hasLegacyDemoFingerprint())) {
    throw new Error("Demonstration data deletion could not be verified")
  }
}

export function deleteDemoData(): void {
  getDb().transaction(deleteDemoRows)()
}

export function resetDemoData(userId: string): void {
  const db = getDb()
  db.transaction(() => {
    deleteDemoRows()
    const today = dateOffset(0)
    const currency = backendCurrencyService.getDefaultTransactionCurrency()
    const snapshot = backendCurrencyService.getRateSnapshot(currency)
    const valuation = (amount: number) => backendCurrencyService.createValuationFromSnapshot(amount, snapshot)

    const supplier: Supplier = { id: `${PREFIX}SUPPLIER`, name: "Northstar Sporting Supply LLC", contactPerson: "Demo Account", phone: "+1 555 0100", email: "demo-supplier@example.test", address: "Demo Industrial District", dateAdded: today }
    const customer: Customer = { id: `${PREFIX}CUSTOMER`, name: "Demo Retail Customer", phone: "+1 555 0120", email: "demo-customer@example.test", address: "Demo City", isWholesaleBuyer: false, wholesaleDiscountPercent: 0, dateAdded: today }
    repo.insertSupplier(supplier)
    repo.insertCustomer(customer)

    const accessory: Accessory = {
      id: `${PREFIX}ACCESSORY`, name: "Demo Protective Case", type: "Case", quantity: 15,
      safetyThreshold: 5, price: 6, priceCurrency: currency, priceValuation: valuation(6),
      retailPrice: 10, wholesalePrice: 8, retailPriceValuation: valuation(10), wholesalePriceValuation: valuation(8),
      retailPriceMode: "manual", wholesalePriceMode: "manual", dateAdded: dateOffset(-45),
      location: { warehouse: "Main", shelf: "A", bin: "A-1" },
    }
    const ammunition: Ammunition = {
      id: `${PREFIX}AMMUNITION`, name: "Demo 9mm Training Ammunition", caliber: "9x19", packageType: "Box",
      unitsPerPackage: 50, fullPackages: 8, looseRounds: 20, safetyThreshold: 100,
      price: 0.3, priceCurrency: currency, priceValuation: valuation(0.3), retailPrice: 0.5, wholesalePrice: 0.4,
      retailPriceValuation: valuation(0.5), wholesalePriceValuation: valuation(0.4), retailPriceMode: "manual",
      wholesalePriceMode: "manual", dateAdded: dateOffset(-60), location: { warehouse: "Main", shelf: "B", bin: "B-1" },
    }
    repo.insertAccessory(accessory)
    repo.insertAmmunition(ammunition)
    finalizeStandaloneInventoryCost("accessory", accessory.id, accessory.price, snapshot, [], userId)
    finalizeStandaloneInventoryCost("ammunition", ammunition.id, ammunition.price, snapshot, [], userId)

    const shipment: Shipment = {
      id: `${PREFIX}SHIPMENT`, shipmentNumber: `DEMO-SHP-${today.replace(/-/g, "")}`, supplierId: supplier.id,
      shipmentDate: dateOffset(-2), expectedArrivalDate: dateOffset(5), totalExpectedItems: 50,
      attachments: [], notes: "Removable demonstration shipment", status: "In Transit", timeline: [],
      currency, lineItems: [], documents: [], workflowStatus: "scheduled", plannedCosts: [], createdAt: new Date().toISOString(),
      totalCostValuation: valuation(120),
    }
    repo.insertShipment(shipment)

    const subtotal = 50
    const tax = Number((subtotal * repo.getSettings().taxPercent / 100).toFixed(snapshot.transactionPrecision))
    const total = subtotal + tax
    const invoice: Invoice = {
      id: `${PREFIX}INVOICE`, invoiceNumber: `DEMO-INV-${today.replace(/-/g, "")}`, type: "Sale",
      customerId: customer.id, supplierId: null, customerName: customer.name, date: today, dueDate: today,
      totalOriginal: subtotal, totalNegotiated: subtotal, totalPaid: total, balance: 0, status: "Paid",
      weaponIds: [], lineItems: [{ itemType: "accessory", itemId: accessory.id, name: accessory.name, quantity: 5, unitPrice: 10, total: 50, unitLandedCostAccounting: valuation(6).accountingAmount, costAccountingCurrency: snapshot.accountingCurrency, costSnapshotFinalizedAt: new Date().toISOString() }],
      saleMode: "Retail", employeeId: userId, employeeName: "Demo", attachments: [], shipmentId: null,
      notes: "Removable demonstration sale", voided: false, taxAmount: tax, currency,
      accountingCurrency: snapshot.accountingCurrency, exchangeRate: snapshot.exchangeRate,
      exchangeRateDate: snapshot.exchangeRateDate, rateSource: snapshot.rateSource,
      totalOriginalAccounting: valuation(subtotal).accountingAmount, totalNegotiatedAccounting: valuation(subtotal).accountingAmount,
      totalPaidAccounting: valuation(total).accountingAmount, balanceAccounting: 0, taxAmountAccounting: valuation(tax).accountingAmount,
      totalValuation: valuation(total),
    }
    repo.insertInvoice(invoice)
    const paidValuation = valuation(total)
    const payment: PaymentRecord = {
      id: `${PREFIX}PAYMENT`, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, date: today, amount: total,
      currency, accountingAmount: paidValuation.accountingAmount, accountingCurrency: paidValuation.accountingCurrency,
      exchangeRate: paidValuation.exchangeRate, exchangeRateDate: paidValuation.exchangeRateDate, rateSource: paidValuation.rateSource,
      method: "cash", employee: "Demo", notes: "Removable demonstration payment",
    }
    repo.insertPayment(payment)
    repo.insertAuditLog({ id: `${PREFIX}AUDIT`, timestamp: new Date().toISOString(), date: today, userId, actionType: "Import", description: "Demonstration dataset created", metadata: JSON.stringify({ demo: true }) })
    repo.insertNotification({ id: `${PREFIX}NOTIFICATION`, type: "System", title: "Demo data enabled", message: "This sample dataset can be reset or removed in Settings.", date: today, read: false, entityId: null })
    db.prepare("UPDATE system_settings SET show_demo_data = 1 WHERE id = 1").run()
  })()
}

export function ensureDemoData(userId: string): void {
  const db = getDb()
  const enabled = Number((db.prepare("SELECT show_demo_data FROM system_settings WHERE id = 1").get() as { show_demo_data: number }).show_demo_data) === 1
  const businessRows = Number((db.prepare("SELECT (SELECT count(*) FROM invoices) + (SELECT count(*) FROM accessories) + (SELECT count(*) FROM ammunition) AS count").get() as { count: number }).count)
  if (enabled && businessRows === 0) resetDemoData(userId)
}
