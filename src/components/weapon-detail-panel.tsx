import { memo, useEffect, useState, type ChangeEvent, type ReactNode } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ChevronDown, Package, History, Receipt, ImageIcon, StickyNote, Upload, Pencil, Loader2, Info,
} from "lucide-react"
import { useStore } from "@/lib/store"
import { useNav } from "@/lib/nav"
import { useI18n } from "@/lib/i18n"
import { useCurrency } from "@/lib/currency-context"
import {
  formatDate, formatDateTime, statusBadgeClass, statusDotClass,
} from "@/lib/format"
import type { PricingMode, WeaponStatus } from "@/lib/types"
import type { ProductAdditionalCostInput } from "@/lib/types"
import { toast } from "sonner"
import { ProductCostEditor } from "./product-cost-editor"
import { PricingSection } from "./pricing-section"
import { hasPermission } from "@/lib/rbac"
import { useDynamicMasterData } from "@/hooks/use-dynamic-master-data"

export const WeaponDetailPanel = memo(function WeaponDetailPanel({
  weaponId, open, onOpenChange,
}: { weaponId: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const weapons = useStore((s) => s.weapons)
  const suppliers = useStore((s) => s.suppliers)
  const invoices = useStore((s) => s.invoices)
  const shipments = useStore((s) => s.shipments)
  const updateWeaponStatus = useStore((s) => s.updateWeaponStatus)
  const updateWeaponDetails = useStore((s) => s.updateWeaponDetails)
  const updateWeaponNotes = useStore((s) => s.updateWeaponNotes)
  const addWeaponImage = useStore((s) => s.addWeaponImage)
  const bindWeaponToShipment = useStore((s) => s.bindWeaponToShipment)
  const updateProductCosts = useStore((s) => s.updateProductCosts)
  const currentUser = useStore((s) => s.getCurrentUser())
  const canEdit = hasPermission(currentUser, "inventory.edit")
  const canManageShipments = hasPermission(currentUser, "shipment.import") || hasPermission(currentUser, "shipment.review")
    || hasPermission(currentUser, "shipment.edit") || hasPermission(currentUser, "shipment.receive")
  const md = useDynamicMasterData()
  const { formatValuation, formatInvoice, formatOriginal, formatAccountingAggregate, transactionCurrency } = useCurrency()
  const { navigate } = useNav()
  const { t } = useI18n()
  const [notesDraft, setNotesDraft] = useState("")
  const [editingCosts, setEditingCosts] = useState(false)
  const [costBreakdownOpen, setCostBreakdownOpen] = useState(false)
  const [costDrafts, setCostDrafts] = useState<ProductAdditionalCostInput[]>([])
  const [editingDetails, setEditingDetails] = useState(false)
  const [savingDetails, setSavingDetails] = useState(false)
  const [serialDraft, setSerialDraft] = useState("")
  const [weaponTypeDraft, setWeaponTypeDraft] = useState("")
  const [subtypeDraft, setSubtypeDraft] = useState("")
  const [caliberDraft, setCaliberDraft] = useState("")
  const [brandDraft, setBrandDraft] = useState("")
  const [modelDraft, setModelDraft] = useState("")
  const [conditionDraft, setConditionDraft] = useState("")
  const [supplierDraft, setSupplierDraft] = useState("")
  const [locationDraft, setLocationDraft] = useState("")
  const [currencyDraft, setCurrencyDraft] = useState(transactionCurrency)
  const [purchaseDraft, setPurchaseDraft] = useState("0")
  const [retailDraft, setRetailDraft] = useState({ value: "0", mode: "manual" as PricingMode })
  const [wholesaleDraft, setWholesaleDraft] = useState({ value: "0", mode: "manual" as PricingMode })

  const weapon = weapons.find((w) => w.id === weaponId)

  useEffect(() => {
    if (!weapon) return
    setCostDrafts((weapon.additionalCosts ?? []).map((cost) => ({
      id: cost.id,
      name: cost.name,
      calculationType: cost.calculationType,
      amount: cost.inputAmount,
      percentageRate: cost.percentageRate,
      calculationBase: cost.calculationBase,
      currency: cost.currency,
    })))
    setSerialDraft(weapon.serialNumber)
    setWeaponTypeDraft(weapon.weaponTypeId)
    setSubtypeDraft(weapon.weaponSubtypeId)
    setCaliberDraft(weapon.caliberId)
    setBrandDraft(weapon.brandId)
    setModelDraft(weapon.modelId)
    setConditionDraft(weapon.condition)
    setSupplierDraft(weapon.supplierId ?? "")
    setLocationDraft(weapon.storageLocationId ?? "")
    setCurrencyDraft(weapon.purchasePriceValuation?.originalCurrency ?? transactionCurrency)
    setPurchaseDraft(String(weapon.purchasePriceValuation?.originalAmount ?? weapon.purchasePrice))
    setRetailDraft({ value: String(weapon.retailPriceValuation?.originalAmount ?? weapon.retailPrice), mode: weapon.retailPriceMode })
    setWholesaleDraft({ value: String(weapon.wholesalePriceValuation?.originalAmount ?? weapon.wholesalePrice), mode: weapon.wholesalePriceMode })
    setNotesDraft(weapon.notes)
  }, [transactionCurrency, weapon])

  if (!weapon) return null

  const supplier = suppliers.find((s) => s.id === weapon.supplierId)
  const linkedInvoice = invoices.find((i) => i.weaponIds.includes(weapon.id))
  const linkedShipment = shipments.find((s) => s.id === weapon.shipmentId)
  const subtypeOptions = md.weaponSubtypes.filter((item) => item.weapon_type_id === weaponTypeDraft)
  const linkedCaliberIds = new Set(md.subtypeCalibers.filter((item) => item.subtype_id === subtypeDraft).map((item) => item.caliber_id))
  const caliberOptions = linkedCaliberIds.size ? md.calibers.filter((item) => linkedCaliberIds.has(item.id)) : md.calibers
  const modelOptions = md.models.filter((item) => item.brand_id === brandDraft)
  const statusOptions: WeaponStatus[] = weapon.status === "Available" ? ["Available", "Reserved"]
    : weapon.status === "Reserved" ? ["Reserved", "Available"]
      : weapon.status === "Returned" ? ["Returned", "Available"] : ["Sold"]

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      if (!weaponId) return
      const result = await addWeaponImage(weaponId, reader.result as string)
      if (result.success) toast.success(t("toast.weaponUpdated"))
      else toast.error(result.error ?? t("toast.error"))
    }
    reader.readAsDataURL(file)
  }

  const handleBindShipment = async (shipmentId: string) => {
    if (weaponId) {
      const result = await bindWeaponToShipment(weaponId, shipmentId)
      if (result.success) toast.success(t("toast.weaponUpdated"))
      else toast.error(result.error ?? t("toast.error"))
    }
  }

  const handleSaveNotes = async () => {
    if (weaponId) {
      const result = await updateWeaponNotes(weaponId, notesDraft)
      if (result.success) toast.success(t("toast.weaponUpdated"))
      else toast.error(result.error ?? "Failed")
    }
  }

  const handleSaveDetails = async () => {
    if (!weaponId || savingDetails) return
    const purchasePrice = Number(purchaseDraft)
    const retailPrice = Number(retailDraft.value)
    const wholesalePrice = Number(wholesaleDraft.value)
    if (!serialDraft.trim() || ![purchasePrice, retailPrice, wholesalePrice].every((value) => Number.isFinite(value) && value >= 0)) {
      toast.error(t("toast.error")); return
    }
    if (wholesalePrice > retailPrice) { toast.error(t("pricing.wholesaleAboveRetail")); return }
    if (![weaponTypeDraft, subtypeDraft, caliberDraft, brandDraft, modelDraft].every(Boolean)) {
      toast.error(t("weaponDetail.requiredClassification")); return
    }
    setSavingDetails(true)
    try {
      const result = await updateWeaponDetails(weaponId, {
        serialNumber: serialDraft.trim(), condition: conditionDraft as typeof weapon.condition,
        weaponTypeId: weaponTypeDraft, weaponSubtypeId: subtypeDraft, caliberId: caliberDraft,
        brandId: brandDraft, modelId: modelDraft,
        supplierId: supplierDraft || null, storageLocationId: locationDraft || null,
        purchasePrice, retailPrice, wholesalePrice,
        retailPriceMode: retailDraft.mode, wholesalePriceMode: wholesaleDraft.mode,
        currency: currencyDraft,
      })
      if (!result.success) throw new Error(result.error ?? "Unable to update weapon")
      toast.success(t("toast.weaponUpdated"))
      setEditingDetails(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.error"))
    } finally {
      setSavingDetails(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex h-full w-full flex-col overflow-hidden p-0 sm:max-w-2xl">
        <TooltipProvider delayDuration={200}>
          <SheetHeader className="border-b bg-muted/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <SheetTitle className="flex items-center gap-2 text-base font-semibold">
                  <span className="font-mono">{weapon.serialNumber}</span>
                  <Badge className={`border ${statusBadgeClass(weapon.status)}`}>
                    <span className={`me-1 size-1.5 rounded-full ${statusDotClass(weapon.status)}`} />
                    {t(`status.${weapon.status}`)}
                  </Badge>
                </SheetTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {weapon.brand} {weapon.model} — {t(`weaponType.${weapon.weaponType}`)} / {weapon.subType}
                </p>
              </div>
            </div>
          </SheetHeader>

          <Tabs defaultValue="data" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="grid h-10 w-full shrink-0 grid-cols-5 rounded-none border-b bg-transparent px-2">
              <TabsTrigger value="data" className="text-xs">
                <Package className="size-3.5" />
                <span className="ms-1">{t("weaponDetail.data")}</span>
              </TabsTrigger>
              <TabsTrigger value="movement" className="text-xs">
                <History className="size-3.5" />
                <span className="ms-1">{t("weaponDetail.movement")}</span>
              </TabsTrigger>
              <TabsTrigger value="sales" className="text-xs">
                <Receipt className="size-3.5" />
                <span className="ms-1">{t("weaponDetail.sales")}</span>
              </TabsTrigger>
              <TabsTrigger value="images" className="text-xs">
                <ImageIcon className="size-3.5" />
                <span className="ms-1">{t("weaponDetail.images")}</span>
              </TabsTrigger>
              <TabsTrigger value="notes" className="text-xs">
                <StickyNote className="size-3.5" />
                <span className="ms-1">{t("weaponDetail.notes")}</span>
              </TabsTrigger>
            </TabsList>

            {/* ============ DATA TAB ============ */}
            <TabsContent value="data" className="flex-1 overflow-y-auto p-4 scrollbar-thin">
              <div className="space-y-4">
                {/* Edit toolbar */}
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{t("weaponDetail.summary")}</h3>
                  {canEdit && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => setEditingDetails((value) => !value)}
                          disabled={savingDetails}
                        >
                          <Pencil className="size-3.5" />
                          {editingDetails ? t("common.cancel") : t("common.edit")}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        {t(editingDetails ? "weaponDetail.tooltip.cancelEdit" : "weaponDetail.tooltip.edit")}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>

                {editingDetails && canEdit ? (
                  <div className="space-y-4">
                    {/* Identity Card */}
                    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
                      <SectionHeader
                        title={t("weaponDetail.identity")}
                        tooltipKey="weaponDetail.tooltip.identity"
                      />
                      <div className="grid gap-3 p-3 sm:grid-cols-2">
                        <div>
                          <FieldLabel tooltipKey="weaponDetail.tooltip.serial">
                            {t("weapon.serial")}
                          </FieldLabel>
                          <Input
                            className="mt-1 h-9 text-xs"
                            value={serialDraft}
                            onChange={(event) => setSerialDraft(event.target.value)}
                          />
                        </div>
                        <div>
                          <FieldLabel tooltipKey="weaponDetail.tooltip.condition">
                            {t("weapon.condition")}
                          </FieldLabel>
                          <Select value={conditionDraft} onValueChange={setConditionDraft}>
                            <SelectTrigger className="mt-1 h-9 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {["Excellent", "Good", "Fair", "Poor"].map((value) => (
                                <SelectItem key={value} value={value}>{t(`status.${value}`)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </section>

                    {/* Classification Card */}
                    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
                      <SectionHeader
                        title={t("weaponDetail.classification")}
                        tooltipKey="weaponDetail.tooltip.classification"
                      />
                      <div className="grid gap-3 p-3 sm:grid-cols-2">
                        <DetailSelect
                          label={t("weapon.weaponType")}
                          tooltipKey="weaponDetail.tooltip.weaponType"
                          value={weaponTypeDraft}
                          options={md.weaponTypes}
                          onChange={(value) => {
                            setWeaponTypeDraft(value)
                            const next = md.weaponSubtypes.find((item) => item.weapon_type_id === value)
                            setSubtypeDraft(next?.id ?? "")
                            setCaliberDraft("")
                          }}
                        />
                        <DetailSelect
                          label={t("master.subType")}
                          tooltipKey="weaponDetail.tooltip.subtype"
                          value={subtypeDraft}
                          options={subtypeOptions}
                          onChange={(value) => {
                            setSubtypeDraft(value)
                            const ids = new Set(md.subtypeCalibers.filter((item) => item.subtype_id === value).map((item) => item.caliber_id))
                            setCaliberDraft((ids.size ? md.calibers.find((item) => ids.has(item.id)) : md.calibers[0])?.id ?? "")
                          }}
                        />
                        <DetailSelect
                          label={t("weapon.caliber")}
                          tooltipKey="weaponDetail.tooltip.caliber"
                          value={caliberDraft}
                          options={caliberOptions}
                          onChange={setCaliberDraft}
                        />
                        <DetailSelect
                          label={t("weapon.brand")}
                          tooltipKey="weaponDetail.tooltip.brand"
                          value={brandDraft}
                          options={md.brands}
                          onChange={(value) => {
                            setBrandDraft(value)
                            setModelDraft(md.models.find((item) => item.brand_id === value)?.id ?? "")
                          }}
                        />
                        <DetailSelect
                          label={t("weapon.model")}
                          tooltipKey="weaponDetail.tooltip.model"
                          value={modelDraft}
                          options={modelOptions}
                          onChange={setModelDraft}
                        />
                      </div>
                    </section>

                    {/* Logistics Card */}
                    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
                      <SectionHeader
                        title={t("weaponDetail.logistics")}
                        tooltipKey="weaponDetail.tooltip.logistics"
                      />
                      <div className="grid gap-3 p-3 sm:grid-cols-2">
                        <div>
                          <FieldLabel tooltipKey="weaponDetail.tooltip.supplier">
                            {t("weapon.supplier")}
                          </FieldLabel>
                          <Select
                            value={supplierDraft || "__none"}
                            onValueChange={(value) => setSupplierDraft(value === "__none" ? "" : value)}
                          >
                            <SelectTrigger className="mt-1 h-9 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none">—</SelectItem>
                              {suppliers.map((item) => (
                                <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <FieldLabel tooltipKey="weaponDetail.tooltip.location">
                            {t("inv.location")} ({t("common.optional")})
                          </FieldLabel>
                          <Select
                            value={locationDraft || "__none"}
                            onValueChange={(value) => setLocationDraft(value === "__none" ? "" : value)}
                          >
                            <SelectTrigger className="mt-1 h-9 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none">—</SelectItem>
                              {md.storageLocations.map((item) => {
                                const warehouse = md.warehouses.find((candidate) => candidate.id === item.warehouse_id)
                                return (
                                  <SelectItem key={item.id} value={item.id}>
                                    {warehouse?.label ?? ""} / {item.shelf} / {item.bin}
                                  </SelectItem>
                                )
                              })}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </section>

                    {/* Commercial Card */}
                    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
                      <SectionHeader
                        title={t("weaponDetail.commercial")}
                        tooltipKey="weaponDetail.tooltip.commercial"
                      />
                      <div className="p-3">
                        <PricingSection
                          purchasePrice={purchaseDraft}
                          onPurchasePriceChange={setPurchaseDraft}
                          currency={currencyDraft}
                          onCurrencyChange={setCurrencyDraft}
                          quantity={1}
                          onQuantityChange={() => undefined}
                          showQuantity={false}
                          showAdditionalCosts={false}
                          additionalCosts={costDrafts}
                          onAdditionalCostsChange={setCostDrafts}
                          finalCost={Number(purchaseDraft) || 0}
                          retailPrice={retailDraft.value}
                          retailPriceMode={retailDraft.mode}
                          onRetailChange={setRetailDraft}
                          wholesalePrice={wholesaleDraft.value}
                          wholesalePriceMode={wholesaleDraft.mode}
                          onWholesaleChange={setWholesaleDraft}
                        />
                      </div>
                    </section>

                    <div className="flex justify-end gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button size="sm" onClick={() => void handleSaveDetails()} disabled={savingDetails}>
                            {savingDetails && <Loader2 className="size-3.5 animate-spin" />}
                            {t("common.save")}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("common.save")}</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Summary Cards */}
                    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
                      <SectionHeader
                        title={t("weaponDetail.identity")}
                        tooltipKey="weaponDetail.tooltip.identity"
                      />
                      <DataRow label="ID" value={weapon.id} mono />
                      <DataRow
                        label={t("weapon.serial")}
                        value={weapon.serialNumber}
                        mono
                        tooltipKey="weaponDetail.tooltip.serial"
                      />
                      <DataRow
                        label={t("weapon.condition")}
                        value={t(`status.${weapon.condition}`)}
                        tooltipKey="weaponDetail.tooltip.condition"
                      />
                      <DataRow
                        label={t("weapon.status")}
                        value={t(`status.${weapon.status}`)}
                        tooltipKey="weaponDetail.tooltip.status"
                      />
                    </section>

                    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
                      <SectionHeader
                        title={t("weaponDetail.classification")}
                        tooltipKey="weaponDetail.tooltip.classification"
                      />
                      <DataRow
                        label={t("weapon.brand")}
                        value={weapon.brand}
                        tooltipKey="weaponDetail.tooltip.brand"
                      />
                      <DataRow
                        label={t("weapon.model")}
                        value={weapon.model}
                        tooltipKey="weaponDetail.tooltip.model"
                      />
                      <DataRow
                        label={t("weapon.weaponType")}
                        value={t(`weaponType.${weapon.weaponType}`)}
                        tooltipKey="weaponDetail.tooltip.weaponType"
                      />
                      <DataRow
                        label={t("master.subType")}
                        value={weapon.subType}
                        tooltipKey="weaponDetail.tooltip.subtype"
                      />
                      <DataRow
                        label={t("weapon.caliber")}
                        value={weapon.caliber}
                        tooltipKey="weaponDetail.tooltip.caliber"
                      />
                    </section>

                    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
                      <SectionHeader
                        title={t("weaponDetail.commercial")}
                        tooltipKey="weaponDetail.tooltip.commercial"
                      />
                      <DataRow
                        label={t("weapon.purchasePrice")}
                        value={formatValuation(weapon.purchasePriceValuation, "display", weapon.purchasePrice)}
                        tooltipKey="weaponDetail.tooltip.purchasePrice"
                      />
                      {weapon.costSnapshot && (
                        <Collapsible open={costBreakdownOpen} onOpenChange={setCostBreakdownOpen} className="bg-muted/20 px-3 py-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-[10px] font-medium text-muted-foreground">{t("cost.finalCost")}</div>
                              <div className="mt-0.5 text-base font-bold tabular-nums text-primary">
                                {formatAccountingAggregate(Number(weapon.costSnapshot.finalLandedBaseAmount), "accounting")}
                              </div>
                            </div>
                            {canEdit && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button size="xs" variant="ghost" onClick={() => setEditingCosts((value) => !value)}>
                                    {editingCosts ? t("common.cancel") : t("common.edit")}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {t(editingCosts ? "weaponDetail.tooltip.cancelCosts" : "weaponDetail.tooltip.editCosts")}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                          <CollapsibleTrigger asChild>
                            <Button size="xs" variant="ghost" className="mt-1 px-0 text-muted-foreground">
                              {t("cost.viewBreakdown")}
                              <ChevronDown className={`size-3 transition-transform ${costBreakdownOpen ? "rotate-180" : ""}`} />
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="space-y-1 pt-1">
                            <DataRow
                              label={t("cost.originalCost")}
                              value={formatOriginal(Number(weapon.costSnapshot.originalAmount), weapon.costSnapshot.originalCurrency)}
                            />
                            {(weapon.additionalCosts ?? []).map((cost) => (
                              <DataRow
                                key={cost.id}
                                label={cost.name}
                                value={formatOriginal(Number(cost.calculatedAmount), cost.currency)}
                              />
                            ))}
                            <DataRow
                              label={t("cost.additionalCosts")}
                              value={formatAccountingAggregate(Number(weapon.costSnapshot.productCostsBaseAmount), "accounting")}
                            />
                            <DataRow
                              label={t("cost.shipmentAllocatedCosts")}
                              value={formatAccountingAggregate(Number(weapon.costSnapshot.shipmentCostsBaseAmount), "accounting")}
                            />
                            <Separator />
                            <div className="text-[9px] text-muted-foreground">
                              {t("cost.rateSnapshot")}:
                              <span dir="ltr">{weapon.costSnapshot.originalExchangeRate} · {formatDate(weapon.costSnapshot.exchangeRateDate)}</span>
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                      {editingCosts && weapon.costSnapshot && (
                        <div className="space-y-2 p-3">
                          <ProductCostEditor
                            originalAmount={weapon.costSnapshot.originalAmount}
                            originalCurrency={weapon.costSnapshot.originalCurrency}
                            costs={costDrafts}
                            onChange={setCostDrafts}
                          />
                          <Button
                            size="sm"
                            onClick={async () => {
                              const result = await updateProductCosts("weapon", weapon.id, costDrafts)
                              if (result.success) {
                                toast.success(t("cost.costsUpdated"))
                                setEditingCosts(false)
                              } else {
                                toast.error(t("cost.costUpdateFailed"))
                              }
                            }}
                          >
                            {t("common.save")}
                          </Button>
                        </div>
                      )}
                      <DataRow
                        label={t("weaponDetail.retailPrice")}
                        value={formatValuation(weapon.retailPriceValuation, "display", weapon.retailPrice)}
                        tooltipKey="weaponDetail.tooltip.retailPrice"
                      />
                      <DataRow
                        label={t("weaponDetail.wholesalePrice")}
                        value={formatValuation(weapon.wholesalePriceValuation, "display", weapon.wholesalePrice)}
                        tooltipKey="weaponDetail.tooltip.wholesalePrice"
                      />
                      {weapon.actualFinalPrice !== null && (
                        <DataRow
                          label={t("weaponDetail.actualFinalPrice")}
                          value={formatValuation(weapon.actualFinalPriceValuation, "display", weapon.actualFinalPrice)}
                          tooltipKey="weaponDetail.tooltip.actualFinalPrice"
                        />
                      )}
                    </section>

                    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
                      <SectionHeader
                        title={t("weaponDetail.logistics")}
                        tooltipKey="weaponDetail.tooltip.logistics"
                      />
                      <DataRow
                        label={t("weapon.supplier")}
                        value={supplier?.name ?? weapon.supplierId}
                        tooltipKey="weaponDetail.tooltip.supplier"
                      />
                      <DataRow
                        label={t("weapon.dateAdded")}
                        value={formatDate(weapon.dateAdded)}
                        tooltipKey="weaponDetail.tooltip.dateAdded"
                      />
                      {weapon.batchId && (
                        <DataRow
                          label={t("weaponDetail.batchId")}
                          value={weapon.batchId}
                          mono
                          tooltipKey="weaponDetail.tooltip.batchId"
                        />
                      )}
                    </section>
                  </>
                )}

                {/* Status & Shipment Binding */}
                <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
                  <SectionHeader
                    title={t("weaponDetail.changeStatus")}
                    tooltipKey="weaponDetail.tooltip.changeStatus"
                  />
                  <div className="p-3">
                    {canEdit ? (
                      <Select
                        value={weapon.status}
                        onValueChange={async (v) => {
                          if (weaponId) {
                            const result = await updateWeaponStatus(weaponId, v as WeaponStatus)
                            if (result.success) toast.success(t("toast.statusUpdated"))
                            else toast.error(result.error ?? "Failed")
                          }
                        }}
                      >
                        <SelectTrigger size="sm" className="h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {statusOptions.map((status) => (
                            <SelectItem key={status} value={status}>{t(`status.${status}`)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <DataRow
                        label={t("weaponDetail.changeStatus")}
                        value={t(`status.${weapon.status}`)}
                      />
                    )}
                  </div>
                </section>

                <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
                  <SectionHeader
                    title={t("weaponDetail.shipmentBinding")}
                    tooltipKey="weaponDetail.tooltip.shipmentBinding"
                  />
                  <div className="p-3">
                    {linkedShipment ? (
                      <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-2">
                        <div>
                          <div className="font-mono text-xs font-medium">{linkedShipment.shipmentNumber}</div>
                          <div className="text-[10px] text-muted-foreground">{t(`status.${linkedShipment.status}`)}</div>
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="xs" variant="ghost" onClick={() => { onOpenChange(false); navigate("shipments") }}>
                              {t("common.view")}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("weaponDetail.tooltip.viewShipment")}</TooltipContent>
                        </Tooltip>
                      </div>
                    ) : canManageShipments ? (
                      <Select onValueChange={handleBindShipment}>
                        <SelectTrigger size="sm" className="h-9 text-xs">
                          <SelectValue placeholder={t("weaponDetail.bindShipment")} />
                        </SelectTrigger>
                        <SelectContent>
                          {shipments.filter((s) => s.status !== "Arrived").map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.shipmentNumber} ({t(`status.${s.status}`)})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <DataRow label={t("weaponDetail.shipmentBinding")} value="—" />
                    )}
                  </div>
                </section>
              </div>
            </TabsContent>

            {/* ============ MOVEMENT TAB ============ */}
            <TabsContent value="movement" className="flex-1 overflow-y-auto p-4 scrollbar-thin">
              <div className="space-y-2">
                {(weapon.movementHistory ?? []).map((mv, index) => (
                  <div key={mv.id} className="flex items-start gap-3 rounded-xl border bg-card p-3 shadow-sm">
                    <div className="flex flex-col items-center">
                      <span className={`mt-1 size-2.5 rounded-full ring-2 ring-background ${statusDotClass(mv.toStatus)}`} />
                      {index < (weapon.movementHistory?.length ?? 0) - 1 && (
                        <span className="mt-1 w-px flex-1 bg-border" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">
                          {t(`status.${mv.fromStatus}`)} → {t(`status.${mv.toStatus}`)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatDateTime(mv.timestamp)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{mv.reason}</p>
                      <Badge variant="ghost" className="mt-1 h-4 px-1 text-[9px]">
                        {mv.userName}
                      </Badge>
                    </div>
                  </div>
                ))}
                {(!weapon.movementHistory || weapon.movementHistory.length === 0) && (
                  <div className="flex h-32 flex-col items-center justify-center gap-1 text-muted-foreground">
                    <History className="size-8 opacity-30" />
                    <span className="text-xs">{t("weaponDetail.noMovements")}</span>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ============ SALES TAB ============ */}
            <TabsContent value="sales" className="flex-1 overflow-y-auto p-4 scrollbar-thin">
              {linkedInvoice ? (
                <div className="space-y-3">
                  <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
                    <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
                      <span className="font-mono text-xs font-semibold">{linkedInvoice.invoiceNumber}</span>
                      <Badge variant="outline" className="h-4 px-1 text-[9px]">
                        {t(`status.${linkedInvoice.status}`)}
                      </Badge>
                    </div>
                    <div>
                      <DataRow
                        label={t("weaponDetail.customer")}
                        value={linkedInvoice.customerName}
                        tooltipKey="weaponDetail.tooltip.customer"
                      />
                      <DataRow
                        label={t("common.date")}
                        value={formatDate(linkedInvoice.date)}
                        tooltipKey="weaponDetail.tooltip.date"
                      />
                      <DataRow
                        label={t("common.total")}
                        value={formatInvoice(linkedInvoice, "totalNegotiated")}
                        tooltipKey="weaponDetail.tooltip.total"
                      />
                      <DataRow
                        label={t("weaponDetail.mode")}
                        value={linkedInvoice.saleMode}
                        tooltipKey="weaponDetail.tooltip.saleMode"
                      />
                    </div>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="sm" variant="outline" onClick={() => { onOpenChange(false); navigate("financials") }}>
                        <Receipt className="size-3.5" />
                        {t("weaponDetail.viewInvoice")}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("weaponDetail.tooltip.viewInvoice")}</TooltipContent>
                  </Tooltip>
                </div>
              ) : (
                <div className="flex h-32 flex-col items-center justify-center gap-1 text-muted-foreground">
                  <Receipt className="size-8 opacity-30" />
                  <span className="text-xs">{t("weaponDetail.noSales")}</span>
                </div>
              )}
            </TabsContent>

            {/* ============ IMAGES TAB ============ */}
            <TabsContent value="images" className="flex-1 overflow-y-auto p-4 scrollbar-thin">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <FieldLabel tooltipKey="weaponDetail.tooltip.uploadImage">
                    {t("weaponDetail.uploadImage")}
                  </FieldLabel>
                </div>
                {canEdit ? (
                  <label
                    htmlFor="weapon-image-upload"
                    className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/20 p-6 transition hover:bg-muted/40"
                  >
                    <Upload className="size-6 text-muted-foreground" />
                    <span className="text-xs">{t("weaponDetail.uploadImage")}</span>
                    <input
                      id="weapon-image-upload"
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </label>
                ) : (
                  <div className="text-xs text-muted-foreground">{t("weaponDetail.noUploadPermission")}</div>
                )}
                <Separator />
                {weapon.images.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {weapon.images.map((img, i) => (
                      <img
                        key={i}
                        src={img}
                        alt={`Weapon ${i + 1}`}
                        className="rounded-xl border object-cover"
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex h-24 flex-col items-center justify-center gap-1 text-muted-foreground">
                    <ImageIcon className="size-8 opacity-30" />
                    <span className="text-xs">{t("weaponDetail.noImages")}</span>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ============ NOTES TAB ============ */}
            <TabsContent value="notes" className="flex-1 overflow-y-auto p-4 scrollbar-thin">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <FieldLabel tooltipKey="weaponDetail.tooltip.annotations">
                    {t("weaponDetail.annotations")}
                  </FieldLabel>
                </div>
                <Textarea
                  value={notesDraft || weapon.notes}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  placeholder={t("weaponDetail.notesPlaceholder")}
                  className="min-h-[140px] text-xs"
                  disabled={!canEdit}
                />
                {canEdit && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="sm" onClick={handleSaveNotes}>
                        {t("weaponDetail.saveNotes")}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("weaponDetail.tooltip.saveNotes")}</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </TooltipProvider>
      </SheetContent>
    </Sheet>
  )
})

/* ============ Helper Components ============ */

function InfoTip({ textKey }: { textKey: string }) {
  const { t } = useI18n()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          className="ms-1 inline-flex shrink-0 cursor-help text-muted-foreground transition-colors hover:text-foreground"
          aria-label={t(textKey)}
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" className="max-w-xs text-xs leading-relaxed shadow-md">
        {t(textKey)}
      </TooltipContent>
    </Tooltip>
  )
}

function FieldLabel({ children, tooltipKey }: { children: ReactNode; tooltipKey?: string }) {
  return (
    <Label className="flex items-center text-xs">
      {children}
      {tooltipKey && <InfoTip textKey={tooltipKey} />}
    </Label>
  )
}

function SectionHeader({ title, tooltipKey }: { title: string; tooltipKey?: string }) {
  return (
    <div className="flex items-center gap-1 border-b bg-muted/40 px-3 py-2">
      <h3 className="text-xs font-semibold">{title}</h3>
      {tooltipKey && <InfoTip textKey={tooltipKey} />}
    </div>
  )
}

function DataRow({
  label,
  value,
  mono,
  tooltipKey,
}: {
  label: string
  value: string
  mono?: boolean
  tooltipKey?: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 px-3 py-2 last:border-0">
      <span className="flex items-center text-[11px] text-muted-foreground">
        {label}
        {tooltipKey && <InfoTip textKey={tooltipKey} />}
      </span>
      <span className={`break-words text-end text-[11px] font-medium leading-relaxed ${mono ? "font-mono" : ""}`}>
        {value || "—"}
      </span>
    </div>
  )
}

function DetailSelect({
  label,
  value,
  options,
  onChange,
  tooltipKey,
}: {
  label: string
  value: string
  options: Array<{ id: string; label: string }>
  onChange: (value: string) => void
  tooltipKey?: string
}) {
  return (
    <div>
      <FieldLabel tooltipKey={tooltipKey}>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="mt-1 h-9 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
