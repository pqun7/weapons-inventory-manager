import { describe, expect, it } from "vitest"
import {
  applyAccountingPayment,
  authoritativeListPrice,
  convertBetweenBaseRates,
  fromAccountingAmount,
  moneyEquals,
  toAccountingAmount,
} from "./money"

describe("authoritative money conversion", () => {
  it.each([
    ["USD to SDG", "100", "1", "600", "60000"],
    ["SDG to USD", "60000", "600", "1", "100"],
    ["SAR to SDG", "100", "3.75", "600", "16000"],
    ["EUR to SDG", "100", "0.92", "600", "65217.3913"],
  ])("converts %s with a shared rate base", (_label, amount, fromRate, toRate, expected) => {
    expect(convertBetweenBaseRates(amount, fromRate, toRate).toString()).toBe(expected)
  })

  it.each(["0.01", "0.001", "1000000000000", "600000000000000"])(
    "round-trips %s within accounting tolerance",
    (amount) => {
      const accounting = toAccountingAmount(amount, "600")
      const original = fromAccountingAmount(accounting, "600")
      expect(moneyEquals(original, amount, "0.03")).toBe(true)
    },
  )

  it("keeps a historical snapshot independent from later rates", () => {
    const originalAmount = "600000"
    const recordedAccountingAmount = toAccountingAmount(originalAmount, "600")
    const currentAccountingAmount = toAccountingAmount(originalAmount, "700")

    expect(recordedAccountingAmount.toString()).toBe("1000")
    expect(currentAccountingAmount.toString()).toBe("857.1429")
    expect(recordedAccountingAmount.toString()).toBe("1000")
  })

  it("applies same-currency partial and full payments", () => {
    const partial = applyAccountingPayment("1000", "1000", "1", "250")
    expect(partial.newOriginalBalance.toString()).toBe("750")
    expect(partial.isPaid).toBe(false)
    const full = applyAccountingPayment("1000", "1000", "1", "1000")
    expect(full.newOriginalBalance.toString()).toBe("0")
    expect(full.isPaid).toBe(true)
  })

  it("applies a USD payment to an SDG invoice using the invoice snapshot", () => {
    const result = applyAccountingPayment("1000000", "1666.6667", "600", "1000")
    expect(result.appliedOriginalAmount.toString()).toBe("600000")
    expect(result.newOriginalBalance.toString()).toBe("400000")
    expect(result.newAccountingBalance.toString()).toBe("666.6667")
  })

  it("rejects an accounting overpayment", () => {
    expect(() => applyAccountingPayment("600000", "1000", "600", "1000.01")).toThrow(/exceeds/)
  })

  it.each(["0", "-1", "NaN", "Infinity"])("rejects invalid exchange rate %s", (rate) => {
    expect(() => toAccountingAmount("100", rate)).toThrow()
  })

  it("rejects negative money", () => {
    expect(() => toAccountingAmount("-0.01", "600")).toThrow()
  })

  it("prices legacy inventory from its database accounting amount for a new transaction", () => {
    expect(authoritativeListPrice(undefined, "1056", "600", 1).toString()).toBe("633600")
  })

  it("prefers the immutable valuation snapshot over a legacy raw amount", () => {
    expect(authoritativeListPrice("1000", "999999", "3.75", 2).toString()).toBe("7500")
  })
})
