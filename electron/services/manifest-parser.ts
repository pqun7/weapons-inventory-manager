import * as XLSX from "xlsx"
import { DOMParser } from "@xmldom/xmldom"
import { strFromU8, unzipSync } from "fflate"
import { Worker } from "node:worker_threads"
import type { ManifestProductType, ManifestReviewItem, ManifestSource } from "../../src/lib/shipment-manifest.js"
import { normalizeCaliber, normalizeSerial } from "../../src/lib/shipment-manifest.js"
import { MANIFEST_EXTENSIONS } from "../../src/lib/manifest-file-types.js"
import type { DocumentImage, DocumentParagraph, DocumentTable, NormalizedManifestDocument } from "./manifest-document-model.js"

export const ALLOWED_MANIFEST_EXTENSIONS = new Set<string>(MANIFEST_EXTENSIONS)
export const MAX_MANIFEST_FILE_SIZE = 30 * 1024 * 1024
const MAX_EXTRACTED_DOCUMENT_CHARACTERS = 8_000_000
const MANIFEST_PARSE_TIMEOUT_MS = 45_000

export interface NativeSheet {
  name: string
  hidden?: boolean
  mergedRanges?: string[]
  rows: Array<{ row: number; cells: Array<{ column: string; value: string | number | boolean; columnSpan?: number; verticalMerge?: "restart" | "continue" }> }>
}

export interface NativeExtraction {
  kind: "spreadsheet" | "document"
  sheets: NativeSheet[]
  text: string
  raw: Record<string, unknown>
  document?: NormalizedManifestDocument
}

export type ParsedManifestItem = Omit<ManifestReviewItem, "id" | "issues" | "status">

type Field = "description" | "quantity" | "serial" | "caliber" | "manufacturer" | "model" | "sku" | "productCode" | "unitPrice" | "totalPrice" | "currency" | "origin"
type HeaderMap = Partial<Record<Field, number>>
type MatrixRow = { sourceRow: number; values: unknown[] }
type Evidence = { field: string; value: unknown; confidence: number; method: string; row: number; column?: string }

const HEADER_ALIASES: Record<Field, readonly string[]> = {
  description: ["description of goods", "description of products", "item description", "product description", "description", "product name", "product", "item", "goods", "material", "البيان", "الصنف", "المنتج", "اسم المنتج", "الوصف", "النوع", "البضاعة"],
  quantity: ["quantity", "qty", "q ty", "count", "units", "unit count", "piece count", "pcs", "pieces", "adet", "miktar", "الكمية", "العدد", "عدد", "قطع"],
  serial: ["serial numbers", "serial number", "serials of products", "serial no", "serial nos", "serials", "serial", "s/n", "sn", "s n", "رقم السلاح", "الرقم المتسلسل", "الرقم التسلسلي", "الارقام التسلسلية", "الأرقام التسلسلية", "السيريال", "التسلسل"],
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
  "Axor Arms", "Radelli Arms", "Radelli", "Arslan Silah", "Tokarev Arms", "Kral Arms", "Ata Arms", "Hatsan", "Retay", "Kuzey", "Castello", "Masai Mara", "Gordion", "Aksa", "Reximex",
  "Beretta", "Browning", "Glock", "Winchester", "Benelli", "Stoeger", "Taurus", "Walther", "Ruger", "Sig Sauer", "Colt", "Remington", "Ekol", "Benjamin",
].sort((a, b) => b.length - a.length)

const ARABIC_MANUFACTURER_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["اكسور", "Axor Arms"], ["راديلي", "Radelli"], ["ارسلان", "Arslan Silah"], ["توكاريف", "Tokarev Arms"],
  ["كرال", "Kral Arms"], ["اتا", "Ata Arms"], ["هتسان", "Hatsan"], ["هاتسان", "Hatsan"], ["ريتاي", "Retay"],
  ["كوزي", "Kuzey"], ["كاستيلو", "Castello"], ["جورديون", "Gordion"], ["ريكسيميكس", "Reximex"],
  ["بيريتا", "Beretta"], ["براوننج", "Browning"], ["براوننغ", "Browning"], ["جلوك", "Glock"], ["غلوك", "Glock"],
  ["وينشستر", "Winchester"], ["بينيلي", "Benelli"], ["بينيللي", "Benelli"], ["ستويجر", "Stoeger"],
  ["تاوروس", "Taurus"], ["والثر", "Walther"], ["روجر", "Ruger"], ["سيج ساور", "Sig Sauer"],
  ["كولت", "Colt"], ["ريمنجتون", "Remington"], ["ايكول", "Ekol"], ["بنيامين", "Benjamin"],
]

