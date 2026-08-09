import { useState, useRef, useEffect, useMemo } from "react"
import { Plus, Sparkles, Check, AlertCircle, ChevronRight, ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { SearchableCombobox } from "@/components/ui/searchable-combobox"
import { useStore } from "@/lib/store"
import { useI18n } from "@/lib/i18n"
import { InventoryService } from "@/lib/services"
import { predictSerialPrefix, nextSerialSuggestion } from "@/lib/format"
import type { WeaponCondition } from "@/lib/types"
import { useDynamicMasterData } from "@/hooks/use-dynamic-master-data"
import { Spinner } from "@/components/ui/spinner"
import { hasAnyValidationErrors, validateFullCombination } from "@/lib/validation"
import { toast } from "sonner"
import { useCurrency } from "@/lib/currency-context"

const CONDITIONS: WeaponCondition[] = ["Excellent", "Good", "Fair", "Poor"]

export function BulkIntakeForm({ onComplete }: { onComplete: () => void }) {
  const { t } = useI18n()
  const suppliers = useStore((s) => s.suppliers)
  const shipments = useStore((s) => s.shipments)
  const weapons = useStore((s) => s.weapons)
  const md = useDynamicMasterData()
  const { currencies, transactionCurrency, currencyPresentation } = useCurrency()

  const [step, setStep] = useState(1)
  // Step 1 fields with safe defaults
  const [brand, setBrand] = useState("")
  const [model, setModel] = useState("")
  const [weaponType, setWeaponType] = useState("")
  const [subType, setSubType] = useState("")
  const [caliber, setCaliber] = useState("")
  const [condition, setCondition] = useState<WeaponCondition>("Good")
  const [purchasePrice, setPurchasePrice] = useState("")
  const [retailPrice, setRetailPrice] = useState("")
  const [wholesalePrice, setWholesalePrice] = useState("")
  const [currency, setCurrency] = useState(transactionCurrency)
  const [supplierId, setSupplierId] = useState("")
  const [shipmentId, setShipmentId] = useState<string>("none")
  const [notes, setNotes] = useState("")
  const [quantity, setQuantity] = useState(1)
  const [warehouse, setWarehouse] = useState("Main")
  const [shelf, setShelf] = useState("")
  const [bin, setBin] = useState("")

  // Step 2 fields
  const [serials, setSerials] = useState<string[]>([])
  const [activeSerialIndex, setActiveSerialIndex] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Seed defaults once master data loads
  useEffect(() => {
    if (!md.loading && md.weaponTypeLabels.length > 0 && !weaponType) {
      const firstType = md.weaponTypeLabels[0]
      setWeaponType(firstType)
      const subs = md.getSubtypesFor(firstType)
      if (subs.length > 0) {
        setSubType(subs[0])
        const cals = md.getCalibersFor(firstType, subs[0])
        if (cals.length > 0) setCaliber(cals[0])
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [md.loading])

  const subTypeOptions = useMemo(() => md.getSubtypesFor(weaponType), [md, weaponType])
  const availableCalibers = useMemo(() => md.getCalibersFor(weaponType, subType), [md, weaponType, subType])

  const brandOptions = useMemo(() => {
    const merged = new Set([...md.brandLabels, ...weapons.map(w => w.brand).filter(Boolean)])
    return Array.from(merged).sort()
  }, [md.brandLabels, weapons])

  const modelOptions = useMemo(() => {
    const merged = new Set([...md.modelLabels, ...weapons.map(w => w.model).filter(Boolean)])
    return Array.from(merged).sort()
  }, [md.modelLabels, weapons])

  // Compatibility validation (brand/type and type/caliber combinations)
  const compatErrors = useMemo(
    () => validateFullCombination(brand, weaponType, subType, caliber).filter((r) => !r.valid),
    [brand, weaponType, subType, caliber]
  )
  const hasCompatErrors = useMemo(
    () => hasAnyValidationErrors(brand, weaponType, subType, caliber),
    [brand, weaponType, subType, caliber]
  )

  useEffect(() => {
    setSerials(Array.from({ length: quantity }, () => ""))
  }, [quantity])

  useEffect(() => {
    if (step === 2 && inputRefs.current[0]) inputRefs.current[0]?.focus()
    console.log(`[BulkIntake] Navigation: Step ${step}`)
  }, [step])

  const predictedPrefix = useMemo(() => predictSerialPrefix(serials), [serials])
  const suggestion = useMemo(() => {
    if (!predictedPrefix) return null
    return nextSerialSuggestion(serials, predictedPrefix)
  }, [predictedPrefix, serials])
  const filledCount = serials.filter((s) => s.trim().length > 0).length
  const serialMismatch = quantity - filledCount
  const serialsValid = filledCount === quantity

  const validateStep1 = (): boolean => {
    const e: Record<string, string> = {}
    if (!brand.trim()) e.brand = "Brand is required"
    if (!model.trim()) e.model = "Model is required"
    if (!supplierId) e.supplierId = "Supplier is required"
    if (!purchasePrice || Number(purchasePrice) <= 0) e.purchasePrice = "Must be > 0"
    if (!retailPrice || Number(retailPrice) <= 0) e.retailPrice = "Must be > 0"
    if (!wholesalePrice || Number(wholesalePrice) <= 0) e.wholesalePrice = "Must be > 0"
    setErrors(e)
    if (Object.keys(e).length > 0) {
      console.log("[BulkIntake] Validation errors:", e)
    }
    return Object.keys(e).length === 0
  }

  const handleTypeChange = (v: string) => {
    setWeaponType(v)
    const subs = md.getSubtypesFor(v)
    if (subs.length > 0) {
      setSubType(subs[0])
      const cals = md.getCalibersFor(v, subs[0])
      setCaliber(cals[0] ?? "")
    }
  }

  const handleSubTypeChange = (v: string) => {
    setSubType(v)
    const cals = md.getCalibersFor(weaponType, v)
    if (cals.length > 0) setCaliber(cals[0])
  }

  const handleCaliberChange = (v: string) => {
    setCaliber(v)
    if (!md.caliberLabels.includes(v)) md.createCaliber(v)
  }

  const handleSubmit = async () => {
    // Map labels to IDs
    const weaponTypeId = md.getWeaponTypeIdByLabel(weaponType)
    const weaponSubtypeId = md.getWeaponSubtypeIdByLabel(subType, weaponTypeId)
    const caliberId = md.getCaliberIdByLabel(caliber)
    const brandId = md.getBrandIdByLabel(brand.trim())
    const modelId = md.getModelIdByLabel(model.trim(), brandId)
    const storageLocationId = md.getStorageLocationId(warehouse.trim(), shelf.trim(), bin.trim())

    // Validate required IDs
    if (!weaponTypeId || !weaponSubtypeId || !caliberId || !brandId || !modelId || !storageLocationId) {
      toast.error(t("bulk.missingMasterData"))
      return
    }

    const result = await InventoryService.executeBulkIntake({
      weaponTypeId,
      weaponSubtypeId,
      caliberId,
      brandId,
      modelId,
      storageLocationId,
      weaponTypeLabel: weaponType,
      subTypeLabel: subType,
      caliberLabel: caliber,
      brandLabel: brand.trim(),
      modelLabel: model.trim(),
      condition,
      purchasePrice: Number(purchasePrice),
      retailPrice: Number(retailPrice),
      wholesalePrice: Number(wholesalePrice),
      currency,
      supplierId,
      shipmentId: shipmentId === "none" ? null : shipmentId,
      serialNumbers: serials,
      notes,
    })


    if (result.added > 0) {
      toast.success(t("toast.importSuccess"))
      onComplete()
    }
    if (result.duplicates.length > 0) {
      toast.error(t("bulk.duplicateSerial"), {
        description: result.duplicates.slice(0, 3).join(", ") + (result.duplicates.length > 3 ? "..." : ""),
      })
    }
    if ('error' in result && result.error && !result.success) toast.error(t("toast.importError"))
  }

  const handleSerialChange = (index: number, value: string) => {
    const next = [...serials]; next[index] = value; setSerials(next)
  }

  const handleSerialKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      if (suggestion && !serials[index].trim() && predictedPrefix) handleSerialChange(index, suggestion)
      if (index < serials.length - 1) { inputRefs.current[index + 1]?.focus(); setActiveSerialIndex(index + 1) }
    }
    if (e.key === "ArrowDown" && index < serials.length - 1) { e.preventDefault(); inputRefs.current[index + 1]?.focus(); setActiveSerialIndex(index + 1) }
    if (e.key === "ArrowUp" && index > 0) { e.preventDefault(); inputRefs.current[index - 1]?.focus(); setActiveSerialIndex(index - 1) }
  }

  const fillAllWithSuggestion = () => {
    if (!suggestion || !predictedPrefix) return
    const next = [...serials]
    let counter = parseInt(suggestion.replace(predictedPrefix, ""), 10)
    for (let i = 0; i < next.length; i++) {
      if (!next[i].trim()) { next[i] = `${predictedPrefix}${counter.toString().padStart(5, "0")}`; counter++ }
    }
    setSerials(next)
    toast.success(t("bulk.autoFillSerials"))
  }

  const canProceed = validateStep1

  if (md.loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
        <Spinner className="size-4" />
        <span className="text-xs">{t("bulk.loadingClassification")}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className={`flex items-center gap-1.5 ${step >= 1 ? "text-foreground" : "text-muted-foreground"}`}>
          <div className={`flex size-5 items-center justify-center rounded-full text-[10px] font-medium ${step >= 1 ? "bg-primary text-primary-foreground" : "bg-muted"}`}>1</div>
          <span className="text-[11px] font-medium">{t("bulk.step.weapons")}</span>
        </div>
        <Separator className="flex-1" />
        <div className={`flex items-center gap-1.5 ${step >= 2 ? "text-foreground" : "text-muted-foreground"}`}>
          <div className={`flex size-5 items-center justify-center rounded-full text-[10px] font-medium ${step >= 2 ? "bg-primary text-primary-foreground" : "bg-muted"}`}>2</div>
          <span className="text-[11px] font-medium">{t("bulk.serial")}</span>
        </div>
      </div>

      {step === 1 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t("bulk.weaponType")}</Label>
            <SearchableCombobox
              value={weaponType}
              onValueChange={handleTypeChange}
              options={md.weaponTypeLabels}
              allowCreate
              onCreateNew={(v) => md.createWeaponType(v)}
              placeholder={t("bulk.weaponType")}
              searchPlaceholder={t("common.search")}
              className="h-8 text-xs"
              invalid={hasCompatErrors}
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
              allowCreate
              onCreateNew={(v) => md.createWeaponSubtype(weaponType, v)}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t("bulk.caliber")}</Label>
            <SearchableCombobox
              value={caliber}
              onValueChange={handleCaliberChange}
              options={availableCalibers}
              placeholder={t("bulk.caliber")}
              searchPlaceholder={t("common.search")}
              allowCreate
              onCreateNew={(v) => { md.createCaliber(v); setCaliber(v) }}
              className="h-8 text-xs"
              invalid={hasCompatErrors}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t("bulk.condition")}</Label>
            <Select value={condition} onValueChange={(v) => setCondition(v as WeaponCondition)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{CONDITIONS.map((c) => <SelectItem key={c} value={c}>{t(`status.${c}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t("bulk.brand")}</Label>
            <SearchableCombobox
              value={brand}
              onValueChange={setBrand}
              options={brandOptions}
              placeholder="e.g. Glock"
              searchPlaceholder={t("common.search")}
              allowCreate
              onCreateNew={(v) => { md.createBrand(v); setBrand(v) }}
              className="h-8 text-xs"
              invalid={hasCompatErrors}
            />
            {errors.brand && <span className="text-[10px] text-status-sold">{errors.brand}</span>}
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t("bulk.model")}</Label>
            <SearchableCombobox
              value={model}
              onValueChange={setModel}
              options={modelOptions}
              placeholder="e.g. G17"
              searchPlaceholder={t("common.search")}
              allowCreate
              onCreateNew={(v) => { md.createModel(v, brand); setModel(v) }}
              className="h-8 text-xs"
            />
            {errors.model && <span className="text-[10px] text-status-sold">{errors.model}</span>}
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t("bulk.supplier")}</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("bulk.supplier")} /></SelectTrigger>
              <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
            {errors.supplierId && <span className="text-[10px] text-status-sold">{errors.supplierId}</span>}
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t("bulk.shipmentOptional")}</Label>
            <Select value={shipmentId} onValueChange={setShipmentId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("bulk.noShipment")}</SelectItem>
                {shipments.filter((s) => s.status !== "Arrived").map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.shipmentNumber} ({t(`status.${s.status}`)})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label className="text-xs">{t("ship.currency")}</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {currencies.map((item) => (
                  <SelectItem key={item.isoCode} value={item.isoCode}>
                    {item.isoCode} — {currencyPresentation(item.isoCode).name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t("bulk.purchasePrice")} ({currencyPresentation(currency).compactSymbol})</Label>
            <Input type="number" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder="0" className="h-8 text-xs" />
            {errors.purchasePrice && <span className="text-[10px] text-status-sold">{errors.purchasePrice}</span>}
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t("bulk.retailPrice")} ({currencyPresentation(currency).compactSymbol})</Label>
            <Input type="number" value={retailPrice} onChange={(e) => setRetailPrice(e.target.value)} placeholder="0" className="h-8 text-xs" />
            {errors.retailPrice && <span className="text-[10px] text-status-sold">{errors.retailPrice}</span>}
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t("bulk.wholesalePrice")} ({currencyPresentation(currency).compactSymbol})</Label>
            <Input type="number" value={wholesalePrice} onChange={(e) => setWholesalePrice(e.target.value)} placeholder="0" className="h-8 text-xs" />
            {errors.wholesalePrice && <span className="text-[10px] text-status-sold">{errors.wholesalePrice}</span>}
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t("common.quantity")}</Label>
            <Input type="number" min={1} max={50} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} className="h-8 text-xs" />
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t("bulk.warehouse")}</Label>
            <SearchableCombobox
              value={warehouse}
              onValueChange={setWarehouse}
              options={md.warehouseLabels}
              placeholder="e.g. Main"
              searchPlaceholder={t("common.search")}
              allowCreate
              onCreateNew={(v) => { md.createWarehouse(v); setWarehouse(v) }}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t("bulk.shelf")}</Label>
            <SearchableCombobox
              value={shelf}
              onValueChange={setShelf}
              options={md.getShelvesFor(warehouse)}
              placeholder="e.g. A1"
              searchPlaceholder={t("common.search")}
              allowCreate
              onCreateNew={(v) => { md.createStorageLocation(warehouse, v, bin); setShelf(v) }}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t("bulk.bin")}</Label>
            <SearchableCombobox
              value={bin}
              onValueChange={setBin}
              options={md.getBinsFor(warehouse, shelf)}
              placeholder="e.g. 03"
              searchPlaceholder={t("common.search")}
              allowCreate
              onCreateNew={(v) => { md.createStorageLocation(warehouse, shelf, v); setBin(v) }}
              className="h-8 text-xs"
            />
          </div>

          {hasCompatErrors && compatErrors.length > 0 && (
            <div className="col-span-full flex flex-col gap-1 rounded-md border border-status-sold/40 bg-status-sold/5 p-2">
              {compatErrors.map((r, i) => (
                <span key={i} className="text-[10px] text-status-sold">{r.error}</span>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label className="text-xs">{t("common.notes")}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("bulk.notesPlaceholder")} className="h-8 text-xs" />
          </div>
          <div className="col-span-full flex justify-end">
            <Button size="sm" disabled={hasCompatErrors} onClick={() => { if (canProceed()) { setStep(2); console.log("[BulkIntake] Proceeding to Step 2: Serial Numbers") } }}>
              {t("bulk.step.weapons")} <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between rounded-md border bg-muted/30 p-2">
            <div className="flex flex-col">
              <span className="text-[10px] text-muted-foreground">{t("bulk.enteringSerials")}</span>
              <span className="text-xs font-medium">{brand} {model} ({t(`weaponType.${weaponType}`)}/{subType}, {caliber})</span>
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
            {serials.map((sn, index) => (
              <div key={index} className={`flex items-center gap-2 border-b px-2 py-1.5 ${activeSerialIndex === index ? "bg-accent/50" : ""}`}>
                <span className="w-5 text-end text-[10px] font-medium text-muted-foreground tabular-nums">{index + 1}</span>
                <Input ref={(el) => { inputRefs.current[index] = el }} value={sn} onChange={(e) => handleSerialChange(index, e.target.value)} onKeyDown={(e) => handleSerialKeyDown(index, e)} onFocus={() => setActiveSerialIndex(index)} placeholder={`${t("bulk.serial")} #${index + 1}`} className="h-7 font-mono text-[11px]" />
                {sn.trim() && <Check className="size-3.5 text-status-returned" />}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <AlertCircle className="size-3" />
            {t("bulk.serialHint")}
          </div>

          {!serialsValid && (
            <div className="flex items-center gap-1.5 rounded-md border border-status-sold/40 bg-status-sold/5 p-2">
              <AlertCircle className="size-3.5 text-status-sold" />
              <span className="text-[10px] text-status-sold">
                {t("bulk.serialRemaining", { remaining: serialMismatch, filled: filledCount, total: quantity })}
              </span>
            </div>
          )}

          <div className="flex justify-between">
            <Button size="sm" variant="outline" onClick={() => { setStep(1); console.log("[BulkIntake] Returning to Step 1") }}>
              <ChevronLeft className="size-3.5" /> {t("bulk.back")}
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={!serialsValid}>
              <Plus className="size-3.5" /> {t("common.add")} {filledCount}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
