import { describe, expect, it } from "vitest"
import {
  MAX_SPREADSHEET_FILE_SIZE,
  MAX_SPREADSHEET_ROWS,
  assertSafeSpreadsheetFile,
  assertSafeSpreadsheetRows,
} from "./spreadsheet-limits"

describe("spreadsheet import limits", () => {
  it("accepts bounded files and row counts", () => {
    expect(() => assertSafeSpreadsheetFile({ size: MAX_SPREADSHEET_FILE_SIZE })).not.toThrow()
    expect(() => assertSafeSpreadsheetRows(MAX_SPREADSHEET_ROWS)).not.toThrow()
  })

  it.each([0, -1, Number.NaN])("rejects an invalid file size: %s", (size) => {
    expect(() => assertSafeSpreadsheetFile({ size })).toThrow("empty")
  })

  it("rejects an oversized file before parsing", () => {
    expect(() => assertSafeSpreadsheetFile({ size: MAX_SPREADSHEET_FILE_SIZE + 1 })).toThrow("10 MB")
  })

  it.each([-1, MAX_SPREADSHEET_ROWS + 1, 1.5])("rejects an unsafe row count: %s", (rows) => {
    expect(() => assertSafeSpreadsheetRows(rows)).toThrow("row limit")
  })
})
