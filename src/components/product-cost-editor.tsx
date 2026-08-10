import { useMemo } from "react"
import Decimal from "decimal.js"
import { Info, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useCurrency } from "@/lib/currency-context"
import { CurrencyService } from "@/lib/currency-service"
import { calculateFixedCost, calculatePercentageCost } from "@/lib/product-cost"
import type { ProductAdditionalCostInput } from "@/lib/types"
import { useI18n } from "@/lib/i18n"

interface ProductCostEditorProps {
  originalAmount: string | number
  originalCurrency: string
  costs: ProductAdditionalCostInput[]
  onChange: (costs: ProductAdditionalCostInput[]) => void
}

function newCost(currency: string): ProductAdditionalCostInput {
  return {
    id: `draft-cost-${crypto.randomUUID()}`,
    name: "",
    calculationType: "fixed",
    amount: "",
    calculationBase: "original_purchase_cost",
    currency,
  }
}

function HelpTip({ label, text }: { label: string; text: string }) {
  return (
    <TooltipProvider><Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={label}>
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent sideOffset={5}>{text}</TooltipContent>
    </Tooltip></TooltipProvider>
  )
}

function positiveValue(value: string | undefined) {
  try { return new Decimal(value || 0).greaterThan(0) } catch { return false }
}

export function areProductCostsValid(costs: ProductAdditionalCostInput[]) {
  return costs.every((cost) => cost.name.trim().length > 0 && positiveValue(cost.calculationType === "fixed" ? cost.amount : cost.percentageRate))
}

