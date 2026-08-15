import { describe, expect, it, vi } from "vitest"
import type { ManifestReviewItem } from "./shipment-manifest"
import type { Shipment, User } from "./types"
import {
  canEditShipmentContents,
  changedManifestPatch,
  commonManifestPatch,
  optimisticShipment,
  removeManifestReviewItems,
  resolveManifestClassification,
  shipmentItemMissingFields,
  shipmentToManifestReview,
  sortShipmentsNewestFirst,
} from "./shipment-workflow"

function item(overrides: Partial<ManifestReviewItem> = {}): ManifestReviewItem {
  return {
    id: "row-1", rowIndex: 1, productType: "weapon", productName: "Glock 19",
    category: "Compact", weaponType: "Pistol", manufacturer: "Glock", model: "19", caliber: "9mm",
    sku: null, productCode: null, serialNumber: "SN-1", serialNumbers: ["SN-1"], quantity: 1,
    unitPrice: 500, retailPrice: 700, wholesalePrice: 650, retailPriceMode: "auto", wholesalePriceMode: "auto",
    additionalCosts: [], totalPrice: 500, currency: "SAR", countryOfOrigin: null,
    weaponTypeId: "wt-pistol", weaponSubtypeId: "ws-compact", brandId: "br-glock",
    modelId: "mdl-19", caliberId: "cal-9mm", storageLocationId: "loc-1",
    confidence: {}, source: {}, rawData: {}, status: "valid", issues: [], ...overrides,
  }
}

const shipment = (id: string, date: string, overrides: Partial<Shipment> = {}): Shipment => ({
  id, shipmentNumber: id, supplierId: "sup-1", shipmentDate: date, expectedArrivalDate: date,
  totalExpectedItems: 1, attachments: [], notes: "", status: "In Transit", timeline: [],
  workflowStatus: "scheduled", ...overrides,
})

describe("shipment item classification", () => {
  it("validates displayed classification values and defers internal ids to confirmation", () => {
    expect(shipmentItemMissingFields(item({ weaponSubtypeId: null }))).not.toContain("weaponSubtype")
    expect(shipmentItemMissingFields(item({ category: null, weaponSubtypeId: null }))).toContain("weaponSubtype")
  })

  it("keeps storage location optional", () => {
    expect(shipmentItemMissingFields(item({ storageLocationId: null }))).not.toContain("storageLocationId")
  })

  it("resolves a subtype within the selected weapon type and persists the complete FK tuple", async () => {
    const master = {
      getWeaponTypeIdByLabel: vi.fn(() => "wt-pistol"),
      getWeaponSubtypeIdByLabel: vi.fn((_label: string, typeId?: string) => typeId === "wt-pistol" ? "ws-compact" : undefined),
      getCaliberIdByLabel: vi.fn(() => "cal-9mm"),
      getBrandIdByLabel: vi.fn(() => "br-glock"),
      getModelIdByLabel: vi.fn(() => "mdl-19"),
      createWeaponType: vi.fn(), createWeaponSubtype: vi.fn(), createCaliber: vi.fn(),
      createBrand: vi.fn(), createModel: vi.fn(), linkSubtypeCaliber: vi.fn(async () => undefined),
    }
    const result = await resolveManifestClassification(item(), master as never)
    expect(master.getWeaponSubtypeIdByLabel).toHaveBeenCalledWith("Compact", "wt-pistol")
    expect(result).toMatchObject({
      weaponTypeId: "wt-pistol", weaponSubtypeId: "ws-compact", caliberId: "cal-9mm",
      brandId: "br-glock", modelId: "mdl-19",
    })
    expect(master.linkSubtypeCaliber).toHaveBeenCalledWith("ws-compact", "cal-9mm")
  })

  it("creates a compatible subtype instead of reusing the same label from another weapon type", async () => {
    const master = {
      getWeaponTypeIdByLabel: vi.fn(() => "wt-rifle"),
      getWeaponSubtypeIdByLabel: vi.fn(() => undefined),
      getCaliberIdByLabel: vi.fn(() => "cal-9mm"), getBrandIdByLabel: vi.fn(() => "br-1"),
      getModelIdByLabel: vi.fn(() => "mdl-1"), createWeaponType: vi.fn(),
      createWeaponSubtype: vi.fn(async () => "ws-rifle-compact"), createCaliber: vi.fn(),
      createBrand: vi.fn(), createModel: vi.fn(), linkSubtypeCaliber: vi.fn(async () => undefined),
    }
    const result = await resolveManifestClassification(item({ weaponType: "Rifle" }), master as never)
    expect(master.createWeaponSubtype).toHaveBeenCalledWith("Rifle", "Compact")
    expect(result.weaponSubtypeId).toBe("ws-rifle-compact")
  })
})

describe("bulk edit shared values", () => {
  it("shows values shared by all selected rows, including reference labels", () => {
    const common = commonManifestPatch([
      item({ id: "1", model: "19" }),
      item({ id: "2", model: "17" }),
    ])
    expect(common.weaponType).toBe("Pistol")
    expect(common.category).toBe("Compact")
    expect(common.manufacturer).toBe("Glock")
    expect(common.model).toBeUndefined()
  })

  it("applies only fields changed from the shared-value snapshot", () => {
    const initial = commonManifestPatch([item({ id: "1" }), item({ id: "2" })])
    expect(changedManifestPatch(initial, { ...initial, unitPrice: 550 })).toEqual({ unitPrice: 550 })
  })
})