const GENERIC_MODEL_WORDS = new Set([
  "semi", "auto", "automatic", "pump", "action", "magazine", "feed", "fed", "folding", "blank", "air", "pcp",
  "break", "barrel", "shotgun", "pumpshotgun", "pistol", "rifle", "revolver", "firearm", "gun", "polymer", "box", "black",
  "syn", "synthetic", "set", "with", "accessory", "accessories", "round", "rounds", "arms", "arm", "ga", "gauge",
  "polymer", "box", "black", "magazine", "accesories", "pcs", "piece", "pieces", "mm",
  "مسدس", "مسدسات", "بندقيه", "بنادق", "سلاح", "اسلحه", "خرطوش", "هواء", "صوت", "عيار", "ملي", "ملم",
  "نصف", "الي", "اتوماتيك", "اوتوماتيك", "مخزن", "مخزنيه", "طي", "قابل", "للطي", "كسر", "سبطانه",
  "موديل", "الموديل", "طراز", "الطراز", "صيد", "صياد", "هوائي", "هوائيه", "رشاش", "قناصه", "دوار", "فشنك", "خلبي",
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

function westernDigits(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
}

function containsArabic(value: unknown): boolean {
  return /[\u0600-\u06FF]/u.test(text(value))
}

function fold(value: unknown): string {
  return text(value)
    .normalize("NFKD")
    .toLocaleLowerCase("en")
    .replace(/\p{M}+/gu, "")
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
  const raw = westernDigits(text(value)).toUpperCase()
  if (!raw) return []
  const labelled = raw.replace(/(?:SERIAL(?:\s*(?:NO|NOS|NUMBER|NUMBERS))?|S\/N|الرقم\s*التسلسلي|الارقام\s*التسلسليه|الأرقام\s*التسلسلية|رقم\s*السلاح)\s*[:#-]?/giu, " ")
  const tokens = labelled.split(/[\s,;،؛|]+/).map((token) => token.trim()).filter(isLikelySerialToken)
  return [...new Set(tokens.map(normalizeSerial).filter(Boolean))]
}

function productTypeScores(description: string): Record<ManifestProductType, number> {
  const value = fold(description)
  const scores: Record<ManifestProductType, number> = { weapon: 0, ammunition: 0, accessory: 0 }
  const add = (type: ManifestProductType, pattern: RegExp, amount: number) => { if (pattern.test(value)) scores[type] += amount }
  const hasWeaponNoun = /\b(?:shotgun|pumpshotgun|pistol|rifle|revolver|firearm|carbine|musket|sniper|derringer|flare gun|machine gun|submachine gun|assault rifle)\b/.test(value)
    || /(?:^|\s)(?:مسدس(?:ات)?|طبنجه|طبنجة|بندقيه|بنادق|سلاح|اسلحه|رشاش|قناصه|ريفولفر|كاربين)(?:\s|$)/u.test(value)
  const hasDefinitiveAmmunitionNoun = /\b(?:ammunition|ammo|cartridge|cartridges|pellet|pellets|bullet|bullets|shotshell|shotshells|shells)\b/.test(value)
    || /(?:^|\s)(?:ذخيره|ذخائر|طلق|طلقات|خراطيش|رش|ساچمه|ساچمة)(?:\s|$)/u.test(value)
  if (hasWeaponNoun) scores.weapon += 5
  add("weapon", /\b(?:semi auto|pump action|blank pistol|air rifle|magazine feed shotgun|sniper rifle|assault rifle|automatic rifle|machine gun|submachine gun)\b/, 3)
  if (hasDefinitiveAmmunitionNoun) scores.ammunition += 9
  if (!hasWeaponNoun && /(?:^|\s)(?:رصاص)(?:\s|$)/u.test(value)) scores.ammunition += 5
  if (!hasWeaponNoun && /(?:^|\s)(?:خرطوش|خراطيش)(?:\s|$)/u.test(value)) scores.ammunition += 5
  add("accessory", /\b(?:case|cleaning (?:kit|set)|scope|grips?|zeroing apparatus|air rifle pump|spare tube|binoculars?|sling|holster|foot)\b/, 7)
  if (/(?:^|\s)(?:حافظه|حافظة|جراب|منظار|اكسسوار|ملحق|ملحقات|عده|عدة|تنظيف|حزام|قبضه|قبضة|مضخه|مضخة|قطع غيار)(?:\s|$)/u.test(value)) scores.accessory += 7
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
  const source = westernDigits(text(description)).replace(/[×✕]/g, "x")
  const normalized = fold(source)
  const blankWeapon = /\b(?:blank pistol|blank firing pistol|blank revolver|blank firing revolver|blank cartridge)\b/.test(normalized)
    || (/(?:^|\s)(?:مسدس(?:ات)?|طلق|طلقات|ذخيره|ذخائر|خراطيش)(?:\s|$)/u.test(normalized) && /(?:^|\s)(?:صوت|فشنك|خلبي)(?:\s|$)/u.test(normalized))
  if (/\b9\s*x\s*19(?:\s*mm)?\b/i.test(normalized)) return "9x19mm"
  if (/(?:^|\s)9\s*(?:mm|ملي|ملم|ميليمتر)(?:\s|$)/u.test(normalized)) return blankWeapon ? "9mm blank" : "9mm"
  const shotgunGauge = normalized.match(/(?:^|\s)(10|12|16|20|28|410)(?:\s|$)/)?.[1]
  if (shotgunGauge && (/\b(?:shotgun|pumpshotgun)\b/.test(normalized) || /(?:^|\s)(?:بندقيه|بنادق|خرطوش|خراطيش)(?:\s|$)/u.test(normalized))) return `${shotgunGauge} GA`
  const decimalMillimeter = source.match(/(?:^|\s)(4[.,]5|5[.,]5|5[.,]56|6[.,]35|6[.,]5|7[.,]62|7[.,]65)(?:\s*(?:mm|ملي|ملم|ميليمتر))?(?:\s|$)/iu)?.[1]
  if (decimalMillimeter) return `${decimalMillimeter.replace(",", ".")}mm`
  if (/\b(?:cal(?:iber)?\s*)?\.?(?:22)\s*(?:lr)?\b/i.test(normalized)) {
    if (/\blr\b/i.test(normalized)) return ".22 LR"
    return ".22"
  }
  if (/\b(?:cal(?:iber)?\s*)?\.?(?:177|4[.,]5)\b/i.test(normalized) && (/\bair (?:rifle|pistol)\b/.test(normalized) || /(?:^|\s)(?:هواء|هوائي|هوائيه)(?:\s|$)/u.test(normalized))) return ".177"
  if (/\b(?:cal(?:iber)?\s*)?\.?(?:25|6[.,]35)\b/i.test(normalized) && (/\bair (?:rifle|pistol)\b/.test(normalized) || /(?:^|\s)(?:هواء|هوائي|هوائيه)(?:\s|$)/u.test(normalized))) return ".25"
  const arabicNamedCaliber = normalized.match(/(?:^|\s)عيار\s+(177|223|308|357|380|45)(?:\s|$)/u)?.[1]
  if (arabicNamedCaliber) return ({ "177": ".177", "223": ".223 Rem", "308": ".308", "357": ".357", "380": ".380 ACP", "45": ".45 ACP" })[arabicNamedCaliber] ?? `.${arabicNamedCaliber}`
  const matches = source.match(/(?:\b9\s*mm\b|\b9\s*x\s*19(?:\s*mm)?\b|\b(?:10|12|16|20|28|410)\s*(?:ga|gauge)\b|\b(?:10|12|16|20|28)\s*\/\s*(?:65|70|71|76|89)\b|\.(?:177|22|308|357)\b|\.223(?:\s*rem)?\b|\.380(?:\s*acp)?\b|\.45(?:\s*acp)?\b|\b30-06\b)/i)
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

function declaredSectionTotal(value: string): number | null {
  const match = text(value).match(/^(?:total|subtotal|grand\s+total|المجموع|الاجمالي)\s*[:：-]?\s*([\d٠-٩۰-۹][\d٠-٩۰-۹.,]*)/iu)
  return match ? parseQuantity(match[1]) : null
}

export function inferWeaponType(description: string): string | null {
  const normalized = fold(description)
  const hasArabicPistol = /(?:^|\s)(?:مسدس(?:ات)?|طبنجه|طبنجة)(?:\s|$)/u.test(normalized)
  const hasArabicRifle = /(?:^|\s)(?:بندقيه|بنادق)(?:\s|$)/u.test(normalized)
  if (/\b(?:blank revolver|blank firing revolver)\b/.test(normalized) || (hasArabicPistol && /(?:^|\s)(?:صوت|فشنك|خلبي)(?:\s|$)/u.test(normalized) && /(?:^|\s)(?:دوار|بعجل|ريفولفر)(?:\s|$)/u.test(normalized))) return "Blank-Firing Revolver"
  if (/\b(?:blank pistol|blank firing pistol)\b/.test(normalized) || (hasArabicPistol && /(?:^|\s)(?:صوت|فشنك|خلبي)(?:\s|$)/u.test(normalized))) return "Blank-Firing Pistol"
  if (/\b(?:air pistol|pellet pistol)\b/.test(normalized) || (hasArabicPistol && /(?:^|\s)(?:هواء|هوائي|هوائيه)(?:\s|$)/u.test(normalized))) return "Air Pistol"
  if (/\b(?:air rifle|pellet rifle|bb rifle)\b/.test(normalized) || (hasArabicRifle && /(?:^|\s)(?:هواء|هوائي|هوائيه)(?:\s|$)/u.test(normalized))) return "Air Rifle"
  if (/\b(?:shotgun|pumpshotgun)\b/.test(normalized)
    || /(?:^|\s)(?:شوزن|خرطوش)(?:\s|$)/u.test(normalized)
    || (hasArabicRifle && /(?:^|\s)(?:10|12|16|20|28|410)(?:\s|$)/u.test(normalized))) return "Shotgun"
  if (/\b(?:sniper rifle|sniper)\b/.test(normalized) || /(?:^|\s)(?:قناصه|قناصة)(?:\s|$)/u.test(normalized) || (hasArabicRifle && /(?:^|\s)قنص(?:\s|$)/u.test(normalized))) return "Sniper Rifle"
  if (/\b(?:hunting rifle|sporting rifle)\b/.test(normalized) || (hasArabicRifle && /(?:^|\s)(?:صيد|صياد)(?:\s|$)/u.test(normalized))) return "Hunting Rifle"
  if (/\bsubmachine gun\b/.test(normalized) || (hasArabicPistol && /(?:^|\s)رشاش(?:\s|$)/u.test(normalized))) return "Submachine Gun"
  if (/\bmachine gun\b/.test(normalized) || /(?:^|\s)(?:مدفع رشاش|رشاش)(?:\s|$)/u.test(normalized)) return "Machine Gun"
  if (/\bassault rifle\b/.test(normalized) || (hasArabicRifle && /(?:^|\s)هجوميه(?:\s|$)/u.test(normalized))) return "Assault Rifle"
  if (/\bautomatic rifle\b/.test(normalized) || (hasArabicRifle && /(?:^|\s)(?:اليه|آلية)(?:\s|$)/u.test(normalized))) return "Automatic Rifle"
  if (/\bcarbine\b/.test(normalized) || /(?:^|\s)كاربين(?:\s|$)/u.test(normalized)) return "Carbine"
  if (/\bmusket\b/.test(normalized) || /(?:^|\s)(?:مسكيت|بندقيه فتيل)(?:\s|$)/u.test(normalized)) return "Musket"
  if (/\brevolver\b/.test(normalized) || /(?:^|\s)ريفولفر(?:\s|$)/u.test(normalized) || (hasArabicPistol && /(?:^|\s)(?:دوار|بعجل)(?:\s|$)/u.test(normalized))) return "Revolver"
  if (/\bderringer\b/.test(normalized)) return "Derringer"
  if (/\bflare (?:gun|pistol)\b/.test(normalized) || (hasArabicPistol && /(?:^|\s)(?:اشاره|اشارة)(?:\s|$)/u.test(normalized))) return "Flare Pistol"
  if (/\bpistol\b/.test(normalized) || hasArabicPistol) return "Pistol"
  if (/\brifle\b/.test(normalized) || hasArabicRifle) return "Rifle"
  if (/\bfirearm\b/.test(normalized) || /(?:^|\s)(?:سلاح|اسلحه)(?:\s|$)/u.test(normalized)) return "Firearm"
  return null
}

export interface WeaponMechanisms {
  subtype: string | null
  actionType: string | null
  feedingType: string | null
}

/** Keeps physical subtype, action, and feeding mechanism as separate facts. */
export function inferWeaponMechanisms(description: string): WeaponMechanisms {
  const normalized = fold(description)
  const semiAutomatic = /\b(?:semi magazine|semi auto(?:matic)?)\b/.test(normalized) || /(?:^|\s)نصف(?:\s+)(?:الي|اتوماتيك|اوتوماتيك)(?:\s|$)/u.test(normalized)
  const magazineFed = /\b(?:semi magazine|magazine (?:feed|fed|shotgun))\b/.test(normalized) || /(?:^|\s)(?:مخزن|مخزنيه)(?:\s|$)/u.test(normalized)
  const subtype = /\bover\s*(?:&|and)?\s*under\b/.test(normalized) || /(?:^|\s)(?:فوق تحت|سبطانتين فوق بعض)(?:\s|$)/u.test(normalized) ? "Over-and-Under"
    : /\bside by side\b/.test(normalized) || /(?:^|\s)(?:جنب الي جنب|سبطانتين جنب بعض)(?:\s|$)/u.test(normalized) ? "Side-by-Side"
      : /\bsingle barrel\b/.test(normalized) || /(?:^|\s)(?:سبطانه واحده|ماسوره واحده|مفرد)(?:\s|$)/u.test(normalized) ? "Single-Barrel"
        : /\bpcp\b/.test(normalized) || /(?:^|\s)بي\s*سي\s*بي(?:\s|$)/u.test(normalized) ? "PCP"
          : /\bfolding\b/.test(normalized) || /(?:^|\s)(?:قابل للطي|طي)(?:\s|$)/u.test(normalized) ? "Folding"
            : null
  const actionType = semiAutomatic ? "Semi-Automatic"
    : /\b(?:pump action|pumpshotgun|pump shotgun)\b/.test(normalized) ? "Pump-Action"
      : /\b(?:break action|break barrel)\b/.test(normalized) || /(?:^|\s)(?:كسر سبطانه|كسر ماسوره|نظام كسر)(?:\s|$)/u.test(normalized) ? "Break-Action"
        : /\bbolt action\b/.test(normalized) || /(?:^|\s)(?:ترباس|مزلاج)(?:\s|$)/u.test(normalized) ? "Bolt-Action"
          : /\blever action\b/.test(normalized) || /(?:^|\s)رافعة(?:\s|$)/u.test(normalized) ? "Lever-Action"
            : null
  return { subtype, actionType, feedingType: magazineFed ? "Magazine-Fed" : null }
}

/** Backward-compatible display helper for older review records. */
export function inferWeaponSubtype(description: string): string | null {
  const mechanisms = inferWeaponMechanisms(description)
  return mechanisms.subtype ?? mechanisms.actionType ?? mechanisms.feedingType
}

function canonicalWeaponTypeName(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  const aliases: Record<string, string> = {
    shotgun: "Shotgun",
    airrifle: "Air Rifle",
    blankpistol: "Blank-Firing Pistol",
    blankfiringpistol: "Blank-Firing Pistol",
    blankfiringrevolver: "Blank-Firing Revolver",
    airpistol: "Air Pistol",
    pistol: "Pistol",
    revolver: "Revolver",
    rifle: "Rifle",
    sniperrifle: "Sniper Rifle",
    huntingrifle: "Hunting Rifle",
    derringer: "Derringer",
    flarepistol: "Flare Pistol",
    carbine: "Carbine",
    assaultrifle: "Assault Rifle",
    automaticrifle: "Automatic Rifle",
    submachinegun: "Submachine Gun",
    machinegun: "Machine Gun",
    musket: "Musket",
    firearm: "Firearm",
  }
  return aliases[fold(value).replace(/\s/g, "")] ?? value.trim()
}

function canonicalCaliberSubtype(weaponType: string | null, caliber: string | null): string | null {
  if (!weaponType || !caliber) return null
  const normalizedCaliber = normalizeCaliber(caliber) ?? caliber.trim()
  if (weaponType === "Shotgun") {
    const gauge = normalizedCaliber.match(/^(10|12|16|20|28|410)\s*(?:GA|gauge)$/i)?.[1]
    return gauge ? `${gauge}-Gauge Shotgun` : null
  }
  if (weaponType === "Air Rifle" || weaponType === "Air Pistol") {
    if (/^\.(?:177|22|25)$/i.test(normalizedCaliber)) return `${normalizedCaliber}-Caliber ${weaponType}`
    return `${normalizedCaliber} ${weaponType}`
  }
  if (weaponType === "Blank-Firing Pistol" || weaponType === "Blank-Firing Revolver") {
    const blankCaliber = normalizedCaliber.replace(/\s+blank$/i, "").trim()
    return blankCaliber ? `${blankCaliber} ${weaponType}` : weaponType
  }
  return null
}

function isGenericCaliberCategory(category: string | null | undefined, caliber: string | null): boolean {
  if (!category?.trim()) return false
  const categoryKey = fold(category).replace(/\s/g, "")
  const caliberKey = fold(caliber).replace(/\s/g, "")
  return Boolean(caliberKey && (categoryKey === caliberKey || categoryKey === caliberKey.replace(/blank$/, "")))
}

function canonicalAmmunitionName(original: string, caliber: string | null): string {
  const normalized = fold(original)
  const normalizedCaliber = normalizeCaliber(caliber) ?? caliber?.trim() ?? null
  const isBlank = /\b(?:blank|blank cartridge)\b/.test(normalized) || /(?:^|\s)(?:صوت|فشنك|خلبي)(?:\s|$)/u.test(normalized)
  const isPellet = /\bpellets?\b/.test(normalized) || /(?:^|\s)(?:رش|ساچمه|ساچمة)(?:\s|$)/u.test(normalized)
  const isShotshell = /\b(?:shotshells?|shotgun shells?)\b/.test(normalized) || /(?:^|\s)(?:خرطوش|خراطيش)(?:\s|$)/u.test(normalized)
  if (isBlank) {
    const blankCaliber = normalizedCaliber?.replace(/\s+blank$/i, "").trim()
    return blankCaliber ? `${blankCaliber} Blank Cartridge` : "Blank Cartridge"
  }
  if (isPellet) return normalizedCaliber ? `${normalizedCaliber} Caliber Air Rifle Pellet` : "Air Rifle Pellet"
  if (isShotshell) {
    const gauge = normalizedCaliber?.match(/^(10|12|16|20|28|410)\s*(?:GA|gauge)$/i)?.[1]
    return gauge ? `${gauge}-Gauge Shotshell` : "Shotshell"
  }
  return ["Ammunition", normalizedCaliber].filter(Boolean).join(" ")
}

export function inferManufacturerAndModel(description: string): { manufacturer: string | null; model: string | null; manufacturerConfidence: number; modelConfidence: number } {
  const cleaned = text(description).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim()
  const folded = fold(cleaned)
  const arabicAliasMatch = ARABIC_MANUFACTURER_ALIASES.find(([alias]) => new RegExp(`(?:^|\\s)${fold(alias)}(?:\\s|$)`, "u").test(folded))
  const arabicManufacturer = arabicAliasMatch?.[1] ?? null
  const foldedCompact = folded.replace(/\s/g, "")
  const manufacturer = KNOWN_MANUFACTURERS.find((candidate) => folded.includes(fold(candidate)) || foldedCompact.includes(fold(candidate).replace(/\s/g, ""))) ?? arabicManufacturer
  if (!manufacturer) return { manufacturer: null, model: null, manufacturerConfidence: 0.15, modelConfidence: 0.15 }
  const tokens = cleaned.split(/\s+/)
  const foldedTokens = tokens.map(fold)
  const makerTokens = fold(manufacturer).split(" ")
  const makerCompact = makerTokens.join("")
  let makerStart = -1
  let makerTokenLength = makerTokens.length
  for (let start = 0; start < foldedTokens.length && makerStart < 0; start++) {
    let candidate = ""
    for (let end = start; end < Math.min(foldedTokens.length, start + makerTokens.length + 2); end++) {
      candidate += foldedTokens[end]
      if (candidate === makerCompact) {
        makerStart = start
        makerTokenLength = end - start + 1
        break
      }
      if (candidate.length > makerCompact.length) break
    }
  }
  const arabicAliasTokens = arabicAliasMatch?.[1] === manufacturer ? arabicAliasMatch[0] : null
  const aliasTokens = arabicAliasTokens ? fold(arabicAliasTokens).split(" ") : []
  const aliasStart = aliasTokens.length ? foldedTokens.findIndex((_, index) => aliasTokens.every((token, offset) => foldedTokens[index + offset] === token)) : -1
  const withoutMaker = tokens.filter((_, index) => {
    const outsideEnglishMaker = makerStart < 0 || index < makerStart || index >= makerStart + makerTokenLength
    const outsideArabicMaker = aliasStart < 0 || index < aliasStart || index >= aliasStart + aliasTokens.length
    return outsideEnglishMaker && outsideArabicMaker
  })
  const modelTokens = withoutMaker.filter((token, index, source) => {
    const normalized = fold(token)
    if (!normalized || GENERIC_MODEL_WORDS.has(normalized) || inferCaliber(token)) return false
    if (/^(?:semi|auto|automatic|pump|action|feed|fed|break|barrel|pcp|folding)$/.test(normalized)) return false
    if (/^\d+(?:[-/+,.]\d+)+$/.test(text(token)) || /^\d+(?:\s+\d+)+$/.test(normalized)) return false
    if (/^\d+$/.test(normalized)) {
      const previous = fold(source[index - 1] ?? "")
      const next = fold(source[index + 1] ?? "")
      return previous === "mod" || !["ga", "gauge", "mm"].includes(next)
    }
    return true
  })
  const model = modelTokens.slice(0, 4).join(" ") || null
  return { manufacturer, model, manufacturerConfidence: 0.92, modelConfidence: model ? 0.72 : 0.15 }
}

function canonicalProductName(values: {
  original: string
  productType: ManifestProductType | null
  weaponType: string | null
  category: string | null
  manufacturer: string | null
  model: string | null
  caliber: string | null
}): string {
  if (!containsArabic(values.original)) return values.original
  if (values.productType === "weapon") {
    const classification = values.category ?? values.weaponType
    const caliberKey = fold(values.caliber).replace(/(?:^|\s)blank(?:\s|$)/g, " ").replace(/\s+/g, " ").trim()
    const caliber = classification && caliberKey && fold(classification).includes(caliberKey) ? null : values.caliber
    const parts = [values.manufacturer, values.model, classification, caliber].filter((value): value is string => Boolean(value?.trim()))
    return [...new Set(parts)].join(" ") || "Weapon"
  }
  const normalized = fold(values.original)
  if (values.productType === "ammunition") return canonicalAmmunitionName(values.original, values.caliber)
  const accessory = [
    [/(?:^|\s)(?:جراب|حافظه|حافظة)(?:\s|$)/u, "Weapon case"],
    [/(?:^|\s)(?:منظار)(?:\s|$)/u, "Scope"],
    [/(?:^|\s)(?:عده|عدة)\s+تنظيف(?:\s|$)/u, "Cleaning kit"],
    [/(?:^|\s)(?:مضخه|مضخة)(?:\s|$)/u, "Air rifle pump"],
    [/(?:^|\s)(?:مخزن|خزنه|خزنة)(?:\s|$)/u, "Magazine"],
    [/(?:^|\s)(?:حزام)(?:\s|$)/u, "Sling"],
    [/(?:^|\s)(?:قبضه|قبضة)(?:\s|$)/u, "Grip"],
    [/(?:^|\s)(?:قطع غيار)(?:\s|$)/u, "Spare parts"],
  ] as const
  const translated = accessory.find(([pattern]) => pattern.test(normalized))?.[1]
  return translated ?? (values.productType === "accessory" ? "Accessory" : "Product")
}

function canonicalManufacturerName(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  const normalized = fold(value)
  return ARABIC_MANUFACTURER_ALIASES.find(([alias]) => new RegExp(`(?:^|\\s)${fold(alias)}(?:\\s|$)`, "u").test(normalized))?.[1]
    ?? KNOWN_MANUFACTURERS.find((candidate) => normalized === fold(candidate) || normalized.includes(fold(candidate)))
    ?? value.trim()
}

export function canonicalizeExtractedProductFields(input: {
  productName: string
  productType?: ManifestProductType | null
  weaponType?: string | null
  category?: string | null
  manufacturer?: string | null
  model?: string | null
  caliber?: string | null
}): {
  productName: string
  productType: ManifestProductType | null
  weaponType: string | null
  category: string | null
  manufacturer: string | null
  model: string | null
  caliber: string | null
  actionType: string | null
  feedingType: string | null
  translated: boolean
} {
  const semanticSource = [input.productName, input.weaponType, input.category, input.manufacturer, input.model, input.caliber].filter(Boolean).join(" ")
  const productType = input.productType ?? inferProductType(semanticSource)
  const inferredWeaponType = productType === "weapon" ? inferWeaponType(semanticSource) : null
  const weaponType = canonicalWeaponTypeName(containsArabic(input.weaponType) ? inferredWeaponType : input.weaponType ?? inferredWeaponType)
  const identity = inferManufacturerAndModel(input.productName)
  const manufacturer = canonicalManufacturerName(input.manufacturer) ?? identity.manufacturer
  const model = containsArabic(input.model) ? identity.model : input.model ?? identity.model
  const inferredCaliber = inferCaliber(semanticSource)
  const explicitCaliber = containsArabic(input.caliber) ? inferredCaliber : input.caliber
  const caliber = productType === "weapon" && weaponType === "Blank-Firing Pistol" && (input.caliber === "9mm" || inferredCaliber === "9mm")
    ? "9mm blank"
    : explicitCaliber ?? inferredCaliber
  const mechanisms = productType === "weapon" ? inferWeaponMechanisms(semanticSource) : { subtype: null, actionType: null, feedingType: null }
  const caliberSubtype = productType === "weapon" ? canonicalCaliberSubtype(weaponType, caliber) : null
  const inferredCategory = caliberSubtype ?? mechanisms.subtype
  const categoryIsMechanism = [mechanisms.actionType, mechanisms.feedingType].some((value) => value && fold(value) === fold(input.category))
  const explicitCategory = containsArabic(input.category) || isGenericCaliberCategory(input.category, caliber) || categoryIsMechanism ? null : input.category
  const category = caliberSubtype ?? explicitCategory ?? inferredCategory
  const productName = canonicalProductName({ original: input.productName, productType, weaponType, category, manufacturer, model, caliber })
  return { productName, productType, weaponType, category, manufacturer, model, caliber, actionType: mechanisms.actionType, feedingType: mechanisms.feedingType, translated: productName !== input.productName }
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
  const tables: DocumentTable[] = []
  const textParts: string[] = []
  for (const [sheetIndex, name] of workbook.SheetNames.entries()) {
    const sheet = workbook.Sheets[name]
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: false, blankrows: true })
    const hidden = Boolean(workbook.Workbook?.Sheets?.[sheetIndex]?.Hidden)
    const mergedRanges = (sheet["!merges"] ?? []).map((range) => XLSX.utils.encode_range(range))
    const rows = matrix.map((row, rowIndex) => ({
      row: rowIndex + 1,
      cells: row.map((value, index) => ({ column: columnName(index), value: value as string | number | boolean })).filter((cell) => text(cell.value) !== ""),
    })).filter((row) => row.cells.length > 0)
    sheets.push({ name, hidden, mergedRanges, rows })
    tables.push({
      id: `sheet-${sheetIndex + 1}`,
      name,
      sheet: name,
      hidden,
      mergedRanges,
      rows: rows.map((row) => ({
        row: row.row,
        cells: row.cells.map((cell) => {
          const originalText = String(cell.value)
          const normalizedText = text(cell.value)
          return {
            column: cell.column,
            originalText,
            normalizedText,
            evidence: {
              originalText,
              normalizedText,
              method: "spreadsheet-cell" as const,
              confidence: 0.99,
              location: { sheet: name, table: sheetIndex + 1, row: row.row, column: cell.column },
            },
          }
        }),
      })),
    })
    textParts.push(`# Sheet: ${name}${hidden ? " [hidden]" : ""}`)
    for (const row of rows) textParts.push(`${row.row}\t${row.cells.map((cell) => `${cell.column}:${text(cell.value)}`).join("\t")}`)
  }
  const document: NormalizedManifestDocument = {
    format: isZip ? "xlsx" : isOle ? "xls" : "csv",
    tables,
    paragraphs: [],
    headers: [],
    footers: [],
    textboxes: [],
    images: [],
    warnings: [],
    structureQuality: "structured",
    requiresVisualAnalysis: false,
  }
  return {
    kind: "spreadsheet",
    sheets,
    text: textParts.join("\n"),
    raw: {
      format: document.format,
      sheetCount: sheets.length,
      sheets: sheets.map(({ name, hidden, mergedRanges, rows }) => ({ name, hidden, mergedRanges, rowCount: rows.length })),
    },
    document,
  }
}

function cleanWordText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u000B\u000C\u2028\u2029]/g, "\n")
    .replace(/\u0007/g, "\t")
    .replace(/\u0000/g, "")
    .normalize("NFKC")
}

