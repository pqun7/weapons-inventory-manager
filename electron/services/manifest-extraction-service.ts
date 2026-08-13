import { createHash } from "node:crypto"
import path from "node:path"
import {
  ALLOWED_MANIFEST_EXTENSIONS,
  MAX_MANIFEST_FILE_SIZE,
  heuristicSpreadsheetItems,
  inferCaliber,
  inferManufacturerAndModel,
  inferProductType,
  inferWeaponSubtype,
  inferWeaponType,
  parseSpreadsheetBufferAsync,
  type NativeExtraction,
  type ParsedManifestItem,
} from "./manifest-parser.js"
import { analyzeManifestWithAi, userFacingAiError, type AiManifestMetadata } from "./openai-manifest-service.js"
import {
  MANIFEST_PROMPT_VERSION,
  MANIFEST_SCHEMA_VERSION,
  normalizeSerial,
  type ManifestExtractionResult,
  type ManifestProgress,
  type ManifestUploadInput,
} from "../../src/lib/shipment-manifest.js"

type ProgressCallback = (progress: ManifestProgress) => void

function canonicalizeProductFields(item: ParsedManifestItem): ParsedManifestItem {
  if (!item.productName) return item
  const inferredProductType = inferProductType(item.productName)
  const productType = item.productType ?? inferredProductType
  if (productType !== "weapon") return { ...item, productType }

  const identity = inferManufacturerAndModel(item.productName)
  const weaponType = inferWeaponType(item.productName)
  const category = inferWeaponSubtype(item.productName)
  const caliber = inferCaliber(item.productName)
  return {
    ...item,
    productType,
    weaponType: weaponType ?? item.weaponType,
    category: category ?? item.category,
    manufacturer: identity.manufacturer ?? item.manufacturer,
    model: identity.model ?? item.model,
    caliber: caliber ?? item.caliber,
    confidence: {
      ...item.confidence,
      productType: inferredProductType === "weapon" ? Math.max(item.confidence.productType ?? 0, 0.94) : item.confidence.productType,
      weaponType: weaponType ? Math.max(item.confidence.weaponType ?? 0, 0.92) : item.confidence.weaponType,
      manufacturer: identity.manufacturer ? Math.max(item.confidence.manufacturer ?? 0, identity.manufacturerConfidence) : item.confidence.manufacturer,
      model: identity.model ? Math.max(item.confidence.model ?? 0, identity.modelConfidence) : item.confidence.model,
      caliber: caliber ? Math.max(item.confidence.caliber ?? 0, 0.91) : item.confidence.caliber,
    },
  }
}

function validateUpload(input: ManifestUploadInput): { extension: string; mimeType: string; bytes: Uint8Array } {
  if (typeof input?.fileName !== "string" || !input.fileName.trim() || /[\\/\0]/.test(input.fileName)) {
    throw new Error("Invalid manifest file name")
  }
  const fileName = path.basename(input.fileName)
  const extension = path.extname(fileName).toLowerCase()
  if (!ALLOWED_MANIFEST_EXTENSIONS.has(extension)) throw new Error("Unsupported manifest file type")
  const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes)
  if (bytes.byteLength <= 0) throw new Error("The uploaded file is empty")
  if (bytes.byteLength > MAX_MANIFEST_FILE_SIZE) throw new Error("The manifest exceeds the 30 MB size limit")
  const startsWith = (...signature: number[]) => signature.every((value, index) => bytes[index] === value)
  const signatures: Record<string, boolean> = {
    ".xlsx": startsWith(0x50, 0x4b),
    ".xls": startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1),
    ".pdf": startsWith(0x25, 0x50, 0x44, 0x46),
    ".jpg": startsWith(0xff, 0xd8, 0xff),
    ".jpeg": startsWith(0xff, 0xd8, 0xff),
    ".png": startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    ".webp": startsWith(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50,
    ".csv": startsWith(0xff, 0xfe) || startsWith(0xfe, 0xff) || !bytes.slice(0, Math.min(bytes.byteLength, 4096)).some((value) => value === 0),
  }
  if (!signatures[extension]) throw new Error("The file content does not match its extension")
  const mimeType = input.mimeType?.trim() || ({
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".csv": "text/csv",
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  }[extension] ?? "application/octet-stream")
  return { extension, mimeType, bytes }
}

