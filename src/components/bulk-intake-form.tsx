import { useState, useRef, useEffect, useMemo } from "react"
import {
  Plus, Sparkles, Check, AlertCircle, ChevronRight, ChevronLeft,
  Package,
} from "lucide-react"
import { Banknote } from "@/lib/lucide-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { SearchableCombobox } from "@/components/ui/searchable-combobox"
import { useStore } from "@/lib/store"
import { useI18n } from "@/lib/i18n"
import { InventoryService } from "@/lib/services"
import { predictSerialPrefix, nextSerialSuggestion } from "@/lib/format"
import type { PricingMode, ProductAdditionalCostInput, WeaponCondition } from "@/lib/types"
import { useDynamicMasterData } from "@/hooks/use-dynamic-master-data"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "sonner"
import { useCurrency } from "@/lib/currency-context"
import { areProductCostsValid } from "./product-cost-editor"
import { pricingValuesAreValid } from "./pricing-fields"
import { calculateDraftFinalCostInCurrency } from "@/lib/product-cost"
import { CurrencyService } from "@/lib/currency-service"
import { PricingSection } from "./pricing-section"

const CONDITIONS: WeaponCondition[] = ["Excellent", "Good", "Fair", "Poor"]

export function BulkIntakeForm({ onComplete }: { onComplete: () => void }) {
  const { t } = useI18n()
  const weapons = useStore((s) => s.weapons)
  const settings = useStore((s) => s.settings)
  const md = useDynamicMasterData()
  const { transactionCurrency } = useCurrency()

  const [step, setStep] = useState(1)

  // Weapon Details
  const [brand, setBrand] = useState("")
  const [model, setModel] = useState("")
  const [weaponType, setWeaponType] = useState("")
  const [subType, setSubType] = useState("")
  const [caliber, setCaliber] = useState("")
  const [condition, setCondition] = useState<WeaponCondition>("Good")

  // Pricing & Costs
  const [purchasePrice, setPurchasePrice] = useState("")
  const [retailPrice, setRetailPrice] = useState("")
  const [wholesalePrice, setWholesalePrice] = useState("")
  const [retailPriceMode, setRetailPriceMode] = useState<PricingMode>("auto")
  const [wholesalePriceMode, setWholesalePriceMode] = useState<PricingMode>("auto")
  const [currency, setCurrency] = useState(transactionCurrency)
  const [additionalCosts, setAdditionalCosts] = useState<ProductAdditionalCostInput[]>([])
  const [quantity, setQuantity] = useState(1)

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  // Serials
  const [serials, setSerials] = useState<string[]>([])
  const [activeSerialIndex, setActiveSerialIndex] = useState(0)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Initial seeding
  useEffect(() => {
    if (!md.loading && md.weaponTypeLabels.length > 0 && !weaponType) {
      const first = md.weaponTypeLabels[0]
      setWeaponType(first)
      const subs = md.getSubtypesFor(first)
      if (subs.length > 0) {
        setSubType(subs[0])
        const cals = md.getCalibersFor(first, subs[0])
        if (cals.length > 0) setCaliber(cals[0])
      }
    }
  }, [md.loading, md.weaponTypeLabels, weaponType])

  useEffect(() => {
    setSerials(Array.from({ length: quantity }, () => ""))
  }, [quantity])

  useEffect(() => {
    if (step === 2 && inputRefs.current[0]) inputRefs.current[0]?.focus()
  }, [step])

  // Derived values
  const finalCost = useMemo(() => {
    try {
      return Number(calculateDraftFinalCostInCurrency(
        purchasePrice || "0",
        currency,
        additionalCosts,
        (amount, from, to) => CurrencyService.convert(amount, from, to),
      ))
    } catch { return Number(purchasePrice) || 0 }
  }, [additionalCosts, currency, purchasePrice])

  const subTypeOptions = useMemo(() => md.getSubtypesFor(weaponType), [md, weaponType])
  const availableCalibers = useMemo(() => md.getCalibersFor(weaponType, subType), [md, weaponType, subType])

  const brandOptions = useMemo(() => {
    const usedForType = weapons.filter((weapon) => weapon.weaponType === weaponType).map((weapon) => weapon.brand).filter(Boolean)
    const merged = new Set(usedForType.length > 0 ? usedForType : md.brandLabels)
    return Array.from(merged).sort()
  }, [md.brandLabels, weaponType, weapons])

  const modelOptions = useMemo(() => {
    const brandId = md.getBrandIdByLabel(brand)
    const usedForSelection = weapons
      .filter((weapon) => weapon.weaponType === weaponType && (!brand || weapon.brand === brand))
      .map((weapon) => weapon.model)
      .filter(Boolean)
    const masterForBrand = md.models.filter((item) => !brandId || item.brand_id === brandId).map((item) => item.label)
    const merged = new Set(usedForSelection.length > 0 ? usedForSelection : masterForBrand)
    return Array.from(merged).sort()
  }, [brand, md, weaponType, weapons])

  const predictedPrefix = useMemo(() => predictSerialPrefix(serials), [serials])
  const suggestion = useMemo(() => {
    if (!predictedPrefix) return null
    return nextSerialSuggestion(serials, predictedPrefix)
  }, [predictedPrefix, serials])
  const filledCount = serials.filter(s => s.trim().length > 0).length
  const serialMismatch = quantity - filledCount
  const duplicateSerials = useMemo(() => {
    const counts = new Map<string, number>()
    for (const serial of serials) {
      const key = serial.trim().toLocaleLowerCase()
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const existing = new Set(weapons.map((weapon) => weapon.serialNumber.trim().toLocaleLowerCase()))
    return new Set(Array.from(counts.entries()).filter(([key, count]) => count > 1 || existing.has(key)).map(([key]) => key))
  }, [serials, weapons])
  const serialsValid = filledCount === quantity && duplicateSerials.size === 0

  // Validation
  const validateStep1 = (): boolean => {
    const e: Record<string, string> = {}
    if (!brand.trim()) e.brand = "Brand is required"
    if (!model.trim()) e.model = "Model is required"
    if (!purchasePrice || Number(purchasePrice) <= 0) e.purchasePrice = "Must be > 0"
    if (!areProductCostsValid(additionalCosts)) e.additionalCosts = "Invalid additional cost"
    if (!pricingValuesAreValid(finalCost, retailPrice, wholesalePrice, settings.minProfitMarginPercent)) {
      e.retailPrice = "Prices must cover cost and margin"
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const nextDisabledReason = useMemo(() => {
    if (!brand.trim()) return t("bulk.nextDisabled.noBrand")
    if (!model.trim()) return t("bulk.nextDisabled.noModel")
    if (!purchasePrice || Number(purchasePrice) <= 0) return t("bulk.nextDisabled.noPurchasePrice")
    if (!areProductCostsValid(additionalCosts)) return t("bulk.nextDisabled.invalidCosts")
    if (!pricingValuesAreValid(finalCost, retailPrice, wholesalePrice, settings.minProfitMarginPercent))
      return t("bulk.nextDisabled.lowMargin")
    return null
  }, [brand, model, purchasePrice, additionalCosts, finalCost, retailPrice, wholesalePrice, settings.minProfitMarginPercent, t])

  // Handlers
  const handleNextStep = () => {
    if (!validateStep1()) return
    setStep(2)
  }

  const handleTypeChange = (v: string) => {
    setWeaponType(v)
    const subs = md.getSubtypesFor(v)
    if (subs.length > 0) {
      setSubType(subs[0])
      const cals = md.getCalibersFor(v, subs[0])
      setCaliber(cals[0] ?? "")
    }
    const compatibleBrands = weapons.filter((weapon) => weapon.weaponType === v).map((weapon) => weapon.brand)
    if (compatibleBrands.length > 0 && !compatibleBrands.includes(brand)) {
      setBrand(compatibleBrands[0])
      setModel("")
    }
  }

  const handleSubTypeChange = (v: string) => {
    setSubType(v)
    const cals = md.getCalibersFor(weaponType, v)
    setCaliber(cals[0] ?? "")
  }

  const handleCaliberChange = async (v: string) => {
    setCaliber(v)
    const caliberId = md.getCaliberIdByLabel(v) ?? await md.createCaliber(v)
    const typeId = md.getWeaponTypeIdByLabel(weaponType)
    const subtypeId = md.getWeaponSubtypeIdByLabel(subType, typeId)
    if (subtypeId) await md.linkSubtypeCaliber(subtypeId, caliberId)
  }

  const handleSerialChange = (index: number, value: string) => {
    const next = [...serials]
    next[index] = value
    setSerials(next)
  }

  const handleSerialKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      if (suggestion && !serials[index].trim() && predictedPrefix)
        handleSerialChange(index, suggestion)
      if (index < serials.length - 1) {
        inputRefs.current[index + 1]?.focus()
        setActiveSerialIndex(index + 1)
      }
    }
    if (e.key === "ArrowDown" && index < serials.length - 1) {
      e.preventDefault()
      inputRefs.current[index + 1]?.focus()
      setActiveSerialIndex(index + 1)
    }
    if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault()
      inputRefs.current[index - 1]?.focus()
      setActiveSerialIndex(index - 1)
    }
  }

  const fillAllWithSuggestion = () => {
    if (!suggestion || !predictedPrefix) return
    const next = [...serials]
    let counter = parseInt(suggestion.replace(predictedPrefix, ""), 10)
    for (let i = 0; i < next.length; i++) {
      if (!next[i].trim()) {
        next[i] = `${predictedPrefix}${counter.toString().padStart(5, "0")}`
        counter++
      }
    }
    setSerials(next)
    toast.success(t("bulk.autoFillSerials"))
  }

  const handleSubmit = async () => {
    if (submitting || !serialsValid) return
    if (!areProductCostsValid(additionalCosts)) {
      toast.error(t("cost.checkAmount"))
      return
    }
    setSubmitting(true)
    try {
      const weaponTypeId = md.getWeaponTypeIdByLabel(weaponType) ?? await md.createWeaponType(weaponType)
      const weaponSubtypeId = md.getWeaponSubtypeIdByLabel(subType, weaponTypeId) ?? await md.createWeaponSubtype(weaponType, subType)
      const caliberId = md.getCaliberIdByLabel(caliber) ?? await md.createCaliber(caliber)
      const brandId = md.getBrandIdByLabel(brand.trim()) ?? await md.createBrand(brand.trim())
      const modelId = md.getModelIdByLabel(model.trim(), brandId) ?? await md.createModel(model.trim(), brand.trim())
      const storageLocationId = md.getStorageLocationId("Main", "", "") || ""
      await md.linkSubtypeCaliber(weaponSubtypeId, caliberId)

      const result = await InventoryService.executeBulkIntake({
        weaponTypeId, weaponSubtypeId, caliberId, brandId, modelId, storageLocationId,
        weaponTypeLabel: weaponType, subTypeLabel: subType, caliberLabel: caliber,
        brandLabel: brand.trim(), modelLabel: model.trim(), condition,
        purchasePrice: Number(purchasePrice), retailPrice: Number(retailPrice),
        wholesalePrice: Number(wholesalePrice), retailPriceMode, wholesalePriceMode,
        currency, supplierId: "", shipmentId: null, serialNumbers: serials, notes: "", additionalCosts,
      })
      if (!result.success) {
        await useStore.getState().refreshFromDb()
        toast.error(result.error?.toLowerCase().includes("duplicate") ? t("bulk.duplicateSerial") : t("toast.importError"), {
          description: result.error,
        })
        return
      }
      if (result.added > 0) {
        toast.success(t("toast.importSuccess"))
        onComplete()
      }
    } catch (error) {
      toast.error(t("toast.importError"), { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setSubmitting(false)
    }
  }

  // ============================
  // Render - all hooks above this
  // ============================
  return (
    <div className="flex flex-col gap-4">
      {md.loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <Spinner className="size-4" />
          <span className="text-xs">{t("bulk.loadingClassification")}</span>
        </div>
      ) : (
        <>
          {/* Step indicator */}
          <div className="flex items-center gap-2 text-xs">
            <div className={`flex items-center gap-1.5 ${step === 1 ? "text-primary font-medium" : "text-muted-foreground"}`}>
              <div className={`flex size-5 items-center justify-center rounded-full text-[10px] ${step === 1 ? "bg-primary text-primary-foreground" : "bg-muted"}`}>1</div>
              <span>{t("bulk.step.weapons")}</span>
            </div>
            <Separator className="flex-1" />
            <div className={`flex items-center gap-1.5 ${step === 2 ? "text-primary font-medium" : "text-muted-foreground"}`}>
              <div className={`flex size-5 items-center justify-center rounded-full text-[10px] ${step === 2 ? "bg-primary text-primary-foreground" : "bg-muted"}`}>2</div>
              <span>{t("bulk.serial")}</span>
            </div>
          </div>

          {step === 1 && (
            <div className="flex flex-col gap-6">
              {/* Weapon Details */}
              <div>
                <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <Package className="size-3.5" /> {t("bulk.weaponDetails")}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">{t("bulk.weaponType")}</Label>
                    <SearchableCombobox
                      value={weaponType}
                      onValueChange={handleTypeChange}
                      options={md.weaponTypeLabels}
                      allowCreate onCreateNew={(v) => md.createWeaponType(v)}
                      placeholder={t("bulk.weaponType")}
                      searchPlaceholder={t("common.search")}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">{t("bulk.subType")}</Label>
                    <SearchableCombobox
                      value={subType}
                      onValueChange={handleSubTypeChange}
                      options={subTypeOptions}
                      placeholder={t("bulk.subType")}
                      searchPlaceholder={t("common.search")}
                      allowCreate onCreateNew={(v) => md.createWeaponSubtype(weaponType, v)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">{t("bulk.caliber")}</Label>
                    <SearchableCombobox
                      value={caliber}
                      onValueChange={(value) => { void handleCaliberChange(value) }}
                      options={availableCalibers}
                      placeholder={t("bulk.caliber")}
                      searchPlaceholder={t("common.search")}
                      allowCreate onCreateNew={(value) => { void handleCaliberChange(value) }}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">{t("bulk.condition")}</Label>
                    <Select value={condition} onValueChange={(v) => setCondition(v as WeaponCondition)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CONDITIONS.map((c) => <SelectItem key={c} value={c}>{t(`status.${c}`)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">{t("bulk.brand")} <span className="text-destructive">*</span></Label>
                    <SearchableCombobox
                      value={brand}
                      onValueChange={setBrand}
                      options={brandOptions}
                      placeholder={t("bulk.brandExample")}
                      searchPlaceholder={t("common.search")}
                      allowCreate onCreateNew={(v) => { md.createBrand(v); setBrand(v) }}
                      className="h-8 text-xs"
                    />
                    {errors.brand && <span className="text-[10px] text-destructive">{errors.brand}</span>}
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">{t("bulk.model")} <span className="text-destructive">*</span></Label>
                    <SearchableCombobox
                      value={model}
                      onValueChange={setModel}
                      options={modelOptions}
                      placeholder={t("bulk.modelExample")}
                      searchPlaceholder={t("common.search")}
                      allowCreate onCreateNew={(v) => { md.createModel(v, brand); setModel(v) }}
                      className="h-8 text-xs"
                    />
                    {errors.model && <span className="text-[10px] text-destructive">{errors.model}</span>}
                  </div>
                </div>
              </div>

              {/* Pricing & Costs */}
              <div>
                <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <Banknote className="size-3.5" /> {t("bulk.pricingAndCosts")}
                </h3>
                <PricingSection
                  purchasePrice={purchasePrice}
                  onPurchasePriceChange={setPurchasePrice}
                  currency={currency}
                  onCurrencyChange={setCurrency}
                  quantity={quantity}
                  onQuantityChange={setQuantity}
                  additionalCosts={additionalCosts}
                  onAdditionalCostsChange={setAdditionalCosts}
                  finalCost={finalCost}
                  retailPrice={retailPrice}
                  retailPriceMode={retailPriceMode}
                  onRetailChange={(next) => { setRetailPrice(next.value); setRetailPriceMode(next.mode) }}
                  wholesalePrice={wholesalePrice}
                  wholesalePriceMode={wholesalePriceMode}
                  onWholesaleChange={(next) => { setWholesalePrice(next.value); setWholesalePriceMode(next.mode) }}
                  errors={errors}
                />
              </div>

              {/* Next button with tooltip */}
              <div className="flex justify-end border-t pt-4">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-block">
                        <Button
                          size="sm"
                          disabled={!!nextDisabledReason}
                          onClick={handleNextStep}
                        >
                          {t("bulk.nextStep")} <ChevronRight className="size-3.5 ml-1" />
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {nextDisabledReason && (
                      <TooltipContent side="top">
                        {nextDisabledReason}
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between rounded-md border bg-muted/30 p-2">
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground">{t("bulk.enteringSerials")}</span>
                  <span className="text-xs font-medium">{brand} {model} ({weaponType}/{subType}, {caliber})</span>
                </div>
                <Badge variant="secondary" className="tabular-nums text-[10px]">{t("bulk.serialProgress", { filled: filledCount, total: serials.length })}</Badge>
              </div>

              {suggestion && predictedPrefix && (
                <div className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 p-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-3.5 text-primary" />
                    <div className="flex flex-col">
                      <span className="text-[11px] font-medium">{t("bulk.predictPrefix")}</span>
                      <span className="text-[10px] text-muted-foreground">{t("bulk.prefixNext", { prefix: predictedPrefix, next: suggestion })}</span>
                    </div>
                  </div>
                  <Button size="xs" variant="outline" onClick={fillAllWithSuggestion}><Sparkles className="size-3" /> {t("bulk.autoFillSerials")}</Button>
                </div>
              )}

              <div className="max-h-[280px] overflow-y-auto rounded-md border scrollbar-thin">
                {serials.map((sn, index) => {
                  const isDuplicate = duplicateSerials.has(sn.trim().toLocaleLowerCase())
                  return (
                  <div key={index} className={`flex items-center gap-2 border-b px-2 py-1.5 ${activeSerialIndex === index ? "bg-accent/50" : ""}`}>
                    <span className="w-5 text-end text-[10px] font-medium text-muted-foreground tabular-nums">{index + 1}</span>
                    <Input
                      ref={(el) => { inputRefs.current[index] = el }}
                      value={sn}
                      onChange={(e) => handleSerialChange(index, e.target.value)}
                      onKeyDown={(e) => handleSerialKeyDown(index, e)}
                      onFocus={() => setActiveSerialIndex(index)}
                      placeholder={`${t("bulk.serial")} #${index + 1}`}
                      aria-invalid={isDuplicate}
                      className={`h-7 font-mono text-[11px] ${isDuplicate ? "border-destructive text-destructive focus-visible:ring-destructive" : ""}`}
                    />
                    {isDuplicate ? <AlertCircle className="size-3.5 text-destructive" /> : sn.trim() && <Check className="size-3.5 text-green-600" />}
                  </div>
                  )
                })}
              </div>

              {duplicateSerials.size > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-[10px] text-destructive">
                  {t("bulk.duplicateSerial")}: {Array.from(duplicateSerials).join(", ")}
                </div>
              )}

              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <AlertCircle className="size-3" />
                {t("bulk.serialHint")}
              </div>

              {!serialsValid && (
                <div className="flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2">
                  <AlertCircle className="size-3.5 text-destructive" />
                  <span className="text-[10px] text-destructive">
                    {t("bulk.serialRemaining", { remaining: serialMismatch, filled: filledCount, total: quantity })}
                  </span>
                </div>
              )}

              <div className="flex justify-between">
                <Button size="sm" variant="outline" onClick={() => setStep(1)}>
                  <ChevronLeft className="size-3.5" /> {t("bulk.back")}
                </Button>
                <Button size="sm" onClick={handleSubmit} disabled={!serialsValid || submitting}>
                  {submitting ? <Spinner className="size-3.5" /> : <Plus className="size-3.5" />} {t("common.add")} {filledCount}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