const MAX_DOCX_ENTRIES = 5_000
const MAX_DOCX_UNCOMPRESSED_BYTES = 120 * 1024 * 1024

function assertSafeDocxArchive(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index--) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocd = index
      break
    }
  }
  if (eocd < 0) throw new Error("The DOCX archive is missing its directory")
  const entryCount = view.getUint16(eocd + 10, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  if (entryCount === 0xffff || entryCount > MAX_DOCX_ENTRIES) throw new Error("The DOCX archive contains too many files")
  let offset = centralOffset
  let totalUncompressed = 0
  for (let entry = 0; entry < entryCount; entry++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new Error("The DOCX archive directory is invalid")
    const flags = view.getUint16(offset + 8, true)
    if ((flags & 1) !== 0) throw new Error("Encrypted DOCX files are not supported")
    totalUncompressed += view.getUint32(offset + 24, true)
    if (totalUncompressed > MAX_DOCX_UNCOMPRESSED_BYTES) throw new Error("The DOCX archive expands beyond the safe extraction limit")
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
  }
}

function xmlLocalName(node: any): string {
  return String(node?.localName || node?.nodeName || "").split(":").pop() ?? ""
}

function xmlChildren(node: any, localName?: string): any[] {
  const result: any[] = []
  for (let child = node?.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && (!localName || xmlLocalName(child) === localName)) result.push(child)
  }
  return result
}

