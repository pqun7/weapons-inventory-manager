import { getDb } from "../database.js"
import { createHash } from "node:crypto"
import { repo } from "../repositories/index.js"
import { backendCurrencyService } from "./currency-service.js"
import { authoritativeListPrice, decimalToNumber, moneyEquals, nonNegativeMoney, positiveMoney, sumMoney } from "./money.js"
import { ammoTotalRounds } from "../../src/lib/types.js"
import type { SaleInput } from "../../src/lib/store-inputs.js"
import type {
  Invoice,
  PaymentRecord,
  Weapon,
  Ammunition,
  Accessory,
  InvoiceStatus,
  AppNotification,
  AuditLog,
  Customer,
} from "../../src/lib/types.js"

export interface SaleResult {
  success: boolean
  invoiceId?: string
  invoiceNumber?: string
  error?: string
}

function pad(num: number, size: number): string {
  return String(num).padStart(size, "0")
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
    const numericPart = Number.parseInt(
      row.id.slice(prefix.length),
      10,
    )

    if (
      Number.isFinite(numericPart) &&
      numericPart > maxNumber
    ) {
      maxNumber = numericPart
    }
  }

  let next = maxNumber + 1
  let candidate = `${prefix}${pad(next, 5)}`

  while (
    db
      .prepare(`
        SELECT 1
        FROM ${table}
        WHERE id = ?
        LIMIT 1
      `)
      .get(candidate)
  ) {
    next += 1
    candidate = `${prefix}${pad(next, 5)}`
  }

  return candidate
}

function normalizePaymentMethod(
  method: SaleInput["paymentMethod"] | undefined,
): PaymentRecord["method"] {
  switch (method) {
    case "cash":
      return "cash"

    case "card":
      return "card"

    case "bank_transfer":
      return "bank_transfer"

    case "check":
      return "check"

    case "other":
      return "other"

    default:
      return "cash"
  }
}

function isPastDue(date: string): boolean {
  if (!date) return false
  const due = new Date(`${date}T23:59:59`)
  return !Number.isNaN(due.getTime()) && due.getTime() < Date.now()
}

function normalizedEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en")
}

function normalizedPhone(value: string): string {
  return value.replace(/[^0-9]/g, "")
}

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en")
}

function saleRequestHash(input: SaleInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex")
}

function findDuplicateCustomer(customers: Customer[], draft: NonNullable<SaleInput["newCustomer"]>): Customer | undefined {
  const email = normalizedEmail(draft.email)
  const phone = normalizedPhone(draft.phone)
  const name = normalizedName(draft.name)
  return customers.find((customer) => {
    if (email && normalizedEmail(customer.email) === email) return true
    if (phone && normalizedPhone(customer.phone) === phone) return true
    return !email && !phone && normalizedName(customer.name) === name
  })
}

/**
 * Single authoritative sale transaction.
 *
 * Everything that changes stock or creates the invoice is executed inside one
 * SQLite transaction. The renderer never performs a second stock mutation.
 */
