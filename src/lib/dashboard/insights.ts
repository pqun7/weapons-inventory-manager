import type { DashboardAnalytics, DashboardInsight } from "./types"

function rounded(value: number): number {
  return Math.round(value * 10) / 10
}

export function dashboardChangePct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / Math.abs(previous)) * 100
}

export function buildDashboardInsights(data: DashboardAnalytics): DashboardInsight[] {
  const insights: DashboardInsight[] = []
  const push = (insight: DashboardInsight) => insights.push(insight)

  if (data.current.overdue > 0) {
    push({
      id: "overdue-receivables", priority: "high", titleKey: "dash.insight.overdue.title",
      descriptionKey: "dash.insight.overdue.description", params: { amount: data.current.overdue },
      actionKey: "dash.action.reviewReceivables", page: "financials",
    })
  }
  if (data.inventory.outOfStock > 0) {
    push({
      id: "out-of-stock", priority: "high", titleKey: "dash.insight.outOfStock.title",
      descriptionKey: "dash.insight.outOfStock.description", params: { count: data.inventory.outOfStock },
      actionKey: "dash.action.reviewInventory", page: "inventory",
    })
  }
  if (data.shipments.delayed > 0) {
    push({
      id: "delayed-shipments", priority: "high", titleKey: "dash.insight.delayed.title",
      descriptionKey: "dash.insight.delayed.description", params: { count: data.shipments.delayed },
      actionKey: "dash.action.followShipments", page: "shipments",
    })
  }
  if (data.inventory.lowStock > 0) {
    push({
      id: "low-stock", priority: "attention", titleKey: "dash.insight.lowStock.title",
      descriptionKey: "dash.insight.lowStock.description", params: { count: data.inventory.lowStock },
      actionKey: "dash.action.reviewReorder", page: "inventory",
    })
  }
  if (data.current.orderCount > 0 && data.current.costCoveragePct < 100) {
    push({
      id: "profit-coverage", priority: "attention", titleKey: "dash.insight.costCoverage.title",
      descriptionKey: "dash.insight.costCoverage.description", params: { coverage: rounded(data.current.costCoveragePct) },
      actionKey: "dash.action.reviewCostData", page: "sales",
    })
  }
  if (data.inventory.slowCapitalComplete && data.inventory.slowCapital > 0) {
    push({
      id: "slow-capital", priority: "attention", titleKey: "dash.insight.slowCapital.title",
      descriptionKey: "dash.insight.slowCapital.description", params: { amount: data.inventory.slowCapital, count: data.inventory.slowMoving },
      actionKey: "dash.action.reviewSlowStock", page: "inventory",
    })
  }
  if (data.current.revenue > 0 && data.concentration.productCount > 3 && data.concentration.topThreeSharePct >= 70) {
    push({
      id: "sales-concentration", priority: "attention", titleKey: "dash.insight.concentration.title",
      descriptionKey: "dash.insight.concentration.description", params: { share: rounded(data.concentration.topThreeSharePct) },
      actionKey: "dash.action.reviewConcentration", page: "sales",
    })
  }

  const lowMarginLeader = data.current.marginPct == null ? undefined : data.products
    .filter((product) => product.marginPct != null && product.revenue > 0)
    .slice(0, 3)
    .find((product) => (product.marginPct ?? 0) <= (data.current.marginPct ?? 0) - 5)
  if (lowMarginLeader?.marginPct != null) {
    push({
      id: `low-margin:${lowMarginLeader.key}`, priority: "attention", titleKey: "dash.insight.lowMargin.title",
      descriptionKey: "dash.insight.lowMargin.description",
      params: { product: lowMarginLeader.name, margin: rounded(lowMarginLeader.marginPct), average: rounded(data.current.marginPct ?? 0) },
      actionKey: "dash.action.reviewPricingCost", page: "sales",
    })
  }

  const costlyShipmentItem = data.inventory.items
    .filter((item) => item.shipmentCostSharePct != null && item.shipmentCostSharePct >= 15)
    .sort((a, b) => (b.shipmentCostSharePct ?? 0) - (a.shipmentCostSharePct ?? 0))[0]
  if (costlyShipmentItem?.shipmentCostSharePct != null) {
    push({
      id: `shipment-cost:${costlyShipmentItem.id}`, priority: "attention", titleKey: "dash.insight.shipmentCost.title",
      descriptionKey: "dash.insight.shipmentCost.description",
      params: { product: costlyShipmentItem.name, share: rounded(costlyShipmentItem.shipmentCostSharePct) },
      actionKey: "dash.action.reviewLandedCost", page: "shipments",
    })
  }

  if (data.current.marginPct != null) {
    const highMarginProduct = data.products
      .filter((product) => product.marginPct != null && product.units > 0 && product.revenue > 0)
      .sort((a, b) => (b.marginPct ?? 0) - (a.marginPct ?? 0))
      .find((product) => (product.marginPct ?? 0) >= data.current.marginPct! + 5)
    if (highMarginProduct?.marginPct != null) {
      push({
        id: `high-margin:${highMarginProduct.key}`, priority: "opportunity", titleKey: "dash.insight.highMargin.title",
        descriptionKey: "dash.insight.highMargin.description",
        params: { product: highMarginProduct.name, margin: rounded(highMarginProduct.marginPct), average: rounded(data.current.marginPct) },
        actionKey: "dash.action.reviewProductFocus", page: "sales",
      })
    }
  }

  const growth = dashboardChangePct(data.current.revenue, data.previous.revenue)
  if (growth != null && growth !== 0) {
    push({
      id: "revenue-change", priority: "info", titleKey: growth > 0 ? "dash.insight.revenueUp.title" : "dash.insight.revenueDown.title",
      descriptionKey: "dash.insight.revenueChange.description", params: { change: rounded(Math.abs(growth)) },
      page: "sales",
    })
  }

  const priorityOrder = { high: 0, attention: 1, opportunity: 2, info: 3 } as const
  return insights.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]).slice(0, 8)
}
