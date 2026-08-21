import { describe, expect, it } from "vitest"
import {
  auditMetadataGroup,
  auditChangeRows,
  auditDetails,
  auditMoneyCurrencyKey,
  auditSummary,
  auditOperationExplanation,
  getAuditCurrency,
  groupedAuditMetadata,
  humanizeAuditKey,
  parseAuditMetadata,
} from "@/lib/audit-presentation"
import type { AuditLog } from "@/lib/types"

const t = (key: string, params?: Record<string, string | number>) => {
  if (key === "audit.summary.payment") return `Payment for ${params?.invoice}`
  if (key === "audit.summary.shipment") return `Shipment activity for ${params?.shipment}`
  if (key === "audit.summary.update") return `Record updated: ${params?.item}`
  if (key === "audit.sentence.withSummary") return `${params?.actor}: ${params?.summary}`
  if (key === "audit.operationExplanation") return `EXPLANATION: ${params?.summary}`
  if (key === "audit.field.invoiceNumber") return "Invoice number"
  return key
}

describe("audit presentation", () => {
  it("parses valid metadata and safely ignores malformed records", () => {
    expect(parseAuditMetadata('{"invoiceNumber":"INV-1"}')).toEqual({ invoiceNumber: "INV-1" })
    expect(parseAuditMetadata("not-json")).toBeNull()
    expect(parseAuditMetadata("[]")).toBeNull()
  })

  it("includes structured before/after values and the reason in dialog details", () => {
    expect(auditDetails(createLog({
      previousValues: { status: "Pending" },
      newValues: { status: "Paid" },
      reason: "Payment received",
    }))).toEqual({
      previousValues: { status: "Pending" },
      newValues: { status: "Paid" },
      reason: "Payment received",
    })
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

  it("creates a safe, changed-only before-and-after breakdown", () => {
    expect(auditChangeRows({
      previousValues: { status: "Pending", quantity: 2, password: "old" },
      newValues: { status: "Paid", quantity: 2, password: "new" },
    })).toEqual([{ key: "status", before: "Pending", after: "Paid" }])
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
    expect(auditOperationExplanation(log, { invoiceNumber: "INV-22" }, t)).toBe("EXPLANATION: Payment for INV-22")
  })

  it("uses the recorded description instead of rendering a missing shipment reference", () => {
    const shipmentLog = createLog({
      actionType: "Shipment",
      description: "Manifest items updated in one bulk operation",
      userName: "System",
    })
    expect(auditSummary(shipmentLog, { itemCount: 3 }, t)).toBe("System: Manifest items updated in one bulk operation")
  })

  it("uses entity context for updates and never renders a dash placeholder", () => {
    const updateLog = createLog({ actionType: "Update", description: "Customer updated", entityName: "Ahmed", userName: "Admin" })
    expect(auditSummary(updateLog, {}, t)).toBe("Admin: Record updated: Ahmed")

    const fallbackLog = createLog({ actionType: "Update", description: "Password setup completed", userName: "System" })
    expect(auditSummary(fallbackLog, {}, t)).toBe("System: Password setup completed")
  })
})

function createLog(overrides: Partial<AuditLog>): AuditLog {
  return {
    id: "LOG-X",
    timestamp: "2026-08-13T00:00:00Z",
    date: "2026-08-13",
    userId: "SYSTEM",
    actionType: "Update",
    description: "",
    metadata: "{}",
    ...overrides,
  }
}
