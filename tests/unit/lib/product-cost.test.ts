// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  calculateAllocationByQuantity,
  calculateAllocationByValue,
  calculateCurrencyConversion,
  calculateEqualAllocation,
  calculateFinalLandedCost,
  calculatePercentageCost,
  calculateShipmentAllocation,
  validateAllocation,
} from "@/lib/product-cost"

const items = [
  { id: "A", value: "5000", quantity: "10" },
  { id: "B", value: "3000", quantity: "20" },
  { id: "C", value: "2000", quantity: "70" },
]

describe("authoritative product cost engine", () => {
  it("calculates percentage costs without binary floating point drift", () => {
    expect(calculatePercentageCost("1000", "5", 2)).toBe("50.00")
    expect(calculatePercentageCost("0.10", "20", 4)).toBe("0.0200")
  })

  it("allocates by product value and selected product value", () => {
    expect(calculateAllocationByValue(items, "1000", 2)).toEqual({ A: "500.00", B: "300.00", C: "200.00" })
    expect(calculateAllocationByValue(items.slice(0, 2), "1000", 2)).toEqual({ A: "625.00", B: "375.00" })
  })

  it("allocates by quantity", () => {
    expect(calculateAllocationByQuantity(items, "1000", 2)).toEqual({ A: "100.00", B: "200.00", C: "700.00" })
  })

  it("handles zero quantities safely when another applicable quantity is positive", () => {
    expect(calculateAllocationByQuantity([
      { id: "A", value: "10", quantity: "0" },
      { id: "B", value: "10", quantity: "5" },
    ], "10", 2)).toEqual({ A: "0.00", B: "10.00" })
  })

  it("reconciles equal allocation deterministically", () => {
    expect(calculateEqualAllocation(items, "100", 2)).toEqual({ A: "33.33", B: "33.33", C: "33.34" })
  })

  it("rejects zero allocation bases and mismatched manual totals", () => {
    expect(() => calculateAllocationByValue([{ id: "A", value: 0, quantity: 1 }], 10, 2)).toThrow(/base/)
    expect(() => validateAllocation({ A: "600", B: "300", C: "200" }, "1000", 2)).toThrow(
      "Allocated costs do not match the shipment cost.",
    )
  })

  it("preserves automatic amounts when a valid manual override is supplied", () => {
    expect(calculateShipmentAllocation("by_value", items, "1000", 2, { A: "600", B: "300", C: "100" })).toEqual([
      { shipmentItemId: "A", automaticAmount: "500.00", finalAmount: "600.00", manualOverride: true, difference: "100.00" },
      { shipmentItemId: "B", automaticAmount: "300.00", finalAmount: "300.00", manualOverride: false, difference: "0.00" },
      { shipmentItemId: "C", automaticAmount: "200.00", finalAmount: "100.00", manualOverride: true, difference: "-100.00" },
    ])
  })

  it("converts with the stored units-per-base rate and calculates landed cost", () => {
    expect(calculateCurrencyConversion("150000", "3000", 4)).toBe("50.0000")
    expect(calculateFinalLandedCost("50", ["5", "3", "1", "2"], [], 2)).toBe("61.00")
  })

  it("remains deterministic for large and very small monetary amounts", () => {
    expect(calculatePercentageCost("999999999999999.9999", "0.0001", 4)).toBe("1000000000.0000")
    expect(calculateEqualAllocation(items, "0.0001", 4)).toEqual({ A: "0.0000", B: "0.0000", C: "0.0001" })
  })
})
