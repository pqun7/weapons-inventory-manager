import type { ManifestItemPatch, ManifestReviewItem, ShipmentManifestReview } from "./shipment-manifest.js"
import { summarizeItemStatuses } from "./shipment-manifest.js"
import type { Shipment, ShipmentLineItem, User } from "./types.js"
import type { ShipmentInput, ShipmentLineItemInput } from "./store-inputs.js"

interface DynamicMasterData {
  getWeaponTypeIdByLabel: (label: string) => string | undefined
  getWeaponSubtypeIdByLabel: (label: string, typeId?: string) => string | undefined
  getCaliberIdByLabel: (label: string) => string | undefined
  getBrandIdByLabel: (label: string) => string | undefined
  getModelIdByLabel: (label: string, brandId?: string) => string | undefined
  createWeaponType: (label: string) => Promise<string>
  createWeaponSubtype: (weaponTypeLabel: string, label: string) => Promise<string>
  createCaliber: (label: string) => Promise<string>
  linkSubtypeCaliber: (subtypeId: string, caliberId: string) => Promise<void>
  createBrand: (label: string) => Promise<string>
  createModel: (label: string, brandLabel?: string) => Promise<string>
}

const COMMON_FIELDS = [
  "productType", "productName", "category", "weaponType", "manufacturer", "model", "caliber",
  "sku", "productCode", "quantity", "unitPrice", "retailPrice", "wholesalePrice",
  "retailPriceMode", "wholesalePriceMode", "currency", "storageLocationId",
] as const satisfies readonly (keyof ManifestItemPatch)[]

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

/** Returns only values shared by every selected row. Mixed fields are omitted. */
export function commonManifestPatch(items: ManifestReviewItem[]): ManifestItemPatch {
  if (items.length === 0) return {}
  const common: ManifestItemPatch = {}
  for (const field of COMMON_FIELDS) {
    const first = items[0][field as keyof ManifestReviewItem]
    if (items.every((item) => sameValue(item[field as keyof ManifestReviewItem], first))) {
      ;(common as Record<string, unknown>)[field] = first ?? null
    }
  }
  return common
}

/** Keeps bulk updates scoped to fields the user actually changed. */
export function changedManifestPatch(initial: ManifestItemPatch, current: ManifestItemPatch): ManifestItemPatch {
  const changed: ManifestItemPatch = {}
  for (const [field, value] of Object.entries(current)) {
    if (!sameValue(value, (initial as Record<string, unknown>)[field])) {
      ;(changed as Record<string, unknown>)[field] = value
    }
  }
  return changed
}

export function shipmentItemMissingFields(item: ManifestReviewItem): string[] {
  const missing: string[] = []
  if (!item.productType) missing.push("productType")
  if (!item.productName?.trim()) missing.push("productName")
  if (!item.quantity || item.quantity <= 0) missing.push("quantity")
  if (!item.unitPrice || item.unitPrice <= 0) missing.push("unitPrice")
  if (!item.storageLocationId) missing.push("storageLocationId")
  if (item.productType === "weapon") {
    if (!item.weaponType?.trim()) missing.push("weaponType")
    if (!item.category?.trim()) missing.push("weaponSubtype")
    if (!item.manufacturer?.trim()) missing.push("manufacturer")
    if (!item.model?.trim()) missing.push("model")
    if (!item.caliber?.trim()) missing.push("caliber")
    if (item.serialNumbers.length !== item.quantity) missing.push("serialNumbers")
  }
  return missing
}

export interface ManifestClassificationResolver {
  getWeaponTypeIdByLabel: DynamicMasterData["getWeaponTypeIdByLabel"]
  getWeaponSubtypeIdByLabel: DynamicMasterData["getWeaponSubtypeIdByLabel"]
  getCaliberIdByLabel: DynamicMasterData["getCaliberIdByLabel"]
  getBrandIdByLabel: DynamicMasterData["getBrandIdByLabel"]
  getModelIdByLabel: DynamicMasterData["getModelIdByLabel"]
  createWeaponType: DynamicMasterData["createWeaponType"]
  createWeaponSubtype: DynamicMasterData["createWeaponSubtype"]
  createCaliber: DynamicMasterData["createCaliber"]
  createBrand: DynamicMasterData["createBrand"]
  createModel: DynamicMasterData["createModel"]
  linkSubtypeCaliber: DynamicMasterData["linkSubtypeCaliber"]
}

