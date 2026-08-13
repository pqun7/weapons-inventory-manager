import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"

vi.mock("@/lib/db", () => ({
  AUTHENTICATED_USER_NOT_LINKED: "AUTHENTICATED_USER_NOT_LINKED",
  isDbReady: vi.fn().mockReturnValue(true),
  dbGetCurrentUserId: vi.fn().mockResolvedValue("U001"),
  dbGetUserPreferences: vi.fn().mockResolvedValue(null),
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
      targetRetailMarginPercent: 30,
      targetWholesaleMarginPercent: 20,
      maximumMarkupPercent: 200,
      psychologicalPricing: false,
    },
  }),
}))

const signOut = vi.fn().mockResolvedValue({ error: null })

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => ({ auth: { signOut } }),
}))

import { useStore } from "@/lib/store"
import { useAppBootstrap } from "@/hooks/use-app-bootstrap"

describe("useAppBootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it("clears a stale local session when its application user was removed", async () => {
    useStore.setState({
      ready: false,
      bootstrap: vi.fn().mockRejectedValue(new Error("AUTHENTICATED_USER_NOT_LINKED")),
    })

    const { result } = renderHook(() => useAppBootstrap())

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledWith({ scope: "local" })
    })
    expect(result.current.error).toBeNull()
  })
})
