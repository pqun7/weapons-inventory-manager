import { useMemo, useState } from "react"
import { AlertTriangle, ChevronDown } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useI18n } from "@/lib/i18n"
import { buildManifestReviewProblems } from "@/lib/manifest-review-problems"
import type {
  ManifestExtractionAnomaly,
  ManifestReviewItem,
  ManifestValidationIssue,
  ShipmentManifestReview,
} from "@/lib/shipment-manifest"
import { cn } from "@/lib/utils"

type Translate = (key: string, params?: Record<string, string | number>) => string

const REVIEW_FIELD_LABELS: Record<string, string> = {
  productType: "ship.manifestProductType",
  productName: "ship.manifestProductName",
  quantity: "common.quantity",
  unitPrice: "common.purchasePrice",
  weaponType: "ship.manifestWeaponType",
  weaponSubtype: "ship.manifestSubtype",
  manufacturer: "weapon.brand",
  model: "ship.manifestModel",
  caliber: "ship.manifestCaliber",
  serialNumbers: "ship.manifestSerialsOnePerLine",
  storageLocationId: "ship.manifestStorageLocation",
  sku: "ship.manifestProblemsFieldSku",
  totalPrice: "common.total",
}

function reviewFieldLabel(field: string | null | undefined, t: Translate): string {
  if (!field) return t("ship.manifestProblemsUnknownField")
  return t(REVIEW_FIELD_LABELS[field] ?? "ship.manifestProblemsUnknownField")
}

function anomalyDescription(anomaly: ManifestExtractionAnomaly, t: Translate): string {
  const field = reviewFieldLabel(anomaly.fieldName, t)
  if (anomaly.code === "quantity_serial_mismatch") {
    return t("ship.manifestProblemsQuantitySerialMismatch", {
      quantity: Number(anomaly.details?.quantity ?? 0),
      serials: Number(anomaly.details?.serialCount ?? 0),
    })
  }
  if (anomaly.code === "duplicate_serial") return t("ship.manifestProblemsDuplicateSerial", { serial: String(anomaly.details?.serial ?? "—") })
  if (anomaly.code === "low_confidence") return t("ship.manifestProblemsLowConfidence", { field })
  if (anomaly.code === "field_conflict") return t("ship.manifestProblemsFieldConflict", { field })
  if (anomaly.code === "incomplete_extraction") return t("ship.manifestProblemsIncompleteDocument")
  return t("ship.manifestProblemsFieldReview", { field })
}

function validationDescription(issue: ManifestValidationIssue, t: Translate): string {
  const field = reviewFieldLabel(issue.fieldName, t)
  const messageSerial = issue.message.match(/^Serial\s+(.+?)\s+(?:appears|already|exists)\b/i)?.[1]
  const serial = String(issue.details?.serial ?? messageSerial ?? t("ship.manifestProblemsUnknownSerial"))
  const descriptions: Record<string, string> = {
    PRODUCT_REQUIRED: t("ship.manifestProblemsFieldRequired", { field }),
    PRODUCT_TYPE_REQUIRED: t("ship.manifestProblemsInvalidProductType"),
    QUANTITY_INVALID: t("ship.manifestProblemsInvalidQuantity"),
    UNIT_PRICE_NEGATIVE: t("ship.manifestProblemsNegativeValue", { field }),
    TOTAL_PRICE_NEGATIVE: t("ship.manifestProblemsNegativeValue", { field }),
    SERIAL_REQUIRED: t("ship.manifestProblemsSerialRequired"),
    SERIAL_COUNT_MISMATCH: t("ship.manifestProblemsSerialCountMismatch"),
    WEAPON_TYPE_REQUIRED_FOR_RECEIPT: t("ship.manifestProblemsFieldRequired", { field }),
    MANUFACTURER_REQUIRED_FOR_RECEIPT: t("ship.manifestProblemsFieldRequired", { field }),
    MODEL_REQUIRED_FOR_RECEIPT: t("ship.manifestProblemsFieldRequired", { field }),
    CALIBER_REQUIRED_FOR_RECEIPT: t("ship.manifestProblemsFieldRequired", { field }),
    CALIBER_REVIEW_REQUIRED: t("ship.manifestProblemsFieldReview", { field }),
    PURCHASE_PRICE_REQUIRED_FOR_RECEIPT: t("ship.manifestProblemsPositivePriceRequired"),
    DUPLICATE_IN_MANIFEST: t("ship.manifestProblemsDuplicateSerialInManifest", { serial }),
    DUPLICATE_IN_INVENTORY: t("ship.manifestProblemsDuplicateSerialInInventory", { serial }),
    DUPLICATE_IN_PENDING_SHIPMENT: t("ship.manifestProblemsDuplicateSerialInPending", { serial }),
    POTENTIAL_DUPLICATE_SKU: t("ship.manifestProblemsDuplicateSkuInManifest"),
    POTENTIAL_DUPLICATE_SKU_PENDING: t("ship.manifestProblemsDuplicateSkuInPending"),
    POTENTIAL_DUPLICATE_ROW: t("ship.manifestProblemsDuplicateRow"),
    LOW_CONFIDENCE: t("ship.manifestProblemsImportantFieldsLowConfidence"),
    MASTER_DATA_MAPPING_REQUIRED: t("ship.manifestProblemsMasterDataMapping"),
    LOCATION_REQUIRED: t("ship.manifestProblemsFieldRequired", { field }),
  }
  if (descriptions[issue.code]) return descriptions[issue.code]
  if (/DUPLICATE|SERIAL/i.test(issue.code)) return t("ship.manifestProblemsSerialReview")
  if (/CONFIDENCE/i.test(issue.code)) return t("ship.manifestProblemsLowConfidence", { field })
  if (issue.fieldName) return t("ship.manifestProblemsFieldReview", { field: reviewFieldLabel(issue.fieldName, t) })
  return t("ship.manifestProblemsRowReview")
}

