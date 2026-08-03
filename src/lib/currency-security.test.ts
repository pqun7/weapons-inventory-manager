import { describe, it, expect, beforeEach, vi } from "vitest"
import { CurrencyService } from "@/lib/currency-service"

vi.mock("@/lib/db", () => {
  let rateStore: Map<string, string> = new Map([
    ["USD", "1"],
    ["EUR", "0.92"],
    ["SAR", "3.75"],
    ["SDG", "600"],
  ])
  let overrideStore: Map<string, { mode: string; manual_rate: string | null; updated_by: string; updated_at: string; reason: string }> = new Map()
  let auditLog: Array<{ code: string; oldRate: string | null; newRate: string | null; changedBy: string; reason: string; changedAt: string }> = []
  let inTx = false
  let txFailed = false

  const engine = {
    init: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(async (cb: () => unknown) => {
      inTx = true
      txFailed = false
      try {
        const result = cb()
        if (txFailed) throw new Error("Transaction failed")
        inTx = false
        return result
      } catch (e) {
        inTx = false
        throw e
      }
    }),
    getCurrencies: vi.fn(() => ({
      data: Array.from(rateStore.entries()).map(([code, rate]) => ({
        iso_code: code,
        name: code,
        symbol: code,
        decimal_precision: 2,
        is_active: 1,
        last_known_rate: rate,
        last_rate_updated_at: null,
      })),
      error: null,
    })),
    getOverrides: vi.fn(() => ({
      data: Array.from(overrideStore.entries()).map(([code, o]) => ({
        currency_code: code,
        mode: o.mode,
        manual_rate: o.manual_rate,
        updated_by: o.updated_by,
        updated_at: o.updated_at,
        reason: o.reason,
      })),
      error: null,
    })),
    updateCurrencyRate: vi.fn((code: string, rate: number, updatedAt: string) => {
      rateStore.set(code, String(rate))
      return { data: null, error: null }
    }),
    recordRateHistory: vi.fn(() => ({ data: null, error: null })),
    setManualOverride: vi.fn((code: string, rate: number, changedBy: string, reason: string, updatedAt: string) => {
      overrideStore.set(code, { mode: "manual", manual_rate: String(rate), updated_by: changedBy, updated_at: updatedAt, reason })
      return { data: null, error: null }
    }),
    setAutomaticMode: vi.fn((code: string, changedBy: string, updatedAt: string) => {
      overrideStore.set(code, { mode: "automatic", manual_rate: null, updated_by: changedBy, updated_at: updatedAt, reason: "Switched to automatic" })
      return { data: null, error: null }
    }),
    recordRateAuditLog: vi.fn((code: string, oldRate: number | null, newRate: number | null, changedBy: string, reason: string, changedAt: string) => {
      auditLog.push({ code, oldRate: oldRate != null ? String(oldRate) : null, newRate: newRate != null ? String(newRate) : null, changedBy, reason, changedAt })
      return { data: null, error: null }
    }),
    getRateAuditLog: vi.fn((limit: number) => ({
      data: auditLog.slice(-limit).map((a, i) => ({ id: `ral-${i}`, ...a, oldRate: a.oldRate != null ? Number(a.oldRate) : null, newRate: a.newRate != null ? Number(a.newRate) : null })),
      error: null,
    })),
    addCurrency: vi.fn((code: string, name: string, symbol: string, precision: number, rate: number) => {
      rateStore.set(code, String(rate))
      overrideStore.set(code, { mode: "automatic", manual_rate: null, updated_by: "system", updated_at: new Date().toISOString(), reason: "" })
      return { data: null, error: null }
    }),
    toggleCurrencyActive: vi.fn(() => ({ data: null, error: null })),
    needsDemoData: vi.fn(() => false),
    markDemoDataSeeded: vi.fn(() => ({ data: null, error: null })),
    insertDemoData: vi.fn(() => ({ data: null, error: null })),
    getAll: vi.fn(() => ({ data: null, error: null })),
    getMasterData: vi.fn(() => ({ data: null, error: null })),
  }

  return {
    getDb: vi.fn(async () => engine),
    initDb: vi.fn(async () => {}),
    seedDemoDataIfNeeded: vi.fn(async () => {}),
    dbGetAll: vi.fn(async () => ({ weapons: [], accessories: [], ammunition: [], shipments: [], invoices: [], payments: [], customers: [], suppliers: [], auditLogs: [], notifications: [], users: [], settings: {} })),
    dbGetMasterData: vi.fn(async () => ({ weaponTypes: [], weaponSubtypes: [], calibers: [], subtypeCalibers: [], brands: [], models: [], warehouses: [], storageLocations: [] })),
    dbGetCurrencies: vi.fn(async () => engine.getCurrencies().data),
    dbGetOverrides: vi.fn(async () => engine.getOverrides().data),
    dbUpdateCurrencyRate: vi.fn(async (code: string, rate: number, updatedAt: string) => engine.updateCurrencyRate(code, rate, updatedAt)),
    dbRecordRateHistory: vi.fn(async (code: string, rate: number, source: string) => engine.recordRateHistory(code, rate, source)),
    dbSetManualOverride: vi.fn(async (code: string, rate: number, changedBy: string, reason: string, updatedAt: string) => engine.setManualOverride(code, rate, changedBy, reason, updatedAt)),
    dbSetAutomaticMode: vi.fn(async (code: string, changedBy: string, updatedAt: string) => engine.setAutomaticMode(code, changedBy, updatedAt)),
    dbGetRateAuditLog: vi.fn(async (limit: number) => engine.getRateAuditLog(limit).data),
    dbAddCurrency: vi.fn(async (code: string, name: string, symbol: string, precision: number, rate: number) => engine.addCurrency(code, name, symbol, precision, rate)),
    dbToggleCurrencyActive: vi.fn(async () => engine.toggleCurrencyActive()),
    dbTransaction: vi.fn(async (cb: () => unknown) => engine.transaction(cb)),
    dbRecordRateAuditLog: vi.fn(async (code: string, oldRate: number | null, newRate: number | null, changedBy: string, reason: string, changedAt: string) => engine.recordRateAuditLog(code, oldRate, newRate, changedBy, reason, changedAt)),
    _resetDbForTesting: vi.fn(),
  }
})

