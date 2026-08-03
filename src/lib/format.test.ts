import { describe, it, expect, beforeEach } from "vitest"
import {
  formatCurrency,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatNumber,
  formatPercent,
  daysUntilDue,
  isOverdue,
  statusBadgeClass,
  invoiceStatusClass,
  generateInvoiceNumber,
  generateShipmentNumber,
  shipmentStatusClass,
  shipmentDelayDays,
  checksum,
  setFormatLanguage,
} from "./format"

describe("formatCurrency", () => {
  beforeEach(() => setFormatLanguage("en"))

  it("formats with default dollar symbol", () => {
    expect(formatCurrency(1234.56)).toBe("$1,234.56")
  })

  it("formats with custom symbol", () => {
    expect(formatCurrency(100, "EUR")).toBe("EUR100")
  })

  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0")
  })

  it("formats negative numbers", () => {
    expect(formatCurrency(-50.5)).toBe("$-50.5")
  })

  it("truncates to 2 decimal places max", () => {
    expect(formatCurrency(99.999)).toBe("$100")
  })
})

describe("formatDate", () => {
  beforeEach(() => setFormatLanguage("en"))

  it("formats an ISO date string", () => {
    const result = formatDate("2024-01-15")
    expect(result).toMatch(/Jan.*15.*2024/)
  })
})

describe("formatDateShort", () => {
  beforeEach(() => setFormatLanguage("en"))

  it("formats with 2-digit month/day/year", () => {
    const result = formatDateShort("2024-03-05")
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{2}/)
  })
})

describe("formatDateTime", () => {
  beforeEach(() => setFormatLanguage("en"))

  it("formats date and time", () => {
    const result = formatDateTime("2024-01-15T10:30:00Z")
    expect(result).toMatch(/Jan.*15/)
    expect(result.length).toBeGreaterThan(5)
  })
})

describe("formatNumber", () => {
  beforeEach(() => setFormatLanguage("en"))

  it("formats large numbers with commas", () => {
    expect(formatNumber(1234567)).toBe("1,234,567")
  })
})

describe("formatPercent", () => {
  beforeEach(() => setFormatLanguage("en"))

  it("formats a percentage with one decimal max", () => {
    expect(formatPercent(12.55)).toBe("12.6%")
  })

  it("formats whole number percentage", () => {
    expect(formatPercent(50)).toBe("50%")
  })
})

describe("daysUntilDue", () => {
  it("returns positive days for future date", () => {
    const future = new Date()
    future.setDate(future.getDate() + 10)
    expect(daysUntilDue(future.toISOString())).toBeGreaterThan(5)
    expect(daysUntilDue(future.toISOString())).toBeLessThanOrEqual(10)
  })

  it("returns negative days for past date", () => {
    const past = new Date()
    past.setDate(past.getDate() - 5)
    expect(daysUntilDue(past.toISOString())).toBeLessThan(-3)
  })
})

describe("isOverdue", () => {
  it("returns true when balance > 0 and date is in the past", () => {
    const past = new Date()
    past.setDate(past.getDate() - 1)
    expect(isOverdue(past.toISOString(), 100)).toBe(true)
  })

  it("returns false when balance is 0", () => {
    const past = new Date()
    past.setDate(past.getDate() - 1)
    expect(isOverdue(past.toISOString(), 0)).toBe(false)
  })

  it("returns false when date is in the future", () => {
    const future = new Date()
    future.setDate(future.getDate() + 1)
    expect(isOverdue(future.toISOString(), 100)).toBe(false)
  })
})

describe("statusBadgeClass", () => {
  it("returns class for Available", () => {
    expect(statusBadgeClass("Available")).toContain("bg-secondary")
  })

  it("returns class for Sold", () => {
    expect(statusBadgeClass("Sold")).toContain("bg-status-sold")
  })

  it("returns class for Reserved", () => {
    expect(statusBadgeClass("Reserved")).toContain("bg-status-reserved")
  })

  it("returns class for Returned", () => {
    expect(statusBadgeClass("Returned")).toContain("bg-status-returned")
  })
})

