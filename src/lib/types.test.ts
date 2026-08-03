import { describe, it, expect } from "vitest"
import { ammoTotalRounds } from "./types"

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
