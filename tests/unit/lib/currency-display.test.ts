import { describe, expect, it } from "vitest"
import { formatLocalizedCurrency, getCurrencyPresentation } from "@/lib/currency-display"

describe("localized currency presentation", () => {
  it("keeps USD as the familiar dollar symbol", () => {
    expect(getCurrencyPresentation({ isoCode: "USD", name: "US Dollar", symbol: "$" }, "ar-SA")).toMatchObject({
      name: "دولار أمريكي",
      compactSymbol: "$",
    })
    expect(getCurrencyPresentation({ isoCode: "USD" }, "en-US").compactSymbol).toBe("$")
  })

  it("uses readable Arabic names and compact symbols for SAR and SDG", () => {
    expect(getCurrencyPresentation({ isoCode: "SAR" }, "ar-SA")).toMatchObject({
      name: "ريال سعودي",
      compactSymbol: "ر.س",
    })
    expect(getCurrencyPresentation({ isoCode: "SDG" }, "ar-SA")).toMatchObject({
      name: "جنيه سوداني",
      compactSymbol: "ج.س",
    })
  })

  it("never exposes an invalid question-mark symbol", () => {
    const value = getCurrencyPresentation({ isoCode: "XYZ", name: "Test", symbol: "[?]" }, "en-US")
    expect(value.compactSymbol).toBe("XYZ")
    expect(value.compactSymbol).not.toContain("?")
  })

  it("formats large SDG amounts without truncating precision or leaking invalid symbols", () => {
    const formatted = formatLocalizedCurrency(987_654_321.25, { isoCode: "SDG" }, "ar-SA", 2)
    expect(formatted).toContain("ج.س")
    expect(formatted).not.toContain("?")
    expect(formatted).not.toContain("NaN")
  })
})
