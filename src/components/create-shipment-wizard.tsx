import { useState, useMemo, useCallback, useEffect } from "react"
import {
  Truck, Check, ChevronRight, ChevronLeft,
  Package, AlertCircle, CheckCircle2, DollarSign, Building2, FileText,
} from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { useStore, type ShipmentLineItemInput } from "@/lib/store"
import { useI18n } from "@/lib/i18n"
import { generateShipmentNumber, formatDate } from "@/lib/format"
import type { ShipmentAdditionalCostInput, ShipmentStatus } from "@/lib/types"
import { toast } from "sonner"
import { DatePicker } from "@/components/ui/date-picker"
import { useDynamicMasterData } from "@/hooks/use-dynamic-master-data"
import { useCurrency } from "@/lib/currency-context"
import { multiplyMoney, sumMoney } from "@/lib/money-ui"
import { CurrencyService } from "@/lib/currency-service"
import { calculatePercentageCost } from "@/lib/product-cost"
import { areProductCostsValid } from "./product-cost-editor"
import { ShipmentCostEditor } from "./shipment-cost-editor"
import { cn } from "@/lib/utils"
import { resolveManifestClassification } from "@/lib/shipment-workflow"
import { shipmentLineInputToManifestItem } from "@/lib/shipment-workflow"
import { ManifestItemsTable } from "@/components/shipments/manifest-items-table"
import type { ManifestItemPatch } from "@/lib/shipment-manifest"

const SHIPMENT_STATUSES: ShipmentStatus[] = ["In Transit", "Arrived"]
interface WizardLineItem extends ShipmentLineItemInput {
  id: string
}

interface CreateShipmentWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  prefillLineItems?: ShipmentLineItemInput[]
}

const STEP_LABELS: { id: number; labelKey: string; icon: React.ElementType }[] = [
  { id: 0, labelKey: "ship.wizardStep1", icon: FileText },
  { id: 1, labelKey: "ship.wizardStep2", icon: Package },
  { id: 2, labelKey: "cost.shipmentCosts", icon: DollarSign },
  { id: 3, labelKey: "ship.wizardStep4", icon: CheckCircle2 },
]

