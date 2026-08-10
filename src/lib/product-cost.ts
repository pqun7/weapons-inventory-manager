import { Decimal } from "decimal.js"

Decimal.set({ precision: 50, rounding: Decimal.ROUND_HALF_UP })

export type MoneyLike = string | number | Decimal
export type CostCalculationType = "fixed" | "percentage"
export type CostCalculationBase = "original_purchase_cost"
export type ShipmentCostScope = "entire_shipment" | "selected_products" | "single_product" | "manual"
export type AllocationMethod = "by_value" | "by_quantity" | "equal" | "manual"

export interface ProductCostDraft {
  id?: string
  name: string
  calculationType: CostCalculationType
  amount: string
  percentageRate?: string
  calculationBase: CostCalculationBase
  currency: string
}

export interface ShipmentCostDraft extends ProductCostDraft {
  scope: ShipmentCostScope
  allocationMethod: AllocationMethod
  selectedShipmentItemIds: string[]
  manualAllocations?: Record<string, string>
}

export interface AllocationItem {
  id: string
  value: MoneyLike
  quantity: MoneyLike
}

export interface AllocationResult {
  shipmentItemId: string
  automaticAmount: string
  finalAmount: string
  manualOverride: boolean
  difference: string
}

export interface CalculatedProductCost {
  id?: string
  name: string
  calculationType: CostCalculationType
  calculationBase: CostCalculationBase
  inputAmount: string
  percentageRate?: string
  calculatedAmount: string
  currency: string
}

function decimal(value: MoneyLike, field: string): Decimal {
  let result: Decimal
  try {
    result = value instanceof Decimal ? value : new Decimal(value)
  } catch {
    throw new Error(`${field} must be a valid decimal amount`)
  }
  if (!result.isFinite()) throw new Error(`${field} must be finite`)
  return result
}

function nonNegative(value: MoneyLike, field: string): Decimal {
  const result = decimal(value, field)
  if (result.isNegative()) throw new Error(`${field} cannot be negative`)
  return result
}

function precision(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 4) {
    throw new Error("Currency precision must be an integer between 0 and 4")
  }
  return value
}

function storage(value: Decimal, decimalPlaces: number): string {
  return value.toDecimalPlaces(precision(decimalPlaces), Decimal.ROUND_HALF_UP).toFixed(decimalPlaces)
}

export function calculateFixedCost(amount: MoneyLike, decimalPlaces = 2): string {
  return storage(nonNegative(amount, "Fixed cost"), decimalPlaces)
}

export function calculatePercentageCost(
  baseAmount: MoneyLike,
  percentageRate: MoneyLike,
  decimalPlaces = 2,
): string {
  const base = nonNegative(baseAmount, "Percentage calculation base")
  const rate = nonNegative(percentageRate, "Percentage rate")
  return storage(base.times(rate).dividedBy(100), decimalPlaces)
}

export function calculateProductAdditionalCost(
  originalPurchaseCost: MoneyLike,
  cost: ProductCostDraft,
  decimalPlaces = 2,
): CalculatedProductCost {
  if (!cost.name.trim()) throw new Error("Cost name is required")
  if (!/^[A-Z]{3}$/.test(cost.currency.trim().toUpperCase())) throw new Error("Cost currency is invalid")
  if (cost.calculationBase !== "original_purchase_cost") throw new Error("Unsupported percentage calculation base")

  const calculatedAmount = cost.calculationType === "fixed"
    ? calculateFixedCost(cost.amount, decimalPlaces)
    : calculatePercentageCost(originalPurchaseCost, cost.percentageRate ?? "", decimalPlaces)

  return {
    id: cost.id,
    name: cost.name.trim(),
    calculationType: cost.calculationType,
    calculationBase: cost.calculationBase,
    inputAmount: cost.calculationType === "fixed"
      ? storage(nonNegative(cost.amount, "Fixed cost"), decimalPlaces)
      : "0".padEnd(decimalPlaces > 0 ? decimalPlaces + 2 : 1, "0"),
    percentageRate: cost.calculationType === "percentage"
      ? nonNegative(cost.percentageRate ?? "", "Percentage rate").toString()
      : undefined,
    calculatedAmount,
    currency: cost.currency.trim().toUpperCase(),
  }
}

export function calculateProductAdditionalCosts(
  originalPurchaseCost: MoneyLike,
  costs: ProductCostDraft[],
  decimalPlaces = 2,
): CalculatedProductCost[] {
  return costs.map((cost) => calculateProductAdditionalCost(originalPurchaseCost, cost, decimalPlaces))
}

export function calculateProductFinalCost(
  originalPurchaseCost: MoneyLike,
  productAdditionalCosts: MoneyLike[],
  shipmentAllocatedCosts: MoneyLike[],
  decimalPlaces = 4,
): string {
  const final = [...productAdditionalCosts, ...shipmentAllocatedCosts]
    .reduce<Decimal>((sum, value) => sum.plus(nonNegative(value, "Cost component")), nonNegative(originalPurchaseCost, "Original purchase cost"))
  return storage(final, decimalPlaces)
}

export function calculateCurrencyConversion(
  amount: MoneyLike,
  exchangeRateUnitsPerBase: MoneyLike,
  basePrecision = 4,
): string {
  const rate = decimal(exchangeRateUnitsPerBase, "Exchange rate")
  if (!rate.greaterThan(0)) throw new Error("Exchange rate must be greater than zero")
  return storage(nonNegative(amount, "Amount").dividedBy(rate), basePrecision)
}

