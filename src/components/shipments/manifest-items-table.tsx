
import { useEffect, useMemo, useState } from "react"
import { DollarSign, FileSearch, Hash, Layers3, Loader2, MapPin, Pencil, Plus, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { SearchableCombobox } from "@/components/ui/searchable-combobox"
import type { useDynamicMasterData } from "@/hooks/use-dynamic-master-data"
import { CurrencyService } from "@/lib/currency-service"
import { calculateDraftFinalCostInCurrency } from "@/lib/product-cost"
import {
  changedManifestPatch,
  commonManifestPatch,
  shipmentItemMissingFields,
} from "@/lib/shipment-workflow"
import { type ManifestItemPatch, type ManifestReviewItem } from "@/lib/shipment-manifest"
import { cn } from "@/lib/utils"
import { PricingSection } from "@/components/pricing-section"

export type ShipmentItemsMode = "file" | "manual" | "edit"

export type ManifestTableMasterData = ReturnType<typeof useDynamicMasterData>

const STATUS_EXPLANATIONS: Record<ManifestReviewItem["status"], string> = {
  valid: "All required product information is complete.",
  needs_review: "Some required information is missing or still needs review.",
  invalid: "One or more values are invalid.",
  duplicate: "This product or one of its serial numbers is duplicated.",
  conflict: "Some product values conflict with existing data.",
}

function StatusBadge({ status, reasons = [] }: { status: ManifestReviewItem["status"]; reasons?: readonly string[] }) {
  const explanation = reasons.length > 0
    ? `${STATUS_EXPLANATIONS[status]} ${reasons.join(", ")}.`
    : STATUS_EXPLANATIONS[status]
  const badge = status === "valid"
    ? <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700">Valid</Badge>
    : status === "duplicate"
      ? <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-700">Duplicate</Badge>
      : status === "conflict" || status === "invalid"
        ? <Badge className="border-red-500/30 bg-red-500/10 text-red-700">{status === "conflict" ? "Conflict" : "Invalid"}</Badge>
        : <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-700">Review</Badge>
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild><span className="inline-flex cursor-help">{badge}</span></TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{explanation}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function InlineManifestCell({
  value, placeholder = "—", type = "text", className, onCommit,
}: {
  value: string | number | null
  placeholder?: string
  type?: "text" | "number"
  className?: string
  onCommit: (value: string | number | null) => Promise<void> | void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value == null ? "" : String(value))
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!editing) setDraft(value == null ? "" : String(value)) }, [editing, value])

  const commit = async () => {
    if (busy) return
    const next = draft.trim() === "" ? null : type === "number" ? Number(draft) : draft.trim()
    if ((next ?? "") === (value ?? "")) { setEditing(false); return }
    setBusy(true)
    try { await onCommit(next); setEditing(false) } catch { /* Parent surfaces the validation error. */ } finally { setBusy(false) }
  }

  if (editing) {
    return (
      <Input
        autoFocus type={type} min={type === "number" ? 0 : undefined} step={type === "number" ? "any" : undefined}
        className={cn("h-8 min-w-0 px-1.5 text-[10px]", className)} value={draft} disabled={busy}
        onChange={(event) => setDraft(event.target.value)} onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); void commit() }
          if (event.key === "Escape") { setDraft(value == null ? "" : String(value)); setEditing(false) }
        }}
      />
    )
  }
  return (
    <button type="button" onClick={() => setEditing(true)} title="Click to edit" className={cn("min-h-8 w-full min-w-0 truncate rounded-md px-1.5 py-1 text-start text-[10px] transition-colors hover:bg-primary/5 hover:ring-1 hover:ring-primary/20", className)}>
      {value == null || value === "" ? <span className="text-muted-foreground">{placeholder}</span> : value}
    </button>
  )
}

interface ManifestItemsTableProps {
  mode: ShipmentItemsMode
  items: ManifestReviewItem[]
  selected: ReadonlySet<string>
  missingFieldsById?: ReadonlyMap<string, readonly string[]>
  currency: string
  masterData: ManifestTableMasterData
  onToggleSelected: (id: string, checked: boolean) => void
  onSelectVisible: (checked: boolean) => void
  onEdit?: (item: ManifestReviewItem) => void
  itemsForBulkEdit?: ManifestReviewItem[]
  onAddItem?: () => void
  onDelete?: (item: ManifestReviewItem) => Promise<void> | void
  onBulkDelete?: (items: ManifestReviewItem[]) => Promise<void> | void
  onPatch: (item: ManifestReviewItem, patch: ManifestItemPatch) => Promise<void> | void
  onBulkPatch?: (items: ManifestReviewItem[], patch: ManifestItemPatch) => Promise<void> | void
  onProcessingChange?: (isProcessing: boolean) => void
}

