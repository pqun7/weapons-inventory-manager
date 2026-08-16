import { describe, expect, it } from "vitest"
import { buildDashboardInsights, dashboardChangePct } from "@/lib/dashboard/insights"
import type { DashboardAnalytics } from "@/lib/dashboard/types"

const analytics: DashboardAnalytics = {
  generatedAt: "2026-08-13T00:00:00Z", accountingCurrency: "USD",
  period: { start: "2026-08-01", end: "2026-08-13", previousStart: "2026-07-19", previousEnd: "2026-07-31", bucket: "day" },
  current: { revenue: 1000, cost: 700, profit: 300, marginPct: 30, orderCount: 4, unitsSold: 6, costCoveragePct: 100, receivables: 400, overdue: 100 },
  previous: { revenue: 800, cost: 600, profit: 200, marginPct: 25, orderCount: 3, unitsSold: 5, costCoveragePct: 100, receivables: 0, overdue: 0 },
  trend: [], categories: [], products: [],
  inventory: { value: 5000, valueComplete: true, valuationCoveragePct: 100, units: 20, lowStock: 1, outOfStock: 0, slowMoving: 2, deadStock: 1, slowCapital: 900, slowCapitalComplete: true, items: [] },
  shipments: { pending: 0, inTransit: 0, delayed: 0, recent: [] },
  concentration: { productCount: 2, topThreeRevenue: 1000, topThreeSharePct: 100 },
}

describe("dashboard insights", () => {
  it("orders evidence-backed risks before informational changes", () => {
    const insights = buildDashboardInsights(analytics)
    expect(insights[0].id).toBe("overdue-receivables")
    expect(insights.some((item) => item.id === "slow-capital")).toBe(true)
    expect(insights.at(-1)?.id).toBe("revenue-change")
  })

  it("does not fabricate a percentage when the comparison base is zero", () => {
    expect(dashboardChangePct(100, 0)).toBeNull()
    expect(dashboardChangePct(0, 0)).toBe(0)
    expect(dashboardChangePct(120, 100)).toBe(20)
  })
})
