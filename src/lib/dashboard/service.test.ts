import { describe, expect, it } from "vitest"
import type { AllData } from "@/lib/db"
import { buildLocalDashboardAnalytics } from "./service"

describe("local dashboard provider parity", () => {
  it("calculates revenue, landed cost, profit, segments, products, inventory, and concentration", () => {
    const data = {
      weapons: [{
        id: "W1", status: "Available", weaponType: "Pistol", brand: "Brand", model: "Model", dateAdded: "2026-08-01",
        purchasePriceValuation: { accountingAmount: 100 }, retailPriceValuation: { accountingAmount: 250 },
      }],
      accessories: [{
        id: "A1", name: "Case", type: "Case", quantity: 2, safetyThreshold: 1, dateAdded: "2026-08-01",
        priceValuation: { accountingAmount: 25 }, retailPriceValuation: { accountingAmount: 50 },
      }],
      ammunition: [{
        id: "M1", name: "Ammo", caliber: "9mm", fullPackages: 0, unitsPerPackage: 50, looseRounds: 0,
        safetyThreshold: 20, dateAdded: "2026-08-01", priceValuation: { accountingAmount: 1 },
        retailPriceValuation: { accountingAmount: 2 },
      }],
      shipments: [{ id: "S1", shipmentNumber: "SHIP-1", supplierId: "SUP1", shipmentDate: "2026-08-01", expectedArrivalDate: "2026-08-20", status: "Pending", createdAt: "2026-08-01T10:00:00Z" }],
      invoices: [{
        id: "I1", type: "Sale", voided: false, date: "2026-08-10", dueDate: "2026-08-11",
        totalNegotiated: 300, totalNegotiatedAccounting: 300, balance: 100, balanceAccounting: 100,
        lineItems: [
          { itemType: "weapon", itemId: "W1", name: "Brand Model", quantity: 1, unitPrice: 200, total: 200, unitLandedCostAccounting: 100 },
          { itemType: "accessory", itemId: "A1", name: "Case", quantity: 2, unitPrice: 50, total: 100, unitLandedCostAccounting: 25 },
        ],
      }],
      payments: [], customers: [], suppliers: [{ id: "SUP1", name: "Supplier" }], auditLogs: [], notifications: [], users: [],
      settings: { accountingCurrencyCode: "USD" }, savedFilters: [], inventoryProductTypes: [],
    } as unknown as AllData

    const analytics = buildLocalDashboardAnalytics(data, { start: "2026-08-01", end: "2026-08-31" })
    expect(analytics.current).toMatchObject({ revenue: 300, cost: 150, profit: 150, marginPct: 50, orderCount: 1, unitsSold: 3, costCoveragePct: 100 })
    expect(analytics.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "weapon", segment: "Pistol", revenue: 200, cost: 100, profit: 100 }),
      expect.objectContaining({ category: "accessory", segment: "Case", revenue: 100, cost: 50, profit: 50 }),
    ]))
    expect(analytics.products).toHaveLength(2)
    expect(analytics.inventory).toMatchObject({ value: 150, valueComplete: true, units: 3, outOfStock: 1 })
    expect(analytics.shipments).toMatchObject({ pending: 1, inTransit: 0, delayed: 0 })
    expect(analytics.shipments.recent[0].supplierName).toBe("Supplier")
    expect(analytics.concentration).toEqual({ productCount: 2, topThreeRevenue: 300, topThreeSharePct: 100 })
  })

  it("keeps profit unknown when a sale line has no immutable landed-cost snapshot", () => {
    const data = {
      weapons: [], accessories: [], ammunition: [], shipments: [], payments: [], customers: [], suppliers: [], auditLogs: [], notifications: [], users: [], savedFilters: [],
      settings: { accountingCurrencyCode: "USD" },
      invoices: [{
        id: "I2", type: "Sale", voided: false, date: "2026-08-10", dueDate: "2026-08-20",
        totalNegotiated: 75, totalNegotiatedAccounting: 75, balance: 0, balanceAccounting: 0,
        lineItems: [{ itemType: "ammunition", itemId: "MISSING", name: "Unknown cost", quantity: 3, unitPrice: 25, total: 75 }],
      }],
    } as unknown as AllData
    const analytics = buildLocalDashboardAnalytics(data, { start: "2026-08-01", end: "2026-08-31" })
    expect(analytics.current).toMatchObject({ revenue: 75, cost: 0, profit: null, marginPct: null, costCoveragePct: 0 })
    expect(analytics.categories[0]).toMatchObject({ profit: null, costCoveragePct: 0 })
  })

  it("does not merge different products that share the same display name", () => {
    const data = {
      weapons: [], accessories: [], ammunition: [], shipments: [], payments: [], customers: [], suppliers: [], auditLogs: [], notifications: [], users: [], savedFilters: [],
      settings: { accountingCurrencyCode: "USD" },
      invoices: [{
        id: "I3", type: "Sale", voided: false, date: "2026-08-10", dueDate: "2026-08-10",
        totalNegotiated: 20, balance: 0,
        lineItems: [
          { itemType: "accessory", itemId: "A1", name: "Case", quantity: 1, unitPrice: 10, total: 10, unitLandedCostAccounting: 2 },
          { itemType: "accessory", itemId: "A2", name: "Case", quantity: 1, unitPrice: 10, total: 10, unitLandedCostAccounting: 3 },
        ],
      }],
    } as unknown as AllData
    const analytics = buildLocalDashboardAnalytics(data, { start: "2026-08-01", end: "2026-08-31" })
    expect(analytics.products).toHaveLength(2)
    expect(analytics.products.map((product) => product.key).sort()).toEqual(["accessory:A1", "accessory:A2"])
  })
})
