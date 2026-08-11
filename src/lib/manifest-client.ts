import { dbGetMasterData } from "./db/index.js"
import type { MasterDataAll } from "./db/types.js"
import { getSupabaseClient } from "./supabase/client.js"
import type { Json } from "./supabase/database.types.js"
import {
  normalizeCaliber,
  type ManifestConfirmInput,
  type ManifestDetailsPatch,
  type ManifestExtractedItem,
  type ManifestExtractionResult,
  type ManifestItemPatch,
  type ManifestProgress,
  type ManifestReviewItem,
  type ManifestReviewSummary,
  type ManifestUploadInput,
  type ManifestValidationIssue,
  type ManifestWorkflowStatus,
  type ShipmentManifestReview,
} from "./shipment-manifest.js"

type CurrentUser = { id: string; name: string }
type Row = Record<string, Json>
type ManifestResult<T = void> = { success: boolean; data?: T; error?: string }

const IMPORT_COLUMNS = "id,shipment_id,status,file_name,file_type,file_size,file_hash,shipment_number,supplier_name,supplier_id,supplier_reference,invoice_number,manifest_number,shipment_date,expected_arrival_date,origin,destination,currency,review_note,ai_provider,ai_model,ai_request_id,ai_processing_ms,prompt_version,schema_version,validation_summary,error_code,error_message,created_at,updated_at"
const ITEM_COLUMNS = "id,import_id,row_index,product_type,product_name,category,weapon_type,manufacturer,model,caliber,sku,product_code,serial_number,serial_numbers_json,quantity,unit_price,total_price,currency,country_of_origin,weapon_type_id,weapon_subtype_id,brand_id,model_id,caliber_id,storage_location_id,confidence_json,source_json,raw_data_json,status"
const ISSUE_COLUMNS = "id,import_id,item_id,field_name,code,severity,message,details_json,created_at"