export function ManifestReviewProblemsAlert({
  review,
  missingFieldsById,
}: {
  review: ShipmentManifestReview
  missingFieldsById: ReadonlyMap<string, readonly string[]>
}) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const problems = useMemo(() => buildManifestReviewProblems(review, missingFieldsById), [missingFieldsById, review])
  if (problems.totalCount === 0) return null

  const itemType = (type: ManifestReviewItem["productType"]) => t(`ship.manifestProblemsItemType.${type ?? "item"}`)
  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} className="mx-3 mt-2 overflow-hidden rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-200">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-start text-xs transition-colors hover:bg-amber-500/10" aria-expanded={expanded}>
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t("ship.manifestProblemsTitle")}</span>
            <span className="block truncate text-[11px] opacity-80">{t("ship.manifestProblemsSummary", { items: problems.affectedItemCount, fields: problems.missingFieldCount, checks: problems.otherCheckCount })}</span>
          </span>
          <span className="hidden shrink-0 text-[11px] font-medium sm:inline">{t(expanded ? "ship.manifestProblemsHide" : "ship.manifestProblemsView")}</span>
          <ChevronDown className={cn("size-4 shrink-0 transition-transform", expanded && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="max-h-72 space-y-2 overflow-y-auto border-t border-amber-500/20 p-2.5">
          {problems.items.map((problem) => (
            <div key={problem.itemId} className="rounded-md border border-amber-500/20 bg-background/75 p-2.5 text-foreground">
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                <Badge variant="outline">{itemType(problem.productType)}</Badge>
                <span>{t("ship.manifestProblemsRow", { row: problem.rowIndex })}</span>
                <span className="text-muted-foreground">· {problem.productName || t("ship.manifestProblemsUnnamedItem")}</span>
              </div>
              {problem.missingFields.length > 0 && (
                <div className="mt-2">
                  <div className="mb-1 text-[10px] font-medium text-amber-700 dark:text-amber-300">{t("ship.manifestProblemsMissingFields")}</div>
                  <div className="flex flex-wrap gap-1">
                    {problem.missingFields.map((field) => <Badge key={field} variant="secondary" className="border-amber-500/25 bg-amber-500/10 text-[10px]">{reviewFieldLabel(field, t)}</Badge>)}
                  </div>
                </div>
              )}
              {(problem.anomalies.length > 0 || problem.validationIssues.length > 0) && (
                <div className="mt-2">
                  <div className="mb-1 text-[10px] font-medium text-muted-foreground">{t("ship.manifestProblemsOtherChecks")}</div>
                  <ul className="list-inside list-disc space-y-0.5 text-[11px] text-muted-foreground">
                    {problem.anomalies.map((anomaly, index) => <li key={`anomaly-${index}`}>{anomalyDescription(anomaly, t)}</li>)}
                    {problem.validationIssues.map((issue) => <li key={issue.id}>{validationDescription(issue, t)}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ))}
          {(problems.documentAnomalies.length > 0 || problems.documentIssues.length > 0) && (
            <div className="rounded-md border border-amber-500/20 bg-background/75 p-2.5 text-foreground">
              <div className="text-xs font-semibold">{t("ship.manifestProblemsDocument")}</div>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-muted-foreground">
                {problems.documentAnomalies.map((anomaly, index) => <li key={`document-anomaly-${index}`}>{anomalyDescription(anomaly, t)}</li>)}
                {problems.documentIssues.map((issue) => <li key={issue.id}>{validationDescription(issue, t)}</li>)}
              </ul>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
