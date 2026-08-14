export const MAX_SPREADSHEET_FILE_SIZE = 10 * 1024 * 1024
export const MAX_SPREADSHEET_ROWS = 10_000

export function assertSafeSpreadsheetFile(file: Pick<File, "size">): void {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new Error("The spreadsheet is empty")
  }
  if (file.size > MAX_SPREADSHEET_FILE_SIZE) {
    throw new Error("The spreadsheet exceeds the 10 MB size limit")
  }
}

export function assertSafeSpreadsheetRows(rowCount: number): void {
  if (!Number.isInteger(rowCount) || rowCount < 0 || rowCount > MAX_SPREADSHEET_ROWS) {
    throw new Error(`The spreadsheet exceeds the ${MAX_SPREADSHEET_ROWS.toLocaleString("en-US")} row limit`)
  }
}
