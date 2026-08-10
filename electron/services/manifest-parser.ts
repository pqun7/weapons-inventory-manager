import * as XLSX from "xlsx"
import { Worker } from "node:worker_threads"
import type { ManifestProductType, ManifestReviewItem, ManifestSource } from "../../src/lib/shipment-manifest.js"
import { normalizeCaliber, normalizeSerial } from "../../src/lib/shipment-manifest.js"

export const ALLOWED_MANIFEST_EXTENSIONS = new Set([".xlsx", ".xls", ".csv", ".pdf", ".jpg", ".jpeg", ".png", ".webp"])
export const MAX_MANIFEST_FILE_SIZE = 30 * 1024 * 1024

export interface NativeSheet {
  name: string
  rows: Array<{ row: number; cells: Array<{ column: string; value: string | number | boolean }> }>
}

export interface NativeExtraction {
  kind: "spreadsheet" | "document"
  sheets: NativeSheet[]
  text: string
  raw: Record<string, unknown>
}

export type ParsedManifestItem = Omit<ManifestReviewItem, "id" | "issues" | "status">

type Field = "description" | "quantity" | "serial" | "caliber" | "manufacturer" | "model" | "sku" | "productCode" | "unitPrice" | "totalPrice" | "currency" | "origin"
type HeaderMap = Partial<Record<Field, number>>
type MatrixRow = { sourceRow: number; values: unknown[] }
type Evidence = { field: string; value: unknown; confidence: number; method: string; row: number; column?: string }

const HEADER_ALIASES: Record<Field, readonly string[]> = {
  description: ["description of goods", "description of products", "item description", "product description", "description", "product name", "product", "item", "goods", "material", "الصنف", "المنتج", "اسم المنتج", "الوصف", "النوع", "البضاعة"],
  quantity: ["quantity", "qty", "q ty", "units", "unit count", "piece count", "pcs", "pieces", "adet", "miktar", "الكمية", "العدد", "عدد", "قطع"],
  serial: ["serial numbers", "serial number", "serials of products", "serial no", "serial nos", "serials", "serial", "s n", "رقم السلاح", "الرقم التسلسلي", "الارقام التسلسلية", "الأرقام التسلسلية", "التسلسل"],
  caliber: ["caliber", "calibre", "gauge", "bore", "العيار"],
  manufacturer: ["manufacturer", "brand", "make", "producer", "الشركة المصنعة", "الشركة", "المصنع", "العلامة التجارية", "الماركة"],
  model: ["model number", "model no", "model", "موديل", "الموديل", "الطراز"],
  sku: ["sku", "stock keeping unit", "stock code", "item code", "رمز المخزون", "رمز الصنف"],
  productCode: ["product code", "part number", "part no", "material code", "code", "كود المنتج", "الكود", "الرمز"],
  unitPrice: ["unit price", "unit cost", "price each", "price", "cost", "سعر الوحدة", "السعر", "التكلفة"],
  totalPrice: ["total price", "line total", "total amount", "amount", "القيمة الاجمالية", "السعر الاجمالي", "الإجمالي"],
  currency: ["currency", "curr", "العملة"],
  origin: ["country of origin", "origin country", "made in", "بلد المنشأ", "المنشأ"],
}

const KNOWN_MANUFACTURERS = [
  "Axor Arms", "Radelli Arms", "Arslan Silah", "Tokarev Arms", "Kral Arms", "Hatsan", "Retay", "Kuzey", "Castello", "Masai Mara", "Aksa", "Reximex",
  "Beretta", "Browning", "Glock", "Winchester", "Benelli", "Stoeger", "Taurus", "Walther", "Ruger", "Sig Sauer",
].sort((a, b) => b.length - a.length)

const GENERIC_MODEL_WORDS = new Set([
  "semi", "auto", "automatic", "pump", "action", "magazine", "feed", "fed", "folding", "blank", "air", "pcp",
  "break", "barrel", "shotgun", "pistol", "rifle", "revolver", "firearm", "gun", "polymer", "box", "black",
  "syn", "synthetic", "set", "with", "accessory", "accessories", "round", "rounds", "arms", "arm", "ga", "gauge",
])