describe("invoiceStatusClass", () => {
  it("returns class for Pending", () => {
    expect(invoiceStatusClass("Pending")).toContain("bg-status-reserved")
  })

  it("returns class for Overdue", () => {
    expect(invoiceStatusClass("Overdue")).toContain("bg-status-sold")
  })

  it("returns class for Paid", () => {
    expect(invoiceStatusClass("Paid")).toContain("bg-status-returned")
  })

  it("returns class for Void", () => {
    expect(invoiceStatusClass("Void")).toContain("bg-muted")
  })
})

describe("generateInvoiceNumber", () => {
  it("generates a unique invoice number for the day", () => {
    const existing = [{ invoiceNumber: "INV-20240101-0001" }]
    const result = generateInvoiceNumber(existing)
    expect(result).toMatch(/^INV-\d{8}-\d{4}$/)
  })

  it("increments count based on existing invoices with same prefix", () => {
    const today = new Date().toISOString().split("T")[0].replace(/-/g, "")
    const prefix = `INV-${today}-`
    const existing = [
      { invoiceNumber: `${prefix}0001` },
      { invoiceNumber: `${prefix}0002` },
    ]
    const result = generateInvoiceNumber(existing)
    expect(result).toBe(`${prefix}0003`)
  })
})

describe("generateShipmentNumber", () => {
  it("generates a shipment number with current year", () => {
    const result = generateShipmentNumber([])
    const year = new Date().getFullYear()
    expect(result).toBe(`SHP-${year}0001`)
  })

  it("increments based on existing shipments with same year", () => {
    const year = new Date().getFullYear()
    const existing = [
      { shipmentNumber: `SHP-${year}0001` },
      { shipmentNumber: `SHP-${year}0002` },
    ]
    const result = generateShipmentNumber(existing)
    expect(result).toBe(`SHP-${year}0003`)
  })
})

describe("shipmentStatusClass", () => {
  it("returns class for each known status", () => {
    expect(shipmentStatusClass("Pending")).toBeDefined()
    expect(shipmentStatusClass("In Transit")).toContain("chart-4")
    expect(shipmentStatusClass("Delayed")).toContain("status-sold")
    expect(shipmentStatusClass("Arrived")).toContain("status-returned")
    expect(shipmentStatusClass("Cancelled")).toContain("destructive")
    expect(shipmentStatusClass("Partial")).toContain("status-reserved")
  })

  it("returns default class for unknown status", () => {
    expect(shipmentStatusClass("Unknown")).toContain("bg-muted")
  })
})

describe("shipmentDelayDays", () => {
  it("returns 0 for Arrived status", () => {
    expect(shipmentDelayDays("2020-01-01", "Arrived")).toBe(0)
  })

  it("returns 0 for Cancelled status", () => {
    expect(shipmentDelayDays("2020-01-01", "Cancelled")).toBe(0)
  })

  it("returns 0 when expected date is in the future", () => {
    const future = new Date()
    future.setDate(future.getDate() + 10)
    expect(shipmentDelayDays(future.toISOString(), "In Transit")).toBe(0)
  })

  it("returns positive days when expected date is past and status is not Arrived/Cancelled", () => {
    const past = new Date()
    past.setDate(past.getDate() - 5)
    const result = shipmentDelayDays(past.toISOString(), "In Transit")
    expect(result).toBeGreaterThanOrEqual(4)
  })
})

describe("checksum", () => {
  it("generates a consistent hash for the same input", () => {
    expect(checksum("test")).toBe(checksum("test"))
  })

  it("generates different hashes for different inputs", () => {
    expect(checksum("test1")).not.toBe(checksum("test2"))
  })

  it("returns a hex string with CS- prefix", () => {
    expect(checksum("hello")).toMatch(/^CS-[A-F0-9]{8}$/)
  })
})
