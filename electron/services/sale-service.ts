import { getDb } from "../database.js"
import { repo } from "../repositories/index.js"
import { CurrencyService } from "../../src/lib/currency-service.js"
import type { SaleInput } from "../../src/lib/store.js"
import type { Invoice, PaymentRecord, Weapon, InvoiceStatus, AppNotification, AuditLog } from "../../src/lib/types.js"

interface SaleResult {
  success: boolean
  invoiceId?: string
  invoiceNumber?: string
  error?: string
}

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

export function completeSale(input: SaleInput, currentUser: { id: string; name: string }): SaleResult {
  const db = getDb()

  return db.transaction(() => {
    const all = repo.getAll()
    const weaponsToSell = input.weaponIds
      .map((id) => all.weapons.find((w) => w.id === id))
      .filter((w): w is Weapon => w !== undefined)

    if (weaponsToSell.length === 0 && input.lineItems.length === 0)
      return { success: false, error: "No items selected" }

    const unavailable = weaponsToSell.find((w) => w.status === "Sold")
    if (unavailable) return { success: false, error: `Weapon ${unavailable.serialNumber} is already sold` }

    const invoiceId = generateId("INV", "invoices")
    const perWeaponFinal = weaponsToSell.length > 0 ? input.totalNegotiated / weaponsToSell.length : 0
    const paid = input.paidAmount ?? 0
    const balance = input.balance ?? (input.totalNegotiated - paid)
    const actualBalance = Math.max(0, balance)
    const today = new Date().toISOString().split("T")[0]
    const saleCurrency = input.currency || "USD"
    const totalValuation = CurrencyService.createValuation(input.totalNegotiated, saleCurrency)

    let status: InvoiceStatus = "Pending"
    if (actualBalance <= 0) status = "Paid"
    else if (new Date(input.dueDate) < new Date()) status = "Overdue"

    const newPayments: PaymentRecord[] = []
    if (paid > 0) {
      newPayments.push({
        id: generateId("PAY", "payment_records"),
        invoiceId,
        invoiceNumber: input.invoiceNumber,
        date: today,
        amount: paid,
        method: input.paymentMethod ?? "Cash",
        employee: currentUser.name,
        notes: input.notes || "Partial payment at sale",
      })
    }

    const updatedWeapons = all.weapons.map((w) =>
      input.weaponIds.includes(w.id)
        ? {
          ...w,
          status: "Sold" as const,
          actualFinalPrice: Math.round(perWeaponFinal),
          movementHistory: [...w.movementHistory, {
            id: `MV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: new Date().toISOString(),
            fromStatus: w.status,
            toStatus: "Sold" as const,
            userId: currentUser.id,
            userName: currentUser.name,
            reason: `Sold via invoice ${input.invoiceNumber}`,
          }],
        }
        : w
    )

    for (const w of updatedWeapons) {
      if (input.weaponIds.includes(w.id)) repo.updateWeapon(w)
    }

    const newInvoice: Invoice = {
      id: invoiceId,
      invoiceNumber: input.invoiceNumber,
      type: "Sale",
      customerId: input.customerId,
      supplierId: null,
      customerName: input.customerName,
      date: input.date ?? today,
      dueDate: input.dueDate,
      totalOriginal: input.totalOriginal,
      totalNegotiated: input.totalNegotiated,
      totalPaid: paid,
      balance: actualBalance,
      status,
      weaponIds: input.weaponIds,
      lineItems: input.lineItems,
      saleMode: input.mode,
      employeeId: currentUser.id,
      employeeName: currentUser.name,
      attachments: input.attachments,
      shipmentId: null,
      notes: input.notes,
      voided: false,
      taxAmount: input.taxAmount,
      totalValuation,
    }
    repo.insertInvoice(newInvoice)

    for (const p of newPayments) {
      repo.insertPayment(p)
    }

    const auditLog: AuditLog = {
      id: generateId("LOG", "audit_logs"),
      timestamp: new Date().toISOString(),
      date: today,
      userId: currentUser.id,
      actionType: "Sale",
      description: `Sale completed — Invoice ${input.invoiceNumber} — ${input.customerName} — ${weaponsToSell.length + input.lineItems.length} item(s) — Total: ${input.totalNegotiated} — Paid: ${paid}`,
      metadata: JSON.stringify({ invoiceId, weaponIds: input.weaponIds, total: input.totalNegotiated, paid, balance: actualBalance }),
    }
    repo.insertAuditLog(auditLog)

    const notif: AppNotification = {
      id: generateId("NTF", "app_notifications"),
      type: "System",
      title: "New Sale Recorded",
      message: `Invoice ${input.invoiceNumber} created for ${input.customerName}`,
      date: today,
      read: false,
      entityId: invoiceId,
    }
    repo.insertNotification(notif)

    return { success: true, invoiceId, invoiceNumber: input.invoiceNumber }
  })() as SaleResult
}
