import { describe, it, expect } from "vitest"
import Decimal from "decimal.js"

Decimal.set({ rounding: Decimal.ROUND_HALF_UP, precision: 28 })

describe("decimal.js precision", () => {
  describe("ROUND_HALF_UP", () => {
    it("rounds 2.5 up to 3", () => {
      expect(new Decimal(2.5).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()).toBe(3)
    })

    it("rounds 3.5 up to 4", () => {
      expect(new Decimal(3.5).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()).toBe(4)
    })

    it("rounds 2.4 down to 2", () => {
      expect(new Decimal(2.4).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()).toBe(2)
    })

    it("rounds 0.125 to 0.13 at 2 decimal places", () => {
      expect(new Decimal(0.125).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()).toBe(0.13)
    })

    it("rounds 0.135 to 0.14 at 2 decimal places", () => {
      expect(new Decimal(0.135).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()).toBe(0.14)
    })
  })

  describe("roundAccounting (4 decimal places)", () => {
    const roundAccounting = (amount: number) =>
      new Decimal(amount).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber()

    it("rounds 1.23456 to 1.2346", () => {
      expect(roundAccounting(1.23456)).toBe(1.2346)
    })

    it("rounds 1.23454 to 1.2345", () => {
      expect(roundAccounting(1.23454)).toBe(1.2345)
    })

    it("rounds 0.00005 to 0.0001 (half up at 4th decimal)", () => {
      expect(roundAccounting(0.00005)).toBe(0.0001)
    })

    it("preserves 2 decimal places as-is", () => {
      expect(roundAccounting(99.99)).toBe(99.99)
    })

    it("handles negative numbers", () => {
      expect(roundAccounting(-1.23456)).toBe(-1.2346)
    })

    it("handles zero", () => {
      expect(roundAccounting(0)).toBe(0)
    })

    it("handles very small numbers", () => {
      expect(roundAccounting(0.00001)).toBe(0)
    })

    it("handles very large numbers", () => {
      expect(roundAccounting(1234567.89123)).toBe(1234567.8912)
    })
  })

  describe("convertToUSD precision", () => {
    const convertToUSD = (amount: number, rate: number) => {
      const decAmount = new Decimal(amount)
      const decRate = new Decimal(rate)
      return decAmount.dividedBy(decRate).toNumber()
    }

    it("handles 0.33 USD at rate 1 exactly", () => {
      expect(convertToUSD(0.33, 1)).toBe(0.33)
    })

    it("handles 1.07 at rate 1 exactly", () => {
      expect(convertToUSD(1.07, 1)).toBe(1.07)
    })

    it("avoids floating-point error on 0.1 + 0.2", () => {
      const result = new Decimal(0.1).plus(new Decimal(0.2)).toNumber()
      expect(result).toBe(0.3)
      expect(result).not.toBe(0.30000000000000004)
    })

    it("converts 100 SAR at rate 3.75 correctly", () => {
      const result = convertToUSD(100, 3.75)
      expect(result).toBeCloseTo(26.666666666666668, 10)
    })

    it("converts 600 SDG at rate 600 correctly", () => {
      expect(convertToUSD(600, 600)).toBe(1)
    })

    it("handles 0 amount", () => {
      expect(convertToUSD(0, 3.75)).toBe(0)
    })

    it("avoids precision loss on large amounts", () => {
      const result = convertToUSD(1000000, 3.75)
      expect(result).toBeCloseTo(266666.6666666667, 5)
    })
  })

  describe("convertFromUSD precision", () => {
    const convertFromUSD = (usd: number, rate: number) => {
      const decUsd = new Decimal(usd)
      const decRate = new Decimal(rate)
      return decUsd.times(decRate).toNumber()
    }

    it("converts 100 USD to SAR at rate 3.75", () => {
      expect(convertFromUSD(100, 3.75)).toBe(375)
    })

    it("converts 1 USD to SDG at rate 600", () => {
      expect(convertFromUSD(1, 600)).toBe(600)
    })

    it("handles 0 USD", () => {
      expect(convertFromUSD(0, 3.75)).toBe(0)
    })

    it("handles fractional USD with precision", () => {
      const result = convertFromUSD(26.67, 3.75)
      expect(result).toBe(100.0125)
    })

    it("round-trip conversion preserves value within tolerance", () => {
      const toUSD = (amount: number, rate: number) => new Decimal(amount).dividedBy(new Decimal(rate)).toNumber()
      const original = 123.45
      const usd = toUSD(original, 3.75)
      const back = convertFromUSD(usd, 3.75)
      expect(Math.abs(back - original)).toBeLessThan(0.001)
    })
  })

  describe("floating-point edge cases", () => {
    it("0.1 * 3 = 0.3 not 0.30000000000000004", () => {
      const result = new Decimal(0.1).times(3).toNumber()
      expect(result).toBe(0.3)
    })

    it("0.3 / 0.1 = 3 not 2.9999999999999996", () => {
      const result = new Decimal(0.3).dividedBy(0.1).toNumber()
      expect(result).toBe(3)
    })

    it("1.005 rounds to 1.01 at 2 decimals with HALF_UP", () => {
      const result = new Decimal(1.005).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
      expect(result).toBe(1.01)
    })
  })
})
