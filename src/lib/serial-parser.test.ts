import { describe, it, expect } from "vitest"
import {
  parseSerialInput,
  deduplicateSerials,
  getValidUniqueSerials,
  getSerialStats,
} from "./serial-parser"

describe("parseSerialInput", () => {
  it("returns empty array for empty input", () => {
    expect(parseSerialInput("")).toEqual([])
  })

  it("returns empty array for whitespace-only input", () => {
    expect(parseSerialInput("   ")).toEqual([])
  })

  it("parses newline-separated serials", () => {
    expect(parseSerialInput("SN001\nSN002\nSN003")).toEqual(["SN001", "SN002", "SN003"])
  })

  it("parses comma-separated serials", () => {
    expect(parseSerialInput("SN001,SN002,SN003")).toEqual(["SN001", "SN002", "SN003"])
  })

  it("parses tab-separated serials", () => {
    expect(parseSerialInput("SN001\tSN002\tSN003")).toEqual(["SN001", "SN002", "SN003"])
  })

  it("parses semicolon-separated serials", () => {
    expect(parseSerialInput("SN001;SN002;SN003")).toEqual(["SN001", "SN002", "SN003"])
  })

  it("parses pipe-separated serials", () => {
    expect(parseSerialInput("SN001|SN002|SN003")).toEqual(["SN001", "SN002", "SN003"])
  })

  it("handles mixed separators", () => {
    expect(parseSerialInput("SN001\nSN002,SN003\tSN004")).toEqual(["SN001", "SN002", "SN003", "SN004"])
  })

  it("strips whitespace around each serial", () => {
    expect(parseSerialInput("  SN001  \n  SN002  ")).toEqual(["SN001", "SN002"])
  })

  it("removes empty entries", () => {
    expect(parseSerialInput("SN001\n\nSN002\n\n")).toEqual(["SN001", "SN002"])
  })

  it("handles trailing commas", () => {
    expect(parseSerialInput("SN001,SN002,")).toEqual(["SN001", "SN002"])
  })

  it("removes control characters", () => {
    expect(parseSerialInput("SN001\x00\x01SN002")).toEqual(["SN001SN002"])
  })
})

describe("deduplicateSerials", () => {
  it("marks all as valid when no duplicates", () => {
    const result = deduplicateSerials(["SN001", "SN002"], new Set())
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ serial: "SN001", status: "valid" })
    expect(result[1]).toEqual({ serial: "SN002", status: "valid" })
  })

  it("marks db duplicates correctly", () => {
    const existing = new Set(["sn001"])
    const result = deduplicateSerials(["SN001", "SN002"], existing)
    expect(result[0]).toEqual({ serial: "SN001", status: "dbDuplicate" })
    expect(result[1]).toEqual({ serial: "SN002", status: "valid" })
  })

  it("marks local duplicates correctly", () => {
    const result = deduplicateSerials(["SN001", "SN001", "SN002"], new Set())
    expect(result[0]).toEqual({ serial: "SN001", status: "valid" })
    expect(result[1]).toEqual({ serial: "SN001", status: "localDuplicate" })
    expect(result[2]).toEqual({ serial: "SN002", status: "valid" })
  })

  it("is case-insensitive for duplicate detection", () => {
    const result = deduplicateSerials(["SN001", "sn001"], new Set())
    expect(result[0].status).toBe("valid")
    expect(result[1].status).toBe("localDuplicate")
  })

  it("prioritizes db duplicate over local duplicate", () => {
    const existing = new Set(["sn001"])
    const result = deduplicateSerials(["SN001", "SN001"], existing)
    expect(result[0].status).toBe("dbDuplicate")
    expect(result[1].status).toBe("dbDuplicate")
  })
})

describe("getValidUniqueSerials", () => {
  it("returns only valid serials", () => {
    const parsed = deduplicateSerials(["SN001", "SN002", "SN001"], new Set())
    const valid = getValidUniqueSerials(parsed)
    expect(valid).toEqual(["SN001", "SN002"])
  })

  it("excludes db duplicates", () => {
    const existing = new Set(["sn001"])
    const parsed = deduplicateSerials(["SN001", "SN002"], existing)
    const valid = getValidUniqueSerials(parsed)
    expect(valid).toEqual(["SN002"])
  })

  it("returns empty array when all are duplicates", () => {
    const existing = new Set(["sn001", "sn002"])
    const parsed = deduplicateSerials(["SN001", "SN002"], existing)
    const valid = getValidUniqueSerials(parsed)
    expect(valid).toEqual([])
  })
})

describe("getSerialStats", () => {
  it("counts valid, dbDup, and localDup correctly", () => {
    const existing = new Set(["sn002"])
    const parsed = deduplicateSerials(["SN001", "SN002", "SN001", "SN003"], existing)
    const stats = getSerialStats(parsed)
    expect(stats.valid).toBe(2)
    expect(stats.dbDup).toBe(1)
    expect(stats.localDup).toBe(1)
    expect(stats.uniqueCount).toBe(2)
  })

  it("returns all zeros for empty input", () => {
    const stats = getSerialStats([])
    expect(stats).toEqual({ valid: 0, dbDup: 0, localDup: 0, uniqueCount: 0 })
  })
})
