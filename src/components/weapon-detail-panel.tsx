import { memo, useState } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Package, History, Receipt, ImageIcon, StickyNote, Upload, Truck } from "lucide-react"
import { useStore } from "@/lib/store"
import { useNav } from "@/lib/nav"
import { useI18n } from "@/lib/i18n"
import {
  formatCurrency, formatDate, formatDateTime, statusBadgeClass, statusDotClass,
} from "@/lib/format"
import type { WeaponStatus } from "@/lib/types"
import { toast } from "sonner"

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
  const settings = useStore((s) => s.settings)
  const { navigate } = useNav()
  const { t } = useI18n()
  const [notesDraft, setNotesDraft] = useState("")

  const weapon = weapons.find((w) => w.id === weaponId)
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
            <TabsTrigger value="data" className="text-xs"><Package className="size-3" />Data</TabsTrigger>
            <TabsTrigger value="movement" className="text-xs"><History className="size-3" />Move</TabsTrigger>
            <TabsTrigger value="sales" className="text-xs"><Receipt className="size-3" />Sales</TabsTrigger>
            <TabsTrigger value="images" className="text-xs"><ImageIcon className="size-3" />Images</TabsTrigger>
            <TabsTrigger value="notes" className="text-xs"><StickyNote className="size-3" />Notes</TabsTrigger>
          </TabsList>

          <TabsContent value="data" className="flex-1 overflow-y-auto p-3 scrollbar-thin">
            <div className="grid gap-2 text-xs">
              <DataRow label="ID" value={weapon.id} />
              <DataRow label={t("weapon.serial")} value={weapon.serialNumber} mono />
              <DataRow label={t("weapon.brand")} value={weapon.brand} />
              <DataRow label={t("weapon.model")} value={weapon.model} />
              <DataRow label={t("weapon.weaponType")} value={t(`weaponType.${weapon.weaponType}`)} />
              <DataRow label="Sub-Type" value={weapon.subType} />
              <DataRow label={t("weapon.caliber")} value={weapon.caliber} />
              <DataRow label={t("weapon.condition")} value={t(`status.${weapon.condition}`)} />
              <DataRow label={t("weapon.status")} value={t(`status.${weapon.status}`)} />
              <Separator className="my-1" />
              <DataRow label={t("weapon.purchasePrice")} value={formatCurrency(weapon.purchasePrice, settings.currencySymbol)} />
              <DataRow label="Retail Price" value={formatCurrency(weapon.retailPrice, settings.currencySymbol)} />
              <DataRow label="Wholesale Price" value={formatCurrency(weapon.wholesalePrice, settings.currencySymbol)} />
              {weapon.actualFinalPrice !== null && (
                <DataRow label="Actual Final Price" value={formatCurrency(weapon.actualFinalPrice, settings.currencySymbol)} />
              )}
              <Separator className="my-1" />
              <DataRow label={t("weapon.supplier")} value={supplier?.name ?? weapon.supplierId} />
              <DataRow label={t("weapon.dateAdded")} value={formatDate(weapon.dateAdded)} />
              {weapon.batchId && <DataRow label="Batch ID" value={weapon.batchId} mono />}

              <Separator className="my-2" />
              <Label className="text-xs font-medium">Change Status</Label>
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
                <Truck className="size-3" /> Shipment Binding
              </Label>
              {linkedShipment ? (
                <div className="flex items-center justify-between rounded-md border p-2">
                  <div className="flex flex-col">
                    <span className="font-mono text-[11px] font-medium">{linkedShipment.shipmentNumber}</span>
                    <span className="text-[10px] text-muted-foreground">{t(`status.${linkedShipment.status}`)}</span>
                  </div>
                  <Button size="xs" variant="ghost" onClick={() => { onOpenChange(false); navigate("shipments") }}>View</Button>
                </div>
              ) : (
                <Select onValueChange={handleBindShipment}>
                  <SelectTrigger size="sm" className="h-7 text-xs">
                    <SelectValue placeholder="Bind to shipment..." />
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
                  <DataRow label="Customer" value={linkedInvoice.customerName} />
                  <DataRow label={t("common.date")} value={formatDate(linkedInvoice.date)} />
                  <DataRow label={t("common.total")} value={formatCurrency(linkedInvoice.totalNegotiated, settings.currencySymbol)} />
                  <DataRow label="Mode" value={linkedInvoice.saleMode} />
                </div>
                <Button size="sm" variant="outline" onClick={() => { onOpenChange(false); navigate("financials") }}>
                  <Receipt className="size-3.5" /> View Invoice Details
                </Button>
              </div>
            ) : (
              <div className="flex h-32 flex-col items-center justify-center gap-1 text-muted-foreground">
                <Receipt className="size-8 opacity-30" />
                <span className="text-xs">No sales records for this weapon</span>
              </div>
            )}
          </TabsContent>

          <TabsContent value="images" className="flex-1 overflow-y-auto p-3 scrollbar-thin">
            <div className="flex flex-col gap-2">
              <Label className="flex items-center gap-1.5 text-xs">
                <Upload className="size-3.5" /> Upload Image
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
                  <span className="text-xs">No images uploaded</span>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="notes" className="flex-1 overflow-y-auto p-3 scrollbar-thin">
            <div className="flex flex-col gap-2">
              <Label className="text-xs font-medium">Managerial Annotations</Label>
              <Textarea
                value={notesDraft || weapon.notes}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder="Add operational notes, inspection details, or annotations..."
                className="min-h-[120px] text-xs"
              />
              <Button size="sm" onClick={handleSaveNotes}>Save Notes</Button>
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
