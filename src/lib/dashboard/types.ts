export type DashboardPeriodPreset = "today" | "week" | "month" | "quarter" | "year" | "custom"

export interface DashboardDateRange {
  start: string
  end: string
}

export interface DashboardPerformance {
  revenue: number
  cost: number
  profit: number | null
  marginPct: number | null
  orderCount: number
  unitsSold: number
  costCoveragePct: number
  receivables: number
  overdue: number
}

export interface DashboardTrendPoint {
  date: string
  revenue: number
  profit: number | null
  costCoveragePct: number
}

export interface DashboardCategoryPerformance {
  category: "weapon" | "accessory" | "ammunition"
  segment: string
  revenue: number
  cost: number
  profit: number | null
  marginPct: number | null
  units: number
  costCoveragePct: number
}

export interface DashboardProductPerformance {
  key: string
  category: "weapon" | "accessory" | "ammunition"
  name: string
  revenue: number
  cost: number
  profit: number | null
  marginPct: number | null
  units: number
  costCoveragePct: number
}

export type DashboardInventoryStatus = "out" | "low" | "dead" | "slow" | "active"

export interface DashboardInventoryItem {
  id: string
  category: "weapon" | "accessory" | "ammunition"
  name: string
  quantity: number
  safetyThreshold: number | null
  value: number | null
  lastSaleDate: string | null
  daysSinceSale: number | null
  status: DashboardInventoryStatus
  marginPct: number | null
  shipmentCostSharePct: number | null
}

export interface DashboardInventorySummary {
  value: number
  valueComplete: boolean
  valuationCoveragePct: number
  units: number
  lowStock: number
  outOfStock: number
  slowMoving: number
  deadStock: number
  slowCapital: number
  slowCapitalComplete: boolean
  items: DashboardInventoryItem[]
}

export interface DashboardShipmentSummary {
  pending: number
  inTransit: number
  delayed: number
  recent: Array<{
    id: string
    shipmentNumber: string
    status: string
    expectedArrivalDate: string
    supplierName: string
    value: number | null
  }>
}

export interface DashboardConcentration {
  productCount: number
  topThreeRevenue: number
  topThreeSharePct: number
}

export interface DashboardAnalytics {
  generatedAt: string
  accountingCurrency: string
  period: DashboardDateRange & {
    previousStart: string
    previousEnd: string
    bucket: "day" | "week" | "month"
  }
  current: DashboardPerformance
  previous: DashboardPerformance
  trend: DashboardTrendPoint[]
  categories: DashboardCategoryPerformance[]
  products: DashboardProductPerformance[]
  inventory: DashboardInventorySummary
  shipments: DashboardShipmentSummary
  concentration: DashboardConcentration
}

export type DashboardInsightPriority = "high" | "attention" | "opportunity" | "info"

export interface DashboardInsight {
  id: string
  priority: DashboardInsightPriority
  titleKey: string
  descriptionKey: string
  params?: Record<string, string | number>
  actionKey?: string
  page?: "inventory" | "sales" | "shipments" | "financials"
}