function mergeExtractedItems(nativeItems: ParsedManifestItem[], aiItems: ParsedManifestItem[]): ParsedManifestItem[] {
  if (nativeItems.length === 0) return aiItems
  if (aiItems.length === 0) return nativeItems
  const usedAi = new Set<number>()
  const merged = nativeItems.map((nativeItem) => {
    const nativeSerials = new Set(nativeItem.serialNumbers.map(normalizeSerial))
    const matchIndex = aiItems.findIndex((aiItem, index) => {
      if (usedAi.has(index)) return false
      const sameSource = nativeItem.source.sheet && aiItem.source.sheet === nativeItem.source.sheet
        && nativeItem.source.row != null && aiItem.source.row === nativeItem.source.row
      const sameSerial = aiItem.serialNumbers.some((serial) => nativeSerials.has(normalizeSerial(serial)))
      return Boolean(sameSource || sameSerial)
    })
    if (matchIndex < 0) return nativeItem
    usedAi.add(matchIndex)
    const aiItem = aiItems[matchIndex]
    const combined = { ...nativeItem } as ParsedManifestItem
    const semanticFields: Array<keyof ParsedManifestItem> = [
      "productType", "productName", "category", "weaponType", "manufacturer", "model", "caliber",
      "sku", "productCode", "unitPrice", "totalPrice", "currency", "countryOfOrigin",
    ]
    const deterministicNativeFields = new Set<keyof ParsedManifestItem>(["weaponType", "manufacturer", "model", "caliber"])
    for (const field of semanticFields) {
      const aiValue = aiItem[field]
      const nativeValue = nativeItem[field]
      if (aiValue != null && aiValue !== "" && (nativeValue == null || nativeValue === "" || (!deterministicNativeFields.has(field) && (aiItem.confidence[String(field)] ?? 0) > (nativeItem.confidence[String(field)] ?? 0) + 0.05))) {
        ;(combined as Record<string, unknown>)[field] = aiValue
      }
    }
    const serialNumbers = [...new Set([...nativeItem.serialNumbers, ...aiItem.serialNumbers].map(normalizeSerial).filter(Boolean))]
    return {
      ...combined,
      serialNumbers,
      serialNumber: serialNumbers.length === 1 ? serialNumbers[0] : null,
      quantity: nativeItem.quantity ?? aiItem.quantity,
      confidence: { ...nativeItem.confidence, ...aiItem.confidence },
      source: { ...nativeItem.source, ...aiItem.source },
      rawData: { ...nativeItem.rawData, ai: aiItem.rawData },
    }
  })
  for (const [index, item] of aiItems.entries()) if (!usedAi.has(index)) merged.push(item)
  return merged
}

