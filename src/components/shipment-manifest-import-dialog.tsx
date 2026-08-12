import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileSearch,
  Filter,
  Layers3,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
  X,
  Check,
  FileText,
  ReceiptText,
} from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { DatePicker } from "@/components/ui/date-picker"
import { useDynamicMasterData } from "@/hooks/use-dynamic-master-data"
import { cn } from "@/lib/utils"
import {
  type ManifestDetailsPatch,
  type ManifestItemPatch,
  type ManifestProgress,
  type ManifestReviewItem,
  type ManifestReviewSummary,
  type ShipmentManifestReview,
  summarizeItemStatuses,
} from "@/lib/shipment-manifest"
import { useStore } from "@/lib/store"
import { useCurrency } from "@/lib/currency-context"
import { generateShipmentNumber } from "@/lib/format"
import { manifestClient } from "@/lib/manifest-client"
import { ShipmentCostEditor } from "./shipment-cost-editor"
import type { Shipment, ShipmentAdditionalCostInput } from "@/lib/types"
import {
  manifestItemToLineInput,
  removeManifestReviewItems,
  resolveManifestClassification,
  shipmentItemMissingFields,
  shipmentToManifestReview,
} from "@/lib/shipment-workflow"
import { ManifestItemsTable } from "@/components/shipments/manifest-items-table"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete?: () => void
  /** Existing shipment mode skips file selection and opens directly on the shared items table. */
  editShipment?: Shipment
}

const PAGE_SIZE = 50
type ManifestStep = "items" | "costs" | "shipment"
const ACCEPT = ".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.webp"

const STEP_LABELS: { id: ManifestStep; labelKey: string; icon: React.ElementType }[] = [
  { id: "shipment", labelKey: "Shipment Info", icon: FileText },
  { id: "items", labelKey: "Review Items", icon: FileSearch },
  { id: "costs", labelKey: "Shipment Costs", icon: ReceiptText },
]

function aiProviderLabel(provider: string | null, model: string | null): string {
  if (provider === "openai") return model ? `OpenAI · ${model}` : "OpenAI"
  if (provider === "deepseek") return model ? `DeepSeek · ${model}` : "DeepSeek"
  return "Native extraction"
}

function SummaryCard({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "good" | "warn" | "bad" }) {
  const toneClass = cn(
    tone === "good" && "border-emerald-500/30 bg-emerald-500/5 text-emerald-700",
    tone === "warn" && "border-amber-500/30 bg-amber-500/5 text-amber-700",
    tone === "bad" && "border-red-500/30 bg-red-500/5 text-red-700"
  )
  return (
    <div className={cn("min-w-[68px] rounded-md border px-2 py-1.5", toneClass)}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-bold tabular-nums">{value}</div>
    </div>
  )
}

