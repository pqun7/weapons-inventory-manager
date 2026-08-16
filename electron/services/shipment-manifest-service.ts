import { createHash, randomUUID } from "node:crypto"
import { getDb } from "../database.js"
import { repo } from "../repositories/index.js"
import { backendCurrencyService } from "./currency-service.js"
import { analyzeManifestWithAi, userFacingAiError, type AiManifestMetadata } from "./openai-manifest-service.js"
import {
  heuristicSpreadsheetItems, parseSpreadsheetBufferAsync, parseWordDocumentBufferAsync,
  type NativeExtraction, type ParsedManifestItem,
} from "./manifest-parser.js"
import {
  MANIFEST_PROMPT_VERSION, MANIFEST_SCHEMA_VERSION, assertManifestTransition, normalizeCaliber, normalizeSerial,
  summarizeItemStatuses,
  type ManifestConfirmInput, type ManifestDetailsPatch, type ManifestItemPatch, type ManifestProgress, type ManifestReviewItem, type ManifestReviewSummary,
  type ManifestUploadInput, type ManifestValidationIssue, type ManifestWorkflowStatus, type ShipmentManifestReview,
} from "../../src/lib/shipment-manifest.js"
import type { Accessory, Ammunition, Shipment, ShipmentLineItem, StorageLocation, Weapon } from "../../src/lib/types.js"
import { extractSupplierLegalName } from "../../src/lib/supplier-identity.js"
import {
  finalizeInventoryCosts,
  insertShipmentCosts,
  insertShipmentItemBasis,
  prepareShipmentCosts,
  type ShipmentItemCostBasis,
} from "./product-cost-service.js"
import { ensureAppDocumentIdentifiers } from "./manifest-document-identifiers.js"
import { validateManifestUpload } from "./manifest-upload-validation.js"

type CurrentUser = { id: string; name: string }
type ProgressCallback = (progress: ManifestProgress) => void