function nativeMetadata(extraction: NativeExtraction | undefined): AiManifestMetadata {
  const source = extraction?.text ?? ""
  const pick = (patterns: RegExp[]): string | null => {
    for (const pattern of patterns) {
      const match = source.match(pattern)
      if (match?.[1]?.trim()) return match[1].trim().replace(/\t.*$/, "")
    }
    return null
  }
  const date = pick([/(?:shipment\s*date|date)\s*[:#]?\s*([^\n]+)/i])
  const parsedDate = date ? new Date(date) : null
  return {
    shipmentNumber: pick([/(?:commercial\s*#|manifest\s*(?:number|no)|shipment\s*(?:number|no))\s*[:#]?\s*([^\n]+)/i]),
    supplier: pick([/(?:shipper|exporter|supplier)\s*[:#]?\s*([^\n]+)/i]),
    supplierReference: null,
    invoiceNumber: pick([/invoice\s*(?:number|no)?\s*[:#]?\s*([^\n]+)/i]),
    manifestNumber: pick([/manifest\s*(?:number|no)\s*[:#]?\s*([^\n]+)/i]),
    shipmentDate: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString().slice(0, 10) : null,
    expectedArrivalDate: null,
    origin: pick([/(?:origin|country\s*of\s*origin)\s*[:#]?\s*([^\n]+)/i]),
    destination: pick([/(?:destination|consignee)\s*[:#]?\s*([^\n]+)/i]),
    currency: pick([/(?:currency)\s*[:#]?\s*([A-Z]{3})/i])?.toUpperCase() ?? null,
    confidence: {},
  }
}

function mergeMetadata(native: AiManifestMetadata, ai: AiManifestMetadata | undefined): AiManifestMetadata {
  if (!ai) return native
  return {
    ...native,
    ...Object.fromEntries(Object.entries(ai).filter(([, value]) => value != null && value !== "")),
    confidence: { ...native.confidence, ...ai.confidence },
  } as AiManifestMetadata
}

export async function extractShipmentManifest(input: ManifestUploadInput, progress?: ProgressCallback): Promise<ManifestExtractionResult> {
  progress?.({ stage: "uploading", percent: 5, message: "Validating uploaded document" })
  const validated = validateUpload(input)
  const fileHash = createHash("sha256").update(validated.bytes).digest("hex")
  progress?.({ stage: "reading", percent: 20, message: "Reading document" })
  let native: NativeExtraction | undefined
  if ([".xlsx", ".xls", ".csv"].includes(validated.extension)) native = await parseSpreadsheetBufferAsync(validated.bytes)
  progress?.({ stage: "extracting", percent: 38, message: "Extracting tables and text" })
  const heuristicItems = native ? heuristicSpreadsheetItems(native) : []
  const aiEnabled = input.aiEnabled !== false
  progress?.({
    stage: "analyzing",
    percent: 55,
    message: aiEnabled ? "Analyzing document semantics with AI" : "Analyzing document locally",
  })
  let ai: Awaited<ReturnType<typeof analyzeManifestWithAi>> = null
  let processingWarning: string | null = null
  if (aiEnabled) {
    try {
      ai = await analyzeManifestWithAi({ fileName: input.fileName, mimeType: validated.mimeType, bytes: validated.bytes, nativeExtraction: native, nativeItems: heuristicItems })
    } catch (error) {
      processingWarning = userFacingAiError(error)
      if (!native) throw new Error(processingWarning)
    }
  }
  if (!ai && !native) {
    throw new Error(aiEnabled
      ? "AI extraction is required for PDF and image manifests"
      : "Local-only analysis supports XLSX, XLS, and CSV manifests. Enable AI analysis for PDF and image files.")
  }
  const metadata = mergeMetadata(nativeMetadata(native), ai?.shipment)
  const items = mergeExtractedItems(heuristicItems, ai?.items ?? []).map(canonicalizeProductFields)
  if (items.length === 0) throw new Error("No shipment items could be extracted from this document")
  progress?.({ stage: "normalizing", percent: 80, message: "Normalizing extracted data" })
  progress?.({ stage: "complete", percent: 100, message: "Manifest is ready for review" })
  return {
    fileName: input.fileName,
    fileType: validated.mimeType,
    fileSize: validated.bytes.byteLength,
    fileHash,
    shipmentNumber: metadata.shipmentNumber,
    supplierName: metadata.supplier,
    supplierReference: metadata.supplierReference,
    invoiceNumber: metadata.invoiceNumber,
    manifestNumber: metadata.manifestNumber,
    shipmentDate: metadata.shipmentDate,
    expectedArrivalDate: metadata.expectedArrivalDate,
    origin: metadata.origin,
    destination: metadata.destination,
    currency: metadata.currency,
    aiProvider: ai?.provider ?? "native",
    aiModel: ai?.model ?? null,
    aiRequestId: ai?.requestId ?? null,
    aiProcessingMs: ai?.durationMs ?? null,
    processingWarning: ai?.fallbackReason ?? processingWarning,
    promptVersion: MANIFEST_PROMPT_VERSION,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    rawExtraction: (native?.raw ?? ai?.raw ?? {}) as Record<string, unknown>,
    items,
  }
}
