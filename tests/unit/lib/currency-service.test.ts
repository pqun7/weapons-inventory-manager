import { describe, expect, it } from "vitest"
import { isCurrencyActive, parseExchangeRateApiPayload } from "@/lib/currency-service.js"

describe("PostgreSQL currency activation mapping", () => {
  it("accepts PostgreSQL booleans and imported numeric booleans", () => {
    expect(isCurrencyActive(true)).toBe(true)
    expect(isCurrencyActive(1)).toBe(true)
    expect(isCurrencyActive(false)).toBe(false)
    expect(isCurrencyActive(0)).toBe(false)
  })
})

describe("exchange-rate provider validation", () => {
  it("keeps only positive ISO currency rates", () => {
    const result = parseExchangeRateApiPayload({
      result: "success",
      base_code: "USD",
      time_last_update_unix: 1_700_000_000,
      rates: { USD: 1, SAR: 3.75, BAD_VALUE: -1, EGP: "50" },
    }, "USD")

    expect(result.rates).toEqual({ USD: 1, SAR: 3.75 })
    expect(result.fetchedAt).toBe("2023-11-14T22:13:20.000Z")
  })

  it("rejects a mismatched base currency", () => {
    expect(() => parseExchangeRateApiPayload({ result: "success", base_code: "EUR", rates: { EUR: 1 } }, "USD"))
      .toThrow("rejected")
  })
})
