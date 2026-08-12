import type { AuditLog } from "@/lib/types"
import { parseAuditMetadata } from "@/lib/audit-presentation"

export type DialogEntityKind = "invoice" | "shipment" | "weapon" | "customer" | "supplier"
export type DialogEntityTarget = { kind: DialogEntityKind; id: string }

function text(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key]
  return typeof value === "string" || typeof value === "number" ? String(value) : null
}

export function resolveAuditEntity(log: AuditLog): DialogEntityTarget | null {
  const metadata = parseAuditMetadata(log.metadata) ?? {}
  const normalized = (log.entityType ?? text(metadata, "entityType") ?? "").toLocaleLowerCase().replace(/[^a-z]/g, "")
  const candidates: Array<[DialogEntityKind, string[], boolean]> = [
    ["invoice", ["invoiceId"], /invoice|sale|purchase|payment/.test(normalized)],
    ["shipment", ["shipmentId"], /shipment|manifest|import/.test(normalized)],
    ["weapon", ["weaponId"], /weapon|inventory/.test(normalized)],
    ["customer", ["customerId"], /customer/.test(normalized)],
    ["supplier", ["supplierId"], /supplier/.test(normalized)],
  ]
  for (const [kind, keys, entityMatches] of candidates) {
    const metadataId = keys.map((key) => text(metadata, key)).find(Boolean)
    const id = entityMatches ? (log.entityId ?? metadataId) : metadataId
    if (id) return { kind, id }
  }
  return null
}
