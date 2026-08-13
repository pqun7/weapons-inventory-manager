import { normalizeSerial, type ManifestExtractionAnomaly, type ManifestExtractionVerification } from "../../src/lib/shipment-manifest.js"
import type { NativeExtraction, ParsedManifestItem } from "./manifest-parser.js"

const CRITICAL_FIELDS = ["productName", "productType", "quantity"] as const
const SEMANTIC_CONFIDENCE_FIELDS = ["productName", "productType", "weaponType", "manufacturer", "model", "caliber", "quantity"] as const

function hasValue(value: unknown): boolean {
  return value != null && value !== "" && (!Array.isArray(value) || value.length > 0)
}

export function verifyManifestExtraction(input: {
  items: ParsedManifestItem[]
  nativeExtraction?: NativeExtraction
  visualAnalysisCompleted: boolean
}): { items: ParsedManifestItem[]; verification: ManifestExtractionVerification } {
  const anomalies: ManifestExtractionAnomaly[] = []
  const serialOwners = new Map<string, number[]>()
  let evidenceFields = 0
  let populatedFields = 0

  for (const item of input.items) {
    for (const field of CRITICAL_FIELDS) {
      if (!hasValue(item[field])) {
        anomalies.push({ code: "missing_critical_field", severity: "error", message: `Missing required extraction field: ${field}`, itemRowIndex: item.rowIndex, fieldName: field })
      }
    }
    if (item.serialNumbers.length > 0 && item.quantity != null && item.quantity !== item.serialNumbers.length) {
      anomalies.push({
        code: "quantity_serial_mismatch",
        severity: "warning",
        message: `Quantity ${item.quantity} does not match ${item.serialNumbers.length} extracted serial numbers`,
        itemRowIndex: item.rowIndex,
        fieldName: "quantity",
        details: { quantity: item.quantity, serialCount: item.serialNumbers.length },
      })
    }
    for (const serial of item.serialNumbers.map(normalizeSerial).filter(Boolean)) {
      const rows = serialOwners.get(serial) ?? []
      rows.push(item.rowIndex)
      serialOwners.set(serial, rows)
    }
    for (const field of SEMANTIC_CONFIDENCE_FIELDS) {
      if (!hasValue(item[field])) continue
      populatedFields++
      const confidence = item.confidence[field]
      if (confidence != null) evidenceFields++
      if (confidence != null && confidence < 0.6) {
        anomalies.push({ code: "low_confidence", severity: "warning", message: `Low-confidence value for ${field}`, itemRowIndex: item.rowIndex, fieldName: field, details: { confidence } })
      }
    }
    const conflicts = (item.rawData._reconciliation as { conflicts?: Array<Record<string, unknown>> } | undefined)?.conflicts ?? []
    for (const conflict of conflicts) {
      anomalies.push({
        code: "field_conflict",
        severity: "warning",
        message: `Native and AI extraction disagree on ${String(conflict.field ?? "a field")}`,
        itemRowIndex: item.rowIndex,
        fieldName: typeof conflict.field === "string" ? conflict.field : undefined,
        details: conflict,
      })
    }
  }

  for (const [serial, rows] of serialOwners) {
    if (rows.length <= 1) continue
    anomalies.push({ code: "duplicate_serial", severity: "error", message: `Serial number ${serial} appears in multiple extracted rows`, details: { serial, rows } })
  }

  const normalizedDocument = input.nativeExtraction?.document
  const hasUnforwardedImages = Boolean(normalizedDocument?.images.some((image) => !image.dataBase64))
  const legacyCompletenessUnknown = normalizedDocument?.structureQuality === "legacy-text"
  if ((normalizedDocument?.requiresVisualAnalysis && (!input.visualAnalysisCompleted || hasUnforwardedImages)) || legacyCompletenessUnknown) {
    anomalies.push({
      code: "incomplete_extraction",
      severity: "warning",
      message: legacyCompletenessUnknown
        ? "Legacy DOC text was extracted, but image-only content and original table geometry cannot be fully verified."
        : "The document contains embedded images that were not fully analyzed.",
      details: { imageCount: normalizedDocument?.images.length ?? 0, hasUnforwardedImages, warnings: normalizedDocument?.warnings ?? [] },
    })
  }

  const evidenceCoverage = populatedFields === 0 ? 0 : Math.round((evidenceFields / populatedFields) * 100)
  const criticalTotal = input.items.length * CRITICAL_FIELDS.length
  const missingCritical = anomalies.filter((anomaly) => anomaly.code === "missing_critical_field").length
  const criticalCoverage = criticalTotal === 0 ? 0 : (criticalTotal - missingCritical) / criticalTotal
  const warningCount = anomalies.filter((anomaly) => anomaly.severity === "warning").length
  const errorCount = anomalies.filter((anomaly) => anomaly.severity === "error").length
  const serialPenalty = anomalies.filter((anomaly) => anomaly.code === "quantity_serial_mismatch" || anomaly.code === "duplicate_serial").length
  const conflictPenalty = anomalies.filter((anomaly) => anomaly.code === "field_conflict").length
  const incompletePenalty = anomalies.some((anomaly) => anomaly.code === "incomplete_extraction") ? 10 : 0
  const qualityScore = Math.max(0, Math.min(100, Math.round(
    criticalCoverage * 50
      + evidenceCoverage * 0.25
      + 25
      - Math.min(20, serialPenalty * 3)
      - Math.min(15, conflictPenalty * 2)
      - incompletePenalty,
  )))

  const anomaliesByRow = new Map<number, ManifestExtractionAnomaly[]>()
  for (const anomaly of anomalies) {
    if (anomaly.itemRowIndex == null) continue
    const rowAnomalies = anomaliesByRow.get(anomaly.itemRowIndex) ?? []
    rowAnomalies.push(anomaly)
    anomaliesByRow.set(anomaly.itemRowIndex, rowAnomalies)
  }
  const items = input.items.map((item) => ({
    ...item,
    rawData: { ...item.rawData, _verification: { anomalies: anomaliesByRow.get(item.rowIndex) ?? [] } },
  }))
  return {
    items,
    verification: {
      qualityScore,
      evidenceCoverage,
      complete: errorCount === 0 && !anomalies.some((anomaly) => anomaly.code === "incomplete_extraction"),
      anomalyCounts: { warnings: warningCount, errors: errorCount },
      anomalies,
    },
  }
}
