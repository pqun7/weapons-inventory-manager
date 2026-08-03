import { describe, it, expect } from "vitest"
import { ammoTotalRounds, WEAPON_CLASSIFICATION, INVALID_BRAND_TYPE_PAIRS, ACCESSORY_TYPES, AMMUNITION_CALIBERS } from "./types"

describe("WEAPON_CLASSIFICATION", () => {
  it("has 5 weapon types", () => {
    expect(WEAPON_CLASSIFICATION).toHaveLength(5)
  })

  it("includes Shotgun, Pistol, Rifle, Air rifle, Blank pistol", () => {
    const labels = WEAPON_CLASSIFICATION.map((wt) => wt.label)
    expect(labels).toContain("Shotgun")
    expect(labels).toContain("Pistol")
    expect(labels).toContain("Rifle")
    expect(labels).toContain("Air rifle")
    expect(labels).toContain("Blank pistol")
  })

  it("each weapon type has at least one subtype", () => {
    for (const wt of WEAPON_CLASSIFICATION) {
      expect(wt.subTypes.length).toBeGreaterThan(0)
    }
  })

  it("each subtype has at least one caliber", () => {
    for (const wt of WEAPON_CLASSIFICATION) {
      for (const st of wt.subTypes) {
        expect(st.calibers.length).toBeGreaterThan(0)
      }
    }
  })

  it("Pistol has 5 subtypes", () => {
    const pistol = WEAPON_CLASSIFICATION.find((wt) => wt.label === "Pistol")
    expect(pistol?.subTypes).toHaveLength(5)
  })

  it("Shotgun has 6 subtypes", () => {
    const shotgun = WEAPON_CLASSIFICATION.find((wt) => wt.label === "Shotgun")
    expect(shotgun?.subTypes).toHaveLength(6)
  })
})

describe("INVALID_BRAND_TYPE_PAIRS", () => {
  it("has entries for all 9 brands", () => {
    expect(Object.keys(INVALID_BRAND_TYPE_PAIRS)).toHaveLength(9)
  })

  it("Glock cannot make Shotguns", () => {
    expect(INVALID_BRAND_TYPE_PAIRS["Glock"]).toContain("Shotgun")
  })

  it("Benelli can make Shotguns (not in invalid list)", () => {
    expect(INVALID_BRAND_TYPE_PAIRS["Benelli"]).not.toContain("Shotgun")
  })
})

describe("ACCESSORY_TYPES", () => {
  it("has 6 types", () => {
    expect(ACCESSORY_TYPES).toHaveLength(6)
  })

  it("includes Pistol case and Cleaning kit", () => {
    expect(ACCESSORY_TYPES).toContain("Pistol case")
    expect(ACCESSORY_TYPES).toContain("Cleaning kit")
  })
})

describe("AMMUNITION_CALIBERS", () => {
  it("has 7 calibers", () => {
    expect(AMMUNITION_CALIBERS).toHaveLength(7)
  })

  it("includes 9x19 and 7.62", () => {
    expect(AMMUNITION_CALIBERS).toContain("9x19")
    expect(AMMUNITION_CALIBERS).toContain("7.62")
  })
})

describe("ammoTotalRounds", () => {
  it("calculates correctly for typical values", () => {
    expect(ammoTotalRounds({ fullPackages: 10, unitsPerPackage: 50, looseRounds: 25 })).toBe(525)
  })

  it("returns 0 for all zeros", () => {
    expect(ammoTotalRounds({ fullPackages: 0, unitsPerPackage: 0, looseRounds: 0 })).toBe(0)
  })

  it("handles only loose rounds", () => {
    expect(ammoTotalRounds({ fullPackages: 0, unitsPerPackage: 50, looseRounds: 30 })).toBe(30)
  })
})
