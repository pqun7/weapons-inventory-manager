import { useEffect, useMemo, useState } from "react"
import Decimal from "decimal.js"
import { CheckCircle2, ChevronDown, Info, Plus, Trash2, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { CurrencyService } from "@/lib/currency-service"
import { useCurrency } from "@/lib/currency-context"
import { calculatePercentageCost, calculateShipmentAllocation } from "@/lib/product-cost"
import type { ShipmentAdditionalCostInput, ShipmentAllocationMethod, ShipmentCostScope } from "@/lib/types"
import { useI18n } from "@/lib/i18n"

export interface ShipmentCostEditorItem {
  id: string
  label: string
  value: string | number
  quantity: string | number
}

interface ShipmentCostEditorProps {
  items: ShipmentCostEditorItem[]
  shipmentCurrency: string
  costs: ShipmentAdditionalCostInput[]
  onChange: (costs: ShipmentAdditionalCostInput[]) => void
  onValidityChange?: (valid: boolean) => void
}

interface AllocationPreview {
  shipmentItemId: string
  automaticAmount: string
  finalAmount: string
  manualOverride: boolean
}

interface CostPreview {
  amount: string
  allocations: AllocationPreview[]
  allocated: string
  difference: string
  balanced: boolean
  error: string
  fieldError: string
}

function newShipmentCost(currency: string): ShipmentAdditionalCostInput {
  return {
    id: `draft-shipment-cost-${crypto.randomUUID()}`,
    name: "",
    calculationType: "fixed",
    amount: "",
    calculationBase: "original_purchase_cost",
    currency,
    scope: "entire_shipment",
    allocationMethod: "by_value",
    selectedShipmentItemIds: [],
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

function decimalOrNull(value: string | number | undefined): Decimal | null {
  try { return new Decimal(value ?? "") } catch { return null }
}

function allocationHint(method: ShipmentAllocationMethod, t: (key: string) => string) {
  if (method === "by_quantity") return t("cost.byQuantityHelp")
  if (method === "equal") return t("cost.equalHelp")
  return t("cost.byValueHelp")
}

export function ShipmentCostEditor({ items, shipmentCurrency, costs, onChange, onValidityChange }: ShipmentCostEditorProps) {
  const { t } = useI18n()
  const { currencies, formatOriginal } = useCurrency()
  const [detailsOpen, setDetailsOpen] = useState<Record<string, boolean>>({})
  const [advancedOpen, setAdvancedOpen] = useState<Record<string, boolean>>({})
  const update = (id: string | undefined, patch: Partial<ShipmentAdditionalCostInput>) => {
    onChange(costs.map((cost) => cost.id === id ? { ...cost, ...patch } : cost))
  }
  const subtotal = useMemo(() => items.reduce((sum, item) => sum.plus(new Decimal(item.value || 0).times(item.quantity || 0)), new Decimal(0)), [items])

  const previews = useMemo(() => costs.map<CostPreview>((cost) => {
    const input = cost.calculationType === "fixed" ? cost.amount : cost.percentageRate
    const parsedInput = decimalOrNull(input)
    if (!parsedInput || !parsedInput.greaterThan(0)) {
      return { amount: "0", allocations: [], allocated: "0", difference: "0", balanced: false, error: "", fieldError: t("cost.amountPositive") }
    }
    try {
      const definition = currencies.find((currency) => currency.isoCode === cost.currency)
      if (!definition) throw new Error()
      const precision = definition.decimalPrecision
      const subtotalInCostCurrency = CurrencyService.convert(subtotal.toNumber(), shipmentCurrency, cost.currency)
      const amount = cost.calculationType === "fixed"
        ? parsedInput.toDecimalPlaces(precision).toFixed(precision)
        : calculatePercentageCost(subtotalInCostCurrency, cost.percentageRate || "0", precision)
      const selectedIds = cost.scope === "entire_shipment"
        ? items.map((item) => item.id)
        : cost.scope === "manual" && cost.selectedShipmentItemIds.length === 0
          ? Object.keys(cost.manualAllocations ?? {})
          : cost.selectedShipmentItemIds
      if (cost.scope === "single_product" && selectedIds.length !== 1) throw new Error()
      if (selectedIds.length === 0) throw new Error()
      const selected = items.filter((item) => selectedIds.includes(item.id))
      if (selected.length !== selectedIds.length) throw new Error()
      const allocationItems = selected.map((item) => ({
        id: item.id,
        value: CurrencyService.convert(new Decimal(item.value).times(item.quantity).toNumber(), shipmentCurrency, cost.currency),
        quantity: item.quantity,
      }))
      const manualMode = cost.scope === "manual" || cost.allocationMethod === "manual"
      const automaticMethod = manualMode ? "by_value" : cost.allocationMethod
      const automatic = calculateShipmentAllocation(automaticMethod, allocationItems, amount, precision)
      if (!manualMode) {
        return { amount, allocations: automatic, allocated: amount, difference: new Decimal(0).toFixed(precision), balanced: true, error: "", fieldError: "" }
      }

      let valuesValid = true
      const allocations = automatic.map((allocation) => {
        const entered = cost.manualAllocations?.[allocation.shipmentItemId] ?? allocation.finalAmount
        const parsed = decimalOrNull(entered)
        if (!parsed || parsed.isNegative()) valuesValid = false
        return { ...allocation, finalAmount: entered, manualOverride: true }
      })
      const allocated = allocations.reduce((sum, allocation) => {
        const parsed = decimalOrNull(allocation.finalAmount)
        return parsed && !parsed.isNegative() ? sum.plus(parsed) : sum
      }, new Decimal(0)).toDecimalPlaces(precision)
      const difference = allocated.minus(amount).toDecimalPlaces(precision)
      return {
        amount,
        allocations,
        allocated: allocated.toFixed(precision),
        difference: difference.toFixed(precision),
        balanced: valuesValid && difference.isZero(),
        error: "",
        fieldError: "",
      }
    } catch {
      return { amount: "0", allocations: [], allocated: "0", difference: "0", balanced: false, error: t("cost.checkCostDetails"), fieldError: "" }
    }
  }), [costs, currencies, items, shipmentCurrency, subtotal, t])

  const valid = costs.every((cost, index) => Boolean(cost.name.trim()) && !previews[index].fieldError && !previews[index].error && previews[index].balanced)
  useEffect(() => { onValidityChange?.(valid) }, [onValidityChange, valid])

  const additionalInShipmentCurrency = costs.reduce((sum, cost, index) => {
    try { return sum.plus(CurrencyService.convert(Number(previews[index].amount), cost.currency, shipmentCurrency)) } catch { return sum }
  }, new Decimal(0))

  const setScope = (cost: ShipmentAdditionalCostInput, scope: ShipmentCostScope) => {
    let selectedShipmentItemIds = cost.selectedShipmentItemIds
    if (scope === "entire_shipment") selectedShipmentItemIds = []
    if (scope === "single_product" && selectedShipmentItemIds.length > 1) selectedShipmentItemIds = selectedShipmentItemIds.slice(0, 1)
    update(cost.id, { scope, selectedShipmentItemIds, manualAllocations: undefined })
  }

  const setMode = (cost: ShipmentAdditionalCostInput, mode: "automatic" | "manual", preview: CostPreview) => {
    if (mode === "manual") {
      const manualAllocations = Object.fromEntries(preview.allocations.map((allocation) => [allocation.shipmentItemId, allocation.finalAmount]))
      update(cost.id, { allocationMethod: "manual", manualAllocations })
    } else {
      update(cost.id, { allocationMethod: "by_value", manualAllocations: undefined, scope: cost.scope === "manual" ? "entire_shipment" : cost.scope })
    }
  }

  const toggleItem = (cost: ShipmentAdditionalCostInput, itemId: string, checked: boolean) => {
    const ids = checked
      ? [...new Set([...cost.selectedShipmentItemIds, itemId])]
      : cost.selectedShipmentItemIds.filter((id) => id !== itemId)
    update(cost.id, { selectedShipmentItemIds: ids, manualAllocations: undefined })
  }

  const setManualAllocation = (cost: ShipmentAdditionalCostInput, preview: CostPreview, itemId: string, value: string) => {
    const defaults = Object.fromEntries(preview.allocations.map((allocation) => [allocation.shipmentItemId, allocation.finalAmount]))
    update(cost.id, { manualAllocations: { ...defaults, ...(cost.manualAllocations ?? {}), [itemId]: value } })
  }

  return (
    <section className="space-y-3" data-testid="shipment-cost-editor" aria-label={t("cost.shipmentCosts")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5"><h4 className="text-sm font-semibold">{t("cost.shipmentCosts")}</h4><HelpTip label={t("cost.shipmentCosts")} text={t("cost.shipmentCostsHelp")} /></div>
          {costs.length === 0 && <p className="mt-0.5 text-[11px] text-muted-foreground">{t("cost.firstShipmentCostHelp")}</p>}
        </div>
        <Button type="button" size="sm" variant={costs.length === 0 ? "default" : "outline"} onClick={() => onChange([...costs, newShipmentCost(shipmentCurrency)])}><Plus className="size-3.5" /> {t("cost.addCost")}</Button>
      </div>

      {costs.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-8 text-center">
          <p className="text-xs font-medium">{t("cost.noShipmentCosts")}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{t("cost.addCostExamples")}</p>
        </div>
      ) : costs.map((cost, index) => {
        const key = cost.id ?? String(index)
        const preview = previews[index]
        const manualMode = cost.scope === "manual" || cost.allocationMethod === "manual"
        const selectedIds = cost.scope === "entire_shipment" ? items.map((item) => item.id) : cost.selectedShipmentItemIds
        const valueId = `shipment-cost-value-${key}`
        return (
          <article key={key} className="space-y-3 rounded-lg border bg-background p-3">
            <div className="grid gap-2 sm:grid-cols-[minmax(10rem,1.4fr)_minmax(7rem,.7fr)_minmax(8rem,1fr)_minmax(6rem,.6fr)_auto] sm:items-end">
              <div><Label className="text-[10px]">{t("common.name")}</Label><Input autoFocus={index === costs.length - 1 && !cost.name} value={cost.name} onChange={(event) => update(cost.id, { name: event.target.value })} className="mt-1 h-8 text-xs" placeholder={t("cost.nameExample")} /></div>
              <div><Label className="text-[10px]">{t("cost.type")}</Label><Select value={cost.calculationType} onValueChange={(value) => update(cost.id, { calculationType: value as ShipmentAdditionalCostInput["calculationType"] })}><SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed">{t("cost.fixed")}</SelectItem><SelectItem value="percentage">{t("cost.percentage")}</SelectItem></SelectContent></Select></div>
              <div>
                <Label htmlFor={valueId} className="text-[10px]">{cost.calculationType === "fixed" ? t("common.amount") : t("cost.rate")}</Label>
                <div className="mt-1 flex"><Input id={valueId} value={cost.calculationType === "fixed" ? cost.amount : cost.percentageRate ?? ""} onChange={(event) => update(cost.id, cost.calculationType === "fixed" ? { amount: event.target.value } : { percentageRate: event.target.value })} inputMode="decimal" aria-invalid={Boolean(preview.fieldError)} aria-describedby={preview.fieldError ? `${valueId}-error` : undefined} className="h-8 rounded-e-none text-end text-xs tabular-nums" /><span className="flex h-8 min-w-10 items-center justify-center rounded-e-md border border-s-0 bg-muted px-2 text-[10px] font-medium">{cost.calculationType === "fixed" ? cost.currency : "%"}</span></div>
              </div>
              <div><Label className="text-[10px]">{t("ship.currency")}</Label><Select value={cost.currency} onValueChange={(value) => update(cost.id, { currency: value, manualAllocations: undefined })}><SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{currencies.map((currency) => <SelectItem key={currency.isoCode} value={currency.isoCode}>{currency.isoCode}</SelectItem>)}</SelectContent></Select></div>
              <Button type="button" size="icon-sm" variant="ghost" aria-label={t("common.delete")} onClick={() => onChange(costs.filter((candidate) => candidate.id !== cost.id))}><Trash2 className="size-3.5 text-destructive" /></Button>
            </div>
            {!cost.name.trim() && <p className="text-[10px] text-destructive">{t("cost.nameRequired")}</p>}
            {preview.fieldError && <p id={`${valueId}-error`} className="text-[10px] text-destructive">{preview.fieldError}</p>}

            <div className="grid gap-3 border-t pt-3 lg:grid-cols-2">
              <fieldset className="space-y-2">
                <legend className="flex items-center gap-1 text-[11px] font-medium">{t("cost.howApplied")} <HelpTip label={t("cost.selectedProducts")} text={t("cost.selectedProductsHelp")} /></legend>
                <div className="flex flex-wrap gap-1.5">
                  {(["entire_shipment", "selected_products", "single_product"] as const).map((scope) => <Button key={scope} type="button" size="xs" variant={cost.scope === scope ? "default" : "outline"} aria-pressed={cost.scope === scope} onClick={() => setScope(cost, scope)}>{scope === "entire_shipment" ? t("cost.entireShipment") : scope === "selected_products" ? t("cost.selectedProducts") : t("cost.singleProduct")}</Button>)}
                </div>
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="flex items-center gap-1 text-[11px] font-medium">{t("cost.howCalculated")} <HelpTip label={t("cost.automatic")} text={t("cost.automaticHelp")} /></legend>
                <div className="flex gap-1.5"><Button type="button" size="xs" variant={!manualMode ? "default" : "outline"} aria-pressed={!manualMode} onClick={() => setMode(cost, "automatic", preview)}>{t("cost.automatic")}</Button><Button type="button" size="xs" variant={manualMode ? "default" : "outline"} aria-pressed={manualMode} onClick={() => setMode(cost, "manual", preview)}>{t("cost.manual")}</Button>{manualMode && <Badge variant="outline" className="text-[9px]">{t("cost.manual")}</Badge>}</div>
                <p className="text-[10px] text-muted-foreground">{manualMode ? t("cost.manualHelp") : t("cost.automaticShortHelp")}</p>
              </fieldset>
            </div>

            {cost.scope !== "entire_shipment" && cost.scope !== "manual" && (
              <fieldset className="rounded-md bg-muted/25 p-2.5">
                <legend className="px-1 text-[10px] font-medium">{t("cost.chooseProducts")}</legend>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{items.map((item) => <label key={item.id} className="flex min-w-0 items-center gap-2 text-[11px]"><Checkbox checked={selectedIds.includes(item.id)} onCheckedChange={(checked) => toggleItem(cost, item.id, checked === true)} disabled={cost.scope === "single_product" && !selectedIds.includes(item.id) && selectedIds.length >= 1} /><span className="truncate" title={item.label}>{item.label}</span></label>)}</div>
              </fieldset>
            )}

            {!manualMode && (
              <Collapsible open={advancedOpen[key]} onOpenChange={(open) => setAdvancedOpen((state) => ({ ...state, [key]: open }))}>
                <CollapsibleTrigger asChild><Button type="button" variant="ghost" size="xs" className="px-0 text-muted-foreground">{t("cost.moreOptions")} <ChevronDown className={`size-3 transition-transform ${advancedOpen[key] ? "rotate-180" : ""}`} /></Button></CollapsibleTrigger>
                <CollapsibleContent className="pt-1">
                  <div className="rounded-md bg-muted/25 p-2.5">
                    <div className="flex items-center gap-1 text-[10px] font-medium">{t("cost.shareCost")} <HelpTip label={t("cost.shareCost")} text={t("cost.allocationMethodHelp")} /></div>
                    <div className="mt-2 flex flex-wrap gap-1.5">{(["by_value", "by_quantity", "equal"] as const).map((method) => <Button key={method} type="button" size="xs" variant={cost.allocationMethod === method ? "secondary" : "outline"} onClick={() => update(cost.id, { allocationMethod: method, manualAllocations: undefined })}>{method === "by_value" ? t("cost.byValue") : method === "by_quantity" ? t("cost.byQuantity") : t("cost.equal")}</Button>)}</div>
                    <p className="mt-1.5 text-[10px] text-muted-foreground">{allocationHint(cost.allocationMethod, t)}</p>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {preview.error ? <p className="flex items-center gap-1.5 text-[10px] text-destructive"><TriangleAlert className="size-3.5" />{preview.error}</p> : manualMode ? (
              <div className="space-y-2">
                <Table>
                  <TableHeader><TableRow><TableHead className="h-7 text-[10px]">{t("cost.product")}</TableHead><TableHead className="h-7 text-end text-[10px]">{t("common.amount")}</TableHead></TableRow></TableHeader>
                  <TableBody>{preview.allocations.map((allocation) => <TableRow key={allocation.shipmentItemId}><TableCell className="max-w-64 truncate py-1.5 text-[11px]" title={items.find((item) => item.id === allocation.shipmentItemId)?.label}>{items.find((item) => item.id === allocation.shipmentItemId)?.label}</TableCell><TableCell className="py-1.5"><div className="ms-auto flex w-36"><Input value={allocation.finalAmount} onChange={(event) => setManualAllocation(cost, preview, allocation.shipmentItemId, event.target.value)} inputMode="decimal" className="h-7 rounded-e-none text-end text-[11px] tabular-nums" /><span className="flex h-7 items-center rounded-e-md border border-s-0 bg-muted px-2 text-[9px]">{cost.currency}</span></div></TableCell></TableRow>)}</TableBody>
                </Table>
                <div className={`grid gap-2 rounded-md p-2 text-[10px] sm:grid-cols-3 ${preview.balanced ? "bg-emerald-500/10" : "bg-destructive/10"}`}>
                  <div><span className="text-muted-foreground">{t("cost.allocated")}</span><div className="font-medium tabular-nums" dir="ltr">{preview.allocated} {cost.currency}</div></div>
                  <div><span className="text-muted-foreground">{t("cost.required")}</span><div className="font-medium tabular-nums" dir="ltr">{preview.amount} {cost.currency}</div></div>
                  <div className="flex items-center gap-1.5 font-medium">{preview.balanced ? <><CheckCircle2 className="size-3.5" />{t("cost.balanced")}</> : <><TriangleAlert className="size-3.5" />{t("cost.difference")}: <span dir="ltr">{new Decimal(preview.difference || 0).abs().toString()} {cost.currency}</span></>}</div>
                </div>
              </div>
            ) : (
              <Collapsible open={detailsOpen[key]} onOpenChange={(open) => setDetailsOpen((state) => ({ ...state, [key]: open }))}>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/25 px-2.5 py-2 text-[10px]"><span>{t("cost.automaticShortHelp")} · {allocationHint(cost.allocationMethod, t)}</span><CollapsibleTrigger asChild><Button type="button" size="xs" variant="ghost">{t("cost.viewAllocation")} <ChevronDown className={`size-3 transition-transform ${detailsOpen[key] ? "rotate-180" : ""}`} /></Button></CollapsibleTrigger></div>
                <CollapsibleContent><Table className="mt-1"><TableHeader><TableRow><TableHead className="h-7 text-[10px]">{t("cost.product")}</TableHead><TableHead className="h-7 text-end text-[10px]">{t("cost.allocatedCost")}</TableHead><TableHead className="h-7 text-[10px]">{t("common.status")}</TableHead></TableRow></TableHeader><TableBody>{preview.allocations.map((allocation) => <TableRow key={allocation.shipmentItemId}><TableCell className="max-w-64 truncate py-1.5 text-[11px]" title={items.find((item) => item.id === allocation.shipmentItemId)?.label}>{items.find((item) => item.id === allocation.shipmentItemId)?.label}</TableCell><TableCell className="py-1.5 text-end text-[11px] tabular-nums" dir="ltr">{allocation.finalAmount} {cost.currency}</TableCell><TableCell className="py-1.5"><span className="text-[10px] text-muted-foreground">{t("cost.automatic")}</span></TableCell></TableRow>)}</TableBody></Table></CollapsibleContent>
              </Collapsible>
            )}
            <div className="flex justify-end text-[11px] font-medium"><span className="text-muted-foreground">{t("cost.costTotal")}:</span>&nbsp;<span className="tabular-nums" dir="ltr">{preview.amount} {cost.currency}</span></div>
          </article>
        )
      })}

      <div className="grid grid-cols-1 items-center gap-2 rounded-lg bg-muted/40 p-3 text-xs sm:grid-cols-[1fr_auto_1fr_auto_1.15fr]">
        <div><div className="text-[10px] text-muted-foreground">{t("cost.productSubtotal")}</div><div className="mt-0.5 font-medium tabular-nums" dir="ltr">{formatOriginal(subtotal.toNumber(), shipmentCurrency)}</div></div><span className="hidden text-muted-foreground sm:block" aria-hidden>+</span>
        <div><div className="flex items-center gap-1 text-[10px] text-muted-foreground">{t("cost.shipmentCosts")} <HelpTip label={t("cost.shipmentCosts")} text={t("cost.shipmentCostsHelp")} /></div><div className="mt-0.5 font-medium tabular-nums" dir="ltr">{formatOriginal(additionalInShipmentCurrency.toNumber(), shipmentCurrency)}</div></div><span className="hidden text-muted-foreground sm:block" aria-hidden>=</span>
        <div><div className="text-[10px] font-medium text-primary">{t("cost.totalShipmentCost")}</div><div className="mt-0.5 text-base font-bold tabular-nums text-primary" dir="ltr">{formatOriginal(subtotal.plus(additionalInShipmentCurrency).toNumber(), shipmentCurrency)}</div></div>
      </div>
    </section>
  )
}
