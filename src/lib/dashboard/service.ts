import { z } from "zod"
import { getSupabaseClient } from "@/lib/supabase/client"
import type { DashboardAnalytics, DashboardDateRange } from "./types"

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
  const { data, error } = await getSupabaseClient().rpc("dashboard_analytics", {
    p_start_date: range.start,
    p_end_date: range.end,
  })
  if (error) throw new Error(error.message)
  return dashboardAnalyticsSchema.parse(data)
}
