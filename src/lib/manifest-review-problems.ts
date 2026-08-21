import type {
  ManifestExtractionAnomaly,
  ManifestReviewItem,
  ManifestValidationIssue,
  ShipmentManifestReview,
} from "./shipment-manifest.js"

export interface ManifestItemReviewProblem {
  itemId: string
  rowIndex: number
  productType: "weapon" | "ammunition" | "accessory" | null
  productName: string | null
  missingFields: string[]
  anomalies: ManifestExtractionAnomaly[]
  validationIssues: ManifestValidationIssue[]
}

function currentItemAnomaly(item: ManifestReviewItem, anomaly: ManifestExtractionAnomaly): ManifestExtractionAnomaly | null {
  if (anomaly.code === "missing_critical_field") return null
  if (anomaly.code === "quantity_serial_mismatch") {
    if (item.quantity != null && item.quantity === item.serialNumbers.length) return null
    return {
      ...anomaly,
      details: { ...anomaly.details, quantity: item.quantity ?? 0, serialCount: item.serialNumbers.length },
    }
  }
  return anomaly
}

function validationIssueStillApplies(item: ManifestReviewItem, issue: ManifestValidationIssue): boolean {
  switch (issue.code) {
    case "PRODUCT_REQUIRED": return !item.productName?.trim()
    case "PRODUCT_TYPE_REQUIRED": return !item.productType
    case "QUANTITY_INVALID": return !Number.isInteger(item.quantity) || (item.quantity ?? 0) <= 0
    case "UNIT_PRICE_NEGATIVE": return item.unitPrice != null && item.unitPrice < 0
    case "TOTAL_PRICE_NEGATIVE": return item.totalPrice != null && item.totalPrice < 0
    case "SERIAL_REQUIRED": return item.productType === "weapon" && item.serialNumbers.length === 0
    case "SERIAL_COUNT_MISMATCH": return item.productType === "weapon" && item.quantity !== item.serialNumbers.length
    case "WEAPON_TYPE_REQUIRED_FOR_RECEIPT": return !item.weaponType?.trim()
    case "MANUFACTURER_REQUIRED_FOR_RECEIPT": return !item.manufacturer?.trim()
    case "MODEL_REQUIRED_FOR_RECEIPT": return !item.model?.trim()
    case "CALIBER_REQUIRED_FOR_RECEIPT":
    case "CALIBER_REVIEW_REQUIRED": return !item.caliber?.trim()
    case "PURCHASE_PRICE_REQUIRED_FOR_RECEIPT": return item.unitPrice == null || item.unitPrice <= 0
    case "LOCATION_REQUIRED": return !item.storageLocationId
    case "MASTER_DATA_MAPPING_REQUIRED": return item.productType === "weapon" && [
      item.weaponTypeId, item.weaponSubtypeId, item.brandId, item.modelId, item.caliberId,
    ].some((value) => !value)
    default: return true
  }
}

export interface ManifestReviewProblems {
  items: ManifestItemReviewProblem[]
  documentAnomalies: ManifestExtractionAnomaly[]
  documentIssues: ManifestValidationIssue[]
  affectedItemCount: number
  missingFieldCount: number
  otherCheckCount: number
  totalCount: number
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const identity = key(value)
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

export function buildManifestReviewProblems(
  review: ShipmentManifestReview,
  missingFieldsById: ReadonlyMap<string, readonly string[]>,
): ManifestReviewProblems {
  const anomalies = review.extractionVerification?.anomalies ?? []
  const anomaliesByRow = new Map<number, ManifestExtractionAnomaly[]>()
  for (const anomaly of anomalies) {
    if (anomaly.itemRowIndex == null) continue
    const row = anomaliesByRow.get(anomaly.itemRowIndex) ?? []
    row.push(anomaly)
    anomaliesByRow.set(anomaly.itemRowIndex, row)
  }

  const issuesByItem = new Map<string, ManifestValidationIssue[]>()
  for (const validationIssue of review.issues) {
    if (!validationIssue.itemId) continue
    const itemIssues = issuesByItem.get(validationIssue.itemId) ?? []
    itemIssues.push(validationIssue)
    issuesByItem.set(validationIssue.itemId, itemIssues)
  }

  const items = review.items.flatMap((item): ManifestItemReviewProblem[] => {
    const missingFields = [...(missingFieldsById.get(item.id) ?? [])]
    const missing = new Set(missingFields)
    const itemAnomalies = uniqueBy(
      (anomaliesByRow.get(item.rowIndex) ?? [])
        .map((anomaly) => currentItemAnomaly(item, anomaly))
        .filter((anomaly): anomaly is ManifestExtractionAnomaly => anomaly !== null),
      (anomaly) => `${anomaly.code}:${anomaly.fieldName ?? ""}:${JSON.stringify(anomaly.details ?? {})}`,
    )
    const validationIssues = uniqueBy(
      (issuesByItem.get(item.id) ?? []).filter((issue) => {
        if (!validationIssueStillApplies(item, issue)) return false
        if (issue.fieldName && missing.has(issue.fieldName)) return false
        if (issue.code === "MASTER_DATA_MAPPING_REQUIRED" && [
          "weaponType", "weaponSubtype", "manufacturer", "model", "caliber",
        ].some((field) => missing.has(field))) return false
        return true
      }),
      (issue) => `${issue.code}:${issue.fieldName ?? ""}`,
    )
    if (missingFields.length === 0 && itemAnomalies.length === 0 && validationIssues.length === 0) return []
    return [{
      itemId: item.id,
      rowIndex: item.rowIndex,
      productType: item.productType,
      productName: item.productName,
      missingFields,
      anomalies: itemAnomalies,
      validationIssues,
    }]
  }).sort((left, right) => left.rowIndex - right.rowIndex)

  const serialOccurrences = new Map<string, number>()
  for (const item of review.items) {
    for (const serial of item.serialNumbers) {
      const normalized = serial.trim().toLocaleUpperCase("en").replace(/\s+/g, "")
      if (normalized) serialOccurrences.set(normalized, (serialOccurrences.get(normalized) ?? 0) + 1)
    }
  }
  const documentAnomalies = uniqueBy(
    anomalies.filter((anomaly) => {
      if (anomaly.itemRowIndex != null) return false
      if (anomaly.code !== "duplicate_serial") return true
      const serial = String(anomaly.details?.serial ?? "").trim().toLocaleUpperCase("en").replace(/\s+/g, "")
      return Boolean(serial) && (serialOccurrences.get(serial) ?? 0) > 1
    }),
    (anomaly) => `${anomaly.code}:${JSON.stringify(anomaly.details ?? {})}`,
  )
  const documentIssues = uniqueBy(
    review.issues.filter((issue) => !issue.itemId),
    (issue) => `${issue.code}:${issue.fieldName ?? ""}`,
  )
  const missingFieldCount = items.reduce((total, item) => total + item.missingFields.length, 0)
  const otherCheckCount = items.reduce((total, item) => total + item.anomalies.length + item.validationIssues.length, 0)
    + documentAnomalies.length + documentIssues.length
  return {
    items,
    documentAnomalies,
    documentIssues,
    affectedItemCount: items.length,
    missingFieldCount,
    otherCheckCount,
    totalCount: missingFieldCount + otherCheckCount,
  }
}
