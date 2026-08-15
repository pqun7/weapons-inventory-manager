import { z } from "zod"
import { getSupabaseClient } from "@/lib/supabase/client"
import { getDatabaseProvider } from "@/lib/database-runtime"
import { dbGetAll } from "@/lib/db"
import type { AllData } from "@/lib/db"
import type { DashboardAnalytics, DashboardDateRange, DashboardInventoryItem } from "./types"

const categorySchema = z.enum(["weapon", "accessory", "ammunition"])
const performanceSchema = z.object({
  revenue: z.number(), cost: z.number(), profit: z.number().nullable(), marginPct: z.number().nullable(),
  orderCount: z.number(), unitsSold: z.number(), costCoveragePct: z.number(), receivables: z.number(), overdue: z.number(),
})

const dashboardAnalyticsSchema = z.object({
  generatedAt: z.string(), accountingCurrency: z.string(),
  period: z.object({
    start: z.string(), end: z.string(), previousStart: z.string(), previousEnd: z.string(),
    bucket: z.enum(["day", "week", "month"]),
  }),
  current: performanceSchema,
  previous: performanceSchema,
  trend: z.array(z.object({ date: z.string(), revenue: z.number(), profit: z.number().nullable(), costCoveragePct: z.number() })),
  categories: z.array(z.object({
    category: categorySchema, segment: z.string(), revenue: z.number(), cost: z.number(), profit: z.number().nullable(),
    marginPct: z.number().nullable(), units: z.number(), costCoveragePct: z.number(),
  })),
  products: z.array(z.object({
    key: z.string(), category: categorySchema, name: z.string(), revenue: z.number(), cost: z.number(),
    profit: z.number().nullable(), marginPct: z.number().nullable(), units: z.number(), costCoveragePct: z.number(),
  })),
  inventory: z.object({
    value: z.number(), valueComplete: z.boolean(), valuationCoveragePct: z.number(), units: z.number(),
    lowStock: z.number(), outOfStock: z.number(), slowMoving: z.number(), deadStock: z.number(),
    slowCapital: z.number(), slowCapitalComplete: z.boolean(),
    items: z.array(z.object({
      id: z.string(), category: categorySchema, name: z.string(), quantity: z.number(), safetyThreshold: z.number().nullable(),
      value: z.number().nullable(), lastSaleDate: z.string().nullable(), daysSinceSale: z.number().nullable(),
      status: z.enum(["out", "low", "dead", "slow", "active"]), marginPct: z.number().nullable(), shipmentCostSharePct: z.number().nullable(),
    })),
  }),
  shipments: z.object({
    pending: z.number(), inTransit: z.number(), delayed: z.number(),
    recent: z.array(z.object({
      id: z.string(), shipmentNumber: z.string(), status: z.string(), expectedArrivalDate: z.string(),
      supplierName: z.string(), value: z.number().nullable(),
    })),
  }),
  concentration: z.object({ productCount: z.number(), topThreeRevenue: z.number(), topThreeSharePct: z.number() }),
})

export async function fetchDashboardAnalytics(range: DashboardDateRange): Promise<DashboardAnalytics> {
  if (getDatabaseProvider() === "sqlite") return localDashboardAnalytics(range)
  const { data, error } = await getSupabaseClient().rpc("dashboard_analytics", {
    p_start_date: range.start,
    p_end_date: range.end,
  })
  if (error) throw new Error(error.message)
  return dashboardAnalyticsSchema.parse(data)
}

async function localDashboardAnalytics(range: DashboardDateRange): Promise<DashboardAnalytics> {
  const data = await dbGetAll()
  return buildLocalDashboardAnalytics(data, range)
}

interface LocalSaleLine {
  invoiceId: string
  date: string
  category: "weapon" | "accessory" | "ammunition"
  segment: string
  productId: string
  productName: string
  quantity: number
  revenue: number
  cost: number | null
}

