import { randomUUID } from "node:crypto"
import { Decimal } from "decimal.js"
import { getDb } from "../database.js"
import { backendCurrencyService, type ExchangeRateSnapshot } from "./currency-service.js"
import { decimalToStorage, nonNegativeMoney, positiveMoney, sumMoney } from "./money.js"
import {
  calculateCurrencyConversion,
  calculatePercentageCost,
  calculateShipmentAllocation,
  reconcileRounding,
  type AllocationItem,
} from "../../src/lib/product-cost.js"
import type {
  InventoryCostSnapshot,
  PersistedProductCost,
  PersistedShipmentCost,
  ProductAdditionalCostInput,
  ShipmentAdditionalCostInput,
  ShipmentCostAllocation,
} from "../../src/lib/types.js"

interface PreparedMoney {
  amount: string
  currency: string
  exchangeRate: string
  baseAmount: string
  baseCurrency: string
  exchangeRateDate: string
  rateSource: "manual" | "api" | "cache" | "default"
}

export interface ShipmentItemCostBasis {
  id: string
  productType: string
  description: string
  quantity: string
  unitPurchaseAmount: string
  currency: string
  snapshot: ExchangeRateSnapshot
  productIds: string[]
  productAdditionalCosts?: ProductAdditionalCostInput[]
}

interface PreparedShipmentCost extends PersistedShipmentCost {
  scopeItemIds: string[]
}

function id(prefix: string): string {
  return `${prefix}-${randomUUID()}`
}

function userExists(userId: string): void {
  const row = userId ? getDb().prepare("SELECT role, permissions FROM users WHERE id = ?").get(userId) as { role: string; permissions: string } | undefined : undefined
  if (!row) {
    throw new Error("A valid current user is required for financial cost changes")
  }
  let permissions: Record<string, unknown> = {}
  try { permissions = JSON.parse(row.permissions || "{}") as Record<string, unknown> } catch { /* invalid legacy permissions grant nothing */ }
  const permittedRole = new Set(["admin", "manager", "inventory", "accountant"]).has(row.role.toLowerCase())
  if (!permittedRole && permissions["shipment.edit"] !== true && permissions["shipment.receive"] !== true) {
    throw new Error("You do not have permission to manage product or shipment costs")
  }
}

function moneySnapshot(amount: string | number | Decimal, currency: string, snapshot?: ExchangeRateSnapshot): PreparedMoney {
  const rate = snapshot ?? backendCurrencyService.getRateSnapshot(currency)
  const original = nonNegativeMoney(amount, "Cost amount").toDecimalPlaces(rate.transactionPrecision, Decimal.ROUND_HALF_UP)
  return {
    amount: original.toFixed(rate.transactionPrecision),
    currency: rate.transactionCurrency,
    exchangeRate: positiveMoney(rate.exchangeRate, "Exchange rate").toString(),
    baseAmount: calculateCurrencyConversion(original, rate.exchangeRate, 4),
    baseCurrency: rate.accountingCurrency,
    exchangeRateDate: rate.exchangeRateDate,
    rateSource: rate.rateSource,
  }
}

function originalBaseAmount(amount: string | number, snapshot: ExchangeRateSnapshot): Decimal {
  return nonNegativeMoney(calculateCurrencyConversion(amount, snapshot.exchangeRate, 4), "Original base amount")
}

function calculateDraftAmount(
  draft: ProductAdditionalCostInput,
  originalPurchaseBase: Decimal,
  costSnapshot: ExchangeRateSnapshot,
): string {
  if (!draft.name?.trim()) throw new Error("Cost name is required")
  if (draft.calculationBase !== "original_purchase_cost") throw new Error("Unsupported cost calculation base")
  if (draft.calculationType === "fixed") {
    return nonNegativeMoney(draft.amount, `${draft.name} amount`)
      .toDecimalPlaces(costSnapshot.transactionPrecision, Decimal.ROUND_HALF_UP)
      .toFixed(costSnapshot.transactionPrecision)
  }
  const baseInCostCurrency = originalPurchaseBase.times(positiveMoney(costSnapshot.exchangeRate, "Exchange rate"))
  return calculatePercentageCost(baseInCostCurrency, draft.percentageRate ?? "", costSnapshot.transactionPrecision)
}