describe("CurrencyService RBAC security", () => {
  beforeEach(async () => {
    CurrencyService.clearRateCache()
    await CurrencyService.load()
  })

  it("throws on setManualOverride with non-admin role", async () => {
    await expect(
      CurrencyService.setManualOverride("EUR", 0.95, "Mike", "test", "Sales")
    ).rejects.toThrow("Unauthorized")
  })

  it("throws on setManualOverride with undefined role", async () => {
    await expect(
      CurrencyService.setManualOverride("EUR", 0.95, "Mike", "test", "")
    ).rejects.toThrow("Unauthorized")
  })

  it("succeeds with Admin role (case-insensitive)", async () => {
    await expect(
      CurrencyService.setManualOverride("EUR", 0.95, "Admin User", "test override", "Admin")
    ).resolves.not.toThrow()
  })

  it("succeeds with admin role lowercase", async () => {
    await expect(
      CurrencyService.setManualOverride("SAR", 4.0, "Admin User", "test override", "admin")
    ).resolves.not.toThrow()
  })

  it("throws on setAutomaticMode with non-admin role", async () => {
    await expect(
      CurrencyService.setAutomaticMode("EUR", "Mike", "Sales")
    ).rejects.toThrow("Unauthorized")
  })

  it("succeeds on setAutomaticMode with Admin role", async () => {
    await expect(
      CurrencyService.setAutomaticMode("EUR", "Admin User", "Admin")
    ).resolves.not.toThrow()
  })

  it("throws on setManualOverride with rate <= 0", async () => {
    await expect(
      CurrencyService.setManualOverride("EUR", 0, "Admin", "test", "Admin")
    ).rejects.toThrow("greater than zero")

    await expect(
      CurrencyService.setManualOverride("EUR", -1, "Admin", "test", "Admin")
    ).rejects.toThrow("greater than zero")
  })

  it("throws on addCurrency with precision > 4", async () => {
    await expect(
      CurrencyService.addCurrency("GBP", "British Pound", "£", 5, 0.79)
    ).rejects.toThrow("between 0 and 4")
  })

  it("throws on addCurrency with precision < 0", async () => {
    await expect(
      CurrencyService.addCurrency("GBP", "British Pound", "£", -1, 0.79)
    ).rejects.toThrow("between 0 and 4")
  })

  it("throws on addCurrency with rate <= 0", async () => {
    await expect(
      CurrencyService.addCurrency("GBP", "British Pound", "£", 2, 0)
    ).rejects.toThrow("greater than zero")
  })
})