/**
 * Reconciles independently rounded shares to the source amount. Remainder units
 * are applied from the end of the stable item order, matching 100 / 3 =>
 * 33.33, 33.33, 33.34.
 */
export function reconcileRounding(
  exactShares: Array<{ id: string; amount: Decimal }>,
  total: MoneyLike,
  decimalPlaces: number,
): Record<string, string> {
  const places = precision(decimalPlaces)
  const unit = new Decimal(10).pow(-places)
  const target = nonNegative(total, "Allocation total").toDecimalPlaces(places, Decimal.ROUND_HALF_UP)
  const rounded = exactShares.map(({ id, amount }) => ({
    id,
    amount: amount.toDecimalPlaces(places, Decimal.ROUND_DOWN),
  }))
  let remainderUnits = target.minus(rounded.reduce((sum, share) => sum.plus(share.amount), new Decimal(0)))
    .dividedBy(unit).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()
  if (remainderUnits < 0) throw new Error("Allocation rounding exceeded the source total")
  for (let i = rounded.length - 1; remainderUnits > 0 && rounded.length > 0; i = (i - 1 + rounded.length) % rounded.length) {
    rounded[i].amount = rounded[i].amount.plus(unit)
    remainderUnits -= 1
  }
  return Object.fromEntries(rounded.map((share) => [share.id, storage(share.amount, places)]))
}

function allocateProportionally(
  items: AllocationItem[],
  total: MoneyLike,
  weight: (item: AllocationItem) => Decimal,
  decimalPlaces: number,
): Record<string, string> {
  if (items.length === 0) throw new Error("At least one applicable shipment item is required")
  const source = nonNegative(total, "Shipment cost")
  const weights = items.map((item) => ({ id: item.id, amount: weight(item) }))
  if (weights.some((entry) => entry.amount.isNegative())) throw new Error("Allocation weights cannot be negative")
  const denominator = weights.reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0))
  if (!denominator.greaterThan(0)) throw new Error("Allocation base must be greater than zero")
  return reconcileRounding(
    weights.map((entry) => ({ id: entry.id, amount: source.times(entry.amount).dividedBy(denominator) })),
    source,
    decimalPlaces,
  )
}

export function calculateAllocationByValue(items: AllocationItem[], total: MoneyLike, decimalPlaces = 2): Record<string, string> {
  return allocateProportionally(items, total, (item) => nonNegative(item.value, "Product value"), decimalPlaces)
}

export function calculateAllocationByQuantity(items: AllocationItem[], total: MoneyLike, decimalPlaces = 2): Record<string, string> {
  return allocateProportionally(items, total, (item) => nonNegative(item.quantity, "Product quantity"), decimalPlaces)
}

export function calculateEqualAllocation(items: AllocationItem[], total: MoneyLike, decimalPlaces = 2): Record<string, string> {
  return allocateProportionally(items, total, () => new Decimal(1), decimalPlaces)
}

export function validateAllocation(
  allocations: Record<string, MoneyLike>,
  total: MoneyLike,
  decimalPlaces = 2,
): void {
  const places = precision(decimalPlaces)
  const expected = nonNegative(total, "Shipment cost").toDecimalPlaces(places, Decimal.ROUND_HALF_UP)
  const actual = Object.values(allocations).reduce<Decimal>(
    (sum, amount) => sum.plus(nonNegative(amount, "Allocated cost")),
    new Decimal(0),
  ).toDecimalPlaces(places, Decimal.ROUND_HALF_UP)
  if (!actual.equals(expected)) throw new Error("Allocated costs do not match the shipment cost.")
}

export function calculateShipmentAllocation(
  method: AllocationMethod,
  items: AllocationItem[],
  total: MoneyLike,
  decimalPlaces: number,
  manualAllocations?: Record<string, string>,
): AllocationResult[] {
  const automatic = method === "by_value"
    ? calculateAllocationByValue(items, total, decimalPlaces)
    : method === "by_quantity"
      ? calculateAllocationByQuantity(items, total, decimalPlaces)
      : method === "equal"
        ? calculateEqualAllocation(items, total, decimalPlaces)
        : Object.fromEntries(items.map((item) => [item.id, storage(new Decimal(0), decimalPlaces)]))

  const final = manualAllocations ?? automatic
  validateAllocation(final, total, decimalPlaces)
  const applicableIds = new Set(items.map((item) => item.id))
  if (Object.keys(final).some((id) => !applicableIds.has(id))) throw new Error("Allocation references an inapplicable shipment item")

  return items.map((item) => {
    const automaticAmount = automatic[item.id] ?? storage(new Decimal(0), decimalPlaces)
    const finalAmount = storage(nonNegative(final[item.id] ?? 0, "Allocated cost"), decimalPlaces)
    const difference = storage(new Decimal(finalAmount).minus(automaticAmount), decimalPlaces)
    return {
      shipmentItemId: item.id,
      automaticAmount,
      finalAmount,
      manualOverride: method === "manual" || Boolean(manualAllocations && finalAmount !== automaticAmount),
      difference,
    }
  })
}

export function calculateFinalLandedCost(
  originalPurchaseBaseAmount: MoneyLike,
  productCostBaseAmounts: MoneyLike[],
  shipmentAllocationBaseAmounts: MoneyLike[],
  basePrecision = 4,
): string {
  return calculateProductFinalCost(
    originalPurchaseBaseAmount,
    productCostBaseAmounts,
    shipmentAllocationBaseAmounts,
    basePrecision,
  )
}
