import { describe, expect, it } from "vitest"
import { isSupportedActivationCode, normalizeActivationCode } from "./activation-code"

describe("activation codes", () => {
  it("accepts PostgreSQL-generated hexadecimal codes containing zero and one", () => {
    expect(isSupportedActivationCode("01AF20BC91DE")).toBe(true)
  })

  it("accepts legacy Supabase and formatted SQLite codes", () => {
    expect(isSupportedActivationCode("ABCDEFGH2345")).toBe(true)
    expect(isSupportedActivationCode("ABCD-EFGH-2345")).toBe(true)
  })

  it("normalizes harmless casing and surrounding whitespace", () => {
    expect(normalizeActivationCode(" 01af20bc91de ")).toBe("01AF20BC91DE")
    expect(isSupportedActivationCode(" 01af20bc91de ")).toBe(true)
  })

  it("rejects malformed or truncated values", () => {
    expect(isSupportedActivationCode("ABC123")).toBe(false)
    expect(isSupportedActivationCode("ABCD-EFGH-01I5")).toBe(false)
    expect(isSupportedActivationCode("ARMORY1.NOT-AN-ACTIVATION-CODE")).toBe(false)
  })
})
