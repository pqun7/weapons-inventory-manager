import { useState, useMemo, useEffect } from "react"
import {
  Truck, Search, FileSpreadsheet,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { SavedFiltersBar } from "@/components/ui/saved-filters-bar"
import { useStore } from "@/lib/store"
import { useI18n } from "@/lib/i18n"
import { formatDate, shipmentStatusClass, shipmentDelayDays } from "@/lib/format"
import type { ShipmentStatus, SavedFilter } from "@/lib/types"
import { CreateShipmentWizard } from "@/components/create-shipment-wizard"
import { ShipmentDetailPanel } from "@/components/shipment-detail-panel"
import { ShipmentManifestImportDialog } from "@/components/shipment-manifest-import-dialog"

const SHIPMENT_STATUSES: ShipmentStatus[] = ["Pending", "In Transit", "Delayed", "Arrived", "Cancelled", "Partial"]

export function ShipmentsPage() {
  const { t } = useI18n()
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

  return (
    <div className="flex flex-col gap-3 p-3 lg:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={t("ship.searchShipments")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 ps-8 text-xs" />
        </div>
        <SavedFiltersBar entityType="shipments" currentFilterState={{ search, statusFilter }} onLoadFilter={handleLoadFilter} />
        <Button size="sm" variant="outline" className="h-8" onClick={() => setImportOpen(true)}>
          <FileSpreadsheet className="size-3.5" /> {t("ship.importManifest")}
        </Button>
        <Button size="sm" className="h-8" onClick={() => setCreateOpen(true)}>
          <Truck className="size-3.5" /> {t("ship.createShipment")}
        </Button>
        <CreateShipmentWizard open={createOpen} onOpenChange={setCreateOpen} />
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

      <ShipmentManifestImportDialog open={importOpen} onOpenChange={setImportOpen} onComplete={() => setImportOpen(false)} />
    </div>
  )
}