function clean(value: Json | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function objectValue(value: Json | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringArray(value: Json | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function mapIssue(row: Row): ManifestValidationIssue {
  return {
    id: String(row.id), itemId: clean(row.item_id), fieldName: clean(row.field_name), code: String(row.code),
    severity: String(row.severity) as ManifestValidationIssue["severity"], message: String(row.message),
    details: objectValue(row.details_json),
  }
}

function mapReview(row: Row, itemRows: Row[], issueRows: Row[]): ShipmentManifestReview {
  const issues = issueRows.map(mapIssue)
  const items: ManifestReviewItem[] = itemRows.map((item) => ({
    id: String(item.id), rowIndex: Number(item.row_index),
    productType: clean(item.product_type) as ManifestReviewItem["productType"], productName: clean(item.product_name),
    category: clean(item.category), weaponType: clean(item.weapon_type), manufacturer: clean(item.manufacturer),
    model: clean(item.model), caliber: clean(item.caliber), sku: clean(item.sku), productCode: clean(item.product_code),
    serialNumber: clean(item.serial_number), serialNumbers: stringArray(item.serial_numbers_json),
    quantity: item.quantity == null ? null : Number(item.quantity), unitPrice: item.unit_price == null ? null : Number(item.unit_price),
    totalPrice: item.total_price == null ? null : Number(item.total_price), currency: clean(item.currency),
    countryOfOrigin: clean(item.country_of_origin), weaponTypeId: clean(item.weapon_type_id),
    weaponSubtypeId: clean(item.weapon_subtype_id), brandId: clean(item.brand_id), modelId: clean(item.model_id),
    caliberId: clean(item.caliber_id), storageLocationId: clean(item.storage_location_id),
    confidence: objectValue(item.confidence_json) as Record<string, number>, source: objectValue(item.source_json),
    rawData: objectValue(item.raw_data_json), status: String(item.status) as ManifestReviewItem["status"],
    issues: issues.filter((issue) => issue.itemId === String(item.id)),
  }))
  const summary = objectValue(row.validation_summary)
  return {
    id: String(row.id), shipmentId: clean(row.shipment_id), status: String(row.status) as ManifestWorkflowStatus,
    fileName: String(row.file_name), fileType: String(row.file_type), fileSize: Number(row.file_size), fileHash: String(row.file_hash),
    shipmentNumber: clean(row.shipment_number), supplierName: clean(row.supplier_name), supplierId: clean(row.supplier_id),
    supplierReference: clean(row.supplier_reference), invoiceNumber: clean(row.invoice_number), manifestNumber: clean(row.manifest_number),
    shipmentDate: clean(row.shipment_date), expectedArrivalDate: clean(row.expected_arrival_date), origin: clean(row.origin),
    destination: clean(row.destination), currency: clean(row.currency), reviewNote: clean(row.review_note),
    aiProvider: clean(row.ai_provider), aiModel: clean(row.ai_model), aiRequestId: clean(row.ai_request_id),
    aiProcessingMs: row.ai_processing_ms == null ? null : Number(row.ai_processing_ms),
    processingWarning: row.error_code === "AI_FALLBACK" || row.error_code === "AI_PROVIDER_FALLBACK" ? clean(row.error_message) : null,
    promptVersion: clean(row.prompt_version), schemaVersion: String(row.schema_version),
    validationSummary: { valid: Number(summary.valid ?? 0), needsReview: Number(summary.needsReview ?? 0), invalid: Number(summary.invalid ?? 0), duplicate: Number(summary.duplicate ?? 0), conflict: Number(summary.conflict ?? 0) },
    items, issues, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }
}

async function getReview(importId: string): Promise<ShipmentManifestReview> {
  const client = getSupabaseClient()
  const [reviewResult, itemsResult, issuesResult] = await Promise.all([
    client.from("shipment_imports").select(IMPORT_COLUMNS).eq("id", importId).single(),
    client.from("shipment_import_items").select(ITEM_COLUMNS).eq("import_id", importId).order("row_index"),
    client.from("shipment_validation_issues").select(ISSUE_COLUMNS).eq("import_id", importId).order("created_at"),
  ])
  if (reviewResult.error) throw new Error(reviewResult.error.message)
  if (itemsResult.error) throw new Error(itemsResult.error.message)
  if (issuesResult.error) throw new Error(issuesResult.error.message)
  return mapReview(reviewResult.data as Row, (itemsResult.data ?? []) as Row[], (issuesResult.data ?? []) as Row[])
}

function normalizedLookup(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
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

function enrichItem(item: ManifestExtractedItem, master: MasterDataAll): ManifestExtractedItem {
  const enriched = { ...item, confidence: { ...item.confidence } }
  const productText = [item.weaponType, item.category, item.productName].filter(Boolean).join(" ")
  enriched.caliber = normalizeCaliber(item.caliber)
  enriched.weaponTypeId = findId(master.weaponTypes, item.weaponType ?? productText)
  enriched.brandId = findId(master.brands, item.manufacturer ?? item.productName)
  enriched.modelId = findId(master.models.filter((model) => !enriched.brandId || model.brand_id === enriched.brandId), item.model ?? item.productName)
  enriched.caliberId = findId(master.calibers, enriched.caliber ?? productText)
  enriched.weaponSubtypeId = findId(master.weaponSubtypes.filter((subtype) => !enriched.weaponTypeId || subtype.weapon_type_id === enriched.weaponTypeId), productText)
  enriched.storageLocationId = master.storageLocations[0]?.id ?? null
  if (!enriched.manufacturer && enriched.brandId) enriched.manufacturer = master.brands.find((brand) => brand.id === enriched.brandId)?.label ?? null
  if (!enriched.model && enriched.modelId) enriched.model = master.models.find((model) => model.id === enriched.modelId)?.label ?? null
  return enriched
}

async function createReview(extraction: ManifestExtractionResult): Promise<ShipmentManifestReview> {
  const master = await dbGetMasterData()
  const items = extraction.items.map((item) => enrichItem(item, master))
  const payload = { ...extraction, items, normalized: { shipmentNumber: extraction.shipmentNumber, itemCount: items.length }, errorCode: extraction.processingWarning ? "AI_FALLBACK" : null, errorMessage: extraction.processingWarning }
  const { data, error } = await getSupabaseClient().rpc("create_manifest_review", { p_payload: payload as unknown as Json })
  if (error) throw new Error(error.message)
  if (typeof data !== "string") throw new Error("Manifest create RPC returned an invalid identifier")
  return getReview(data)
}

function success<T>(data: T): ManifestResult<T> { return { success: true, data } }
function failure<T>(error: unknown): ManifestResult<T> { return { success: false, error: error instanceof Error ? error.message : String(error) } }

type VoidRpc = "update_manifest_items" | "update_manifest_details" | "delete_manifest_review" | "confirm_manifest_arrival" | "reschedule_manifest" | "cancel_manifest"
async function rpcVoid(name: VoidRpc, args: Record<string, Json>): Promise<void> {
  const { error } = await getSupabaseClient().rpc(name, args)
  if (error) throw new Error(error.message)
}

export const manifestClient = {
  async upload(input: ManifestUploadInput, _user: CurrentUser): Promise<ManifestResult<ShipmentManifestReview>> {
    try {
      const parser = window.electronAPI?.manifest
      if (!parser) throw new Error("Manifest extraction is available in the desktop application only")
      const parsed = await parser.parse(input)
      if (!parsed.success || !parsed.data) throw new Error(parsed.error ?? "Unable to extract shipment data")
      return success(await createReview(parsed.data))
    } catch (error) { return failure(error) }
  },
  async get(importId: string, _user: CurrentUser): Promise<ManifestResult<ShipmentManifestReview>> {
    try { return success(await getReview(importId)) } catch (error) { return failure(error) }
  },
  async list(limit: number, _user: CurrentUser): Promise<ManifestResult<ManifestReviewSummary[]>> {
    try {
      const client = getSupabaseClient()
      const { data, error } = await client.from("shipment_imports").select("id,shipment_id,status,file_name,shipment_number,supplier_name,validation_summary,ai_provider,created_at,updated_at").in("status", ["processing", "pending_review", "failed"]).order("updated_at", { ascending: false }).limit(Math.max(1, Math.min(100, Math.trunc(limit))))
      if (error) throw new Error(error.message)
      const ids = (data ?? []).map((row) => String(row.id))
      const itemCounts = new Map<string, number>()
      if (ids.length > 0) {
        const itemResult = await client.from("shipment_import_items").select("import_id,id").in("import_id", ids)
        if (itemResult.error) throw new Error(itemResult.error.message)
        for (const item of itemResult.data ?? []) itemCounts.set(String(item.import_id), (itemCounts.get(String(item.import_id)) ?? 0) + 1)
      }
      return success((data ?? []).map((row) => {
        const summary = objectValue(row.validation_summary)
        return { id: String(row.id), shipmentId: clean(row.shipment_id), status: String(row.status) as ManifestWorkflowStatus, fileName: String(row.file_name), shipmentNumber: clean(row.shipment_number), supplierName: clean(row.supplier_name), itemCount: itemCounts.get(String(row.id)) ?? 0, validationSummary: { valid: Number(summary.valid ?? 0), needsReview: Number(summary.needsReview ?? 0), invalid: Number(summary.invalid ?? 0), duplicate: Number(summary.duplicate ?? 0), conflict: Number(summary.conflict ?? 0) }, aiProvider: clean(row.ai_provider), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
      }))
    } catch (error) { return failure(error) }
  },
  async updateItem(importId: string, itemId: string, patch: ManifestItemPatch, _user: CurrentUser): Promise<ManifestResult<ShipmentManifestReview>> {
    try { await rpcVoid("update_manifest_items", { p_import_id: importId, p_item_ids: [itemId], p_patch: patch as unknown as Json }); return success(await getReview(importId)) } catch (error) { return failure(error) }
  },
  async updateItems(importId: string, itemIds: string[], patch: ManifestItemPatch, _user: CurrentUser): Promise<ManifestResult<ShipmentManifestReview>> {
    try { await rpcVoid("update_manifest_items", { p_import_id: importId, p_item_ids: itemIds, p_patch: patch as unknown as Json }); return success(await getReview(importId)) } catch (error) { return failure(error) }
  },
  async updateDetails(importId: string, patch: ManifestDetailsPatch, _user: CurrentUser): Promise<ManifestResult<ShipmentManifestReview>> {
    try { await rpcVoid("update_manifest_details", { p_import_id: importId, p_patch: patch as unknown as Json }); return success(await getReview(importId)) } catch (error) { return failure(error) }
  },
  async deleteReview(importId: string, _user: CurrentUser): Promise<ManifestResult<void>> {
    try { await rpcVoid("delete_manifest_review", { p_import_id: importId }); return success(undefined) } catch (error) { return failure(error) }
  },
  async confirm(input: ManifestConfirmInput, _user: CurrentUser): Promise<ManifestResult<ShipmentManifestReview>> {
    try { const { error } = await getSupabaseClient().rpc("confirm_manifest_review", { p_confirmation: input as unknown as Json }); if (error) throw new Error(error.message); return success(await getReview(input.importId)) } catch (error) { return failure(error) }
  },
  async confirmArrival(importId: string, _user: CurrentUser): Promise<ManifestResult<ShipmentManifestReview>> {
    try { await rpcVoid("confirm_manifest_arrival", { p_import_id: importId }); return success(await getReview(importId)) } catch (error) { return failure(error) }
  },
  async reschedule(importId: string, expectedArrivalDate: string, reason: string, _user: CurrentUser): Promise<ManifestResult<ShipmentManifestReview>> {
    try { await rpcVoid("reschedule_manifest", { p_import_id: importId, p_expected_arrival_date: expectedArrivalDate, p_reason: reason }); return success(await getReview(importId)) } catch (error) { return failure(error) }
  },
  async cancel(importId: string, reason: string, _user: CurrentUser): Promise<ManifestResult<ShipmentManifestReview>> {
    try { await rpcVoid("cancel_manifest", { p_import_id: importId, p_reason: reason }); return success(await getReview(importId)) } catch (error) { return failure(error) }
  },
  onProgress(callback: (progress: ManifestProgress) => void): () => void {
    return window.electronAPI?.manifest.onProgress(callback) ?? (() => undefined)
  },
}