const round = (value: number, digits = 4) => Number(value.toFixed(digits))

export function buildLocalDashboardAnalytics(data: AllData, range: DashboardDateRange): DashboardAnalytics {
  const dayMs = 86_400_000
  const startMs = Date.parse(`${range.start}T00:00:00Z`)
  const endMs = Date.parse(`${range.end}T23:59:59Z`)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) throw new Error("Invalid dashboard date range")
  const differenceDays = Math.floor((Date.parse(`${range.end}T00:00:00Z`) - startMs) / dayMs)
  if (differenceDays > 731) throw new Error("Dashboard date range cannot exceed two years")
  const durationDays = differenceDays + 1
  const previousEndMs = startMs - dayMs
  const previousStartMs = startMs - durationDays * dayMs
  const previousStart = new Date(previousStartMs).toISOString().slice(0, 10)
  const previousEnd = new Date(previousEndMs).toISOString().slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  const todayMs = Date.parse(`${today}T00:00:00Z`)
  const dateValue = (date: string) => Date.parse(`${date.slice(0, 10)}T12:00:00Z`)
  const inRange = (date: string, start: number, end: number) => { const time = dateValue(date); return time >= start && time <= end }
  const sales = data.invoices.filter((invoice) => invoice.type === "Sale" && !invoice.voided)
  const weaponById = new Map(data.weapons.map((item) => [item.id, item]))
  const accessoryById = new Map(data.accessories.map((item) => [item.id, item]))
  const ammunitionById = new Map(data.ammunition.map((item) => [item.id, item]))

  const linesFor = (invoices: typeof sales): LocalSaleLine[] => invoices.flatMap((invoice) => {
    const originalTotal = invoice.lineItems.reduce((sum, item) => sum + Math.max(0, Number(item.total ?? item.unitPrice * item.quantity)), 0)
    const invoiceRevenue = invoice.totalNegotiatedAccounting ?? invoice.totalNegotiated
    return invoice.lineItems.map((item) => {
      const originalLineTotal = Math.max(0, Number(item.total ?? item.unitPrice * item.quantity))
      const quantity = Math.max(0, Number(item.quantity ?? 0))
      const category = item.itemType
      const segment = category === "weapon"
        ? weaponById.get(item.itemId)?.weaponType || "weapon"
        : category === "ammunition"
          ? ammunitionById.get(item.itemId)?.caliber || "ammunition"
          : accessoryById.get(item.itemId)?.type || "accessory"
      return {
        invoiceId: invoice.id,
        date: invoice.date,
        category,
        segment,
        productId: item.itemId || item.name,
        productName: item.name || item.itemId,
        quantity,
        revenue: originalTotal > 0 ? invoiceRevenue * originalLineTotal / originalTotal : 0,
        cost: typeof item.unitLandedCostAccounting === "number" ? item.unitLandedCostAccounting * quantity : null,
      }
    })
  })

  const summarize = (start: number, end: number) => {
    const invoices = sales.filter((invoice) => inRange(invoice.date, start, end))
    const lines = linesFor(invoices)
    const revenue = invoices.reduce((sum, invoice) => sum + (invoice.totalNegotiatedAccounting ?? invoice.totalNegotiated), 0)
    const cost = lines.reduce((sum, line) => sum + (line.cost ?? 0), 0)
    const complete = invoices.length === 0 || invoices.every((invoice) => invoice.lineItems.length > 0
      && invoice.lineItems.every((item) => typeof item.unitLandedCostAccounting === "number"))
    const unitsSold = lines.reduce((sum, line) => sum + line.quantity, 0)
    const receivables = invoices.reduce((sum, invoice) => sum + (invoice.balanceAccounting ?? invoice.balance), 0)
    const overdue = invoices.filter((invoice) => invoice.dueDate < today && (invoice.balanceAccounting ?? invoice.balance) > 0)
      .reduce((sum, invoice) => sum + (invoice.balanceAccounting ?? invoice.balance), 0)
    const profit = complete ? revenue - cost : null
    return {
      revenue: round(revenue), cost: round(cost), profit: profit == null ? null : round(profit),
      marginPct: profit != null && revenue > 0 ? round(profit * 100 / revenue, 2) : invoices.length === 0 ? 0 : null,
      orderCount: invoices.length, unitsSold, costCoveragePct: lines.length ? round(lines.filter((line) => line.cost != null).length * 100 / lines.length, 1) : 100,
      receivables: round(receivables), overdue: round(overdue),
    }
  }
  const current = summarize(startMs, endMs)
  const previous = summarize(previousStartMs, previousEndMs)
  const currentInvoices = sales.filter((invoice) => inRange(invoice.date, startMs, endMs))
  const currentLines = linesFor(currentInvoices)
  const bucket = differenceDays <= 31 ? "day" as const : differenceDays <= 180 ? "week" as const : "month" as const
  const bucketDate = (date: string) => {
    if (bucket === "day") return date.slice(0, 10)
    const parsed = new Date(`${date.slice(0, 10)}T00:00:00Z`)
    if (bucket === "month") return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-01`
    const weekday = (parsed.getUTCDay() + 6) % 7
    parsed.setUTCDate(parsed.getUTCDate() - weekday)
    return parsed.toISOString().slice(0, 10)
  }
  const trendMap = new Map<string, { revenue: number; cost: number; lines: number; covered: number; complete: boolean }>()
  for (const invoice of currentInvoices) {
    const date = bucketDate(invoice.date)
    const metric = trendMap.get(date) ?? { revenue: 0, cost: 0, lines: 0, covered: 0, complete: true }
    const invoiceLines = currentLines.filter((line) => line.invoiceId === invoice.id)
    metric.revenue += invoice.totalNegotiatedAccounting ?? invoice.totalNegotiated
    metric.cost += invoiceLines.reduce((sum, line) => sum + (line.cost ?? 0), 0)
    metric.lines += invoiceLines.length
    metric.covered += invoiceLines.filter((line) => line.cost != null).length
    metric.complete = metric.complete && invoiceLines.length > 0 && invoiceLines.every((line) => line.cost != null)
    trendMap.set(date, metric)
  }

  type SalesAccumulator = { category: LocalSaleLine["category"]; segment: string; name: string; revenue: number; cost: number; units: number; lines: number; covered: number }
  const accumulate = (keyFor: (line: LocalSaleLine) => string, nameFor: (line: LocalSaleLine) => string) => {
    const result = new Map<string, SalesAccumulator>()
    for (const line of currentLines) {
      const key = keyFor(line)
      const metric = result.get(key) ?? { category: line.category, segment: line.segment, name: nameFor(line), revenue: 0, cost: 0, units: 0, lines: 0, covered: 0 }
      metric.revenue += line.revenue
      metric.cost += line.cost ?? 0
      metric.units += line.quantity
      metric.lines++
      if (line.cost != null) metric.covered++
      result.set(key, metric)
    }
    return result
  }
  const categoryMetrics = accumulate((line) => `${line.category}:${line.segment}`, (line) => line.segment)
  const productMetrics = accumulate((line) => `${line.category}:${line.productName.toLocaleLowerCase("en")}`, (line) => line.productName)
  const salesSince = new Map<string, string>()
  for (const invoice of sales.filter((item) => dateValue(item.date) >= todayMs - 180 * dayMs)) {
    for (const line of invoice.lineItems) {
      const key = `${line.itemType}:${line.itemId}`
      const previousDate = salesSince.get(key)
      if (!previousDate || invoice.date > previousDate) salesSince.set(key, invoice.date)
    }
  }
  const inventoryItem = (input: {
    id: string; category: DashboardInventoryItem["category"]; name: string; quantity: number; safetyThreshold: number | null;
    dateAdded: string; unitCost: number | null; retailPrice: number | null; shipmentCost: number | null;
  }): DashboardInventoryItem => {
    const lastSaleDate = salesSince.get(`${input.category}:${input.id}`) ?? null
    const daysSinceSale = lastSaleDate ? Math.max(0, Math.floor((todayMs - Date.parse(`${lastSaleDate}T00:00:00Z`)) / dayMs)) : null
    const ageDays = Math.max(0, Math.floor((todayMs - Date.parse(`${input.dateAdded}T00:00:00Z`)) / dayMs))
    const status = input.quantity <= 0 ? "out" as const
      : input.safetyThreshold != null && input.quantity <= input.safetyThreshold ? "low" as const
        : ageDays >= 180 && (daysSinceSale == null || daysSinceSale >= 180) ? "dead" as const
          : ageDays >= 90 && (daysSinceSale == null || daysSinceSale >= 90) ? "slow" as const : "active" as const
    return {
      id: input.id, category: input.category, name: input.name, quantity: input.quantity, safetyThreshold: input.safetyThreshold,
      value: input.unitCost == null ? null : round(input.unitCost * input.quantity), lastSaleDate, daysSinceSale, status,
      marginPct: input.unitCost != null && input.retailPrice != null && input.retailPrice > 0 ? round((input.retailPrice - input.unitCost) * 100 / input.retailPrice, 2) : null,
      shipmentCostSharePct: input.unitCost != null && input.unitCost > 0 && input.shipmentCost != null ? round(input.shipmentCost * 100 / input.unitCost, 2) : null,
    }
  }
  const inventoryItems: DashboardInventoryItem[] = [
    ...data.weapons.filter((item) => item.status === "Available").map((item) => inventoryItem({
      id: item.id, category: "weapon", name: `${item.brand} ${item.model}`.trim() || item.id, quantity: 1, safetyThreshold: null,
      dateAdded: item.dateAdded, unitCost: item.costSnapshot ? Number(item.costSnapshot.finalLandedBaseAmount) : item.purchasePriceValuation?.accountingAmount ?? null,
      retailPrice: item.retailPriceValuation?.accountingAmount ?? null, shipmentCost: item.costSnapshot ? Number(item.costSnapshot.shipmentCostsBaseAmount) : null,
    })),
    ...data.accessories.map((item) => inventoryItem({
      id: item.id, category: "accessory", name: item.name, quantity: item.quantity, safetyThreshold: item.safetyThreshold,
      dateAdded: item.dateAdded, unitCost: item.costSnapshot ? Number(item.costSnapshot.finalLandedBaseAmount) : item.priceValuation?.accountingAmount ?? null,
      retailPrice: item.retailPriceValuation?.accountingAmount ?? null, shipmentCost: item.costSnapshot ? Number(item.costSnapshot.shipmentCostsBaseAmount) : null,
    })),
    ...data.ammunition.map((item) => inventoryItem({
      id: item.id, category: "ammunition", name: item.name || item.caliber,
      quantity: item.fullPackages * item.unitsPerPackage + item.looseRounds, safetyThreshold: item.safetyThreshold,
      dateAdded: item.dateAdded, unitCost: item.costSnapshot ? Number(item.costSnapshot.finalLandedBaseAmount) : item.priceValuation?.accountingAmount ?? null,
      retailPrice: item.retailPriceValuation?.accountingAmount ?? null, shipmentCost: item.costSnapshot ? Number(item.costSnapshot.shipmentCostsBaseAmount) : null,
    })),
  ]
  const positiveInventory = inventoryItems.filter((item) => item.quantity > 0)
  const valued = positiveInventory.filter((item) => item.value != null)
  const slowItems = inventoryItems.filter((item) => item.status === "slow" || item.status === "dead")
  const statusPriority = { out: 1, low: 2, dead: 3, slow: 4, active: 5 } as const
  const supplierNames = new Map(data.suppliers.map((supplier) => [supplier.id, supplier.name]))
  const categoryResults = [...categoryMetrics.values()].map((metric) => ({
    category: metric.category, segment: metric.segment, revenue: round(metric.revenue), cost: round(metric.cost),
    profit: metric.covered === metric.lines ? round(metric.revenue - metric.cost) : null,
    marginPct: metric.covered === metric.lines && metric.revenue > 0 ? round((metric.revenue - metric.cost) * 100 / metric.revenue, 2) : null,
    units: metric.units, costCoveragePct: round(metric.covered * 100 / metric.lines, 1),
  })).sort((left, right) => right.revenue - left.revenue)
  const productResults = [...productMetrics.entries()].map(([key, metric]) => ({
    key, category: metric.category, name: metric.name, revenue: round(metric.revenue), cost: round(metric.cost),
    profit: metric.covered === metric.lines ? round(metric.revenue - metric.cost) : null,
    marginPct: metric.covered === metric.lines && metric.revenue > 0 ? round((metric.revenue - metric.cost) * 100 / metric.revenue, 2) : null,
    units: metric.units, costCoveragePct: round(metric.covered * 100 / metric.lines, 1),
  })).sort((left, right) => right.revenue - left.revenue)
  const productRevenue = productResults.reduce((sum, item) => sum + item.revenue, 0)
  const topThreeRevenue = productResults.slice(0, 3).reduce((sum, item) => sum + item.revenue, 0)
  return {
    generatedAt: new Date().toISOString(), accountingCurrency: data.settings.accountingCurrencyCode,
    period: { ...range, previousStart, previousEnd, bucket },
    current, previous,
    trend: [...trendMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, metric]) => ({
      date, revenue: round(metric.revenue), profit: metric.complete ? round(metric.revenue - metric.cost) : null,
      costCoveragePct: metric.lines ? round(metric.covered * 100 / metric.lines, 1) : 100,
    })),
    categories: categoryResults,
    products: productResults.slice(0, 12),
    inventory: {
      value: round(valued.reduce((sum, item) => sum + (item.value ?? 0), 0)), valueComplete: valued.length === positiveInventory.length,
      valuationCoveragePct: positiveInventory.length ? round(valued.length / positiveInventory.length * 100, 1) : 100,
      units: inventoryItems.reduce((sum, item) => sum + item.quantity, 0), lowStock: inventoryItems.filter((item) => item.status === "low").length,
      outOfStock: inventoryItems.filter((item) => item.status === "out").length, slowMoving: slowItems.length,
      deadStock: inventoryItems.filter((item) => item.status === "dead").length,
      slowCapital: round(slowItems.reduce((sum, item) => sum + (item.value ?? 0), 0)),
      slowCapitalComplete: slowItems.every((item) => item.value != null),
      items: [...inventoryItems].sort((left, right) => statusPriority[left.status] - statusPriority[right.status] || (right.value ?? -1) - (left.value ?? -1)).slice(0, 12),
    },
    shipments: {
      pending: data.shipments.filter((item) => item.status === "Pending" || item.status === "Partial").length,
      inTransit: data.shipments.filter((item) => item.status === "In Transit").length,
      delayed: data.shipments.filter((item) => item.status === "Delayed").length,
      recent: data.shipments.filter((item) => item.status !== "Cancelled")
        .sort((left, right) => (right.createdAt ?? right.shipmentDate).localeCompare(left.createdAt ?? left.shipmentDate)).slice(0, 5)
        .map((item) => ({ id: item.id, shipmentNumber: item.shipmentNumber, status: item.status, expectedArrivalDate: item.expectedArrivalDate, supplierName: supplierNames.get(item.supplierId) ?? "", value: item.totalCostValuation?.accountingAmount ?? null })),
    },
    concentration: { productCount: productResults.length, topThreeRevenue: round(topThreeRevenue), topThreeSharePct: productRevenue > 0 ? round(topThreeRevenue * 100 / productRevenue, 1) : 0 },
  }
}