export function completeSale(
  input: SaleInput,
  currentUser: { id: string; name: string },
): SaleResult {
  const db = getDb()

  try {
    return db.transaction((): SaleResult => {
      const all = repo.getAll()
      const today = new Date().toISOString().slice(0, 10)
      const invoiceNumber = input.invoiceNumber?.trim()
      const operationId = input.operationId?.trim()
      if (!operationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
        return { success: false, error: "A valid sale operation ID is required" }
      }
      const requestHash = saleRequestHash(input)
      const completed = db.prepare("SELECT request_hash, invoice_id, invoice_number FROM sale_operations WHERE operation_id = ?")
        .get(operationId) as { request_hash: string; invoice_id: string; invoice_number: string } | undefined
      if (completed) {
        if (completed.request_hash !== requestHash) return { success: false, error: "This sale operation ID was already used for a different request" }
        return { success: true, invoiceId: completed.invoice_id, invoiceNumber: completed.invoice_number }
      }

      if (!currentUser?.id || !currentUser.name?.trim()) {
        return { success: false, error: "A valid current user is required" }
      }
      if (!invoiceNumber) {
        return { success: false, error: "Invoice number is required" }
      }
      if (!input.customerId && !input.newCustomer) return { success: false, error: "Customer is required" }
      if (input.newCustomer && !input.newCustomer.name.trim()) return { success: false, error: "Customer name is required" }
      if (input.weaponIds.length === 0 && input.lineItems.length === 0) {
        return { success: false, error: "Select at least one weapon or item" }
      }
      if (!Number.isFinite(input.totalNegotiated) || input.totalNegotiated <= 0) {
        return { success: false, error: "Negotiated total must be greater than 0" }
      }
      if (!Number.isFinite(input.totalOriginal) || input.totalOriginal < 0) {
        return { success: false, error: "Invalid original total" }
      }
      if (!Number.isFinite(input.taxAmount) || input.taxAmount < 0) {
        return { success: false, error: "Invalid tax amount" }
      }
      if (all.invoices.some((invoice) => invoice.invoiceNumber === invoiceNumber && !invoice.voided)) {
        return { success: false, error: "Invoice number already exists" }
      }

      const uniqueWeaponIds = [...new Set(input.weaponIds)]
      if (uniqueWeaponIds.length !== input.weaponIds.length) {
        return { success: false, error: "Duplicate weapon selected" }
      }

      const weaponsById = new Map(all.weapons.map((weapon) => [weapon.id, weapon]))
      const weaponsToSell: Weapon[] = []

      for (const weaponId of uniqueWeaponIds) {
        const weapon = weaponsById.get(weaponId)
        if (!weapon) return { success: false, error: `Weapon ${weaponId} not found` }
        if (weapon.status === "Sold") {
          return { success: false, error: `Weapon ${weapon.serialNumber} is already sold` }
        }
        if (weapon.status === "Reserved") {
          return { success: false, error: `Weapon ${weapon.serialNumber} is reserved` }
        }
        if (weapon.status !== "Available") {
          return { success: false, error: `Weapon ${weapon.serialNumber} is not available for sale` }
        }
        weaponsToSell.push(weapon)
      }

      const lineItems = input.lineItems ?? []
      const lineItemIds = new Set<string>()
      for (const item of lineItems) {
        if (!new Set(["weapon", "accessory", "ammunition"]).has(item.itemType)) {
          return { success: false, error: "Invalid sale line item type" }
        }
        if (!item.itemType || !item.itemId) {
          return { success: false, error: "Invalid sale line item" }
        }
        if (lineItemIds.has(`${item.itemType}:${item.itemId}`)) {
          return { success: false, error: `Duplicate ${item.itemType} line item` }
        }
        lineItemIds.add(`${item.itemType}:${item.itemId}`)
        if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
          return { success: false, error: `Invalid quantity for ${item.name}` }
        }
        if (item.itemType === "weapon" && item.quantity !== 1) {
          return { success: false, error: "Each serialized weapon line must have quantity 1" }
        }
        if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
          return { success: false, error: `Invalid unit price for ${item.name}` }
        }
        if (!Number.isFinite(item.total) || item.total < 0) return { success: false, error: `Invalid line total for ${item.name}` }
      }

      // The weapon IDs and line items must describe the same weapon set.
      const weaponLineIds = lineItems
        .filter((item) => item.itemType === "weapon")
        .map((item) => item.itemId)
      if (new Set(weaponLineIds).size !== uniqueWeaponIds.length ||
        weaponLineIds.some((id) => !weaponsById.has(id)) ||
        uniqueWeaponIds.some((id) => !weaponLineIds.includes(id))) {
        return { success: false, error: "Weapon line items do not match selected weapons" }
      }

      const ammoById = new Map(all.ammunition.map((item) => [item.id, item]))
      const accessoryById = new Map(all.accessories.map((item) => [item.id, item]))
      const ammoUpdates = new Map<string, Ammunition>()
      const accessoryUpdates = new Map<string, Accessory>()

      for (const item of lineItems) {
        if (item.itemType === "ammunition") {
          const ammo = ammoById.get(item.itemId)
          if (!ammo) return { success: false, error: `Ammunition ${item.itemId} not found` }

          const currentRounds = ammoTotalRounds(ammo)
          const soldRounds = item.quantity
          if (soldRounds > currentRounds) {
            return {
              success: false,
              error: `Insufficient stock for ${ammo.caliber}: only ${currentRounds} rounds available`,
            }
          }

          const remaining = currentRounds - soldRounds
          ammoUpdates.set(ammo.id, {
            ...ammo,
            fullPackages: Math.floor(remaining / ammo.unitsPerPackage),
            looseRounds: remaining % ammo.unitsPerPackage,
          })
        }

        if (item.itemType === "accessory") {
          const accessory = accessoryById.get(item.itemId)
          if (!accessory) return { success: false, error: `Accessory ${item.itemId} not found` }
          if (item.quantity > accessory.quantity) {
            return {
              success: false,
              error: `Insufficient stock for ${accessory.name}: only ${accessory.quantity} available`,
            }
          }

          accessoryUpdates.set(accessory.id, {
            ...accessory,
            quantity: accessory.quantity - item.quantity,
          })
        }
      }

      const saleCurrency = input.currency?.trim().toUpperCase() || backendCurrencyService.getDefaultTransactionCurrency()
      const rateSnapshot = backendCurrencyService.getRateSnapshot(saleCurrency)
      const settings = repo.getSettings()
      const productCostExists = db.prepare("SELECT 1 FROM product_costs WHERE product_type = ? AND product_id = ? LIMIT 1")
      const weaponShipmentCostExists = db.prepare(`
        SELECT 1 FROM shipment_costs AS cost
        JOIN weapons AS weapon ON weapon.shipment_id = cost.shipment_id
        WHERE weapon.id = ? LIMIT 1
      `)
      const stockShipmentCostExists = db.prepare(`
        SELECT 1 FROM inventory_transactions AS transaction_row
        JOIN shipment_costs AS cost ON cost.shipment_id = transaction_row.shipment_id
        WHERE transaction_row.item_type = ? AND transaction_row.item_id = ? LIMIT 1
      `)
      const canonicalLineItems = lineItems.map((item) => {
        const unitPrice = nonNegativeMoney(item.unitPrice, `Unit price for ${item.name}`)
          .toDecimalPlaces(rateSnapshot.transactionPrecision)
        const costRow = db.prepare(`
          SELECT final_landed_base_amount, base_currency_code, finalized_at
          FROM inventory_cost_snapshots
          WHERE product_type = ? AND product_id = ?
        `).get(item.itemType, item.itemId) as { final_landed_base_amount: string; base_currency_code: string; finalized_at: string } | undefined
        let unitCost: number | undefined
        let costCurrency: string | undefined
        let costFinalizedAt: string | undefined
        let costSource: "landed-cost-snapshot" | "trusted-base-valuation" | undefined
        if (costRow?.base_currency_code === rateSnapshot.accountingCurrency) {
          unitCost = decimalToNumber(nonNegativeMoney(costRow.final_landed_base_amount))
          costCurrency = costRow.base_currency_code
          costFinalizedAt = costRow.finalized_at
          costSource = "landed-cost-snapshot"
        } else {
          const hasProductCosts = Boolean(productCostExists.get(item.itemType, item.itemId))
          const hasShipmentCosts = item.itemType === "weapon"
            ? Boolean(weaponShipmentCostExists.get(item.itemId))
            : Boolean(stockShipmentCostExists.get(item.itemType, item.itemId))
          if (!hasProductCosts && !hasShipmentCosts) {
            const valuation = item.itemType === "weapon" ? weaponsById.get(item.itemId)?.purchasePriceValuation
              : item.itemType === "ammunition" ? ammoById.get(item.itemId)?.priceValuation
                : accessoryById.get(item.itemId)?.priceValuation
            const legacyCost = item.itemType === "weapon" ? weaponsById.get(item.itemId)?.purchasePrice
              : item.itemType === "ammunition" ? ammoById.get(item.itemId)?.price
                : accessoryById.get(item.itemId)?.price
            if (valuation && valuation.accountingCurrency === rateSnapshot.accountingCurrency) {
              unitCost = decimalToNumber(nonNegativeMoney(valuation.accountingAmount))
            } else if (settings.currencyCode === rateSnapshot.accountingCurrency && legacyCost != null) {
              unitCost = decimalToNumber(nonNegativeMoney(legacyCost))
            }
            if (unitCost != null) {
              costCurrency = rateSnapshot.accountingCurrency
              costFinalizedAt = new Date().toISOString()
              costSource = "trusted-base-valuation"
            }
          }
        }
        return {
          ...item,
          unitPrice: decimalToNumber(unitPrice),
          total: decimalToNumber(unitPrice.times(item.quantity)),
          unitLandedCostAccounting: unitCost,
          costAccountingCurrency: costCurrency,
          costSnapshotFinalizedAt: costFinalizedAt,
          costSnapshotSource: costSource,
        }
      })
      const requestedSubtotal = sumMoney(canonicalLineItems.map((item) => item.total))
      const negotiatedSubtotal = positiveMoney(input.totalNegotiated, "Negotiated subtotal")
        .toDecimalPlaces(rateSnapshot.transactionPrecision)
      if (negotiatedSubtotal.greaterThan(requestedSubtotal)) {
        return { success: false, error: "Negotiated subtotal cannot exceed the sum of sale line items" }
      }

      const listPriceInSaleCurrency = (item: typeof canonicalLineItems[number]) => {
        const entity = item.itemType === "weapon"
          ? weaponsById.get(item.itemId)
          : item.itemType === "ammunition"
            ? ammoById.get(item.itemId)
            : accessoryById.get(item.itemId)
        const valuation = input.mode === "Wholesale"
          ? (entity as Weapon | Ammunition | Accessory | undefined)?.wholesalePriceValuation
          : (entity as Weapon | Ammunition | Accessory | undefined)?.retailPriceValuation
        if (!entity) throw new Error(`${item.itemType} ${item.itemId} not found`)
        if (valuation) {
          if (valuation.accountingCurrency !== rateSnapshot.accountingCurrency) {
            throw new Error(`${item.itemType} ${item.itemId} uses a different accounting currency`)
          }
          return authoritativeListPrice(
            valuation.accountingAmount,
            0,
            rateSnapshot.exchangeRate,
            item.quantity,
          )
        }

        // Compatibility for records created before currency snapshots existed.
        // Their raw prices were stored in the system accounting currency. Read
        // that value from the database entity; never accept the renderer's unit
        // price as the authoritative list price.
        const legacyAccountingPrice = input.mode === "Wholesale"
          ? (entity as Weapon | Ammunition | Accessory).wholesalePrice
          : (entity as Weapon | Ammunition | Accessory).retailPrice
        return authoritativeListPrice(
          undefined,
          legacyAccountingPrice,
          rateSnapshot.exchangeRate,
          item.quantity,
        )
      }

      const authoritativeOriginal = sumMoney(canonicalLineItems.map(listPriceInSaleCurrency))
        .toDecimalPlaces(rateSnapshot.transactionPrecision)
      for (const item of canonicalLineItems) {
        const authoritativeLineTotal = listPriceInSaleCurrency(item)
          .toDecimalPlaces(rateSnapshot.transactionPrecision)
        const requestedLineTotal = nonNegativeMoney(item.total, `Line total for ${item.name}`)
        if (requestedLineTotal.greaterThan(authoritativeLineTotal)) {
          return { success: false, error: `Unit price for ${item.name} exceeds the authoritative list price` }
        }
      }
      if (!moneyEquals(input.totalOriginal, authoritativeOriginal, "0.01")) {
        return { success: false, error: "Original total does not match authoritative inventory prices" }
      }

      const taxPercent = nonNegativeMoney(settings.taxPercent, "Tax percent")
      const authoritativeTax = negotiatedSubtotal.times(taxPercent).dividedBy(100)
        .toDecimalPlaces(rateSnapshot.transactionPrecision)
      if (!moneyEquals(input.taxAmount, authoritativeTax, "0.01")) {
        return { success: false, error: "Tax amount does not match the configured tax rate" }
      }

      const paidDecimal = nonNegativeMoney(input.paidAmount ?? 0, "Paid amount")
        .toDecimalPlaces(rateSnapshot.transactionPrecision)
      const grandTotalDecimal = negotiatedSubtotal.plus(authoritativeTax)
      const balanceDecimal = grandTotalDecimal.minus(paidDecimal)
      if (balanceDecimal.isNegative()) {
        return { success: false, error: "Amount paid cannot exceed the invoice total" }
      }
      const paid = decimalToNumber(paidDecimal)
      const grandTotal = decimalToNumber(grandTotalDecimal)
      const actualBalance = decimalToNumber(balanceDecimal)
      if (actualBalance > 0 && !input.dueDate) {
        return { success: false, error: "Due date is required for unpaid balance" }
      }

      let resolvedCustomer: Customer
      if (input.customerId) {
        const existingCustomer = all.customers.find((customer) => customer.id === input.customerId)
        if (!existingCustomer) return { success: false, error: "Customer not found" }
        resolvedCustomer = existingCustomer
      } else {
        const draft = input.newCustomer!
        const duplicate = findDuplicateCustomer(all.customers, draft)
        if (duplicate) {
          resolvedCustomer = duplicate
        } else {
          const discount = Number(draft.wholesaleDiscountPercent ?? 0)
          if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
            return { success: false, error: "Wholesale discount must be between 0 and 100" }
          }
          resolvedCustomer = {
            id: generateId("CUST", "customers"),
            name: draft.name.trim().replace(/\s+/g, " "),
            phone: draft.phone.trim(),
            email: normalizedEmail(draft.email),
            address: draft.address.trim(),
            isWholesaleBuyer: Boolean(draft.isWholesaleBuyer),
            wholesaleDiscountPercent: discount,
            dateAdded: today,
          }
          repo.insertCustomer(resolvedCustomer)
        }
      }

      const invoiceId = generateId("INV", "invoices")
      const totalValuation = backendCurrencyService.createValuationFromSnapshot(grandTotalDecimal.toString(), rateSnapshot)
      const originalValuation = backendCurrencyService.createValuationFromSnapshot(authoritativeOriginal.toString(), rateSnapshot)
      const negotiatedValuation = backendCurrencyService.createValuationFromSnapshot(negotiatedSubtotal.toString(), rateSnapshot)
      const paidValuation = backendCurrencyService.createValuationFromSnapshot(paidDecimal.toString(), rateSnapshot)
      const balanceValuation = backendCurrencyService.createValuationFromSnapshot(balanceDecimal.toString(), rateSnapshot)
      const taxValuation = backendCurrencyService.createValuationFromSnapshot(authoritativeTax.toString(), rateSnapshot)

      let status: InvoiceStatus = "Pending"
      if (actualBalance <= 0.01) status = "Paid"
      else if (isPastDue(input.dueDate)) status = "Overdue"

      // Apply every stock mutation inside the same transaction.
      const perWeaponFinal = weaponsToSell.length > 0
        ? decimalToNumber(negotiatedSubtotal.dividedBy(weaponsToSell.length))
        : 0

      for (const weapon of weaponsToSell) {
        const weaponLine = lineItems.find(
          (item) => item.itemType === "weapon" && item.itemId === weapon.id,
        )
        const finalPrice = weaponLine?.unitPrice ?? perWeaponFinal
        const finalPriceValuation = backendCurrencyService.createValuationFromSnapshot(finalPrice, rateSnapshot)
        const updatedWeapon: Weapon = {
          ...weapon,
          status: "Sold",
          actualFinalPrice: finalPrice,
          actualFinalPriceValuation: finalPriceValuation,
          salePriceValuation: finalPriceValuation,
          movementHistory: [
            ...weapon.movementHistory,
            {
              id: `MV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              timestamp: new Date().toISOString(),
              fromStatus: weapon.status,
              toStatus: "Sold",
              userId: currentUser.id,
              userName: currentUser.name,
              reason: `Sold via invoice ${invoiceNumber}`,
            },
          ],
        }
        repo.updateWeapon(updatedWeapon)
      }

      for (const ammo of ammoUpdates.values()) repo.updateAmmunition(ammo)
      for (const accessory of accessoryUpdates.values()) repo.updateAccessory(accessory)

      const inventoryTransactionStatement = db.prepare(`
        INSERT INTO inventory_transactions
          (id, item_type, item_id, transaction_type, quantity_delta, unit_amount,
           currency, valuation, notes, created_by)
        VALUES (?, ?, ?, 'sale', ?, ?, ?, ?, ?, ?)
      `)
      for (const item of canonicalLineItems) {
        const unitValuation = backendCurrencyService.createValuationFromSnapshot(String(item.unitPrice), rateSnapshot)
        inventoryTransactionStatement.run(
          generateId("ITX", "inventory_transactions"),
          item.itemType,
          item.itemId,
          -item.quantity,
          String(item.unitPrice),
          saleCurrency,
          JSON.stringify(unitValuation),
          `Invoice ${invoiceNumber}`,
          currentUser.id,
        )
      }

      const newInvoice: Invoice = {
        id: invoiceId,
        invoiceNumber,
        type: "Sale",
        customerId: resolvedCustomer.id,
        supplierId: null,
        customerName: resolvedCustomer.name,
        date: input.date || today,
        dueDate: input.dueDate,
        totalOriginal: decimalToNumber(authoritativeOriginal),
        totalNegotiated: decimalToNumber(negotiatedSubtotal),
        totalPaid: paid,
        balance: actualBalance,
        status,
        weaponIds: uniqueWeaponIds,
        lineItems: canonicalLineItems,
        saleMode: input.mode,
        employeeId: currentUser.id,
        employeeName: currentUser.name,
        attachments: input.attachments ?? [],
        shipmentId: null,
        notes: input.notes?.trim() || "",
        voided: false,
        taxAmount: decimalToNumber(authoritativeTax),
        currency: saleCurrency,
        accountingCurrency: rateSnapshot.accountingCurrency,
        exchangeRate: rateSnapshot.exchangeRate,
        exchangeRateDate: rateSnapshot.exchangeRateDate,
        rateSource: rateSnapshot.rateSource,
        totalOriginalAccounting: originalValuation.accountingAmount,
        totalNegotiatedAccounting: negotiatedValuation.accountingAmount,
        totalPaidAccounting: paidValuation.accountingAmount,
        balanceAccounting: balanceValuation.accountingAmount,
        taxAmountAccounting: taxValuation.accountingAmount,
        totalValuation,
      }
      repo.insertInvoice(newInvoice)

      if (paid > 0.01) {
        const payment: PaymentRecord = {
          id: generateId("PAY", "payment_records"),
          invoiceId,
          invoiceNumber,
          date: input.date || today,
          amount: paid,
          currency: saleCurrency,
          accountingAmount: paidValuation.accountingAmount,
          accountingCurrency: paidValuation.accountingCurrency,
          exchangeRate: paidValuation.exchangeRate,
          exchangeRateDate: paidValuation.exchangeRateDate,
          rateSource: paidValuation.rateSource,
          rateId: paidValuation.rateId,
          method: normalizePaymentMethod(input.paymentMethod),
          employee: currentUser.name,
          notes: input.notes?.trim() || "Payment at sale",
        }
        repo.insertPayment(payment)
      }

      const totalItems = canonicalLineItems.reduce((sum, item) => sum + item.quantity, 0)
      const auditLog: AuditLog = {
        id: generateId("LOG", "audit_logs"),
        timestamp: new Date().toISOString(),
        date: today,
        userId: currentUser.id,
        actionType: "Sale",
        description: `Sale completed — Invoice ${invoiceNumber} — ${resolvedCustomer.name} — ${totalItems} item(s) — Total: ${grandTotal} — Paid: ${paid} — Balance: ${actualBalance}`,
        metadata: JSON.stringify({
          schemaVersion: 2,
          actorName: currentUser.name,
          entityType: "invoice",
          entityId: invoiceId,
          invoiceId,
          invoiceNumber,
          customerId: resolvedCustomer.id,
          customerName: resolvedCustomer.name,
          totalItems,
          weaponIds: uniqueWeaponIds,
          lineItems: canonicalLineItems,
          subtotal: decimalToNumber(negotiatedSubtotal),
          tax: decimalToNumber(authoritativeTax),
          total: grandTotal,
          paid,
          balance: actualBalance,
          currency: saleCurrency,
          accountingCurrency: rateSnapshot.accountingCurrency,
          exchangeRate: rateSnapshot.exchangeRate,
          exchangeRateDate: rateSnapshot.exchangeRateDate,
          rateSource: rateSnapshot.rateSource,
        }),
      }
      repo.insertAuditLog(auditLog)

      const notification: AppNotification = {
        id: generateId("NTF", "app_notifications"),
        type: "System",
        title: "New Sale Recorded",
        message: `Invoice ${invoiceNumber} created for ${resolvedCustomer.name}`,
        date: today,
        read: false,
        entityId: invoiceId,
      }
      repo.insertNotification(notification)

      db.prepare(`
        INSERT INTO sale_operations (operation_id, request_hash, invoice_id, invoice_number)
        VALUES (?, ?, ?, ?)
      `).run(operationId, requestHash, invoiceId, invoiceNumber)

      return { success: true, invoiceId, invoiceNumber }
    })()
  } catch (error) {
    console.error("Sale transaction failed:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
