import { describe, expect, it } from "vitest"
import { completeDashboardTrend, dashboardRangeForPreset, isValidDashboardRange } from "./period"

describe("dashboard periods", () => {
  const now = new Date(2026, 7, 13, 15, 30)

  it("uses calendar-equivalent preset boundaries", () => {
    expect(dashboardRangeForPreset("today", now)).toEqual({ start: "2026-08-13", end: "2026-08-13" })
    expect(dashboardRangeForPreset("week", now)).toEqual({ start: "2026-08-10", end: "2026-08-13" })
    expect(dashboardRangeForPreset("month", now)).toEqual({ start: "2026-08-01", end: "2026-08-13" })
    expect(dashboardRangeForPreset("quarter", now)).toEqual({ start: "2026-07-01", end: "2026-08-13" })
    expect(dashboardRangeForPreset("year", now)).toEqual({ start: "2026-01-01", end: "2026-08-13" })
  })

  it("rejects inverted and malformed custom ranges", () => {
    expect(isValidDashboardRange({ start: "2026-08-01", end: "2026-08-13" })).toBe(true)
    expect(isValidDashboardRange({ start: "2026-08-14", end: "2026-08-13" })).toBe(false)
    expect(isValidDashboardRange({ start: "08/01/2026", end: "2026-08-13" })).toBe(false)
  })

  it("fills empty daily trend buckets without changing recorded points", () => {
    expect(completeDashboardTrend(
      [{ date: "2026-08-12", revenue: 100, profit: 30, costCoveragePct: 100 }],
      { start: "2026-08-10", end: "2026-08-13", previousStart: "2026-08-06", previousEnd: "2026-08-09", bucket: "day" },
    )).toEqual([
      { date: "2026-08-10", revenue: 0, profit: 0, costCoveragePct: 100 },
      { date: "2026-08-11", revenue: 0, profit: 0, costCoveragePct: 100 },
      { date: "2026-08-12", revenue: 100, profit: 30, costCoveragePct: 100 },
      { date: "2026-08-13", revenue: 0, profit: 0, costCoveragePct: 100 },
    ])
  })

  it("aligns weekly trend buckets to Monday", () => {
    expect(completeDashboardTrend([], {
      start: "2026-08-01", end: "2026-08-13", previousStart: "2026-07-19", previousEnd: "2026-07-31", bucket: "week",
    }).map((point) => point.date)).toEqual(["2026-07-27", "2026-08-03", "2026-08-10"])
  })
})
