import { normalizeCaliber, normalizeSerial } from "../../src/lib/shipment-manifest.js"
import type { ParsedManifestItem } from "./manifest-parser.js"

const SEMANTIC_FIELDS = [
  "productType", "productName", "category", "weaponType", "manufacturer", "model", "caliber",
  "sku", "productCode", "quantity", "unitPrice", "totalPrice", "currency", "countryOfOrigin",
] as const satisfies ReadonlyArray<keyof ParsedManifestItem>

type SemanticField = typeof SEMANTIC_FIELDS[number]

function identity(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .toLocaleLowerCase("en")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
}

function serialSet(item: ParsedManifestItem): Set<string> {
  return new Set(item.serialNumbers.map(normalizeSerial).filter(Boolean))
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) if (right.has(value)) return true
  return false
}

function fieldEvidence(item: ParsedManifestItem, field: string): boolean {
  const extraction = item.rawData._extraction as { evidence?: Array<{ field?: string; method?: string }> } | undefined
  return Boolean(extraction?.evidence?.some((entry) => entry.field === field && entry.method !== "ai"))
}

function matchScore(nativeItem: ParsedManifestItem, aiItem: ParsedManifestItem): number {
  const nativeSerials = serialSet(nativeItem)
  const aiSerials = serialSet(aiItem)
  if (nativeSerials.size > 0 && aiSerials.size > 0) return intersects(nativeSerials, aiSerials) ? 140 : Number.NEGATIVE_INFINITY

  const sameSheet = identity(nativeItem.source.sheet) && identity(nativeItem.source.sheet) === identity(aiItem.source.sheet)
  const sameRow = sameSheet && nativeItem.source.row != null && nativeItem.source.row === aiItem.source.row
  if (sameRow) return 125
  if (identity(nativeItem.productCode) && identity(nativeItem.productCode) === identity(aiItem.productCode)) return 115
  if (identity(nativeItem.sku) && identity(nativeItem.sku) === identity(aiItem.sku)) return 110

  let score = 0
  const compare = (field: keyof ParsedManifestItem, weight: number, conflictPenalty = weight) => {
    const left = identity(nativeItem[field])
    const right = identity(aiItem[field])
    if (left && right) score += left === right ? weight : -conflictPenalty
  }
  compare("manufacturer", 24, 30)
  compare("model", 34, 42)
  compare("caliber", 20, 28)
  compare("weaponType", 14, 18)
  compare("productType", 8, 12)
  compare("productName", 32, 8)
  if (sameSheet && nativeItem.source.row != null && aiItem.source.row != null) {
    const distance = Math.abs(nativeItem.source.row - aiItem.source.row)
    if (distance <= 2) score += 18 - distance * 5
  }
  return score
}

function normalizedComparable(field: SemanticField, value: unknown): unknown {
  if (field === "caliber") return normalizeCaliber(typeof value === "string" ? value : null)
  if (typeof value === "string") return identity(value)
  return value
}

function hasValue(value: unknown): boolean {
  return value != null && value !== ""
}

function chooseField(nativeItem: ParsedManifestItem, aiItem: ParsedManifestItem, field: SemanticField): { value: unknown; confidence: number | undefined; chosen: "native" | "ai"; conflict?: Record<string, unknown> } {
  const nativeValue = nativeItem[field]
  const aiValue = aiItem[field]
  const nativeConfidence = nativeItem.confidence[String(field)]
  const aiConfidence = aiItem.confidence[String(field)]
  if (!hasValue(nativeValue)) return { value: aiValue, confidence: aiConfidence, chosen: "ai" }
  if (!hasValue(aiValue)) return { value: nativeValue, confidence: nativeConfidence, chosen: "native" }
  const same = normalizedComparable(field, nativeValue) === normalizedComparable(field, aiValue)
  if (same) return nativeConfidence != null && nativeConfidence >= (aiConfidence ?? 0)
    ? { value: nativeValue, confidence: nativeConfidence, chosen: "native" }
    : { value: aiValue, confidence: aiConfidence, chosen: "ai" }

  const nativeIsExplicit = fieldEvidence(nativeItem, field)
  const chooseAi = !nativeIsExplicit && (aiConfidence ?? 0) >= (nativeConfidence ?? 0) + 0.12
  return {
    value: chooseAi ? aiValue : nativeValue,
    confidence: chooseAi ? aiConfidence : nativeConfidence,
    chosen: chooseAi ? "ai" : "native",
    conflict: { field, nativeValue, aiValue, nativeConfidence, aiConfidence, resolution: chooseAi ? "ai" : "native", nativeIsExplicit },
  }
}

export function reconcileExtractedItems(nativeItems: ParsedManifestItem[], aiItems: ParsedManifestItem[]): ParsedManifestItem[] {
  if (nativeItems.length === 0) return aiItems
  if (aiItems.length === 0) return nativeItems

  const candidates = nativeItems.flatMap((nativeItem, nativeIndex) => aiItems.map((aiItem, aiIndex) => ({ nativeIndex, aiIndex, score: matchScore(nativeItem, aiItem) })))
    .filter((candidate) => Number.isFinite(candidate.score) && candidate.score >= 48)
    .sort((left, right) => right.score - left.score)
  const nativeMatches = new Map<number, { aiIndex: number; score: number }>()
  const usedAi = new Set<number>()
  for (const candidate of candidates) {
    if (nativeMatches.has(candidate.nativeIndex) || usedAi.has(candidate.aiIndex)) continue
    nativeMatches.set(candidate.nativeIndex, { aiIndex: candidate.aiIndex, score: candidate.score })
    usedAi.add(candidate.aiIndex)
  }

  const result = nativeItems.map((nativeItem, nativeIndex) => {
    const match = nativeMatches.get(nativeIndex)
    if (!match) return nativeItem
    const aiItem = aiItems[match.aiIndex]
    const combined = { ...nativeItem } as ParsedManifestItem
    const confidence = { ...nativeItem.confidence }
    const conflicts: Array<Record<string, unknown>> = []
    const decisions: Record<string, string> = {}
    for (const field of SEMANTIC_FIELDS) {
      const decision = chooseField(nativeItem, aiItem, field)
      ;(combined as unknown as Record<string, unknown>)[field] = decision.value
      if (decision.confidence != null) confidence[String(field)] = decision.confidence
      decisions[field] = decision.chosen
      if (decision.conflict) conflicts.push(decision.conflict)
    }
    const serialNumbers = [...new Set([...nativeItem.serialNumbers, ...aiItem.serialNumbers].map(normalizeSerial).filter(Boolean))]
    return {
      ...combined,
      serialNumbers,
      serialNumber: serialNumbers.length === 1 ? serialNumbers[0] : null,
      confidence,
      source: nativeItem.source,
      rawData: {
        ...nativeItem.rawData,
        ai: aiItem.rawData,
        _reconciliation: { matchScore: match.score, decisions, conflicts },
      },
    }
  })

  for (const [index, item] of aiItems.entries()) if (!usedAi.has(index)) result.push(item)
  return result
}