function xmlDescendants(node: any, localName: string): any[] {
  const result: any[] = []
  const visit = (current: any) => {
    for (let child = current?.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) continue
      if (xmlLocalName(child) === localName) result.push(child)
      visit(child)
    }
  }
  visit(node)
  return result
}

function xmlAttribute(node: any, name: string): string | null {
  return node?.getAttribute?.(name) ?? node?.getAttribute?.(`w:${name}`) ?? node?.getAttribute?.(`r:${name}`) ?? null
}

function wordNodeText(node: any, skipTextboxes = true): string {
  const parts: string[] = []
  const visit = (current: any) => {
    const name = xmlLocalName(current)
    if (skipTextboxes && name === "txbxContent") return
    if (name === "t" || name === "instrText" || name === "delText") parts.push(current.textContent ?? "")
    else if (name === "tab") parts.push("\t")
    else if (name === "br" || name === "cr") parts.push("\n")
    else for (let child = current?.firstChild; child; child = child.nextSibling) if (child.nodeType === 1) visit(child)
  }
  visit(node)
  return cleanWordText(parts.join(""))
    .replace(/[ ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/ *\t */g, "\t")
    .trim()
}

function parseXml(bytes: Uint8Array, path: string): any {
  const parsed = new DOMParser().parseFromString(strFromU8(bytes), "application/xml")
  if (!parsed?.documentElement || xmlLocalName(parsed.documentElement) === "parsererror" || parsed.getElementsByTagName?.("parsererror")?.length) {
    throw new Error(`The DOCX XML part is invalid: ${path}`)
  }
  return parsed
}

function paragraphStyle(node: any): string | undefined {
  const styleNode = xmlDescendants(xmlChildren(node, "pPr")[0], "pStyle")[0]
  return xmlAttribute(styleNode, "val") ?? undefined
}

function documentParagraph(value: string, method: "docx-xml" | "legacy-word-text", location: DocumentParagraph["location"], style?: string): DocumentParagraph {
  const normalizedText = text(value)
  return {
    text: value,
    normalizedText,
    location,
    style,
    evidence: { originalText: value, normalizedText, method, confidence: method === "docx-xml" ? 0.98 : 0.82, location },
  }
}

function parseDocxTable(node: any, tableIndex: number, name: string, section: string): DocumentTable {
  const rows = xmlChildren(node, "tr").map((rowNode, rowIndex) => {
    let columnIndexValue = 0
    const cells = xmlChildren(rowNode, "tc").map((cellNode) => {
      const column = columnName(columnIndexValue)
      const columnSpan = Math.max(1, Number(xmlAttribute(xmlDescendants(cellNode, "gridSpan")[0], "val") ?? 1) || 1)
      const mergeNode = xmlDescendants(cellNode, "vMerge")[0]
      const mergeValue = mergeNode ? xmlAttribute(mergeNode, "val") : null
      const verticalMerge = mergeNode ? (mergeValue === "restart" ? "restart" as const : "continue" as const) : undefined
      const originalText = wordNodeText(cellNode)
      const normalizedText = text(originalText)
      const location = { section, table: tableIndex, row: rowIndex + 1, column }
      columnIndexValue += columnSpan
      return {
        column,
        originalText,
        normalizedText,
        columnSpan,
        verticalMerge,
        evidence: { originalText, normalizedText, method: "docx-xml" as const, confidence: 0.98, location },
      }
    }).filter((cell) => cell.normalizedText || cell.verticalMerge)
    return { row: rowIndex + 1, cells }
  }).filter((row) => row.cells.length > 0)
  return { id: `docx-${section}-table-${tableIndex}`, name, rows }
}

function mediaMimeType(path: string): string {
  const extension = path.toLowerCase().split(".").pop()
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", emf: "image/emf", wmf: "image/wmf", svg: "image/svg+xml" } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream"
}

/** Conservatively carves raw PNG/JPEG payloads that Word stores inside some OLE .doc streams. */
export function extractLegacyWordImages(bytes: Uint8Array): DocumentImage[] {
  const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const pngStart = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const pngEnd = Buffer.from([0x49, 0x45, 0x4e, 0x44])
  const jpegStart = Buffer.from([0xff, 0xd8, 0xff])
  const jpegEnd = Buffer.from([0xff, 0xd9])
  const images: DocumentImage[] = []
  let offset = 0
  let forwardedBytes = 0
  while (offset < source.length && images.length < 8) {
    const pngIndex = source.indexOf(pngStart, offset)
    const jpegIndex = source.indexOf(jpegStart, offset)
    const candidates = [
      pngIndex >= 0 ? { start: pngIndex, mimeType: "image/png", extension: "png" } : null,
      jpegIndex >= 0 ? { start: jpegIndex, mimeType: "image/jpeg", extension: "jpg" } : null,
    ].filter((candidate): candidate is { start: number; mimeType: string; extension: string } => candidate != null)
      .sort((left, right) => left.start - right.start)
    const candidate = candidates[0]
    if (!candidate) break
    let end = -1
    if (candidate.mimeType === "image/png") {
      const marker = source.indexOf(pngEnd, candidate.start + pngStart.length)
      if (marker >= 0 && marker + 8 <= source.length) end = marker + 8
    } else {
      const marker = source.indexOf(jpegEnd, candidate.start + jpegStart.length)
      if (marker >= 0) end = marker + jpegEnd.length
    }
    if (end <= candidate.start) {
      offset = candidate.start + 1
      continue
    }
    const imageBytes = source.subarray(candidate.start, end)
    const canForward = imageBytes.length <= 15 * 1024 * 1024 && forwardedBytes + imageBytes.length <= 35 * 1024 * 1024
    if (canForward) forwardedBytes += imageBytes.length
    images.push({
      id: `legacy-doc-image-${images.length + 1}`,
      fileName: `embedded-${images.length + 1}.${candidate.extension}`,
      mimeType: candidate.mimeType,
      byteLength: imageBytes.length,
      relationshipIds: [],
      dataBase64: canForward ? imageBytes.toString("base64") : undefined,
    })
    offset = end
  }
  return images
}

function normalizeRelationshipTarget(target: string): string {
  const normalized = target.replace(/\\/g, "/").replace(/^\/+/, "")
  return normalized.startsWith("word/") ? normalized : `word/${normalized.replace(/^(\.\.\/)+/, "")}`
}

function imageContexts(xmlDocuments: any[], relationshipTargets: Map<string, string>): Map<string, { relationshipIds: string[]; contexts: string[] }> {
  const result = new Map<string, { relationshipIds: string[]; contexts: string[] }>()
  for (const xml of xmlDocuments) {
    for (const blip of xmlDescendants(xml, "blip")) {
      const relationshipId = xmlAttribute(blip, "embed")
      const target = relationshipId ? relationshipTargets.get(relationshipId) : null
      if (!target || !relationshipId) continue
      let ancestor = blip.parentNode
      while (ancestor && xmlLocalName(ancestor) !== "p") ancestor = ancestor.parentNode
      const context = ancestor ? wordNodeText(ancestor, false) : ""
      const current = result.get(target) ?? { relationshipIds: [], contexts: [] }
      if (!current.relationshipIds.includes(relationshipId)) current.relationshipIds.push(relationshipId)
      if (context && !current.contexts.includes(context)) current.contexts.push(context)
      result.set(target, current)
    }
  }
  return result
}

function nativeDocxExtraction(bytes: Uint8Array): NativeExtraction {
  assertSafeDocxArchive(bytes)
  const archive = unzipSync(bytes)
  const documentBytes = archive["word/document.xml"]
  if (!documentBytes) throw new Error("The DOCX file does not contain word/document.xml")
  const mainXml = parseXml(documentBytes, "word/document.xml")
  const body = xmlDescendants(mainXml, "body")[0]
  if (!body) throw new Error("The DOCX document body is missing")

  const tables: DocumentTable[] = []
  const paragraphs: DocumentParagraph[] = []
  const headers: DocumentParagraph[] = []
  const footers: DocumentParagraph[] = []
  const textboxes: DocumentParagraph[] = []
  const sheets: NativeSheet[] = []
  const textParts: string[] = ["# DOCX document body"]
  let paragraphIndex = 0
  let tableIndex = 0

  for (const block of xmlChildren(body)) {
    if (xmlLocalName(block) === "p") {
      const value = wordNodeText(block)
      if (!value) continue
      paragraphIndex++
      paragraphs.push(documentParagraph(value, "docx-xml", { section: "body", paragraph: paragraphIndex }, paragraphStyle(block)))
      textParts.push(`P${paragraphIndex}\t${value}`)
    } else if (xmlLocalName(block) === "tbl") {
      tableIndex++
      const table = parseDocxTable(block, tableIndex, `Word table ${tableIndex}`, "body")
      tables.push(table)
      textParts.push(`# Table: ${table.name}`)
      for (const row of table.rows) textParts.push(`${row.row}\t${row.cells.map((cell) => `${cell.column}:${cell.normalizedText}`).join("\t")}`)
      sheets.push({
        name: table.name,
        rows: table.rows.map((row) => ({
          row: row.row,
          cells: row.cells.map((cell) => ({ column: cell.column, value: cell.originalText, columnSpan: cell.columnSpan, verticalMerge: cell.verticalMerge })),
        })),
      })
    }
  }

  if (paragraphs.length > 0) {
    sheets.push({
      name: "Word paragraphs",
      rows: paragraphs.map((paragraph, index) => ({
        row: index + 1,
        cells: paragraph.text.split(/\t+/).map((value, cellIndex) => ({ column: columnName(cellIndex), value: text(value) })).filter((cell) => cell.value),
      })).filter((row) => row.cells.length > 0),
    })
  }

  const supplementalXml: Array<{ path: string; section: "header" | "footer" | "footnote" | "endnote"; xml: any }> = []
  for (const [path, partBytes] of Object.entries(archive).sort(([left], [right]) => left.localeCompare(right))) {
    const match = /^word\/(header\d+|footer\d+|footnotes|endnotes)\.xml$/i.exec(path)
    if (!match) continue
    const section = match[1].startsWith("header") ? "header" : match[1].startsWith("footer") ? "footer" : match[1] === "footnotes" ? "footnote" : "endnote"
    const xml = parseXml(partBytes, path)
    supplementalXml.push({ path, section, xml })
    const destination = section === "header" ? headers : section === "footer" ? footers : paragraphs
    for (const paragraphNode of xmlDescendants(xml, "p")) {
      const value = wordNodeText(paragraphNode)
      if (!value) continue
      destination.push(documentParagraph(value, "docx-xml", { section, paragraph: destination.length + 1 }, paragraphStyle(paragraphNode)))
      textParts.push(`# ${section} paragraph\n${value}`)
    }
    for (const tableNode of xmlDescendants(xml, "tbl")) {
      tableIndex++
      const table = parseDocxTable(tableNode, tableIndex, `${section} table ${tableIndex}`, section)
      tables.push(table)
      textParts.push(`# Table: ${table.name}`)
      for (const row of table.rows) textParts.push(`${row.row}\t${row.cells.map((cell) => `${cell.column}:${cell.normalizedText}`).join("\t")}`)
      sheets.push({
        name: table.name,
        rows: table.rows.map((row) => ({
          row: row.row,
          cells: row.cells.map((cell) => ({ column: cell.column, value: cell.originalText, columnSpan: cell.columnSpan, verticalMerge: cell.verticalMerge })),
        })),
      })
    }
  }

  for (const xml of [mainXml, ...supplementalXml.map((part) => part.xml)]) {
    for (const [textboxIndex, textbox] of xmlDescendants(xml, "txbxContent").entries()) {
      for (const paragraphNode of xmlDescendants(textbox, "p")) {
        const value = wordNodeText(paragraphNode, false)
        if (value) {
          textboxes.push(documentParagraph(value, "docx-xml", { section: "textbox", paragraph: textboxIndex + 1 }, paragraphStyle(paragraphNode)))
          textParts.push(`# Textbox\n${value}`)
        }
      }
    }
  }

  const relationshipTargets = new Map<string, string>()
  for (const [path, partBytes] of Object.entries(archive)) {
    if (!/^word\/_rels\/.+\.rels$/i.test(path)) continue
    const xml = parseXml(partBytes, path)
    for (const relationship of xmlDescendants(xml, "Relationship")) {
      const id = xmlAttribute(relationship, "Id")
      const target = xmlAttribute(relationship, "Target")
      if (id && target && !/^https?:/i.test(target)) relationshipTargets.set(id, normalizeRelationshipTarget(target))
    }
  }
  const contexts = imageContexts([mainXml, ...supplementalXml.map((part) => part.xml)], relationshipTargets)
  let visualPayloadBytes = 0
  let visualPayloadCount = 0
  const images = Object.entries(archive)
    .filter(([path]) => /^word\/media\//i.test(path))
    .map(([path, imageBytes], index) => {
      const mimeType = mediaMimeType(path)
      const canForward = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mimeType)
        && imageBytes.length <= 15 * 1024 * 1024
        && visualPayloadBytes + imageBytes.length <= 35 * 1024 * 1024
        && visualPayloadCount < 8
      if (canForward) {
        visualPayloadBytes += imageBytes.length
        visualPayloadCount++
      }
      return {
        id: `docx-image-${index + 1}`,
        fileName: path.split("/").pop() ?? path,
        mimeType,
        byteLength: imageBytes.length,
        relationshipIds: contexts.get(path)?.relationshipIds ?? [],
        contextText: contexts.get(path)?.contexts.join(" | ") || undefined,
        dataBase64: canForward ? Buffer.from(imageBytes).toString("base64") : undefined,
      }
    })

  const extractedText = textParts.join("\n")
  if (!extractedText.trim() && images.length === 0) throw new Error("The Word document does not contain readable text or images")
  if (extractedText.length > MAX_EXTRACTED_DOCUMENT_CHARACTERS) throw new Error("The Word document contains too much extracted text")
  const warnings = images.length > 0 ? ["Embedded images require visual analysis for complete extraction."] : []
  if (images.some((image) => !image.dataBase64)) warnings.push("Some embedded images could not be forwarded because of their format, size, or the visual payload limit.")
  const document: NormalizedManifestDocument = {
    format: "docx",
    tables,
    paragraphs,
    headers,
    footers,
    textboxes,
    images,
    warnings,
    structureQuality: "structured",
    requiresVisualAnalysis: images.length > 0,
  }
  return {
    kind: "document",
    sheets,
    text: extractedText,
    raw: {
      format: "docx",
      characterCount: extractedText.length,
      paragraphCount: paragraphs.length,
      tableCount: tables.length,
      headerCount: headers.length,
      footerCount: footers.length,
      textboxCount: textboxes.length,
      images: images.map(({ id, fileName, mimeType, byteLength, relationshipIds, contextText }) => ({ id, fileName, mimeType, byteLength, relationshipIds, contextText })),
      warnings,
    },
    document,
  }
}

/** Converts extracted Word text into row/cell evidence without assuming a fixed table schema. */
export function nativeWordExtractionFromText(bodyValue: string, supplemental: Record<string, string> = {}): NativeExtraction {
  const body = cleanWordText(bodyValue)
  if (!body.trim()) throw new Error("The Word document does not contain readable text")
  if (body.length > MAX_EXTRACTED_DOCUMENT_CHARACTERS) throw new Error("The Word document contains too much extracted text")

  const rows: NativeSheet["rows"] = []
  const lines = body.split("\n")
  for (const [lineIndex, lineValue] of lines.entries()) {
    const cells = lineValue
      .split(/\t+/)
      .map((value) => text(value))
      .filter(Boolean)
      .map((value, column) => ({ column: columnName(column), value }))
    if (cells.length > 0) rows.push({ row: lineIndex + 1, cells })
  }

  const supplementalSections = Object.entries(supplemental)
    .map(([name, value]) => [name, cleanWordText(value).trim()] as const)
    .filter(([, value]) => value && !body.includes(value))
  const extractedCharacterCount = body.length + supplementalSections.reduce((sum, [, value]) => sum + value.length, 0)
  if (extractedCharacterCount > MAX_EXTRACTED_DOCUMENT_CHARACTERS) throw new Error("The Word document contains too much extracted text")
  const textParts = ["# Word document body", body.trim()]
  for (const [name, value] of supplementalSections) textParts.push(`\n# Word document ${name}\n${value}`)
  const paragraphs = lines
    .map((value, index) => ({ value: text(value), index }))
    .filter(({ value }) => value)
    .map(({ value, index }) => documentParagraph(value, "legacy-word-text", { section: "body", paragraph: index + 1 }))
  const document: NormalizedManifestDocument = {
    format: "doc",
    tables: [],
    paragraphs,
    headers: supplementalSections.filter(([name]) => name === "headers").flatMap(([, value]) => value.split("\n").map((line, index) => documentParagraph(text(line), "legacy-word-text", { section: "header", paragraph: index + 1 })).filter((paragraph) => paragraph.text)),
    footers: supplementalSections.filter(([name]) => name === "footers").flatMap(([, value]) => value.split("\n").map((line, index) => documentParagraph(text(line), "legacy-word-text", { section: "footer", paragraph: index + 1 })).filter((paragraph) => paragraph.text)),
    textboxes: supplementalSections.filter(([name]) => name === "textboxes").flatMap(([, value]) => value.split("\n").map((line, index) => documentParagraph(text(line), "legacy-word-text", { section: "textbox", paragraph: index + 1 })).filter((paragraph) => paragraph.text)),
    images: [],
    warnings: ["Legacy DOC extraction preserves text but cannot guarantee recovery of embedded images or original table geometry."],
    structureQuality: "legacy-text",
    requiresVisualAnalysis: false,
  }
  return {
    kind: "document",
    sheets: [{ name: "Word document", rows }],
    text: textParts.join("\n"),
    raw: {
      format: "word",
      characterCount: body.length,
      lineCount: lines.length,
      body,
      supplemental: Object.fromEntries(supplementalSections),
      warnings: document.warnings,
    },
    document,
  }
}

export async function parseWordDocumentBuffer(bytes: Uint8Array): Promise<NativeExtraction> {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      return nativeDocxExtraction(bytes)
    } catch (error) {
      if (error instanceof Error && /DOCX|Word document/.test(error.message)) throw error
      throw new Error("Unable to read the DOCX document. It may be encrypted, corrupted, or use an unsupported structure.")
    }
  }
  try {
    const { default: WordExtractor } = await import("word-extractor")
    const document = await new WordExtractor().extract(Buffer.from(bytes))
    const extraction = nativeWordExtractionFromText(document.getBody(), {
      headers: document.getHeaders(),
      footers: document.getFooters(),
      footnotes: document.getFootnotes(),
      endnotes: document.getEndnotes(),
      annotations: document.getAnnotations(),
      textboxes: document.getTextboxes(),
    })
    const images = extractLegacyWordImages(bytes)
    if (images.length > 0 && extraction.document) {
      extraction.document.images = images
      extraction.document.requiresVisualAnalysis = true
      extraction.document.warnings.push("Raw PNG/JPEG payloads were recovered from the legacy DOC and require visual analysis.")
      extraction.raw.images = images.map(({ id, fileName, mimeType, byteLength }) => ({ id, fileName, mimeType, byteLength }))
      extraction.raw.warnings = extraction.document.warnings
    }
    return extraction
  } catch (error) {
    if (error instanceof Error && /does not contain readable text|too much extracted text/.test(error.message)) throw error
    throw new Error("Unable to read the Word document. It may be encrypted, corrupted, or use an unsupported legacy format.")
  }
}

