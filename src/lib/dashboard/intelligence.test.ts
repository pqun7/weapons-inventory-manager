import { describe, expect, it } from "vitest"
import { deriveDashboardIntelligence } from "./intelligence"
import type { DashboardAnalytics } from "./types"

const data: DashboardAnalytics = {
  generatedAt: "2026-08-13T00:00:00Z",
  accountingCurrency: "USD",
  period: { start: "2026-08-01", end: "2026-08-10", previousStart: "2026-07-22", previousEnd: "2026-07-31", bucket: "day" },
  current: { revenue: 1000, cost: 600, profit: 400, marginPct: 40, orderCount: 10, unitsSold: 20, costCoveragePct: 100, receivables: 50, overdue: 10 },
  previous: { revenue: 800, cost: 500, profit: 300, marginPct: 37.5, orderCount: 8, unitsSold: 15, costCoveragePct: 100, receivables: 40, overdue: 0 },
  trend: [], categories: [],
  products: [
    { key: "a", category: "accessory", name: "Leader", revenue: 700, cost: 560, profit: 140, marginPct: 20, units: 10, costCoveragePct: 100 },
    { key: "b", category: "accessory", name: "Premium", revenue: 100, cost: 20, profit: 80, marginPct: 80, units: 2, costCoveragePct: 100 },
    { key: "c", category: "accessory", name: "Core", revenue: 200, cost: 80, profit: 120, marginPct: 60, units: 8, costCoveragePct: 100 },
  ],
  inventory: {
    value: 1200, valueComplete: true, valuationCoveragePct: 100, units: 40,
    lowStock: 1, outOfStock: 0, slowMoving: 1, deadStock: 0,
    slowCapital: 300, slowCapitalComplete: true,
    items: [
      { id: "1", category: "accessory", name: "Overstock", quantity: 30, safetyThreshold: 10, value: 600, lastSaleDate: "2026-08-05", daysSinceSale: 5, status: "active", marginPct: 8, shipmentCostSharePct: 20 },
      { id: "2", category: "ammunition", name: "Normal", quantity: 10, safetyThreshold: 10, value: 200, lastSaleDate: null, daysSinceSale: null, status: "slow", marginPct: 30, shipmentCostSharePct: 2 },
    ],
  },
  shipments: { pending: 1, inTransit: 0, delayed: 0, recent: [] },
  concentration: { productCount: 3, topThreeRevenue: 1000, topThreeSharePct: 100 },
}

describe("dashboard intelligence", () => {
  it("derives evidence-backed product opportunities", () => {
    const result = deriveDashboardIntelligence(data)
    expect(result.productSignals.some((item) => item.kind === "high-sales-low-margin" && item.product.name === "Leader")).toBe(true)
    expect(result.productSignals.some((item) => item.kind === "low-sales-high-margin" && item.product.name === "Premium")).toBe(true)
  })

  it("calculates inventory capital indicators only from covered values", () => {
    const result = deriveDashboardIntelligence(data)
    expect(result.capital.turnoverProxy).toBe(0.5)
    expect(result.capital.daysInventoryProxy).toBe(20)
    expect(result.capital.slowCapitalSharePct).toBe(25)
    expect(result.capital.overstockItems[0]?.name).toBe("Overstock")
    expect(result.pricingReviewItems[0]?.name).toBe("Overstock")
  })

  it("does not invent capital efficiency when valuation coverage is incomplete", () => {
    const result = deriveDashboardIntelligence({ ...data, inventory: { ...data.inventory, valueComplete: false } })
    expect(result.capital.turnoverProxy).toBeNull()
    expect(result.capital.daysInventoryProxy).toBeNull()
    expect(result.capital.slowCapitalSharePct).toBeNull()
  })
})
