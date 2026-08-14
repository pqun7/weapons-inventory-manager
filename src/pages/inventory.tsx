import {
  useMemo, useState, useCallback, useEffect, memo,
} from "react"
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  getPaginationRowModel, flexRender, type ColumnDef, type SortingState,
  type RowSelectionState, type ColumnResizeMode,
} from "@tanstack/react-table"
import {
  ArrowUpDown, ChevronLeft, ChevronRight, Plus, Search, Package, Boxes, Settings,
  X, SlidersHorizontal, Eye, Pencil,
  ChevronDown, List, Columns, Loader2,
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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { DatePicker } from "@/components/ui/date-picker"
import { useStore } from "@/lib/store"
import { useNav } from "@/lib/nav"
import { useDebounce } from "@/hooks"
import { useI18n } from "@/lib/i18n"
import { useCurrency } from "@/lib/currency-context"
import type { CurrencyInfo } from "@/lib/currency-service"
import { convertValuationToCurrency } from "@/lib/money-ui"
import { formatDateShort, statusRowClass, statusBadgeClass, statusDotClass } from "@/lib/format"
import type {
  Weapon, WeaponStatus, StorageLocation, Ammunition, PackageType, PricingMode, ProductAdditionalCostInput,
} from "@/lib/types"
import { ACCESSORY_TYPES, AMMUNITION_CALIBERS, ammoTotalRounds } from "@/lib/types"
import { BulkIntakeForm } from "@/components/bulk-intake-form"
import { ExcelToolbar } from "@/components/excel-toolbar"
import { WeaponDetailPanel } from "@/components/weapon-detail-panel"
import { areProductCostsValid } from "@/components/product-cost-editor"
import { pricingValuesAreValid } from "@/components/pricing-fields"
import { PricingSection } from "@/components/pricing-section"
import { CreatableProductTypeSelect } from "@/components/creatable-product-type-select"
import { calculateDraftFinalCostInCurrency } from "@/lib/product-cost"
import { CurrencyService } from "@/lib/currency-service"
import { SavedFiltersBar } from "@/components/ui/saved-filters-bar"
import { toast } from "sonner"
import { userFacingError } from "@/lib/user-facing-error"

// ----------------------------------------------------------------------
//  Types
// ----------------------------------------------------------------------

type AddStockTarget = {
  itemType: "accessory"
  itemId: string
  itemName: string
  currentCost: number
  currency: string
  location: StorageLocation
}

// ----------------------------------------------------------------------
//  Constants
// ----------------------------------------------------------------------

const STATUS_FILTERS: (WeaponStatus | "All")[] = [
  "All", "Available", "Reserved", "Sold", "Returned",
]

const PACKAGE_TYPES: PackageType[] = ["Carton", "Box", "Case", "Custom"]

// ----------------------------------------------------------------------
//  Helpers
// ----------------------------------------------------------------------

function distinctValuesFromWeapons(
  weapons: Weapon[],
  key: keyof Weapon | "warehouse" | "shelf" | "bin",
): string[] {
  const set = new Set<string>()
  weapons.forEach((w) => {
    let value: string | undefined
    if (key === "warehouse") value = w.location?.warehouse
    else if (key === "shelf") value = w.location?.shelf
    else if (key === "bin") value = w.location?.bin
    else value = w[key] as string | undefined
    if (value && value.trim() !== "") set.add(value.trim())
  })
  return Array.from(set).sort()
}

// ----------------------------------------------------------------------
//  Sub-components
// ----------------------------------------------------------------------

const RowActions = memo(function RowActions({
  onView, onEdit,
}: {
  onView: () => void
  onEdit: () => void
}) {
  const { t } = useI18n()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" className="h-7 w-7 p-0">
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={onView}>
          <Eye className="mr-2 size-3.5" /> {t("common.view")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="mr-2 size-3.5" /> {t("common.edit")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

function ActiveFilterChips({
  filters,
  onRemove,
  onClearAll,
}: {
  filters: Record<string, string | null>
  onRemove: (key: string) => void
  onClearAll: () => void
}) {
  const { t } = useI18n()
  const active = Object.entries(filters).filter(([, val]) => val !== null && val !== "" && val !== "search")
  if (active.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {active.map(([key, value]) => (
        <Badge key={key} variant="secondary" className="gap-1 pr-1 text-[11px]">
          <span className="capitalize">{key}</span>: {value}
          <Button
            variant="ghost"
            size="xs"
            className="ml-0.5 size-3 p-0 hover:bg-transparent"
            onClick={() => onRemove(key)}
          >
            <X className="size-2.5" />
          </Button>
        </Badge>
      ))}
      <Button variant="ghost" size="xs" className="h-5 text-[10px]" onClick={onClearAll}>
        {t("common.clearAll")}
      </Button>
    </div>
  )
}

// ----------------------------------------------------------------------
//  Main Page Component
// ----------------------------------------------------------------------

export function InventoryPage() {
  const { t } = useI18n()
  const weapons = useStore((s) => s.weapons)
  const accessories = useStore((s) => s.accessories)
  const ammunition = useStore((s) => s.ammunition)
  const shipments = useStore((s) => s.shipments)
  const { displayCurrency, transactionCurrency, formatValuation, formatAccountingAggregate } = useCurrency()
  const ready = useStore((s) => s.ready)
  const refreshFromDb = useStore((s) => s.refreshFromDb)
  const userPreferences = useStore((s) => s.userPreferences)
  const updateUserPreferences = useStore((s) => s.updateUserPreferences)
  const addAccessory = useStore((s) => s.addAccessory)
  const addAmmunition = useStore((s) => s.addAmmunition)
  const addStock = useStore((s) => s.addStock)
  const { setSelectedWeaponId, selectedWeaponId } = useNav()

  // Supabase is the source of truth. Refresh once when the store is ready so
  // this page never relies on stale renderer state after navigation.
  useEffect(() => {
    if (!ready) return
    void refreshFromDb()
  }, [ready, refreshFromDb])

  // --- State ----------------------------------------------------------------
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

  // Advanced filters
  const [weaponTypeFilter, setWeaponTypeFilter] = useState<string | null>(null)
  const [subTypeFilter, setSubTypeFilter] = useState<string | null>(null)
  const [brandFilter, setBrandFilter] = useState<string | null>(null)
  const [modelFilter, setModelFilter] = useState<string | null>(null)
  const [caliberFilter, setCaliberFilter] = useState<string | null>(null)
  const [conditionFilter, setConditionFilter] = useState<string | null>(null)
  const [warehouseFilter, setWarehouseFilter] = useState<string | null>(null)
  const [shelfFilter, setShelfFilter] = useState<string | null>(null)
  const [binFilter, setBinFilter] = useState<string | null>(null)
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null)
  const [priceMin, setPriceMin] = useState<string>("")
  const [priceMax, setPriceMax] = useState<string>("")
  const [dateFrom, setDateFrom] = useState<string>("")
  const [dateTo, setDateTo] = useState<string>("")
  const [showMoreFilters, setShowMoreFilters] = useState(false)

  // Table UI
  const [denseMode, setDenseMode] = useState(true)
  // ---- custom column visibility state (instead of columnVisibility) ----
  const allColumnKeys = [
    "select",
    "serialNumber",
    "brand",
    "model",
    "weaponType",
    "subType",
    "caliber",
    "condition",
    "status",
    "purchasePrice",
    "retailPrice",
    "wholesalePrice",
    "dateAdded",
    "actions",
  ] as const
  type ColumnKey = (typeof allColumnKeys)[number]

  // ---- استعادة الأعمدة المحفوظة من تفضيلات المستخدم ----
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(() => {
    const saved = userPreferences?.inventoryVisibleColumns
    if (saved && Array.isArray(saved) && saved.length > 0) {
      return new Set(saved as ColumnKey[])
    }
    return new Set(allColumnKeys)
  })

  const [columnsInitialized, setColumnsInitialized] = useState(false)

  // عند أول تحميل: إذا كانت التفضيلات غير موجودة أو الأعمدة المحفوظة فارغة،
  // نعتبر أن التهيئة تمت
  useEffect(() => {
    if (!columnsInitialized && userPreferences !== undefined) {
      const saved = userPreferences?.inventoryVisibleColumns
      if (saved && Array.isArray(saved) && saved.length > 0) {
        setVisibleColumns(new Set(saved as ColumnKey[]))
      }
      setColumnsInitialized(true)
    }
  }, [userPreferences, columnsInitialized])

  // ---- حفظ الأعمدة تلقائياً عند تغييرها ----
  useEffect(() => {
    if (!columnsInitialized) return // لا نحفظ قبل اكتمال التهيئة الأولية
    const columnsArray = Array.from(visibleColumns)
    // تجنب الحفظ إذا لم تتغير القيمة فعلياً
    const currentSaved = userPreferences?.inventoryVisibleColumns
    if (currentSaved &&
      Array.isArray(currentSaved) &&
      columnsArray.length === currentSaved.length &&
      columnsArray.every((col, i) => col === currentSaved[i])) {
      return
    }
    // حفظ عبر المتجر (يدعم IPC + DB تلقائياً)
    updateUserPreferences({ inventoryVisibleColumns: columnsArray })
  }, [visibleColumns, columnsInitialized, userPreferences?.inventoryVisibleColumns, updateUserPreferences])
  // --------------------------------------------------------------------------

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [columnResizeMode] = useState<ColumnResizeMode>("onChange")

  // Reset dependent filters
  useEffect(() => {
    setSubTypeFilter(null)
  }, [weaponTypeFilter])

  // --- Derived data ---------------------------------------------------------

  const pendingShipments = useMemo(
    () => shipments.filter((s) => s.status !== "Arrived"),
    [shipments],
  )

  const filterOptions = useMemo(() => {
    const subTypes = new Set<string>()
    for (const weapon of weapons) {
      if (weaponTypeFilter && weapon.weaponType !== weaponTypeFilter) continue
      const value = weapon.subType?.trim()
      if (value) subTypes.add(value)
    }

    return {
      weaponTypes: distinctValuesFromWeapons(weapons, "weaponType"),
      subTypes: Array.from(subTypes).sort(),
      brands: distinctValuesFromWeapons(weapons, "brand"),
      models: distinctValuesFromWeapons(weapons, "model"),
      calibers: distinctValuesFromWeapons(weapons, "caliber"),
      conditions: ["Excellent", "Good", "Fair", "Poor"],
      warehouses: distinctValuesFromWeapons(weapons, "warehouse"),
      shelves: distinctValuesFromWeapons(weapons, "shelf"),
      bins: distinctValuesFromWeapons(weapons, "bin"),
      suppliers: distinctValuesFromWeapons(weapons, "supplierId"),
    }
  }, [weapons, weaponTypeFilter])

  const filteredWeapons = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase()
    const min = Number.parseFloat(priceMin)
    const max = Number.parseFloat(priceMax)
    const from = dateFrom ? Date.parse(dateFrom) : Number.NaN
    const to = dateTo ? Date.parse(dateTo) + 86_399_999 : Number.NaN

    return weapons.filter((w) => {
      if (statusFilter !== "All" && w.status !== statusFilter) return false

      if (q) {
        const matchesSearch =
          w.serialNumber.toLowerCase().includes(q) ||
          w.brand.toLowerCase().includes(q) ||
          w.model.toLowerCase().includes(q) ||
          w.weaponType.toLowerCase().includes(q) ||
          w.caliber.toLowerCase().includes(q)
        if (!matchesSearch) return false
      }

      if (weaponTypeFilter && w.weaponType !== weaponTypeFilter) return false
      if (subTypeFilter && w.subType !== subTypeFilter) return false
      if (brandFilter && w.brand !== brandFilter) return false
      if (modelFilter && w.model !== modelFilter) return false
      if (caliberFilter && w.caliber !== caliberFilter) return false
      if (conditionFilter && w.condition !== conditionFilter) return false
      if (warehouseFilter && w.location?.warehouse !== warehouseFilter) return false
      if (shelfFilter && w.location?.shelf !== shelfFilter) return false
      if (binFilter && w.location?.bin !== binFilter) return false
      if (supplierFilter && w.supplierId !== supplierFilter) return false

      if (Number.isFinite(min) || Number.isFinite(max)) {
        const displayPrice = convertValuationToCurrency(w.purchasePriceValuation, displayCurrency, w.purchasePrice)
        if (displayPrice === null) return false
        if (Number.isFinite(min) && displayPrice < min) return false
        if (Number.isFinite(max) && displayPrice > max) return false
      }

      const addedAt = Date.parse(w.dateAdded)
      if (Number.isFinite(from) && (!Number.isFinite(addedAt) || addedAt < from)) return false
      if (Number.isFinite(to) && (!Number.isFinite(addedAt) || addedAt > to)) return false

      return true
    })
  }, [
    weapons, statusFilter, debouncedSearch, weaponTypeFilter, subTypeFilter,
    brandFilter, modelFilter, caliberFilter, conditionFilter, warehouseFilter,
    shelfFilter, binFilter, supplierFilter, priceMin, priceMax, dateFrom, dateTo, displayCurrency,
  ])


  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { All: weapons.length }
    weapons.forEach((w) => { counts[w.status] = (counts[w.status] ?? 0) + 1 })
    return counts
  }, [weapons])

  // --- Actions --------------------------------------------------------------

  const handleRowClick = useCallback((weaponId: string) => {
    setSelectedWeaponId(weaponId)
    setPanelOpen(true)
  }, [setSelectedWeaponId])

  const handleLoadFilter = useCallback((filter: { filterState: Record<string, unknown> }) => {
    const fs = filter.filterState
    if (typeof fs.statusFilter === "string") setStatusFilter(fs.statusFilter as WeaponStatus | "All")
    if (typeof fs.search === "string") setSearch(fs.search)
    if (typeof fs.activeTab === "string") setActiveTab(fs.activeTab)
  }, [])

  const clearAllFilters = () => {
    setStatusFilter("Available")
    setSearch("")
    setWeaponTypeFilter(null)
    setSubTypeFilter(null)
    setBrandFilter(null)
    setModelFilter(null)
    setCaliberFilter(null)
    setConditionFilter(null)
    setWarehouseFilter(null)
    setShelfFilter(null)
    setBinFilter(null)
    setSupplierFilter(null)
    setPriceMin("")
    setPriceMax("")
    setDateFrom("")
    setDateTo("")
  }

  // --- Table -----------------------------------------------------------------

  const columns: ColumnDef<Weapon>[] = useMemo(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label={t("common.selectAll")}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label={t("common.selectRow")}
            onClick={(e) => e.stopPropagation()}
          />
        ),
        enableSorting: false,
        size: 40,
      },
      {
        accessorKey: "serialNumber",
        header: t("weapon.serial"),
        cell: ({ row }) => (
          <span className="font-mono text-[11px] font-medium">{row.original.serialNumber}</span>
        ),
        size: 110,
      },
      {
        accessorKey: "brand",
        header: t("weapon.brand"),
        cell: ({ row }) => <span className="text-xs font-medium">{row.original.brand}</span>,
        size: 100,
      },
      {
        accessorKey: "model",
        header: t("weapon.model"),
        cell: ({ row }) => <span className="text-xs">{row.original.model}</span>,
        size: 120,
      },
      {
        accessorKey: "weaponType",
        header: t("common.type"),
        cell: ({ row }) => (
          <Badge variant="outline" className="text-[10px]">{row.original.weaponType}</Badge>
        ),
        size: 100,
      },
      {
        accessorKey: "subType",
        header: t("weapon.subType"),
        cell: ({ row }) => (
          <span className="text-[10px] text-muted-foreground">{row.original.subType || "-"}</span>
        ),
        size: 90,
      },
      {
        accessorKey: "caliber",
        header: t("inv.caliber"),
        cell: ({ row }) => (
          <span className="text-[11px] text-muted-foreground">{row.original.caliber}</span>
        ),
        size: 80,
      },
      {
        accessorKey: "condition",
        header: t("weapon.condition"),
        cell: ({ row }) => <span className="text-[11px]">{row.original.condition}</span>,
        size: 70,
      },
      {
        accessorKey: "status",
        header: t("common.status"),
        cell: ({ row }) => (
          <Badge className={`border text-[10px] ${statusBadgeClass(row.original.status)}`}>
            <span className={`me-1 size-1.5 rounded-full ${statusDotClass(row.original.status)}`} />
            {t(`status.${row.original.status}`)}
          </Badge>
        ),
        size: 100,
      },
      {
        accessorKey: "purchasePrice",
        header: t("weapon.cost"),
        cell: ({ row }) => (
          <span className="tabular-nums text-[11px] text-muted-foreground">
            {formatValuation(row.original.purchasePriceValuation, "display", row.original.purchasePrice)}
          </span>
        ),
        size: 80,
      },
      {
        accessorKey: "retailPrice",
        header: t("weapon.retail"),
        cell: ({ row }) => (
          <span className="tabular-nums text-[11px] font-medium">
            {formatValuation(row.original.retailPriceValuation, "display", row.original.retailPrice)}
          </span>
        ),
        size: 80,
      },
      {
        accessorKey: "wholesalePrice",
        header: t("weapon.wholesale"),
        cell: ({ row }) => (
          <span className="tabular-nums text-[11px] text-muted-foreground">
            {formatValuation(row.original.wholesalePriceValuation, "display", row.original.wholesalePrice)}
          </span>
        ),
        size: 80,
      },
      {
        accessorKey: "dateAdded",
        header: t("weapon.dateAdded"),
        cell: ({ row }) => (
          <span className="text-[10px] text-muted-foreground">
            {formatDateShort(row.original.dateAdded)}
          </span>
        ),
        size: 90,
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <RowActions
            onView={() => handleRowClick(row.original.id)}
            onEdit={() => {
              setSelectedWeaponId(row.original.id)
              setPanelOpen(true)
            }}
          />
        ),
        enableSorting: false,
        size: 50,
      },
    ],
    [formatValuation, t, handleRowClick, setSelectedWeaponId],
  )

  // ---- Filter columns based on visibility state ----
  const filteredColumns = useMemo(() => {
    return columns.filter((col) => {
      const key = (col.id || ('accessorKey' in col ? col.accessorKey : undefined)) as ColumnKey
      return visibleColumns.has(key)
    })
  }, [columns, visibleColumns])
  // -------------------------------------------------

  useEffect(() => {
    const visibleIds = new Set(filteredWeapons.map((weapon) => weapon.id))
    setRowSelection((previous) => {
      let changed = false
      const next: RowSelectionState = {}
      for (const [id, selected] of Object.entries(previous)) {
        if (selected && visibleIds.has(id)) next[id] = true
        else if (selected) changed = true
      }
      return changed ? next : previous
    })
  }, [filteredWeapons])

  const table = useReactTable({
    data: filteredWeapons,
    columns: filteredColumns, // use filtered columns
    state: {
      sorting,
      // columnVisibility removed
      rowSelection,
    },
    onSortingChange: setSorting,
    // onColumnVisibilityChange removed
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableColumnResizing: true,
    columnResizeMode,
    initialState: {
      pagination: { pageSize: 20 },
    },
  })

  const currentFilterState = useMemo(
    () => ({ statusFilter, search, activeTab }),
    [statusFilter, search, activeTab],
  )

  // ---- Helper to toggle column visibility ----
  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  // --------------------------------------------------------------------
  //  Render
  // --------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex flex-col gap-4">
          {/* Header */}
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                {t("inv.inventory")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("inv.inventoryDesc")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ExcelToolbar />
              <Dialog open={intakeOpen} onOpenChange={setIntakeOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="h-8">
                    <Plus className="size-3.5" /> {t("inv.addWeapon")}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-thin">
                  <DialogHeader>
                    <DialogTitle className="text-sm">{t("bulk.title")}</DialogTitle>
                  </DialogHeader>
                  <BulkIntakeForm onComplete={() => setIntakeOpen(false)} />
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Tabs */}
          <TabsList className="h-8">
            <TabsTrigger value="weapons" className="text-xs gap-1.5">
              <Package className="size-3.5" />
              {t("inv.weaponsTab")} ({weapons.length})
            </TabsTrigger>
            <TabsTrigger value="accessories" className="text-xs gap-1.5">
              <Boxes className="size-3.5" />
              {t("inv.accessoriesTab")} ({accessories.length})
            </TabsTrigger>
            <TabsTrigger value="ammunition" className="text-xs gap-1.5">
              <Boxes className="size-3.5" />
              {t("inv.ammunitionTab")} ({ammunition.length})
            </TabsTrigger>
          </TabsList>

          {/* Weapons tab content (unchanged from code 1) */}
          <TabsContent value="weapons" className="mt-0">
            <div className="flex flex-col gap-4">
              {/* Statistics Cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <Card className="py-2">
                  <CardContent className="px-3">
                    <div className="text-[11px] text-muted-foreground">{t("inv.total")}</div>
                    <div className="text-lg font-bold tabular-nums">{weapons.length}</div>
                  </CardContent>
                </Card>
                {(["Available", "Reserved", "Sold", "Returned"] as WeaponStatus[]).map((status) => (
                  <Card key={status} className="py-2">
                    <CardContent className="px-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`size-2 rounded-full ${statusDotClass(status)}`} />
                        <span className="text-[11px] text-muted-foreground">{t(`status.${status}`)}</span>
                      </div>
                      <div className="text-lg font-bold tabular-nums">
                        {statusCounts[status] ?? 0}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Search + Saved Filters */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder={t("inv.searchPlaceholder")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-8 pl-8 text-xs"
                  />
                </div>
                <SavedFiltersBar
                  entityType="inventory"
                  currentFilterState={currentFilterState}
                  onLoadFilter={handleLoadFilter}
                />
              </div>

              {/* Filter Bar */}
              <div className="flex flex-wrap items-center gap-2">
                {STATUS_FILTERS.map((status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${statusFilter === status
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-accent"
                      }`}
                  >
                    {status !== "All" && (
                      <span className={`size-1.5 rounded-full ${statusDotClass(status as WeaponStatus)}`} />
                    )}
                    {status === "All" ? t("common.all") : t(`status.${status}`)} ({statusCounts[status] ?? 0})
                  </button>
                ))}

                <div className="h-5 w-px bg-border" />

                <DropdownMenu open={showMoreFilters} onOpenChange={setShowMoreFilters}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
                      <SlidersHorizontal className="size-3" />
                      {t("inv.moreFilters")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-80 p-4" align="start">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-[11px]">{t("weapon.weaponType")}</Label>
                        <Select
                          value={weaponTypeFilter ?? "__all__"}
                          onValueChange={(v) => setWeaponTypeFilter(v === "__all__" ? null : v)}
                        >
                          <SelectTrigger className="h-7 text-[11px]">
                            <SelectValue placeholder={t("common.any")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">{t("common.allTypes")}</SelectItem>
                            {filterOptions.weaponTypes.map((weaponType) => (
                              <SelectItem key={weaponType} value={weaponType}>{weaponType}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[11px]">{t("weapon.subType")}</Label>
                        <Select
                          value={subTypeFilter ?? "__all__"}
                          onValueChange={(v) => setSubTypeFilter(v === "__all__" ? null : v)}
                          disabled={!weaponTypeFilter}
                        >
                          <SelectTrigger className="h-7 text-[11px]">
                            <SelectValue placeholder={t("common.any")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">{t("common.allSubTypes")}</SelectItem>
                            {filterOptions.subTypes.map((subType) => (
                              <SelectItem key={subType} value={subType}>{subType}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[11px]">{t("weapon.brand")}</Label>
                        <Select
                          value={brandFilter ?? "__all__"}
                          onValueChange={(v) => setBrandFilter(v === "__all__" ? null : v)}
                        >
                          <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder={t("common.any")} /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">{t("common.any")}</SelectItem>
                            {filterOptions.brands.map((b) => (
                              <SelectItem key={b} value={b}>{b}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[11px]">{t("weapon.model")}</Label>
                        <Select
                          value={modelFilter ?? "__all__"}
                          onValueChange={(v) => setModelFilter(v === "__all__" ? null : v)}
                        >
                          <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder={t("common.any")} /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">{t("common.any")}</SelectItem>
                            {filterOptions.models.map((m) => (
                              <SelectItem key={m} value={m}>{m}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[11px]">{t("inv.caliber")}</Label>
                        <Select
                          value={caliberFilter ?? "__all__"}
                          onValueChange={(v) => setCaliberFilter(v === "__all__" ? null : v)}
                        >
                          <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder={t("common.any")} /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">{t("common.any")}</SelectItem>
                            {filterOptions.calibers.map((c) => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[11px]">{t("weapon.condition")}</Label>
                        <Select
                          value={conditionFilter ?? "__all__"}
                          onValueChange={(v) => setConditionFilter(v === "__all__" ? null : v)}
                        >
                          <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder={t("common.any")} /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">{t("common.any")}</SelectItem>
                            {filterOptions.conditions.map((c) => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[11px]">{t("inv.warehouse")}</Label>
                        <Select
                          value={warehouseFilter ?? "__all__"}
                          onValueChange={(v) => setWarehouseFilter(v === "__all__" ? null : v)}
                        >
                          <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder={t("common.any")} /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">{t("common.any")}</SelectItem>
                            {filterOptions.warehouses.map((w) => (
                              <SelectItem key={w} value={w}>{w}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[11px]">{t("inv.shelf")}</Label>
                        <Select
                          value={shelfFilter ?? "__all__"}
                          onValueChange={(v) => setShelfFilter(v === "__all__" ? null : v)}
                        >
                          <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder={t("common.any")} /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">{t("common.any")}</SelectItem>
                            {filterOptions.shelves.map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[11px]">{t("inv.bin")}</Label>
                        <Select
                          value={binFilter ?? "__all__"}
                          onValueChange={(v) => setBinFilter(v === "__all__" ? null : v)}
                        >
                          <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder={t("common.any")} /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">{t("common.any")}</SelectItem>
                            {filterOptions.bins.map((b) => (
                              <SelectItem key={b} value={b}>{b}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[11px]">{t("inv.supplier")}</Label>
                        <Select
                          value={supplierFilter ?? "__all__"}
                          onValueChange={(v) => setSupplierFilter(v === "__all__" ? null : v)}
                        >
                          <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder={t("common.any")} /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">{t("common.any")}</SelectItem>
                            {filterOptions.suppliers.map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2">
                        <Label className="text-[11px]">{t("inv.priceRange")}</Label>
                        <div className="flex gap-2 mt-1">
                          <Input
                            type="number"
                            placeholder={t("common.min")}
                            value={priceMin}
                            onChange={(e) => setPriceMin(e.target.value)}
                            className="h-7 text-[11px]"
                          />
                          <Input
                            type="number"
                            placeholder={t("common.max")}
                            value={priceMax}
                            onChange={(e) => setPriceMax(e.target.value)}
                            className="h-7 text-[11px]"
                          />
                        </div>
                      </div>
                      <div className="col-span-2">
                        <Label className="text-[11px]">{t("inv.dateAdded")}</Label>
                        <div className="flex gap-2 mt-1">
                          <DatePicker value={dateFrom} onChange={setDateFrom} max={dateTo || undefined} className="h-7 text-[11px]" aria-label={`${t("inv.dateAdded")} — ${t("common.min")}`} />
                          <DatePicker value={dateTo} onChange={setDateTo} min={dateFrom || undefined} className="h-7 text-[11px]" aria-label={`${t("inv.dateAdded")} — ${t("common.max")}`} />
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowMoreFilters(false)}
                        className="text-xs"
                      >
                        {t("common.done")}
                      </Button>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearAllFilters}>
                  <X className="mr-1 size-3" /> {t("common.clear")}
                </Button>
              </div>

              {/* Active Filters Chips */}
              <ActiveFilterChips
                filters={{
                  status: statusFilter !== "All" ? statusFilter : null,
                  type: weaponTypeFilter,
                  subtype: subTypeFilter,
                  brand: brandFilter,
                  model: modelFilter,
                  caliber: caliberFilter,
                  condition: conditionFilter,
                  warehouse: warehouseFilter,
                  shelf: shelfFilter,
                  bin: binFilter,
                  supplier: supplierFilter,
                  price: (priceMin || priceMax) ? `${priceMin || "0"} – ${priceMax || "∞"}` : null,
                  date: (dateFrom || dateTo) ? `${dateFrom || "any"} → ${dateTo || "any"}` : null,
                }}
                onRemove={(key) => {
                  switch (key) {
                    case "status": setStatusFilter("Available"); break
                    case "type": setWeaponTypeFilter(null); break
                    case "subtype": setSubTypeFilter(null); break
                    case "brand": setBrandFilter(null); break
                    case "model": setModelFilter(null); break
                    case "caliber": setCaliberFilter(null); break
                    case "condition": setConditionFilter(null); break
                    case "warehouse": setWarehouseFilter(null); break
                    case "shelf": setShelfFilter(null); break
                    case "bin": setBinFilter(null); break
                    case "supplier": setSupplierFilter(null); break
                    case "price": setPriceMin(""); setPriceMax(""); break
                    case "date": setDateFrom(""); setDateTo(""); break
                  }
                }}
                onClearAll={clearAllFilters}
              />

              {/* Table controls */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="xs" className="h-7 gap-1 text-[11px]">
                        <Columns className="size-3" /> {t("inv.columns")}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {allColumnKeys.map((key) => (
                        <DropdownMenuCheckboxItem
                          key={key}
                          checked={visibleColumns.has(key)}
                          onCheckedChange={() => toggleColumn(key)}
                        >
                          {key === "select" ? t("common.select") :
                            key === "actions" ? t("common.actions") :
                              key === "serialNumber" ? t("weapon.serial") :
                                key === "brand" ? t("weapon.brand") :
                                  key === "model" ? t("weapon.model") :
                                    key === "weaponType" ? t("common.type") :
                                      key === "subType" ? t("weapon.subType") :
                                        key === "caliber" ? t("inv.caliber") :
                                          key === "condition" ? t("weapon.condition") :
                                            key === "status" ? t("common.status") :
                                              key === "purchasePrice" ? t("weapon.cost") :
                                                key === "retailPrice" ? t("weapon.retail") :
                                                  key === "wholesalePrice" ? t("weapon.wholesale") :
                                                    key === "dateAdded" ? t("weapon.dateAdded") :
                                                      key}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-7 text-[11px]"
                    onClick={() => setDenseMode(!denseMode)}
                  >
                    {denseMode ? <List className="size-3 mr-1" /> : <Columns className="size-3 mr-1" />}
                    {denseMode ? t("inv.comfortable") : t("inv.dense")}
                  </Button>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {t("inv.selectedCount", { count: Object.keys(rowSelection).length })}
                </span>
              </div>

              {/* Table */}
              <div className="overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    {table.getHeaderGroups().map((hg) => (
                      <TableRow key={hg.id} className="bg-muted/50">
                        {hg.headers.map((header) => (
                          <TableHead
                            key={header.id}
                            className="h-8 px-2 relative"
                            style={{ width: header.getSize() }}
                          >
                            {header.isPlaceholder ? null : (
                              <div className="flex items-center gap-1">
                                {header.column.getCanSort() ? (
                                  <button
                                    className="inline-flex items-center gap-1 text-[10px] font-medium"
                                    onClick={header.column.getToggleSortingHandler()}
                                  >
                                    {flexRender(header.column.columnDef.header, header.getContext())}
                                    <ArrowUpDown className="size-2.5 opacity-50" />
                                  </button>
                                ) : (
                                  <div className="inline-flex items-center gap-1 text-[10px] font-medium">
                                    {flexRender(header.column.columnDef.header, header.getContext())}
                                  </div>
                                )}
                                {header.column.getCanResize() && (
                                  <div
                                    onMouseDown={header.getResizeHandler()}
                                    onTouchStart={header.getResizeHandler()}
                                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none bg-border opacity-0 hover:opacity-100"
                                  />
                                )}
                              </div>
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
                          className={`${statusRowClass(row.original.status)} cursor-pointer border-b hover:bg-accent/50`}
                          onClick={() => handleRowClick(row.original.id)}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRowClick(row.original.id)
                          }}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <TableCell
                              key={cell.id}
                              className={`py-1.5 ${denseMode ? "py-1" : "py-2"}`}
                              style={{ width: cell.column.getSize() }}
                              onClick={
                                cell.column.id === "select" || cell.column.id === "actions"
                                  ? (e) => e.stopPropagation()
                                  : undefined
                              }
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={filteredColumns.length} className="h-24 text-center text-muted-foreground">
                          <div className="flex flex-col items-center gap-1">
                            <Package className="size-8" />
                            <span className="text-xs">{t("inv.noWeaponsFound")}</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] text-muted-foreground">
                  {t("inv.showingCount", { shown: table.getRowModel().rows.length, total: filteredWeapons.length })}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                  >
                    <ChevronLeft className="size-3" /> {t("common.prev")}
                  </Button>
                  <span className="text-[10px] text-muted-foreground">
                    {table.getState().pagination.pageIndex + 1} / {table.getPageCount() || 1}
                  </span>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                  >
                    {t("common.next")} <ChevronRight className="size-3" />
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Accessories tab (inlined from code 2, slightly complex and unorganised) */}
          <TabsContent value="accessories" className="mt-0">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{accessories.length} {t("inv.accessoryItems")}</span>
                <Dialog open={addAccOpen} onOpenChange={setAddAccOpen}>
                  <DialogTrigger asChild><Button size="sm" className="h-8"><Plus className="size-3.5" /> {t("inv.addAccessory")}</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle className="text-sm">{t("inv.addAccessory")}</DialogTitle></DialogHeader>
                    <AddAccessoryForm onAdd={async (name, type, qty, threshold, price, currency, retailPrice, wholesalePrice, retailPriceMode, wholesalePriceMode, additionalCostInputs) => {
                      const res = await addAccessory({ name, type, quantity: qty, safetyThreshold: threshold, price, priceCurrency: currency, retailPrice, wholesalePrice, retailPriceMode, wholesalePriceMode, location: { warehouse: "Main", shelf: "", bin: "" }, additionalCostInputs })
                      if (res.success) { toast.success(t("toast.accessoryAdded")); setAddAccOpen(false) }
                      else toast.error(t("toast.accessoryAddFailed"))
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
                          <span className="text-[10px] text-muted-foreground">{formatValuation(a.priceValuation, "display", a.price, a.priceCurrency)} {t("inv.each")}</span>
                          {a.costSnapshot && <span className="text-[9px] text-primary">{t("cost.finalLandedCost")}: {formatAccountingAggregate(Number(a.costSnapshot.finalLandedBaseAmount), "accounting")}</span>}
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => setStockTarget({
                              itemType: "accessory", itemId: a.id, itemName: a.name,
                              currentCost: a.costSnapshot
                                ? CurrencyService.convertFromAccounting(Number(a.costSnapshot.finalLandedBaseAmount), a.priceCurrency ?? transactionCurrency)
                                : a.price,
                              currency: a.priceCurrency ?? transactionCurrency,
                              location: a.location,
                            })}
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

          {/* Ammunition tab (inlined from code 2, slightly complex and unorganised) */}
          <TabsContent value="ammunition" className="mt-0">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{ammunition.length} {t("inv.ammoTypes")}</span>
                <Dialog open={addAmmOpen} onOpenChange={setAddAmmOpen}>
                  <DialogTrigger asChild><Button size="sm" className="h-8"><Plus className="size-3.5" /> {t("inv.addAmmunition")}</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle className="text-sm">{t("inv.addAmmunition")}</DialogTitle></DialogHeader>
                    <AddAmmunitionForm onAdd={async (caliber, packageType, unitsPerPackage, fullPackages, looseRounds, safetyThreshold, price, currency, retailPrice, wholesalePrice, retailPriceMode, wholesalePriceMode, additionalCostInputs) => {
                      const res = await addAmmunition({ caliber, packageType, unitsPerPackage, fullPackages, looseRounds, safetyThreshold, price, priceCurrency: currency, retailPrice, wholesalePrice, retailPriceMode, wholesalePriceMode, location: { warehouse: "Main", shelf: "", bin: "" }, additionalCostInputs })
                      if (res.success) { toast.success(t("toast.ammunitionAdded")); setAddAmmOpen(false) }
                      else toast.error(t("toast.ammunitionAddFailed"))
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
                            <span className="text-[10px] text-muted-foreground">{a.packageType} — {a.unitsPerPackage} {t("inv.rdsPkg")}</span>
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
                              ? `${a.fullPackages} ${t("inv.pkg")} + ${a.looseRounds} (${totalRounds} ${t("inv.total")})`
                              : `${a.fullPackages} ${t("inv.pkg")} (${totalRounds} ${t("inv.total")})`}
                          </span>
                        </div>
                        <Progress value={pct} className={`mt-1.5 h-1.5 ${low ? "[&>div]:bg-status-sold" : ""}`} />
                        <div className="mt-1.5 flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground">{formatValuation(a.priceValuation, "display", a.price, a.priceCurrency)}/{t("inv.rd")}</span>
                          {a.costSnapshot && <span className="text-[9px] text-primary">{t("cost.finalLandedCost")}: {formatAccountingAggregate(Number(a.costSnapshot.finalLandedBaseAmount), "accounting")}</span>}
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
        </div>
      </Tabs>

      {/* Dialogs */}
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
            console.error("Stock receipt failed", res.error)
            toast.error(userFacingError(res.error, t("toast.stockAddFailed")))
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

// ============== Dialog & Form Components ==============

function AddStockDialog({ target, shipments, onClose, onConfirm }: {
  target: AddStockTarget | null
  shipments: { id: string; shipmentNumber: string; status: string }[]
  onClose: () => void
  onConfirm: (payload: {
    itemType: "accessory"
    itemId: string
    quantity: number
    purchasePrice: number
    currency: string
    shipmentId: string | null
    notes: string
    location?: StorageLocation
  }) => Promise<void>
}) {
  const { t } = useI18n()
  const { currencies, transactionCurrency, currencyPresentation } = useCurrency()
  const [quantity, setQuantity] = useState("0")
  const [purchasePrice, setPurchasePrice] = useState("0")
  const [currency, setCurrency] = useState(transactionCurrency)
  const [shipmentId, setShipmentId] = useState<string | null>(null)
  const [notes, setNotes] = useState("")
  const [warehouse, setWarehouse] = useState("Main")
  const [shelf, setShelf] = useState("")
  const [bin, setBin] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  // const lastTargetId = target?.itemId ?? null
  const [resetKey, setResetKey] = useState<string | null>(null)

  useEffect(() => {
    if (!target || target.itemId === resetKey) return
    setResetKey(target.itemId)
    setQuantity("0")
    setPurchasePrice(String(target.currentCost))
    setCurrency(target.currency)
    setShipmentId(null)
    setNotes("")
    setWarehouse(target.location.warehouse || "Main")
    setShelf(target.location.shelf)
    setBin(target.location.bin)
  }, [target, resetKey, transactionCurrency])

  const handleConfirm = async () => {
    if (!target || isSubmitting) return
    const qty = Number(quantity)
    const price = Number(purchasePrice)
    if (!Number.isFinite(qty) || qty <= 0) { toast.error(t("inv.quantityMustBePositive")); return }
    if (!Number.isFinite(price) || price < 0) { toast.error(t("inv.priceMustBePositive")); return }
    setIsSubmitting(true)
    try {
      await onConfirm({
        itemType: target.itemType,
        itemId: target.itemId,
        quantity: qty,
        purchasePrice: price,
        currency,
        shipmentId,
        notes,
        location: { warehouse, shelf, bin },
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open && !isSubmitting) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-sm">{t("inv.addStock")}</DialogTitle></DialogHeader>
        {target && (
          <div className="grid gap-3">
            <div><Label className="text-xs">{t("inv.item")}</Label><Input value={target.itemName} readOnly className="h-8 bg-muted/50 text-xs" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">{t("inv.quantity")}</Label><Input type="number" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-8 text-xs" /></div>
              <div><Label className="text-xs">{t("weapon.cost")} ({currencyPresentation(currency).compactSymbol})</Label><Input type="number" min={0} step="any" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} className="h-8 text-xs" /></div>
            </div>
            <CurrencySelect value={currency} onChange={setCurrency} currencies={currencies} />
            <div><Label className="text-xs">{t("inv.shipment")}</Label>
              <Select value={shipmentId ?? "__none__"} onValueChange={(v) => setShipmentId(v === "__none__" ? null : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("common.none")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("inv.noShipment")}</SelectItem>
                  {shipments.map((s) => <SelectItem key={s.id} value={s.id}>{s.shipmentNumber} ({s.status})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">{t("common.notes")}</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-8 text-xs" /></div>
            <div><Label className="text-xs">{t("inv.location")}</Label>
              <div className="grid grid-cols-3 gap-2">
                <Input value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="h-8 text-xs" placeholder={t("inv.warehouse")} />
                <Input value={shelf} onChange={(e) => setShelf(e.target.value)} className="h-8 text-xs" placeholder={t("inv.shelf")} />
                <Input value={bin} onChange={(e) => setBin(e.target.value)} className="h-8 text-xs" placeholder={t("inv.bin")} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={onClose} disabled={isSubmitting}>{t("common.cancel")}</Button>
              <Button size="sm" onClick={() => void handleConfirm()} disabled={isSubmitting}>{isSubmitting && <Loader2 className="size-3.5 animate-spin" />}{t("common.confirm")}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function AmmoReceiveDialog({ ammo, shipments, onClose }: {
  ammo: Ammunition | null
  shipments: { id: string; shipmentNumber: string; status: string }[]
  onClose: () => void
}) {
  const { t } = useI18n()
  const { currencies, transactionCurrency, currencyPresentation } = useCurrency()
  const receiveAmmoByPackages = useStore((s) => s.receiveAmmoByPackages)
  const receiveAmmoByRounds = useStore((s) => s.receiveAmmoByRounds)

  const [receiveTab, setReceiveTab] = useState("packages")
  const [numberOfPackages, setNumberOfPackages] = useState("0")
  const [unitsPerPackage, setUnitsPerPackage] = useState("50")
  const [totalRoundsInput, setTotalRoundsInput] = useState("0")
  const [purchasePrice, setPurchasePrice] = useState("0")
  const [currency, setCurrency] = useState(transactionCurrency)
  const [shipmentId, setShipmentId] = useState<string | null>(null)
  const [notes, setNotes] = useState("")
  const [warehouse, setWarehouse] = useState("Main")
  const [shelf, setShelf] = useState("")
  const [bin, setBin] = useState("")
  const [submitting, setSubmitting] = useState<"packages" | "rounds" | null>(null)

  // const lastAmmoId = ammo?.id ?? null
  const [resetKey, setResetKey] = useState<string | null>(null)

  useEffect(() => {
    if (!ammo || ammo.id === resetKey) return
    setResetKey(ammo.id)
    setReceiveTab("packages")
    setNumberOfPackages("0")
    setUnitsPerPackage(String(ammo.unitsPerPackage))
    setTotalRoundsInput("0")
    const costCurrency = ammo.priceCurrency ?? transactionCurrency
    const currentCost = ammo.costSnapshot
      ? CurrencyService.convertFromAccounting(Number(ammo.costSnapshot.finalLandedBaseAmount), costCurrency)
      : ammo.price
    setPurchasePrice(String(currentCost))
    setCurrency(costCurrency)
    setShipmentId(null)
    setNotes("")
    setWarehouse(ammo.location.warehouse || "Main")
    setShelf(ammo.location.shelf)
    setBin(ammo.location.bin)
  }, [ammo, resetKey, transactionCurrency])

  const computedTotal = (Number(numberOfPackages) || 0) * (Number(unitsPerPackage) || 0)

  const handleConfirmPackages = async () => {
    if (!ammo || submitting) return
    const pkgs = Number(numberOfPackages)
    const units = Number(unitsPerPackage)
    const price = Number(purchasePrice)
    if (!Number.isFinite(pkgs) || pkgs <= 0) { toast.error(t("inv.packagesMustBePositive")); return }
    if (!Number.isFinite(units) || units <= 0) { toast.error(t("inv.unitsPerPkgMustBePositive")); return }
    if (!Number.isFinite(price) || price <= 0) { toast.error(t("inv.priceMustBePositive")); return }
    setSubmitting("packages")
    try {
      const res = await receiveAmmoByPackages({
        itemId: ammo.id, numberOfPackages: pkgs, unitsPerPackage: units,
        purchasePrice: price, currency, shipmentId, notes, location: { warehouse, shelf, bin },
      })
      if (res.success) { toast.success(t("toast.ammoReceivedPackages")); onClose() }
      else { console.error("Ammunition receipt failed", res.error); toast.error(userFacingError(res.error, t("toast.ammoReceiveFailed"))) }
    } finally {
      setSubmitting(null)
    }
  }

  const handleConfirmRounds = async () => {
    if (!ammo || submitting) return
    const rounds = Number(totalRoundsInput)
    const price = Number(purchasePrice)
    if (!Number.isFinite(rounds) || rounds <= 0) { toast.error(t("inv.roundsMustBePositive")); return }
    if (!Number.isFinite(price) || price <= 0) { toast.error(t("inv.priceMustBePositive")); return }
    setSubmitting("rounds")
    try {
      const res = await receiveAmmoByRounds({
        itemId: ammo.id, totalRounds: rounds, purchasePrice: price, currency,
        shipmentId, notes, location: { warehouse, shelf, bin },
      })
      if (res.success) { toast.success(t("toast.ammoReceivedRounds")); onClose() }
      else { console.error("Ammunition receipt failed", res.error); toast.error(userFacingError(res.error, t("toast.ammoReceiveFailed"))) }
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <Dialog open={ammo !== null} onOpenChange={(open) => { if (!open && !submitting) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-sm">{t("inv.addStock")} — {ammo?.caliber}</DialogTitle></DialogHeader>
        {ammo && (
          <Tabs value={receiveTab} onValueChange={setReceiveTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="packages" className="text-xs">{t("inv.byPackages")}</TabsTrigger>
              <TabsTrigger value="rounds" className="text-xs">{t("inv.byRounds")}</TabsTrigger>
            </TabsList>

            <TabsContent value="packages" className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">{t("inv.packages")}</Label><Input type="number" min={0} value={numberOfPackages} onChange={(e) => setNumberOfPackages(e.target.value)} className="h-8 text-xs" /></div>
                <div><Label className="text-xs">{t("inv.unitsPerPkg")}</Label><Input type="number" min={1} value={unitsPerPackage} onChange={(e) => setUnitsPerPackage(e.target.value)} className="h-8 text-xs" /></div>
              </div>
              <div className="rounded-md bg-muted/50 px-3 py-2 text-xs">{t("inv.total")}: <span className="font-bold">{computedTotal}</span> {t("inv.rounds")}</div>
              <div><Label className="text-xs">{t("weapon.cost")} ({currencyPresentation(currency).compactSymbol})</Label><Input type="number" min={0} step="any" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} className="h-8 text-xs" /></div>
              <CurrencySelect value={currency} onChange={setCurrency} currencies={currencies} />
              <div><Label className="text-xs">{t("inv.shipment")}</Label>
                <Select value={shipmentId ?? "__none__"} onValueChange={(v) => setShipmentId(v === "__none__" ? null : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("common.none")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("inv.noShipment")}</SelectItem>
                    {shipments.map((s) => <SelectItem key={s.id} value={s.id}>{s.shipmentNumber} ({s.status})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">{t("common.notes")}</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-8 text-xs" /></div>
              <div><Label className="text-xs">{t("inv.location")}</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Input value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="h-8 text-xs" placeholder={t("inv.warehouse")} />
                  <Input value={shelf} onChange={(e) => setShelf(e.target.value)} className="h-8 text-xs" placeholder={t("inv.shelf")} />
                  <Input value={bin} onChange={(e) => setBin(e.target.value)} className="h-8 text-xs" placeholder={t("inv.bin")} />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={onClose} disabled={Boolean(submitting)}>{t("common.cancel")}</Button>
                <Button size="sm" onClick={() => void handleConfirmPackages()} disabled={Boolean(submitting)}>{submitting === "packages" && <Loader2 className="size-3.5 animate-spin" />}{t("common.confirm")}</Button>
              </div>
            </TabsContent>

            <TabsContent value="rounds" className="grid gap-3">
              <div><Label className="text-xs">{t("inv.totalRounds")}</Label><Input type="number" min={0} value={totalRoundsInput} onChange={(e) => setTotalRoundsInput(e.target.value)} className="h-8 text-xs" /></div>
              <div><Label className="text-xs">{t("weapon.cost")} ({currencyPresentation(currency).compactSymbol})</Label><Input type="number" min={0} step="any" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} className="h-8 text-xs" /></div>
              <CurrencySelect value={currency} onChange={setCurrency} currencies={currencies} />
              <div><Label className="text-xs">{t("inv.shipment")}</Label>
                <Select value={shipmentId ?? "__none__"} onValueChange={(v) => setShipmentId(v === "__none__" ? null : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("common.none")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("inv.noShipment")}</SelectItem>
                    {shipments.map((s) => <SelectItem key={s.id} value={s.id}>{s.shipmentNumber} ({s.status})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">{t("common.notes")}</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-8 text-xs" /></div>
              <div><Label className="text-xs">{t("inv.location")}</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Input value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="h-8 text-xs" placeholder={t("inv.warehouse")} />
                  <Input value={shelf} onChange={(e) => setShelf(e.target.value)} className="h-8 text-xs" placeholder={t("inv.shelf")} />
                  <Input value={bin} onChange={(e) => setBin(e.target.value)} className="h-8 text-xs" placeholder={t("inv.bin")} />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={onClose} disabled={Boolean(submitting)}>{t("common.cancel")}</Button>
                <Button size="sm" onClick={() => void handleConfirmRounds()} disabled={Boolean(submitting)}>{submitting === "rounds" && <Loader2 className="size-3.5 animate-spin" />}{t("common.confirm")}</Button>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

function AmmoPackageDialog({ ammo, onClose }: { ammo: Ammunition | null; onClose: () => void }) {
  const { t } = useI18n()
  const updateAmmoPackage = useStore((s) => s.updateAmmoPackage)

  const [packageType, setPackageType] = useState<PackageType>("Carton")
  const [unitsPerPackage, setUnitsPerPackage] = useState("50")
  const [isSubmitting, setIsSubmitting] = useState(false)

  // const lastAmmoId = ammo?.id ?? null
  const [resetKey, setResetKey] = useState<string | null>(null)

  useEffect(() => {
    if (!ammo || ammo.id === resetKey) return
    setResetKey(ammo.id)
    setPackageType(ammo.packageType)
    setUnitsPerPackage(String(ammo.unitsPerPackage))
  }, [ammo, resetKey])

  const handleConfirm = async () => {
    if (!ammo || isSubmitting) return
    const units = Number(unitsPerPackage)
    if (!Number.isFinite(units) || units <= 0) { toast.error(t("inv.unitsPerPkgMustBePositive")); return }
    setIsSubmitting(true)
    try {
      const res = await updateAmmoPackage({ itemId: ammo.id, packageType, unitsPerPackage: units })
      if (res.success) { toast.success(t("toast.packageUpdated")); onClose() }
      else toast.error(res.error ?? t("toast.packageUpdateFailed"))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={ammo !== null} onOpenChange={(open) => { if (!open && !isSubmitting) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-sm">{t("inv.packageSettings")} — {ammo?.caliber}</DialogTitle></DialogHeader>
        {ammo && (
          <div className="grid gap-3">
            <div><Label className="text-xs">{t("inv.packageType")}</Label>
              <Select value={packageType} onValueChange={(v) => setPackageType(v as PackageType)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{PACKAGE_TYPES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">{t("inv.unitsPerPkg")}</Label><Input type="number" min={1} value={unitsPerPackage} onChange={(e) => setUnitsPerPackage(e.target.value)} className="h-8 text-xs" /></div>
            <p className="text-[10px] text-muted-foreground">{t("inv.packageChangeNote")}</p>
            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={onClose} disabled={isSubmitting}>{t("common.cancel")}</Button>
              <Button size="sm" onClick={() => void handleConfirm()} disabled={isSubmitting}>{isSubmitting && <Loader2 className="size-3.5 animate-spin" />}{t("common.confirm")}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CurrencySelect({ value, onChange, currencies }: { value: string; onChange: (value: string) => void; currencies: CurrencyInfo[] }) {
  const { t } = useI18n()
  const { currencyPresentation } = useCurrency()
  return (
    <div>
      <Label className="text-xs">{t("settings.currency")}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {currencies.map((currency) => (
            <SelectItem key={currency.isoCode} value={currency.isoCode}>{currency.isoCode} — {currencyPresentation(currency.isoCode).name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function AddAccessoryForm({ onAdd }: { onAdd: (name: string, type: string, qty: number, threshold: number, price: number, currency: string, retailPrice: number, wholesalePrice: number, retailMode: PricingMode, wholesaleMode: PricingMode, costs: ProductAdditionalCostInput[]) => Promise<void> }) {
  const { t } = useI18n()
  const { transactionCurrency, currencyPresentation } = useCurrency()
  const [name, setName] = useState("")
  const [type, setType] = useState(ACCESSORY_TYPES[0])
  const [qty, setQty] = useState("0")
  const [threshold, setThreshold] = useState("10")
  const [price, setPrice] = useState("0")
  const [currency, setCurrency] = useState(transactionCurrency)
  const [costs, setCosts] = useState<ProductAdditionalCostInput[]>([])
  const [retail, setRetail] = useState({ value: "", mode: "auto" as PricingMode })
  const [wholesale, setWholesale] = useState({ value: "", mode: "auto" as PricingMode })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const settings = useStore((state) => state.settings)
  const finalCost = useMemo(() => {
    try {
      return Number(calculateDraftFinalCostInCurrency(price, currency, costs, (amount, from, to) => CurrencyService.convert(amount, from, to)))
    } catch { return Number(price) || 0 }
  }, [costs, currency, price])
  return (
    <div className="grid gap-3">
      <div><Label className="text-xs">{t("inv.accName")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" /></div>
      <div><Label className="text-xs">{t("inv.accType")}</Label><CreatableProductTypeSelect category="accessory" value={type} onValueChange={setType} defaults={ACCESSORY_TYPES} /></div>
      <div className="grid grid-cols-3 gap-2">
        <div><Label className="text-xs">{t("inv.quantity")}</Label><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} className="h-8 text-xs" /></div>
        <div><Label className="text-xs">{t("inv.min")}</Label><Input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="h-8 text-xs" /></div>
        <div><Label className="text-xs">{t("weapon.cost")} ({currencyPresentation(currency).compactSymbol})</Label><Input type="number" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} className="h-8 text-xs" /></div>
      </div>
      <PricingSection purchasePrice={price} onPurchasePriceChange={setPrice} currency={currency} onCurrencyChange={setCurrency} quantity={Math.max(1, Number(qty) || 1)} onQuantityChange={(value) => setQty(String(value))} additionalCosts={costs} onAdditionalCostsChange={setCosts} finalCost={finalCost} retailPrice={retail.value} retailPriceMode={retail.mode} onRetailChange={setRetail} wholesalePrice={wholesale.value} wholesalePriceMode={wholesale.mode} onWholesaleChange={setWholesale} />
      <Button
        size="sm"
        disabled={isSubmitting}
        onClick={async () => {
          if (isSubmitting) return
          const quantity = Number(qty)
          const min = Number(threshold)
          const unitPrice = Number(price)
          if (!name.trim()) return toast.error(t("inv.accName"))
          if (!Number.isFinite(quantity) || quantity < 0) return toast.error(t("inv.quantityMustBePositive"))
          if (!Number.isFinite(min) || min < 0) return toast.error(t("inv.quantityMustBePositive"))
          if (!Number.isFinite(unitPrice) || unitPrice < 0) return toast.error(t("inv.priceMustBePositive"))
          if (!areProductCostsValid(costs)) return toast.error(t("cost.checkAmount"))
          if (!pricingValuesAreValid(finalCost, retail.value, wholesale.value, settings.minProfitMarginPercent)) return toast.error(t("pricing.invalidPrice"))
          setIsSubmitting(true)
          try {
            await onAdd(name.trim(), type, quantity, min, unitPrice, currency, Number(retail.value), Number(wholesale.value), retail.mode, wholesale.mode, costs)
          } finally {
            setIsSubmitting(false)
          }
        }}
      >
        {isSubmitting && <Loader2 className="size-3.5 animate-spin" />}
        {t("common.add")}
      </Button>
    </div>
  )
}

function AddAmmunitionForm({ onAdd }: { onAdd: (caliber: string, packageType: PackageType, unitsPerPackage: number, fullPackages: number, looseRounds: number, safetyThreshold: number, price: number, currency: string, retailPrice: number, wholesalePrice: number, retailMode: PricingMode, wholesaleMode: PricingMode, costs: ProductAdditionalCostInput[]) => Promise<void> }) {
  const { t } = useI18n()
  const { transactionCurrency, currencyPresentation } = useCurrency()
  const [caliber, setCaliber] = useState(AMMUNITION_CALIBERS[0])
  const [packageType, setPackageType] = useState<PackageType>("Carton")
  const [unitsPerPackage, setUnitsPerPackage] = useState("50")
  const [fullPackages, setFullPackages] = useState("0")
  const [looseRounds, setLooseRounds] = useState("0")
  const [safetyThreshold, setSafetyThreshold] = useState("200")
  const [price, setPrice] = useState("0.35")
  const [currency, setCurrency] = useState(transactionCurrency)
  const [costs, setCosts] = useState<ProductAdditionalCostInput[]>([])
  const [retail, setRetail] = useState({ value: "", mode: "auto" as PricingMode })
  const [wholesale, setWholesale] = useState({ value: "", mode: "auto" as PricingMode })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const settings = useStore((state) => state.settings)
  const finalCost = useMemo(() => {
    try {
      return Number(calculateDraftFinalCostInCurrency(price, currency, costs, (amount, from, to) => CurrencyService.convert(amount, from, to)))
    } catch { return Number(price) || 0 }
  }, [costs, currency, price])
  return (
    <div className="grid gap-3">
      <div><Label className="text-xs">{t("inv.caliber")}</Label><CreatableProductTypeSelect category="ammunition" value={caliber} onValueChange={setCaliber} defaults={AMMUNITION_CALIBERS} /></div>
      <div><Label className="text-xs">{t("inv.packageType")}</Label><Select value={packageType} onValueChange={(v) => setPackageType(v as PackageType)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{PACKAGE_TYPES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs">{t("inv.unitsPerPkg")}</Label><Input type="number" min={1} value={unitsPerPackage} onChange={(e) => setUnitsPerPackage(e.target.value)} className="h-8 text-xs" /></div>
        <div><Label className="text-xs">{t("inv.fullPackages")}</Label><Input type="number" min={0} value={fullPackages} onChange={(e) => setFullPackages(e.target.value)} className="h-8 text-xs" /></div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div><Label className="text-xs">{t("inv.looseRounds")}</Label><Input type="number" min={0} value={looseRounds} onChange={(e) => setLooseRounds(e.target.value)} className="h-8 text-xs" /></div>
        <div><Label className="text-xs">{t("inv.min")}</Label><Input type="number" value={safetyThreshold} onChange={(e) => setSafetyThreshold(e.target.value)} className="h-8 text-xs" /></div>
        <div><Label className="text-xs">{t("weapon.cost")} ({currencyPresentation(currency).compactSymbol})</Label><Input type="number" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} className="h-8 text-xs" /></div>
      </div>
      <PricingSection purchasePrice={price} onPurchasePriceChange={setPrice} currency={currency} onCurrencyChange={setCurrency} quantity={1} onQuantityChange={() => undefined} showQuantity={false} additionalCosts={costs} onAdditionalCostsChange={setCosts} finalCost={finalCost} retailPrice={retail.value} retailPriceMode={retail.mode} onRetailChange={setRetail} wholesalePrice={wholesale.value} wholesalePriceMode={wholesale.mode} onWholesaleChange={setWholesale} />
      <Button
        size="sm"
        disabled={isSubmitting}
        onClick={async () => {
          if (isSubmitting) return
          const units = Number(unitsPerPackage)
          const packages = Number(fullPackages)
          const loose = Number(looseRounds)
          const threshold = Number(safetyThreshold)
          const unitPrice = Number(price)
          if (!Number.isFinite(units) || units <= 0) return toast.error(t("inv.unitsPerPkgMustBePositive"))
          if (!Number.isFinite(packages) || packages < 0) return toast.error(t("inv.packagesMustBePositive"))
          if (!Number.isFinite(loose) || loose < 0) return toast.error(t("inv.roundsMustBePositive"))
          if (!Number.isFinite(threshold) || threshold < 0) return toast.error(t("inv.quantityMustBePositive"))
          if (!Number.isFinite(unitPrice) || unitPrice < 0) return toast.error(t("inv.priceMustBePositive"))
          if (!areProductCostsValid(costs)) return toast.error(t("cost.checkAmount"))
          if (!pricingValuesAreValid(finalCost, retail.value, wholesale.value, settings.minProfitMarginPercent)) return toast.error(t("pricing.invalidPrice"))
          setIsSubmitting(true)
          try {
            await onAdd(caliber, packageType, units, packages, loose, threshold, unitPrice, currency, Number(retail.value), Number(wholesale.value), retail.mode, wholesale.mode, costs)
          } finally {
            setIsSubmitting(false)
          }
        }}
      >
        {isSubmitting && <Loader2 className="size-3.5 animate-spin" />}
        {t("common.add")}
      </Button>
    </div>
  )
}
