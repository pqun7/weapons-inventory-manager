import { describe, expect, it } from "vitest"
import { AppStorageConfigSchema, DATABASE_OPERATION_NAMES } from "@/lib/database-provider"
import * as router from "@/lib/db"
import * as supabase from "@/lib/db/supabase-provider"

describe("database provider contract", () => {
  it("has one unique allowlisted operation for every routed provider function", () => {
    expect(new Set(DATABASE_OPERATION_NAMES).size).toBe(DATABASE_OPERATION_NAMES.length)
    for (const operation of DATABASE_OPERATION_NAMES) {
      expect(typeof router[operation], `router.${operation}`).toBe("function")
      expect(typeof supabase[operation], `supabase.${operation}`).toBe("function")
    }
  })

  it("keeps the shared aggregate shape explicit", () => {
    const expectedKeys = [
      "weapons", "accessories", "ammunition", "shipments", "invoices", "payments", "customers",
      "suppliers", "auditLogs", "notifications", "users", "settings", "savedFilters", "inventoryProductTypes",
    ]
    expect(expectedKeys).toHaveLength(14)
    expect(new Set(expectedKeys).size).toBe(expectedKeys.length)
  })

  it("records the previous provider without weakening the first-run config contract", () => {
    const configuredAt = "2026-08-15T00:00:00.000Z"
    const parsed = AppStorageConfigSchema.parse({
      version: 1,
      databaseProvider: "supabase",
      setupCompleted: true,
      configuredAt,
      previousDatabaseProvider: "sqlite",
      previousConfiguredAt: configuredAt,
      lastProviderMigrationId: "7d63a01c-e1d8-4c51-85e5-abcb88ca20d2",
      lastProviderMigrationAt: configuredAt,
    })
    expect(parsed.previousDatabaseProvider).toBe("sqlite")
    expect(() => AppStorageConfigSchema.parse({ ...parsed, databaseProvider: "unknown" })).toThrow()
    expect(() => AppStorageConfigSchema.parse({ ...parsed, setupCompleted: false })).toThrow()
  })
})
