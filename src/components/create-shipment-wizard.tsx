import { useState, useMemo, useCallback, useEffect } from "react"
import {
  Truck, Check, ChevronRight, ChevronLeft, Plus, Trash2, Copy,
  Package, AlertCircle, CheckCircle2, DollarSign, Building2,
} from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useStore, type ShipmentLineItemInput } from "@/lib/store"
import { useI18n } from "@/lib/i18n"
import { generateShipmentNumber, formatDate } from "@/lib/format"
import type { ShipmentStatus } from "@/lib/types"
import { toast } from "sonner"
import { BulkSerialParserDialog } from "./bulk-serial-parser-dialog"
import { SearchableCombobox } from "@/components/ui/searchable-combobox"
import { DatePicker } from "@/components/ui/date-picker"
import { useDynamicMasterData } from "@/hooks/use-dynamic-master-data"
import { useCurrency } from "@/lib/currency-context"
import { multiplyMoney, sumMoney } from "@/lib/money-ui"

const SHIPMENT_STATUSES: ShipmentStatus[] = ["Pending", "In Transit", "Delayed", "Arrived", "Cancelled", "Partial"]
const PRODUCT_TYPES = ["weapon", "ammunition", "accessory"] as const

interface WizardLineItem extends ShipmentLineItemInput {
  id: string
  // label fields are already optional in ShipmentLineItemInput,
  // we will treat them as required for the wizard state but allow undefined.
}

interface CreateShipmentWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  prefillLineItems?: ShipmentLineItemInput[]
}

