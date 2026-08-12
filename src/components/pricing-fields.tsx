import { useEffect, useMemo, useState } from "react"
import { RotateCcw, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useCurrency } from "@/lib/currency-context"
import { useI18n } from "@/lib/i18n"
import { calculateMargin, calculateRecommendedPrices, validateSellingPrice } from "@/lib/pricing"
import { useStore } from "@/lib/store"
import type { PricingMode } from "@/lib/types"

export interface ControlledPricingValue {
  value: string
  mode: PricingMode
}

interface PricingFieldsProps {
  finalCost: number
  currency: string
  retail: ControlledPricingValue
  wholesale: ControlledPricingValue
  onRetailChange: (value: ControlledPricingValue) => void
  onWholesaleChange: (value: ControlledPricingValue) => void
  disabled?: boolean
}

export function PricingFields({
  finalCost, currency, retail, wholesale, onRetailChange, onWholesaleChange, disabled,
}: PricingFieldsProps) {
  const { t } = useI18n()
  const { formatOriginal, currencies } = useCurrency()
  const settings = useStore((state) => state.settings)
  const precision = currencies.find((item) => item.isoCode === currency)?.decimalPrecision ?? 2

  // Track whether the user has interacted with each field
  const [retailTouched, setRetailTouched] = useState(false)
  const [wholesaleTouched, setWholesaleTouched] = useState(false)

  const recommendation = useMemo(() => calculateRecommendedPrices(finalCost, {
    retailMarginPercent: settings.targetRetailMarginPercent,
    wholesaleMarginPercent: settings.targetWholesaleMarginPercent,
    minimumMarginPercent: settings.minProfitMarginPercent,
    maximumMarkupPercent: settings.maximumMarkupPercent,
    decimalPrecision: precision,
    psychologicalPricing: settings.psychologicalPricing,
  }), [finalCost, precision, settings.maximumMarkupPercent, settings.minProfitMarginPercent, settings.psychologicalPricing, settings.targetRetailMarginPercent, settings.targetWholesaleMarginPercent])

  useEffect(() => {
    if (retail.mode === "auto" && Number(retail.value) !== recommendation.retail) {
      onRetailChange({ value: recommendation.retail.toFixed(precision), mode: "auto" })
    }
    if (wholesale.mode === "auto" && Number(wholesale.value) !== recommendation.wholesale) {
      onWholesaleChange({ value: recommendation.wholesale.toFixed(precision), mode: "auto" })
    }
  }, [onRetailChange, onWholesaleChange, precision, recommendation.retail, recommendation.wholesale, retail.mode, retail.value, wholesale.mode, wholesale.value])

  const renderField = (
    tier: "retail" | "wholesale",
    state: ControlledPricingValue,
    recommended: number,
    onChange: (value: ControlledPricingValue) => void,
    touched: boolean,
    markTouched: () => void,
  ) => {
    const numeric = Number(state.value)
    const margin = Number.isFinite(numeric) ? calculateMargin(finalCost, numeric) : 0
    const error = validateSellingPrice(finalCost, numeric, settings.minProfitMarginPercent)

    // Only show error if field has been touched
    const showError = touched && Boolean(error)

    return (
      <div className="space-y-1.5 rounded-lg border p-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">{t(tier === "retail" ? "pricing.retailPrice" : "pricing.wholesalePrice")}</Label>
          <Badge variant={state.mode === "auto" ? "secondary" : "outline"} className="text-[9px]">
            {t(state.mode === "auto" ? "pricing.auto" : "pricing.manual")}
          </Badge>
        </div>
        <Input
          type="number"
          min={0}
          step={new Intl.NumberFormat("en", { minimumFractionDigits: precision }).format(10 ** -precision)}
          value={state.value}
          disabled={disabled}
          onChange={(event) => {
            onChange({ value: event.target.value, mode: "manual" })
            markTouched()
          }}
          aria-invalid={showError}
          className="h-8 text-xs"
        />
        <div className="flex flex-wrap items-center justify-between gap-1 text-[10px]">
          <span className={showError ? "text-destructive" : "text-muted-foreground"}>
            {t("pricing.margin")}: {Number.isFinite(margin) ? margin.toFixed(2) : "—"}%
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={disabled}
                onClick={() => onChange({ value: recommended.toFixed(precision), mode: "auto" })}
              >
                {state.mode === "auto" ? <Sparkles className="size-3" /> : <RotateCcw className="size-3" />}
                {t("pricing.useRecommended")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("pricing.recommendedHelp")}</TooltipContent>
          </Tooltip>
        </div>
        <p className="text-[10px] text-muted-foreground">
          {t("pricing.recommended")}: {formatOriginal(recommended, currency)}
        </p>
        {showError && (
          <p className="text-[10px] text-destructive">
            {t(error?.includes("minimum margin") ? "pricing.belowMinimum" : "pricing.invalidPrice")}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
        <span className="text-muted-foreground">{t("pricing.finalCost")}: </span>
        <span className="font-semibold tabular-nums">{formatOriginal(finalCost, currency)}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {renderField("retail", retail, recommendation.retail, onRetailChange, retailTouched, () => setRetailTouched(true))}
        {renderField("wholesale", wholesale, recommendation.wholesale, onWholesaleChange, wholesaleTouched, () => setWholesaleTouched(true))}
      </div>
      <p className="text-[10px] text-muted-foreground">{t("pricing.editableRecommendation")}</p>
    </div>
  )
}

export function pricingValuesAreValid(finalCost: number, retail: string, wholesale: string, minimumMargin: number): boolean {
  const retailValue = Number(retail)
  const wholesaleValue = Number(wholesale)
  return validateSellingPrice(finalCost, retailValue, minimumMargin) === null
    && validateSellingPrice(finalCost, wholesaleValue, minimumMargin) === null
    && wholesaleValue <= retailValue
}