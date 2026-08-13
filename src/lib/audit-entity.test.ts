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
  it("resolves purchase and sale invoices for direct navigation", () => {
    expect(resolveAuditEntity(log({ entityType: "Purchase Invoice", entityId: "INV-P" }))).toEqual({ kind: "invoice", id: "INV-P" })
    expect(resolveAuditEntity(log({ entityType: "Sale", metadata: '{"invoiceId":"INV-S"}' }))).toEqual({ kind: "invoice", id: "INV-S" })
  })

  it("resolves shipments for direct navigation", () => {
    expect(resolveAuditEntity(log({ entityType: "Shipment", entityId: "SHIP-105" }))).toEqual({ kind: "shipment", id: "SHIP-105" })
  })

  it("does not mistake a manifest import id for a shipment id", () => {
    expect(resolveAuditEntity(log({ entityType: "ShipmentImport", entityId: "IMPORT-1" }))).toBeNull()
    expect(resolveAuditEntity(log({ entityType: "ShipmentImport", entityId: "IMPORT-1", metadata: '{"shipmentId":"SHIP-1"}' }))).toEqual({ kind: "shipment", id: "SHIP-1" })
  })

  it("uses related metadata for weapons, customers, and suppliers", () => {
    expect(resolveAuditEntity(log({ metadata: '{"weaponId":"W-1"}' }))).toEqual({ kind: "weapon", id: "W-1" })
    expect(resolveAuditEntity(log({ metadata: '{"customerId":"C-1"}' }))).toEqual({ kind: "customer", id: "C-1" })
    expect(resolveAuditEntity(log({ metadata: '{"supplierId":"S-1"}' }))).toEqual({ kind: "supplier", id: "S-1" })
  })

  it("resolves debt and payment records to their related invoice", () => {
    expect(resolveAuditEntity(log({ entityType: "Debt", entityId: "INV-D" }))).toEqual({ kind: "invoice", id: "INV-D" })
    expect(resolveAuditEntity(log({ entityType: "Payment", metadata: '{"receivableId":"INV-R"}' }))).toEqual({ kind: "invoice", id: "INV-R" })
    expect(resolveAuditEntity(log({ actionType: "DueDateExtension", metadata: '{"invoiceId":"INV-E"}' }))).toEqual({ kind: "invoice", id: "INV-E" })
  })
})