function buildDraft(item: ManifestReviewItem): ManifestItemPatch {
  return {
    productType: item.productType,
    productName: item.productName,
    weaponType: item.weaponType,
    category: item.category,
    manufacturer: item.manufacturer,
    model: item.model,
    caliber: item.caliber,
    weaponTypeId: item.weaponTypeId,
    weaponSubtypeId: item.weaponSubtypeId,
    brandId: item.brandId,
    modelId: item.modelId,
    caliberId: item.caliberId,
    sku: item.sku,
    serialNumbers: item.serialNumbers,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    retailPrice: item.retailPrice,
    wholesalePrice: item.wholesalePrice,
    retailPriceMode: item.retailPriceMode,
    wholesalePriceMode: item.wholesalePriceMode,
    additionalCosts: item.additionalCosts,
    currency: item.currency,
    storageLocationId: item.storageLocationId,
  }
}

export function ManifestItemsTable({
  mode, items, selected, missingFieldsById = new Map(), currency, masterData,
  onToggleSelected, onSelectVisible, onEdit, itemsForBulkEdit, onAddItem, onDelete, onBulkDelete,
  onPatch, onBulkPatch, onProcessingChange,
}: ManifestItemsTableProps) {
  const [editing, setEditing] = useState<ManifestReviewItem | null>(null)
  const [editingIds, setEditingIds] = useState<string[]>([])
  const [draft, setDraft] = useState<ManifestItemPatch>({})
  const [initialDraft, setInitialDraft] = useState<ManifestItemPatch>({})
  const [saving, setSaving] = useState(false)

  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id))
  const someSelected = items.some((item) => selected.has(item.id))

  const selectedItems = useMemo(
    () => (itemsForBulkEdit ?? items).filter((item) => selected.has(item.id)),
    [items, itemsForBulkEdit, selected]
  )

  const openEdit = (item: ManifestReviewItem) => {
    onEdit?.(item)
    setEditing(item)
    setEditingIds([item.id])
    const next = buildDraft(item)
    setDraft(next)
    setInitialDraft(next)
  }

  const openBulkEdit = () => {
    const sourceItems = itemsForBulkEdit ?? items
    const selectedItems = sourceItems.filter((item) => selected.has(item.id))
    if (selectedItems.length < 2) return
    const common = commonManifestPatch(selectedItems)
    setEditing({ ...selectedItems[0], ...common })
    setEditingIds(selectedItems.map((item) => item.id))
    setDraft(common)
    setInitialDraft(common)
  }

  const closeEdit = () => {
    setEditing(null)
    setEditingIds([])
    setDraft({})
    setInitialDraft({})
  }

  const saveEdit = async () => {
    if (!editing) return
    setSaving(true)
    onProcessingChange?.(true)
    try {
      const isBulk = editingIds.length > 1
      const requested = isBulk ? changedManifestPatch(initialDraft, draft) : draft
      if (isBulk && Object.keys(requested).length === 0) throw new Error("Change at least one field")

      const sourceItems = itemsForBulkEdit ?? items
      const targetItems = sourceItems.filter((item) => editingIds.includes(item.id))
      if (isBulk && onBulkPatch) await onBulkPatch(targetItems, requested)
      else await Promise.all(targetItems.map((item) => Promise.resolve(onPatch(item, requested))))

      closeEdit()
    } catch (error) {
      // The parent owns backend/local validation and is responsible for surfacing the error.
      throw error
    } finally {
      setSaving(false)
      onProcessingChange?.(false)
    }
  }

  const missing = useMemo(
    () => editing ? new Set(shipmentItemMissingFields({ ...editing, ...draft } as ManifestReviewItem)) : new Set<string>(),
    [draft, editing],
  )
  const missingClass = (field: string) => missing.has(field)
    ? "border-amber-500 bg-amber-500/[0.06] ring-1 ring-amber-500/25"
    : ""

  const updateDraft = (patch: ManifestItemPatch) => setDraft((state) => ({ ...state, ...patch }))

  return (
    <>
      {/* شريط الأدوات الجماعية */}
      <div className="mb-2 flex items-center justify-between gap-2 rounded-md border bg-muted/40 p-2">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={(checked) => onSelectVisible(checked === true)}
            aria-label={allSelected ? "Deselect visible items" : "Select visible items"}
          />
          <span className="text-xs text-muted-foreground">
            {selected.size > 0 ? `${selected.size} selected` : "Select rows"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {selectedItems.length > 1 && (
            <Button size="sm" variant="outline" onClick={openBulkEdit}>
              <Pencil className="mr-1 size-3.5" />
              Edit {selectedItems.length} selected
            </Button>
          )}

          {selectedItems.length > 0 && onBulkDelete && (
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 hover:bg-red-500/10 hover:text-red-700"
              onClick={() => {
                if (confirm(`Delete ${selectedItems.length} selected row(s) ? `)) {
                  void onBulkDelete(selectedItems);
                }
              }}
            >
              <Trash2 className="mr-1 size-3.5" />
              Delete {selectedItems.length} selected
            </Button>
          )}
        </div>
      </div>

      <div className="h-full overflow-auto custom-scrollbar" data-mode={mode}>
        <div className="min-w-[1340px] w-full">
          <div className="sticky top-0 z-20 grid grid-cols-[32px_60px_52px_86px_minmax(140px,1.5fr)_minmax(95px,1fr)_minmax(95px,1fr)_minmax(80px,1fr)_minmax(80px,1fr)_minmax(70px,.8fr)_48px_minmax(100px,1.2fr)_88px_84px] items-center gap-1 border-b bg-muted/95 px-2 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground shadow-sm backdrop-blur">
            <Checkbox checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={(checked) => onSelectVisible(checked === true)} aria-label={allSelected ? "Deselect visible items" : "Select visible items"} />
            <span>Actions</span><span>Src</span><span>Type</span><span>Product</span><span>Weapon type</span><span>Sub-type</span><span>Maker</span><span>Model</span><span>Caliber</span><span>Qty</span><span>Serials</span><span>Price</span><span>Status</span>
          </div>

          {items.map((item) => {
            const missingFields = missingFieldsById.get(item.id) ?? []
            const effectiveStatus = missingFields.length === 0 && item.status === "needs_review" ? "valid" : item.status
            return (
              <div key={item.id} onClick={(event) => {
                const target = event.target as HTMLElement
                if (target.closest("button, input, [role='combobox'], [role='checkbox']")) return
                openEdit(item)
              }} className={cn(
                "grid grid-cols-[32px_60px_52px_86px_minmax(140px,1.5fr)_minmax(95px,1fr)_minmax(95px,1fr)_minmax(80px,1fr)_minmax(80px,1fr)_minmax(70px,.8fr)_48px_minmax(100px,1.2fr)_88px_84px] items-center gap-1 border-b px-2 py-1 transition-colors",
                effectiveStatus === "invalid" || effectiveStatus === "conflict"
                  ? "border-s-2 border-s-red-600 bg-red-500/[0.14] hover:bg-red-500/[0.20]"
                  : selected.has(item.id) ? "bg-primary/[0.04]" :
                    missingFields.length > 0
                      ? "border-s-2 border-s-amber-500 bg-amber-500/[0.10] hover:bg-amber-500/[0.14]"
                      : "hover:bg-muted/20",
              )}>
                <Checkbox checked={selected.has(item.id)} onCheckedChange={(checked) => onToggleSelected(item.id, checked === true)} aria-label={`Select row ${item.rowIndex} `} />
                <div className="flex items-center">
                  <Button size="icon" variant="ghost" className="size-7" onClick={() => openEdit(item)} aria-label={`Edit row ${item.rowIndex} `}><Pencil className="size-3.5" /></Button>
                  {onDelete && <Button size="icon" variant="ghost" className="size-7 text-red-600 hover:bg-red-500/10 hover:text-red-700" onClick={() => void onDelete(item)} aria-label={`Delete row ${item.rowIndex} `}><Trash2 className="size-3.5" /></Button>}
                </div>
                <button type="button" onClick={() => openEdit(item)} className="min-w-0 truncate text-start font-mono text-[9px] text-muted-foreground hover:text-primary">#{item.rowIndex}</button>
                <Select value={item.productType ?? "__none"} onValueChange={(value) => void onPatch(item, { productType: value === "__none" ? null : value as ManifestItemPatch["productType"] })}>
                  <SelectTrigger className="h-8 min-w-0 px-2 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="__none">Unmapped</SelectItem><SelectItem value="weapon">Weapon</SelectItem><SelectItem value="ammunition">Ammunition</SelectItem><SelectItem value="accessory">Accessory</SelectItem></SelectContent>
                </Select>
                <button type="button" onClick={() => openEdit(item)} title={item.productName ?? "Open row"} className="min-h-8 min-w-0 truncate rounded-md px-1.5 py-1 text-start text-[10px] font-medium hover:bg-primary/5 hover:ring-1 hover:ring-primary/20">
                  {item.productName || <span className="text-muted-foreground">Row {item.rowIndex}</span>}
                </button>
                <InlineManifestCell value={item.weaponType} onCommit={(value) => onPatch(item, { weaponType: value as string | null })} />
                <InlineManifestCell value={item.category} onCommit={(value) => onPatch(item, { category: value as string | null })} />
                <InlineManifestCell value={item.manufacturer} onCommit={(value) => onPatch(item, { manufacturer: value as string | null })} />
                <InlineManifestCell value={item.model} onCommit={(value) => onPatch(item, { model: value as string | null })} />
                <InlineManifestCell value={item.caliber} onCommit={(value) => onPatch(item, { caliber: value as string | null })} />
                <InlineManifestCell value={item.quantity} type="number" onCommit={(value) => onPatch(item, { quantity: value as number | null })} className="text-center tabular-nums" />
                <button type="button" onClick={() => openEdit(item)} className="min-w-0 truncate rounded-md px-1.5 text-start font-mono text-[9px] hover:bg-primary/5">{item.serialNumbers.length ? `${item.serialNumbers.length} serials` : <span className="text-muted-foreground">No serials</span>}</button>
                <div className="flex items-center gap-0.5"><InlineManifestCell value={item.unitPrice} type="number" onCommit={(value) => onPatch(item, { unitPrice: value as number | null })} className="tabular-nums" /><span className="text-[8px] text-muted-foreground">{item.currency ?? currency}</span></div>
                <div className="min-w-0"><StatusBadge status={effectiveStatus} reasons={[...item.issues.map((issue) => `Row ${item.source.row ?? item.rowIndex}: ${issue.message} `), ...missingFields.map((field) => `Row ${item.source.row ?? item.rowIndex}: missing ${field} `)]} /></div>
              </div>
            )
          })}

          {items.length === 0 && <div className="p-12 text-center text-sm text-muted-foreground">No matching items</div>}

          {onAddItem && (
            <div className="sticky start-0 flex w-full min-w-[1340px] justify-center border-b bg-muted/20 p-2">
              <Button type="button" size="sm" variant="outline" onClick={onAddItem}>
                <Plus className="size-3.5" /> Add line item
              </Button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) closeEdit() }}>
        <DialogContent className="flex max-h-[92vh] w-[min(96vw,58rem)] max-w-4xl flex-col overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-4 py-3">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Layers3 className="size-4 text-primary" />
              {editingIds.length > 1 ? `Edit ${editingIds.length} selected rows` : `Edit row ${editing?.rowIndex ?? ""} `}
            </DialogTitle>
            {editing && editingIds.length === 1 && (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <FileSearch className="size-3.5" />
                Source {editing.source.sheet ?? "document"} · row {editing.source.row ?? "—"}
              </p>
            )}
          </DialogHeader>

          {editing && (
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 pb-6">
              {editingIds.length > 1 && (
                <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                  Shared values are shown directly. Empty fields represent mixed values and remain unchanged unless you enter a new value.
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Card className="sm:col-span-2">
                  <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-xs font-medium"><Layers3 className="size-3.5 text-primary" />Product identification</CardTitle></CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs font-medium">Product type</Label>
                      <Select value={draft.productType ?? "__none"} onValueChange={(value) => updateDraft({ productType: value === "__none" ? null : value as ManifestItemPatch["productType"] })}>
                        <SelectTrigger className={cn("mt-1 h-9 text-xs", missingClass("productType"))}><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="__none">Unmapped</SelectItem><SelectItem value="weapon">Weapon</SelectItem><SelectItem value="ammunition">Ammunition</SelectItem><SelectItem value="accessory">Accessory</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs font-medium">
                        {draft.productType === "ammunition" ? "Ammunition name" : draft.productType === "accessory" ? "Accessory name" : "Product name"}
                      </Label>
                      <Input className={cn("mt-1 h-9 text-xs", missingClass("productName"))} value={draft.productName ?? ""} onChange={(event) => updateDraft({ productName: event.target.value || null })} />
                    </div>

                    {draft.productType === "weapon" && (
                      <>
                        <div>
                          <Label className="text-xs font-medium">Weapon type</Label>
                          <SearchableCombobox
                            value={draft.weaponType ?? ""}
                            onValueChange={(value) => updateDraft({ weaponType: value || null, weaponTypeId: null, category: "", weaponSubtypeId: null })}
                            options={masterData.weaponTypeLabels}
                            placeholder="Search or create weapon type..."
                            searchPlaceholder="Type to search..."
                            allowCreate
                            onCreateNew={(value) => { void masterData.createWeaponType(value); updateDraft({ weaponType: value, weaponTypeId: null, category: "", weaponSubtypeId: null }) }}
                            className={cn("mt-1 h-9 text-xs", missingClass("weaponTypeId"))}
                            invalid={missing.has("weaponTypeId")}
                          />
                          <p className="mt-1 text-[10px] text-muted-foreground">Matched automatically and saved for future shipments.</p>
                        </div>
                        <div>
                          <Label className="text-xs font-medium">Subtype / category <span className="text-destructive">*</span></Label>
                          <SearchableCombobox
                            value={draft.category ?? ""}
                            onValueChange={(value) => updateDraft({ category: value || null, weaponSubtypeId: null })}
                            options={draft.weaponType ? masterData.getSubtypesFor(draft.weaponType) : []}
                            placeholder="Search or create subtype..."
                            searchPlaceholder="Type to search..."
                            allowCreate
                            onCreateNew={(value) => { if (draft.weaponType) void masterData.createWeaponSubtype(draft.weaponType, value); updateDraft({ category: value, weaponSubtypeId: null }) }}
                            className={cn("mt-1 h-9 text-xs", missingClass("weaponSubtypeId"))}
                            invalid={missing.has("weaponSubtypeId")}
                          />
                        </div>
                      </>
                    )}

                    {(draft.productType === "weapon" || draft.productType === "accessory") && (
                      <>
                        <div>
                          <Label className="text-xs font-medium">{draft.productType === "accessory" ? "Accessory type" : "Manufacturer"}</Label>
                          <SearchableCombobox
                            value={draft.manufacturer ?? ""}
                            onValueChange={(value) => updateDraft({ manufacturer: value || null, brandId: null, model: null, modelId: null })}
                            options={masterData.brandLabels}
                            placeholder="Search or create brand..."
                            searchPlaceholder="Type to search..."
                            allowCreate
                            onCreateNew={(value) => { void masterData.createBrand(value); updateDraft({ manufacturer: value, brandId: null, model: null, modelId: null }) }}
                            className={cn("mt-1 h-9 text-xs", missingClass("brandId"))}
                            invalid={draft.productType === "weapon" && missing.has("brandId")}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium">{draft.productType === "accessory" ? "Accessory name" : "Model"}</Label>
                          <SearchableCombobox
                            value={draft.model ?? ""}
                            onValueChange={(value) => updateDraft({ model: value || null, modelId: null })}
                            options={masterData.modelLabels}
                            placeholder="Search or create model..."
                            searchPlaceholder="Type to search..."
                            allowCreate
                            onCreateNew={(value) => { void masterData.createModel(value, draft.manufacturer ?? ""); updateDraft({ model: value, modelId: null }) }}
                            className={cn("mt-1 h-9 text-xs", missingClass("modelId"))}
                            invalid={draft.productType === "weapon" && missing.has("modelId")}
                          />
                        </div>
                      </>
                    )}

                    {draft.productType !== "accessory" && (
                      <div>
                        <Label className="text-xs font-medium">Caliber</Label>
                        <SearchableCombobox
                          value={draft.caliber ?? ""}
                          onValueChange={(value) => updateDraft({ caliber: value || null, caliberId: null })}
                          options={draft.productType === "weapon" && draft.weaponType && draft.category ? masterData.getCalibersFor(draft.weaponType, draft.category) : masterData.caliberLabels}
                          placeholder="Search or create caliber..."
                          searchPlaceholder="Type to search..."
                          allowCreate
                          onCreateNew={(value) => { void masterData.createCaliber(value); updateDraft({ caliber: value, caliberId: null }) }}
                          className={cn("mt-1 h-9 text-xs", missingClass("caliberId"))}
                          invalid={draft.productType === "weapon" && missing.has("caliberId")}
                        />
                      </div>
                    )}

                    <div>
                      <Label className="text-xs font-medium">Quantity</Label>
                      <Input type="number" min={1} className={cn("mt-1 h-9 text-xs", missingClass("quantity"))} value={draft.quantity ?? ""} onChange={(event) => updateDraft({ quantity: event.target.value ? Number(event.target.value) : null })} />
                    </div>
                  </CardContent>
                </Card>

                <Card className={cn("sm:col-span-2", missing.has("unitPrice") && "border-amber-500 bg-amber-500/[0.03] ring-1 ring-amber-500/20")}>
                  <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-xs font-medium"><DollarSign className="size-3.5 text-primary" />Pricing & margins</CardTitle></CardHeader>
                  <CardContent>
                    <PricingSection
                      purchasePrice={draft.unitPrice == null ? "" : String(draft.unitPrice)}
                      onPurchasePriceChange={(value) => updateDraft({ unitPrice: value ? Number(value) : null })}
                      currency={draft.currency ?? currency}
                      onCurrencyChange={(value) => updateDraft({ currency: value })}
                      quantity={draft.quantity ?? 1}
                      onQuantityChange={(value) => updateDraft({ quantity: value })}
                      showQuantity={false}
                      additionalCosts={draft.additionalCosts ?? []}
                      onAdditionalCostsChange={(costs) => updateDraft({ additionalCosts: costs })}
                      finalCost={(() => {
                        try {
                          return Number(calculateDraftFinalCostInCurrency(
                            String(draft.unitPrice ?? 0),
                            draft.currency ?? currency,
                            draft.additionalCosts ?? [],
                            (amount, from, to) => CurrencyService.convert(amount, from, to),
                          ))
                        } catch {
                          return draft.unitPrice ?? 0
                        }
                      })()}
                      retailPrice={draft.retailPrice == null ? "" : String(draft.retailPrice)}
                      retailPriceMode={draft.retailPriceMode ?? "auto"}
                      onRetailChange={(next) => updateDraft({ retailPrice: Number(next.value) || 0, retailPriceMode: next.mode })}
                      wholesalePrice={draft.wholesalePrice == null ? "" : String(draft.wholesalePrice)}
                      wholesalePriceMode={draft.wholesalePriceMode ?? "auto"}
                      onWholesaleChange={(next) => updateDraft({ wholesalePrice: Number(next.value) || 0, wholesalePriceMode: next.mode })}
                    />
                  </CardContent>
                </Card>

                {draft.productType === "weapon" && editingIds.length === 1 && (
                  <Card className={cn("sm:col-span-2", missing.has("serialNumbers") && "border-amber-500 bg-amber-500/[0.03] ring-1 ring-amber-500/20")}>
                    <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-xs font-medium"><Hash className="size-3.5 text-primary" />Serial numbers — one per line</CardTitle></CardHeader>
                    <CardContent>
                      <Textarea
                        className={cn("min-h-40 font-mono text-xs", missingClass("serialNumbers"))}
                        value={(draft.serialNumbers ?? []).join("\n")}
                        onChange={(event) => updateDraft({
                          serialNumbers: event.target.value.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean),
                        })}
                      />
                    </CardContent>
                  </Card>
                )}

                <Card className="sm:col-span-2">
                  <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-xs font-medium"><MapPin className="size-3.5 text-primary" />Storage location</CardTitle></CardHeader>
                  <CardContent>
                    <Select value={draft.storageLocationId ?? "__none"} onValueChange={(value) => updateDraft({ storageLocationId: value === "__none" ? null : value })}>
                      <SelectTrigger className={cn("h-9 text-xs", missingClass("storageLocationId"))}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Select</SelectItem>
                        {masterData.storageLocations.map((row) => {
                          const warehouse = masterData.warehouses.find((candidate) => candidate.id === row.warehouse_id)
                          return <SelectItem key={row.id} value={row.id}>{warehouse?.label ?? row.warehouse_id} · {row.shelf}/{row.bin}</SelectItem>
                        })}
                      </SelectContent>
                    </Select>
                  </CardContent>
                </Card>

                <Card className="sm:col-span-2">
                  <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-xs font-medium"><FileSearch className="size-3.5 text-primary" />Original source data</CardTitle></CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-wrap break-all text-xs text-muted-foreground">{editing.source.text ?? JSON.stringify(editing.rawData)}</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          <DialogFooter className="shrink-0 border-t bg-background px-4 pt-3">
            <Button variant="outline" onClick={closeEdit}>Cancel</Button>
            <Button disabled={saving} onClick={() => void saveEdit().catch(() => undefined)}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {editingIds.length > 1 ? `Apply to ${editingIds.length} rows` : "Save and revalidate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