const ITEM_PATCH_COLUMNS: Record<keyof ManifestItemPatch, string> = {
  productType: "product_type", productName: "product_name", category: "category", weaponType: "weapon_type",
  manufacturer: "manufacturer", model: "model", caliber: "caliber", sku: "sku", productCode: "product_code",
  serialNumber: "serial_number", serialNumbers: "serial_numbers_json", quantity: "quantity", unitPrice: "unit_price",
  totalPrice: "total_price", currency: "currency", countryOfOrigin: "country_of_origin", weaponTypeId: "weapon_type_id",
  weaponSubtypeId: "weapon_subtype_id", brandId: "brand_id", modelId: "model_id", caliberId: "caliber_id",
  storageLocationId: "storage_location_id", retailPrice: "retail_price", wholesalePrice: "wholesale_price",
  retailPriceMode: "retail_price_mode", wholesalePriceMode: "wholesale_price_mode", additionalCosts: "additional_costs",
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

function cleanNullable(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function normalizedLookup(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
}

function nextId(prefix: string, table: string): string {
  const rows = getDb().prepare(`SELECT id FROM ${table} WHERE id LIKE ?`).all(`${prefix}%`) as Array<{ id: string }>
  let max = 0
  for (const row of rows) {
    const parsed = Number.parseInt(row.id.slice(prefix.length), 10)
    if (Number.isFinite(parsed)) max = Math.max(max, parsed)
  }
  return `${prefix}${String(max + 1).padStart(5, "0")}`
}

function audit(user: CurrentUser | { id: string; name?: string }, action: string, description: string, metadata: Record<string, unknown>): void {
  const now = new Date().toISOString()
  repo.insertAuditLog({
    id: nextId("LOG", "audit_logs"), timestamp: now, date: now.slice(0, 10), userId: user.id,
    actionType: action === "SHIPMENT_IMPORTED" ? "Import" : "Shipment",
    description,
    metadata: JSON.stringify({ schemaVersion: 3, action, actorName: user.name ?? user.id, source: "shipment-manifest", ...metadata }),
  })
}

function requireUser(user: CurrentUser): { id: string; name: string; role: string; permissions: Record<string, boolean> } {
  if (!user?.id || !user.name?.trim()) throw new Error("A valid current user is required")
  const row = getDb().prepare("SELECT id, name, role, permissions FROM users WHERE id = ?").get(user.id) as { id: string; name: string; role: string; permissions: string } | undefined
  if (!row) throw new Error("The current user no longer exists")
  return { ...row, permissions: parseJson(row.permissions, {}) }
}

function requirePermission(user: CurrentUser, permission: "shipment.import" | "shipment.review" | "shipment.edit" | "shipment.receive" | "shipment.reschedule" | "shipment.cancel"): void {
  const stored = requireUser(user)
  if (stored.role === "Admin") return
  const legacyImport = permission === "shipment.import" && stored.permissions.canImportExcel === true
  if (!legacyImport && stored.permissions[permission] !== true) throw new Error(`Permission required: ${permission}`)
}

export function authorizeManifest(user: CurrentUser, permission: "shipment.import" | "shipment.review" | "shipment.edit" | "shipment.receive" | "shipment.reschedule" | "shipment.cancel"): void {
  requirePermission(user, permission)
}

function emit(callback: ProgressCallback | undefined, progress: ManifestProgress): void {
  callback?.(progress)
}

function mergeExtractedItems(nativeItems: ParsedManifestItem[], aiItems: ParsedManifestItem[]): ParsedManifestItem[] {
  if (nativeItems.length === 0) return aiItems
  if (aiItems.length === 0) return nativeItems
  const usedAi = new Set<number>()
  const merged = nativeItems.map((nativeItem) => {
    const nativeSerials = new Set(nativeItem.serialNumbers.map(normalizeSerial))
    const matchIndex = aiItems.findIndex((aiItem, index) => {
      if (usedAi.has(index)) return false
      const sameSource = nativeItem.source.sheet && aiItem.source.sheet === nativeItem.source.sheet && nativeItem.source.row != null && aiItem.source.row === nativeItem.source.row
      const sameSerial = aiItem.serialNumbers.some((serial) => nativeSerials.has(normalizeSerial(serial)))
      return Boolean(sameSource || sameSerial)
    })
    if (matchIndex < 0) return nativeItem
    usedAi.add(matchIndex)
    const aiItem = aiItems[matchIndex]
    const serialNumbers = [...new Set([...nativeItem.serialNumbers, ...aiItem.serialNumbers].map(normalizeSerial).filter(Boolean))]
    const combined = { ...nativeItem } as ParsedManifestItem
    const semanticFields: Array<keyof ParsedManifestItem> = [
      "productType", "productName", "category", "weaponType", "manufacturer", "model", "caliber", "sku", "productCode",
      "unitPrice", "totalPrice", "currency", "countryOfOrigin",
    ]
    for (const field of semanticFields) {
      const aiValue = aiItem[field]
      const nativeValue = nativeItem[field]
      const aiConfidence = aiItem.confidence[String(field)] ?? 0
      const nativeConfidence = nativeItem.confidence[String(field)] ?? 0
      if (aiValue != null && aiValue !== "" && (nativeValue == null || nativeValue === "" || aiConfidence > nativeConfidence + 0.05)) {
        ;(combined as Record<string, unknown>)[field] = aiValue
      }
    }
    const combinedConfidence: Record<string, number> = { ...nativeItem.confidence }
    for (const [field, confidence] of Object.entries(aiItem.confidence)) combinedConfidence[field] = Math.max(combinedConfidence[field] ?? 0, confidence)
    return {
      ...combined,
      rowIndex: nativeItem.rowIndex,
      serialNumbers,
      serialNumber: serialNumbers.length === 1 ? serialNumbers[0] : null,
      // Declared/native quantity is never rewritten merely to match an AI result or serial count.
      // A mismatch is validation evidence that must remain visible to the reviewer.
      quantity: nativeItem.quantity ?? aiItem.quantity,
      confidence: combinedConfidence,
      source: { ...nativeItem.source, ...aiItem.source },
      rawData: { ...nativeItem.rawData, ai: aiItem.rawData },
    }
  })
  for (const [index, item] of aiItems.entries()) if (!usedAi.has(index)) merged.push(item)
  return merged
}

function nativeMetadata(extraction: NativeExtraction | undefined): AiManifestMetadata {
  const source = extraction?.text ?? ""
  const structuredValue = (patterns: RegExp[]): string | null => {
    for (const sheet of extraction?.sheets ?? []) {
      for (let rowIndex = 0; rowIndex < sheet.rows.length; rowIndex++) {
        const row = sheet.rows[rowIndex]
        for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex++) {
          const cellText = String(row.cells[cellIndex].value).trim()
          if (!patterns.some((pattern) => pattern.test(cellText))) continue
          const afterColon = cellText.match(/:\s*(.+)$/)?.[1]?.trim()
          if (afterColon) return afterColon
          const next = row.cells.slice(cellIndex + 1).find((cell) => String(cell.value).trim())
          if (next) return String(next.value).trim()
          for (const following of sheet.rows.slice(rowIndex + 1, rowIndex + 4)) {
            const sameColumn = following.cells.find((candidate) => candidate.column === row.cells[cellIndex].column && String(candidate.value).trim())
            if (sameColumn) return String(sameColumn.value).trim()
          }
        }
      }
    }
    return null
  }
  const normalizeDateValue = (value: string | null): string | null => {
    if (!value) return null
    const serial = Number(value)
    if (Number.isInteger(serial) && serial > 20_000 && serial < 100_000) return new Date(Date.UTC(1899, 11, 30 + serial)).toISOString().slice(0, 10)
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
  }
  const pick = (patterns: RegExp[]): string | null => {
    for (const pattern of patterns) {
      const match = source.match(pattern)
      if (match?.[1]?.trim()) return match[1].trim().replace(/\t.*$/, "")
    }
    return null
  }
  return {
    shipmentNumber: structuredValue([/^commercial\s*#?$/i, /^manifest\s*(?:number|no)?:?$/i, /^shipment\s*(?:number|no)?:?$/i]) ?? pick([/(?:commercial\s*#|manifest\s*(?:number|no)|shipment\s*(?:number|no))\s*[:#]?\s*([^\n]+)/i]),
    supplier: extractSupplierLegalName(structuredValue([/^shipper\s*:/i, /^exporter\s*:?$/i, /^supplier\s*:/i]) ?? pick([/(?:shipper|exporter|supplier)\s*[:#]?\s*([^\n]+)/i])),
    supplierReference: null,
    invoiceNumber: structuredValue([/^invoice\s*(?:number|no)?\s*:?$/i]) ?? pick([/invoice\s*(?:number|no)?\s*[:#]?\s*([^\n]+)/i]),
    manifestNumber: structuredValue([/^manifest\s*(?:number|no)\s*:?$/i]) ?? pick([/manifest\s*(?:number|no)\s*[:#]?\s*([^\n]+)/i]),
    shipmentDate: normalizeDateValue(structuredValue([/^date\s*:?$/i, /^shipment\s*date\s*:?$/i])), expectedArrivalDate: null,
    origin: pick([/(?:origin|country\s*of\s*origin)\s*[:#]?\s*([^\n]+)/i]),
    destination: pick([/(?:destination|consignee)\s*[:#]?\s*([^\n]+)/i]),
    currency: pick([/(?:currency)\s*[:#]?\s*([A-Z]{3})/i])?.toUpperCase() ?? null,
    confidence: {},
  }
}

function mergeMetadata(native: AiManifestMetadata, ai: AiManifestMetadata | undefined): AiManifestMetadata {
  const result = { ...native, confidence: { ...native.confidence } }
  if (!ai) return result
  for (const key of ["shipmentNumber", "supplier", "supplierReference", "invoiceNumber", "manifestNumber", "shipmentDate", "expectedArrivalDate", "origin", "destination", "currency"] as const) {
    if (ai[key]) result[key] = ai[key]
  }
  result.confidence = { ...native.confidence, ...ai.confidence }
  return result
}

function findId(rows: Array<{ id: string; label: string }>, value: string | null, allowContains = true): string | null {
  const target = normalizedLookup(value)
  if (!target) return null
  const exact = rows.find((row) => normalizedLookup(row.label) === target)
  if (exact) return exact.id
  if (!allowContains) return null
  const contained = rows.filter((row) => target.includes(normalizedLookup(row.label)) || normalizedLookup(row.label).includes(target))
  return contained.length === 1 ? contained[0].id : null
}

function findCaliberId(rows: Array<{ id: string; label: string }>, value: string | null, productText: string): string | null {
  const normalized = normalizeCaliber(value ?? productText)
  const direct = findId(rows, normalized ?? productText)
  if (direct) return direct
  const aliases: Record<string, string[]> = {
    "5.5mm": [".22"],
    "4.5mm": [".177"],
    "12 GA (12/76)": ["12 GA"],
    "12 GA (12/71)": ["12 GA"],
  }
  for (const alias of aliases[normalized ?? ""] ?? []) {
    const match = findId(rows, alias, false)
    if (match) return match
  }
  return null
}

function enrichMappings(items: ParsedManifestItem[]): ParsedManifestItem[] {
  const db = getDb()
  const weaponTypes = db.prepare("SELECT id, label FROM weapon_types").all() as Array<{ id: string; label: string }>
  const subtypes = db.prepare("SELECT id, label, weapon_type_id FROM weapon_subtypes").all() as Array<{ id: string; label: string; weapon_type_id: string }>
  const calibers = db.prepare("SELECT id, label FROM calibers").all() as Array<{ id: string; label: string }>
  const brands = db.prepare("SELECT id, label FROM brands").all() as Array<{ id: string; label: string }>
  const models = db.prepare("SELECT id, label, brand_id FROM models").all() as Array<{ id: string; label: string; brand_id: string }>
  const defaultLocation = db.prepare("SELECT id FROM storage_locations ORDER BY id LIMIT 1").get() as { id: string } | undefined
  return items.map((item) => {
    const productText = [item.weaponType, item.category, item.productName].filter(Boolean).join(" ")
    item.caliber = normalizeCaliber(item.caliber)
    item.weaponTypeId = findId(weaponTypes, item.weaponType ?? productText)
    item.brandId = findId(brands, item.manufacturer ?? item.productName)
    item.modelId = findId(models.filter((model) => !item.brandId || model.brand_id === item.brandId), item.model ?? item.productName)
    item.caliberId = findCaliberId(calibers, item.caliber, productText)
    item.weaponSubtypeId = findId(subtypes.filter((subtype) => !item.weaponTypeId || subtype.weapon_type_id === item.weaponTypeId), productText)
    item.storageLocationId = defaultLocation?.id ?? null
    if (!item.manufacturer && item.brandId) {
      item.manufacturer = brands.find((brand) => brand.id === item.brandId)?.label ?? null
      if (item.manufacturer) item.confidence.manufacturer = Math.max(item.confidence.manufacturer ?? 0, 0.9)
    }
    if (!item.model && item.modelId) {
      item.model = models.find((model) => model.id === item.modelId)?.label ?? null
      if (item.model) item.confidence.model = Math.max(item.confidence.model ?? 0, 0.9)
    }
    return item
  })
}

function insertStatusHistory(importId: string, shipmentId: string | null, from: ManifestWorkflowStatus | null, to: ManifestWorkflowStatus, userId: string, note = ""): void {
  getDb().prepare(`INSERT INTO shipment_status_history (id, import_id, shipment_id, from_status, to_status, note, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), importId, shipmentId, from, to, note, userId)
}

function transition(importId: string, to: ManifestWorkflowStatus, userId: string, note = ""): void {
  const row = getDb().prepare("SELECT status, shipment_id FROM shipment_imports WHERE id = ?").get(importId) as { status: ManifestWorkflowStatus; shipment_id: string | null } | undefined
  if (!row) throw new Error("Manifest import not found")
  assertManifestTransition(row.status, to)
  getDb().prepare("UPDATE shipment_imports SET status = ?, updated_at = datetime('now') WHERE id = ?").run(to, importId)
  insertStatusHistory(importId, row.shipment_id, row.status, to, userId, note)
}

function issue(importId: string, itemId: string | null, fieldName: string | null, code: string, severity: ManifestValidationIssue["severity"], message: string, details: Record<string, unknown> = {}): void {
  getDb().prepare(`INSERT INTO shipment_validation_issues (id, import_id, item_id, field_name, code, severity, message, details_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), importId, itemId, fieldName, code, severity, message, JSON.stringify(details))
}

function validateImport(importId: string): void {
  const db = getDb()
  db.prepare("DELETE FROM shipment_validation_issues WHERE import_id = ?").run(importId)
  const rows = db.prepare("SELECT * FROM shipment_import_items WHERE import_id = ? ORDER BY row_index").all(importId) as Array<Record<string, unknown>>
  const inventorySerials = new Set((db.prepare("SELECT serial_number FROM weapons WHERE deleted_at IS NULL").all() as Array<{ serial_number: string }>).map((row) => normalizeSerial(row.serial_number)))
  const pendingSerials = new Set((db.prepare(`
    SELECT CAST(serial.value AS TEXT) AS serial_number
    FROM shipment_import_items sii
    JOIN shipment_imports si ON si.id = sii.import_id
    JOIN json_each(sii.serial_numbers_json) serial
    WHERE sii.import_id <> ? AND si.status IN ('processing','pending_review','scheduled','arrived')
  `).all(importId) as Array<{ serial_number: string }>).map((row) => normalizeSerial(row.serial_number)))
  const pendingSkus = new Set((db.prepare(`
    SELECT sii.sku FROM shipment_import_items sii
    JOIN shipment_imports si ON si.id = sii.import_id
    WHERE sii.import_id <> ? AND si.status IN ('processing','pending_review','scheduled','arrived') AND sii.sku IS NOT NULL
  `).all(importId) as Array<{ sku: string }>).map((row) => normalizedLookup(row.sku)))
  const counts = new Map<string, number>()
  const skuCounts = new Map<string, number>()
  const rowFingerprints = new Map<string, number>()
  for (const row of rows) {
    const serials = parseJson<string[]>(row.serial_numbers_json, []).map(normalizeSerial)
    for (const serial of serials) counts.set(serial, (counts.get(serial) ?? 0) + 1)
    const sku = cleanNullable(row.sku)
    if (sku) skuCounts.set(normalizedLookup(sku), (skuCounts.get(normalizedLookup(sku)) ?? 0) + 1)
    const fingerprint = [row.product_type, normalizedLookup(cleanNullable(row.product_name)), normalizedLookup(cleanNullable(row.manufacturer)), normalizedLookup(cleanNullable(row.model)), normalizedLookup(cleanNullable(row.caliber)), row.quantity, row.unit_price]
      .map((value) => String(value ?? "")).join("|")
    if (!serials.length && fingerprint.replaceAll("|", "")) rowFingerprints.set(fingerprint, (rowFingerprints.get(fingerprint) ?? 0) + 1)
  }
  for (const row of rows) {
    const id = String(row.id)
    const serials = parseJson<string[]>(row.serial_numbers_json, []).map(normalizeSerial)
    const quantity = row.quantity == null ? null : Number(row.quantity)
    let status: ManifestReviewItem["status"] = "valid"
    const error = (field: string | null, code: string, message: string) => { issue(importId, id, field, code, "error", message); if (status === "valid" || status === "needs_review") status = "invalid" }
    const warning = (field: string | null, code: string, message: string) => { issue(importId, id, field, code, "warning", message); if (status === "valid") status = "needs_review" }
    const receiptRequirement = (field: string | null, code: string, message: string) => issue(importId, id, field, code, "warning", message, { scope: "receipt", blocksReceipt: true })
    const conflict = (field: string | null, code: string, message: string, duplicate = false) => { issue(importId, id, field, code, "conflict", message); status = duplicate ? "duplicate" : "conflict" }
    if (!cleanNullable(row.product_name)) error("productName", "PRODUCT_REQUIRED", "Product name is required")
    if (!new Set(["weapon", "ammunition", "accessory"]).has(String(row.product_type))) error("productType", "PRODUCT_TYPE_REQUIRED", "Select a valid product type")
    if (!Number.isInteger(quantity) || (quantity ?? 0) <= 0) error("quantity", "QUANTITY_INVALID", "Quantity must be a positive integer")
    if (row.unit_price != null && Number(row.unit_price) < 0) error("unitPrice", "UNIT_PRICE_NEGATIVE", "Unit price cannot be negative")
    if (row.total_price != null && Number(row.total_price) < 0) error("totalPrice", "TOTAL_PRICE_NEGATIVE", "Total price cannot be negative")
    const confidence = parseJson<Record<string, number>>(row.confidence_json, {})
    if (["productName", "quantity"].some((field) => (confidence[field] ?? 0) < 0.6)) warning(null, "LOW_CONFIDENCE", "One or more important fields have low confidence")
    if (row.product_type === "weapon") {
      if (serials.length === 0) error("serialNumbers", "SERIAL_REQUIRED", "Serialized weapons require serial numbers")
      if (quantity != null && serials.length !== quantity) error("serialNumbers", "SERIAL_COUNT_MISMATCH", "Serial count must equal weapon quantity")
      if (!cleanNullable(row.weapon_type)) receiptRequirement("weaponType", "WEAPON_TYPE_REQUIRED_FOR_RECEIPT", "Enter the weapon type before inventory receipt")
      if (!cleanNullable(row.manufacturer)) receiptRequirement("manufacturer", "MANUFACTURER_REQUIRED_FOR_RECEIPT", "Enter the manufacturer before inventory receipt")
      if (!cleanNullable(row.model)) receiptRequirement("model", "MODEL_REQUIRED_FOR_RECEIPT", "Enter the model before inventory receipt")
      if (!cleanNullable(row.caliber)) receiptRequirement("caliber", "CALIBER_REQUIRED_FOR_RECEIPT", "Enter the caliber before inventory receipt")
    }
    if (row.product_type === "ammunition" && !cleanNullable(row.caliber)) warning("caliber", "CALIBER_REVIEW_REQUIRED", "Review the ammunition caliber before receipt")
    if (row.unit_price == null || Number(row.unit_price) <= 0) receiptRequirement("unitPrice", "PURCHASE_PRICE_REQUIRED_FOR_RECEIPT", "A positive purchase price is required before inventory receipt")
    for (const serial of serials) {
      if ((counts.get(serial) ?? 0) > 1) conflict("serialNumbers", "DUPLICATE_IN_MANIFEST", `Serial ${serial} appears more than once in this manifest`, true)
      if (inventorySerials.has(serial)) conflict("serialNumbers", "DUPLICATE_IN_INVENTORY", `Serial ${serial} already exists in inventory`)
      else if (pendingSerials.has(serial)) conflict("serialNumbers", "DUPLICATE_IN_PENDING_SHIPMENT", `Serial ${serial} exists in another pending shipment`)
    }
    const sku = cleanNullable(row.sku)
    if (sku && (skuCounts.get(normalizedLookup(sku)) ?? 0) > 1) warning("sku", "POTENTIAL_DUPLICATE_SKU", `SKU ${sku} appears on multiple manifest rows`)
    if (sku && pendingSkus.has(normalizedLookup(sku))) warning("sku", "POTENTIAL_DUPLICATE_SKU_PENDING", `SKU ${sku} appears in another pending shipment`)
    const fingerprint = [row.product_type, normalizedLookup(cleanNullable(row.product_name)), normalizedLookup(cleanNullable(row.manufacturer)), normalizedLookup(cleanNullable(row.model)), normalizedLookup(cleanNullable(row.caliber)), row.quantity, row.unit_price]
      .map((value) => String(value ?? "")).join("|")
    if (serials.length === 0 && (rowFingerprints.get(fingerprint) ?? 0) > 1) warning(null, "POTENTIAL_DUPLICATE_ROW", "An identical non-serialized item appears more than once; confirm that both rows are intentional")
    db.prepare("UPDATE shipment_import_items SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id)
  }
  const items = db.prepare("SELECT status FROM shipment_import_items WHERE import_id = ?").all(importId) as Array<{ status: ManifestReviewItem["status"] }>
  db.prepare("UPDATE shipment_imports SET validation_summary = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(summarizeItemStatuses(items)), importId)
}

function persistItems(importId: string, items: ParsedManifestItem[]): void {
  const db = getDb()
  const insert = db.prepare(`INSERT INTO shipment_import_items (
    id, import_id, row_index, product_type, product_name, category, weapon_type, manufacturer, model, caliber, sku, product_code,
    serial_number, serial_numbers_json, quantity, unit_price, retail_price, wholesale_price, retail_price_mode, wholesale_price_mode,
    additional_costs, total_price, currency, country_of_origin,
    weapon_type_id, weapon_subtype_id, brand_id, model_id, caliber_id, storage_location_id,
    confidence_json, source_json, raw_data_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  for (const item of items) insert.run(
    randomUUID(), importId, item.rowIndex, item.productType, item.productName, item.category, item.weaponType, item.manufacturer,
    item.model, item.caliber, item.sku, item.productCode, item.serialNumber, JSON.stringify(item.serialNumbers), item.quantity,
    item.unitPrice, item.retailPrice, item.wholesalePrice, item.retailPriceMode ?? "manual", item.wholesalePriceMode ?? "manual",
    JSON.stringify(item.additionalCosts ?? []), item.totalPrice, item.currency, item.countryOfOrigin, item.weaponTypeId, item.weaponSubtypeId, item.brandId,
    item.modelId, item.caliberId, item.storageLocationId, JSON.stringify(item.confidence), JSON.stringify(item.source), JSON.stringify(item.rawData),
  )
}

function mapIssueRow(row: Record<string, unknown>): ManifestValidationIssue {
  return { id: String(row.id), itemId: cleanNullable(row.item_id), fieldName: cleanNullable(row.field_name), code: String(row.code), severity: row.severity as ManifestValidationIssue["severity"], message: String(row.message), details: parseJson(row.details_json, {}) }
}

export function getManifestReview(importId: string): ShipmentManifestReview {
  const db = getDb()
  const row = db.prepare("SELECT * FROM shipment_imports WHERE id = ?").get(importId) as Record<string, unknown> | undefined
  if (!row) throw new Error("Manifest import not found")
  const issueRows = db.prepare("SELECT * FROM shipment_validation_issues WHERE import_id = ? ORDER BY created_at, id").all(importId) as Array<Record<string, unknown>>
  const issues = issueRows.map(mapIssueRow)
  const items = (db.prepare("SELECT * FROM shipment_import_items WHERE import_id = ? ORDER BY row_index").all(importId) as Array<Record<string, unknown>>).map((item): ManifestReviewItem => ({
    id: String(item.id), rowIndex: Number(item.row_index), productType: item.product_type as ManifestReviewItem["productType"], productName: cleanNullable(item.product_name),
    category: cleanNullable(item.category), weaponType: cleanNullable(item.weapon_type), manufacturer: cleanNullable(item.manufacturer), model: cleanNullable(item.model), caliber: cleanNullable(item.caliber),
    sku: cleanNullable(item.sku), productCode: cleanNullable(item.product_code), serialNumber: cleanNullable(item.serial_number), serialNumbers: parseJson(item.serial_numbers_json, []),
    quantity: item.quantity == null ? null : Number(item.quantity), unitPrice: item.unit_price == null ? null : Number(item.unit_price), totalPrice: item.total_price == null ? null : Number(item.total_price),
    retailPrice: item.retail_price == null ? null : Number(item.retail_price), wholesalePrice: item.wholesale_price == null ? null : Number(item.wholesale_price),
    retailPriceMode: (cleanNullable(item.retail_price_mode) as "auto" | "manual" | null) ?? "manual",
    wholesalePriceMode: (cleanNullable(item.wholesale_price_mode) as "auto" | "manual" | null) ?? "manual", additionalCosts: parseJson(item.additional_costs, []),
    currency: cleanNullable(item.currency), countryOfOrigin: cleanNullable(item.country_of_origin), weaponTypeId: cleanNullable(item.weapon_type_id), weaponSubtypeId: cleanNullable(item.weapon_subtype_id),
    brandId: cleanNullable(item.brand_id), modelId: cleanNullable(item.model_id), caliberId: cleanNullable(item.caliber_id), storageLocationId: cleanNullable(item.storage_location_id),
    confidence: parseJson(item.confidence_json, {}), source: parseJson(item.source_json, {}), rawData: parseJson(item.raw_data_json, {}), status: item.status as ManifestReviewItem["status"],
    issues: issues.filter((candidate) => candidate.itemId === item.id),
  }))
  return {
    id: String(row.id), shipmentId: cleanNullable(row.shipment_id), status: row.status as ManifestWorkflowStatus, fileName: String(row.file_name), fileType: String(row.file_type), fileSize: Number(row.file_size), fileHash: String(row.file_hash),
    shipmentNumber: cleanNullable(row.shipment_number), supplierName: cleanNullable(row.supplier_name), supplierId: cleanNullable(row.supplier_id), supplierReference: cleanNullable(row.supplier_reference),
    invoiceNumber: cleanNullable(row.invoice_number), manifestNumber: cleanNullable(row.manifest_number), shipmentDate: cleanNullable(row.shipment_date), expectedArrivalDate: cleanNullable(row.expected_arrival_date),
    origin: cleanNullable(row.origin), destination: cleanNullable(row.destination), currency: cleanNullable(row.currency), reviewNote: cleanNullable(row.review_note), additionalCosts: parseJson(row.additional_costs, []), aiProvider: cleanNullable(row.ai_provider), aiModel: cleanNullable(row.ai_model),
    aiRequestId: cleanNullable(row.ai_request_id), aiProcessingMs: row.ai_processing_ms == null ? null : Number(row.ai_processing_ms), promptVersion: cleanNullable(row.prompt_version), schemaVersion: String(row.schema_version),
    processingWarning: row.error_code === "AI_FALLBACK" || row.error_code === "AI_PROVIDER_FALLBACK" ? cleanNullable(row.error_message) : null,
    validationSummary: parseJson(row.validation_summary, { valid: 0, needsReview: 0, invalid: 0, duplicate: 0, conflict: 0 }), items, issues,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }
}

export function listManifestReviews(limit = 20): ManifestReviewSummary[] {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)))
  const rows = getDb().prepare(`
    SELECT si.id, si.shipment_id, si.status, si.file_name, si.shipment_number, si.supplier_name,
           si.validation_summary, si.ai_provider, si.created_at, si.updated_at, COUNT(sii.id) AS item_count
    FROM shipment_imports si
    LEFT JOIN shipment_import_items sii ON sii.import_id = si.id
    WHERE si.status IN ('processing','pending_review','failed')
    GROUP BY si.id
    ORDER BY si.updated_at DESC
    LIMIT ?
  `).all(safeLimit) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    id: String(row.id), shipmentId: cleanNullable(row.shipment_id), status: row.status as ManifestWorkflowStatus,
    fileName: String(row.file_name), shipmentNumber: cleanNullable(row.shipment_number), supplierName: cleanNullable(row.supplier_name),
    itemCount: Number(row.item_count), validationSummary: parseJson(row.validation_summary, { valid: 0, needsReview: 0, invalid: 0, duplicate: 0, conflict: 0 }),
    aiProvider: cleanNullable(row.ai_provider), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }))
}

export async function processManifestUpload(input: ManifestUploadInput, user: CurrentUser, progress?: ProgressCallback): Promise<ShipmentManifestReview> {
  requirePermission(user, "shipment.import")
  emit(progress, { stage: "uploading", percent: 5, message: "Validating uploaded document" })
  const validated = validateManifestUpload(input)
  const fileHash = createHash("sha256").update(validated.bytes).digest("hex")
  const duplicate = getDb().prepare(`SELECT id, shipment_id, shipment_number, status, prompt_version, schema_version FROM shipment_imports WHERE file_hash = ? AND status NOT IN ('failed','cancelled') ORDER BY created_at DESC LIMIT 1`).get(fileHash) as { id: string; shipment_id: string | null; shipment_number: string | null; status: ManifestWorkflowStatus; prompt_version: string | null; schema_version: string } | undefined
  if (duplicate && (duplicate.prompt_version === MANIFEST_PROMPT_VERSION && duplicate.schema_version === MANIFEST_SCHEMA_VERSION || Boolean(duplicate.shipment_id))) {
    const review = getManifestReview(duplicate.id)
    review.duplicateOf = { importId: duplicate.id, shipmentId: duplicate.shipment_id, shipmentNumber: duplicate.shipment_number }
    return review
  }
  if (duplicate && duplicate.status === "pending_review" && !duplicate.shipment_id) {
    getDb().transaction(() => {
      transition(duplicate.id, "cancelled", user.id, "Superseded by a newer extraction schema")
      audit(user, "SHIPMENT_IMPORT_SUPERSEDED", `Manifest review ${duplicate.id} superseded by a newer extraction`, { previousImportId: duplicate.id, fileHash, previousPromptVersion: duplicate.prompt_version, previousSchemaVersion: duplicate.schema_version })
    })()
  }
  const importId = randomUUID()
  const now = new Date().toISOString()
  getDb().transaction(() => {
    getDb().prepare(`INSERT INTO shipment_imports (id, status, file_name, file_type, file_size, file_hash, prompt_version, schema_version, created_by, created_at, updated_at) VALUES (?, 'processing', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(importId, input.fileName, validated.mimeType, validated.bytes.byteLength, fileHash, MANIFEST_PROMPT_VERSION, MANIFEST_SCHEMA_VERSION, user.id, now, now)
    getDb().prepare(`INSERT INTO shipment_documents (id, import_id, file_name, mime_type, file_size, file_hash, content_blob, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), importId, input.fileName, validated.mimeType, validated.bytes.byteLength, fileHash, Buffer.from(validated.bytes), user.id)
    insertStatusHistory(importId, null, null, "processing", user.id, "Manifest upload accepted")
  })()
  try {
    emit(progress, { importId, stage: "reading", percent: 20, message: "Reading document" })
    let native: NativeExtraction | undefined
    if ([".xlsx", ".xls", ".csv"].includes(validated.extension)) native = await parseSpreadsheetBufferAsync(validated.bytes)
    else if ([".doc", ".docx"].includes(validated.extension)) native = await parseWordDocumentBufferAsync(validated.bytes)
    emit(progress, { importId, stage: "extracting", percent: 38, message: "Extracting tables and text" })
    const heuristicItems = native ? heuristicSpreadsheetItems(native) : []
    const aiEnabled = input.aiEnabled !== false
    emit(progress, { importId, stage: "analyzing", percent: 55, message: aiEnabled ? "Analyzing document semantics with AI" : "Analyzing document locally" })
    let ai: Awaited<ReturnType<typeof analyzeManifestWithAi>> = null
    let aiFallbackReason: string | null = null
    if (aiEnabled) {
      try {
        ai = await analyzeManifestWithAi({ fileName: input.fileName, mimeType: validated.mimeType, bytes: validated.bytes, nativeExtraction: native, nativeItems: heuristicItems })
      } catch (error) {
        const safeMessage = userFacingAiError(error)
        console.error("[shipment-manifest] AI extraction failed; native extraction will be retained", error)
        if (!native) throw new Error(safeMessage)
        aiFallbackReason = safeMessage
      }
    }
    if (!ai && !native) {
      throw new Error(aiEnabled
        ? "AI extraction is required for PDF and image manifests"
        : "Local-only analysis supports XLSX, XLS, CSV, DOC, and DOCX manifests. Enable AI analysis for PDF and image files.")
    }
    const extractedMetadata = mergeMetadata(nativeMetadata(native), ai?.shipment)
    const { metadata, generated: appGeneratedIdentifiers } = ensureAppDocumentIdentifiers(extractedMetadata, fileHash)
    const items = enrichMappings(mergeExtractedItems(heuristicItems, ai?.items ?? []))
    if (items.length === 0) throw new Error("No shipment items could be extracted from this document")
    emit(progress, { importId, stage: "normalizing", percent: 72, message: "Normalizing extracted data" })
    getDb().transaction(() => {
      persistItems(importId, items)
      getDb().prepare(`UPDATE shipment_imports SET raw_extraction_json = ?, normalized_json = ?, shipment_number = ?, supplier_name = ?, supplier_reference = ?, invoice_number = ?, manifest_number = ?, shipment_date = ?, expected_arrival_date = ?, origin = ?, destination = ?, currency = ?, ai_provider = ?, ai_model = ?, ai_request_id = ?, ai_processing_ms = ?, ai_requested_at = ?, error_code = ?, error_message = ?, updated_at = datetime('now') WHERE id = ?`).run(
        JSON.stringify({ ...(native?.raw ?? ai?.raw ?? {}), appGeneratedIdentifiers }), JSON.stringify({ shipment: metadata, itemCount: items.length, appGeneratedIdentifiers }), metadata.shipmentNumber, metadata.supplier, metadata.supplierReference,
        metadata.invoiceNumber, metadata.manifestNumber, metadata.shipmentDate, metadata.expectedArrivalDate, metadata.origin, metadata.destination, metadata.currency,
        ai?.provider ?? "native", ai?.model ?? null, ai?.requestId ?? null, ai?.durationMs ?? null, ai ? now : null,
        ai?.fallbackReason ? "AI_PROVIDER_FALLBACK" : aiFallbackReason ? "AI_FALLBACK" : null, ai?.fallbackReason ?? aiFallbackReason, importId,
      )
      validateImport(importId)
      transition(importId, "pending_review", user.id, "Extraction and validation completed")
      audit(user, "SHIPMENT_AI_PROCESSED", `Manifest ${input.fileName} processed for review`, { importId, fileHash, itemCount: items.length, aiProvider: ai?.provider ?? "native", model: ai?.model, requestId: ai?.requestId, processingMs: ai?.durationMs, promptVersion: MANIFEST_PROMPT_VERSION, aiFallback: Boolean(ai?.fallbackReason ?? aiFallbackReason) })
    })()
    emit(progress, { importId, stage: "complete", percent: 100, message: "Manifest is ready for review" })
    return getManifestReview(importId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    getDb().transaction(() => {
      const current = getDb().prepare("SELECT status FROM shipment_imports WHERE id = ?").get(importId) as { status: ManifestWorkflowStatus }
      if (current.status === "processing") transition(importId, "failed", user.id, message)
      getDb().prepare("UPDATE shipment_imports SET error_code = 'PROCESSING_FAILED', error_message = ?, updated_at = datetime('now') WHERE id = ?").run(message, importId)
      repo.insertNotification({ id: nextId("NTF", "app_notifications"), type: "System", title: "Shipment processing failed", message: `Unable to process ${input.fileName}. Please review the file or try another format.`, date: now.slice(0, 10), read: false, entityId: importId })
    })()
    emit(progress, { importId, stage: "failed", percent: 100, message: "Unable to extract shipment data" })
    throw error
  }
}

function assertPendingReview(importId: string): void {
  const session = getDb().prepare("SELECT status FROM shipment_imports WHERE id = ?").get(importId) as { status: ManifestWorkflowStatus } | undefined
  if (!session || session.status !== "pending_review") throw new Error("Only manifests pending review can be edited")
}

function normalizeItemPatchValue(field: keyof ManifestItemPatch, value: ManifestItemPatch[keyof ManifestItemPatch]): unknown {
  if (field === "serialNumbers") {
    if (!Array.isArray(value)) throw new Error("Serial numbers must be an array")
    return JSON.stringify([...new Set(value.map((serial) => normalizeSerial(String(serial))).filter(Boolean))])
  }
  if (field === "caliber") return normalizeCaliber(value as string | null)
  if (field === "currency") {
    if (value == null || value === "") return null
    const currency = String(value).trim().toUpperCase()
    backendCurrencyService.requireCurrency(currency, true)
    return currency
  }
  if (["quantity", "unitPrice", "retailPrice", "wholesalePrice", "totalPrice"].includes(field)) {
    if (value == null || value === "") return null
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be a finite number`)
    return value
  }
  if ((field === "retailPriceMode" || field === "wholesalePriceMode") && value != null) {
    if (value !== "auto" && value !== "manual") throw new Error(`${field} must be auto or manual`)
    return value
  }
  if (field === "additionalCosts") return JSON.stringify(value ?? [])
  if (field === "productType" && value != null && !["weapon", "ammunition", "accessory"].includes(String(value))) throw new Error("Invalid product type")
  if (typeof value === "string") return cleanNullable(value)
  return value ?? null
}

function applyItemPatch(importId: string, itemId: string, patch: ManifestItemPatch, user: CurrentUser): string[] {
  const db = getDb()
  const existing = db.prepare("SELECT * FROM shipment_import_items WHERE id = ? AND import_id = ?").get(itemId, importId) as Record<string, unknown> | undefined
  if (!existing) throw new Error("Manifest item not found")
  const changed: string[] = []
  for (const [field, value] of Object.entries(patch) as Array<[keyof ManifestItemPatch, ManifestItemPatch[keyof ManifestItemPatch]]>) {
    const column = ITEM_PATCH_COLUMNS[field]
    if (!column) continue
    const stored = normalizeItemPatchValue(field, value)
    const oldValue = existing[column]
    if (JSON.stringify(oldValue) === JSON.stringify(stored)) continue
    db.prepare(`UPDATE shipment_import_items SET ${column} = ?, updated_at = datetime('now') WHERE id = ?`).run(stored, itemId)
    db.prepare(`INSERT INTO shipment_item_changes (id, import_id, item_id, field_name, old_value, new_value, source, changed_by) VALUES (?, ?, ?, ?, ?, ?, 'user', ?)`)
      .run(randomUUID(), importId, itemId, field, oldValue == null ? null : String(oldValue), stored == null ? null : String(stored), user.id)
    changed.push(field)
  }
  if (Object.hasOwn(patch, "serialNumbers")) {
    const serials = parseJson<string[]>(normalizeItemPatchValue("serialNumbers", patch.serialNumbers), [])
    db.prepare("UPDATE shipment_import_items SET serial_number = ? WHERE id = ?").run(serials.length === 1 ? serials[0] : null, itemId)
  }
  // Text fields are the user-facing source of truth. Clear stale internal links so
  // they are resolved again from the reviewed values during confirmation.
  if (changed.includes("weaponType") && !Object.hasOwn(patch, "weaponTypeId")) {
    db.prepare("UPDATE shipment_import_items SET weapon_type_id = NULL, weapon_subtype_id = NULL WHERE id = ?").run(itemId)
  }
  if (changed.includes("category") && !Object.hasOwn(patch, "weaponSubtypeId")) {
    db.prepare("UPDATE shipment_import_items SET weapon_subtype_id = NULL WHERE id = ?").run(itemId)
  }
  if (changed.includes("manufacturer") && !Object.hasOwn(patch, "brandId")) {
    db.prepare("UPDATE shipment_import_items SET brand_id = NULL, model_id = NULL WHERE id = ?").run(itemId)
  }
  if (changed.includes("model") && !Object.hasOwn(patch, "modelId")) {
    db.prepare("UPDATE shipment_import_items SET model_id = NULL WHERE id = ?").run(itemId)
  }
  if (changed.includes("caliber") && !Object.hasOwn(patch, "caliberId")) {
    db.prepare("UPDATE shipment_import_items SET caliber_id = NULL WHERE id = ?").run(itemId)
  }
  return changed
}

export function updateManifestItem(importId: string, itemId: string, patch: ManifestItemPatch, user: CurrentUser): ShipmentManifestReview {
  requirePermission(user, "shipment.edit")
  assertPendingReview(importId)
  getDb().transaction(() => {
    const changes = applyItemPatch(importId, itemId, patch, user)
    validateImport(importId)
    if (changes.length) audit(user, "SHIPMENT_UPDATED", `Manifest item ${itemId} updated during review`, { importId, itemId, changes })
  })()
  return getManifestReview(importId)
}

export function updateManifestItems(importId: string, itemIds: string[], patch: ManifestItemPatch, user: CurrentUser): ShipmentManifestReview {
  requirePermission(user, "shipment.edit")
  assertPendingReview(importId)
  const ids = [...new Set(itemIds.filter((id) => typeof id === "string" && id.trim()))]
  if (ids.length === 0 || ids.length > 2_000) throw new Error("Select between 1 and 2,000 manifest items")
  if (Object.keys(patch).length === 0) throw new Error("Choose at least one field to update")
  getDb().transaction(() => {
    let changedItems = 0
    for (const itemId of ids) if (applyItemPatch(importId, itemId, patch, user).length) changedItems++
    validateImport(importId)
    audit(user, "SHIPMENT_BULK_UPDATED", `${changedItems} manifest items updated during review`, { importId, selectedItems: ids.length, changedItems, changes: Object.keys(patch) })
  })()
  return getManifestReview(importId)
}

export function bulkUpdateManifestItems(
  importId: string,
  updates: Array<{ itemId: string; patch: ManifestItemPatch }>,
  user: CurrentUser,
): ShipmentManifestReview {
  requirePermission(user, "shipment.edit")
  assertPendingReview(importId)
  if (!Array.isArray(updates) || updates.length === 0 || updates.length > 2_000) {
    throw new Error("Select between 1 and 2,000 manifest item updates")
  }
  getDb().transaction(() => {
    let changedItems = 0
    for (const update of updates) {
      if (!update || typeof update.itemId !== "string" || !update.itemId.trim() || !update.patch || typeof update.patch !== "object") {
        throw new Error("A manifest item update is invalid")
      }
      if (applyItemPatch(importId, update.itemId, update.patch, user).length) changedItems++
    }
    validateImport(importId)
    audit(user, "SHIPMENT_BULK_UPDATED", `${changedItems} manifest items updated during review`, {
      importId,
      selectedItems: updates.length,
      changedItems,
      source: "individual-patches",
    })
  })()
  return getManifestReview(importId)
}

export function deleteManifestItems(importId: string, itemIds: string[], user: CurrentUser): ShipmentManifestReview {
  requirePermission(user, "shipment.edit")
  assertPendingReview(importId)
  const ids = [...new Set(itemIds.filter((id) => typeof id === "string" && id.trim()))]
  if (ids.length === 0 || ids.length > 2_000) throw new Error("Select between 1 and 2,000 manifest items")
  getDb().transaction(() => {
    const remove = getDb().prepare("DELETE FROM shipment_import_items WHERE id = ? AND import_id = ?")
    let deletedItems = 0
    for (const itemId of ids) deletedItems += Number(remove.run(itemId, importId).changes)
    if (deletedItems !== ids.length) throw new Error("One or more selected manifest items no longer exist")
    validateImport(importId)
    audit(user, "SHIPMENT_ITEMS_DELETED", `${deletedItems} manifest items deleted during review`, {
      importId,
      itemIds: ids,
      deletedItems,
    })
  })()
  return getManifestReview(importId)
}

export function updateManifestDetails(importId: string, patch: ManifestDetailsPatch, user: CurrentUser): ShipmentManifestReview {
  requirePermission(user, "shipment.edit")
  assertPendingReview(importId)
  const columns: Record<keyof ManifestDetailsPatch, string> = {
    shipmentNumber: "shipment_number", supplierId: "supplier_id", supplierName: "supplier_name", supplierReference: "supplier_reference",
    invoiceNumber: "invoice_number", manifestNumber: "manifest_number", shipmentDate: "shipment_date", expectedArrivalDate: "expected_arrival_date",
    origin: "origin", destination: "destination", currency: "currency", reviewNote: "review_note", additionalCosts: "additional_costs",
  }
  getDb().transaction(() => {
    const existing = getDb().prepare("SELECT * FROM shipment_imports WHERE id = ?").get(importId) as Record<string, unknown>
    const changes: string[] = []
    for (const [field, value] of Object.entries(patch) as Array<[keyof ManifestDetailsPatch, ManifestDetailsPatch[keyof ManifestDetailsPatch]]>) {
      const column = columns[field]
      if (!column) continue
      const stored = field === "additionalCosts" ? JSON.stringify(value ?? []) : field === "currency" && typeof value === "string" ? value.trim().toUpperCase() : cleanNullable(value)
      if (field === "currency" && stored) backendCurrencyService.requireCurrency(stored, true)
      if (field === "supplierId" && stored && !getDb().prepare("SELECT 1 FROM suppliers WHERE id = ?").get(stored)) throw new Error("Supplier not found")
      if ((existing[column] ?? null) === (stored ?? null)) continue
      getDb().prepare(`UPDATE shipment_imports SET ${column} = ?, updated_at = datetime('now') WHERE id = ?`).run(stored, importId)
      changes.push(field)
    }
    if (changes.length) audit(user, "SHIPMENT_REVIEW_AUTOSAVED", "Shipment manifest review details autosaved", { importId, changes })
  })()
  return getManifestReview(importId)
}

export function deleteManifestReview(importId: string, user: CurrentUser): void {
  requirePermission(user, "shipment.cancel")
  const review = getManifestReview(importId)
  if (review.shipmentId || !["pending_review", "failed", "cancelled"].includes(review.status)) throw new Error("Only unconfirmed manifest reviews can be deleted")
  getDb().transaction(() => {
    audit(user, "SHIPMENT_REVIEW_DELETED", `Unconfirmed manifest review ${review.fileName} deleted`, { importId, fileHash: review.fileHash, itemCount: review.items.length })
    getDb().prepare("DELETE FROM shipment_imports WHERE id = ?").run(importId)
  })()
}

function storageLocation(id: string | null): StorageLocation {
  if (!id) return { warehouse: "", shelf: "", bin: "" }
  const row = getDb().prepare(`SELECT w.label AS warehouse, sl.shelf, sl.bin FROM storage_locations sl JOIN warehouses w ON w.id = sl.warehouse_id WHERE sl.id = ?`).get(id) as StorageLocation | undefined
  if (!row) throw new Error("Storage location not found")
  return row
}

function buildLineItems(items: ManifestReviewItem[], received: boolean): ShipmentLineItem[] {
  return items.map((item, index) => ({
    id: `SLI${String(index + 1).padStart(4, "0")}`, productType: item.productType!, weaponType: item.weaponType ?? "", subType: "", brand: item.manufacturer ?? "", model: item.model ?? item.productName ?? "", caliber: item.caliber ?? "",
    quantity: item.quantity!, purchasePrice: item.unitPrice ?? 0, retailPrice: 0, wholesalePrice: 0, location: storageLocation(item.storageLocationId), serialNumbers: item.serialNumbers,
    received: received ? item.quantity! : 0,
    purchasePriceValuation: item.unitPrice != null && item.currency ? backendCurrencyService.createValuation(item.unitPrice, item.currency) : undefined,
  }))
}

function ensureReceivable(review: ShipmentManifestReview, currency: string): void {
  if (review.validationSummary.invalid || review.validationSummary.duplicate || review.validationSummary.conflict) throw new Error("Resolve all invalid, duplicate, and conflicting items before receipt")
  for (const item of review.items) {
    if (item.unitPrice == null || item.unitPrice <= 0) throw new Error(`A positive purchase price is required for item ${item.rowIndex}`)
    const itemCurrency = (item.currency ?? currency).trim().toUpperCase()
    backendCurrencyService.requireCurrency(itemCurrency, true)
    if (item.productType === "weapon" && (!item.weaponTypeId || !item.weaponSubtypeId || !item.brandId || !item.modelId || !item.caliberId)) {
      throw new Error(`Complete all master-data mappings for weapon item ${item.rowIndex}`)
    }
    item.currency = itemCurrency
  }
}

function learnReviewedMasterData(importId: string, user: CurrentUser): void {
  const db = getDb()
  const rows = db.prepare(`SELECT id, weapon_type, category, manufacturer, model, caliber,
    weapon_type_id, weapon_subtype_id, brand_id, model_id, caliber_id
    FROM shipment_import_items WHERE import_id = ? AND product_type = 'weapon'`).all(importId) as Array<Record<string, unknown>>
  const before = {
    weaponTypes: new Set((db.prepare("SELECT id FROM weapon_types").all() as Array<{ id: string }>).map((row) => row.id)),
    weaponSubtypes: new Set((db.prepare("SELECT id FROM weapon_subtypes").all() as Array<{ id: string }>).map((row) => row.id)),
    brands: new Set((db.prepare("SELECT id FROM brands").all() as Array<{ id: string }>).map((row) => row.id)),
    models: new Set((db.prepare("SELECT id FROM models").all() as Array<{ id: string }>).map((row) => row.id)),
    calibers: new Set((db.prepare("SELECT id FROM calibers").all() as Array<{ id: string }>).map((row) => row.id)),
  }
  const learned: Record<string, string[]> = { weaponTypes: [], weaponSubtypes: [], manufacturers: [], models: [], calibers: [] }
  for (const row of rows) {
    const weaponType = cleanNullable(row.weapon_type)
    const category = cleanNullable(row.category)
    const manufacturer = cleanNullable(row.manufacturer)
    const model = cleanNullable(row.model)
    const caliber = normalizeCaliber(cleanNullable(row.caliber))

    let weaponTypeId = cleanNullable(row.weapon_type_id)
    if (weaponType) {
      weaponTypeId = repo.getOrCreateWeaponType(weaponType)
      if (!before.weaponTypes.has(weaponTypeId)) { before.weaponTypes.add(weaponTypeId); learned.weaponTypes.push(weaponType) }
    }

    let weaponSubtypeId = cleanNullable(row.weapon_subtype_id)
    const validExistingSubtype = weaponSubtypeId && weaponTypeId
      ? db.prepare("SELECT 1 FROM weapon_subtypes WHERE id = ? AND weapon_type_id = ?").get(weaponSubtypeId, weaponTypeId)
      : null
    if (!validExistingSubtype && weaponTypeId) {
      const subtypeLabel = category ?? "General"
      weaponSubtypeId = repo.getOrCreateWeaponSubtype(weaponTypeId, subtypeLabel)
      if (!before.weaponSubtypes.has(weaponSubtypeId)) { before.weaponSubtypes.add(weaponSubtypeId); learned.weaponSubtypes.push(`${weaponType}: ${subtypeLabel}`) }
    }

    let brandId = cleanNullable(row.brand_id)
    if (manufacturer) {
      brandId = repo.getOrCreateBrand(manufacturer)
      if (!before.brands.has(brandId)) { before.brands.add(brandId); learned.manufacturers.push(manufacturer) }
    }

    let modelId = cleanNullable(row.model_id)
    if (model && brandId) {
      modelId = repo.getOrCreateModel(model, brandId)
      if (!before.models.has(modelId)) { before.models.add(modelId); learned.models.push(`${manufacturer}: ${model}`) }
    }

    let caliberId = cleanNullable(row.caliber_id)
    if (caliber) {
      caliberId = repo.getOrCreateCaliber(caliber)
      if (!before.calibers.has(caliberId)) { before.calibers.add(caliberId); learned.calibers.push(caliber) }
    }
    if (weaponSubtypeId && caliberId) repo.linkSubtypeCaliber(weaponSubtypeId, caliberId)
    db.prepare(`UPDATE shipment_import_items SET weapon_type_id = ?, weapon_subtype_id = ?, brand_id = ?, model_id = ?, caliber_id = ?, caliber = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(weaponTypeId, weaponSubtypeId, brandId, modelId, caliberId, caliber, row.id)
  }
  const learnedCount = Object.values(learned).reduce((sum, values) => sum + values.length, 0)
  if (learnedCount) audit(user, "MASTER_DATA_LEARNED", `Learned ${learnedCount} reviewed master-data values from shipment manifest`, { importId, learned })
}

function insertInventory(review: ShipmentManifestReview, shipment: Shipment, user: CurrentUser, currency: string): { weapons: number; accessories: number; ammunition: number } {
  ensureReceivable(review, currency)
  const today = new Date().toISOString().slice(0, 10)
  const batchId = `BATCH-${Date.now()}`
  const weapons: Weapon[] = []
  const accessories: Accessory[] = []
  const ammunitionRows: Ammunition[] = []
  const receipts: Array<{ type: "weapon" | "accessory" | "ammunition"; id: string; quantity: number; amount: number; currency: string }> = []
  const costBasisItems: ShipmentItemCostBasis[] = []
  let weaponCounter = Number.parseInt(nextId("W", "weapons").slice(1), 10)
  let accessoryCounter = Number.parseInt(nextId("ACC", "accessories").slice(3), 10)
  let ammoCounter = Number.parseInt(nextId("AMM", "ammunition").slice(3), 10)
  let accessoryCount = 0
  let ammunitionCount = 0
  for (const item of review.items) {
    const itemCurrency = item.currency ?? currency
    const rateSnapshot = backendCurrencyService.getRateSnapshot(itemCurrency)
    const purchaseValuation = backendCurrencyService.createValuationFromSnapshot(item.unitPrice!, rateSnapshot)
    const zeroValuation = backendCurrencyService.createValuationFromSnapshot(0, rateSnapshot)
    const productIds: string[] = []
    if (item.productType === "weapon") {
      for (const serial of item.serialNumbers) {
        const weaponId = `W${String(weaponCounter++).padStart(5, "0")}`
        weapons.push({
          id: weaponId, serialNumber: normalizeSerial(serial), weaponTypeId: item.weaponTypeId!, weaponSubtypeId: item.weaponSubtypeId!, caliberId: item.caliberId!, brandId: item.brandId!, modelId: item.modelId!, storageLocationId: item.storageLocationId ?? null,
          weaponType: item.weaponType ?? "", subType: "", caliber: item.caliber ?? "", brand: item.manufacturer ?? "", model: item.model ?? item.productName ?? "", location: storageLocation(item.storageLocationId),
          condition: "Excellent", status: "Available", purchasePrice: purchaseValuation.originalAmount, retailPrice: item.retailPrice ?? 0, wholesalePrice: item.wholesalePrice ?? 0,
          retailPriceMode: item.retailPriceMode ?? "manual", wholesalePriceMode: item.wholesalePriceMode ?? "manual", actualFinalPrice: null,
          supplierId: shipment.supplierId, shipmentId: shipment.id, dateAdded: today, batchId, notes: "Imported from reviewed shipment manifest", images: [], movementHistory: [],
          purchasePriceValuation: purchaseValuation, retailPriceValuation: zeroValuation, wholesalePriceValuation: zeroValuation,
        })
        productIds.push(weaponId)
        receipts.push({ type: "weapon", id: weaponId, quantity: 1, amount: item.unitPrice!, currency: itemCurrency })
      }
    } else if (item.productType === "accessory") {
      const id = `ACC${String(accessoryCounter++).padStart(5, "0")}`
      const accessory: Accessory = { id, name: item.productName!, type: item.category ?? "", quantity: item.quantity!, safetyThreshold: 5, price: item.retailPrice ?? 0, retailPrice: item.retailPrice ?? 0, wholesalePrice: item.wholesalePrice ?? 0, retailPriceMode: item.retailPriceMode ?? "manual", wholesalePriceMode: item.wholesalePriceMode ?? "manual", priceCurrency: itemCurrency, priceValuation: zeroValuation, dateAdded: today, location: storageLocation(item.storageLocationId) }
      accessories.push(accessory); productIds.push(id); accessoryCount += item.quantity!
      receipts.push({ type: "accessory", id, quantity: item.quantity!, amount: item.unitPrice!, currency: itemCurrency })
    } else {
      const id = `AMM${String(ammoCounter++).padStart(5, "0")}`
      const ammunition: Ammunition = { id, name: item.productName ?? "", caliber: item.caliber ?? "", packageType: "Custom", unitsPerPackage: 1, fullPackages: item.quantity!, looseRounds: 0, safetyThreshold: 100, price: item.retailPrice ?? 0, retailPrice: item.retailPrice ?? 0, wholesalePrice: item.wholesalePrice ?? 0, retailPriceMode: item.retailPriceMode ?? "manual", wholesalePriceMode: item.wholesalePriceMode ?? "manual", priceCurrency: itemCurrency, priceValuation: zeroValuation, dateAdded: today, location: storageLocation(item.storageLocationId) }
      ammunitionRows.push(ammunition); productIds.push(id); ammunitionCount += item.quantity!
      receipts.push({ type: "ammunition", id, quantity: item.quantity!, amount: item.unitPrice!, currency: itemCurrency })
    }
    costBasisItems.push({
      id: item.id,
      productType: item.productType!,
      description: item.productName ?? item.model ?? item.productType!,
      quantity: String(item.quantity!),
      unitPurchaseAmount: String(item.unitPrice!),
      currency: itemCurrency,
      snapshot: rateSnapshot,
      productIds,
      productAdditionalCosts: item.additionalCosts ?? [],
    })
  }
  const preparedShipmentCosts = prepareShipmentCosts(shipment.id, costBasisItems, review.additionalCosts, user.id)
  for (const basis of costBasisItems) insertShipmentItemBasis(basis, shipment.id)
  insertShipmentCosts(preparedShipmentCosts)
  if (weapons.length) repo.bulkInsertWeapons(weapons)
  for (const accessory of accessories) repo.insertAccessory(accessory)
  for (const ammunition of ammunitionRows) repo.insertAmmunition(ammunition)
  finalizeInventoryCosts(shipment.id, costBasisItems, preparedShipmentCosts, user.id)
  for (const receipt of receipts) recordInventoryReceipt(receipt.type, receipt.id, receipt.quantity, receipt.amount, receipt.currency, shipment.id, user.id)
  return { weapons: weapons.length, accessories: accessoryCount, ammunition: ammunitionCount }
}

function recordInventoryReceipt(itemType: "weapon" | "accessory" | "ammunition", itemId: string, quantity: number, unitAmount: number, currency: string, shipmentId: string, userId: string): void {
  const valuation = backendCurrencyService.createValuation(unitAmount, currency)
  getDb().prepare(`INSERT INTO inventory_transactions (id, item_type, item_id, transaction_type, quantity_delta, unit_amount, currency, valuation, shipment_id, notes, created_by) VALUES (?, ?, ?, 'receipt', ?, ?, ?, ?, ?, ?, ?)`)
    .run(nextId("ITX", "inventory_transactions"), itemType, itemId, quantity, String(unitAmount), currency, JSON.stringify(valuation), shipmentId, "Received through reviewed shipment manifest", userId)
}

export function confirmManifest(input: ManifestConfirmInput, user: CurrentUser): ShipmentManifestReview {
  requirePermission(user, "shipment.review")
  if (input.arrival === "arrived_now") requirePermission(user, "shipment.receive")
  const db = getDb()
  return db.transaction(() => {
    const review = getManifestReview(input.importId)
    if (review.status !== "pending_review") throw new Error("Manifest is not pending review")
    if (!input.shipmentNumber.trim()) throw new Error("Shipment number is required")
    if (db.prepare("SELECT 1 FROM shipments WHERE shipment_number = ?").get(input.shipmentNumber.trim())) throw new Error("Shipment number already exists")
    if (!db.prepare("SELECT 1 FROM suppliers WHERE id = ?").get(input.supplierId)) throw new Error("Supplier not found")
    const identifierDuplicate = db.prepare(`
      SELECT id, shipment_id, shipment_number FROM shipment_imports
      WHERE id <> ? AND status NOT IN ('failed','cancelled') AND (
        shipment_number = ?
        OR (? IS NOT NULL AND invoice_number = ? AND supplier_id = ?)
        OR (? IS NOT NULL AND manifest_number = ? AND supplier_id = ?)
      ) LIMIT 1
    `).get(
      input.importId, input.shipmentNumber.trim(), input.invoiceNumber ?? null, input.invoiceNumber ?? null, input.supplierId,
      input.manifestNumber ?? null, input.manifestNumber ?? null, input.supplierId,
    ) as { id: string; shipment_id: string | null; shipment_number: string | null } | undefined
    if (identifierDuplicate) throw new Error(`This manifest appears to have already been imported as ${identifierDuplicate.shipment_number ?? identifierDuplicate.id}`)
    const currency = input.currency.trim().toUpperCase()
    backendCurrencyService.requireCurrency(currency, true)
    if (input.arrival === "future" && !/^\d{4}-\d{2}-\d{2}$/.test(input.expectedArrivalDate ?? "")) throw new Error("Expected arrival date is required for a scheduled shipment")
    if (review.validationSummary.invalid || review.validationSummary.duplicate || review.validationSummary.conflict) throw new Error("Resolve all invalid, duplicate, and conflicting items before confirmation")
    learnReviewedMasterData(input.importId, user)
    db.prepare("UPDATE shipment_import_items SET currency = ?, updated_at = datetime('now') WHERE import_id = ? AND (currency IS NULL OR trim(currency) = '')").run(currency, input.importId)
    const preparedReview = getManifestReview(input.importId)
    const shipmentId = nextId("SHP", "shipments")
    const received = input.arrival === "arrived_now"
    if (received) ensureReceivable(preparedReview, currency)
    const lineItems = buildLineItems(preparedReview.items, received)
    const totalItems = preparedReview.items.reduce((sum, item) => sum + (item.quantity ?? 0), 0)
    const shipment: Shipment = {
      id: shipmentId, shipmentNumber: input.shipmentNumber.trim(), supplierId: input.supplierId, shipmentDate: input.shipmentDate,
      expectedArrivalDate: received ? input.shipmentDate : input.expectedArrivalDate!, totalExpectedItems: totalItems, attachments: [], notes: input.note ?? "",
      status: received ? "Arrived" : "Pending", timeline: [], purchaseOrderNumber: input.supplierReference ?? undefined, invoiceNumber: input.invoiceNumber ?? undefined,
      currency, actualArrivalDate: received ? new Date().toISOString().slice(0, 10) : undefined, lineItems, documents: [],
    }
    repo.insertShipment(shipment)
    db.prepare("UPDATE shipments SET workflow_status = ?, import_id = ?, arrival_note = ? WHERE id = ?").run(received ? "arrived" : "scheduled", input.importId, input.note ?? null, shipmentId)
    db.prepare(`UPDATE shipment_imports SET shipment_id = ?, shipment_number = ?, supplier_id = ?, supplier_reference = ?, invoice_number = ?, manifest_number = ?, shipment_date = ?, expected_arrival_date = ?, origin = ?, destination = ?, currency = ?, reviewed_at = datetime('now'), confirmed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(
      shipmentId, shipment.shipmentNumber, input.supplierId, input.supplierReference ?? null, input.invoiceNumber ?? null, input.manifestNumber ?? null, input.shipmentDate, input.expectedArrivalDate ?? null, input.origin ?? null, input.destination ?? null, currency, input.importId,
    )
    if (received) {
      transition(input.importId, "arrived", user.id, "Arrival confirmed during manifest review")
      const counts = insertInventory(getManifestReview(input.importId), shipment, user, currency)
      db.prepare("UPDATE shipments SET workflow_status = 'received', status = 'Arrived', actual_arrival_date = ? WHERE id = ?").run(new Date().toISOString().slice(0, 10), shipmentId)
      transition(input.importId, "received", user.id, "Shipment inventory receipt committed")
      audit(user, "SHIPMENT_RECEIVED", `Shipment ${shipment.shipmentNumber} received into inventory`, { importId: input.importId, shipmentId, totalItems, ...counts })
      repo.insertNotification({ id: nextId("NTF", "app_notifications"), type: "System", title: "Shipment successfully received", message: `${shipment.shipmentNumber}: ${totalItems} items added to inventory`, date: new Date().toISOString().slice(0, 10), read: false, entityId: shipmentId })
    } else {
      transition(input.importId, "scheduled", user.id, "Shipment scheduled for future arrival")
      audit(user, "SHIPMENT_SCHEDULED", `Shipment ${shipment.shipmentNumber} scheduled`, { importId: input.importId, shipmentId, expectedArrivalDate: input.expectedArrivalDate, totalItems })
    }
    return getManifestReview(input.importId)
  })()
}

export function confirmScheduledArrival(importId: string, user: CurrentUser): ShipmentManifestReview {
  requirePermission(user, "shipment.receive")
  return getDb().transaction(() => {
    const review = getManifestReview(importId)
    if (review.status !== "scheduled" || !review.shipmentId) throw new Error("Shipment is not scheduled for arrival")
    const shipment = repo.getAll().shipments.find((candidate) => candidate.id === review.shipmentId)
    if (!shipment) throw new Error("Shipment not found")
    learnReviewedMasterData(importId, user)
    transition(importId, "arrived", user.id, "Arrival confirmed")
    getDb().prepare("UPDATE shipments SET workflow_status = 'arrived', status = 'Arrived', actual_arrival_date = ? WHERE id = ?").run(new Date().toISOString().slice(0, 10), shipment.id)
    const counts = insertInventory(getManifestReview(importId), shipment, user, review.currency ?? shipment.currency ?? backendCurrencyService.getDefaultTransactionCurrency())
    getDb().prepare("UPDATE shipments SET workflow_status = 'received' WHERE id = ?").run(shipment.id)
    transition(importId, "received", user.id, "Shipment inventory receipt committed")
    audit(user, "SHIPMENT_ARRIVAL_CONFIRMED", `Arrival confirmed for ${shipment.shipmentNumber}`, { importId, shipmentId: shipment.id, ...counts })
    return getManifestReview(importId)
  })()
}

export function rescheduleManifest(importId: string, expectedArrivalDate: string, reason: string, user: CurrentUser): ShipmentManifestReview {
  requirePermission(user, "shipment.reschedule")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedArrivalDate)) throw new Error("A valid expected arrival date is required")
  if (!reason.trim()) throw new Error("A delay reason is required")
  return getDb().transaction(() => {
    const review = getManifestReview(importId)
    if (review.status !== "scheduled" && review.status !== "arrived") throw new Error("Only scheduled or arrived shipments can be rescheduled")
    if (review.status === "arrived") transition(importId, "scheduled", user.id, reason)
    getDb().prepare("UPDATE shipment_imports SET expected_arrival_date = ?, updated_at = datetime('now') WHERE id = ?").run(expectedArrivalDate, importId)
    if (review.shipmentId) getDb().prepare("UPDATE shipments SET expected_arrival_date = ?, workflow_status = 'scheduled', status = 'Delayed', delay_reason = ?, last_arrival_prompt_at = NULL WHERE id = ?").run(expectedArrivalDate, reason.trim(), review.shipmentId)
    audit(user, "SHIPMENT_RESCHEDULED", `Shipment rescheduled to ${expectedArrivalDate}`, { importId, shipmentId: review.shipmentId, oldDate: review.expectedArrivalDate, newDate: expectedArrivalDate, reason })
    return getManifestReview(importId)
  })()
}

export function cancelManifest(importId: string, reason: string, user: CurrentUser): ShipmentManifestReview {
  requirePermission(user, "shipment.cancel")
  if (!reason.trim()) throw new Error("A cancellation reason is required")
  return getDb().transaction(() => {
    const review = getManifestReview(importId)
    if (review.status === "received" || review.status === "cancelled") throw new Error("This shipment can no longer be cancelled")
    transition(importId, "cancelled", user.id, reason.trim())
    if (review.shipmentId) getDb().prepare("UPDATE shipments SET workflow_status = 'cancelled', status = 'Cancelled', arrival_note = ? WHERE id = ?").run(reason.trim(), review.shipmentId)
    audit(user, "SHIPMENT_CANCELLED", `Shipment manifest cancelled`, { importId, shipmentId: review.shipmentId, reason })
    return getManifestReview(importId)
  })()
}

export function syncShipmentArrivalNotifications(today = new Date().toISOString().slice(0, 10)): number {
  const db = getDb()
  const rows = db.prepare(`SELECT si.id, si.shipment_id, si.shipment_number, si.supplier_name, si.expected_arrival_date, COUNT(sii.id) AS item_count FROM shipment_imports si LEFT JOIN shipment_import_items sii ON sii.import_id = si.id WHERE si.status = 'scheduled' AND si.expected_arrival_date <= ? AND (SELECT last_arrival_prompt_at FROM shipments WHERE id = si.shipment_id) IS NULL GROUP BY si.id`).all(today) as Array<{ id: string; shipment_id: string; shipment_number: string; supplier_name: string | null; expected_arrival_date: string; item_count: number }>
  db.transaction(() => {
    for (const row of rows) {
      const overdue = row.expected_arrival_date < today
      repo.insertNotification({ id: nextId("NTF", "app_notifications"), type: overdue ? "ShipmentDelayed" : "System", title: overdue ? "Shipment overdue" : "Shipment expected today", message: `${row.shipment_number} · ${row.supplier_name ?? "Supplier"} · ${row.item_count} lines. Has this shipment arrived?`, date: today, read: false, entityId: row.shipment_id })
      db.prepare("UPDATE shipments SET last_arrival_prompt_at = ? WHERE id = ?").run(today, row.shipment_id)
    }
  })()
  return rows.length
}