export function ShipmentManifestImportDialog({ open, onOpenChange, onComplete, editShipment }: Props) {
  const currentUser = useStore((s) => s.getCurrentUser())
  const suppliers = useStore((s) => s.suppliers)
  const shipments = useStore((s) => s.shipments)
  const refreshFromDb = useStore((s) => s.refreshFromDb)
  const updateScheduledShipment = useStore((s) => s.updateScheduledShipment)
  const md = useDynamicMasterData()
  const { currencies, transactionCurrency, currencyPresentation } = useCurrency()
  const activeCurrencies = useMemo(() => currencies.filter((c) => c.isActive), [currencies])

  const fileRef = useRef<HTMLInputElement>(null)
  const detailsLoaded = useRef(false)

  const [progress, setProgress] = useState<ManifestProgress | null>(null)
  const [review, setReview] = useState<ShipmentManifestReview | null>(null)
  const [recent, setRecent] = useState<ManifestReviewSummary[]>([])
  const [loadingRecent, setLoadingRecent] = useState(false)
  const [search, setSearch] = useState("")
  const [problemsOnly, setProblemsOnly] = useState(false)
  const [sort, setSort] = useState<"row" | "product" | "status">("row")
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [tableProcessing, setTableProcessing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ManifestReviewSummary | null>(null)
  const [arrival, setArrival] = useState<"arrived_now" | "future">("future")
  const [step, setStep] = useState<ManifestStep>("shipment")
  const today = new Date().toISOString().slice(0, 10)

  const [shipmentNumber, setShipmentNumber] = useState("")
  const [supplierId, setSupplierId] = useState("")
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [manifestNumber, setManifestNumber] = useState("")
  const [shipmentDate, setShipmentDate] = useState(today)
  const [expectedArrivalDate, setExpectedArrivalDate] = useState(today)
  const [origin, setOrigin] = useState("")
  const [destination, setDestination] = useState("")
  const [currency, setCurrency] = useState(transactionCurrency)
  const [note, setNote] = useState("")
  const [autosaveState, setAutosaveState] = useState<"saved" | "saving" | "error">("saved")
  const [showWarning, setShowWarning] = useState(true)
  const [shipmentCosts, setShipmentCosts] = useState<ShipmentAdditionalCostInput[]>([])
  const [shipmentCostsValid, setShipmentCostsValid] = useState(true)

  useEffect(() => {
    if (review?.processingWarning && showWarning) {
      const timer = setTimeout(() => setShowWarning(false), 5000)
      return () => clearTimeout(timer)
    }
  }, [review?.processingWarning, showWarning])

  const actor = { id: currentUser.id, name: currentUser.name }

  const loadRecent = async () => {
    setLoadingRecent(true)
    try {
      const result = await manifestClient.list(30, actor)
      if (!result.success || !result.data) throw new Error(result.error ?? "Unable to load saved reviews")
      setRecent(result.data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load saved reviews")
    } finally { setLoadingRecent(false) }
  }

  useEffect(() => {
    if (!open) return
    if (editShipment) return
    void loadRecent()
    return manifestClient.onProgress(setProgress)
  }, [editShipment, open])

  const loadReview = (next: ShipmentManifestReview) => {
    detailsLoaded.current = false
    setReview(next)
    const supplier = suppliers.find(c => c.id === next.supplierId || c.name.toLowerCase() === next.supplierName?.toLowerCase())
    setShipmentNumber(next.shipmentNumber?.trim() || (supplier ? generateShipmentNumber(shipments) : ""))
    setSupplierId(supplier?.id ?? "")
    setInvoiceNumber(next.invoiceNumber ?? "")
    setManifestNumber(next.manifestNumber ?? "")
    setShipmentDate(next.shipmentDate ?? today)
    setExpectedArrivalDate(next.expectedArrivalDate ?? today)
    setOrigin(next.origin ?? "")
    setDestination(next.destination ?? "")
    setCurrency(next.currency && activeCurrencies.some(c => c.isoCode === next.currency) ? next.currency : transactionCurrency)
    setNote(next.reviewNote ?? "")
    setShipmentCosts(next.additionalCosts ?? [])
    setSelected(new Set())
    setPage(0)
    setStep("shipment")
    setTimeout(() => { detailsLoaded.current = true }, 0)
  }

  useEffect(() => {
    if (!open || !editShipment) return
    loadReview(shipmentToManifestReview(editShipment))
  }, [editShipment, open])

  const openSavedReview = async (importId: string) => {
    setSaving(true)
    try {
      const result = await manifestClient.get(importId, actor)
      if (!result.success || !result.data) throw new Error(result.error ?? "Unable to open review")
      loadReview(result.data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to open review")
    } finally { setSaving(false) }
  }

  const selectSupplier = (value: string) => {
    const nextSupplierId = value === "__none" ? "" : value
    setSupplierId(nextSupplierId)
    if (nextSupplierId && !shipmentNumber.trim()) {
      setShipmentNumber(generateShipmentNumber(shipments))
    }
  }

  useEffect(() => {
    if (!open || editShipment || !review || review.status !== "pending_review" || !detailsLoaded.current) return
    const timer = setTimeout(async () => {
      const supplier = suppliers.find(s => s.id === supplierId)
      const patch: ManifestDetailsPatch = {
        shipmentNumber: shipmentNumber || null, supplierId: supplierId || null,
        supplierName: supplier?.name ?? review.supplierName, invoiceNumber: invoiceNumber || null,
        manifestNumber: manifestNumber || null, shipmentDate: shipmentDate || null,
        expectedArrivalDate: expectedArrivalDate || null, origin: origin || null,
        destination: destination || null, currency: currency || null, reviewNote: note || null,
        additionalCosts: shipmentCosts,
      }
      setAutosaveState("saving")
      const result = await manifestClient.updateDetails(review.id, patch, actor)
      if (result.success && result.data) { setReview(result.data); setAutosaveState("saved") }
      else setAutosaveState("error")
    }, 700)
    return () => clearTimeout(timer)
  }, [currency, destination, editShipment, expectedArrivalDate, invoiceNumber, manifestNumber, note, open, origin, review?.id, shipmentCosts, shipmentDate, shipmentNumber, supplierId])

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ""
    if (!file) return
    setReview(null); setProgress({ stage: "uploading", percent: 1, message: "Preparing document" })
    try {
      const result = await manifestClient.upload({ fileName: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }, actor)
      if (!result.success || !result.data) throw new Error(result.error ?? "Unable to process manifest")
      setProgress(null); loadReview(result.data)
      if (result.data.duplicateOf) toast.warning("An existing review for this document was opened")
      else toast.success("Manifest is ready for review")
      void loadRecent()
    } catch (error) {
      setProgress(null); toast.error(error instanceof Error ? error.message : "Unable to extract shipment data")
    }
  }

  // Cache completeness once per review so filtering, summaries, and row rendering
  // do not repeatedly recalculate the same validation rules for every render.
  const missingFieldsById = useMemo(() => {
    const map = new Map<string, string[]>()
    if (!review) return map
    for (const item of review.items) {
      map.set(item.id, shipmentItemMissingFields(item))
    }
    return map
  }, [review])

  const filtered = useMemo(() => {
    if (!review) return []
    const query = search.trim().toLowerCase()
    const result = review.items.filter(item => {
      const missing = missingFieldsById.get(item.id)
      if (problemsOnly && (!missing || missing.length === 0)) return false
      if (!query) return true
      return [item.productName, item.manufacturer, item.model, item.caliber, item.sku, ...item.serialNumbers]
        .some(v => v?.toLowerCase().includes(query))
    })
    return [...result].sort((a, b) => {
      if (sort === "product") return (a.productName ?? "").localeCompare(b.productName ?? "")
      if (sort === "status") return a.status.localeCompare(b.status)
      return a.rowIndex - b.rowIndex
    })
  }, [missingFieldsById, problemsOnly, review, search, sort])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const rows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  useEffect(() => { if (page >= pages) setPage(Math.max(0, pages - 1)) }, [page, pages])

  // Keep selection operations centralized. This avoids duplicating Set logic
  // throughout the table and makes bulk selection predictable across pages/filters.
  const toggleSelected = (id: string, checked: boolean) => {
    setSelected(current => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const selectVisible = (checked: boolean) => {
    setSelected(current => {
      const next = new Set(current)
      for (const item of rows) {
        if (checked) next.add(item.id)
        else next.delete(item.id)
      }
      return next
    })
  }

  const selectAllFiltered = () => {
    setSelected(current => {
      const next = new Set(current)
      for (const item of filtered) next.add(item.id)
      return next
    })
  }

  const clearSelection = () => setSelected(new Set())

  const deleteItems = async (itemIds: string[]) => {
    if (!review || itemIds.length === 0) return
    if (itemIds.length >= review.items.length) {
      toast.error("A shipment must keep at least one product row")
      return
    }
    setSaving(true)
    try {
      if (editShipment) {
        setReview((current) => current ? removeManifestReviewItems(current, itemIds) : current)
      } else {
        const result = await manifestClient.deleteItems(review.id, itemIds, actor)
        if (!result.success || !result.data) throw new Error(result.error ?? "Unable to delete shipment rows")
        setReview(result.data)
      }
      const deleted = new Set(itemIds)
      setSelected((current) => new Set([...current].filter((id) => !deleted.has(id))))
      toast.success(itemIds.length === 1 ? "Row deleted" : `${itemIds.length} rows deleted`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete shipment rows")
    } finally {
      setSaving(false)
    }
  }

  const applyLocalItemPatches = (patches: Map<string, ManifestItemPatch>) => {
    setReview((current) => {
      if (!current) return current
      const items = current.items.map((item) => {
        const patch = patches.get(item.id)
        if (!patch) return item
        const next = { ...item, ...patch }
        return {
          ...next,
          serialNumber: next.serialNumbers?.[0] ?? null,
          totalPrice: (next.quantity ?? 0) * (next.unitPrice ?? 0),
          status: shipmentItemMissingFields(next).length === 0 ? "valid" as const : "needs_review" as const,
        }
      })
      return { ...current, items, validationSummary: summarizeItemStatuses(items), updatedAt: new Date().toISOString() }
    })
  }

  const resolvePatchForItem = async (item: ManifestReviewItem, patch: ManifestItemPatch) => {
    const effective = { ...item, ...patch }
    return effective.productType
      ? { ...patch, ...await resolveManifestClassification(effective, md) }
      : patch
  }

  const patchItem = async (item: ManifestReviewItem, patch: ManifestItemPatch) => {
    if (!review) return
    try {
      const resolved = await resolvePatchForItem(item, patch)
      if (editShipment) {
        applyLocalItemPatches(new Map([[item.id, resolved]]))
        return
      }
      const result = await manifestClient.updateItem(review.id, item.id, resolved, actor)
      if (!result.success || !result.data) throw new Error(result.error ?? "Unable to save item")
      setReview(result.data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save item")
      throw error
    }
  }

  const patchItems = async (items: ManifestReviewItem[], patch: ManifestItemPatch) => {
    if (!review || items.length === 0) return
    try {
      const updates = await Promise.all(items.map(async (item) => ({
        itemId: item.id,
        patch: await resolvePatchForItem(item, patch),
      })))
      if (editShipment) {
        applyLocalItemPatches(new Map(updates.map((update) => [update.itemId, update.patch])))
        return
      }
      const result = await manifestClient.bulkUpdateItems(review.id, updates, actor)
      if (!result.success || !result.data) throw new Error(result.error ?? "Unable to save selected items")
      setReview(result.data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save selected items")
      throw error
    }
  }

  const deleteReview = async () => {
    if (!deleteTarget) return
    setSaving(true)
    try {
      const result = await manifestClient.deleteReview(deleteTarget.id, actor)
      if (!result.success) throw new Error(result.error ?? "Unable to delete review")
      setDeleteTarget(null); await loadRecent(); toast.success("Unconfirmed review deleted")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to delete review") } finally { setSaving(false) }
  }

  const structuralBlocking = review ? review.validationSummary.invalid + review.validationSummary.duplicate + review.validationSummary.conflict : 0
  const receiptRequirements = review
    ? Array.from(missingFieldsById.values()).filter(fields => fields.length > 0).length
    : 0
  const confirmationBlocking = structuralBlocking + (!editShipment && arrival === "arrived_now" ? receiptRequirements : 0)
  const confirmationFieldIssues = [
    !shipmentNumber && "Enter the shipment number.", !supplierId && "Select a supplier.",
    !shipmentDate && "Select the shipment date.", !currency && "Select the transaction currency.",
    arrival === "future" && !expectedArrivalDate && "Select the expected arrival date.",
  ].filter((issue): issue is string => Boolean(issue))

  const totalQuantity = review?.items.reduce((sum, i) => sum + (i.quantity ?? 0), 0) ?? 0
  const weaponQuantity = review?.items.filter(i => i.productType === "weapon").reduce((sum, i) => sum + (i.quantity ?? 0), 0) ?? 0
  const accessoryQuantity = review?.items.filter(i => i.productType === "accessory").reduce((sum, i) => sum + (i.quantity ?? 0), 0) ?? 0
  const ammunitionQuantity = review?.items.filter(i => i.productType === "ammunition").reduce((sum, i) => sum + (i.quantity ?? 0), 0) ?? 0

  const confirm = async () => {
    if (!review) return
    setSaving(true)
    try {
      if (editShipment) {
        // Row edits already resolve any changed classifications. Reuse the
        // stored IDs here so a metadata/date-only edit does not require receipt
        // readiness or re-create master data for every unchanged row.
        const lineItems = review.items.map((item) => manifestItemToLineInput(item, currency))
        const result = await updateScheduledShipment(editShipment.id, {
          shipmentNumber,
          supplierId,
          shipmentDate,
          expectedArrivalDate,
          totalExpectedItems: lineItems.reduce((sum, item) => sum + item.quantity, 0),
          attachments: editShipment.attachments,
          notes: note,
          purchaseOrderNumber: editShipment.purchaseOrderNumber,
          invoiceNumber: invoiceNumber || undefined,
          shippingCarrier: editShipment.shippingCarrier,
          containerNumber: editShipment.containerNumber,
          currency,
          purchaseDate: editShipment.purchaseDate,
          status: editShipment.status,
          lineItems,
          additionalCosts: shipmentCosts,
        })
        if (!result.success) throw new Error(result.error ?? "Unable to update shipment")
        setConfirmOpen(false)
        onOpenChange(false)
        onComplete?.()
        toast.success("Shipment contents updated")
        return
      }
      const classificationUpdates = (await Promise.all(review.items.map(async (item) => {
        const hasCompleteWeaponLabels = item.productType === "weapon"
          && Boolean(item.weaponType?.trim() && item.category?.trim() && item.manufacturer?.trim() && item.model?.trim() && item.caliber?.trim())
        if (!hasCompleteWeaponLabels) return null
        const classification = await resolveManifestClassification(item, md)
        const changed = Object.entries(classification).some(([field, value]) => item[field as keyof ManifestReviewItem] !== value)
        return changed ? { itemId: item.id, patch: classification } : null
      }))).filter((update): update is { itemId: string; patch: ManifestItemPatch } => update !== null)
      if (classificationUpdates.length > 0) {
        const classificationResult = await manifestClient.bulkUpdateItems(review.id, classificationUpdates, actor)
        if (!classificationResult.success || !classificationResult.data) {
          throw new Error(classificationResult.error ?? "Unable to save item classifications")
        }
        setReview(classificationResult.data)
      }
      const costsResult = await manifestClient.updateDetails(review.id, { additionalCosts: shipmentCosts }, actor)
      if (!costsResult.success) throw new Error(costsResult.error ?? "Unable to save shipment costs")
      const result = await manifestClient.confirm({
        importId: review.id, shipmentNumber, supplierId, invoiceNumber: invoiceNumber || null,
        manifestNumber: manifestNumber || null, shipmentDate,
        expectedArrivalDate: arrival === "future" ? expectedArrivalDate : null,
        origin: origin || null, destination: destination || null, currency, arrival, note: note || null,
      }, actor)
      if (!result.success || !result.data) throw new Error(result.error ?? "Unable to confirm shipment")
      setReview(result.data); setConfirmOpen(false); await refreshFromDb(); onComplete?.()
      toast.success(arrival === "future" ? "Shipment scheduled without changing inventory" : "Shipment received into inventory")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to confirm shipment") } finally { setSaving(false) }
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every(item => selected.has(item.id))
  const isProcessing = saving || tableProcessing || autosaveState === "saving"

  return (
    <>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: hsl(var(--muted) / 0.3); border-radius: 8px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: hsl(var(--muted-foreground) / 0.35); border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: hsl(var(--muted-foreground) / 0.55); }
        .custom-scrollbar { scrollbar-width: thin; scrollbar-color: hsl(var(--muted-foreground) / 0.35) hsl(var(--muted) / 0.2); }
      `}</style>

      <Dialog open={open} onOpenChange={(nextOpen) => { if (!isProcessing) onOpenChange(nextOpen) }}>
        <DialogContent className="flex h-[94vh] max-h-[94vh] w-[calc(100vw-1.5rem)] max-w-[1800px] flex-col overflow-hidden p-0 sm:w-[calc(100vw-2rem)]">
          {/* Header */}
          <DialogHeader className="shrink-0 border-b bg-background/95 px-4 py-3 backdrop-blur sm:px-5">
            <div className="flex min-h-10 items-center justify-between gap-3 pe-8">
              <div className="flex min-w-0 items-center gap-2">
                {review && !editShipment && (
                  <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={() => { setReview(null); void loadRecent() }}>
                    <ArrowLeft className="size-4 rtl:rotate-180" />
                  </Button>
                )}
                <FileSearch className="size-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <DialogTitle className="truncate">{editShipment ? `Edit shipment contents · ${editShipment.shipmentNumber}` : review ? review.fileName : "Shipment manifest workspace"}</DialogTitle>
                    {review && (
                      <Badge variant="outline" className={cn(
                        "h-5 shrink-0 px-1.5 text-[9px]",
                        review.aiProvider === "deepseek" ? "border-blue-500/30 bg-blue-500/10 text-blue-700" :
                          review.aiProvider === "openai" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" : ""
                      )}>
                        <Sparkles className="me-1 size-2.5" /> {aiProviderLabel(review.aiProvider, review.aiModel)}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {editShipment ? "Changes are saved to the shipment only after final confirmation" : review ? "Review is stored in the database until you confirm or delete it" : "Upload a new document or continue a saved review"}
                  </p>
                </div>
              </div>
              {review && (
                <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                  <Clock3 className="size-3.5" />
                  {autosaveState === "saving" ? "Saving…" : autosaveState === "error" ? <span className="text-red-600">Autosave failed</span> : "All changes saved"}
                </div>
              )}
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar overscroll-contain">
            {!review ? (
              <div className="grid min-h-full gap-0 lg:grid-cols-[minmax(420px,0.9fr)_minmax(520px,1.1fr)]">
                {/* Upload Section */}
                <div className="flex min-h-[420px] items-center justify-center border-e p-5 sm:p-8">
                  {progress ? (
                    <Card className="w-full max-w-xl">
                      <CardHeader className="pb-2"><CardTitle className="text-base">Processing manifest</CardTitle></CardHeader>
                      <CardContent className="space-y-4 p-6">
                        <div className="flex items-center gap-3">
                          <Loader2 className="size-5 animate-spin text-primary" />
                          <div className="text-sm text-muted-foreground">{progress.message}</div>
                        </div>
                        <Progress value={progress.percent} />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{progress.stage.replace("_", " ")}</span><span>{progress.percent}%</span>
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border border-dashed p-8 text-center sm:p-10">
                      <div className="rounded-full bg-primary/10 p-4"><Upload className="size-8 text-primary" /></div>
                      <div>
                        <h3 className="text-lg font-semibold">Upload shipment manifest</h3>
                        <p className="mt-1 text-sm text-muted-foreground">Excel, CSV, PDF, or scanned image. Extraction never changes inventory.</p>
                      </div>
                      <Button size="lg" onClick={() => fileRef.current?.click()}><Upload className="size-4" /> Choose document</Button>
                      <p className="text-xs text-muted-foreground">Maximum 30 MB · Arabic and English · AI runs only in Electron Main</p>
                    </div>
                  )}
                  <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={handleFile} />
                </div>

                {/* Recent Reviews */}
                <div className="flex flex-col bg-muted/10">
                  <div className="flex items-center justify-between border-b px-5 py-3">
                    <div>
                      <h3 className="font-semibold">Saved reviews</h3>
                      <p className="text-xs text-muted-foreground">Continue exactly where you stopped</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => void loadRecent()} disabled={loadingRecent}>
                      <RefreshCw className={cn("size-3.5", loadingRecent && "animate-spin")} /> Refresh
                    </Button>
                  </div>
                  <div className="p-4 sm:p-5">
                    {recent.length === 0 && !loadingRecent ? (
                      <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-muted-foreground">
                        <Layers3 className="size-10 opacity-30" /><p className="text-sm">No saved reviews</p>
                      </div>
                    ) : (
                      <div className="grid gap-3 xl:grid-cols-2">
                        {recent.map((item) => {
                          const blocking = item.validationSummary.invalid + item.validationSummary.duplicate + item.validationSummary.conflict
                          return (
                            <Card key={item.id} className="transition-colors hover:border-primary/40">
                              <CardContent className="space-y-3 p-4">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold" title={item.fileName}>{item.fileName}</div>
                                    <div className="mt-1 text-[10px] text-muted-foreground">{new Date(item.updatedAt).toLocaleString()} · {aiProviderLabel(item.aiProvider, null)}</div>
                                  </div>
                                  <Badge variant="outline">{item.status.replace("_", " ")}</Badge>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-center">
                                  <div className="rounded bg-muted p-2"><div className="text-[9px] text-muted-foreground">Rows</div><div className="font-bold">{item.itemCount}</div></div>
                                  <div className="rounded bg-emerald-500/5 p-2"><div className="text-[9px] text-muted-foreground">Valid</div><div className="font-bold text-emerald-700">{item.validationSummary.valid}</div></div>
                                  <div className="rounded bg-red-500/5 p-2"><div className="text-[9px] text-muted-foreground">Blocking</div><div className="font-bold text-red-700">{blocking}</div></div>
                                </div>
                                <div className="flex gap-2">
                                  <Button className="flex-1" size="sm" onClick={() => void openSavedReview(item.id)}>Continue review</Button>
                                  {item.status !== "processing" && (
                                    <Button size="icon" variant="outline" className="size-8 text-red-600" onClick={() => setDeleteTarget(item)}>
                                      <Trash2 className="size-3.5" />
                                    </Button>
                                  )}
                                </div>
                              </CardContent>
                            </Card>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-full min-w-0 flex-col">
                {/* Step Indicator */}
                <div className="shrink-0 border-b bg-background px-4 py-2.5 sm:px-5">
                  <div className="flex items-center gap-2">
                    {STEP_LABELS.map((s, i) => {
                      const Icon = s.icon
                      const isCompleted = i < STEP_LABELS.findIndex(candidate => candidate.id === step)
                      const isCurrent = step === s.id
                      return (
                        <div key={s.id} className="flex flex-1 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => { if (isCompleted && !isProcessing) setStep(s.id) }}
                            disabled={isProcessing || (!isCompleted && !isCurrent)}
                            className={cn(
                              "flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-medium transition-all duration-200",
                              isCompleted ? "bg-primary text-primary-foreground cursor-pointer hover:bg-primary/80" :
                                isCurrent ? "bg-primary text-primary-foreground ring-2 ring-primary/30 shadow-sm shadow-primary/20" :
                                  "bg-muted text-muted-foreground"
                            )}
                            title={s.labelKey}
                          >
                            {isCompleted ? <Check className="size-3" /> : <Icon className="size-3" />}
                          </button>
                          <span className={cn("hidden text-[10px] sm:inline", isCurrent ? "font-semibold" : "text-muted-foreground")}>{s.labelKey}</span>
                          {i < STEP_LABELS.length - 1 && <div className={cn("h-px flex-1", isCompleted ? "bg-primary" : "bg-border")} />}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {step === "items" ? (
                  <div className="flex min-h-0 flex-1 flex-col">
                    {/* Summary Cards */}
                    <div className="shrink-0 border-b bg-muted/10 px-3 py-2.5 sm:px-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <SummaryCard label="Rows" value={review.items.length} />
                        <SummaryCard label="Valid" value={review.validationSummary.valid} tone="good" />
                        <SummaryCard label="Review" value={review.validationSummary.needsReview} tone="warn" />
                        <SummaryCard label="Invalid" value={review.validationSummary.invalid} tone="bad" />
                        <SummaryCard label="Conflicts" value={review.validationSummary.duplicate + review.validationSummary.conflict} tone="bad" />
                        <SummaryCard label="Receipt" value={receiptRequirements} tone={receiptRequirements ? "warn" : "good"} />
                        <div className="ms-auto hidden min-w-0 flex-1 justify-end lg:flex">
                          <div className="truncate text-end text-[10px] text-muted-foreground" title={`${aiProviderLabel(review.aiProvider, review.aiModel)} · ${totalQuantity.toLocaleString()} total units`}>
                            {aiProviderLabel(review.aiProvider, review.aiModel)} · {totalQuantity.toLocaleString()} units
                            {review.aiProcessingMs ? ` · ${(review.aiProcessingMs / 1000).toFixed(1)}s` : ""}
                          </div>
                        </div>
                      </div>
                    </div>

                    {review?.processingWarning && showWarning && (
                      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 sm:px-4">
                        <div className="flex items-center gap-2 overflow-hidden">
                          <AlertTriangle className="size-3.5 shrink-0" />
                          <span className="truncate">{review.processingWarning}</span>
                        </div>
                        <button onClick={() => setShowWarning(false)} className="shrink-0 rounded p-1 hover:bg-amber-500/20 transition-colors"><X className="size-3.5" /></button>
                      </div>
                    )}

                    {/* Toolbar */}
                    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background px-3 py-2.5 sm:px-4">
                      <div className="relative min-w-0 flex-1 basis-60">
                        <Search className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} placeholder="Search product, serial, model, caliber…" className="h-8 ps-8 text-xs" />
                      </div>
                      <Button size="sm" variant={problemsOnly ? "default" : "outline"} className="h-8 shrink-0 text-xs" onClick={() => { setProblemsOnly(v => !v); setPage(0) }}>
                        <Filter className="size-3.5" /> <span className="hidden sm:inline">Needs attention</span>
                      </Button>
                      <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
                        <SelectTrigger className="h-8 w-32 shrink-0 text-xs sm:w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="row">Source order</SelectItem>
                          <SelectItem value="product">Product</SelectItem>
                          <SelectItem value="status">Status</SelectItem>
                        </SelectContent>
                      </Select>
                      {selected.size > 0 && (
                        <>
                          {!allFilteredSelected && filtered.length > selected.size && (
                            <Button size="sm" variant="outline" className="h-8 shrink-0 text-xs" onClick={selectAllFiltered}>
                              Select all {filtered.length}
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-xs" onClick={clearSelection}>
                            <X className="size-3.5" /> Clear
                          </Button>
                        </>
                      )}
                    </div>

                    {/* Shared by file import, manual entry, and shipment edit. */}
                    <div className="min-h-0 flex-1 overflow-hidden">
                      <ManifestItemsTable
                        mode={editShipment ? "edit" : "file"}
                        items={rows}
                        selected={selected}
                        missingFieldsById={missingFieldsById}
                        currency={currency}
                        masterData={md}
                        itemsForBulkEdit={review?.items}
                        onToggleSelected={toggleSelected}
                        onSelectVisible={selectVisible}
                        onDelete={(item) => deleteItems([item.id])}
                        onBulkDelete={(items) => deleteItems(items.map((item) => item.id))}
                        onPatch={patchItem}
                        onBulkPatch={patchItems}
                        onProcessingChange={setTableProcessing}
                      />
                    </div>

                    {/* Pagination & Footer */}
                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-background px-3 py-2 text-xs text-muted-foreground">
                      <span>{filtered.length} rows · {selected.size} selected · Page {page + 1}/{pages}</span>
                      <div className="flex gap-1">
                        <Button size="icon" variant="outline" className="size-7" disabled={page === 0} onClick={() => setPage(v => v - 1)}><ChevronLeft className="size-3.5 rtl:rotate-180" /></Button>
                        <Button size="icon" variant="outline" className="size-7" disabled={page + 1 >= pages} onClick={() => setPage(v => v + 1)}><ChevronRight className="size-3.5 rtl:rotate-180" /></Button>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-muted/10 px-3 py-2.5 sm:px-4">
                      <Button variant="outline" className="h-9" disabled={isProcessing} onClick={() => setStep("shipment")}><ChevronLeft className="size-4 rtl:rotate-180" /> Back to Shipment Info</Button>
                      {confirmationBlocking > 0 && (
                        <span className="me-auto text-[11px] font-medium text-amber-700">{confirmationBlocking} item{confirmationBlocking === 1 ? "" : "s"} need attention.</span>
                      )}
                      <Button className="h-9" disabled={isProcessing} onClick={() => setStep("costs")}>Continue to Shipment Costs <ChevronRight className="size-4 rtl:rotate-180" /></Button>
                    </div>
                  </div>
                ) : step === "costs" ? (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-4 py-4 sm:px-6 lg:px-8">
                      <div className="mx-auto w-full max-w-6xl space-y-4">
                        <div>
                          <h2 className="flex items-center gap-2 text-base font-semibold"><ReceiptText className="size-4 text-primary" /> Shipment Costs</h2>
                          <p className="mt-0.5 text-xs text-muted-foreground">Review customs, freight, insurance, and other shipment-level costs before confirmation.</p>
                        </div>
                        <ShipmentCostEditor
                          items={review.items.map(item => ({
                            id: item.id,
                            label: [item.manufacturer, item.model, item.productName].filter(Boolean).join(" ") || `Row ${item.rowIndex}`,
                            value: item.unitPrice ?? 0,
                            quantity: item.quantity ?? 0,
                          }))}
                          shipmentCurrency={currency}
                          costs={shipmentCosts}
                          onChange={setShipmentCosts}
                          onValidityChange={setShipmentCostsValid}
                        />
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-background px-4 py-3 sm:px-6">
                      <Button variant="outline" className="h-9" disabled={isProcessing} onClick={() => setStep("items")}><ChevronLeft className="size-4 rtl:rotate-180" /> Back to Items</Button>
                      <div className="flex min-w-0 flex-1 justify-end gap-3">
                        {(confirmationBlocking > 0 || confirmationFieldIssues.length > 0) && <span className="hidden self-center text-end text-[11px] text-amber-700 md:block">Complete required fields and resolve issues.</span>}
                        <Button className="h-9" disabled={isProcessing || !shipmentCostsValid || confirmationBlocking > 0 || !shipmentNumber || !supplierId || !shipmentDate || !currency || (arrival === "future" && !expectedArrivalDate)} onClick={() => setConfirmOpen(true)}>
                          {editShipment ? "Save shipment changes" : arrival === "future" ? "Schedule reviewed shipment" : "Confirm and receive inventory"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-4 py-4 sm:px-6 lg:px-8">
                      <div className="mx-auto w-full max-w-5xl space-y-5">
                        <div>
                          <h2 className="text-base font-semibold flex items-center gap-2"><FileText className="size-4 text-primary" /> Shipment Information</h2>
                          <p className="mt-0.5 text-xs text-muted-foreground">Complete shipment details before the final action.</p>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <div><Label className="text-xs font-medium">Shipment number *</Label><Input className={`mt-1 h-9 text-xs ${!shipmentNumber ? "border-amber-500/60" : ""}`} value={shipmentNumber} onChange={e => setShipmentNumber(e.target.value)} /></div>
                          <div><Label className="text-xs font-medium">Supplier *</Label>
                            <Select value={supplierId || "__none"} onValueChange={selectSupplier}>
                              <SelectTrigger className={`mt-1 h-9 text-xs ${!supplierId ? "border-amber-500/60" : ""}`}><SelectValue placeholder={review.supplierName ?? "Select supplier"} /></SelectTrigger>
                              <SelectContent><SelectItem value="__none">Select supplier</SelectItem>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div><Label className="text-xs">Invoice</Label><Input className="mt-1 h-9 text-xs" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} /></div>
                          <div><Label className="text-xs">Manifest</Label><Input className="mt-1 h-9 text-xs" value={manifestNumber} onChange={e => setManifestNumber(e.target.value)} /></div>
                          <div><Label className="text-xs font-medium">Shipment date *</Label><DatePicker className={`mt-1 h-9 text-xs ${!shipmentDate ? "border-amber-500/60" : ""}`} value={shipmentDate} onChange={setShipmentDate} required /></div>
                          <div><Label className="text-xs font-medium">Currency *</Label>
                            <Select value={currency} onValueChange={setCurrency}>
                              <SelectTrigger className={`mt-1 h-9 text-xs ${!currency ? "border-amber-500/60" : ""}`}><SelectValue /></SelectTrigger>
                              <SelectContent>{activeCurrencies.map(c => <SelectItem key={c.isoCode} value={c.isoCode}>{c.isoCode} — {currencyPresentation(c.isoCode).name}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div><Label className="text-xs">Origin</Label><Input className="mt-1 h-9 text-xs" value={origin} onChange={e => setOrigin(e.target.value)} /></div>
                          <div><Label className="text-xs">Destination</Label><Input className="mt-1 h-9 text-xs" value={destination} onChange={e => setDestination(e.target.value)} /></div>
                        </div>

                        <Card>
                          <CardHeader className="pb-3"><CardTitle className="text-sm">{editShipment ? "Shipment schedule" : "Arrival workflow"}</CardTitle></CardHeader>
                          <CardContent className="grid gap-4 md:grid-cols-2">
                            {!editShipment && <div><Select value={arrival} onValueChange={v => setArrival(v as typeof arrival)}><SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="future">Schedule — no inventory change</SelectItem><SelectItem value="arrived_now">Receive into inventory now</SelectItem></SelectContent></Select></div>}
                            {arrival === "future" && <div><Label className="text-xs font-medium">Expected arrival *</Label><DatePicker className={`mt-1 h-9 text-xs ${!expectedArrivalDate ? "border-amber-500/60" : ""}`} value={expectedArrivalDate} onChange={setExpectedArrivalDate} min={shipmentDate} required /></div>}
                            <div className="md:col-span-2"><Label className="text-xs">Note</Label><Textarea className="mt-1 min-h-20 text-xs" value={note} onChange={e => setNote(e.target.value)} /></div>
                          </CardContent>
                        </Card>

                        <div className="rounded-xl border bg-background p-4">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div><h3 className="text-sm font-semibold">Validation & confirmation</h3><p className="text-[10px] text-muted-foreground">Existing validation rules are unchanged.</p></div>
                            <Badge variant={confirmationBlocking || confirmationFieldIssues.length ? "destructive" : "outline"}>{confirmationBlocking || confirmationFieldIssues.length ? "Action required" : "Ready"}</Badge>
                          </div>
                          {confirmationBlocking > 0 || confirmationFieldIssues.length > 0 ? (
                            <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                              {confirmationFieldIssues.map(issue => <div key={issue} className="flex items-start gap-2 text-amber-800"><XCircle className="mt-0.5 size-3.5 shrink-0" /><span>{issue}</span></div>)}
                              {structuralBlocking > 0 && <div className="flex items-start gap-2 text-red-700"><XCircle className="mt-0.5 size-3.5 shrink-0" /><span>Resolve {structuralBlocking} structurally invalid or conflicting row(s).</span></div>}
                              {structuralBlocking === 0 && receiptRequirements > 0 && !editShipment && arrival === "arrived_now" && <div className="flex items-start gap-2 text-red-700"><XCircle className="mt-0.5 size-3.5 shrink-0" /><span>Complete {receiptRequirements} item requirement(s).</span></div>}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700"><CheckCircle2 className="size-4 shrink-0" /><span>{editShipment ? "Ready to save shipment changes." : arrival === "future" ? "Ready to schedule." : "Ready for inventory receipt."}</span></div>
                          )}
                        </div>

                        <div className="rounded-lg bg-muted p-3 text-[10px] leading-relaxed text-muted-foreground">
                          <div>SHA-256: {review.fileHash.slice(0, 20)}…</div>
                          <div>Schema: {review.schemaVersion} · Prompt: {review.promptVersion ?? "—"}</div>
                          <div>Saved: {new Date(review.updatedAt).toLocaleString()}</div>
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t bg-background px-4 py-3 sm:px-6">
                      <Button className="h-9" disabled={isProcessing || confirmationFieldIssues.length > 0} onClick={() => setStep("items")}>Continue to Review Items <ChevronRight className="size-4 rtl:rotate-180" /></Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-primary" />
              {editShipment ? "Confirm shipment changes" : arrival === "future" ? "Schedule reviewed shipment" : "Confirm inventory receipt"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-3">
              <span>Total units</span><strong>{totalQuantity}</strong>
              <span>Weapons</span><strong>{weaponQuantity}</strong>
              <span>Accessories</span><strong>{accessoryQuantity}</strong>
              <span>Ammunition</span><strong>{ammunitionQuantity}</strong>
            </div>

            {!editShipment && arrival === "arrived_now" && (
              <div className="rounded-lg border p-3">
                <div className="font-medium">Transaction currency: {currency}</div>
                <div className="text-xs text-muted-foreground">
                  Prices retain their item currency and receive immutable accounting valuations.
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {editShipment
                ? "This updates the pre-receipt shipment and keeps inventory unchanged."
                : arrival === "future"
                  ? "This creates a scheduled shipment only. Inventory will not change until arrival is confirmed."
                  : "This creates the shipment, inventory records, valuation snapshots, audit logs, and notifications in one transaction."}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={() => void confirm()}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {editShipment ? "Save changes" : arrival === "future" ? "Schedule" : "Receive inventory"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(value) => !value && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-sm">
              <Trash2 className="size-4 text-destructive" />
              Delete this unconfirmed review?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.fileName} and all extracted rows, source document data, validation issues, and review changes will be permanently removed. No inventory or shipment record has been created.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep review</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={saving}
              onClick={(event) => {
                event.preventDefault()
                void deleteReview()
              }}
            >
              Delete review
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
