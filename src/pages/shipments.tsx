import { useState, useMemo, useEffect } from "react"
import {
  Truck, Search, FileSpreadsheet, X, ArrowUpDown, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { SavedFiltersBar } from "@/components/ui/saved-filters-bar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useStore } from "@/lib/store"
import { useI18n } from "@/lib/i18n"
import { formatDate, shipmentStatusClass, shipmentDelayDays } from "@/lib/format"
import type { ShipmentStatus, SavedFilter } from "@/lib/types"
import { CreateShipmentWizard } from "@/components/create-shipment-wizard"
import { ShipmentDetailPanel } from "@/components/shipment-detail-panel"
import { ShipmentManifestImportDialog } from "@/components/shipment-manifest-import-dialog"
import { sortShipmentsNewestFirst } from "@/lib/shipment-workflow"

const SHIPMENT_STATUSES: ShipmentStatus[] = [
  "Pending",
  "In Transit",
  "Delayed",
  "Arrived",
  "Cancelled",
  "Partial",
]

export function ShipmentsPage() {
  const { t } = useI18n()
  const shipments = useStore((s) => s.shipments)
  const suppliers = useStore((s) => s.suppliers)
  const weapons = useStore((s) => s.weapons)
  const autoFlagDelayedShipments = useStore((s) => s.autoFlagDelayedShipments)
  const refreshFromDb = useStore((s) => s.refreshFromDb)

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<ShipmentStatus | "all">("all")
  const [sortBy, setSortBy] = useState<"addedDate" | "shipmentDate" | "expectedArrival" | "status">("addedDate")
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
    // نبدأ بكل الشحنات ثم نطبق الفلاتر
    let result = shipments;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.shipmentNumber.toLowerCase().includes(q) ||
          (supplierMap[s.supplierId] ?? "").toLowerCase().includes(q) ||
          (s.purchaseOrderNumber ?? "").toLowerCase().includes(q) ||
          (s.shippingCarrier ?? "").toLowerCase().includes(q),
      );
    }
    if (statusFilter !== "all") {
      result = result.filter((s) => s.status === statusFilter);
    }

    // تطبيق الفرز حسب الاختيار
    if (sortBy === "addedDate") {
      return sortShipmentsNewestFirst(result);
    } else if (sortBy === "shipmentDate") {
      return [...result].sort((a, b) => Date.parse(b.shipmentDate) - Date.parse(a.shipmentDate));
    } else if (sortBy === "expectedArrival") {
      return [...result].sort((a, b) => {
        const aDate = a.expectedArrivalDate ? new Date(a.expectedArrivalDate).getTime() : 0;
        const bDate = b.expectedArrivalDate ? new Date(b.expectedArrivalDate).getTime() : 0;
        return bDate - aDate;
      });
    } else if (sortBy === "status") {
      const statusOrder: Record<ShipmentStatus, number> = {
        Pending: 0,
        "In Transit": 1,
        Delayed: 2,
        Arrived: 3,
        Cancelled: 4,
        Partial: 5,
      };
      return [...result].sort(
        (a, b) => (statusOrder[a.status] ?? 0) - (statusOrder[b.status] ?? 0),
      );
    }
    return result;
  }, [shipments, search, statusFilter, sortBy, supplierMap]);

  const handleLoadFilter = (filter: SavedFilter) => {
    const state = filter.filterState
    if (typeof state.search === "string") setSearch(state.search)
    if (typeof state.statusFilter === "string") setStatusFilter(state.statusFilter as ShipmentStatus | "all")
  }

  const selectedShipment = shipments.find((s) => s.id === selectedShipmentId)

  const statusCounts = useMemo(() => {
    const counts: Record<ShipmentStatus, number> = {
      "Pending": 0,
      "In Transit": 0,
      "Delayed": 0,
      "Arrived": 0,
      "Cancelled": 0,
      "Partial": 0,
    }
    shipments.forEach((s) => {
      counts[s.status]++
    })
    return counts
  }, [shipments])

  const statusKey: Record<ShipmentStatus, string> = {
    "Pending": "ship.pending",
    "In Transit": "ship.inTransit",
    "Delayed": "ship.delayed",
    "Arrived": "ship.arrived",
    "Cancelled": "ship.cancelled",
    "Partial": "ship.partial",
  }

  const hasFilters = search !== "" || statusFilter !== "all"

  return (
    <div className="flex flex-col gap-3 p-3 lg:p-4">
      {/* Top actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("ship.searchShipments")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 ps-8 text-xs"
          />
        </div>

        <SavedFiltersBar
          entityType="shipments"
          currentFilterState={{ search, statusFilter }}
          onLoadFilter={handleLoadFilter}
        />

        {hasFilters && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => {
              setSearch("")
              setStatusFilter("all")
            }}
          >
            <X className="size-3.5 me-1" />
            {t("common.clearFilters")}
          </Button>
        )}

        <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <ArrowUpDown className="size-3.5 me-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="addedDate">{t("ship.sortByAddedDate")}</SelectItem>
            <SelectItem value="shipmentDate">{t("ship.sortByShipmentDate")}</SelectItem>
            <SelectItem value="expectedArrival">{t("ship.sortByExpectedArrival")}</SelectItem>
            <SelectItem value="status">{t("ship.sortByStatus")}</SelectItem>
          </SelectContent>
        </Select>

        <Button size="sm" variant="outline" className="h-8" onClick={() => setImportOpen(true)}>
          <FileSpreadsheet className="size-3.5" /> {t("ship.importManifest")}
        </Button>
        <Button size="sm" className="h-8" onClick={() => setCreateOpen(true)}>
          <Truck className="size-3.5" /> {t("ship.createShipment")}
        </Button>
        <CreateShipmentWizard open={createOpen} onOpenChange={setCreateOpen} />
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setStatusFilter("all")}
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors ${statusFilter === "all"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
        >
          {t("ship.allStatus")}
          <span className="ml-1.5 rounded-full bg-background/30 px-1.5 text-[10px]">
            {shipments.length}
          </span>
        </button>
        {SHIPMENT_STATUSES.map((status) => {
          const count = statusCounts[status]
          return (
            <button
              key={status}
              type="button"
              onClick={() =>
                setStatusFilter(statusFilter === status ? "all" : status)
              }
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors ${statusFilter === status
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
            >
              {t(statusKey[status])}
              <span className="ml-1.5 rounded-full bg-background/30 px-1.5 text-[10px]">
                {count}
              </span>
            </button>
          )
        })}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Shipment list */}
        <Card className="overflow-hidden">
          <div className="border-b bg-muted/30 px-3 py-2 text-xs font-medium flex items-center justify-between">
            <span>
              {t("page.shipments")} ({filtered.length})
            </span>
          </div>
          <div className="max-h-[520px] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
                <Truck className="size-10 opacity-20" />
                <span className="text-xs">{t("ship.noShipments")}</span>
              </div>
            ) : (
              filtered.map((s) => {
                const registered = registeredByShipmentId.get(s.id) ?? 0
                const pct =
                  s.totalExpectedItems > 0
                    ? Math.round((registered / s.totalExpectedItems) * 100)
                    : 0
                const delayDays = shipmentDelayDays(s.expectedArrivalDate, s.status)
                const hasItems = (s.lineItems?.length ?? 0) > 0

                return (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (!s.isSaving && (e.key === "Enter" || e.key === " ")) setSelectedShipmentId(s.id)
                    }}
                    onClick={() => { if (!s.isSaving) setSelectedShipmentId(s.id) }}
                    aria-disabled={s.isSaving}
                    className={`group flex items-start gap-3 border-b px-3 py-3 transition-colors last:border-0 ${s.isSaving ? "cursor-wait bg-primary/[0.03] opacity-80" : "cursor-pointer hover:bg-muted/50"} ${selectedShipmentId === s.id
                      ? "bg-muted ring-1 ring-inset ring-primary/20"
                      : ""
                      }`}
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold truncate">
                          {s.shipmentNumber}
                        </span>
                        {s.isSaving ? (
                          <Badge variant="outline" className="h-5 gap-1 border-primary/30 bg-primary/5 px-1.5 py-0 text-[10px] text-primary">
                            <Loader2 className="size-3 animate-spin" /> {t("common.loading")}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 ${shipmentStatusClass(s.status)}`}>
                            {t(statusKey[s.status])}
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {supplierMap[s.supplierId] ?? s.supplierId}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{formatDate(s.shipmentDate)}</span>
                        {hasItems && (
                          <span className="inline-flex items-center gap-1">
                            <span className="h-1 w-1 rounded-full bg-muted-foreground" />
                            {s.lineItems!.length} {t("ship.lineItemsShort")}
                          </span>
                        )}
                      </div>
                      {s.status === "Delayed" && delayDays > 0 && (
                        <p className="text-[11px] font-medium text-status-sold-fg">
                          {t("ship.delayed")} — {delayDays} {t("ship.delayDays")}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col items-end min-w-[80px]">
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {registered}/{s.totalExpectedItems}
                      </span>
                      <Progress value={s.isSaving ? 35 : pct} className="mt-1 h-1.5 w-full" />
                      <span className="text-[10px] text-muted-foreground mt-0.5">
                        {s.isSaving ? t("common.loading") : `${pct}%`}
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </Card>

        {/* Detail panel */}
        {selectedShipment ? (
          <ShipmentDetailPanel shipment={selectedShipment} />
        ) : (
          <Card className="flex items-center justify-center min-h-[300px]">
            <CardContent className="flex flex-col items-center gap-2 text-muted-foreground py-10">
              <Truck className="size-12 opacity-20" />
              <span className="text-sm font-medium">{t("ship.selectShipment")}</span>
              <span className="text-xs max-w-[220px] text-center">
                {t("ship.selectShipmentHint")}
              </span>
            </CardContent>
          </Card>
        )}
      </div>

      <ShipmentManifestImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onComplete={() => setImportOpen(false)}
      />
    </div>
  )
}
