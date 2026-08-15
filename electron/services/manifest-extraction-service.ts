import { createHash } from "node:crypto"
import path from "node:path"
import {
  ALLOWED_MANIFEST_EXTENSIONS,
  MAX_MANIFEST_FILE_SIZE,
  canonicalizeExtractedProductFields,
  heuristicSpreadsheetItems,
  parseSpreadsheetBufferAsync,
  parseWordDocumentBufferAsync,
  type NativeExtraction,
  type ParsedManifestItem,
} from "./manifest-parser.js"
import { analyzeManifestWithAi, userFacingAiError, type AiManifestMetadata } from "./openai-manifest-service.js"
import { reconcileExtractedItems } from "./manifest-reconciliation.js"
import { verifyManifestExtraction } from "./manifest-verification.js"
import { extractSupplierLegalName } from "../../src/lib/supplier-identity.js"
import {
  MANIFEST_PROMPT_VERSION,
  MANIFEST_SCHEMA_VERSION,
  type ManifestExtractionResult,
  type ManifestProgress,
  type ManifestUploadInput,
} from "../../src/lib/shipment-manifest.js"

type ProgressCallback = (progress: ManifestProgress) => void

function canonicalizeProductFields(item: ParsedManifestItem): ParsedManifestItem {
  if (!item.productName) return item
  const originalProductName = item.productName
  const canonical = canonicalizeExtractedProductFields({ ...item, productName: originalProductName })
  const extractionEvidence = Array.isArray((item.rawData._extraction as { evidence?: unknown[] } | undefined)?.evidence)
    ? (item.rawData._extraction as { evidence: Array<{ confidence?: number }> }).evidence
    : []
  const sourceConfidence = Math.max(item.confidence.productName ?? 0, ...extractionEvidence.map((entry) => Number(entry.confidence) || 0), 0.5)
  const derivedConfidence = Math.min(0.95, sourceConfidence * 0.94)
  const derived = (existing: number | undefined, previous: unknown, next: unknown) => existing ?? (previous !== next && next != null ? derivedConfidence : undefined)
  const rawFields = {
    productName: item.productName,
    productType: item.productType,
    weaponType: item.weaponType,
    category: item.category,
    manufacturer: item.manufacturer,
    model: item.model,
    caliber: item.caliber,
  }
  const confidence = { ...item.confidence }
  const derivedFields = [
    ["productName", item.productName, canonical.productName],
    ["productType", item.productType, canonical.productType],
    ["weaponType", item.weaponType, canonical.weaponType],
    ["category", item.category, canonical.category],
    ["manufacturer", item.manufacturer, canonical.manufacturer],
    ["model", item.model, canonical.model],
    ["caliber", item.caliber, canonical.caliber],
  ] as const
  for (const [field, previous, next] of derivedFields) {
    const value = derived(item.confidence[field], previous, next)
    if (value != null) confidence[field] = value
  }
  return {
    ...item,
    productName: canonical.productName,
    productType: canonical.productType,
    weaponType: canonical.weaponType,
    category: canonical.category,
    manufacturer: canonical.manufacturer,
    model: canonical.model,
    caliber: canonical.caliber,
    confidence,
    rawData: {
      ...item.rawData,
      _rawFields: rawFields,
      _classification: { actionType: canonical.actionType, feedingType: canonical.feedingType },
      _normalization: { method: "deterministic-bilingual-lexicon", derivedFrom: "productName", sourceConfidence, derivedConfidence },
      ...(canonical.translated ? { _translation: { originalProductName, canonicalProductName: canonical.productName, language: "ar", method: "deterministic-weapon-lexicon" } } : {}),
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
    ".doc": startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1),
    ".docx": startsWith(0x50, 0x4b),
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
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  }[extension] ?? "application/octet-stream")
  return { extension, mimeType, bytes }
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, يناير: 1,
  february: 2, feb: 2, فبراير: 2,
  march: 3, mar: 3, مارس: 3,
  april: 4, apr: 4, ابريل: 4, أبريل: 4,
  may: 5, مايو: 5,
  june: 6, jun: 6, يونيو: 6,
  july: 7, jul: 7, يوليو: 7,
  august: 8, aug: 8, اغسطس: 8, أغسطس: 8,
  september: 9, sep: 9, سبتمبر: 9,
  october: 10, oct: 10, اكتوبر: 10, أكتوبر: 10,
  november: 11, nov: 11, نوفمبر: 11,
  december: 12, dec: 12, ديسمبر: 12,
}

function asciiDigits(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
}