function columnName(index: number): string {
  let n = index + 1
  let result = ""
  while (n > 0) {
    const remainder = (n - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    n = Math.floor((n - 1) / 26)
  }
  return result
}

function columnIndex(name: string): number {
  let value = 0
  for (const char of name.toUpperCase()) value = value * 26 + char.charCodeAt(0) - 64
  return value - 1
}

function text(value: unknown): string {
  if (value == null) return ""
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").normalize("NFKC").replace(/[\t ]+/g, " ").trim()
}

function fold(value: unknown): string {
  return text(value)
    .normalize("NFKD")
    .toLocaleLowerCase("en")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[×✕]/g, "x")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function headerMatchScore(value: unknown, alias: string): number {
  const cell = fold(value)
  const candidate = fold(alias)
  if (!cell || !candidate) return 0
  if (cell === candidate) return 1
  const cellCompact = cell.replace(/\s/g, "")
  const aliasCompact = candidate.replace(/\s/g, "")
  if (cellCompact === aliasCompact) return 0.98
  if (aliasCompact.length >= 5 && cellCompact.length <= aliasCompact.length + 14 && (cellCompact.startsWith(aliasCompact) || cellCompact.endsWith(aliasCompact))) return 0.88
  const aliasTokens = candidate.split(" ")
  const cellTokens = new Set(cell.split(" "))
  if (aliasTokens.length > 1 && cellTokens.size <= aliasTokens.length + 3 && aliasTokens.every((token) => cellTokens.has(token))) return 0.9
  if (aliasCompact.length >= 7 && cellCompact.length <= aliasCompact.length * 2 + 8 && cellCompact.includes(aliasCompact)) return 0.82
  return 0
}

function scoreCellForField(value: unknown, field: Field): number {
  return Math.max(0, ...HEADER_ALIASES[field].map((alias) => headerMatchScore(value, alias)))
}

function assignHeader(values: unknown[]): { map: HeaderMap; score: number; evidence: Array<{ field: Field; column: number; score: number }> } {
  const candidates: Array<{ field: Field; column: number; score: number }> = []
  for (let column = 0; column < values.length; column++) {
    if (!text(values[column])) continue
    for (const field of Object.keys(HEADER_ALIASES) as Field[]) {
      const score = scoreCellForField(values[column], field)
      if (score >= 0.78) candidates.push({ field, column, score })
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.column - b.column)
  const map: HeaderMap = {}
  const usedColumns = new Set<number>()
  const evidence: Array<{ field: Field; column: number; score: number }> = []
  for (const candidate of candidates) {
    if (map[candidate.field] != null || usedColumns.has(candidate.column)) continue
    map[candidate.field] = candidate.column
    usedColumns.add(candidate.column)
    evidence.push(candidate)
  }
  const fields = Object.keys(map) as Field[]
  const structuralBonus = map.description != null && map.serial != null ? 1.2 : map.description != null ? 0.65 : map.serial != null ? 0.55 : 0
  const businessBonus = fields.some((field) => ["quantity", "caliber", "manufacturer", "model", "sku", "unitPrice"].includes(field)) ? 0.4 : 0
  return { map, score: evidence.reduce((sum, item) => sum + item.score, 0) + structuralBonus + businessBonus, evidence }
}

function isLikelySerialToken(token: string): boolean {
  const candidate = token.toUpperCase().replace(/^[#:,;]+|[,:;.)]+$/g, "")
  if (candidate.length < 6 || candidate.length > 80) return false
  if (!/\d/.test(candidate) || !/[A-Z]/.test(candidate)) return false
  if (!/^[A-Z0-9][A-Z0-9._/-]*[A-Z0-9]$/.test(candidate)) return false
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(candidate)) return false
  if (/^\d+(?:[.,]\d+)?(?:MM|GA|GAUGE|PCS?)$/.test(candidate)) return false
  if (/^\d{4,6}[.-]\d{2}$/.test(candidate)) return false
  const alphaNumericLength = candidate.replace(/[^A-Z0-9]/g, "").length
  return alphaNumericLength >= 8
}

export function extractSerials(value: unknown): string[] {
  const raw = text(value).toUpperCase()
  if (!raw) return []
  const labelled = raw.replace(/(?:SERIAL(?:\s*(?:NO|NOS|NUMBER|NUMBERS))?|S\/N|الرقم\s*التسلسلي|رقم\s*السلاح)\s*[:#-]?/giu, " ")
  const tokens = labelled.split(/[\s,;|]+/).map((token) => token.trim()).filter(isLikelySerialToken)
  return [...new Set(tokens.map(normalizeSerial).filter(Boolean))]
}

function productTypeScores(description: string): Record<ManifestProductType, number> {
  const value = fold(description)
  const scores: Record<ManifestProductType, number> = { weapon: 0, ammunition: 0, accessory: 0 }
  const add = (type: ManifestProductType, pattern: RegExp, amount: number) => { if (pattern.test(value)) scores[type] += amount }
  add("weapon", /\b(?:shotgun|pumpshotgun|pistol|rifle|revolver|firearm|carbine|musket|مسدس|بندقيه|سلاح)\b/, 4)
  add("weapon", /\b(?:semi auto|pump action|blank pistol|air rifle|magazine feed shotgun)\b/, 3)
  add("ammunition", /\b(?:ammunition|ammo|cartridge|cartridges|pellet|pellets|bullet|bullets|shells|ذخيره|طلق|خرطوش)\b/, 5)
  add("accessory", /\b(?:case|cleaning (?:kit|set)|scope|grips?|zeroing apparatus|air rifle pump|spare tube|binoculars?|sling|holster|foot|حافظه|منظار|اكسسوار|ملحق)\b/, 7)
  add("accessory", /\b(?:magazine|accessories|accessory|tube)\b/, 2)
  if (/\b(?:air rifle pump|pistol case|rifle case|zeroing apparatus)\b/.test(value)) scores.weapon = Math.max(0, scores.weapon - 5)
  return scores
}

export function inferProductType(description: string): ManifestProductType | null {
  const scores = productTypeScores(description)
  const ranked = (Object.entries(scores) as Array<[ManifestProductType, number]>).sort((a, b) => b[1] - a[1])
  return ranked[0][1] >= 3 && ranked[0][1] >= ranked[1][1] + 1 ? ranked[0][0] : null
}

export function inferCaliber(description: string): string | null {
  const source = text(description).replace(/[×✕]/g, "x")
  const matches = source.match(/(?:\b(?:4[,.]5|5[,.]5|6[,.]35|7[,.]62)(?:\s*mm)?\b|\b9\s*mm\b|\b9\s*x\s*19(?:\s*mm)?\b|\b(?:10|12|16|20|28|410)\s*(?:ga|gauge)\b|\b(?:10|12|16|20|28)\s*\/\s*(?:65|70|71|76|89)\b|\.(?:177|22|223|308|357|380|45)\b)/i)
  return normalizeCaliber(matches?.[0] ?? null)
}

function parseLocalizedNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  let candidate = text(value).replace(/[\u0660-\u0669]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/[\u06F0-\u06F9]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
  candidate = candidate.replace(/[^0-9.,+()-]/g, "").replace(/^\((.*)\)$/, "-$1")
  if (!candidate || !/\d/.test(candidate)) return null
  const comma = candidate.lastIndexOf(",")
  const dot = candidate.lastIndexOf(".")
  if (comma >= 0 && dot >= 0) candidate = comma > dot ? candidate.replace(/\./g, "").replace(",", ".") : candidate.replace(/,/g, "")
  else if (comma >= 0) {
    const decimals = candidate.length - comma - 1
    candidate = decimals === 3 && /^[-+]?\d{1,3}(?:,\d{3})+$/.test(candidate) ? candidate.replace(/,/g, "") : candidate.replace(",", ".")
  }
  const parsed = Number(candidate)
  return Number.isFinite(parsed) ? parsed : null
}

function parseQuantity(value: unknown): number | null {
  const raw = text(value)
  if (!raw || /(?:kg|gram|mm|cm|meter|m³|cbm|weight|\d\s*[x×*]\s*\d)/i.test(raw)) return null
  const parsed = parseLocalizedNumber(raw.replace(/\b(?:pcs?|pieces?|units?|adet|قطعه|قطع)\b/giu, ""))
  return parsed != null && Number.isInteger(parsed) && parsed > 0 && parsed <= 10_000_000 ? parsed : null
}

function parseMoney(value: unknown): number | null {
  const parsed = parseLocalizedNumber(value)
  return parsed != null && parsed >= 0 ? parsed : null
}

function quantityFromDescription(description: string): number | null {
  const match = text(description).match(/(?:\(|\b)([\d٠-٩۰-۹][\d٠-٩۰-۹.,]*)\s*(?:pcs?|pieces?|units?|adet|قطعه|قطع)(?:\)|\b)/iu)
  return match ? parseQuantity(match[1]) : null
}

function inferWeaponType(description: string): string | null {
  const normalized = fold(description)
  if (/\bblank pistol\b/.test(normalized)) return "Blank pistol"
  if (/\bair rifle\b/.test(normalized)) return "Air rifle"
  if (/\bshotgun\b/.test(normalized)) return "Shotgun"
  if (/\b(?:pistol|revolver)\b/.test(normalized)) return "Pistol"
  if (/\brifle\b/.test(normalized)) return "Rifle"
  return null
}

function inferManufacturerAndModel(description: string): { manufacturer: string | null; model: string | null; manufacturerConfidence: number; modelConfidence: number } {
  const cleaned = text(description).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim()
  const manufacturer = KNOWN_MANUFACTURERS.find((candidate) => fold(cleaned).includes(fold(candidate))) ?? null
  if (!manufacturer) return { manufacturer: null, model: null, manufacturerConfidence: 0.15, modelConfidence: 0.15 }
  const afterBrand = cleaned.slice(fold(cleaned).indexOf(fold(manufacturer)) + manufacturer.length).trim()
  const tokens = afterBrand.split(/\s+/).filter((token) => {
    const normalized = fold(token)
    return normalized && !GENERIC_MODEL_WORDS.has(normalized) && !inferCaliber(token) && !/^\d+(?:[-/+,.]\d+)*$/.test(normalized)
  })
  const model = tokens.slice(0, 3).join(" ") || null
  return { manufacturer, model, manufacturerConfidence: 0.92, modelConfidence: model ? 0.72 : 0.15 }
}

function isNonItemDescription(description: string): boolean {
  const normalized = fold(description)
  return /^(?:total|subtotal|grand total|note|notes|footer|net weight|gross weight|total cartons|total amount|page \d+|المجموع|الاجمالي|ملاحظات)/.test(normalized)
    || /(?:excel hatasi|mevcut degildir|packing list|consignee|shipper|exporter|customer|address|phone|invoice number|commercial #)/.test(normalized)
}

function looksLikeDescription(value: string): boolean {
  if (value.length < 4 || isNonItemDescription(value)) return false
  if (/^[\d\s.,/+*x×-]+$/i.test(value)) return false
  const wordTokens = value.split(/\s+/).filter((token) => /^\p{L}{3,}[\p{L}-]*$/u.test(token))
  if (wordTokens.length > 0) return true
  const tokens = value.split(/[\s,;|]+/).filter(Boolean)
  return tokens.length > 0 && extractSerials(value).length < tokens.length && /\p{L}{3}/u.test(value)
}

function headerPlausibility(matrix: MatrixRow[], index: number, map: HeaderMap): number {
  let descriptions = 0
  let serialRows = 0
  let quantities = 0
  for (const row of matrix.slice(index + 1, index + 9)) {
    if (map.description != null && looksLikeDescription(text(row.values[map.description]))) descriptions++
    if (row.values.flatMap(extractSerials).length > 0) serialRows++
    if (map.quantity != null && parseQuantity(row.values[map.quantity]) != null) quantities++
  }
  if (map.description != null && descriptions > 0) return Math.min(1.2, descriptions * 0.25 + serialRows * 0.1 + quantities * 0.1)
  if (map.serial != null && serialRows > 0) return Math.min(1, serialRows * 0.18)
  return 0
}

function findHeaderRegions(matrix: MatrixRow[]): Array<{ headerIndex: number; endIndex: number; map: HeaderMap; score: number }> {
  const headers: Array<{ headerIndex: number; map: HeaderMap; score: number }> = []
  for (let index = 0; index < matrix.length; index++) {
    const assigned = assignHeader(matrix[index].values)
    const score = assigned.score + headerPlausibility(matrix, index, assigned.map)
    const usable = assigned.map.description != null || assigned.map.serial != null
    if (!usable || score < 1.5) continue
    const last = headers.at(-1)
    if (last && index - last.headerIndex <= 2) {
      if (score > last.score) headers[headers.length - 1] = { headerIndex: index, map: assigned.map, score }
      continue
    }
    headers.push({ headerIndex: index, map: assigned.map, score })
  }
  if (headers.length === 0) return [{ headerIndex: -1, endIndex: matrix.length, map: {}, score: 0 }]
  return headers.map((header, index) => ({ ...header, endIndex: headers[index + 1]?.headerIndex ?? matrix.length }))
}

function descriptionForRow(values: unknown[], map: HeaderMap): { value: string | null; column: number | null; method: string } {
  if (map.description != null) {
    const mapped = text(values[map.description])
    if (looksLikeDescription(mapped)) return { value: mapped, column: map.description, method: "mapped-column" }
  }
  if (map.serial != null) {
    const shared = text(values[map.serial])
    if (extractSerials(shared).length === 0 && looksLikeDescription(shared)) return { value: shared, column: map.serial, method: "shared-serial-description-column" }
  }
  const excluded = new Set(Object.entries(map).filter(([field]) => field !== "description").map(([, column]) => column).filter((column): column is number => column != null))
  const candidates = values.map((value, column) => ({ value: text(value), column })).filter((candidate) => !excluded.has(candidate.column) && looksLikeDescription(candidate.value))
  candidates.sort((a, b) => b.value.length - a.value.length)
  return candidates[0] ? { ...candidates[0], method: "row-content" } : { value: null, column: null, method: "none" }
}

function serialColumns(map: HeaderMap, values: unknown[]): number[] {
  if (map.serial == null) return values.map((_, index) => index)
  const boundaries = Object.values(map).filter((column): column is number => column != null && column > map.serial!).sort((a, b) => a - b)
  const end = boundaries[0] ?? values.length
  return Array.from({ length: Math.max(1, end - map.serial) }, (_, index) => map.serial! + index)
}

function makeItem(rowIndex: number, values: Partial<ParsedManifestItem> & { source: ManifestSource; rawData: Record<string, unknown> }): ParsedManifestItem {
  const serialNumbers = [...new Set((values.serialNumbers ?? (values.serialNumber ? [values.serialNumber] : [])).map(normalizeSerial).filter(Boolean))]
  return {
    rowIndex,
    productType: values.productType ?? null,
    productName: values.productName ?? null,
    category: values.category ?? null,
    weaponType: values.weaponType ?? null,
    manufacturer: values.manufacturer ?? null,
    model: values.model ?? null,
    caliber: normalizeCaliber(values.caliber) ?? null,
    sku: values.sku ?? null,
    productCode: values.productCode ?? null,
    serialNumber: values.serialNumber ?? (serialNumbers.length === 1 ? serialNumbers[0] : null),
    serialNumbers,
    quantity: values.quantity ?? null,
    unitPrice: values.unitPrice ?? null,
    totalPrice: values.totalPrice ?? null,
    currency: values.currency ?? null,
    countryOfOrigin: values.countryOfOrigin ?? null,
    weaponTypeId: null,
    weaponSubtypeId: null,
    brandId: null,
    modelId: null,
    caliberId: null,
    storageLocationId: null,
    confidence: values.confidence ?? {},
    source: values.source,
    rawData: values.rawData,
  }
}

function decodeTextFile(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.slice(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Uint8Array.from(bytes.slice(2), (_, index) => bytes[index % 2 === 0 ? index + 3 : index + 1])
    return new TextDecoder("utf-16le").decode(swapped)
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "")
}

function delimiterFor(textValue: string): string | undefined {
  const lines = textValue.split(/\r?\n/).filter(Boolean).slice(0, 20)
  const candidates = [",", ";", "\t", "|"]
  const ranked = candidates.map((delimiter) => {
    const counts = lines.map((line) => line.split(delimiter).length - 1)
    const nonzero = counts.filter((count) => count > 0)
    const consistency = nonzero.length > 1 ? nonzero.filter((count) => count === nonzero[0]).length / nonzero.length : 0
    return { delimiter, score: nonzero.length * consistency * (nonzero[0] ?? 0) }
  }).sort((a, b) => b.score - a.score)
  return ranked[0].score > 0 ? ranked[0].delimiter : undefined
}

export function parseSpreadsheetBuffer(bytes: Uint8Array): NativeExtraction {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf
  const workbook = isZip || isOle
    ? XLSX.read(bytes, { type: "array", cellDates: true, dense: true, WTF: false })
    : (() => {
        const decoded = decodeTextFile(bytes)
        return XLSX.read(decoded, { type: "string", cellDates: true, dense: true, FS: delimiterFor(decoded) })
      })()
  const sheets: NativeSheet[] = []
  const textParts: string[] = []
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: false, blankrows: true })
    const rows = matrix.map((row, rowIndex) => ({
      row: rowIndex + 1,
      cells: row.map((value, index) => ({ column: columnName(index), value: value as string | number | boolean })).filter((cell) => text(cell.value) !== ""),
    })).filter((row) => row.cells.length > 0)
    sheets.push({ name, rows })
    textParts.push(`# Sheet: ${name}`)
    for (const row of rows) textParts.push(`${row.row}\t${row.cells.map((cell) => `${cell.column}:${text(cell.value)}`).join("\t")}`)
  }
  return { kind: "spreadsheet", sheets, text: textParts.join("\n"), raw: { sheetCount: sheets.length, sheets } }
}

export function parseSpreadsheetBufferAsync(bytes: Uint8Array): Promise<NativeExtraction> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./manifest-parser-worker.js", import.meta.url), { workerData: Buffer.from(bytes) })
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      callback()
      void worker.terminate()
    }
    worker.once("message", (message: { ok: true; extraction: NativeExtraction } | { ok: false; error: string }) => {
      finish(() => message.ok ? resolve(message.extraction) : reject(new Error(message.error)))
    })
    worker.once("error", (error) => finish(() => reject(error)))
    worker.once("exit", (code) => { if (!settled && code !== 0) finish(() => reject(new Error(`Spreadsheet parser worker stopped with exit code ${code}`))) })
  })
}