describe("shipment list workflow", () => {
  it("sorts newest first without mutating store state and keeps loading rows at the top", () => {
    const original = [shipment("old", "2026-01-01"), shipment("new", "2026-08-01")]
    const sorted = sortShipmentsNewestFirst(original)
    expect(sorted.map((value) => value.id)).toEqual(["new", "old"])
    expect(original.map((value) => value.id)).toEqual(["old", "new"])
    expect(sortShipmentsNewestFirst([...original, shipment("pending", "2025-01-01", { isSaving: true })])[0].id).toBe("pending")
    expect(sortShipmentsNewestFirst([
      shipment("new-business-date", "2026-08-10", { createdAt: "2026-08-11T10:00:00Z" }),
      shipment("newly-added", "2026-01-01", { createdAt: "2026-08-12T10:00:00Z" }),
    ])[0].id).toBe("newly-added")
  })

  it("creates a non-openable processing representation while registration is pending", () => {
    const pending = optimisticShipment({
      shipmentNumber: "S-1", supplierId: "sup-1", shipmentDate: "2026-08-12",
      expectedArrivalDate: "2026-08-20", totalExpectedItems: 2, attachments: [], notes: "",
    }, "TMP-1")
    expect(pending).toMatchObject({ id: "TMP-1", isSaving: true, workflowStatus: "processing" })
  })

  it("allows authorized pre-receipt edits but protects arrived records", () => {
    const user = { role: "Employee", permissions: { canImportExcel: false, "shipment.edit": true } } as User
    expect(canEditShipmentContents(shipment("scheduled", "2026-08-12"), user)).toBe(true)
    expect(canEditShipmentContents(shipment("failed", "2026-08-12", { workflowStatus: "failed" }), user)).toBe(true)
    expect(canEditShipmentContents(shipment("arrived", "2026-08-12", { status: "Arrived" }), user)).toBe(false)
    expect(canEditShipmentContents(shipment("received", "2026-08-12", { workflowStatus: "received" }), user)).toBe(false)
  })
})

describe("shipment manifest row deletion", () => {
  const review = shipmentToManifestReview({
    ...shipment("S-DELETE", "2026-08-12"),
    lineItems: [
      { id: "row-1", productType: "weapon", weaponTypeId: "wt", weaponSubtypeId: "st", caliberId: "cal", brandId: "br", modelId: "mdl", storageLocationId: "loc", quantity: 1, purchasePrice: 1, retailPrice: 1, wholesalePrice: 1, retailPriceMode: "auto", wholesalePriceMode: "auto", serialNumbers: ["SN-1"], currency: "SAR", weaponTypeLabel: "Rifle", subTypeLabel: "Semi auto", caliberLabel: "5.5mm", brandLabel: "Hatsan", modelLabel: "Flash", additionalCosts: [] },
      { id: "row-2", productType: "weapon", weaponTypeId: "wt", weaponSubtypeId: "st", caliberId: "cal", brandId: "br", modelId: "mdl", storageLocationId: "loc", quantity: 1, purchasePrice: 1, retailPrice: 1, wholesalePrice: 1, retailPriceMode: "auto", wholesalePriceMode: "auto", serialNumbers: ["SN-2"], currency: "SAR", weaponTypeLabel: "Shotgun", subTypeLabel: "Pump action", caliberLabel: "12 GA", brandLabel: "Radelli", modelLabel: "R-1", additionalCosts: [] },
      { id: "row-3", productType: "accessory", weaponTypeId: "", weaponSubtypeId: "", caliberId: "", brandId: "", modelId: "", storageLocationId: "loc", quantity: 2, purchasePrice: 1, retailPrice: 1, wholesalePrice: 1, retailPriceMode: "auto", wholesalePriceMode: "auto", serialNumbers: [], currency: "SAR", weaponTypeLabel: "", subTypeLabel: "", caliberLabel: "", brandLabel: "", modelLabel: "Case", additionalCosts: [] },
    ],
  })

  it("deletes one row and immediately recalculates the visible summary", () => {
    const next = removeManifestReviewItems(review, ["row-2"], "2026-08-12T12:00:00.000Z")
    expect(next.items.map((entry) => entry.id)).toEqual(["row-1", "row-3"])
    expect(next.validationSummary.valid + next.validationSummary.needsReview).toBe(2)
    expect(next.updatedAt).toBe("2026-08-12T12:00:00.000Z")
  })

  it("deletes multiple selected rows once even when ids are repeated", () => {
    const next = removeManifestReviewItems(review, ["row-1", "row-1", "row-3"])
    expect(next.items.map((entry) => entry.id)).toEqual(["row-2"])
  })

  it("protects the last product row", () => {
    expect(() => removeManifestReviewItems(review, ["row-1", "row-2", "row-3"])).toThrow(/keep at least one/i)
  })
})
