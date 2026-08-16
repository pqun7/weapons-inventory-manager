import { describe, it, expect } from "vitest"
import {
  ACCESSORY_TYPES,
  AMMUNITION_CALIBERS,
  INVALID_BRAND_TYPE_PAIRS,
  WEAPON_CLASSIFICATION,
  ammoTotalRounds,
} from "@/lib/types"

describe("ammoTotalRounds", () => {
  it("calculates total with full packages and loose rounds", () => {
    expect(ammoTotalRounds({ fullPackages: 10, unitsPerPackage: 50, looseRounds: 25 })).toBe(525)
  })

  it("calculates total with only full packages", () => {
    expect(ammoTotalRounds({ fullPackages: 5, unitsPerPackage: 20, looseRounds: 0 })).toBe(100)
  })

  it("calculates total with only loose rounds", () => {
    expect(ammoTotalRounds({ fullPackages: 0, unitsPerPackage: 50, looseRounds: 30 })).toBe(30)
  })

  it("returns 0 when all are zero", () => {
    expect(ammoTotalRounds({ fullPackages: 0, unitsPerPackage: 0, looseRounds: 0 })).toBe(0)
  })

  it("handles large numbers", () => {
    expect(ammoTotalRounds({ fullPackages: 1000, unitsPerPackage: 250, looseRounds: 500 })).toBe(250500)
  })

  it("handles unitsPerPackage of 1", () => {
    expect(ammoTotalRounds({ fullPackages: 100, unitsPerPackage: 1, looseRounds: 5 })).toBe(105)
  })
})

describe("WEAPON_CLASSIFICATION", () => {
  it("defines the supported weapon types and their valid children", () => {
    expect(WEAPON_CLASSIFICATION).toHaveLength(5)
    expect(WEAPON_CLASSIFICATION.map((item) => item.label)).toEqual(
      expect.arrayContaining(["Shotgun", "Pistol", "Rifle", "Air rifle", "Blank pistol"]),
    )
    for (const weaponType of WEAPON_CLASSIFICATION) {
      expect(weaponType.subTypes.length, `${weaponType.label} has no subtype`).toBeGreaterThan(0)
      for (const subtype of weaponType.subTypes) {
        expect(subtype.calibers.length, `${weaponType.label}/${subtype.label} has no caliber`).toBeGreaterThan(0)
      }
    }
  })

  it("keeps the expected subtype contracts", () => {
    expect(WEAPON_CLASSIFICATION.find((item) => item.label === "Pistol")?.subTypes).toHaveLength(5)
    expect(WEAPON_CLASSIFICATION.find((item) => item.label === "Shotgun")?.subTypes).toHaveLength(6)
  })
})

describe("inventory classification constants", () => {
  it("keeps invalid brand/type combinations explicit", () => {
    expect(Object.keys(INVALID_BRAND_TYPE_PAIRS)).toHaveLength(9)
    expect(INVALID_BRAND_TYPE_PAIRS.Glock).toContain("Shotgun")
    expect(INVALID_BRAND_TYPE_PAIRS.Benelli).not.toContain("Shotgun")
  })

  it("keeps accessory and ammunition choices available", () => {
    expect(ACCESSORY_TYPES).toHaveLength(6)
    expect(ACCESSORY_TYPES).toEqual(expect.arrayContaining(["Pistol case", "Cleaning kit"]))
    expect(AMMUNITION_CALIBERS).toHaveLength(7)
    expect(AMMUNITION_CALIBERS).toEqual(expect.arrayContaining(["9x19", "7.62"]))
  })
})