/** Resolves the complete, compatible FK tuple atomically from the displayed labels. */
export async function resolveManifestClassification(
  item: Pick<ManifestReviewItem, "productType" | "weaponType" | "category" | "manufacturer" | "model" | "caliber"> & ManifestItemPatch,
  master: ManifestClassificationResolver,
): Promise<ManifestItemPatch> {
  if (item.productType !== "weapon") {
    return {
      weaponTypeId: null,
      weaponSubtypeId: null,
      brandId: null,
      modelId: null,
      caliberId: null,
    }
  }

  const weaponType = item.weaponType?.trim() ?? ""
  const subtype = item.category?.trim() ?? ""
  const manufacturer = item.manufacturer?.trim() ?? ""
  const model = item.model?.trim() ?? ""
  const caliber = item.caliber?.trim() ?? ""
  if (!weaponType || !subtype || !manufacturer || !model || !caliber) {
    throw new Error("Complete the highlighted weapon classification fields")
  }

  const weaponTypeId = master.getWeaponTypeIdByLabel(weaponType) ?? await master.createWeaponType(weaponType)
  const weaponSubtypeId = master.getWeaponSubtypeIdByLabel(subtype, weaponTypeId)
    ?? await master.createWeaponSubtype(weaponType, subtype)
  const brandId = master.getBrandIdByLabel(manufacturer) ?? await master.createBrand(manufacturer)
  const modelId = master.getModelIdByLabel(model, brandId) ?? await master.createModel(model, manufacturer)
  const caliberId = master.getCaliberIdByLabel(caliber) ?? await master.createCaliber(caliber)
  await master.linkSubtypeCaliber(weaponSubtypeId, caliberId)
  return { weaponTypeId, weaponSubtypeId, brandId, modelId, caliberId }
}

export function shipmentLineToManifestItem(item: ShipmentLineItem, index: number): ManifestReviewItem {
  const manifestItem: ManifestReviewItem = {
    id: item.id || `line-${index + 1}`,
    rowIndex: index + 1,
    productType: item.productType,
    // Product is a row identifier only. Classification is kept in the dedicated
    // weapon type, subtype, maker, model, and caliber fields below.
    productName: item.productType === "weapon"
      ? [item.brand, item.model, item.caliber].filter(Boolean).join(" ") || `Weapon row ${index + 1}`
      : item.model || item.caliber || `${item.productType} row ${index + 1}`,
    category: item.subType || null,
    weaponType: item.weaponType || null,
    manufacturer: item.brand || null,
    model: item.model || null,
    caliber: item.caliber || null,
    sku: null,
    productCode: null,
    serialNumber: item.serialNumbers[0] ?? null,
    serialNumbers: item.serialNumbers,
    quantity: item.quantity,
    unitPrice: item.purchasePrice,
    retailPrice: item.retailPrice,
    wholesalePrice: item.wholesalePrice,
    retailPriceMode: item.retailPriceMode ?? "auto",
    wholesalePriceMode: item.wholesalePriceMode ?? "auto",
    additionalCosts: item.additionalCosts ?? item.productAdditionalCosts ?? [],
    totalPrice: item.purchasePrice * item.quantity,
    currency: item.purchasePriceValuation?.originalCurrency ?? null,
    countryOfOrigin: null,
    weaponTypeId: item.weaponTypeId ?? null,
    weaponSubtypeId: item.weaponSubtypeId ?? null,
    brandId: item.brandId ?? null,
    modelId: item.modelId ?? null,
    caliberId: item.caliberId ?? null,
    storageLocationId: item.storageLocationId ?? null,
    confidence: {},
    source: { row: index + 1, text: "Existing shipment line item" },
    rawData: {},
    status: "needs_review",
    issues: [],
  }
  manifestItem.status = shipmentItemMissingFields(manifestItem).length === 0 ? "valid" : "needs_review"
  return manifestItem
}

export function shipmentLineInputToManifestItem(item: ShipmentLineItemInput, index: number, fallbackCurrency: string): ManifestReviewItem {
  const line: ShipmentLineItem = {
    id: item.id ?? `line-${index + 1}`,
    productType: item.productType,
    weaponType: item.weaponTypeLabel ?? "",
    subType: item.subTypeLabel ?? "",
    brand: item.brandLabel ?? "",
    model: item.modelLabel ?? "",
    caliber: item.caliberLabel ?? "",
    quantity: item.quantity,
    purchasePrice: item.purchasePrice,
    retailPrice: item.retailPrice,
    wholesalePrice: item.wholesalePrice,
    retailPriceMode: item.retailPriceMode,
    wholesalePriceMode: item.wholesalePriceMode,
    weaponTypeId: item.weaponTypeId,
    weaponSubtypeId: item.weaponSubtypeId,
    caliberId: item.caliberId,
    brandId: item.brandId,
    modelId: item.modelId,
    storageLocationId: item.storageLocationId,
    serialNumbers: item.serialNumbers,
    received: 0,
    additionalCosts: item.additionalCosts,
    purchasePriceValuation: {
      originalAmount: item.purchasePrice,
      originalCurrency: item.currency ?? fallbackCurrency,
      exchangeRate: 1,
      accountingAmount: item.purchasePrice,
      accountingCurrency: fallbackCurrency,
      exchangeRateDate: new Date().toISOString(),
      rateSource: "default",
    },
  }
  return shipmentLineToManifestItem(line, index)
}