export function prepareProductCosts(
  productType: string,
  productId: string,
  originalAmount: string | number,
  originalSnapshot: ExchangeRateSnapshot,
  drafts: ProductAdditionalCostInput[],
  userId: string,
): { costs: PersistedProductCost[]; totalBaseAmount: string } {
  userExists(userId)
  const base = originalBaseAmount(originalAmount, originalSnapshot)
  const seenNames = new Set<string>()
  const costs = drafts.map((draft) => {
    const normalizedName = draft.name.trim()
    const nameKey = normalizedName.toLocaleLowerCase()
    if (seenNames.has(nameKey)) throw new Error(`Duplicate product cost name: ${normalizedName}`)
    seenNames.add(nameKey)
    const costSnapshot = backendCurrencyService.getRateSnapshot(draft.currency)
    if (costSnapshot.accountingCurrency !== originalSnapshot.accountingCurrency) {
      throw new Error("Product costs must share the configured accounting currency")
    }
    const calculated = calculateDraftAmount(draft, base, costSnapshot)
    const money = moneySnapshot(calculated, draft.currency, costSnapshot)
    const now = new Date().toISOString()
    return {
      id: draft.id ?? id("PCOST"),
      productType,
      productId,
      name: normalizedName,
      calculationType: draft.calculationType,
      inputAmount: draft.calculationType === "fixed" ? moneySnapshot(draft.amount, draft.currency, costSnapshot).amount : "0",
      percentageRate: draft.calculationType === "percentage"
        ? nonNegativeMoney(draft.percentageRate ?? "", `${normalizedName} percentage`).toString()
        : undefined,
      calculationBase: draft.calculationBase,
      calculatedAmount: money.amount,
      currency: money.currency,
      exchangeRate: money.exchangeRate,
      baseAmount: money.baseAmount,
      baseCurrency: money.baseCurrency,
      exchangeRateDate: money.exchangeRateDate,
      rateSource: money.rateSource,
      source: "product_level" as const,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    }
  })
  return { costs, totalBaseAmount: decimalToStorage(sumMoney(costs.map((cost) => cost.baseAmount))) }
}

export function insertProductCosts(costs: PersistedProductCost[]): void {
  const statement = getDb().prepare(`
    INSERT INTO product_costs
      (id, product_type, product_id, name, calculation_type, input_amount,
       percentage_rate, calculation_base, calculated_amount, currency_code,
       exchange_rate, base_amount, base_currency_code, exchange_rate_date,
       rate_source, source, created_by, created_at, updated_at)
    VALUES
      (@id, @productType, @productId, @name, @calculationType, @inputAmount,
       @percentageRate, @calculationBase, @calculatedAmount, @currency,
       @exchangeRate, @baseAmount, @baseCurrency, @exchangeRateDate,
       @rateSource, @source, @createdBy, @createdAt, @updatedAt)
  `)
  for (const cost of costs) statement.run(cost)
}

