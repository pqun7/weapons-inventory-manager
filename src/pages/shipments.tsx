import { useState, useMemo, useEffect, useRef } from "react"
import {
  Truck, Search, Upload, FileSpreadsheet,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { SavedFiltersBar } from "@/components/ui/saved-filters-bar"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useStore } from "@/lib/store"
import { useI18n } from "@/lib/i18n"
import { useCurrency } from "@/lib/currency-context"
import { formatDate, shipmentStatusClass, shipmentDelayDays } from "@/lib/format"
import type { ShipmentStatus, SavedFilter } from "@/lib/types"
import { toast } from "sonner"
import { CreateShipmentWizard } from "@/components/create-shipment-wizard"
import { ShipmentDetailPanel } from "@/components/shipment-detail-panel"
import { parseManifestFile, type ManifestImportResult } from "@/lib/manifest-import"
import type { ShipmentLineItemInput } from "@/lib/store"

const SHIPMENT_STATUSES: ShipmentStatus[] = ["Pending", "In Transit", "Delayed", "Arrived", "Cancelled", "Partial"]

export function ShipmentsPage() {
  const { t } = useI18n()
  const { transactionCurrency, formatOriginal } = useCurrency()
  const shipments = useStore((s) => s.shipments)
  const suppliers = useStore((s) => s.suppliers)
  const weapons = useStore((s) => s.weapons)
  const autoFlagDelayedShipments = useStore((s) => s.autoFlagDelayedShipments)
  const refreshFromDb = useStore((s) => s.refreshFromDb)

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<ShipmentStatus | "all">("all")
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importResult, setImportResult] = useState<ManifestImportResult | null>(null)
  const [importedItems, setImportedItems] = useState<ShipmentLineItemInput[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void refreshFromDb().then(() => autoFlagDelayedShipments())
  }, [refreshFromDb, autoFlagDelayedShipments])

  const registeredByShipmentId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const weapon of weapons) {
      if (weapon.shipmentId) counts.set(weapon.shipmentId, (counts.get(weapon.shipmentId) ?? 0) + 1)
    }
    return counts
  }, [weapons])

  const supplierMap = useMemo(() => {
    const map: Record<string, string> = {}
    suppliers.forEach((s) => (map[s.id] = s.name))
    return map
  }, [suppliers])

  const filtered = useMemo(() => {
    let result = shipments
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((s) =>
        s.shipmentNumber.toLowerCase().includes(q) ||
        (supplierMap[s.supplierId] ?? "").toLowerCase().includes(q) ||
        (s.purchaseOrderNumber ?? "").toLowerCase().includes(q) ||
        (s.shippingCarrier ?? "").toLowerCase().includes(q)
      )
    }
    if (statusFilter !== "all") {
      result = result.filter((s) => s.status === statusFilter)
    }
    return result
  }, [shipments, search, statusFilter, supplierMap])

  const handleLoadFilter = (filter: SavedFilter) => {
    const state = filter.filterState
    if (typeof state.search === "string") setSearch(state.search)
    if (typeof state.statusFilter === "string") setStatusFilter(state.statusFilter as ShipmentStatus | "all")
  }

  const selectedShipment = shipments.find((s) => s.id === selectedShipmentId)

  const statusKey: Record<ShipmentStatus, string> = {
    "Pending": "ship.pending",
    "In Transit": "ship.inTransit",
    "Delayed": "ship.delayed",
    "Arrived": "ship.arrived",
    "Cancelled": "ship.cancelled",
    "Partial": "ship.partial",
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const result = await parseManifestFile(file)
    setImportResult(result)
    // Ensure all label fields exist for smooth preview
    const items = result.lineItems.map(item => ({
      ...item,
      brandLabel: item.brandLabel ?? "",
      modelLabel: item.modelLabel ?? "",
      weaponTypeLabel: item.weaponTypeLabel ?? "",
      subTypeLabel: item.subTypeLabel ?? "",
      caliberLabel: item.caliberLabel ?? "",
      location: item.location ?? { warehouse: "Main", shelf: "", bin: "" },
    }))
    setImportedItems(items)
    if (result.errors.length > 0) {
      toast.error(result.errors[0])
    } else if (result.validRows > 0) {
      toast.success(`${result.validRows} ${t("ship.importRowsParsed")}`)
      setImportOpen(true)
    } else {
      toast.error(t("ship.importNoValidRows"))
    }
    e.target.value = ""
  }

  const handleImportToWizard = () => {
    if (importedItems.length === 0) return
    setImportOpen(false)
    setCreateOpen(true)
  }

  return (
    <div className="flex flex-col gap-3 p-3 lg:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={t("ship.searchShipments")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 ps-8 text-xs" />
        </div>
        <SavedFiltersBar entityType="shipments" currentFilterState={{ search, statusFilter }} onLoadFilter={handleLoadFilter} />
        <Button size="sm" variant="outline" className="h-8" onClick={() => fileInputRef.current?.click()}>
          <FileSpreadsheet className="size-3.5" /> {t("ship.importManifest")}
        </Button>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileSelect} />
        <Button size="sm" className="h-8" onClick={() => setCreateOpen(true)}>
          <Truck className="size-3.5" /> {t("ship.createShipment")}
        </Button>
        <CreateShipmentWizard open={createOpen} onOpenChange={setCreateOpen} prefillLineItems={importedItems.length > 0 ? importedItems : undefined} />
      </div>

      {/* Stats summary bar */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {SHIPMENT_STATUSES.map((status) => {
          const count = shipments.filter((s) => s.status === status).length
          return (
            <div key={status} className="rounded-lg border p-2 text-center">
              <div className="text-[10px] text-muted-foreground">{t(statusKey[status])}</div>
              <div className="text-lg font-bold tabular-nums">{count}</div>
            </div>
          )
        })}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Shipment list */}
        <div className="rounded-lg border">
          <div className="border-b bg-muted/30 px-2 py-1.5 text-[11px] font-medium flex items-center justify-between">
            <span>{t("page.shipments")} ({filtered.length})</span>
          </div>
          <div className="max-h-[500px] overflow-y-auto scrollbar-thin">
            {filtered.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">{t("ship.noShipments")}</div>
            ) : filtered.map((s) => {
              const registered = registeredByShipmentId.get(s.id) ?? 0
              const pct = s.totalExpectedItems > 0 ? Math.round((registered / s.totalExpectedItems) * 100) : 0
              const delayDays = shipmentDelayDays(s.expectedArrivalDate, s.status)
              const hasItems = (s.lineItems?.length ?? 0) > 0
              return (
                <div
                  key={s.id}
                  className={`flex items-center justify-between border-b px-2 py-2 cursor-pointer hover:bg-muted/30 last:border-0 ${selectedShipmentId === s.id ? "bg-muted" : ""}`}
                  onClick={() => setSelectedShipmentId(s.id)}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="font-mono text-[11px] font-medium">{s.shipmentNumber}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {supplierMap[s.supplierId] ?? s.supplierId} — {formatDate(s.shipmentDate)}
                    </span>
                    {hasItems && (
                      <span className="text-[9px] text-muted-foreground">
                        {s.lineItems!.length} {t("ship.lineItemsShort")} · {s.lineItems!.reduce((sum, li) => sum + li.quantity, 0)} {t("ship.itemsShort")}
                      </span>
                    )}
                    {s.status === "Delayed" && delayDays > 0 && (
                      <span className="text-[10px] font-medium text-status-sold-fg">{t("ship.delayed")} — {delayDays} {t("ship.delayDays")}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] tabular-nums">{registered}/{s.totalExpectedItems}</span>
                      <Progress value={pct} className="mt-0.5 h-1 w-16" />
                    </div>
                    <Badge variant="outline" className={`text-[9px] ${shipmentStatusClass(s.status)}`}>{t(statusKey[s.status])}</Badge>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Detail panel */}
        {selectedShipment ? (
          <ShipmentDetailPanel shipment={selectedShipment} />
        ) : (
          <Card>
            <CardContent className="flex h-full min-h-[200px] items-center justify-center">
              <div className="flex flex-col items-center gap-1 text-muted-foreground">
                <Truck className="size-8 opacity-30" />
                <span className="text-xs">{t("ship.selectShipment")}</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Import Preview Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Upload className="size-4" /> {t("ship.importPreview")}
            </DialogTitle>
          </DialogHeader>

          {importResult && (
            <div className="flex flex-col gap-3">
              {/* Stats */}
              <div className="grid grid-cols-4 gap-2">
                <div className="rounded-md border p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">{t("ship.importTotalRows")}</div>
                  <div className="text-base font-bold tabular-nums">{importResult.totalRows}</div>
                </div>
                <div className="rounded-md border border-status-returned/30 bg-status-returned/10 p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">{t("ship.importValidRows")}</div>
                  <div className="text-base font-bold tabular-nums text-status-returned-fg">{importResult.validRows}</div>
                </div>
                <div className="rounded-md border border-status-sold/30 bg-status-sold/10 p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">{t("ship.importErrors")}</div>
                  <div className="text-base font-bold tabular-nums text-status-sold-fg">{importResult.errors.length}</div>
                </div>
                <div className="rounded-md border border-status-reserved/30 bg-status-reserved/10 p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">{t("ship.importWarnings")}</div>
                  <div className="text-base font-bold tabular-nums text-status-reserved-fg">{importResult.warnings.length}</div>
                </div>
              </div>

              {/* Warnings */}
              {importResult.warnings.length > 0 && (
                <ScrollArea className="max-h-[80px] rounded-md border border-status-reserved/30 bg-status-reserved/5 p-2">
                  <div className="flex flex-col gap-1">
                    {importResult.warnings.map((w, i) => (
                      <div key={i} className="text-[10px] text-status-reserved-fg">{w}</div>
                    ))}
                  </div>
                </ScrollArea>
              )}

              {/* Parsed line items preview */}
              <ScrollArea className="max-h-[250px] rounded-md border">
                <div className="p-2">
                  <div className="grid grid-cols-6 gap-2 border-b pb-1 text-[10px] font-medium text-muted-foreground">
                    <span>{t("common.type")}</span>
                    <span>{t("weapon.brand")}</span>
                    <span>{t("weapon.model")}</span>
                    <span>{t("common.quantity")}</span>
                    <span>{t("ship.serials")}</span>
                    <span>{t("common.purchasePrice")} ({transactionCurrency})</span>
                  </div>
                  {importedItems.map((item, i) => (
                    <div key={i} className="grid grid-cols-6 gap-2 border-b py-1 text-[10px] last:border-0">
                      <span>{t(`ship.prodType.${item.productType}`)}</span>
                      <span className="truncate">{item.brandLabel ?? ""}</span>
                      <span className="truncate">{item.modelLabel ?? ""}</span>
                      <span className="tabular-nums">{item.quantity}</span>
                      <span className="tabular-nums">{item.serialNumbers.length}</span>
                      <span className="tabular-nums">{formatOriginal(item.purchasePrice, transactionCurrency)}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setImportOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" disabled={importedItems.length === 0} onClick={handleImportToWizard}>
              <Truck className="size-3.5" /> {t("ship.importToWizard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
