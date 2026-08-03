import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"

vi.mock("@/lib/db", () => ({
  initDb: vi.fn().mockResolvedValue(undefined),
  seedDemoDataIfNeeded: vi.fn().mockResolvedValue(undefined),
  dbGetAll: vi.fn().mockResolvedValue({
    weapons: [], accessories: [], ammunition: [], shipments: [],
    invoices: [], payments: [], customers: [], suppliers: [],
    auditLogs: [], notifications: [], users: [], settings: {
      currencySymbol: "$", currencyCode: "USD", supportedCurrencies: ["USD"],
      currencyFrequency: {}, taxPercent: 0, invoiceHeader: "", invoiceFooter: "",
      storeLogo: "", thermalPrinterWidth: 80, labelFormat: "Standard",
      hourlySnapshot: true, dailyClosingPrompt: true, weeklyVerification: false,
      minProfitMarginPercent: 5,
    },
  }),
}))

import { useStore } from "@/lib/store"
import { useAppBootstrap } from "@/hooks/use-app-bootstrap"

describe("useAppBootstrap", () => {
  beforeEach(() => {
    useStore.setState({ ready: false })
    localStorage.clear()
  })

  it("sets ready to true after bootstrap completes", async () => {
    const { result } = renderHook(() => useAppBootstrap())

    await waitFor(() => {
      expect(result.current.ready).toBe(true)
    })
    expect(result.current.error).toBeNull()
  })
})