export function insertShipmentItemBasis(item: ShipmentItemCostBasis, shipmentId: string): void {
  const purchase = moneySnapshot(item.unitPurchaseAmount, item.currency, item.snapshot)
  getDb().prepare(`
    INSERT INTO shipment_items
      (id, shipment_id, product_type, description, quantity, unit_purchase_amount,
       currency_code, exchange_rate, unit_purchase_base_amount, base_currency_code,
       exchange_rate_date, rate_source, product_ids_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.id, shipmentId, item.productType, item.description, item.quantity,
    purchase.amount, purchase.currency, purchase.exchangeRate, purchase.baseAmount,
    purchase.baseCurrency, purchase.exchangeRateDate, purchase.rateSource,
    JSON.stringify(item.productIds),
  )
}

function applicableItems(cost: ShipmentAdditionalCostInput, items: ShipmentItemCostBasis[]): ShipmentItemCostBasis[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  let ids: string[]
  if (cost.scope === "entire_shipment") ids = items.map((item) => item.id)
  else if (cost.scope === "manual" && cost.selectedShipmentItemIds.length === 0) ids = Object.keys(cost.manualAllocations ?? {})
  else ids = cost.selectedShipmentItemIds
  ids = [...new Set(ids)]
  if (cost.scope === "single_product" && ids.length !== 1) throw new Error(`${cost.name} must apply to exactly one product`)
  if (ids.length === 0) throw new Error(`${cost.name} must apply to at least one product`)
  return ids.map((itemId) => {
    const item = byId.get(itemId)
    if (!item) throw new Error(`${cost.name} references an unknown shipment item`)
    return item
  })
}

export function prepareShipmentCosts(
  shipmentId: string,
  items: ShipmentItemCostBasis[],
  drafts: ShipmentAdditionalCostInput[],
  userId: string,
): PreparedShipmentCost[] {
  userExists(userId)
  if (items.length === 0 && drafts.length > 0) throw new Error("Shipment costs require shipment items")
  const baseCurrency = backendCurrencyService.getAccountingCurrency()
  const productSubtotalBase = sumMoney(items.map((item) => originalBaseAmount(item.unitPurchaseAmount, item.snapshot).times(item.quantity)))
  const seenNames = new Set<string>()
  return drafts.map((draft) => {
    const name = draft.name.trim()
    const key = name.toLocaleLowerCase()
    if (!name) throw new Error("Shipment cost name is required")
    if (seenNames.has(key)) throw new Error(`Duplicate shipment cost name: ${name}`)
    seenNames.add(key)
    const snapshot = backendCurrencyService.getRateSnapshot(draft.currency)
    if (snapshot.accountingCurrency !== baseCurrency) throw new Error("Shipment costs must share the accounting currency")
    const calculated = calculateDraftAmount(draft, productSubtotalBase, snapshot)
    const money = moneySnapshot(calculated, draft.currency, snapshot)
    const scoped = applicableItems(draft, items)
    const allocationItems: AllocationItem[] = scoped.map((item) => ({
      id: item.id,
      value: originalBaseAmount(item.unitPurchaseAmount, item.snapshot)
        .times(item.quantity)
        .times(snapshot.exchangeRate),
      quantity: item.quantity,
    }))
    const method = draft.scope === "manual" ? "manual" : draft.allocationMethod
    const calculatedAllocations = calculateShipmentAllocation(
      method,
      allocationItems,
      money.amount,
      snapshot.transactionPrecision,
      draft.manualAllocations,
    )
    const costId = draft.id ?? id("SCOST")
    const now = new Date().toISOString()
    const allocations: ShipmentCostAllocation[] = calculatedAllocations.map((allocation) => ({
      id: id("ALLOC"),
      shipmentId,
      shipmentItemId: allocation.shipmentItemId,
      costId,
      automaticAmount: allocation.automaticAmount,
      finalAmount: allocation.finalAmount,
      manualOverride: allocation.manualOverride,
      difference: allocation.difference,
      currency: money.currency,
      exchangeRate: money.exchangeRate,
      automaticBaseAmount: calculateCurrencyConversion(allocation.automaticAmount, money.exchangeRate, 4),
      finalBaseAmount: calculateCurrencyConversion(allocation.finalAmount, money.exchangeRate, 4),
      baseCurrency: money.baseCurrency,
      allocationMethod: method,
    }))
    return {
      id: costId,
      shipmentId,
      name,
      calculationType: draft.calculationType,
      inputAmount: draft.calculationType === "fixed" ? moneySnapshot(draft.amount, draft.currency, snapshot).amount : "0",
      percentageRate: draft.calculationType === "percentage"
        ? nonNegativeMoney(draft.percentageRate ?? "", `${name} percentage`).toString()
        : undefined,
      calculationBase: draft.calculationBase,
      calculatedAmount: money.amount,
      currency: money.currency,
      exchangeRate: money.exchangeRate,
      baseAmount: money.baseAmount,
      baseCurrency: money.baseCurrency,
      exchangeRateDate: money.exchangeRateDate,
      rateSource: money.rateSource,
      scope: draft.scope,
      allocationMethod: method,
      selectedShipmentItemIds: scoped.map((item) => item.id),
      scopeItemIds: scoped.map((item) => item.id),
      allocations,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    }
  })
}

export function insertShipmentCosts(costs: PreparedShipmentCost[]): void {
  const db = getDb()
  const costStatement = db.prepare(`
    INSERT INTO shipment_costs
      (id, shipment_id, name, calculation_type, input_amount, percentage_rate,
       calculation_base, calculated_amount, currency_code, exchange_rate,
       base_amount, base_currency_code, exchange_rate_date, rate_source, source,
       scope, allocation_method, created_by, created_at, updated_at)
    VALUES
      (@id, @shipmentId, @name, @calculationType, @inputAmount, @percentageRate,
       @calculationBase, @calculatedAmount, @currency, @exchangeRate,
       @baseAmount, @baseCurrency, @exchangeRateDate, @rateSource, 'shipment_level',
       @scope, @allocationMethod, @createdBy, @createdAt, @updatedAt)
  `)
  const scopeStatement = db.prepare("INSERT INTO shipment_cost_scope_items (cost_id, shipment_item_id) VALUES (?, ?)")
  const allocationStatement = db.prepare(`
    INSERT INTO shipment_cost_allocations
      (id, shipment_id, shipment_item_id, cost_id, automatic_amount, final_amount,
       manual_override, difference, currency_code, exchange_rate,
       automatic_base_amount, final_base_amount, base_currency_code, allocation_method)
    VALUES
      (@id, @shipmentId, @shipmentItemId, @costId, @automaticAmount, @finalAmount,
       @manualOverride, @difference, @currency, @exchangeRate,
       @automaticBaseAmount, @finalBaseAmount, @baseCurrency, @allocationMethod)
  `)
  for (const cost of costs) {
    costStatement.run(cost)
    for (const itemId of cost.scopeItemIds) scopeStatement.run(cost.id, itemId)
    for (const allocation of cost.allocations) {
      allocationStatement.run({ ...allocation, manualOverride: allocation.manualOverride ? 1 : 0 })
    }
  }
}

export function finalizeInventoryCosts(
  shipmentId: string,
  items: ShipmentItemCostBasis[],
  shipmentCosts: PreparedShipmentCost[],
  userId: string,
): InventoryCostSnapshot[] {
  const result: InventoryCostSnapshot[] = []
  const insert = getDb().prepare(`
    INSERT INTO inventory_cost_snapshots
      (product_type, product_id, shipment_id, shipment_item_id, original_amount,
       original_currency_code, original_exchange_rate, original_base_amount,
       product_costs_base_amount, shipment_costs_base_amount, final_landed_base_amount,
       base_currency_code, exchange_rate_date, rate_source, finalized_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(product_type, product_id) DO UPDATE SET
      shipment_id=excluded.shipment_id, shipment_item_id=excluded.shipment_item_id,
      original_amount=excluded.original_amount, original_currency_code=excluded.original_currency_code,
      original_exchange_rate=excluded.original_exchange_rate, original_base_amount=excluded.original_base_amount,
      product_costs_base_amount=excluded.product_costs_base_amount,
      shipment_costs_base_amount=excluded.shipment_costs_base_amount,
      final_landed_base_amount=excluded.final_landed_base_amount,
      base_currency_code=excluded.base_currency_code, exchange_rate_date=excluded.exchange_rate_date,
      rate_source=excluded.rate_source, finalized_at=datetime('now'), finalized_by=excluded.finalized_by
  `)

  for (const item of items) {
    const originalUnitBase = originalBaseAmount(item.unitPurchaseAmount, item.snapshot)
    const preparedProduct = item.productIds.map((productId) => prepareProductCosts(
      item.productType,
      productId,
      item.unitPurchaseAmount,
      item.snapshot,
      item.productAdditionalCosts ?? [],
      userId,
    ))
    for (const prepared of preparedProduct) insertProductCosts(prepared.costs)
    const lineShipmentAllocationBase = sumMoney(shipmentCosts.flatMap((cost) =>
      cost.allocations.filter((allocation) => allocation.shipmentItemId === item.id).map((allocation) => allocation.finalBaseAmount),
    ))
    const productAllocationShares = reconcileRounding(
      item.productIds.map((productId) => ({ id: productId, amount: lineShipmentAllocationBase.dividedBy(item.productIds.length || 1) })),
      lineShipmentAllocationBase,
      4,
    )
    for (let index = 0; index < item.productIds.length; index += 1) {
      const productId = item.productIds[index]
      const productCostsBase = preparedProduct[index]?.totalBaseAmount ?? "0.0000"
      const shipmentCostsBase = productAllocationShares[productId] ?? "0.0000"
      const finalBase = decimalToStorage(sumMoney([originalUnitBase, productCostsBase, shipmentCostsBase]))
      const snapshot: InventoryCostSnapshot = {
        productType: item.productType,
        productId,
        shipmentId,
        shipmentItemId: item.id,
        originalAmount: nonNegativeMoney(item.unitPurchaseAmount).toFixed(item.snapshot.transactionPrecision),
        originalCurrency: item.snapshot.transactionCurrency,
        originalExchangeRate: positiveMoney(item.snapshot.exchangeRate).toString(),
        originalBaseAmount: decimalToStorage(originalUnitBase),
        productCostsBaseAmount: productCostsBase,
        shipmentCostsBaseAmount: shipmentCostsBase,
        finalLandedBaseAmount: finalBase,
        baseCurrency: item.snapshot.accountingCurrency,
        exchangeRateDate: item.snapshot.exchangeRateDate,
        rateSource: item.snapshot.rateSource,
        finalizedAt: new Date().toISOString(),
      }
      insert.run(
        snapshot.productType, snapshot.productId, shipmentId, item.id,
        snapshot.originalAmount, snapshot.originalCurrency, snapshot.originalExchangeRate,
        snapshot.originalBaseAmount, snapshot.productCostsBaseAmount,
        snapshot.shipmentCostsBaseAmount, snapshot.finalLandedBaseAmount,
        snapshot.baseCurrency, snapshot.exchangeRateDate, snapshot.rateSource, userId,
      )
      result.push(snapshot)
    }
  }
  return result
}

export function finalizeStandaloneInventoryCost(
  productType: string,
  productId: string,
  originalAmount: string | number,
  originalSnapshot: ExchangeRateSnapshot,
  drafts: ProductAdditionalCostInput[],
  userId: string,
): InventoryCostSnapshot {
  const prepared = prepareProductCosts(productType, productId, originalAmount, originalSnapshot, drafts, userId)
  insertProductCosts(prepared.costs)
  const originalBase = originalBaseAmount(originalAmount, originalSnapshot)
  const finalBase = decimalToStorage(sumMoney([originalBase, prepared.totalBaseAmount]))
  getDb().prepare(`
    INSERT INTO inventory_cost_snapshots
      (product_type, product_id, original_amount, original_currency_code,
       original_exchange_rate, original_base_amount, product_costs_base_amount,
       shipment_costs_base_amount, final_landed_base_amount, base_currency_code,
       exchange_rate_date, rate_source, finalized_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, '0.0000', ?, ?, ?, ?, ?)
    ON CONFLICT(product_type, product_id) DO UPDATE SET
      original_amount=excluded.original_amount, original_currency_code=excluded.original_currency_code,
      original_exchange_rate=excluded.original_exchange_rate, original_base_amount=excluded.original_base_amount,
      product_costs_base_amount=excluded.product_costs_base_amount,
      final_landed_base_amount=excluded.final_landed_base_amount,
      base_currency_code=excluded.base_currency_code, exchange_rate_date=excluded.exchange_rate_date,
      rate_source=excluded.rate_source, finalized_at=datetime('now'), finalized_by=excluded.finalized_by
  `).run(
    productType, productId, nonNegativeMoney(originalAmount).toFixed(originalSnapshot.transactionPrecision),
    originalSnapshot.transactionCurrency, positiveMoney(originalSnapshot.exchangeRate).toString(),
    decimalToStorage(originalBase), prepared.totalBaseAmount, finalBase,
    originalSnapshot.accountingCurrency, originalSnapshot.exchangeRateDate, originalSnapshot.rateSource, userId,
  )
  return {
    productType, productId, originalAmount: nonNegativeMoney(originalAmount).toFixed(originalSnapshot.transactionPrecision),
    originalCurrency: originalSnapshot.transactionCurrency, originalExchangeRate: positiveMoney(originalSnapshot.exchangeRate).toString(),
    originalBaseAmount: decimalToStorage(originalBase), productCostsBaseAmount: prepared.totalBaseAmount,
    shipmentCostsBaseAmount: "0.0000", finalLandedBaseAmount: finalBase,
    baseCurrency: originalSnapshot.accountingCurrency, exchangeRateDate: originalSnapshot.exchangeRateDate,
    rateSource: originalSnapshot.rateSource, finalizedAt: new Date().toISOString(),
  }
}

export function listShipmentCosts(shipmentId: string): PersistedShipmentCost[] {
  const db = getDb()
  const rows = db.prepare("SELECT * FROM shipment_costs WHERE shipment_id = ? ORDER BY created_at, id").all(shipmentId) as Record<string, unknown>[]
  return rows.map((row) => {
    const allocations = db.prepare("SELECT * FROM shipment_cost_allocations WHERE cost_id = ? ORDER BY shipment_item_id").all(row.id) as Record<string, unknown>[]
    const selected = db.prepare("SELECT shipment_item_id FROM shipment_cost_scope_items WHERE cost_id = ? ORDER BY shipment_item_id").all(row.id) as Array<{ shipment_item_id: string }>
    return {
      id: String(row.id), shipmentId: String(row.shipment_id), name: String(row.name),
      calculationType: row.calculation_type as PersistedShipmentCost["calculationType"], inputAmount: String(row.input_amount),
      percentageRate: row.percentage_rate == null ? undefined : String(row.percentage_rate),
      calculationBase: row.calculation_base as PersistedShipmentCost["calculationBase"], calculatedAmount: String(row.calculated_amount),
      currency: String(row.currency_code), exchangeRate: String(row.exchange_rate), baseAmount: String(row.base_amount),
      baseCurrency: String(row.base_currency_code), exchangeRateDate: String(row.exchange_rate_date),
      rateSource: row.rate_source as PersistedShipmentCost["rateSource"], scope: row.scope as PersistedShipmentCost["scope"],
      allocationMethod: row.allocation_method as PersistedShipmentCost["allocationMethod"],
      selectedShipmentItemIds: selected.map((entry) => entry.shipment_item_id), createdBy: String(row.created_by),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      allocations: allocations.map((allocation) => ({
        id: String(allocation.id), shipmentId: String(allocation.shipment_id), shipmentItemId: String(allocation.shipment_item_id),
        costId: String(allocation.cost_id), automaticAmount: String(allocation.automatic_amount), finalAmount: String(allocation.final_amount),
        manualOverride: Number(allocation.manual_override) === 1, difference: String(allocation.difference), currency: String(allocation.currency_code),
        exchangeRate: String(allocation.exchange_rate), automaticBaseAmount: String(allocation.automatic_base_amount),
        finalBaseAmount: String(allocation.final_base_amount), baseCurrency: String(allocation.base_currency_code),
        allocationMethod: allocation.allocation_method as ShipmentCostAllocation["allocationMethod"],
      })),
    }
  })
}

export function listProductCosts(productType: string, productId: string): PersistedProductCost[] {
  const rows = getDb().prepare(`
    SELECT * FROM product_costs
    WHERE product_type = ? AND product_id = ?
    ORDER BY created_at, id
  `).all(productType, productId) as Record<string, unknown>[]
  return rows.map(mapProductCostRow)
}

export function mapProductCostRow(row: Record<string, unknown>): PersistedProductCost {
  return {
    id: String(row.id), productType: String(row.product_type), productId: String(row.product_id),
    name: String(row.name), calculationType: row.calculation_type as PersistedProductCost["calculationType"],
    inputAmount: String(row.input_amount), percentageRate: row.percentage_rate == null ? undefined : String(row.percentage_rate),
    calculationBase: row.calculation_base as PersistedProductCost["calculationBase"], calculatedAmount: String(row.calculated_amount),
    currency: String(row.currency_code), exchangeRate: String(row.exchange_rate), baseAmount: String(row.base_amount),
    baseCurrency: String(row.base_currency_code), exchangeRateDate: String(row.exchange_rate_date),
    rateSource: row.rate_source as PersistedProductCost["rateSource"], source: "product_level",
    createdBy: String(row.created_by), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }
}

export function getInventoryCostSnapshot(productType: string, productId: string): InventoryCostSnapshot | undefined {
  const row = getDb().prepare(`
    SELECT * FROM inventory_cost_snapshots WHERE product_type = ? AND product_id = ?
  `).get(productType, productId) as Record<string, unknown> | undefined
  if (!row) return undefined
  return mapInventoryCostSnapshotRow(row)
}

export function mapInventoryCostSnapshotRow(row: Record<string, unknown>): InventoryCostSnapshot {
  return {
    productType: String(row.product_type), productId: String(row.product_id),
    shipmentId: row.shipment_id == null ? undefined : String(row.shipment_id),
    shipmentItemId: row.shipment_item_id == null ? undefined : String(row.shipment_item_id),
    originalAmount: String(row.original_amount), originalCurrency: String(row.original_currency_code),
    originalExchangeRate: String(row.original_exchange_rate), originalBaseAmount: String(row.original_base_amount),
    productCostsBaseAmount: String(row.product_costs_base_amount), shipmentCostsBaseAmount: String(row.shipment_costs_base_amount),
    finalLandedBaseAmount: String(row.final_landed_base_amount), baseCurrency: String(row.base_currency_code),
    exchangeRateDate: String(row.exchange_rate_date), rateSource: row.rate_source as InventoryCostSnapshot["rateSource"],
    finalizedAt: String(row.finalized_at),
  }
}

export function replaceProductCosts(
  productType: string,
  productId: string,
  drafts: ProductAdditionalCostInput[],
  userId: string,
): InventoryCostSnapshot {
  userExists(userId)
  const existing = getInventoryCostSnapshot(productType, productId)
  if (!existing) throw new Error("This inventory item has no trustworthy original cost snapshot")
  const currency = backendCurrencyService.requireCurrency(existing.originalCurrency, false)
  const originalSnapshot: ExchangeRateSnapshot = {
    transactionCurrency: existing.originalCurrency,
    accountingCurrency: existing.baseCurrency,
    exchangeRate: positiveMoney(existing.originalExchangeRate).toNumber(),
    exchangeRateDate: existing.exchangeRateDate,
    rateSource: existing.rateSource,
    transactionPrecision: currency.decimal_precision,
  }
  const prepared = prepareProductCosts(productType, productId, existing.originalAmount, originalSnapshot, drafts, userId)
  const finalBase = decimalToStorage(sumMoney([
    existing.originalBaseAmount,
    prepared.totalBaseAmount,
    existing.shipmentCostsBaseAmount,
  ]))
  getDb().prepare("DELETE FROM product_costs WHERE product_type = ? AND product_id = ?").run(productType, productId)
  insertProductCosts(prepared.costs)
  getDb().prepare(`
    UPDATE inventory_cost_snapshots
    SET product_costs_base_amount = ?, final_landed_base_amount = ?,
        finalized_at = datetime('now'), finalized_by = ?
    WHERE product_type = ? AND product_id = ?
  `).run(prepared.totalBaseAmount, finalBase, userId, productType, productId)
  return { ...existing, productCostsBaseAmount: prepared.totalBaseAmount, finalLandedBaseAmount: finalBase, finalizedAt: new Date().toISOString() }
}
