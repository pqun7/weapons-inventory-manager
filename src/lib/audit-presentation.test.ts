import { describe, expect, it } from "vitest"
import {
  auditMetadataGroup,
  auditMoneyCurrencyKey,
  auditSummary,
  getAuditCurrency,
  groupedAuditMetadata,
  humanizeAuditKey,
  parseAuditMetadata,
} from "@/lib/audit-presentation"
import type { AuditLog } from "@/lib/types"

const t = (key: string, params?: Record<string, string | number>) => {
  if (key === "audit.summary.payment") return `Payment for ${params?.invoice}`
  if (key === "audit.field.invoiceNumber") return "Invoice number"
  return key
}

describe("audit presentation", () => {
  it("parses valid metadata and safely ignores malformed records", () => {
    expect(parseAuditMetadata('{"invoiceNumber":"INV-1"}')).toEqual({ invoiceNumber: "INV-1" })
    expect(parseAuditMetadata("not-json")).toBeNull()
    expect(parseAuditMetadata("[]")).toBeNull()
  })

  it("never exposes secrets or file payloads", () => {
    const grouped = groupedAuditMetadata({
      invoiceNumber: "INV-1",
      paymentAmount: 100,
      password: "do-not-render",
      authToken: "do-not-render",
      imageData: "base64",
    })
    const renderedKeys = Object.values(grouped).flat().map(([key]) => key)
    expect(renderedKeys).toContain("invoiceNumber")
    expect(renderedKeys).toContain("paymentAmount")
    expect(renderedKeys).not.toContain("password")
    expect(renderedKeys).not.toContain("authToken")
    expect(renderedKeys).not.toContain("imageData")
  })

  it("groups identity, monetary and change details predictably", () => {
    expect(auditMetadataGroup("invoiceNumber")).toBe("identity")
    expect(auditMetadataGroup("paymentAmount")).toBe("money")
    expect(auditMetadataGroup("newBalance")).toBe("money")
    expect(auditMetadataGroup("reason")).toBe("changes")
  })

  it("uses the correct companion currency for every monetary field", () => {
    expect(auditMoneyCurrencyKey("paymentAmount")).toBe("paymentCurrency")
    expect(auditMoneyCurrencyKey("accountingAmount")).toBe("accountingCurrency")
    expect(auditMoneyCurrencyKey("newBalance")).toBe("invoiceCurrency")
    expect(getAuditCurrency({ paymentCurrency: "sdg", currency: "USD" })).toBe("SDG")
  })

  it("builds a useful localized summary while preserving known field labels", () => {
    const log: AuditLog = {
      id: "LOG1", timestamp: "2026-08-10T00:00:00Z", date: "2026-08-10",
      userId: "U1", actionType: "Payment", description: "technical description", metadata: "{}",
    }
    expect(auditSummary(log, { invoiceNumber: "INV-22" }, t)).toBe("Payment for INV-22")
    expect(humanizeAuditKey("invoiceNumber", t)).toBe("Invoice number")
    expect(humanizeAuditKey("customField", t)).toBe("Custom Field")
  })
})