export function CreateShipmentWizard({ open, onOpenChange, prefillLineItems }: CreateShipmentWizardProps) {
  const { t } = useI18n()
  const shipments = useStore((s) => s.shipments)
  const suppliers = useStore((s) => s.suppliers)
  const md = useDynamicMasterData()
  const { currencies, transactionCurrency, formatOriginal } = useCurrency()
  const addSupplier = useStore((s) => s.addSupplier)
  const bulkCreate = useStore((s) => s.bulkCreateShipmentWithItems)

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
  const [actualArrivalDate, setActualArrivalDate] = useState("")
  const [initialStatus, setInitialStatus] = useState<ShipmentStatus>("Pending")
  const [notes, setNotes] = useState("")

  const [lineItems, setLineItems] = useState<WizardLineItem[]>([])
  const [serialParserOpen, setSerialParserOpen] = useState(false)
  const [serialParserTargetId, setSerialParserTargetId] = useState<string | null>(null)
  const [quickAddSupplierOpen, setQuickAddSupplierOpen] = useState(false)
  const [newSupName, setNewSupName] = useState("")
  const [newSupContact, setNewSupContact] = useState("")
  const [newSupPhone, setNewSupPhone] = useState("")

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
    setActualArrivalDate("")
    setInitialStatus("Pending")
    setNotes("")
    setLineItems([])
  }, [transactionCurrency])

  useEffect(() => {
    if (open && prefillLineItems && prefillLineItems.length > 0) {
      setStep(1)
      setLineItems(prefillLineItems.map((item) => ({
        ...item,
        id: `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        // Ensure label fields exist
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
      // FK IDs (will be filled on submit)
      weaponTypeId: "",
      weaponSubtypeId: "",
      caliberId: "",
      brandId: "",
      modelId: "",
      storageLocationId: "",
      // Labels
      weaponTypeLabel: "Pistol",
      subTypeLabel: "",
      caliberLabel: "",
      brandLabel: "",
      modelLabel: "",
      // Other fields
      quantity: 1,
      purchasePrice: 0,
      retailPrice: 0,
      wholesalePrice: 0,
      location: { warehouse: "Main", shelf: "", bin: "" },
      serialNumbers: [],
    }
    setLineItems((prev) => [...prev, newItem])
  }

  const updateLineItem = (id: string, updates: Partial<WizardLineItem>) => {
    setLineItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)))
  }

  const removeLineItem = (id: string) => {
    setLineItems((prev) => prev.filter((item) => item.id !== id))
  }

  const openSerialParser = (id: string) => {
    setSerialParserTargetId(id)
    setSerialParserOpen(true)
  }

  const handleSerialConfirm = (serials: string[]) => {
    if (serialParserTargetId) {
      updateLineItem(serialParserTargetId, { serialNumbers: serials, quantity: serials.length })
    }
    setSerialParserTargetId(null)
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
      for (const item of lineItems) {
        if (!(item.brandLabel ?? "").trim()) return false
        if (item.quantity <= 0) return false
        if (item.productType === "weapon" && item.serialNumbers.length !== item.quantity) return false
      }
      return true
    }
    if (step === 2) {
      return lineItems.filter((i) => i.productType === "weapon").every((i) => i.serialNumbers.length === i.quantity)
    }
    return true
  }, [step, shipmentNumber, supplierId, expectedArrivalDate, lineItems, currencies, currency])

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
    return { weapons, ammo, accessories, totalItems: weapons + ammo + accessories, totalCost: sumMoney(costs), totalRetail: sumMoney(retailValues) }
  }, [lineItems])

  const handleFinalSubmit = async () => {
    // Map label fields to FK IDs using master data
    const mappedLineItems: ShipmentLineItemInput[] = lineItems.map((item) => {
      const brandId = md.getBrandIdByLabel(item.brandLabel ?? "") ?? ""
      const modelId = md.getModelIdByLabel(item.modelLabel ?? "", brandId) ?? ""
      const weaponTypeId = md.getWeaponTypeIdByLabel(item.weaponTypeLabel ?? "") ?? ""
      const weaponSubtypeId = md.getWeaponSubtypeIdByLabel(item.subTypeLabel ?? "", weaponTypeId) ?? ""
      const caliberId = md.getCaliberIdByLabel(item.caliberLabel ?? "") ?? ""
      const storageLocationId = md.getStorageLocationId(
        item.location?.warehouse ?? "",
        item.location?.shelf ?? "",
        item.location?.bin ?? ""
      ) ?? ""

      return {
        ...item,
        brandId,
        modelId,
        weaponTypeId,
        weaponSubtypeId,
        caliberId,
        storageLocationId,
        // keep labels for audit
        brandLabel: item.brandLabel ?? "",
        modelLabel: item.modelLabel ?? "",
        weaponTypeLabel: item.weaponTypeLabel ?? "",
        subTypeLabel: item.subTypeLabel ?? "",
        caliberLabel: item.caliberLabel ?? "",
        location: item.location,
      }
    })

    const input = {
      shipment: {
        shipmentNumber, supplierId, shipmentDate, expectedArrivalDate,
        totalExpectedItems: totals.totalItems, attachments: [], notes,
        purchaseOrderNumber, invoiceNumber, shippingCarrier, containerNumber,
        currency, purchaseDate, actualArrivalDate: actualArrivalDate || undefined,
      },
      lineItems: mappedLineItems,
    }

    const result = await bulkCreate(input)
    if (result.success) {
      toast.success(t("ship.shipmentCreated"))
      resetWizard()
      onOpenChange(false)
    } else {
      toast.error(result.error ?? t("ship.shipmentFailed"))
    }
  }

  const handleNext = () => {
    if (step < 3) setStep(step + 1)
    else handleFinalSubmit()
  }

  const handleBack = () => {
    if (step > 0) setStep(step - 1)
  }

  const stepLabels = [
    t("ship.wizardStep1"),
    t("ship.wizardStep2"),
    t("ship.wizardStep3"),
    t("ship.wizardStep4"),
  ]

  const targetItem = serialParserTargetId ? lineItems.find((i) => i.id === serialParserTargetId) : null

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) resetWizard(); onOpenChange(v) }}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Truck className="size-4" /> {t("ship.createShipment")}
            </DialogTitle>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-1">
            {stepLabels.map((label, idx) => (
              <div key={idx} className="flex items-center flex-1">
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium ${idx === step ? "bg-primary text-primary-foreground" :
                  idx < step ? "bg-status-returned/20 text-status-returned-fg" : "bg-muted text-muted-foreground"
                  }`}>
                  <span className="flex size-4 items-center justify-center rounded-full text-[9px]">
                    {idx < step ? <CheckCircle2 className="size-3" /> : idx + 1}
                  </span>
                  <span className="hidden sm:inline">{label}</span>
                </div>
                {idx < stepLabels.length - 1 && (
                  <ChevronRight className="size-3 text-muted-foreground mx-0.5 rtl:rotate-180" />
                )}
              </div>
            ))}
          </div>

          <ScrollArea className="max-h-[55vh]">
            <div className="pe-2">
              {/* Step 0: Metadata */}
              {step === 0 && (
                <div className="grid gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">{t("ship.shipmentNumber")}</Label>
                      <div className="flex items-end gap-2">
                        <Input value={shipmentNumber} onChange={(e) => setShipmentNumber(e.target.value)} placeholder="Auto or manual" className="h-8 text-xs font-mono" />
                        <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => setShipmentNumber(generateShipmentNumber(shipments))}>{t("common.auto")}</Button>
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">{t("ship.supplier")}</Label>
                        <Button size="xs" variant="ghost" className="h-5 text-[10px]" onClick={() => setQuickAddSupplierOpen(true)}>
                          <Building2 className="size-3" /> {t("common.add")}
                        </Button>
                      </div>
                      <Select value={supplierId} onValueChange={setSupplierId}>
                        <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder={t("ship.supplier")} /></SelectTrigger>
                        <SelectContent>
                          {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">{t("ship.purchaseOrder")}</Label>
                      <Input value={purchaseOrderNumber} onChange={(e) => setPurchaseOrderNumber(e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div>
                      <Label className="text-xs">{t("ship.invoiceNumber")}</Label>
                      <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="h-8 text-xs" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">{t("ship.shippingCarrier")}</Label>
                      <Input value={shippingCarrier} onChange={(e) => setShippingCarrier(e.target.value)} placeholder="DHL, FedEx..." className="h-8 text-xs" />
                    </div>
                    <div>
                      <Label className="text-xs">{t("ship.containerNumber")}</Label>
                      <Input value={containerNumber} onChange={(e) => setContainerNumber(e.target.value)} className="h-8 text-xs" />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">{t("ship.currency")}</Label>
                      <Select value={currency} onValueChange={setCurrency}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {currencies.map((item) => (
                            <SelectItem key={item.isoCode} value={item.isoCode}>{item.isoCode} — {item.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">{t("ship.purchaseDate")}</Label>
                      <DatePicker value={purchaseDate} onChange={setPurchaseDate} className="h-8 text-xs" />
                    </div>
                    <div>
                      <Label className="text-xs">{t("ship.date")}</Label>
                      <DatePicker value={shipmentDate} onChange={setShipmentDate} className="h-8 text-xs" required />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">{t("ship.expectedArrival")}</Label>
                      <DatePicker value={expectedArrivalDate} onChange={setExpectedArrivalDate} min={shipmentDate} className="h-8 text-xs" required />
                    </div>
                    <div>
                      <Label className="text-xs">{t("ship.actualArrival")}</Label>
                      <DatePicker value={actualArrivalDate} onChange={setActualArrivalDate} min={shipmentDate} className="h-8 text-xs" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">{t("common.status")}</Label>
                      <Select value={initialStatus} onValueChange={(v) => setInitialStatus(v as ShipmentStatus)}>
                        <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SHIPMENT_STATUSES.map((s) => {
                            const key = s === "In Transit" ? "ship.inTransit" :
                              s === "Pending" ? "ship.pending" :
                                s === "Arrived" ? "ship.arrived" :
                                  s === "Delayed" ? "ship.delayed" :
                                    s === "Cancelled" ? "ship.cancelled" : "ship.partial"
                            return <SelectItem key={s} value={s}>{t(key)}</SelectItem>
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs">{t("common.notes")}</Label>
                    <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[50px] text-xs" />
                  </div>
                </div>
              )}

              {/* Step 1: Line Items */}
              {step === 1 && (
                <div className="flex flex-col gap-3">
                  {lineItems.length === 0 && (
                    <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                      <Package className="size-8 opacity-30" />
                      <span className="text-xs">{t("ship.noLineItems")}</span>
                    </div>
                  )}
                  {lineItems.map((item, idx) => (
                    <div key={item.id} className="rounded-lg border p-2.5">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[11px] font-medium">#{idx + 1}</span>
                        <Button size="xs" variant="ghost" className="h-5 text-[10px] text-destructive" onClick={() => removeLineItem(item.id)}>
                          <Trash2 className="size-3" /> {t("common.delete")}
                        </Button>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        <div>
                          <Label className="text-[10px]">{t("common.type")}</Label>
                          <Select value={item.productType} onValueChange={(v) => updateLineItem(item.id, { productType: v as typeof item.productType })}>
                            <SelectTrigger className="mt-0.5 h-7 text-[11px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {PRODUCT_TYPES.map((pt) => <SelectItem key={pt} value={pt}>{t(`ship.prodType.${pt}`)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-[10px]">{t("common.warehouse")}</Label>
                          <SearchableCombobox value={item.location?.warehouse ?? ""} onValueChange={(v) => updateLineItem(item.id, { location: { ...item.location!, warehouse: v } })} options={md.warehouseLabels} placeholder="Warehouse" searchPlaceholder="Search" allowCreate onCreateNew={(v) => { md.createWarehouse(v); updateLineItem(item.id, { location: { ...item.location!, warehouse: v } }) }} className="mt-0.5 h-7 text-[11px]" />
                        </div>
                        <div>
                          <Label className="text-[10px]">{t("common.shelf")}</Label>
                          <SearchableCombobox value={item.location?.shelf ?? ""} onValueChange={(v) => updateLineItem(item.id, { location: { ...item.location!, shelf: v } })} options={md.getShelvesFor(item.location?.warehouse ?? "")} placeholder="Shelf" searchPlaceholder="Search" allowCreate onCreateNew={(v) => { md.createStorageLocation(item.location?.warehouse ?? "", v, item.location?.bin ?? ""); updateLineItem(item.id, { location: { ...item.location!, shelf: v } }) }} className="mt-0.5 h-7 text-[11px]" />
                        </div>
                        <div>
                          <Label className="text-[10px]">{t("common.bin")}</Label>
                          <SearchableCombobox value={item.location?.bin ?? ""} onValueChange={(v) => updateLineItem(item.id, { location: { ...item.location!, bin: v } })} options={md.getBinsFor(item.location?.warehouse ?? "", item.location?.shelf ?? "")} placeholder="Bin" searchPlaceholder="Search" allowCreate onCreateNew={(v) => { md.createStorageLocation(item.location?.warehouse ?? "", item.location?.shelf ?? "", v); updateLineItem(item.id, { location: { ...item.location!, bin: v } }) }} className="mt-0.5 h-7 text-[11px]" />
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-4 gap-2">
                        <div>
                          <Label className="text-[10px]">{t("weapon.brand")}</Label>
                          <SearchableCombobox value={item.brandLabel ?? ""} onValueChange={(v) => updateLineItem(item.id, { brandLabel: v })} options={md.brandLabels} placeholder="Brand" searchPlaceholder="Search" allowCreate onCreateNew={(v) => { md.createBrand(v); updateLineItem(item.id, { brandLabel: v }) }} className="mt-0.5 h-7 text-[11px]" />
                        </div>
                        <div>
                          <Label className="text-[10px]">{t("weapon.model")}</Label>
                          <SearchableCombobox value={item.modelLabel ?? ""} onValueChange={(v) => updateLineItem(item.id, { modelLabel: v })} options={md.modelLabels} placeholder="Model" searchPlaceholder="Search" allowCreate onCreateNew={(v) => { md.createModel(v, item.brandLabel ?? ""); updateLineItem(item.id, { modelLabel: v }) }} className="mt-0.5 h-7 text-[11px]" />
                        </div>
                        <div>
                          <Label className="text-[10px]">{t("weapon.caliber")}</Label>
                          <SearchableCombobox value={item.caliberLabel ?? ""} onValueChange={(v) => updateLineItem(item.id, { caliberLabel: v })} options={md.caliberLabels} placeholder="Caliber" searchPlaceholder="Search" allowCreate onCreateNew={(v) => { md.createCaliber(v); updateLineItem(item.id, { caliberLabel: v }) }} className="mt-0.5 h-7 text-[11px]" />
                        </div>
                        <div>
                          <Label className="text-[10px]">{t("common.quantity")}</Label>
                          <Input type="number" min={1} value={item.quantity} onChange={(e) => updateLineItem(item.id, { quantity: Number(e.target.value) })} className="mt-0.5 h-7 text-[11px]" />
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <div>
                          <Label className="text-[10px]">{t("common.purchasePrice")} ({currency})</Label>
                          <Input type="number" step="0.01" value={item.purchasePrice} onChange={(e) => updateLineItem(item.id, { purchasePrice: Number(e.target.value) })} className="mt-0.5 h-7 text-[11px]" />
                        </div>
                        <div>
                          <Label className="text-[10px]">{t("common.sellingPrice")} ({currency})</Label>
                          <Input type="number" step="0.01" value={item.retailPrice} onChange={(e) => updateLineItem(item.id, { retailPrice: Number(e.target.value) })} className="mt-0.5 h-7 text-[11px]" />
                        </div>
                        <div>
                          <Label className="text-[10px]">{t("ship.wholesalePrice")} ({currency})</Label>
                          <Input type="number" step="0.01" value={item.wholesalePrice} onChange={(e) => updateLineItem(item.id, { wholesalePrice: Number(e.target.value) })} className="mt-0.5 h-7 text-[11px]" />
                        </div>
                      </div>
                      {item.productType === "weapon" && (
                        <div className="mt-2 flex items-center gap-2">
                          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => openSerialParser(item.id)}>
                            <Copy className="size-3" /> {t("ship.bulkSerialEntry")}
                          </Button>
                          {item.serialNumbers.length > 0 ? (
                            <Badge variant="outline" className="text-[10px] bg-status-returned/10 text-status-returned-fg border-status-returned/30">
                              {item.serialNumbers.length} / {item.quantity} {t("ship.serials")}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              0 / {item.quantity} {t("ship.serials")}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={addLineItem}>
                    <Plus className="size-3.5" /> {t("ship.addLineItem")}
                  </Button>
                </div>
              )}

              {/* Step 2: Serial Numbers (summary) */}
              {step === 2 && (
                <div className="flex flex-col gap-3">
                  {lineItems.filter((i) => i.productType === "weapon").length === 0 && (
                    <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                      <CheckCircle2 className="size-8 text-status-returned" />
                      <span className="text-xs">{t("ship.noWeaponsToSerialize")}</span>
                    </div>
                  )}
                  {lineItems.filter((i) => i.productType === "weapon").map((item) => {
                    const match = item.serialNumbers.length === item.quantity
                    return (
                      <div key={item.id} className="rounded-lg border p-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Package className="size-4 text-muted-foreground" />
                            <span className="text-xs font-medium">{item.brandLabel ?? ""} {item.modelLabel ?? ""}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={`text-[10px] ${match ? "bg-status-returned/10 text-status-returned-fg border-status-returned/30" : "bg-status-sold/10 text-status-sold-fg border-status-sold/30"}`}>
                              {item.serialNumbers.length} / {item.quantity}
                            </Badge>
                            <Button size="xs" variant="outline" className="h-6 text-[10px]" onClick={() => openSerialParser(item.id)}>
                              <Copy className="size-3" /> {t("ship.editSerials")}
                            </Button>
                          </div>
                        </div>
                        {item.serialNumbers.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {item.serialNumbers.slice(0, 20).map((sn, i) => (
                              <Badge key={i} variant="outline" className="font-mono text-[9px] bg-status-returned/10 text-status-returned-fg border-status-returned/30">{sn}</Badge>
                            ))}
                            {item.serialNumbers.length > 20 && (
                              <Badge variant="outline" className="text-[9px] text-muted-foreground">
                                +{item.serialNumbers.length - 20} {t("ship.moreSerials")}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Step 3: Review */}
              {step === 3 && (
                <div className="flex flex-col gap-3">
                  <div className="rounded-lg border p-3">
                    <h4 className="mb-2 text-xs font-semibold">{t("ship.reviewHeader")}</h4>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div><span className="text-muted-foreground">{t("ship.shipmentNumber")}:</span> <span className="font-mono">{shipmentNumber}</span></div>
                      <div><span className="text-muted-foreground">{t("ship.supplier")}:</span> {supplierMap[supplierId]}</div>
                      <div><span className="text-muted-foreground">{t("ship.expectedArrival")}:</span> {formatDate(expectedArrivalDate)}</div>
                      <div><span className="text-muted-foreground">{t("ship.shippingCarrier")}:</span> {shippingCarrier || "—"}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
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

                  <div className="rounded-lg border p-3">
                    <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
                      <DollarSign className="size-3.5" /> {t("ship.financialBreakdown")}
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div><span className="text-muted-foreground">{t("ship.totalCost")}:</span> <span className="font-bold tabular-nums">{formatOriginal(totals.totalCost, currency)}</span></div>
                      <div><span className="text-muted-foreground">{t("ship.totalRetail")}:</span> <span className="font-bold tabular-nums">{formatOriginal(totals.totalRetail, currency)}</span></div>
                      <div className="col-span-2"><span className="text-muted-foreground">{t("ship.projectedProfit")}:</span> <span className="font-bold tabular-nums text-status-returned-fg">{formatOriginal(sumMoney([totals.totalRetail, -totals.totalCost]), currency)}</span></div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 rounded-md bg-status-reserved/10 p-2">
                    <AlertCircle className="size-3.5 text-status-reserved" />
                    <span className="text-[11px] text-status-reserved-fg">{t("ship.reviewConfirm")}</span>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => { resetWizard(); onOpenChange(false) }}>
              {t("common.cancel")}
            </Button>
            <div className="flex items-center gap-2">
              {step > 0 && (
                <Button size="sm" variant="outline" onClick={handleBack}>
                  <ChevronLeft className="size-3.5 rtl:rotate-180" /> {t("ship.wizardBack")}
                </Button>
              )}
              <Button size="sm" disabled={!stepValidation} onClick={handleNext}>
                {step < 3 ? (
                  <>{t("ship.wizardNext")} <ChevronRight className="size-3.5 rtl:rotate-180" /></>
                ) : (
                  <><Check className="size-3.5" /> {t("ship.completeShipment")}</>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Serial Parser Dialog */}
      {targetItem && (
        <Dialog open={serialParserOpen} onOpenChange={setSerialParserOpen}>
          <BulkSerialParserDialog
            open={serialParserOpen}
            onOpenChange={setSerialParserOpen}
            expectedQuantity={targetItem.quantity}
            onConfirm={handleSerialConfirm}
          />
        </Dialog>
      )}

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
