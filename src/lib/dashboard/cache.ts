import type { DashboardAnalytics } from "./types"

export const dashboardAnalyticsCache = new Map<string, { data: DashboardAnalytics; fetchedAt: number }>()

export function invalidateDashboardAnalyticsCache(): void {
  dashboardAnalyticsCache.clear()
}
