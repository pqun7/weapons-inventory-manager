import { describe, expect, it } from "vitest"
import { resolveAuditEntity } from "@/lib/audit-entity"
import type { AuditLog } from "@/lib/types"

function log(overrides: Partial<AuditLog>): AuditLog {
  return {
    id: "LOG-1",
    timestamp: "2026-08-13T00:00:00Z",
    date: "2026-08-13",
    userId: "USER-1",
    actionType: "Update",
    description: "",
    metadata: "{}",
    ...overrides,
  }
}

describe("audit entity resolver", () => {
  it("opens purchase and sale invoices as invoice dialogs", () => {
    expect(resolveAuditEntity(log({ entityType: "Purchase Invoice", entityId: "INV-P" }))).toEqual({ kind: "invoice", id: "INV-P" })
    expect(resolveAuditEntity(log({ entityType: "Sale", metadata: '{"invoiceId":"INV-S"}' }))).toEqual({ kind: "invoice", id: "INV-S" })
  })

  it("resolves shipments without routing to another page", () => {
    expect(resolveAuditEntity(log({ entityType: "Shipment", entityId: "SHIP-105" }))).toEqual({ kind: "shipment", id: "SHIP-105" })
  })

  it("uses related metadata for weapons, customers, and suppliers", () => {
    expect(resolveAuditEntity(log({ metadata: '{"weaponId":"W-1"}' }))).toEqual({ kind: "weapon", id: "W-1" })
    expect(resolveAuditEntity(log({ metadata: '{"customerId":"C-1"}' }))).toEqual({ kind: "customer", id: "C-1" })
    expect(resolveAuditEntity(log({ metadata: '{"supplierId":"S-1"}' }))).toEqual({ kind: "supplier", id: "S-1" })
  })
})