export function heuristicSpreadsheetItems(extraction: NativeExtraction): ParsedManifestItem[] {
  const result: ParsedManifestItem[] = []
  let globalIndex = 0
  for (const sheet of extraction.sheets) {
    const matrix: MatrixRow[] = sheet.rows.map((row) => {
      const values: unknown[] = []
      for (const cell of row.cells) values[columnIndex(cell.column)] = cell.value
      return { sourceRow: row.row, values }
    })
    for (const region of findHeaderRegions(matrix)) {
      let active: ParsedManifestItem | null = null
      for (let index = Math.max(0, region.headerIndex + 1); index < region.endIndex; index++) {
        const { sourceRow, values } = matrix[index]
        const allText = values.map(text).filter(Boolean)
        if (allText.length === 0) continue
        const description = descriptionForRow(values, region.map)
        const serialColumnList = serialColumns(region.map, values)
        const mappedSerials = serialColumnList.flatMap((column) => extractSerials(values[column]))
        const allSerials = [...new Set((mappedSerials.length > 0 ? mappedSerials : values.flatMap(extractSerials)).map(normalizeSerial).filter(Boolean))]
        const isItemDescription = Boolean(description.value && !isNonItemDescription(description.value))
        const explicitQuantity = region.map.quantity == null ? null : parseQuantity(values[region.map.quantity])
        const describedQuantity = description.value ? quantityFromDescription(description.value) : null

        if (isItemDescription) {
          const productName = description.value!
          const productType = inferProductType(productName)
          const explicitCaliber = region.map.caliber == null ? null : text(values[region.map.caliber]) || null
          const caliber = explicitCaliber ?? inferCaliber(productName)
          const identity = inferManufacturerAndModel(productName)
          const explicitManufacturer = region.map.manufacturer == null ? null : text(values[region.map.manufacturer]) || null
          const explicitModel = region.map.model == null ? null : text(values[region.map.model]) || null
          const serialDerivedQuantity = explicitQuantity == null && describedQuantity == null && productType === "weapon" && allSerials.length > 0 ? allSerials.length : null
          const quantity = explicitQuantity ?? describedQuantity ?? serialDerivedQuantity
          const evidence: Evidence[] = [
            { field: "productName", value: productName, confidence: description.method === "mapped-column" ? 0.98 : 0.86, method: description.method, row: sourceRow, column: description.column == null ? undefined : columnName(description.column) },
          ]
          if (quantity != null) evidence.push({ field: "quantity", value: quantity, confidence: explicitQuantity != null ? 0.99 : describedQuantity != null ? 0.95 : 0.92, method: explicitQuantity != null ? "mapped-column" : describedQuantity != null ? "description-unit" : "serial-count", row: sourceRow })
          if (allSerials.length) evidence.push({ field: "serialNumber", value: allSerials, confidence: region.map.serial != null ? 0.995 : 0.96, method: region.map.serial != null ? "serial-column-band" : "strong-pattern", row: sourceRow })
          active = makeItem(++globalIndex, {
            productName,
            productType,
            weaponType: productType === "weapon" ? inferWeaponType(productName) : null,
            caliber,
            manufacturer: explicitManufacturer ?? identity.manufacturer,
            model: explicitModel ?? identity.model,
            sku: region.map.sku == null ? null : text(values[region.map.sku]) || null,
            productCode: region.map.productCode == null ? null : text(values[region.map.productCode]) || null,
            quantity,
            unitPrice: region.map.unitPrice == null ? null : parseMoney(values[region.map.unitPrice]),
            totalPrice: region.map.totalPrice == null ? null : parseMoney(values[region.map.totalPrice]),
            currency: region.map.currency == null ? null : text(values[region.map.currency]).toUpperCase() || null,
            countryOfOrigin: region.map.origin == null ? null : text(values[region.map.origin]) || null,
            serialNumbers: allSerials,
            confidence: {
              productName: description.method === "mapped-column" ? 0.98 : 0.86,
              quantity: quantity == null ? 0.15 : explicitQuantity != null ? 0.99 : describedQuantity != null ? 0.95 : 0.92,
              serialNumber: allSerials.length ? region.map.serial != null ? 0.995 : 0.96 : productType === "weapon" ? 0.2 : 1,
              productType: productType ? 0.94 : 0.2,
              weaponType: productType === "weapon" && inferWeaponType(productName) ? 0.92 : 0.2,
              caliber: caliber ? explicitCaliber ? 0.98 : 0.91 : 0.2,
              manufacturer: explicitManufacturer ? 0.98 : identity.manufacturerConfidence,
              model: explicitModel ? 0.98 : identity.modelConfidence,
              sku: region.map.sku != null && text(values[region.map.sku]) ? 0.98 : 0.2,
              unitPrice: region.map.unitPrice != null && parseMoney(values[region.map.unitPrice]) != null ? 0.98 : 0.2,
            },
            source: { sheet: sheet.name, row: sourceRow, column: description.column == null ? undefined : columnName(description.column), text: allText.join(" | ") },
            rawData: {
              ...Object.fromEntries(values.map((value, column) => [columnName(column), value]).filter(([, value]) => text(value) !== "")),
              _extraction: { tableHeaderRow: region.headerIndex >= 0 ? matrix[region.headerIndex].sourceRow : null, headerScore: region.score, evidence, quantityOrigin: explicitQuantity != null ? "explicit" : describedQuantity != null ? "description" : serialDerivedQuantity != null ? "serial-count" : "missing" },
            },
          })
          result.push(active)
        } else if (active && allSerials.length > 0) {
          const previousCount = active.serialNumbers.length
          active.serialNumbers = [...new Set([...active.serialNumbers, ...allSerials])]
          active.serialNumber = active.serialNumbers.length === 1 ? active.serialNumbers[0] : null
          const extractionMeta = active.rawData._extraction as Record<string, unknown> | undefined
          if (active.productType === "weapon" && (active.quantity == null || extractionMeta?.quantityOrigin === "serial-count")) {
            active.quantity = active.serialNumbers.length
            active.confidence.quantity = 0.92
            if (extractionMeta) extractionMeta.quantityOrigin = "serial-count"
          }
          active.confidence.serialNumber = region.map.serial != null ? 0.995 : 0.96
          active.rawData[`continuationRow${sourceRow}`] = { values: allText, appendedSerials: active.serialNumbers.length - previousCount }
        } else if (allSerials.length === 0 && allText.some((value) => /^(?:total|subtotal|grand total|notes?|المجموع|الاجمالي)/i.test(fold(value)))) {
          active = null
        }
      }
    }
  }
  return result.filter((item) => item.productName || item.serialNumbers.length > 0)
}
