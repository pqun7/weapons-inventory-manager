import type { DashboardAnalytics, DashboardInventoryItem, DashboardProductPerformance } from "./types"

export type ProductSignalKind =
  | "highest-profit"
  | "highest-margin"
  | "high-sales-low-margin"
  | "low-sales-high-margin"
  | "insufficient-profit"

export interface DashboardProductSignal {
  kind: ProductSignalKind
  product: DashboardProductPerformance
  categoryMarginPct: number
}

export interface DashboardCapitalEfficiency {
  periodDays: number
  turnoverProxy: number | null
  daysInventoryProxy: number | null
  slowCapitalSharePct: number | null
  overstockItems: DashboardInventoryItem[]
  recentMovingItems: DashboardInventoryItem[]
  highValueItems: DashboardInventoryItem[]
}

export interface DashboardIntelligence {
  productSignals: DashboardProductSignal[]
  pricingReviewItems: DashboardInventoryItem[]
  capital: DashboardCapitalEfficiency
}

function dateSpanDays(start: string, end: string): number {
  const startTime = Date.parse(`${start}T00:00:00Z`)
  const endTime = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return 1
  return Math.floor((endTime - startTime) / 86_400_000) + 1
}

function categoryMargins(products: DashboardProductPerformance[]): Map<DashboardProductPerformance["category"], number> {
  const totals = new Map<DashboardProductPerformance["category"], { revenue: number; profit: number }>()
  for (const product of products) {
    if (product.profit == null || product.costCoveragePct < 95 || product.revenue <= 0) continue
    const current = totals.get(product.category) ?? { revenue: 0, profit: 0 }
    current.revenue += product.revenue
    current.profit += product.profit
    totals.set(product.category, current)
  }
  return new Map([...totals].map(([category, total]) => [category, total.revenue > 0 ? total.profit / total.revenue * 100 : 0]))
}

function buildProductSignals(products: DashboardProductPerformance[]): DashboardProductSignal[] {
  const eligible = products.filter((product) => product.profit != null && product.marginPct != null && product.revenue > 0 && product.costCoveragePct >= 95)
  if (!eligible.length) return []
  const margins = categoryMargins(eligible)
  const averageRevenue = eligible.reduce((sum, product) => sum + product.revenue, 0) / eligible.length
  const signal = (kind: ProductSignalKind, product: DashboardProductPerformance | undefined): DashboardProductSignal | null => {
    if (!product) return null
    return { kind, product, categoryMarginPct: margins.get(product.category) ?? 0 }
  }
  const highestProfit = [...eligible].sort((left, right) => (right.profit ?? 0) - (left.profit ?? 0))[0]
  const highestMargin = [...eligible].filter((product) => product.units > 0).sort((left, right) => (right.marginPct ?? 0) - (left.marginPct ?? 0))[0]
  const highSalesLowMargin = [...eligible]
    .filter((product) => product.revenue >= averageRevenue && (product.marginPct ?? 0) <= (margins.get(product.category) ?? 0) - 3)
    .sort((left, right) => right.revenue - left.revenue)[0]
  const lowSalesHighMargin = [...eligible]
    .filter((product) => product.revenue < averageRevenue && (product.marginPct ?? 0) >= (margins.get(product.category) ?? 0) + 5)
    .sort((left, right) => (right.marginPct ?? 0) - (left.marginPct ?? 0))[0]
  const insufficientProfit = [...eligible]
    .filter((product) => (product.profit ?? 0) <= 0 || (product.marginPct ?? 0) <= (margins.get(product.category) ?? 0) - 10)
    .sort((left, right) => (left.marginPct ?? 0) - (right.marginPct ?? 0))[0]

  const unique = new Set<string>()
  return [
    signal("highest-profit", highestProfit),
    signal("highest-margin", highestMargin),
    signal("high-sales-low-margin", highSalesLowMargin),
    signal("low-sales-high-margin", lowSalesHighMargin),
    signal("insufficient-profit", insufficientProfit),
  ].filter((item): item is DashboardProductSignal => {
    if (!item || unique.has(`${item.kind}:${item.product.key}`)) return false
    unique.add(`${item.kind}:${item.product.key}`)
    return true
  })
}

export function deriveDashboardIntelligence(data: DashboardAnalytics): DashboardIntelligence {
  const periodDays = dateSpanDays(data.period.start, data.period.end)
  const reliableCapital = data.inventory.valueComplete && data.current.costCoveragePct >= 95 && data.inventory.value > 0
  const turnoverProxy = reliableCapital ? data.current.cost / data.inventory.value : null
  const daysInventoryProxy = turnoverProxy && turnoverProxy > 0 ? periodDays / turnoverProxy : null
  const slowCapitalSharePct = data.inventory.slowCapitalComplete && data.inventory.valueComplete && data.inventory.value > 0
    ? data.inventory.slowCapital / data.inventory.value * 100
    : null
  const stocked = data.inventory.items.filter((item) => item.quantity > 0)
  const overstockItems = stocked
    .filter((item) => item.safetyThreshold != null && item.safetyThreshold > 0 && item.quantity >= item.safetyThreshold * 3)
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0))
  const recentMovingItems = stocked
    .filter((item) => item.daysSinceSale != null && item.daysSinceSale <= 30)
    .sort((left, right) => (left.daysSinceSale ?? Infinity) - (right.daysSinceSale ?? Infinity))
  const highValueItems = stocked.filter((item) => item.value != null).sort((left, right) => (right.value ?? 0) - (left.value ?? 0)).slice(0, 5)
  const pricingReviewItems = stocked
    .filter((item) => (item.marginPct != null && item.marginPct < 10) || (item.shipmentCostSharePct != null && item.shipmentCostSharePct >= 15))
    .sort((left, right) => (right.shipmentCostSharePct ?? 0) - (left.shipmentCostSharePct ?? 0) || (left.marginPct ?? Infinity) - (right.marginPct ?? Infinity))

  return {
    productSignals: buildProductSignals(data.products),
    pricingReviewItems,
    capital: { periodDays, turnoverProxy, daysInventoryProxy, slowCapitalSharePct, overstockItems, recentMovingItems, highValueItems },
  }
}