function parseNamedMonthDate(value: string | null): string | null {
  if (!value) return null
  const normalized = asciiDigits(value).normalize("NFKC")
  const dayFirst = normalized.match(/\b(\d{1,2})\s+([\p{L}.]+)\s+(\d{4})\b/iu)
  const monthFirst = normalized.match(/\b([A-Za-z.]+)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/i)
  const day = Number(dayFirst?.[1] ?? monthFirst?.[2])
  const monthName = (dayFirst?.[2] ?? monthFirst?.[1] ?? "").replace(/\./g, "").toLocaleLowerCase("en")
  const year = Number(dayFirst?.[3] ?? monthFirst?.[3])
  const month = MONTHS[monthName]
  if (!month || year < 1900 || year > 2200 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`
}

function metadataFromFileName(fileName: string): { supplier: string | null; shipmentDate: string | null } {
  const stem = path.basename(fileName, path.extname(fileName)).replace(/\s*\(\d+\)\s*$/, "").trim()
  const dateMatch = stem.match(/(?:\d{1,2}\s+[\p{L}.]+\s+\d{4}|[A-Za-z.]+\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{4})/iu)
  const orderMatch = stem.match(/^(?:طلبيه|طلبية|order)\s+(.+?)(?=\s+\d{1,2}\s+[\p{L}.]+\s+\d{4}|\s+[A-Za-z.]+\s+\d{1,2}|$)/iu)
  return {
    supplier: orderMatch?.[1]?.trim() || null,
    shipmentDate: parseNamedMonthDate(dateMatch?.[0] ?? null),
  }
}

function nativeMetadata(extraction: NativeExtraction | undefined, fileName: string): AiManifestMetadata {
  const source = extraction?.text ?? ""
  const pick = (patterns: RegExp[]): string | null => {
    for (const pattern of patterns) {
      const match = source.match(pattern)
      if (match?.[1]?.trim()) return match[1].trim().replace(/\t.*$/, "")
    }
    return null
  }
  const fileMetadata = metadataFromFileName(fileName)
  const date = pick([/(?:shipment\s*date|date|تاريخ\s*الشحنه|تاريخ\s*الشحنة|التاريخ)\s*[:#]?\s*([^\n]+)/i])
  const namedDate = parseNamedMonthDate(date)
  const parsedDate = date && !namedDate ? new Date(asciiDigits(date)) : null
  const shipmentDate = namedDate
    ?? (parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString().slice(0, 10) : null)
    ?? fileMetadata.shipmentDate
  const supplier = extractSupplierLegalName(
    pick([/(?:shipper|exporter|supplier|المورد|الشاحن|المصدر)\s*[:#]?\s*([^\n]+)/i]) ?? fileMetadata.supplier,
  )
  return {
    shipmentNumber: pick([/(?:commercial\s*#|manifest\s*(?:number|no)|shipment\s*(?:number|no))\s*[:#]?\s*([^\n]+)/i]),
    supplier,
    supplierReference: null,
    invoiceNumber: pick([/invoice\s*(?:number|no)?\s*[:#]?\s*([^\n]+)/i]),
    manifestNumber: pick([/manifest\s*(?:number|no)\s*[:#]?\s*([^\n]+)/i]),
    shipmentDate,
    expectedArrivalDate: null,
    origin: pick([/(?:origin|country\s*of\s*origin)\s*[:#]?\s*([^\n]+)/i]),
    destination: pick([/(?:destination|consignee)\s*[:#]?\s*([^\n]+)/i]),
    currency: pick([/(?:currency)\s*[:#]?\s*([A-Z]{3})/i])?.toUpperCase() ?? null,
    confidence: {
      supplier: supplier ? fileMetadata.supplier === supplier ? 0.78 : 0.96 : 0,
      shipmentDate: shipmentDate ? fileMetadata.shipmentDate === shipmentDate ? 0.93 : 0.96 : 0,
    },
  }
}

function mergeMetadata(native: AiManifestMetadata, ai: AiManifestMetadata | undefined): AiManifestMetadata {
  if (!ai) return native
  const merged = { ...native, confidence: { ...native.confidence } }
  const fields: Array<Exclude<keyof AiManifestMetadata, "confidence">> = [
    "shipmentNumber", "supplier", "supplierReference", "invoiceNumber", "manifestNumber", "shipmentDate",
    "expectedArrivalDate", "origin", "destination", "currency",
  ]
  for (const field of fields) {
    const nativeValue = native[field]
    const aiValue = ai[field]
    const nativeConfidence = native.confidence[field] ?? 0
    const aiConfidence = ai.confidence[field] ?? 0
    if (aiValue != null && aiValue !== "" && (nativeValue == null || nativeValue === "" || aiConfidence >= nativeConfidence + 0.12)) {
      merged[field] = aiValue
      merged.confidence[field] = aiConfidence
    }
  }
  return merged
}

export async function extractShipmentManifest(input: ManifestUploadInput, progress?: ProgressCallback): Promise<ManifestExtractionResult> {
  progress?.({ stage: "uploading", percent: 5, message: "Validating uploaded document" })
  const validated = validateUpload(input)
  const fileHash = createHash("sha256").update(validated.bytes).digest("hex")
  progress?.({ stage: "reading", percent: 20, message: "Reading document" })
  let native: NativeExtraction | undefined
  if ([".xlsx", ".xls", ".csv"].includes(validated.extension)) native = await parseSpreadsheetBufferAsync(validated.bytes)
  else if ([".doc", ".docx"].includes(validated.extension)) native = await parseWordDocumentBufferAsync(validated.bytes)
  if (native) {
    native = {
      ...native,
      text: `# Source file: ${input.fileName}\n${native.text}`,
      raw: { ...native.raw, sourceFile: input.fileName },
    }
  }
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
      : "Local-only analysis supports XLSX, XLS, CSV, DOC, and DOCX manifests. Enable AI analysis for PDF and image files.")
  }
  const metadata = mergeMetadata(nativeMetadata(native, input.fileName), ai?.shipment)
  const normalizedItems = reconcileExtractedItems(heuristicItems, ai?.items ?? []).map(canonicalizeProductFields)
  if (normalizedItems.length === 0) throw new Error("No shipment items could be extracted from this document")
  const { items, verification } = verifyManifestExtraction({
    items: normalizedItems,
    nativeExtraction: native,
    visualAnalysisCompleted: Boolean(ai?.visualInputUsed),
  })
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
    rawExtraction: {
      ...(native?.raw ?? {}),
      ...(!native && ai?.raw && typeof ai.raw === "object" && !Array.isArray(ai.raw) ? ai.raw as Record<string, unknown> : {}),
      verification,
    },
    verification,
    items,
  }
}
