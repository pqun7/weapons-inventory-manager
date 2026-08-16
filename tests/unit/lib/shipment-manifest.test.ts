import { describe, expect, it } from "vitest"
import {
  assertManifestTransition, canTransitionManifest, normalizeCaliber, normalizeSerial, summarizeItemStatuses,
} from "@/lib/shipment-manifest"

describe("shipment manifest domain rules", () => {
  it("enforces the canonical shipment state machine", () => {
    expect(canTransitionManifest("processing", "pending_review")).toBe(true)
    expect(canTransitionManifest("scheduled", "arrived")).toBe(true)
    expect(canTransitionManifest("scheduled", "received")).toBe(false)
    expect(canTransitionManifest("pending_review", "received")).toBe(false)
    expect(() => assertManifestTransition("scheduled", "received")).toThrow(/Invalid shipment workflow transition/)
    expect(() => assertManifestTransition("received", "processing")).toThrow()
  })

  it("normalizes serials and common caliber variants without inventing values", () => {
    expect(normalizeSerial(" ab 123 ")).toBe("AB123")
    expect(normalizeCaliber("9 × 19")).toBe("9x19mm")
    expect(normalizeCaliber("9 MM")).toBe("9mm")
    expect(normalizeCaliber("5,5")).toBe("5.5mm")
    expect(normalizeCaliber("20 gauge")).toBe("20 GA")
    expect(normalizeCaliber("12/71")).toBe("12 GA (12/71)")
    expect(normalizeCaliber("20/76")).toBe("20 GA (20/76)")
    expect(normalizeCaliber(null)).toBeNull()
  })

  it("summarizes review states", () => {
    expect(summarizeItemStatuses([
      { status: "valid" }, { status: "needs_review" }, { status: "duplicate" }, { status: "conflict" }, { status: "invalid" },
    ])).toEqual({ valid: 1, needsReview: 1, invalid: 1, duplicate: 1, conflict: 1 })
  })
})
