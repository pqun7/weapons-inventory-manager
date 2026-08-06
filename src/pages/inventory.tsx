import { useMemo, useState, useCallback } from "react"
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  getPaginationRowModel, flexRender, type ColumnDef, type SortingState,
} from "@tanstack/react-table"
import {
  ArrowUpDown, ChevronLeft, ChevronRight, Plus, Search, Package, Boxes, Settings,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { useStore } from "@/lib/store"
import { useNav } from "@/lib/nav"
import { useDebounce } from "@/hooks"
import { useI18n } from "@/lib/i18n"
import {
  formatCurrency, formatDateShort, statusRowClass, statusBadgeClass, statusDotClass,
} from "@/lib/format"
import type { Weapon, WeaponStatus, StorageLocation, SavedFilter, Ammunition, PackageType } from "@/lib/types"
import { ACCESSORY_TYPES, AMMUNITION_CALIBERS, ammoTotalRounds } from "@/lib/types"
import { BulkIntakeForm } from "@/components/bulk-intake-form"
import { ExcelToolbar } from "@/components/excel-toolbar"
import { WeaponDetailPanel } from "@/components/weapon-detail-panel"
import { SavedFiltersBar } from "@/components/ui/saved-filters-bar"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"

const STATUS_FILTERS: (WeaponStatus | "All")[] = ["All", "Available", "Reserved", "Sold", "Returned"]

const PACKAGE_TYPES: PackageType[] = ["Carton", "Box", "Case", "Custom"]

type AddStockTarget = { itemType: "accessory"; itemId: string; itemName: string }

export function InventoryPage() {
  const { t } = useI18n()
  const weapons = useStore((s) => s.weapons)
  const accessories = useStore((s) => s.accessories)
  const ammunition = useStore((s) => s.ammunition)
  const shipments = useStore((s) => s.shipments)
  const settings = useStore((s) => s.settings)
  const updateWeaponStatus = useStore((s) => s.updateWeaponStatus)
  const addAccessory = useStore((s) => s.addAccessory)
  const addAmmunition = useStore((s) => s.addAmmunition)
  const addStock = useStore((s) => s.addStock)
  const { setSelectedWeaponId, selectedWeaponId } = useNav()

  const [sorting, setSorting] = useState<SortingState>([])
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounce(search, 150)
  const [statusFilter, setStatusFilter] = useState<WeaponStatus | "All">("Available")
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("weapons")
  const [addAccOpen, setAddAccOpen] = useState(false)
  const [addAmmOpen, setAddAmmOpen] = useState(false)
  const [stockTarget, setStockTarget] = useState<AddStockTarget | null>(null)
  const [ammoReceiveTarget, setAmmoReceiveTarget] = useState<Ammunition | null>(null)
  const [ammoPackageTarget, setAmmoPackageTarget] = useState<Ammunition | null>(null)

  // Non-arrived shipments available for linking in the Add Stock modal.
  const pendingShipments = useMemo(
    () => shipments.filter((s) => s.status !== "Arrived"),
    [shipments]
  )

  const filteredData = useMemo(() => {
    let data = weapons
    if (statusFilter !== "All") data = data.filter((w) => w.status === statusFilter)
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase()
      data = data.filter((w) =>
        w.serialNumber.toLowerCase().includes(q) ||
        w.brand.toLowerCase().includes(q) ||
        w.model.toLowerCase().includes(q) ||
        w.weaponType.toLowerCase().includes(q) ||
        w.caliber.toLowerCase().includes(q)
      )
    }
    return data
  }, [weapons, statusFilter, debouncedSearch])

  const columns: ColumnDef<Weapon>[] = useMemo(() => [
    {
      accessorKey: "serialNumber",
      header: "Serial",
      cell: ({ row }) => <span className="font-mono text-[11px] font-medium">{row.original.serialNumber}</span>,
    },
    {
      accessorKey: "brand",
      header: t("weapon.brand"),
      cell: ({ row }) => <span className="text-xs font-medium">{row.original.brand}</span>,
    },
    { accessorKey: "model", header: t("weapon.model"), cell: ({ row }) => <span className="text-xs">{row.original.model}</span> },
    {
      accessorKey: "weaponType",
      header: t("common.type"),
      cell: ({ row }) => <Badge variant="outline" className="text-[10px]">{row.original.weaponType}</Badge>,
    },
    { accessorKey: "caliber", header: t("inv.caliber"), cell: ({ row }) => <span className="text-[11px] text-muted-foreground">{row.original.caliber}</span> },
    { accessorKey: "condition", header: "Cond.", cell: ({ row }) => <span className="text-[11px]">{row.original.condition}</span> },
    {
      accessorKey: "status",
      header: t("common.status"),
      cell: ({ row }) => (
        <Badge className={`border text-[10px] ${statusBadgeClass(row.original.status)}`}>
          <span className={`me-1 size-1.5 rounded-full ${statusDotClass(row.original.status)}`} />
          {t(`status.${row.original.status}`)}
        </Badge>
      ),
    },
    { accessorKey: "purchasePrice", header: "Cost", cell: ({ row }) => <span className="tabular-nums text-[11px] text-muted-foreground">{formatCurrency(row.original.purchasePrice, settings.currencySymbol)}</span> },
    { accessorKey: "retailPrice", header: "Retail", cell: ({ row }) => <span className="tabular-nums text-[11px] font-medium">{formatCurrency(row.original.retailPrice, settings.currencySymbol)}</span> },
    { accessorKey: "wholesalePrice", header: "Wholesale", cell: ({ row }) => <span className="tabular-nums text-[11px] text-muted-foreground">{formatCurrency(row.original.wholesalePrice, settings.currencySymbol)}</span> },
    { accessorKey: "dateAdded", header: "Added", cell: ({ row }) => <span className="text-[10px] text-muted-foreground">{formatDateShort(row.original.dateAdded)}</span> },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Select value={row.original.status} onValueChange={async (v) => { const res = await updateWeaponStatus(row.original.id, v as WeaponStatus); if (!res.success) toast.error(res.error ?? "Failed") }}>
          <SelectTrigger size="sm" className="h-6 w-20 text-[10px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Available">{t("status.Available")}</SelectItem>
            <SelectItem value="Reserved">{t("status.Reserved")}</SelectItem>
            <SelectItem value="Sold">{t("status.Sold")}</SelectItem>
            <SelectItem value="Returned">{t("status.Returned")}</SelectItem>
          </SelectContent>
        </Select>
      ),
      enableSorting: false,
    },
  ], [updateWeaponStatus, settings.currencySymbol, t])

  const table = useReactTable({
    data: filteredData, columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  })

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { All: weapons.length }
    weapons.forEach((w) => { counts[w.status] = (counts[w.status] ?? 0) + 1 })
    return counts
  }, [weapons])

  const handleRowClick = useCallback((weaponId: string) => {
    setSelectedWeaponId(weaponId)
    setPanelOpen(true)
  }, [setSelectedWeaponId])

  const handleLoadFilter = useCallback((filter: SavedFilter) => {
    const fs = filter.filterState
    if (typeof fs.statusFilter === "string") {
      setStatusFilter(fs.statusFilter as WeaponStatus | "All")
    }
    if (typeof fs.search === "string") {
      setSearch(fs.search)
    }
    if (typeof fs.activeTab === "string") {
      setActiveTab(fs.activeTab)
    }
  }, [])

  const currentFilterState = useMemo(
    () => ({ statusFilter, search, activeTab }),
    [statusFilter, search, activeTab]
  )

  return (
    <div className="flex flex-col gap-3 p-3 lg:p-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-8">
          <TabsTrigger value="weapons" className="text-xs"><Package className="size-3.5" /> {t("inv.weapons")} ({weapons.length})</TabsTrigger>
          <TabsTrigger value="accessories" className="text-xs"><Boxes className="size-3.5" /> {t("inv.accessories")} ({accessories.length})</TabsTrigger>
          <TabsTrigger value="ammunition" className="text-xs"><Boxes className="size-3.5" /> {t("inv.ammunition")} ({ammunition.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="weapons">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder={t("inv.searchWeapon")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 ps-8 text-xs" />
              </div>
              <SavedFiltersBar
                entityType="inventory"
                currentFilterState={currentFilterState}
                onLoadFilter={handleLoadFilter}
              />
              <ExcelToolbar />
              <Dialog open={intakeOpen} onOpenChange={setIntakeOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="h-8"><Plus className="size-3.5" /> {t("inv.addWeapon")}</Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-thin">
                  <DialogHeader><DialogTitle className="text-sm">{t("bulk.title")}</DialogTitle></DialogHeader>
                  <BulkIntakeForm onComplete={() => setIntakeOpen(false)} />
                </DialogContent>
              </Dialog>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] font-medium text-muted-foreground">{t("inv.status")}</span>
              {STATUS_FILTERS.map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${statusFilter === status ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-accent"
                    }`}
                >
                  {status !== "All" && <span className={`size-1.5 rounded-full ${statusDotClass(status as WeaponStatus)}`} />}
                  {status === "All" ? t("common.all") : t(`status.${status}`)} ({statusCounts[status] ?? 0})
                </button>
              ))}
            </div>

            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((hg) => (
                    <TableRow key={hg.id} className="bg-muted/50">
                      {hg.headers.map((h) => (
                        <TableHead key={h.id} className="h-8 px-2">
                          {h.isPlaceholder ? null : (
                            <button className="inline-flex items-center gap-1 text-[10px] font-medium" onClick={h.column.getToggleSortingHandler()} disabled={!h.column.getCanSort()}>
                              {flexRender(h.column.columnDef.header, h.getContext())}
                              {h.column.getCanSort() && <ArrowUpDown className="size-2.5 opacity-50" />}
                            </button>
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.length > 0 ? (
                    table.getRowModel().rows.map((row) => (
                      <TableRow
                        key={row.id}
                        className={`${statusRowClass(row.original.status)} cursor-pointer border-b`}
                        onClick={() => handleRowClick(row.original.id)}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id} className="py-1.5" onClick={cell.column.id === "actions" ? (e) => e.stopPropagation() : undefined}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow><TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-1"><Package className="size-8" /><span className="text-xs">{t("inv.noWeapons")}</span></div>
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] text-muted-foreground">
                {table.getRowModel().rows.length} {t("inv.weaponsCount")} {filteredData.length} {t("inv.weaponsWord")}
              </span>
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="xs" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
                  <ChevronLeft className="size-3" /> {t("inv.prev")}
                </Button>
                <span className="text-[10px] text-muted-foreground">
                  {table.getState().pagination.pageIndex + 1} / {table.getPageCount() || 1}
                </span>
                <Button variant="outline" size="xs" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
                  {t("inv.next")} <ChevronRight className="size-3" />
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="accessories">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{accessories.length} {t("inv.accessoryItems")}</span>
              <Dialog open={addAccOpen} onOpenChange={setAddAccOpen}>
                <DialogTrigger asChild><Button size="sm" className="h-8"><Plus className="size-3.5" /> {t("inv.addAccessory")}</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle className="text-sm">{t("inv.addAccessory")}</DialogTitle></DialogHeader>
                  <AddAccessoryForm onAdd={async (name, type, qty, threshold, price) => {
                    const res = await addAccessory({ name, type, quantity: qty, safetyThreshold: threshold, price, location: { warehouse: "Main", shelf: "", bin: "" } })
                    if (res.success) { toast.success(t("toast.accessoryAdded")); setAddAccOpen(false) }
                    else toast.error(res.error ?? "Failed")
                  }} />
                </DialogContent>
              </Dialog>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {accessories.map((a) => {
                const low = a.quantity < a.safetyThreshold
                const pct = Math.min(100, (a.quantity / (a.safetyThreshold * 2)) * 100)
                return (
                  <Card key={a.id} className="py-3">
                    <CardContent className="px-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">{a.name}</span>
                        {low && <Badge variant="outline" className="h-4 px-1 text-[9px] text-status-sold">{t("inv.low")}</Badge>}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-lg font-bold tabular-nums">{a.quantity}</span>
                        <span className="text-[10px] text-muted-foreground">{t("inv.min")}: {a.safetyThreshold}</span>
                      </div>
                      <Progress value={pct} className={`mt-1.5 h-1.5 ${low ? "[&>div]:bg-status-sold" : ""}`} />
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">{formatCurrency(a.price, settings.currencySymbol)} {t("inv.each")}</span>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => setStockTarget({ itemType: "accessory", itemId: a.id, itemName: a.name })}
                        >
                          <Plus className="size-3" /> {t("inv.addStock")}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="ammunition">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{ammunition.length} {t("inv.ammoTypes")}</span>
              <Dialog open={addAmmOpen} onOpenChange={setAddAmmOpen}>
                <DialogTrigger asChild><Button size="sm" className="h-8"><Plus className="size-3.5" /> {t("inv.addAmmunition")}</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle className="text-sm">{t("inv.addAmmunition")}</DialogTitle></DialogHeader>
                  <AddAmmunitionForm onAdd={async (caliber, packageType, unitsPerPackage, fullPackages, looseRounds, safetyThreshold, price) => {
                    const res = await addAmmunition({ caliber, packageType, unitsPerPackage, fullPackages, looseRounds, safetyThreshold, price, location: { warehouse: "Main", shelf: "", bin: "" } })
                    if (res.success) { toast.success(t("toast.ammunitionAdded")); setAddAmmOpen(false) }
                    else toast.error(res.error ?? "Failed")
                  }} />
                </DialogContent>
              </Dialog>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {ammunition.map((a) => {
                const totalRounds = ammoTotalRounds(a)
                const low = totalRounds < a.safetyThreshold
                const pct = a.safetyThreshold > 0 ? Math.min(100, (totalRounds / (a.safetyThreshold * 2)) * 100) : 100
                return (
                  <Card key={a.id} className="py-3">
                    <CardContent className="px-3">
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="text-xs font-medium">{a.caliber}</span>
                          <span className="text-[10px] text-muted-foreground">{a.packageType} — {a.unitsPerPackage} {t("inv.roundsPerPkg")}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {low && <Badge variant="outline" className="h-4 px-1 text-[9px] text-status-sold">{t("inv.low")}</Badge>}
                          <Button
                            size="xs"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            onClick={() => setAmmoPackageTarget(a)}
                          >
                            <Settings className="size-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-1.5">
                        <span className="text-sm font-bold tabular-nums">
                          {a.looseRounds > 0
                            ? `${a.fullPackages} ${a.packageType} + ${a.looseRounds} (${totalRounds} ${t("inv.totalRounds")})`
                            : `${a.fullPackages} ${a.packageType} (${totalRounds} ${t("inv.totalRounds")})`}
                        </span>
                      </div>
                      <Progress value={pct} className={`mt-1.5 h-1.5 ${low ? "[&>div]:bg-status-sold" : ""}`} />
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">{formatCurrency(a.price, settings.currencySymbol)} {t("inv.perRound")}</span>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => setAmmoReceiveTarget(a)}
                        >
                          <Plus className="size-3" /> {t("inv.addStock")}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <AddStockDialog
        target={stockTarget}
        shipments={pendingShipments}
        onClose={() => setStockTarget(null)}
        onConfirm={async (payload) => {
          const res = await addStock(payload)
          if (res.success) {
            toast.success(t("toast.stockAdded"))
            setStockTarget(null)
          } else {
            toast.error(res.error ?? "Failed to add stock")
          }
        }}
      />

      <AmmoReceiveDialog
        ammo={ammoReceiveTarget}
        shipments={pendingShipments}
        onClose={() => setAmmoReceiveTarget(null)}
      />

      <AmmoPackageDialog
        ammo={ammoPackageTarget}
        onClose={() => setAmmoPackageTarget(null)}
      />

      <WeaponDetailPanel
        weaponId={selectedWeaponId}
        open={panelOpen}
        onOpenChange={setPanelOpen}
      />
    </div>
  )
}

// ============ Add Stock Dialog (Accessories only) ============

interface AddStockDialogProps {
  target: AddStockTarget | null
  shipments: { id: string; shipmentNumber: string; status: string }[]
  onClose: () => void
  onConfirm: (payload: {
    itemType: "accessory"
    itemId: string
    quantity: number
    purchasePrice: number
    shipmentId: string | null
    notes: string
    location?: StorageLocation
  }) => void
}

function AddStockDialog({ target, shipments, onClose, onConfirm }: AddStockDialogProps) {
  const { t } = useI18n()
  const [quantity, setQuantity] = useState("0")
  const [purchasePrice, setPurchasePrice] = useState("0")
  const [shipmentId, setShipmentId] = useState<string | null>(null)
  const [notes, setNotes] = useState("")
  const [warehouse, setWarehouse] = useState("Main")
  const [shelf, setShelf] = useState("")
  const [bin, setBin] = useState("")

  // Reset form whenever a new target is opened.
  const lastTargetId = target?.itemId ?? null
  const [resetKey, setResetKey] = useState<string | null>(null)
  if (target && lastTargetId !== resetKey) {
    setResetKey(lastTargetId)
    setQuantity("0")
    setPurchasePrice("0")
    setShipmentId(null)
    setNotes("")
    setWarehouse("Main")
    setShelf("")
    setBin("")
  }

  const handleConfirm = () => {
    if (!target) return
    const qty = Number(quantity)
    const price = Number(purchasePrice)
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Quantity must be greater than 0")
      return
    }
    if (!Number.isFinite(price) || price < 0) {
      toast.error("Purchase price must be 0 or greater")
      return
    }
    onConfirm({
      itemType: target.itemType,
      itemId: target.itemId,
      quantity: qty,
      purchasePrice: price,
      shipmentId,
      notes,
      location: { warehouse, shelf, bin },
    })
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{t("inv.addStock")}</DialogTitle>
        </DialogHeader>
        {target && (
          <div className="grid gap-3">
            <div>
              <Label className="text-xs">Item</Label>
              <Input value={target.itemName} readOnly className="h-8 bg-muted/50 text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Quantity to add</Label>
                <Input type="number" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-xs">{t("common.purchasePrice")}</Label>
                <Input type="number" min={0} step="0.01" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>
            <div>
              <Label className="text-xs">{t("inv.shipment")}</Label>
              <Select value={shipmentId ?? "__none__"} onValueChange={(v) => setShipmentId(v === "__none__" ? null : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("inv.noShipment")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("inv.noShipment")}</SelectItem>
                  {shipments.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.shipmentNumber} ({s.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("common.notes")}</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes..." className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs">{t("common.location")}</Label>
              <div className="grid grid-cols-3 gap-2">
                <Input value={warehouse} onChange={(e) => setWarehouse(e.target.value)} placeholder={t("common.warehouse")} className="h-8 text-xs" />
                <Input value={shelf} onChange={(e) => setShelf(e.target.value)} placeholder={t("common.shelf")} className="h-8 text-xs" />
                <Input value={bin} onChange={(e) => setBin(e.target.value)} placeholder={t("common.bin")} className="h-8 text-xs" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
              <Button size="sm" onClick={handleConfirm}>{t("common.confirm")}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ============ Ammo Receive Dialog (Tabs: by Packages / by Rounds) ============

function AmmoReceiveDialog({ ammo, shipments, onClose }: {
  ammo: Ammunition | null
  shipments: { id: string; shipmentNumber: string; status: string }[]
  onClose: () => void
}) {
  const { t } = useI18n()
  const receiveAmmoByPackages = useStore((s) => s.receiveAmmoByPackages)
  const receiveAmmoByRounds = useStore((s) => s.receiveAmmoByRounds)

  const [receiveTab, setReceiveTab] = useState("packages")
  const [numberOfPackages, setNumberOfPackages] = useState("0")
  const [unitsPerPackage, setUnitsPerPackage] = useState("50")
  const [totalRoundsInput, setTotalRoundsInput] = useState("0")
  const [purchasePrice, setPurchasePrice] = useState("0")
  const [shipmentId, setShipmentId] = useState<string | null>(null)
  const [notes, setNotes] = useState("")
  const [warehouse, setWarehouse] = useState("Main")
  const [shelf, setShelf] = useState("")
  const [bin, setBin] = useState("")

  // Reset form whenever a new ammo item is opened.
  const lastAmmoId = ammo?.id ?? null
  const [resetKey, setResetKey] = useState<string | null>(null)
  if (ammo && lastAmmoId !== resetKey) {
    setResetKey(lastAmmoId)
    setReceiveTab("packages")
    setNumberOfPackages("0")
    setUnitsPerPackage(String(ammo.unitsPerPackage))
    setTotalRoundsInput("0")
    setPurchasePrice("0")
    setShipmentId(null)
    setNotes("")
    setWarehouse(ammo.location.warehouse || "Main")
    setShelf(ammo.location.shelf)
    setBin(ammo.location.bin)
  }

  const computedTotal = (Number(numberOfPackages) || 0) * (Number(unitsPerPackage) || 0)

  const handleConfirmPackages = async () => {
    if (!ammo) return
    const pkgs = Number(numberOfPackages)
    const units = Number(unitsPerPackage)
    const price = Number(purchasePrice)
    if (!Number.isFinite(pkgs) || pkgs <= 0) {
      toast.error("Number of packages must be greater than 0")
      return
    }
    if (!Number.isFinite(units) || units <= 0) {
      toast.error("Units per package must be greater than 0")
      return
    }
    if (!Number.isFinite(price) || price < 0) {
      toast.error("Purchase price must be 0 or greater")
      return
    }
    const res = await receiveAmmoByPackages({
      itemId: ammo.id,
      numberOfPackages: pkgs,
      unitsPerPackage: units,
      purchasePrice: price,
      shipmentId,
      notes,
      location: { warehouse, shelf, bin },
    })
    if (res.success) {
      toast.success(t("toast.ammoReceivedPackages"))
      onClose()
    } else {
      toast.error(res.error ?? "Failed to receive ammunition")
    }
  }

  const handleConfirmRounds = async () => {
    if (!ammo) return
    const rounds = Number(totalRoundsInput)
    const price = Number(purchasePrice)
    if (!Number.isFinite(rounds) || rounds <= 0) {
      toast.error("Total rounds must be greater than 0")
      return
    }
    if (!Number.isFinite(price) || price < 0) {
      toast.error("Purchase price must be 0 or greater")
      return
    }
    const res = await receiveAmmoByRounds({
      itemId: ammo.id,
      totalRounds: rounds,
      purchasePrice: price,
      shipmentId,
      notes,
      location: { warehouse, shelf, bin },
    })
    if (res.success) {
      toast.success(t("toast.ammoReceivedRounds"))
      onClose()
    } else {
      toast.error(res.error ?? "Failed to receive ammunition")
    }
  }

  return (
    <Dialog open={ammo !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{t("inv.addStock")} — {ammo?.caliber}</DialogTitle>
        </DialogHeader>
        {ammo && (
          <Tabs value={receiveTab} onValueChange={setReceiveTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="packages" className="text-xs">{t("inv.receiveByPackages")}</TabsTrigger>
              <TabsTrigger value="rounds" className="text-xs">{t("inv.receiveByRounds")}</TabsTrigger>
            </TabsList>

            <TabsContent value="packages" className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">{t("inv.numberOfPackages")}</Label>
                  <Input type="number" min={0} value={numberOfPackages} onChange={(e) => setNumberOfPackages(e.target.value)} className="h-8 text-xs" />
                </div>
                <div>
                  <Label className="text-xs">{t("inv.unitsPerPackage")}</Label>
                  <Input type="number" min={1} value={unitsPerPackage} onChange={(e) => setUnitsPerPackage(e.target.value)} className="h-8 text-xs" />
                </div>
              </div>
              <div className="rounded-md bg-muted/50 px-3 py-2 text-xs">
                {t("inv.totalRounds")}: <span className="font-bold tabular-nums">{computedTotal}</span>
              </div>
              <div>
                <Label className="text-xs">{t("common.purchasePrice")}</Label>
                <Input type="number" min={0} step="0.01" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-xs">{t("inv.shipment")}</Label>
                <Select value={shipmentId ?? "__none__"} onValueChange={(v) => setShipmentId(v === "__none__" ? null : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("inv.noShipment")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("inv.noShipment")}</SelectItem>
                    {shipments.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.shipmentNumber} ({s.status})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("common.notes")}</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes..." className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-xs">{t("common.location")}</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Input value={warehouse} onChange={(e) => setWarehouse(e.target.value)} placeholder={t("common.warehouse")} className="h-8 text-xs" />
                  <Input value={shelf} onChange={(e) => setShelf(e.target.value)} placeholder={t("common.shelf")} className="h-8 text-xs" />
                  <Input value={bin} onChange={(e) => setBin(e.target.value)} placeholder={t("common.bin")} className="h-8 text-xs" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
                <Button size="sm" onClick={handleConfirmPackages}>{t("common.confirm")}</Button>
              </div>
            </TabsContent>

            <TabsContent value="rounds" className="grid gap-3">
              <div>
                <Label className="text-xs">{t("inv.totalRounds")}</Label>
                <Input type="number" min={0} value={totalRoundsInput} onChange={(e) => setTotalRoundsInput(e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-xs">{t("common.purchasePrice")}</Label>
                <Input type="number" min={0} step="0.01" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-xs">{t("inv.shipment")}</Label>
                <Select value={shipmentId ?? "__none__"} onValueChange={(v) => setShipmentId(v === "__none__" ? null : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("inv.noShipment")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("inv.noShipment")}</SelectItem>
                    {shipments.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.shipmentNumber} ({s.status})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("common.notes")}</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes..." className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-xs">{t("common.location")}</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Input value={warehouse} onChange={(e) => setWarehouse(e.target.value)} placeholder={t("common.warehouse")} className="h-8 text-xs" />
                  <Input value={shelf} onChange={(e) => setShelf(e.target.value)} placeholder={t("common.shelf")} className="h-8 text-xs" />
                  <Input value={bin} onChange={(e) => setBin(e.target.value)} placeholder={t("common.bin")} className="h-8 text-xs" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
                <Button size="sm" onClick={handleConfirmRounds}>{t("common.confirm")}</Button>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ============ Ammo Package Settings Dialog ============

function AmmoPackageDialog({ ammo, onClose }: {
  ammo: Ammunition | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const updateAmmoPackage = useStore((s) => s.updateAmmoPackage)

  const [packageType, setPackageType] = useState<PackageType>("Carton")
  const [unitsPerPackage, setUnitsPerPackage] = useState("50")

  // Reset form whenever a new ammo item is opened.
  const lastAmmoId = ammo?.id ?? null
  const [resetKey, setResetKey] = useState<string | null>(null)
  if (ammo && lastAmmoId !== resetKey) {
    setResetKey(lastAmmoId)
    setPackageType(ammo.packageType)
    setUnitsPerPackage(String(ammo.unitsPerPackage))
  }

  const handleConfirm = async () => {
    if (!ammo) return
    const units = Number(unitsPerPackage)
    if (!Number.isFinite(units) || units <= 0) {
      toast.error("Units per package must be greater than 0")
      return
    }
    const res = await updateAmmoPackage({
      itemId: ammo.id,
      packageType,
      unitsPerPackage: units,
    })
    if (res.success) {
      toast.success(t("toast.packageUpdated"))
      onClose()
    } else {
      toast.error(res.error ?? "Failed to update package settings")
    }
  }

  return (
    <Dialog open={ammo !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">{t("inv.packageSettings")} — {ammo?.caliber}</DialogTitle>
        </DialogHeader>
        {ammo && (
          <div className="grid gap-3">
            <div>
              <Label className="text-xs">{t("inv.packageType")}</Label>
              <Select value={packageType} onValueChange={(v) => setPackageType(v as PackageType)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PACKAGE_TYPES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("inv.unitsPerPackage")}</Label>
              <Input type="number" min={1} value={unitsPerPackage} onChange={(e) => setUnitsPerPackage(e.target.value)} className="h-8 text-xs" />
            </div>
            <p className="text-[10px] text-muted-foreground">
              {t("inv.packageNote")}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
              <Button size="sm" onClick={handleConfirm}>{t("common.confirm")}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ============ Add Accessory / Ammunition Forms ============

function AddAccessoryForm({ onAdd }: { onAdd: (name: string, type: string, qty: number, threshold: number, price: number) => void }) {
  const { t } = useI18n()
  const [name, setName] = useState("")
  const [type, setType] = useState(ACCESSORY_TYPES[0])
  const [qty, setQty] = useState("0")
  const [threshold, setThreshold] = useState("10")
  const [price, setPrice] = useState("0")
  return (
    <div className="grid gap-3">
      <div><Label className="text-xs">{t("inv.accName")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" /></div>
      <div><Label className="text-xs">{t("inv.accType")}</Label><Select value={type} onValueChange={setType}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{ACCESSORY_TYPES.map((atype) => <SelectItem key={atype} value={atype}>{atype}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid grid-cols-3 gap-2">
        <div><Label className="text-xs">{t("inv.qty")}</Label><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} className="h-8 text-xs" /></div>
        <div><Label className="text-xs">{t("inv.safetyThreshold")}</Label><Input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="h-8 text-xs" /></div>
        <div><Label className="text-xs">{t("common.price")}</Label><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="h-8 text-xs" /></div>
      </div>
      <Button size="sm" onClick={() => onAdd(name, type, Number(qty), Number(threshold), Number(price))}>{t("common.add")}</Button>
    </div>
  )
}

function AddAmmunitionForm({ onAdd }: { onAdd: (caliber: string, packageType: PackageType, unitsPerPackage: number, fullPackages: number, looseRounds: number, safetyThreshold: number, price: number) => void }) {
  const { t } = useI18n()
  const [caliber, setCaliber] = useState(AMMUNITION_CALIBERS[0])
  const [packageType, setPackageType] = useState<PackageType>("Carton")
  const [unitsPerPackage, setUnitsPerPackage] = useState("50")
  const [fullPackages, setFullPackages] = useState("0")
  const [looseRounds, setLooseRounds] = useState("0")
  const [safetyThreshold, setSafetyThreshold] = useState("200")
  const [price, setPrice] = useState("0.35")
  return (
    <div className="grid gap-3">
      <div><Label className="text-xs">{t("inv.caliber")}</Label><Select value={caliber} onValueChange={setCaliber}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{AMMUNITION_CALIBERS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
      <div><Label className="text-xs">{t("inv.packageType")}</Label><Select value={packageType} onValueChange={(v) => setPackageType(v as PackageType)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{PACKAGE_TYPES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs">{t("inv.unitsPerPackage")}</Label><Input type="number" min={1} value={unitsPerPackage} onChange={(e) => setUnitsPerPackage(e.target.value)} className="h-8 text-xs" /></div>
        <div><Label className="text-xs">{t("inv.fullPackages")}</Label><Input type="number" min={0} value={fullPackages} onChange={(e) => setFullPackages(e.target.value)} className="h-8 text-xs" /></div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div><Label className="text-xs">{t("inv.looseRounds")}</Label><Input type="number" min={0} value={looseRounds} onChange={(e) => setLooseRounds(e.target.value)} className="h-8 text-xs" /></div>
        <div><Label className="text-xs">{t("inv.safetyThreshold")}</Label><Input type="number" value={safetyThreshold} onChange={(e) => setSafetyThreshold(e.target.value)} className="h-8 text-xs" /></div>
        <div><Label className="text-xs">{t("common.price")}</Label><Input type="number" step="0.05" value={price} onChange={(e) => setPrice(e.target.value)} className="h-8 text-xs" /></div>
      </div>
      <Button size="sm" onClick={() => onAdd(caliber, packageType, Number(unitsPerPackage), Number(fullPackages), Number(looseRounds), Number(safetyThreshold), Number(price))}>{t("common.add")}</Button>
    </div>
  )
}
