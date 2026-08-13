import { describe, it, expect } from "vitest"
import {
  validateBrandTypePair,
  validateTypeCaliberPair,
  validateFullCombination,
  hasAnyValidationErrors,
} from "./validation"

describe("validateBrandTypePair", () => {
  it("returns valid for Glock + Pistol", () => {
    expect(validateBrandTypePair("Glock", "Pistol")).toEqual({ valid: true })
  })

  it("returns invalid for Glock + Shotgun", () => {
    const result = validateBrandTypePair("Glock", "Shotgun")
    expect(result.valid).toBe(false)
    expect(result.error).toContain("Glock")
    expect(result.error).toContain("Shotgun")
  })

  it("returns invalid for Glock + Rifle", () => {
    expect(validateBrandTypePair("Glock", "Rifle").valid).toBe(false)
  })

  it("returns invalid for Glock + Air rifle", () => {
    expect(validateBrandTypePair("Glock", "Air rifle").valid).toBe(false)
  })

  it("returns invalid for Glock + Blank pistol", () => {
    expect(validateBrandTypePair("Glock", "Blank pistol").valid).toBe(false)
    expect(validateBrandTypePair("Glock", "Blank-Firing Pistol").valid).toBe(false)
  })

  it("returns valid for Benelli + Shotgun", () => {
    expect(validateBrandTypePair("Benelli", "Shotgun").valid).toBe(true)
  })

  it("returns invalid for Benelli + Pistol", () => {
    expect(validateBrandTypePair("Benelli", "Pistol").valid).toBe(false)
  })

  it("returns valid for unknown brand", () => {
    expect(validateBrandTypePair("UnknownBrand", "Pistol")).toEqual({ valid: true })
  })

  it("returns valid when brand is empty", () => {
    expect(validateBrandTypePair("", "Pistol")).toEqual({ valid: true })
  })

  it("returns valid when weaponType is empty", () => {
    expect(validateBrandTypePair("Glock", "")).toEqual({ valid: true })
  })
})

describe("validateTypeCaliberPair", () => {
  it("returns valid for Shotgun + 12 GA", () => {
    expect(validateTypeCaliberPair("Shotgun", "12 GA")).toEqual({ valid: true })
  })

  it("returns invalid for Shotgun + 9x19mm", () => {
    expect(validateTypeCaliberPair("Shotgun", "9x19mm").valid).toBe(false)
  })

  it("returns invalid for Pistol + 12 GA", () => {
    expect(validateTypeCaliberPair("Pistol", "12 GA").valid).toBe(false)
  })

  it("returns valid for Pistol + 9x19mm", () => {
    expect(validateTypeCaliberPair("Pistol", "9x19mm")).toEqual({ valid: true })
  })

  it("returns valid for Rifle + .223 Rem", () => {
    expect(validateTypeCaliberPair("Rifle", ".223 Rem")).toEqual({ valid: true })
  })

  it("returns invalid for Rifle + 12 GA", () => {
    expect(validateTypeCaliberPair("Rifle", "12 GA").valid).toBe(false)
  })

  it("returns valid for Air rifle + .177", () => {
    expect(validateTypeCaliberPair("Air rifle", ".177")).toEqual({ valid: true })
    expect(validateTypeCaliberPair("Air Rifle", ".177")).toEqual({ valid: true })
  })

  it("returns invalid for Air rifle + 9x19mm", () => {
    expect(validateTypeCaliberPair("Air rifle", "9x19mm").valid).toBe(false)
    expect(validateTypeCaliberPair("Air Rifle", "9x19mm").valid).toBe(false)
  })

  it("returns valid when weaponType is empty", () => {
    expect(validateTypeCaliberPair("", "12 GA")).toEqual({ valid: true })
  })

  it("returns valid when caliber is empty", () => {
    expect(validateTypeCaliberPair("Shotgun", "")).toEqual({ valid: true })
  })
})

describe("validateFullCombination", () => {
  it("returns empty array for valid combination", () => {
    const results = validateFullCombination("Glock", "Pistol", "9x19mm", "9x19mm")
    expect(results).toHaveLength(0)
  })

  it("returns errors for Glock + Shotgun (brand/type mismatch)", () => {
    const results = validateFullCombination("Glock", "Shotgun", "Semi-auto", "12 GA")
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].error).toContain("Glock")
  })

  it("returns errors for invalid type/caliber pair", () => {
    const results = validateFullCombination("Remington", "Shotgun", "Semi-auto", "9x19mm")
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((r) => r.error?.includes("Shotgun"))).toBe(true)
  })

  it("returns multiple errors when both brand/type and type/caliber are invalid", () => {
    const results = validateFullCombination("Glock", "Shotgun", "Semi-auto", "9x19mm")
    expect(results.length).toBeGreaterThanOrEqual(2)
  })
})

describe("hasAnyValidationErrors", () => {
  it("returns false for valid combination", () => {
    expect(hasAnyValidationErrors("Glock", "Pistol", "9x19mm", "9x19mm")).toBe(false)
  })

  it("returns true for invalid brand/type", () => {
    expect(hasAnyValidationErrors("Glock", "Shotgun", "Semi-auto", "12 GA")).toBe(true)
  })

  it("returns true for invalid type/caliber", () => {
    expect(hasAnyValidationErrors("Remington", "Shotgun", "Semi-auto", "9x19mm")).toBe(true)
  })
})