type ParserWorkerFormat = "spreadsheet" | "word"

function parseBufferInWorker(bytes: Uint8Array, format: ParserWorkerFormat): Promise<NativeExtraction> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./manifest-parser-worker.js", import.meta.url), {
      workerData: { format, bytes: Buffer.from(bytes) },
    })
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      callback()
      void worker.terminate()
    }
    timer = setTimeout(() => finish(() => reject(new Error(`${format === "word" ? "Word document" : "Spreadsheet"} parsing timed out`))), MANIFEST_PARSE_TIMEOUT_MS)
    worker.once("message", (message: { ok: true; extraction: NativeExtraction } | { ok: false; error: string }) => {
      finish(() => message.ok ? resolve(message.extraction) : reject(new Error(message.error)))
    })
    worker.once("error", (error) => finish(() => reject(error)))
    worker.once("exit", (code) => { if (!settled) finish(() => reject(new Error(`${format === "word" ? "Word document" : "Spreadsheet"} parser worker stopped with exit code ${code}`))) })
  })
}

export function parseSpreadsheetBufferAsync(bytes: Uint8Array): Promise<NativeExtraction> {
  return parseBufferInWorker(bytes, "spreadsheet")
}

export function parseWordDocumentBufferAsync(bytes: Uint8Array): Promise<NativeExtraction> {
  return parseBufferInWorker(bytes, "word")
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
            category: productType === "weapon" ? inferWeaponSubtype(productName) : null,
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
        } else if (active && allSerials.length === 0 && allText.some((value) => /^(?:total|subtotal|grand total|المجموع|الاجمالي)/i.test(fold(value)))) {
          const declaredTotal = allText.map(declaredSectionTotal).find((value): value is number => value != null) ?? null
          if (declaredTotal != null) {
            const extractionMeta = active.rawData._extraction as Record<string, unknown> | undefined
            const serialCount = active.serialNumbers.length
            active.quantity = declaredTotal
            active.confidence.quantity = 0.99
            if (extractionMeta) {
              extractionMeta.quantityOrigin = "section-total"
              extractionMeta.totalValidation = { declaredTotal, serialCount, matches: serialCount === 0 || declaredTotal === serialCount, row: sourceRow }
            }
          }
          active = null
        } else if (allSerials.length === 0 && allText.some((value) => /^(?:notes?|ملاحظات)/i.test(fold(value)))) {
          active = null
        }
      }
    }
  }
  return result.filter((item) => item.productName || item.serialNumbers.length > 0)
}
