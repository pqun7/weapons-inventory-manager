import type { DashboardAnalytics, DashboardDateRange, DashboardPeriodPreset, DashboardTrendPoint } from "./types"

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function dashboardRangeForPreset(preset: Exclude<DashboardPeriodPreset, "custom">, now = new Date()): DashboardDateRange {
  const end = startOfLocalDay(now)
  let start = new Date(end)

  if (preset === "week") {
    const mondayOffset = (end.getDay() + 6) % 7
    start.setDate(end.getDate() - mondayOffset)
  } else if (preset === "month") {
    start = new Date(end.getFullYear(), end.getMonth(), 1)
  } else if (preset === "quarter") {
    start = new Date(end.getFullYear(), Math.floor(end.getMonth() / 3) * 3, 1)
  } else if (preset === "year") {
    start = new Date(end.getFullYear(), 0, 1)
  }

  return { start: toIsoDate(start), end: toIsoDate(end) }
}

export function isValidDashboardRange(range: DashboardDateRange): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(range.start)
    && /^\d{4}-\d{2}-\d{2}$/.test(range.end)
    && range.start <= range.end
}

function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`)
}

function toUtcIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function startOfBucket(value: string, bucket: DashboardAnalytics["period"]["bucket"]): Date {
  const date = parseIsoDate(value)
  if (bucket === "week") date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  if (bucket === "month") date.setUTCDate(1)
  return date
}

/** Fill empty calendar buckets so a single sale renders as a visible peak. */
export function completeDashboardTrend(
  points: DashboardTrendPoint[],
  period: DashboardAnalytics["period"],
): DashboardTrendPoint[] {
  const existing = new Map(points.map((point) => [point.date, point]))
  const cursor = startOfBucket(period.start, period.bucket)
  const end = startOfBucket(period.end, period.bucket)
  const result: DashboardTrendPoint[] = []

  while (cursor <= end) {
    const date = toUtcIsoDate(cursor)
    result.push(existing.get(date) ?? { date, revenue: 0, profit: 0, costCoveragePct: 100 })
    if (period.bucket === "month") cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    else cursor.setUTCDate(cursor.getUTCDate() + (period.bucket === "week" ? 7 : 1))
  }

  return result
}