export function CreateShipmentWizard({ open, onOpenChange, prefillLineItems }: CreateShipmentWizardProps) {
  const { t } = useI18n()
  const shipments = useStore((s) => s.shipments)
  const suppliers = useStore((s) => s.suppliers)
  const md = useDynamicMasterData()
  const { currencies, transactionCurrency, formatOriginal } = useCurrency()
  const addSupplier = useStore((s) => s.addSupplier)
  const bulkCreate = useStore((s) => s.bulkCreateShipmentWithItems)
  const createShipment = useStore((s) => s.createShipment)

  const [step, setStep] = useState(0)
  const [shipmentNumber, setShipmentNumber] = useState("")
  const [supplierId, setSupplierId] = useState("")
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState("")
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [shippingCarrier, setShippingCarrier] = useState("")
  const [containerNumber, setContainerNumber] = useState("")
  const [currency, setCurrency] = useState(transactionCurrency)
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split("T")[0])
  const [shipmentDate, setShipmentDate] = useState(new Date().toISOString().split("T")[0])
  const [expectedArrivalDate, setExpectedArrivalDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().split("T")[0]
  })
  const [initialStatus, setInitialStatus] = useState<ShipmentStatus>("In Transit")
  const [notes, setNotes] = useState("")

  const [lineItems, setLineItems] = useState<WizardLineItem[]>([])
  const [additionalCosts, setAdditionalCosts] = useState<ShipmentAdditionalCostInput[]>([])
  const [shipmentCostsValid, setShipmentCostsValid] = useState(true)
  const [quickAddSupplierOpen, setQuickAddSupplierOpen] = useState(false)
  const [newSupName, setNewSupName] = useState("")
  const [newSupContact, setNewSupContact] = useState("")
  const [newSupPhone, setNewSupPhone] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [tableProcessing, setTableProcessing] = useState(false)

  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())

  const resetWizard = useCallback(() => {
    setStep(0)
    setShipmentNumber("")
    setSupplierId("")
    setPurchaseOrderNumber("")
    setInvoiceNumber("")
    setShippingCarrier("")
    setContainerNumber("")
    setCurrency(transactionCurrency)
    setPurchaseDate(new Date().toISOString().split("T")[0])
    setShipmentDate(new Date().toISOString().split("T")[0])
    setExpectedArrivalDate(() => { const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().split("T")[0] })
    setInitialStatus("In Transit")
    setNotes("")
    setLineItems([])
    setAdditionalCosts([])
    setShipmentCostsValid(true)
    setSelectedItemIds(new Set())
    setTableProcessing(false)
  }, [transactionCurrency])

  useEffect(() => {
    const sourceItems = prefillLineItems
    if (open && sourceItems && sourceItems.length > 0) {
      setStep(1)
      setLineItems(sourceItems.map((item) => ({
        ...item,
        id: `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        brandLabel: item.brandLabel ?? "",
        modelLabel: item.modelLabel ?? "",
        weaponTypeLabel: item.weaponTypeLabel ?? "",
        subTypeLabel: item.subTypeLabel ?? "",
        caliberLabel: item.caliberLabel ?? "",
      })))
    }
  }, [open, prefillLineItems])

  const supplierMap = useMemo(() => {
    const map: Record<string, string> = {}
    suppliers.forEach((s) => (map[s.id] = s.name))
    return map
  }, [suppliers])

  const addLineItem = () => {
    const newItem: WizardLineItem = {
      id: `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      productType: "weapon",
      weaponTypeId: "",
      weaponSubtypeId: "",
      caliberId: "",
      brandId: "",
      modelId: "",
      storageLocationId: "",
      weaponTypeLabel: "Pistol",
      subTypeLabel: "",
      caliberLabel: "",
      brandLabel: "",
      modelLabel: "",
      quantity: 1,
      purchasePrice: 0,
      retailPrice: 0,
      wholesalePrice: 0,
      retailPriceMode: "auto",
      wholesalePriceMode: "auto",
      serialNumbers: [],
    }
    setLineItems((prev) => [...prev, newItem])
  }

  const updateLineItem = (id: string, updates: Partial<WizardLineItem>) => {
    setLineItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)))
  }

  const removeLineItem = (id: string) => {
    setLineItems((current) => current.filter((item) => item.id !== id))
    setSelectedItemIds((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }


  const manifestTableItems = useMemo(
    () => lineItems.map((item, index) => shipmentLineInputToManifestItem(item, index, currency)),
    [currency, lineItems],
  )
  const manifestMissingFields = useMemo(
    () => new Map(lineItems.map((item) => {
      const missing: string[] = []
      if (item.quantity <= 0) missing.push("quantity")
      if (item.productType === "weapon") {
        if (!item.weaponTypeLabel?.trim()) missing.push("weapon type")
        if (!item.subTypeLabel?.trim()) missing.push("sub-type")
        if (!item.brandLabel?.trim()) missing.push("maker")
        if (!item.modelLabel?.trim()) missing.push("model")
        if (!item.caliberLabel?.trim()) missing.push("caliber")
        if (item.serialNumbers.length !== item.quantity) missing.push("serial numbers")
      } else if (item.productType === "ammunition" && !item.caliberLabel?.trim()) {
        missing.push("caliber")
      } else if (item.productType === "accessory" && !item.modelLabel?.trim()) {
        missing.push("product name")
      }
      return [item.id, missing] as const
    })),
    [lineItems],
  )

  const patchManualItem = (manifestItem: (typeof manifestTableItems)[number], patch: ManifestItemPatch) => {
    const updates: Partial<WizardLineItem> = {}
    if (patch.productType !== undefined) updates.productType = patch.productType ?? "weapon"
    if (patch.productName !== undefined && patch.productType === "accessory") updates.modelLabel = patch.productName ?? ""
    if (patch.weaponType !== undefined) updates.weaponTypeLabel = patch.weaponType ?? ""
    if (patch.category !== undefined) updates.subTypeLabel = patch.category ?? ""
    if (patch.productName !== undefined && manifestItem.productType !== "weapon") updates.modelLabel = patch.productName ?? ""
    if (patch.manufacturer !== undefined) updates.brandLabel = patch.manufacturer ?? ""
    if (patch.model !== undefined) updates.modelLabel = patch.model ?? ""
    if (patch.caliber !== undefined) updates.caliberLabel = patch.caliber ?? ""
    if (patch.quantity !== undefined) updates.quantity = Math.max(0, patch.quantity ?? 0)
    if (patch.unitPrice !== undefined) updates.purchasePrice = Math.max(0, patch.unitPrice ?? 0)
    if (patch.retailPrice !== undefined) updates.retailPrice = Math.max(0, patch.retailPrice ?? 0)
    if (patch.wholesalePrice !== undefined) updates.wholesalePrice = Math.max(0, patch.wholesalePrice ?? 0)
    if (patch.retailPriceMode !== undefined) updates.retailPriceMode = patch.retailPriceMode ?? "auto"
    if (patch.wholesalePriceMode !== undefined) updates.wholesalePriceMode = patch.wholesalePriceMode ?? "auto"
    if (patch.serialNumbers !== undefined) updates.serialNumbers = patch.serialNumbers ?? []
    if (patch.additionalCosts !== undefined) updates.additionalCosts = patch.additionalCosts ?? []
    if (patch.currency !== undefined && patch.currency) updates.currency = patch.currency
    if (patch.storageLocationId !== undefined) updates.storageLocationId = patch.storageLocationId ?? ""
    updateLineItem(manifestItem.id, updates)
  }

  const handleQuickAddSupplier = async () => {
    if (!newSupName.trim()) { toast.error(t("common.name")); return }
    const result = await addSupplier({
      name: newSupName.trim(), contactPerson: newSupContact.trim(),
      phone: newSupPhone.trim(), email: "", address: "",
    })
    if (result.success && result.supplier) {
      setSupplierId(result.supplier.id)
      toast.success(t("toast.shipmentCreated"))
      setQuickAddSupplierOpen(false)
      setNewSupName("")
      setNewSupContact("")
      setNewSupPhone("")
    } else {
      toast.error(result.error ?? "Failed")
    }
  }

  const stepValidation = useMemo(() => {
    if (step === 0) {
      if (!shipmentNumber.trim()) return false
      if (!supplierId) return false
      if (!expectedArrivalDate) return false
      if (!currencies.some((item) => item.isoCode === currency)) return false
      return true
    }
    if (step === 1) {
      if (lineItems.length === 0) return false
      if (lineItems.some((item) => item.productType === "weapon") && md.storageLocations.length === 0) return false
      for (const item of lineItems) {
        if (item.quantity <= 0) return false
        if (!areProductCostsValid(item.additionalCosts ?? [])) return false
        if (item.productType === "weapon" && (!(item.weaponTypeLabel ?? "").trim() || !(item.subTypeLabel ?? "").trim() || !(item.brandLabel ?? "").trim() || !(item.modelLabel ?? "").trim() || !(item.caliberLabel ?? "").trim() || item.serialNumbers.length !== item.quantity)) return false
        if (item.productType === "ammunition" && !(item.caliberLabel ?? "").trim()) return false
        if (item.productType === "accessory" && !(item.modelLabel ?? "").trim()) return false
      }
      return true
    }
    if (step === 2) {
      return shipmentCostsValid && additionalCosts.every((cost) => cost.name.trim().length > 0)
    }
    return true
  }, [step, shipmentNumber, supplierId, expectedArrivalDate, lineItems, currencies, currency, additionalCosts, shipmentCostsValid, md.storageLocations.length])

  const totals = useMemo(() => {
    let weapons = 0, ammo = 0, accessories = 0
    const costs: number[] = []
    const retailValues: number[] = []
    for (const item of lineItems) {
      costs.push(multiplyMoney(item.purchasePrice, item.quantity))
      retailValues.push(multiplyMoney(item.retailPrice, item.quantity))
      if (item.productType === "weapon") weapons += item.quantity
      else if (item.productType === "ammunition") ammo += item.quantity
      else accessories += item.quantity
    }
    const productSubtotal = sumMoney(costs)
    let productAdditional = 0
    for (const item of lineItems) {
      for (const cost of item.additionalCosts ?? []) {
        try {
          const amount = cost.calculationType === "fixed"
            ? Number(cost.amount || 0)
            : Number(calculatePercentageCost(CurrencyService.convert(item.purchasePrice, item.currency ?? currency, cost.currency), cost.percentageRate || "0", currencies.find((candidate) => candidate.isoCode === cost.currency)?.decimalPrecision ?? 2))
          productAdditional = sumMoney([productAdditional, multiplyMoney(CurrencyService.convert(amount, cost.currency, currency), item.quantity)])
        } catch {
          // Invalid optional costs are excluded from the preview and validated on submit.
        }
      }
    }
    let shipmentAdditional = 0
    for (const cost of additionalCosts) {
      try {
        const amount = cost.calculationType === "fixed"
          ? Number(cost.amount || 0)
          : Number(calculatePercentageCost(CurrencyService.convert(productSubtotal, currency, cost.currency), cost.percentageRate || "0", currencies.find((candidate) => candidate.isoCode === cost.currency)?.decimalPrecision ?? 2))
        shipmentAdditional = sumMoney([shipmentAdditional, CurrencyService.convert(amount, cost.currency, currency)])
      } catch {
        // Invalid optional costs are excluded from the preview and validated on submit.
      }
    }
    const additionalTotal = sumMoney([productAdditional, shipmentAdditional])
    return { weapons, ammo, accessories, totalItems: weapons + ammo + accessories, productSubtotal, productAdditional, shipmentAdditional, additionalTotal, totalCost: sumMoney([productSubtotal, additionalTotal]), totalRetail: sumMoney(retailValues) }
  }, [additionalCosts, currencies, currency, lineItems])

  const handleFinalSubmit = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      const mappedLineItems: ShipmentLineItemInput[] = await Promise.all(lineItems.map(async (item) => {
        let brandId = "", modelId = "", weaponTypeId = "", weaponSubtypeId = "", caliberId = ""
        if (item.productType === "weapon") {
          const classification = await resolveManifestClassification({
            productType: item.productType,
            weaponType: item.weaponTypeLabel ?? "",
            category: item.subTypeLabel ?? "",
            manufacturer: item.brandLabel ?? "",
            model: item.modelLabel ?? "",
            caliber: item.caliberLabel ?? "",
          }, md)
          weaponTypeId = classification.weaponTypeId ?? ""
          weaponSubtypeId = classification.weaponSubtypeId ?? ""
          brandId = classification.brandId ?? ""
          modelId = classification.modelId ?? ""
          caliberId = classification.caliberId ?? ""
        }
        const storageLocation = item.productType === "weapon" ? md.storageLocations[0] : undefined
        const warehouse = storageLocation ? md.warehouses.find((candidate) => candidate.id === storageLocation.warehouse_id) : undefined
        return {
          ...item,
          brandId, modelId, weaponTypeId, weaponSubtypeId, caliberId,
          storageLocationId: storageLocation?.id ?? "",
          brandLabel: item.brandLabel ?? "",
          modelLabel: item.modelLabel ?? "",
          weaponTypeLabel: item.weaponTypeLabel ?? "",
          subTypeLabel: item.subTypeLabel ?? "",
          caliberLabel: item.caliberLabel ?? "",
          location: storageLocation ? { warehouse: warehouse?.label ?? "", shelf: storageLocation.shelf, bin: storageLocation.bin } : undefined,
        }
      }))

      const shipment = {
        shipmentNumber, supplierId, shipmentDate, expectedArrivalDate,
        totalExpectedItems: totals.totalItems, attachments: [], notes,
        purchaseOrderNumber, invoiceNumber, shippingCarrier, containerNumber,
        currency, purchaseDate,
        status: initialStatus,
        lineItems: mappedLineItems,
        additionalCosts,
      }
      const input = {
        shipment,
        lineItems: mappedLineItems,
        additionalCosts,
      }

      const shouldReceiveInventory = initialStatus === "Arrived"
      const pendingResult = shouldReceiveInventory ? bulkCreate(input) : createShipment(shipment)
      // Both store actions insert an optimistic, non-openable row synchronously.
      // Close the wizard now so the user can see registration progress in the list.
      resetWizard()
      onOpenChange(false)
      const result = await pendingResult
      if (result.success) {
        toast.success(t("ship.shipmentCreated"))
      } else {
        toast.error(result.error ?? t("ship.shipmentFailed"))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("ship.shipmentFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  const handleNext = () => {
    if (step < 3) setStep(step + 1)
    else handleFinalSubmit()
  }

  const handleBack = () => {
    if (step > 0) setStep(step - 1)
  }

  // Dynamic dialog width based on step
  // Consistent dialog width across all steps
  const dialogMaxWidthClass = "w-[95vw] max-w-5xl";


  return (
    <>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: hsl(var(--muted) / 0.3); border-radius: 8px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: hsl(var(--muted-foreground) / 0.35); border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: hsl(var(--muted-foreground) / 0.55); }
        .custom-scrollbar { scrollbar-width: thin; scrollbar-color: hsl(var(--muted-foreground) / 0.35) hsl(var(--muted) / 0.2); }
      `}</style>

      <Dialog open={open} onOpenChange={(v) => { if (tableProcessing || submitting) return; if (!v) resetWizard(); onOpenChange(v) }}>
        <DialogContent
          onPointerDownOutside={(e) => e.preventDefault()}
          className={cn(
            "max-h-[95vh] flex flex-col transition-all duration-300",
            dialogMaxWidthClass
          )}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Truck className="size-4" /> {t("ship.createShipment")}
            </DialogTitle>
          </DialogHeader>

          {/* Step indicator */}
          <div className="shrink-0 flex items-center gap-1.5 px-1">
            {STEP_LABELS.map((s, i) => {
              const Icon = s.icon
              const isCompleted = step > s.id
              const isCurrent = step === s.id
              return (
                <div key={s.id} className="flex flex-1 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => { if (isCompleted && !tableProcessing) setStep(s.id) }}
                    disabled={tableProcessing || (!isCompleted && !isCurrent)}
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-medium transition-all duration-200",
                      isCompleted ? "bg-primary text-primary-foreground cursor-pointer hover:bg-primary/80" :
                        isCurrent ? "bg-primary text-primary-foreground ring-2 ring-primary/30 shadow-sm shadow-primary/20" :
                          "bg-muted text-muted-foreground"
                    )}
                    title={t(s.labelKey)}
                  >
                    {isCompleted ? <Check className="size-3" /> : <Icon className="size-3" />}
                  </button>
                  <span className={cn("hidden text-[10px] sm:inline", isCurrent ? "font-semibold" : "text-muted-foreground")}>{t(s.labelKey)}</span>
                  {i < STEP_LABELS.length - 1 && <div className={cn("h-px flex-1", isCompleted ? "bg-primary" : "bg-border")} />}
                </div>
              )
            })}
          </div>
          <Separator className="shrink-0" />

          {/* Scrollable content */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 custom-scrollbar" style={{ maxHeight: "calc(95vh - 13rem)" }}>
            {/* Step 0: Metadata */}
            {step === 0 && (
              <div className="space-y-4">
                <div>
                  <div>
                    <Label className="text-xs font-medium">{t("ship.shipmentNumber")}</Label>
                    <div className="flex items-end gap-2 mt-1">
                      <Input
                        value={shipmentNumber}
                        onChange={(e) => setShipmentNumber(e.target.value)}
                        placeholder={t("ship.shipmentNumberPlaceholder")}
                        className={cn("h-8 text-xs font-mono", !shipmentNumber.trim() && step === 0 && "border-destructive")}
                      />
                      <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => setShipmentNumber(generateShipmentNumber(shipments))}>
                        {t("common.auto")}
                      </Button>
                    </div>
                    {!shipmentNumber.trim() && step === 0 && (
                      <p className="text-[10px] text-destructive mt-1">{t("common.required")}</p>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">{t("ship.supplier")}</Label>
                      <Button size="xs" variant="ghost" className="h-5 text-[10px]" onClick={() => setQuickAddSupplierOpen(true)}>
                        <Building2 className="size-3" /> {t("common.add")}
                      </Button>
                    </div>
                    <Select value={supplierId} onValueChange={setSupplierId}>
                      <SelectTrigger className={cn("mt-1 h-8 text-xs", !supplierId && step === 0 && "border-destructive")}>
                        <SelectValue placeholder={t("ship.supplier")} />
                      </SelectTrigger>
                      <SelectContent>
                        {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {!supplierId && step === 0 && (
                      <p className="text-[10px] text-destructive mt-1">{t("common.required")}</p>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs font-medium">{t("ship.purchaseOrder")}</Label>
                    <Input value={purchaseOrderNumber} onChange={(e) => setPurchaseOrderNumber(e.target.value)} className="h-8 text-xs mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">{t("ship.invoiceNumber")}</Label>
                    <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="h-8 text-xs mt-1" />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs font-medium">{t("ship.shippingCarrier")}</Label>
                    <Input value={shippingCarrier} onChange={(e) => setShippingCarrier(e.target.value)} placeholder={t("ship.shippingCarrierPlaceholder")} className="h-8 text-xs mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">{t("ship.containerNumber")}</Label>
                    <Input value={containerNumber} onChange={(e) => setContainerNumber(e.target.value)} className="h-8 text-xs mt-1" />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label className="text-xs font-medium">{t("ship.currency")}</Label>
                    <Select value={currency} onValueChange={setCurrency}>
                      <SelectTrigger className={cn("mt-1 h-8 text-xs", !currencies.some(c => c.isoCode === currency) && step === 0 && "border-destructive")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {currencies.map((item) => (
                          <SelectItem key={item.isoCode} value={item.isoCode}>{item.isoCode} — {item.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs font-medium">{t("ship.purchaseDate")}</Label>
                    <DatePicker value={purchaseDate} onChange={setPurchaseDate} className="h-8 text-xs mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">{t("ship.date")}</Label>
                    <DatePicker value={shipmentDate} onChange={setShipmentDate} className="h-8 text-xs mt-1" required />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs font-medium">{t("ship.expectedArrival")}</Label>
                    <DatePicker
                      value={expectedArrivalDate}
                      onChange={setExpectedArrivalDate}
                      min={shipmentDate}
                      className={cn("h-8 text-xs mt-1", !expectedArrivalDate && step === 0 && "border-destructive")}
                      required
                    />
                    {!expectedArrivalDate && step === 0 && (
                      <p className="text-[10px] text-destructive mt-1">{t("common.required")}</p>
                    )}
                  </div>
                </div>

                <div>
                  <Label className="text-xs font-medium">{t("common.status")}</Label>
                  <Select value={initialStatus} onValueChange={(v) => setInitialStatus(v as ShipmentStatus)}>
                    <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SHIPMENT_STATUSES.map((s) => {
                        const key = s === "In Transit" ? "ship.inTransit" :
                          s === "Arrived" ? "ship.arrived" : "ship.inTransit"
                        return <SelectItem key={s} value={s}>{t(key)}</SelectItem>
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs font-medium">{t("common.notes")}</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[60px] text-xs mt-1" />
                </div>
              </div>
            )}

            {/* Step 1: Line Items */}
            {step === 1 && (
              <div className="flex flex-col gap-3">
                <div className="h-[min(28rem,55vh)] min-h-64 overflow-hidden rounded-lg border">
                  <ManifestItemsTable
                    mode="manual"
                    items={manifestTableItems}
                    selected={selectedItemIds}
                    missingFieldsById={manifestMissingFields}
                    currency={currency}
                    masterData={md}
                    onToggleSelected={(id, checked) => setSelectedItemIds((current) => {
                      const next = new Set(current)
                      if (checked) next.add(id); else next.delete(id)
                      return next
                    })}
                    onSelectVisible={(checked) => setSelectedItemIds(checked ? new Set(manifestTableItems.map((item) => item.id)) : new Set())}
                    onAddItem={addLineItem}
                    onDelete={(item) => removeLineItem(item.id)}
                    onBulkDelete={(items) => {
                      const ids = new Set(items.map((item) => item.id))
                      setLineItems((current) => current.filter((item) => !ids.has(item.id)))
                      setSelectedItemIds(new Set())
                    }}
                    onPatch={patchManualItem}
                    onBulkPatch={(items, patch) => Promise.all(items.map((item) => Promise.resolve(patchManualItem(item, patch)))).then(() => undefined)}
                    onProcessingChange={setTableProcessing}
                  />
                </div>
              </div>
            )}

            {/* Step 2: Shipment-level costs */}
            {step === 2 && (
              <ShipmentCostEditor
                items={lineItems.map((item) => ({
                  id: item.id,
                  label: `${item.brandLabel ?? ""} ${item.modelLabel ?? ""}`.trim() || item.productType,
                  value: item.purchasePrice,
                  quantity: item.quantity,
                }))}
                shipmentCurrency={currency}
                costs={additionalCosts}
                onChange={setAdditionalCosts}
                onValidityChange={setShipmentCostsValid}
              />
            )}

            {/* Step 3: Review */}
            {step === 3 && (
              <div className="flex flex-col gap-3">
                <div className="rounded-lg border p-3">
                  <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
                    <FileText className="size-3.5 text-primary" /> {t("ship.reviewHeader")}
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div><span className="text-muted-foreground">{t("ship.shipmentNumber")}:</span> <span className="font-mono">{shipmentNumber}</span></div>
                    <div><span className="text-muted-foreground">{t("ship.supplier")}:</span> {supplierMap[supplierId]}</div>
                    <div><span className="text-muted-foreground">{t("ship.expectedArrival")}:</span> {formatDate(expectedArrivalDate)}</div>
                    <div><span className="text-muted-foreground">{t("ship.shippingCarrier")}:</span> {shippingCarrier || "—"}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-md border p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">{t("ship.prodType.weapon")}</div>
                    <div className="text-lg font-bold tabular-nums">{totals.weapons}</div>
                  </div>
                  <div className="rounded-md border p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">{t("ship.prodType.ammunition")}</div>
                    <div className="text-lg font-bold tabular-nums">{totals.ammo}</div>
                  </div>
                  <div className="rounded-md border p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">{t("ship.prodType.accessory")}</div>
                    <div className="text-lg font-bold tabular-nums">{totals.accessories}</div>
                  </div>
                  <div className="rounded-md border p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">{t("common.total")}</div>
                    <div className="text-lg font-bold tabular-nums">{totals.totalItems}</div>
                  </div>
                </div>

                <Separator />

                <div className="rounded-lg bg-muted/30 p-3">
                  <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
                    <DollarSign className="size-3.5" /> {t("ship.financialBreakdown")}
                  </h4>
                  <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 text-[11px]">
                    <span className="text-muted-foreground">{t("cost.productSubtotal")}</span><span className="text-end font-medium tabular-nums" dir="ltr">{formatOriginal(totals.productSubtotal, currency)}</span>
                    <span className="text-muted-foreground">{t("cost.additionalCosts")}</span><span className="text-end font-medium tabular-nums" dir="ltr">+ {formatOriginal(totals.additionalTotal, currency)}</span>
                    <Separator className="col-span-2" />
                    <span className="font-semibold">{t("cost.totalShipmentCost")}</span><span className="text-end text-base font-bold tabular-nums text-primary" dir="ltr">{formatOriginal(totals.totalCost, currency)}</span>
                    <span className="text-muted-foreground">{t("cost.allocation")}</span><span className="inline-flex items-center justify-end gap-1 font-medium"><CheckCircle2 className="size-3.5" /> {t("cost.balanced")}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-md bg-status-reserved/10 p-2">
                  <AlertCircle className="size-3.5 text-status-reserved" />
                  <span className="text-[11px] text-status-reserved-fg">{t("ship.reviewConfirm")}</span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0 gap-2 sm:justify-between pt-2 border-t">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {!stepValidation && (
                <span className="text-destructive flex items-center gap-1">
                  <AlertCircle className="size-3" /> {t("common.requiredFieldsMissing")}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={tableProcessing || submitting} onClick={() => { resetWizard(); onOpenChange(false) }}>
                {t("common.cancel")}
              </Button>
              {step > 0 && (
                <Button size="sm" variant="outline" disabled={tableProcessing || submitting} onClick={handleBack}>
                  <ChevronLeft className="size-3.5 rtl:rotate-180" /> {t("ship.wizardBack")}
                </Button>
              )}
              <Button size="sm" disabled={!stepValidation || submitting || tableProcessing} onClick={handleNext}>
                {step < 3 ? (
                  <>{t("ship.wizardNext")} <ChevronRight className="size-3.5 rtl:rotate-180" /></>
                ) : (
                  <><Check className="size-3.5" /> {initialStatus === "Arrived" ? t("cost.confirmReceive") : t("ship.createShipment")}</>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Add Supplier Dialog */}
      <Dialog open={quickAddSupplierOpen} onOpenChange={setQuickAddSupplierOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm">{t("ship.supplier")}</DialogTitle></DialogHeader>
          <div className="grid gap-2">
            <div><Label className="text-xs">{t("common.name")}</Label><Input value={newSupName} onChange={(e) => setNewSupName(e.target.value)} className="h-8 text-xs" /></div>
            <div><Label className="text-xs">{t("common.contact")}</Label><Input value={newSupContact} onChange={(e) => setNewSupContact(e.target.value)} className="h-8 text-xs" /></div>
            <div><Label className="text-xs">{t("common.phone")}</Label><Input value={newSupPhone} onChange={(e) => setNewSupPhone(e.target.value)} className="h-8 text-xs" /></div>
          </div>
          <DialogFooter><Button size="sm" onClick={handleQuickAddSupplier}>{t("common.add")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>


    </>
  )
}