export function ProductCostEditor({ originalAmount, originalCurrency, costs, onChange }: ProductCostEditorProps) {
  const { t } = useI18n()
  const { currencies, formatOriginal } = useCurrency()
  const update = (id: string | undefined, patch: Partial<ProductAdditionalCostInput>) => {
    onChange(costs.map((cost) => cost.id === id ? { ...cost, ...patch } : cost))
  }

  const calculated = useMemo(() => costs.map((cost) => {
    const input = cost.calculationType === "fixed" ? cost.amount : cost.percentageRate
    if (!positiveValue(input)) return { amount: "", inOriginalCurrency: 0, error: t("cost.amountPositive") }
    try {
      const precision = currencies.find((currency) => currency.isoCode === cost.currency)?.decimalPrecision ?? 2
      const baseInCostCurrency = CurrencyService.convert(Number(originalAmount || 0), originalCurrency, cost.currency)
      const amount = cost.calculationType === "fixed"
        ? calculateFixedCost(cost.amount, precision)
        : calculatePercentageCost(baseInCostCurrency, cost.percentageRate || "0", precision)
      return {
        amount,
        inOriginalCurrency: CurrencyService.convert(Number(amount), cost.currency, originalCurrency),
        error: "",
      }
    } catch {
      return { amount: "", inOriginalCurrency: 0, error: t("cost.checkAmount") }
    }
  }), [costs, currencies, originalAmount, originalCurrency, t])

  const original = useMemo(() => {
    try { return new Decimal(originalAmount || 0) } catch { return new Decimal(0) }
  }, [originalAmount])
  const additional = calculated.reduce((sum, row) => sum.plus(row.inOriginalCurrency), new Decimal(0))

  return (
    <section className="space-y-3 rounded-lg border bg-background p-3" data-testid="product-cost-editor" aria-label={t("cost.additionalCosts")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h4 className="text-xs font-semibold">{t("cost.additionalCosts")}</h4>
          <HelpTip label={t("cost.additionalCosts")} text={t("cost.additionalCostsHelp")} />
        </div>
        <Button type="button" size="sm" variant={costs.length === 0 ? "default" : "outline"} onClick={() => onChange([...costs, newCost(originalCurrency)])}>
          <Plus className="size-3.5" /> {t("cost.addCost")}
        </Button>
      </div>

      {costs.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-4 text-center">
          <p className="text-xs font-medium">{t("cost.noAdditionalCosts")}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{t("cost.addCostExamples")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {costs.map((cost, index) => {
            const inputId = `product-cost-${cost.id ?? index}`
            const result = calculated[index]
            return (
              <div key={cost.id ?? index} className="rounded-md bg-muted/25 p-2.5">
                <div className="grid gap-2 sm:grid-cols-[minmax(9rem,1.4fr)_minmax(7rem,.8fr)_minmax(8rem,1fr)_minmax(6rem,.65fr)_auto] sm:items-end">
                  <div>
                    <Label htmlFor={`${inputId}-name`} className="text-[10px]">{t("common.name")}</Label>
                    <Input id={`${inputId}-name`} autoFocus={index === costs.length - 1 && !cost.name} value={cost.name} onChange={(event) => update(cost.id, { name: event.target.value })} aria-invalid={!cost.name.trim()} aria-describedby={!cost.name.trim() ? `${inputId}-name-error` : undefined} className="mt-1 h-8 text-xs" placeholder={t("cost.nameExample")} />
                  </div>
                  <div>
                    <Label className="text-[10px]">{t("cost.type")}</Label>
                    <Select value={cost.calculationType} onValueChange={(value) => update(cost.id, { calculationType: value as ProductAdditionalCostInput["calculationType"] })}>
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="fixed">{t("cost.fixed")}</SelectItem><SelectItem value="percentage">{t("cost.percentage")}</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={`${inputId}-value`} className="text-[10px]">{cost.calculationType === "fixed" ? t("common.amount") : t("cost.rate")}</Label>
                    <div className="mt-1 flex">
                      <Input id={`${inputId}-value`} value={cost.calculationType === "fixed" ? cost.amount : cost.percentageRate ?? ""} onChange={(event) => update(cost.id, cost.calculationType === "fixed" ? { amount: event.target.value } : { percentageRate: event.target.value })} inputMode="decimal" aria-invalid={Boolean(result.error)} aria-describedby={result.error ? `${inputId}-error` : undefined} className="h-8 rounded-e-none text-end text-xs tabular-nums" />
                      <span className="flex h-8 min-w-10 items-center justify-center rounded-e-md border border-s-0 bg-muted px-2 text-[10px] font-medium">{cost.calculationType === "fixed" ? cost.currency : "%"}</span>
                    </div>
                  </div>
                  <div>
                    <Label className="text-[10px]">{t("ship.currency")}</Label>
                    <Select value={cost.currency} onValueChange={(value) => update(cost.id, { currency: value })}>
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{currencies.map((currency) => <SelectItem key={currency.isoCode} value={currency.isoCode}>{currency.isoCode}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={t("common.delete")} onClick={() => onChange(costs.filter((candidate) => candidate.id !== cost.id))}>
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
                <div className="mt-1.5 flex min-h-4 items-center justify-between gap-2 text-[10px]">
                  {!cost.name.trim() ? <span id={`${inputId}-name-error`} className="text-destructive">{t("cost.nameRequired")}</span> : result.error ? <span id={`${inputId}-error`} className="text-destructive">{result.error}</span> : <span className="text-muted-foreground">{t("cost.calculated")}: {result.amount} {cost.currency}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="grid grid-cols-1 items-center gap-2 rounded-md bg-muted/40 p-3 text-xs sm:grid-cols-[1fr_auto_1fr_auto_1.15fr]">
        <div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">{t("cost.originalCost")} <HelpTip label={t("cost.originalCost")} text={t("cost.originalCostHelp")} /></div>
          <div className="mt-0.5 font-medium tabular-nums" dir="ltr">{formatOriginal(original.toNumber(), originalCurrency)}</div>
        </div>
        <span className="hidden text-muted-foreground sm:block" aria-hidden>+</span>
        <div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">{t("cost.additionalCosts")} <HelpTip label={t("cost.additionalCosts")} text={t("cost.additionalCostsHelp")} /></div>
          <div className="mt-0.5 font-medium tabular-nums" dir="ltr">{formatOriginal(additional.toNumber(), originalCurrency)}</div>
        </div>
        <span className="hidden text-muted-foreground sm:block" aria-hidden>=</span>
        <div>
          <div className="flex items-center gap-1 text-[10px] font-medium text-primary">{t("cost.finalCost")} <HelpTip label={t("cost.finalCost")} text={t("cost.finalCostHelp")} /></div>
          <div className="mt-0.5 text-base font-bold tabular-nums text-primary" dir="ltr">{formatOriginal(original.plus(additional).toNumber(), originalCurrency)}</div>
        </div>
      </div>
    </section>
  )
}
