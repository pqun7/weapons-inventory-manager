import { describe, expect, it } from "vitest"
import { buildManifestReviewProblems } from "@/lib/manifest-review-problems"
import type { ManifestReviewItem, ShipmentManifestReview } from "@/lib/shipment-manifest"

function item(overrides: Partial<ManifestReviewItem> = {}): ManifestReviewItem {
  return {
    id: "item-1", rowIndex: 2, productType: "weapon", productName: "G17", category: null,
    weaponType: "Pistol", manufacturer: null, model: "G17", caliber: "9mm", sku: null,
    productCode: null, serialNumber: "S-1", serialNumbers: ["S-1"], quantity: 1, unitPrice: null,
    totalPrice: null, currency: "USD", countryOfOrigin: null, weaponTypeId: null, weaponSubtypeId: null,
    brandId: null, modelId: null, caliberId: null, storageLocationId: null, confidence: {}, source: {},
    rawData: {}, status: "needs_review", issues: [], ...overrides,
  }
}

function review(items: ManifestReviewItem[]): ShipmentManifestReview {
  return {
    id: "review-1", shipmentId: null, status: "pending_review", fileName: "manifest.xlsx",
    fileType: "application/xlsx", fileSize: 100, fileHash: "hash", shipmentNumber: null,
    supplierName: null, supplierId: null, supplierReference: null, invoiceNumber: null,
    manifestNumber: null, shipmentDate: null, expectedArrivalDate: null, origin: null, destination: null,
    currency: "USD", reviewNote: null, additionalCosts: [], aiProvider: null, aiModel: null,
    aiRequestId: null, aiProcessingMs: null, processingWarning: null, promptVersion: null,
    schemaVersion: "1", validationSummary: { valid: 0, needsReview: 1, invalid: 0, duplicate: 0, conflict: 0 },
    extractionVerification: {
      qualityScore: 70, evidenceCoverage: 80, complete: false, anomalyCounts: { warnings: 1, errors: 1 },
      anomalies: [
        { code: "missing_critical_field", severity: "error", message: "missing", itemRowIndex: 2, fieldName: "unitPrice" },
        { code: "low_confidence", severity: "warning", message: "low", itemRowIndex: 2, fieldName: "model" },
        { code: "incomplete_extraction", severity: "warning", message: "images" },
      ],
    },
    items, issues: [{ id: "issue-1", itemId: "item-1", fieldName: "unitPrice", code: "PRICE", severity: "warning", message: "price" }],
    createdAt: "2026-08-17T00:00:00Z", updatedAt: "2026-08-17T00:00:00Z",
  }
}

describe("manifest review problem grouping", () => {
  it("groups exact missing weapon fields by row and removes duplicate generic checks", () => {
    const result = buildManifestReviewProblems(review([item()]), new Map([["item-1", ["unitPrice", "manufacturer", "weaponSubtype"]]]))
    expect(result.affectedItemCount).toBe(1)
    expect(result.missingFieldCount).toBe(3)
    expect(result.items[0]).toMatchObject({ rowIndex: 2, productType: "weapon", productName: "G17" })
    expect(result.items[0].missingFields).toEqual(["unitPrice", "manufacturer", "weaponSubtype"])
    expect(result.items[0].anomalies.map((anomaly) => anomaly.code)).toEqual(["low_confidence"])
    expect(result.items[0].validationIssues).toEqual([])
    expect(result.documentAnomalies.map((anomaly) => anomaly.code)).toEqual(["incomplete_extraction"])
    expect(result.totalCount).toBe(5)
  })

  it("removes resolved quantity checks and duplicate mapping warnings after the row is corrected", () => {
    const serialNumbers = Array.from({ length: 202 }, (_, index) => `S-${index + 1}`)
    const current = item({ quantity: 202, serialNumbers, serialNumber: serialNumbers[0], model: null })
    const currentReview = review([current])
    currentReview.extractionVerification!.anomalies = [{
      code: "quantity_serial_mismatch", severity: "warning", message: "old mismatch",
      itemRowIndex: 2, fieldName: "quantity", details: { quantity: 203, serialCount: 202 },
    }]
    currentReview.issues = [{
      id: "mapping", itemId: "item-1", fieldName: null, code: "MASTER_DATA_MAPPING_REQUIRED",
      severity: "warning", message: "mapping",
    }]

    const result = buildManifestReviewProblems(currentReview, new Map([[
      "item-1", ["unitPrice", "manufacturer", "model"],
    ]]))

    expect(result.items[0].missingFields).toEqual(["unitPrice", "manufacturer", "model"])
    expect(result.items[0].anomalies).toEqual([])
    expect(result.items[0].validationIssues).toEqual([])
    expect(result.otherCheckCount).toBe(0)
    expect(result.totalCount).toBe(3)
  })

  it("uses the current quantity and serial count when a mismatch still exists", () => {
    const currentReview = review([item({ quantity: 5, serialNumbers: ["1", "2", "3", "4"] })])
    currentReview.extractionVerification!.anomalies = [{
      code: "quantity_serial_mismatch", severity: "warning", message: "old mismatch",
      itemRowIndex: 2, fieldName: "quantity", details: { quantity: 203, serialCount: 202 },
    }]

    const result = buildManifestReviewProblems(currentReview, new Map())
    expect(result.items[0].anomalies[0].details).toMatchObject({ quantity: 5, serialCount: 4 })
  })
})
