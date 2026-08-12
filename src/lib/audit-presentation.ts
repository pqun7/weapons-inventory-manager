import type { AuditActionType, AuditLog } from "@/lib/types"

export type AuditTranslator = (key: string, params?: Record<string, string | number>) => string
export type AuditMetadataGroup = "identity" | "money" | "changes" | "details"

const SENSITIVE_KEY = /(password|secret|token|authorization|cookie|base64|imageData|fileData)/i
const MONEY_KEY = /(amount|price|cost|total|subtotal|tax|paid|balance|rate|currency)/i
const CHANGE_KEY = /^(old|new|from|to|previous|reason|status|added|removed|quantity)/i
const IDENTITY_KEY = /(Id|Number|serial|batchId)$/i

export const AUDIT_ACTIONS: AuditActionType[] = [
  "Intake", "Sale", "Return", "Payment", "Shipment", "DebtWarning",
  "Login", "Export", "Import", "Update", "Delete", "Void", "Backup",
  "RoleChange", "DueDateExtension", "StockAdjustment",
]

const ACTION_TRANSLATION_KEY: Record<AuditActionType, string> = {
  Intake: "create",
  Sale: "sale",
  Return: "return",
  Payment: "payment",
  Shipment: "shipment",
  DebtWarning: "debtWarning",
  Login: "login",
  Export: "export",
  Import: "import",
  Update: "update",
  Delete: "delete",
  Void: "void",
  Backup: "backup",
  RoleChange: "roleChange",
  DueDateExtension: "dueDateExtension",
  StockAdjustment: "stockAdjustment",
}

export function parseAuditMetadata(raw: string): Record<string, unknown> | null {
  if (!raw || raw === "{}") return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function auditDetails(log: AuditLog): Record<string, unknown> | null {
  const metadata = parseAuditMetadata(log.metadata) ?? {}
  const details = log.details && typeof log.details === "object" ? log.details : {}
  const merged = { ...metadata, ...details }
  return Object.keys(merged).length ? merged : null
}

export function isBusinessAuditLog(log: AuditLog): boolean {
  if (log.isVisible === false || log.importance === 0 || log.actionType === "Login") return false
  const text = `${log.description} ${log.entityType ?? ""}`.toLocaleLowerCase()
  return !/(autosave|background|heartbeat|manifest items updated during review|row change)/.test(text)
}

export function isSafeAuditKey(key: string): boolean {
  return !SENSITIVE_KEY.test(key)
}

export function getAuditCurrency(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null
  for (const key of ["paymentCurrency", "currency", "invoiceCurrency", "accountingCurrency"]) {
    const value = metadata[key]
    if (typeof value === "string" && /^[A-Za-z]{3}$/.test(value.trim())) return value.trim().toUpperCase()
  }
  return null
}

export function auditMetadataGroup(key: string): AuditMetadataGroup {
  if (MONEY_KEY.test(key)) return "money"
  if (CHANGE_KEY.test(key)) return "changes"
  if (IDENTITY_KEY.test(key)) return "identity"
  return "details"
}

export function groupedAuditMetadata(metadata: Record<string, unknown> | null): Record<AuditMetadataGroup, [string, unknown][]> {
  const groups: Record<AuditMetadataGroup, [string, unknown][]> = {
    identity: [], money: [], changes: [], details: [],
  }
  if (!metadata) return groups
  for (const [key, value] of Object.entries(metadata)) {
    if (!isSafeAuditKey(key) || value === undefined) continue
    groups[auditMetadataGroup(key)].push([key, value])
  }
  return groups
}

export function humanizeAuditKey(key: string, t: AuditTranslator): string {
  const translationKey = `audit.field.${key}`
  const translated = t(translationKey)
  if (translated !== translationKey) return translated
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase())
}

export function auditActionLabel(action: AuditActionType, t: AuditTranslator): string {
  return t(`audit.actionType.${ACTION_TRANSLATION_KEY[action]}`)
}

function textValue(metadata: Record<string, unknown> | null, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === "string" || typeof value === "number" ? String(value) : null
}

export function auditSummary(
  log: AuditLog,
  metadata: Record<string, unknown> | null,
  t: AuditTranslator,
  actorName?: string,
): string {
  const messageKey = textValue(metadata, "messageKey")
  const actor = actorName || log.userName || t("audit.systemUser")
  const entity = log.entityName || textValue(metadata, "shipmentNumber") || textValue(metadata, "invoiceNumber") || t("audit.entity.record")
  const count = log.itemCount || Number(textValue(metadata, "count")) || 0
  if (messageKey === "audit.business.inventoryIntake") {
    return t(messageKey, { actor, count, entity })
  }
  const invoice = textValue(metadata, "invoiceNumber") ?? textValue(metadata, "invoiceId") ?? "—"
  const shipment = textValue(metadata, "shipmentNumber") ?? textValue(metadata, "shipmentId") ?? "—"
  const item = textValue(metadata, "itemName") ?? textValue(metadata, "caliber") ?? textValue(metadata, "weaponId") ?? "—"
  const summaries: Partial<Record<AuditActionType, string>> = {
    Sale: t("audit.summary.sale", { invoice }),
    Payment: t("audit.summary.payment", { invoice }),
    Shipment: t("audit.summary.shipment", { shipment }),
    Intake: t("audit.summary.intake", { count: textValue(metadata, "count") ?? "—" }),
    StockAdjustment: t("audit.summary.stockAdjustment", { item }),
    Void: t("audit.summary.void", { invoice }),
    DueDateExtension: t("audit.summary.dueDate", { invoice }),
    Update: t("audit.summary.update", { item }),
  }
  const summary = summaries[log.actionType]
  if (summary) return actorName || log.userName ? t("audit.sentence.withSummary", { actor, summary }) : summary
  if (log.entityType || log.entityName) {
    return t("audit.sentence.generic", { actor, action: auditActionLabel(log.actionType, t), entity })
  }
  return log.description || t("audit.sentence.generic", { actor, action: auditActionLabel(log.actionType, t), entity })
}

export function auditMoneyCurrencyKey(key: string): string | null {
  if (key === "paymentAmount") return "paymentCurrency"
  if (["accountingAmount", "newAccountingBalance"].includes(key)) return "accountingCurrency"
  if (["appliedInvoiceAmount", "newBalance", "originalBalance"].includes(key)) return "invoiceCurrency"
  if (key === "oldPrice") return "oldPriceCurrency"
  if (key === "newPrice") return "newPriceCurrency"
  if (MONEY_KEY.test(key) && !/currency|rate/i.test(key)) return "currency"
  return null
}
