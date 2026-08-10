import { memo, useEffect, useState } from "react"
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
import { ChevronDown, Package, History, Receipt, ImageIcon, StickyNote, Upload, Truck } from "lucide-react"
import { useStore } from "@/lib/store"
import { useNav } from "@/lib/nav"
import { useI18n } from "@/lib/i18n"
import { useCurrency } from "@/lib/currency-context"
import {
  formatDate, formatDateTime, statusBadgeClass, statusDotClass,
} from "@/lib/format"
import type { WeaponStatus } from "@/lib/types"
import type { ProductAdditionalCostInput } from "@/lib/types"
import { toast } from "sonner"
import { ProductCostEditor } from "./product-cost-editor"

export const WeaponDetailPanel = memo(function WeaponDetailPanel({
  weaponId, open, onOpenChange,
}: { weaponId: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const weapons = useStore((s) => s.weapons)
  const suppliers = useStore((s) => s.suppliers)
  const invoices = useStore((s) => s.invoices)
  const shipments = useStore((s) => s.shipments)
  const updateWeaponStatus = useStore((s) => s.updateWeaponStatus)
  const updateWeaponNotes = useStore((s) => s.updateWeaponNotes)
  const addWeaponImage = useStore((s) => s.addWeaponImage)
  const bindWeaponToShipment = useStore((s) => s.bindWeaponToShipment)
  const updateProductCosts = useStore((s) => s.updateProductCosts)
  const { formatValuation, formatInvoice, formatOriginal, formatAccountingAggregate } = useCurrency()
  const { navigate } = useNav()
  const { t } = useI18n()
  const [notesDraft, setNotesDraft] = useState("")
  const [editingCosts, setEditingCosts] = useState(false)
  const [costBreakdownOpen, setCostBreakdownOpen] = useState(false)
  const [costDrafts, setCostDrafts] = useState<ProductAdditionalCostInput[]>([])

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
  }, [weapon])
  if (!weapon) return null

  const supplier = suppliers.find((s) => s.id === weapon.supplierId)
  const linkedInvoice = invoices.find((i) => i.weaponIds.includes(weapon.id))
  const linkedShipment = shipments.find((s) => s.id === weapon.shipmentId)

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (weaponId) addWeaponImage(weaponId, reader.result as string)
      toast.success(t("toast.weaponUpdated"))
    }
    reader.readAsDataURL(file)
  }

  const handleBindShipment = async (shipmentId: string) => {
    if (weaponId) {
      await bindWeaponToShipment(weaponId, shipmentId)
      toast.success(t("toast.weaponUpdated"))
    }
  }

  const handleSaveNotes = async () => {
    if (weaponId) {
      const result = await updateWeaponNotes(weaponId, notesDraft || weapon.notes)
      if (result.success) toast.success(t("toast.weaponUpdated"))
      else toast.error(result.error ?? "Failed")
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-lg scrollbar-thin">
        <SheetHeader className="border-b p-3">
          <SheetTitle className="flex items-center justify-between text-sm">
            <span className="font-mono">{weapon.serialNumber}</span>
            <Badge className={`border ${statusBadgeClass(weapon.status)}`}>
              <span className={`me-1 size-1.5 rounded-full ${statusDotClass(weapon.status)}`} />
              {t(`status.${weapon.status}`)}
            </Badge>
          </SheetTitle>
          <p className="text-xs text-muted-foreground">{weapon.brand} {weapon.model} — {t(`weaponType.${weapon.weaponType}`)} / {weapon.subType}</p>
        </SheetHeader>

        <Tabs defaultValue="data" className="flex h-[calc(100vh-80px)] flex-col">
          <TabsList className="grid h-9 w-full grid-cols-5 rounded-none border-b bg-transparent">
            <TabsTrigger value="data" className="text-xs"><Package className="size-3" />{t("weaponDetail.data")}</TabsTrigger>
            <TabsTrigger value="movement" className="text-xs"><History className="size-3" />{t("weaponDetail.movement")}</TabsTrigger>
            <TabsTrigger value="sales" className="text-xs"><Receipt className="size-3" />{t("weaponDetail.sales")}</TabsTrigger>
            <TabsTrigger value="images" className="text-xs"><ImageIcon className="size-3" />{t("weaponDetail.images")}</TabsTrigger>
            <TabsTrigger value="notes" className="text-xs"><StickyNote className="size-3" />{t("weaponDetail.notes")}</TabsTrigger>
          </TabsList>

          <TabsContent value="data" className="flex-1 overflow-y-auto p-3 scrollbar-thin">
            <div className="grid gap-2 text-xs">
              <DataRow label="ID" value={weapon.id} />
              <DataRow label={t("weapon.serial")} value={weapon.serialNumber} mono />
              <DataRow label={t("weapon.brand")} value={weapon.brand} />
              <DataRow label={t("weapon.model")} value={weapon.model} />
              <DataRow label={t("weapon.weaponType")} value={t(`weaponType.${weapon.weaponType}`)} />
              <DataRow label={t("master.subType")} value={weapon.subType} />
              <DataRow label={t("weapon.caliber")} value={weapon.caliber} />
              <DataRow label={t("weapon.condition")} value={t(`status.${weapon.condition}`)} />
              <DataRow label={t("weapon.status")} value={t(`status.${weapon.status}`)} />
              <Separator className="my-1" />
              <DataRow label={t("weapon.purchasePrice")} value={formatValuation(weapon.purchasePriceValuation, "display", weapon.purchasePrice)} />
              {weapon.costSnapshot && (
                <Collapsible open={costBreakdownOpen} onOpenChange={setCostBreakdownOpen} className="rounded-md bg-muted/25 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div><div className="text-[10px] font-medium text-muted-foreground">{t("cost.finalCost")}</div><div className="mt-0.5 text-base font-bold tabular-nums text-primary">{formatAccountingAggregate(Number(weapon.costSnapshot.finalLandedBaseAmount), "accounting")}</div></div>
                    <Button size="xs" variant="ghost" onClick={() => setEditingCosts((value) => !value)}>{editingCosts ? t("common.cancel") : t("common.edit")}</Button>
                  </div>
                  <CollapsibleTrigger asChild><Button size="xs" variant="ghost" className="mt-1 px-0 text-muted-foreground">{t("cost.viewBreakdown")} <ChevronDown className={`size-3 transition-transform ${costBreakdownOpen ? "rotate-180" : ""}`} /></Button></CollapsibleTrigger>
                  <CollapsibleContent className="space-y-1 pt-1">
                    <DataRow label={t("cost.originalCost")} value={formatOriginal(Number(weapon.costSnapshot.originalAmount), weapon.costSnapshot.originalCurrency)} />
                    {(weapon.additionalCosts ?? []).map((cost) => <DataRow key={cost.id} label={cost.name} value={formatOriginal(Number(cost.calculatedAmount), cost.currency)} />)}
                    <DataRow label={t("cost.additionalCosts")} value={formatAccountingAggregate(Number(weapon.costSnapshot.productCostsBaseAmount), "accounting")} />
                    <DataRow label={t("cost.shipmentAllocatedCosts")} value={formatAccountingAggregate(Number(weapon.costSnapshot.shipmentCostsBaseAmount), "accounting")} />
                    <Separator />
                    <div className="text-[9px] text-muted-foreground">{t("cost.rateSnapshot")}: <span dir="ltr">{weapon.costSnapshot.originalExchangeRate} · {formatDate(weapon.costSnapshot.exchangeRateDate)}</span></div>
                  </CollapsibleContent>
                </Collapsible>
              )}
              {editingCosts && weapon.costSnapshot && (
                <div className="space-y-2">
                  <ProductCostEditor originalAmount={weapon.costSnapshot.originalAmount} originalCurrency={weapon.costSnapshot.originalCurrency} costs={costDrafts} onChange={setCostDrafts} />
                  <Button size="sm" onClick={async () => {
                    const result = await updateProductCosts("weapon", weapon.id, costDrafts)
                    if (result.success) { toast.success(t("cost.costsUpdated")); setEditingCosts(false) }
                    else toast.error(t("cost.costUpdateFailed"))
                  }}>{t("common.save")}</Button>
                </div>
              )}
              <DataRow label={t("weaponDetail.retailPrice")} value={formatValuation(weapon.retailPriceValuation, "display", weapon.retailPrice)} />
              <DataRow label={t("weaponDetail.wholesalePrice")} value={formatValuation(weapon.wholesalePriceValuation, "display", weapon.wholesalePrice)} />
              {weapon.actualFinalPrice !== null && (
                <DataRow label={t("weaponDetail.actualFinalPrice")} value={formatValuation(weapon.actualFinalPriceValuation, "display", weapon.actualFinalPrice)} />
              )}
              <Separator className="my-1" />
              <DataRow label={t("weapon.supplier")} value={supplier?.name ?? weapon.supplierId} />
              <DataRow label={t("weapon.dateAdded")} value={formatDate(weapon.dateAdded)} />
              {weapon.batchId && <DataRow label={t("weaponDetail.batchId")} value={weapon.batchId} mono />}

              <Separator className="my-2" />
              <Label className="text-xs font-medium">{t("weaponDetail.changeStatus")}</Label>
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
                <SelectTrigger size="sm" className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Available">{t("status.Available")}</SelectItem>
                  <SelectItem value="Reserved">{t("status.Reserved")}</SelectItem>
                  <SelectItem value="Sold">{t("status.Sold")}</SelectItem>
                  <SelectItem value="Returned">{t("status.Returned")}</SelectItem>
                </SelectContent>
              </Select>

              <Separator className="my-2" />
              <Label className="flex items-center gap-1 text-xs font-medium">
                <Truck className="size-3" /> {t("weaponDetail.shipmentBinding")}
              </Label>
              {linkedShipment ? (
                <div className="flex items-center justify-between rounded-md border p-2">
                  <div className="flex flex-col">
                    <span className="font-mono text-[11px] font-medium">{linkedShipment.shipmentNumber}</span>
                    <span className="text-[10px] text-muted-foreground">{t(`status.${linkedShipment.status}`)}</span>
                  </div>
                  <Button size="xs" variant="ghost" onClick={() => { onOpenChange(false); navigate("shipments") }}>{t("common.view")}</Button>
                </div>
              ) : (
                <Select onValueChange={handleBindShipment}>
                  <SelectTrigger size="sm" className="h-7 text-xs">
                    <SelectValue placeholder={t("weaponDetail.bindShipment")} />
                  </SelectTrigger>
                  <SelectContent>
                    {shipments.filter((s) => s.status !== "Arrived").map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.shipmentNumber} ({t(`status.${s.status}`)})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </TabsContent>

          <TabsContent value="movement" className="flex-1 overflow-y-auto p-3 scrollbar-thin">
            <div className="flex flex-col gap-2">
              {weapon.movementHistory.map((mv) => (
                <div key={mv.id} className="flex items-start gap-2 rounded-md border p-2">
                  <div className="flex flex-col items-center">
                    <span className={`size-2 rounded-full ${statusDotClass(mv.toStatus)}`} />
                    {weapon.movementHistory.indexOf(mv) < weapon.movementHistory.length - 1 && (
                      <span className="mt-1 h-full w-px bg-border" />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[11px] font-medium">{t(`status.${mv.fromStatus}`)} → {t(`status.${mv.toStatus}`)}</span>
                    <span className="text-[10px] text-muted-foreground">{mv.reason}</span>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge variant="ghost" className="h-3.5 px-1 text-[9px]">{mv.userName}</Badge>
                      <span className="text-[10px] text-muted-foreground">{formatDateTime(mv.timestamp)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="sales" className="flex-1 overflow-y-auto p-3 scrollbar-thin">
            {linkedInvoice ? (
              <div className="flex flex-col gap-2">
                <div className="rounded-md border p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-medium">{linkedInvoice.invoiceNumber}</span>
                    <Badge variant="outline" className="h-4 px-1 text-[9px]">{t(`status.${linkedInvoice.status}`)}</Badge>
                  </div>
                  <Separator className="my-1.5" />
                  <DataRow label={t("weaponDetail.customer")} value={linkedInvoice.customerName} />
                  <DataRow label={t("common.date")} value={formatDate(linkedInvoice.date)} />
                  <DataRow label={t("common.total")} value={formatInvoice(linkedInvoice, "totalNegotiated")} />
                  <DataRow label={t("weaponDetail.mode")} value={linkedInvoice.saleMode} />
                </div>
                <Button size="sm" variant="outline" onClick={() => { onOpenChange(false); navigate("financials") }}>
                  <Receipt className="size-3.5" /> {t("weaponDetail.viewInvoice")}
                </Button>
              </div>
            ) : (
              <div className="flex h-32 flex-col items-center justify-center gap-1 text-muted-foreground">
                <Receipt className="size-8 opacity-30" />
                <span className="text-xs">{t("weaponDetail.noSales")}</span>
              </div>
            )}
          </TabsContent>

          <TabsContent value="images" className="flex-1 overflow-y-auto p-3 scrollbar-thin">
            <div className="flex flex-col gap-2">
              <Label className="flex items-center gap-1.5 text-xs">
                <Upload className="size-3.5" /> {t("weaponDetail.uploadImage")}
              </Label>
              <Input type="file" accept="image/*" onChange={handleImageUpload} className="h-8 text-xs" />
              <Separator className="my-1" />
              {weapon.images.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {weapon.images.map((img, i) => (
                    <img key={i} src={img} alt={`Weapon ${i + 1}`} className="rounded-md border" />
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

          <TabsContent value="notes" className="flex-1 overflow-y-auto p-3 scrollbar-thin">
            <div className="flex flex-col gap-2">
              <Label className="text-xs font-medium">{t("weaponDetail.annotations")}</Label>
              <Textarea
                value={notesDraft || weapon.notes}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder={t("weaponDetail.notesPlaceholder")}
                className="min-h-[120px] text-xs"
              />
              <Button size="sm" onClick={handleSaveNotes}>{t("weaponDetail.saveNotes")}</Button>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
})

function DataRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  )
}
