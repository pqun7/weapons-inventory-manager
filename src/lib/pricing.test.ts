import { describe, expect, it } from "vitest"
import {
  applyCostChange, calculateMargin, calculateRecommendedPrice,
  calculateRecommendedPrices, validateSellingPrice,
} from "@/lib/pricing"

describe("pricing domain", () => {
  it("uses margin-based pricing and commercial currency rounding", () => {
    expect(calculateRecommendedPrice(100, 30, 200, 2)).toBe(142.86)
    expect(calculateMargin(100, 150)).toBeCloseTo(33.3333, 4)
  })

  it("keeps wholesale at or below retail and respects maximum markup", () => {
    const result = calculateRecommendedPrices(100, {
      retailMarginPercent: 60, wholesaleMarginPercent: 20,
      minimumMarginPercent: 5, maximumMarkupPercent: 50, decimalPrecision: 2,
    })
    expect(result.retail).toBe(150)
    expect(result.wholesale).toBe(125)
  })

  it("preserves manual overrides when final cost changes", () => {
    expect(applyCostChange({ value: 180, mode: "manual" }, 160)).toEqual({ value: 180, mode: "manual" })
    expect(applyCostChange({ value: 150, mode: "auto" }, 160)).toEqual({ value: 160, mode: "auto" })
  })

  it("rejects non-positive and below-cost prices", () => {
    expect(validateSellingPrice(100, 0, 5)).toMatch(/greater than zero/i)
    expect(validateSellingPrice(100, 90, 5)).toMatch(/below final cost/i)
    expect(validateSellingPrice(100, 101, 5)).toMatch(/minimum margin/i)
    expect(validateSellingPrice(100, 120, 5)).toBeNull()
  })

  it("never leaks NaN or Infinity into recommendations", () => {
    expect(() => calculateRecommendedPrice(Number.NaN, 30, 200, 2)).toThrow()
    expect(() => calculateRecommendedPrice(100, 100, 200, 2)).toThrow()
  })
})
