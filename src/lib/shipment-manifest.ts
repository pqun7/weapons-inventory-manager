export const MANIFEST_SCHEMA_VERSION = "1.3"
export const MANIFEST_PROMPT_VERSION = "shipment-manifest-v4"

export type ManifestWorkflowStatus =
  | "draft"
  | "processing"
  | "pending_review"
  | "scheduled"
  | "arrived"
  | "received"
  | "failed"
  | "cancelled"

export type ManifestItemStatus = "valid" | "needs_review" | "invalid" | "duplicate" | "conflict"
export type ManifestProductType = "weapon" | "ammunition" | "accessory"

export interface ManifestSource {
  sheet?: string | null
  page?: number | null
  row?: number | null
  column?: string | null
  text?: string | null
}

export interface ManifestValidationIssue {
  id: string
  itemId: string | null
  fieldName: string | null
  code: string
  severity: "warning" | "error" | "conflict"
  message: string
  details?: Record<string, unknown>
}

export interface ManifestReviewItem {
  id: string
  rowIndex: number
  productType: ManifestProductType | null
  productName: string | null
  category: string | null
  weaponType: string | null
  manufacturer: string | null
  model: string | null
  caliber: string | null
  sku: string | null
  productCode: string | null
  serialNumber: string | null
  serialNumbers: string[]
  quantity: number | null
  unitPrice: number | null
  retailPrice?: number | null
  wholesalePrice?: number | null
  retailPriceMode?: "auto" | "manual"
  wholesalePriceMode?: "auto" | "manual"
  additionalCosts?: import("./types.js").ProductAdditionalCostInput[]
  totalPrice: number | null
  currency: string | null
  countryOfOrigin: string | null
  weaponTypeId: string | null
  weaponSubtypeId: string | null
  brandId: string | null
  modelId: string | null
  caliberId: string | null
  storageLocationId: string | null
  confidence: Record<string, number>
  source: ManifestSource
  rawData: Record<string, unknown>
  status: ManifestItemStatus
  issues: ManifestValidationIssue[]
}

export interface ManifestReviewSummary {
  id: string
  shipmentId: string | null
  status: ManifestWorkflowStatus
  fileName: string
  shipmentNumber: string | null
  supplierName: string | null
  itemCount: number
  validationSummary: ShipmentManifestReview["validationSummary"]
  aiProvider: string | null
  createdAt: string
  updatedAt: string
}

export interface ManifestDetailsPatch {
  shipmentNumber?: string | null
  supplierId?: string | null
  supplierName?: string | null
  supplierReference?: string | null
  invoiceNumber?: string | null
  manifestNumber?: string | null
  shipmentDate?: string | null
  expectedArrivalDate?: string | null
  origin?: string | null
  destination?: string | null
  currency?: string | null
  reviewNote?: string | null
  additionalCosts?: import("./types.js").ShipmentAdditionalCostInput[]
}

export interface ShipmentManifestReview {
  id: string
  shipmentId: string | null
  status: ManifestWorkflowStatus
  fileName: string
  fileType: string
  fileSize: number
  fileHash: string
  shipmentNumber: string | null
  supplierName: string | null
  supplierId: string | null
  supplierReference: string | null
  invoiceNumber: string | null
  manifestNumber: string | null
  shipmentDate: string | null
  expectedArrivalDate: string | null
  origin: string | null
  destination: string | null
  currency: string | null
  reviewNote: string | null
  additionalCosts: import("./types.js").ShipmentAdditionalCostInput[]
  aiProvider: string | null
  aiModel: string | null
  aiRequestId: string | null
  aiProcessingMs: number | null
  processingWarning: string | null
  promptVersion: string | null
  schemaVersion: string
  validationSummary: { valid: number; needsReview: number; invalid: number; duplicate: number; conflict: number }
  items: ManifestReviewItem[]
  issues: ManifestValidationIssue[]
  createdAt: string
  updatedAt: string
  duplicateOf?: { importId: string; shipmentId: string | null; shipmentNumber: string | null } | null
}

export interface ManifestUploadInput {
  fileName: string
  mimeType: string
  bytes: Uint8Array
  /** Defaults to true to preserve the existing AI-first extraction flow. */
  aiEnabled?: boolean
}

export type ManifestExtractedItem = Omit<ManifestReviewItem, "id" | "issues" | "status">

