import { describe, expect, it } from "vitest"
import { cleanMasterDataLabel, findCanonicalMasterId, masterDataKey } from "./master-data-normalization"

describe("dynamic master-data normalization", () => {
  it("matches case, spacing, punctuation, and diacritic variants to one canonical row", () => {
    const rows = [{ id: "br-1", label: "Radelli Arms" }]
    expect(findCanonicalMasterId(rows, "  RADELLI-ARMS ")).toBe("br-1")
    expect(masterDataKey("Radellí Arms")).toBe(masterDataKey("radelli-arms"))
  })

  it("preserves the reviewed display label while removing unsafe whitespace and controls", () => {
    expect(cleanMasterDataLabel("  Retay\u0000   Arms  ", "Manufacturer")).toBe("Retay Arms")
  })

  it("rejects empty and excessively long learned values", () => {
    expect(() => cleanMasterDataLabel("   ", "Model")).toThrow("Model is required")
    expect(() => cleanMasterDataLabel("A".repeat(121), "Model")).toThrow("Model is too long")
  })
})
