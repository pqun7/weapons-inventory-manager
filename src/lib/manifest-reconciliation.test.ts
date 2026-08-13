import { describe, expect, it } from "vitest"
import { reconcileExtractedItems } from "../../electron/services/manifest-reconciliation"
import { verifyManifestExtraction } from "../../electron/services/manifest-verification"
import { buildStructureAwareChunks } from "../../electron/services/openai-manifest-service"
import type { NativeExtraction, ParsedManifestItem } from "../../electron/services/manifest-parser"

function item(overrides: Partial<ParsedManifestItem> = {}): ParsedManifestItem {
  return {
    rowIndex: 1,
    productType: "weapon",
    productName: "Hatsan Flash Air Rifle 5.5mm",
    category: "5.5mm Air Rifle",
    weaponType: "Air Rifle",
    manufacturer: "Hatsan",
    model: "FLASH",
    caliber: "5.5mm",
    sku: null,
    productCode: null,
    serialNumber: null,
    serialNumbers: [],
    quantity: 1,
    unitPrice: null,
    totalPrice: null,
    currency: null,
    countryOfOrigin: null,
    weaponTypeId: null,
    weaponSubtypeId: null,
    brandId: null,
    modelId: null,
    caliberId: null,
    storageLocationId: null,
    confidence: { productName: 0.98, productType: 0.95, weaponType: 0.95, manufacturer: 0.98, model: 0.9, caliber: 0.95, quantity: 0.98 },
    source: { sheet: "Manifest", row: 2, column: "A" },
    rawData: { _extraction: { evidence: [{ field: "manufacturer", method: "spreadsheet-cell", confidence: 0.98 }] } },
    ...overrides,
  }
}

describe("field-level manifest reconciliation", () => {
  it("never merges rows whose explicit serial sets conflict", () => {
    const native = item({ serialNumber: "AAA-000001", serialNumbers: ["AAA-000001"] })
    const ai = item({ serialNumber: "BBB-000001", serialNumbers: ["BBB-000001"], source: { sheet: "Manifest", row: 2 } })
    expect(reconcileExtractedItems([native], [ai])).toHaveLength(2)
  })

  it("keeps explicit native evidence and records a conflicting AI value", () => {
    const native = item()
    const ai = item({ manufacturer: "HAT SAN OCR", confidence: { ...item().confidence, manufacturer: 1 } })
    const [merged] = reconcileExtractedItems([native], [ai])
    expect(merged.manufacturer).toBe("Hatsan")
    expect((merged.rawData._reconciliation as { conflicts: unknown[] }).conflicts).toHaveLength(1)
    expect(merged.confidence.manufacturer).toBe(0.98)
  })
})

describe("extraction verification", () => {
  it("reports mismatches, duplicate serials, and unprocessed DOCX images", () => {
    const nativeExtraction: NativeExtraction = {
      kind: "document",
      sheets: [],
      text: "",
      raw: {},
      document: {
        format: "docx", tables: [], paragraphs: [], headers: [], footers: [], textboxes: [], warnings: [], structureQuality: "structured", requiresVisualAnalysis: true,
        images: [{ id: "image-1", fileName: "scan.png", mimeType: "image/png", byteLength: 10, relationshipIds: [] }],
      },
    }
    const result = verifyManifestExtraction({
      items: [
        item({ rowIndex: 1, quantity: 2, serialNumbers: ["DUP-000001"] }),
        item({ rowIndex: 2, quantity: 1, serialNumbers: ["DUP-000001"] }),
      ],
      nativeExtraction,
      visualAnalysisCompleted: false,
    })
    expect(result.verification.anomalies.map((anomaly) => anomaly.code)).toEqual(expect.arrayContaining([
      "quantity_serial_mismatch", "duplicate_serial", "incomplete_extraction",
    ]))
    expect(result.verification.complete).toBe(false)
    expect(result.verification.qualityScore).toBeLessThan(100)
    expect((result.items[0].rawData._verification as { anomalies: unknown[] }).anomalies.length).toBeGreaterThan(0)
  })
})

describe("structure-aware AI chunking", () => {
  it("splits between rows and repeats labelled header context", () => {
    const extraction: NativeExtraction = {
      kind: "spreadsheet",
      sheets: [{
        name: "Items",
        rows: [
          { row: 1, cells: [{ column: "A", value: "Product" }, { column: "B", value: "Quantity" }, { column: "C", value: "Serial No" }] },
          ...Array.from({ length: 12 }, (_, index) => ({ row: index + 2, cells: [{ column: "A", value: `Product ${index + 1} with a complete description` }, { column: "B", value: 1 }, { column: "C", value: `SERIAL-${String(index + 1).padStart(6, "0")}` }] })),
        ],
      }],
      text: `# Source file: test.xlsx\n${"x".repeat(2_000)}`,
      raw: {},
    }
    const chunks = buildStructureAwareChunks(extraction, 420)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.includes("Repeated header context"))).toBe(true)
    for (let row = 2; row <= 13; row++) expect(chunks.filter((chunk) => new RegExp(`^${row}\\tA:Product`, "m").test(chunk))).toHaveLength(1)
  })
})