export interface ManifestExtractionResult {
  fileName: string
  fileType: string
  fileSize: number
  fileHash: string
  shipmentNumber: string | null
  supplierName: string | null
  supplierReference: string | null
  invoiceNumber: string | null
  manifestNumber: string | null
  shipmentDate: string | null
  expectedArrivalDate: string | null
  origin: string | null
  destination: string | null
  currency: string | null
  aiProvider: string | null
  aiModel: string | null
  aiRequestId: string | null
  aiProcessingMs: number | null
  processingWarning: string | null
  promptVersion: string
  schemaVersion: string
  rawExtraction: Record<string, unknown>
  items: ManifestExtractedItem[]
}

export interface ManifestProgress {
  importId?: string
  stage: "uploading" | "reading" | "extracting" | "analyzing" | "normalizing" | "validating" | "preparing" | "complete" | "failed"
  percent: number
  message: string
}

export interface ManifestConfirmInput {
  importId: string
  shipmentNumber: string
  supplierId: string
  supplierReference?: string | null
  invoiceNumber?: string | null
  manifestNumber?: string | null
  shipmentDate: string
  expectedArrivalDate?: string | null
  origin?: string | null
  destination?: string | null
  currency: string
  arrival: "arrived_now" | "future"
  note?: string | null
}

export interface ManifestItemPatch {
  productType?: ManifestProductType | null
  productName?: string | null
  category?: string | null
  weaponType?: string | null
  manufacturer?: string | null
  model?: string | null
  caliber?: string | null
  sku?: string | null
  productCode?: string | null
  serialNumber?: string | null
  serialNumbers?: string[]
  quantity?: number | null
  unitPrice?: number | null
  retailPrice?: number | null
  wholesalePrice?: number | null
  retailPriceMode?: "auto" | "manual"
  wholesalePriceMode?: "auto" | "manual"
  additionalCosts?: import("./types.js").ProductAdditionalCostInput[]
  totalPrice?: number | null
  currency?: string | null
  countryOfOrigin?: string | null
  weaponTypeId?: string | null
  weaponSubtypeId?: string | null
  brandId?: string | null
  modelId?: string | null
  caliberId?: string | null
  storageLocationId?: string | null
}

const STATUS_TRANSITIONS: Record<ManifestWorkflowStatus, readonly ManifestWorkflowStatus[]> = {
  draft: ["processing", "cancelled"],
  processing: ["pending_review", "failed", "cancelled"],
  pending_review: ["scheduled", "arrived", "cancelled", "processing"],
  scheduled: ["arrived", "cancelled"],
  arrived: ["received", "scheduled", "cancelled"],
  received: [],
  failed: ["processing", "cancelled"],
  cancelled: [],
}

export function canTransitionManifest(from: ManifestWorkflowStatus, to: ManifestWorkflowStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to)
}

export function assertManifestTransition(from: ManifestWorkflowStatus, to: ManifestWorkflowStatus): void {
  if (!canTransitionManifest(from, to)) throw new Error(`Invalid shipment workflow transition: ${from} -> ${to}`)
}

export function normalizeSerial(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase()
}

export function normalizeCaliber(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  const raw = value.trim().normalize("NFKC").replace(/[×✕]/g, "x").replace(/\s+/g, " ")
  const compact = raw.toLowerCase().replace(/\s/g, "").replace(/,/g, ".")
  if (/^9(?:mm)?$/.test(compact)) return "9mm"
  if (/^9x19(?:mm)?$/.test(compact)) return "9x19mm"
  if (/^(12ga|12gauge)$/.test(compact)) return "12 GA"
  if (/^12\/(?:65|70|71|76|89)$/.test(compact)) return `12 GA (${compact})`
  if (/^(20ga|20gauge)$/.test(compact)) return "20 GA"
  if (/^20\/(?:70|76)$/.test(compact)) return `20 GA (${compact})`
  if (/^5\.5(?:mm)?$/.test(compact)) return "5.5mm"
  if (/^4\.5(?:mm)?$/.test(compact)) return "4.5mm"
  if (/^7\.62(?:mm)?$/.test(compact)) return "7.62mm"
  if (/^7\.65(?:mm)?$/.test(compact)) return "7.65mm"
  if (compact === ".22lr") return ".22 LR"
  return raw
}

export function summarizeItemStatuses(items: Pick<ManifestReviewItem, "status">[]): ShipmentManifestReview["validationSummary"] {
  const summary = { valid: 0, needsReview: 0, invalid: 0, duplicate: 0, conflict: 0 }
  for (const item of items) {
    if (item.status === "valid") summary.valid++
    else if (item.status === "needs_review") summary.needsReview++
    else if (item.status === "invalid") summary.invalid++
    else if (item.status === "duplicate") summary.duplicate++
    else summary.conflict++
  }
  return summary
}