export function shipmentToManifestReview(shipment: Shipment): ShipmentManifestReview {
  const items = (shipment.lineItems ?? []).map(shipmentLineToManifestItem)
  return {
    id: shipment.importId ?? `shipment-${shipment.id}`,
    shipmentId: shipment.id,
    status: shipment.workflowStatus ?? "scheduled",
    fileName: shipment.importId ? `Shipment ${shipment.shipmentNumber}` : "Manual shipment",
    fileType: "application/x-shipment",
    fileSize: 0,
    fileHash: shipment.id,
    shipmentNumber: shipment.shipmentNumber,
    supplierName: null,
    supplierId: shipment.supplierId,
    supplierReference: shipment.purchaseOrderNumber ?? null,
    invoiceNumber: shipment.invoiceNumber ?? null,
    manifestNumber: null,
    shipmentDate: shipment.shipmentDate,
    expectedArrivalDate: shipment.expectedArrivalDate,
    origin: null,
    destination: null,
    currency: shipment.currency ?? null,
    reviewNote: shipment.notes,
    additionalCosts: shipment.plannedCosts ?? [],
    aiProvider: null,
    aiModel: null,
    aiRequestId: null,
    aiProcessingMs: null,
    processingWarning: null,
    promptVersion: null,
    schemaVersion: "shipment-edit",
    validationSummary: summarizeItemStatuses(items),
    items,
    issues: [],
    createdAt: shipment.shipmentDate,
    updatedAt: new Date().toISOString(),
  }
}

export function removeManifestReviewItems(
  review: ShipmentManifestReview,
  itemIds: readonly string[],
  updatedAt = new Date().toISOString(),
): ShipmentManifestReview {
  const requested = new Set(itemIds)
  const removedCount = review.items.reduce((count, item) => count + (requested.has(item.id) ? 1 : 0), 0)
  if (removedCount === 0) throw new Error("Manifest item not found")
  if (removedCount >= review.items.length) throw new Error("A shipment must keep at least one product row")
  const items = review.items.filter((item) => !requested.has(item.id))
  const remainingIds = new Set(items.map((item) => item.id))
  return {
    ...review,
    items,
    issues: review.issues.filter((issue) => issue.itemId == null || remainingIds.has(issue.itemId)),
    validationSummary: summarizeItemStatuses(items),
    updatedAt,
  }
}

export function manifestItemToLineInput(item: ManifestReviewItem, fallbackCurrency: string): ShipmentLineItemInput {
  return {
    id: item.id,
    productType: item.productType ?? "accessory",
    weaponTypeId: item.weaponTypeId ?? "",
    weaponSubtypeId: item.weaponSubtypeId ?? "",
    caliberId: item.caliberId ?? "",
    brandId: item.brandId ?? "",
    modelId: item.modelId ?? "",
    storageLocationId: item.storageLocationId ?? "",
    quantity: item.quantity ?? 0,
    purchasePrice: item.unitPrice ?? 0,
    retailPrice: item.retailPrice ?? 0,
    wholesalePrice: item.wholesalePrice ?? 0,
    retailPriceMode: item.retailPriceMode ?? "auto",
    wholesalePriceMode: item.wholesalePriceMode ?? "auto",
    serialNumbers: item.serialNumbers,
    currency: item.currency ?? fallbackCurrency,
    weaponTypeLabel: item.weaponType ?? "",
    subTypeLabel: item.category ?? "",
    caliberLabel: item.caliber ?? "",
    brandLabel: item.manufacturer ?? "",
    modelLabel: item.model ?? item.productName ?? "",
    additionalCosts: item.additionalCosts ?? [],
  }
}

export function canEditShipmentContents(shipment: Shipment, user: User): boolean {
  const permitted = user.role === "Admin"
    || user.permissions["shipment.edit"] === true
    || user.permissions["shipment.import"] === true
    || user.permissions.canImportExcel
  const editableWorkflow = shipment.workflowStatus == null
    || ["draft", "pending_review", "scheduled", "failed"].includes(shipment.workflowStatus)
  return permitted && editableWorkflow && !["Arrived", "Cancelled"].includes(shipment.status)
}

export function sortShipmentsNewestFirst(shipments: readonly Shipment[]): Shipment[] {
  return [...shipments].sort((left, right) => {
    if (left.isSaving !== right.isSaving) return left.isSaving ? -1 : 1
    const dateDifference = Date.parse(right.createdAt ?? right.shipmentDate) - Date.parse(left.createdAt ?? left.shipmentDate)
    if (dateDifference !== 0) return dateDifference
    return right.id.localeCompare(left.id)
  })
}

export function optimisticShipment(input: ShipmentInput, temporaryId: string): Shipment {
  return {
    id: temporaryId,
    shipmentNumber: input.shipmentNumber,
    supplierId: input.supplierId,
    shipmentDate: input.shipmentDate,
    expectedArrivalDate: input.expectedArrivalDate,
    createdAt: new Date().toISOString(),
    totalExpectedItems: input.totalExpectedItems,
    attachments: input.attachments,
    notes: input.notes,
    status: input.status ?? "In Transit",
    timeline: [],
    purchaseOrderNumber: input.purchaseOrderNumber,
    invoiceNumber: input.invoiceNumber,
    shippingCarrier: input.shippingCarrier,
    containerNumber: input.containerNumber,
    currency: input.currency,
    purchaseDate: input.purchaseDate,
    lineItems: [],
    plannedCosts: input.additionalCosts,
    workflowStatus: "processing",
    isSaving: true,
  }
}
