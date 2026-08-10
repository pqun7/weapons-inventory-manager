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
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
  X,
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
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { DatePicker } from "@/components/ui/date-picker"
import { useDynamicMasterData } from "@/hooks/use-dynamic-master-data"
import {
  confidenceLevel,
  type ManifestDetailsPatch,
  type ManifestItemPatch,
  type ManifestProgress,
  type ManifestReviewItem,
  type ManifestReviewSummary,
  type ShipmentManifestReview,
} from "@/lib/shipment-manifest"
import { useStore } from "@/lib/store"
import { useCurrency } from "@/lib/currency-context"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete?: () => void
}

const PAGE_SIZE = 50

type ManifestStep = "items" | "shipment"

const ACCEPT = ".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.webp"

function averageConfidence(item: ManifestReviewItem): number {
  const relevant = [
    "productName",
    "productType",
    "quantity",
    "serialNumber",
    "manufacturer",
    "model",
    "caliber",
  ]
    .map((field) => item.confidence[field])
    .filter((value) => Number.isFinite(value))

  return relevant.length
    ? relevant.reduce((sum, value) => sum + value, 0) / relevant.length
    : 0
}

function StatusBadge({
  status,
}: {
  status: ManifestReviewItem["status"]
}) {
  if (status === "valid") {
    return (
      <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
        Valid
      </Badge>
    )
  }

  if (status === "duplicate") {
    return (
      <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-700">
        Duplicate
      </Badge>
    )
  }

  if (status === "conflict") {
    return (
      <Badge className="border-red-500/30 bg-red-500/10 text-red-700">
        Conflict
      </Badge>
    )
  }

  if (status === "invalid") {
    return (
      <Badge className="border-red-500/30 bg-red-500/10 text-red-700">
        Invalid
      </Badge>
    )
  }

  return (
    <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-700">
      Review
    </Badge>
  )
}

function ConfidenceBadge({ item }: { item: ManifestReviewItem }) {
  const score = averageConfidence(item)
  const level = confidenceLevel(score)

  return (
    <Badge
      variant="outline"
      className={
        level === "high"
          ? "border-emerald-500/30 text-emerald-700"
          : level === "medium"
            ? "border-amber-500/30 text-amber-700"
            : "border-red-500/30 text-red-700"
      }
    >
      {Math.round(score * 100)}%
    </Badge>
  )
}

function aiProviderLabel(
  provider: string | null,
  model: string | null,
): string {
  if (provider === "openai") return model ? `OpenAI · ${model}` : "OpenAI"
  if (provider === "deepseek") {
    return model ? `DeepSeek · ${model}` : "DeepSeek"
  }
  return "Native extraction"
}

function InlineCell({
  value,
  placeholder = "—",
  type = "text",
  className = "",
  disabled,
  onCommit,
}: {
  value: string | number | null
  placeholder?: string
  type?: "text" | "number"
  className?: string
  disabled?: boolean
  onCommit: (value: string | number | null) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value == null ? "" : String(value))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(value == null ? "" : String(value))
  }, [editing, value])

  const commit = async () => {
    if (busy) return

    const next =
      draft.trim() === ""
        ? null
        : type === "number"
          ? Number(draft)
          : draft.trim()

    if ((next ?? "") === (value ?? "")) {
      setEditing(false)
      return
    }

    setBusy(true)

    try {
      await onCommit(next)
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <Input
        autoFocus
        type={type}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "any" : undefined}
        className={`h-8 min-w-0 px-1.5 text-[10px] ${className}`}
        value={draft}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            void commit()
          }

          if (event.key === "Escape") {
            setDraft(value == null ? "" : String(value))
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setEditing(true)}
      title="Click to edit"
      className={`min-h-8 w-full min-w-0 truncate rounded-md px-1.5 py-1 text-start text-[10px] transition-colors hover:bg-primary/5 hover:ring-1 hover:ring-primary/20 disabled:cursor-default ${className}`}
    >
      {value == null || value === "" ? (
        <span className="text-muted-foreground">{placeholder}</span>
      ) : (
        value
      )}
    </button>
  )
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string
  value: number
  tone?: "default" | "good" | "warn" | "bad"
}) {
  const toneClass =
    tone === "good"
      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700"
      : tone === "warn"
        ? "border-amber-500/30 bg-amber-500/5 text-amber-700"
        : tone === "bad"
          ? "border-red-500/30 bg-red-500/5 text-red-700"
          : ""

  return (
    <div
      className={`min-w-[68px] rounded-md border px-2 py-1.5 ${toneClass}`}
    >
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-bold tabular-nums">{value}</div>
    </div>
  )
}

export function ShipmentManifestImportDialog({
  open,
  onOpenChange,
  onComplete,
}: Props) {
  const currentUser = useStore((state) => state.getCurrentUser())
  const suppliers = useStore((state) => state.suppliers)
  const settings = useStore((state) => state.settings)
  const refreshFromDb = useStore((state) => state.refreshFromDb)
  const md = useDynamicMasterData()
  const {
    currencies,
    transactionCurrency,
    currencyPresentation,
  } = useCurrency()

  const activeCurrencies = useMemo(
    () => currencies.filter((item) => item.isActive),
    [currencies],
  )

  const fileRef = useRef<HTMLInputElement>(null)
  const detailsLoaded = useRef(false)

  const [progress, setProgress] = useState<ManifestProgress | null>(null)
  const [review, setReview] =
    useState<ShipmentManifestReview | null>(null)
  const [recent, setRecent] = useState<ManifestReviewSummary[]>([])
  const [loadingRecent, setLoadingRecent] = useState(false)
  const [search, setSearch] = useState("")
  const [problemsOnly, setProblemsOnly] = useState(false)
  const [sort, setSort] = useState<
    "row" | "product" | "status" | "confidence"
  >("row")
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] =
    useState<ManifestReviewItem | null>(null)
  const [draft, setDraft] = useState<ManifestItemPatch>({})
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkDraft, setBulkDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] =
    useState<ManifestReviewSummary | null>(null)
  const [arrival, setArrival] =
    useState<"arrived_now" | "future">("future")
  const [step, setStep] = useState<ManifestStep>("items")

  const today = new Date().toISOString().slice(0, 10)

  const [shipmentNumber, setShipmentNumber] = useState("")
  const [supplierId, setSupplierId] = useState("")
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [manifestNumber, setManifestNumber] = useState("")
  const [shipmentDate, setShipmentDate] = useState(today)
  const [expectedArrivalDate, setExpectedArrivalDate] =
    useState(today)
  const [origin, setOrigin] = useState("")
  const [destination, setDestination] = useState("")
  const [currency, setCurrency] = useState(transactionCurrency)
  const [note, setNote] = useState("")
  const [autosaveState, setAutosaveState] =
    useState<"saved" | "saving" | "error">("saved")
  const [showWarning, setShowWarning] = useState(true);

  useEffect(() => {
    // استخدمنا ? للتأكد من وجود review أولاً
    if (review?.processingWarning && showWarning) {
      const timer = setTimeout(() => {
        setShowWarning(false);
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [review?.processingWarning, showWarning]);

  const actor = {
    id: currentUser.id,
    name: currentUser.name,
  }

  const loadRecent = async () => {
    const api = window.electronAPI?.manifest
    if (!api) return

    setLoadingRecent(true)

    try {
      const result = await api.list(30, actor)

      if (!result.success || !result.data) {
        throw new Error(
          result.error ?? "Unable to load saved reviews",
        )
      }

      setRecent(result.data)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to load saved reviews",
      )
    } finally {
      setLoadingRecent(false)
    }
  }

  useEffect(() => {
    if (!open || !window.electronAPI?.manifest) return

    void loadRecent()

    return window.electronAPI.manifest.onProgress(setProgress)

    // actor is intentionally resolved when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const loadReview = (next: ShipmentManifestReview) => {
    detailsLoaded.current = false
    setReview(next)
    setShipmentNumber(next.shipmentNumber ?? "")

    const supplier = suppliers.find(
      (candidate) =>
        candidate.id === next.supplierId ||
        candidate.name.toLowerCase() ===
        next.supplierName?.toLowerCase(),
    )

    setSupplierId(supplier?.id ?? "")
    setInvoiceNumber(next.invoiceNumber ?? "")
    setManifestNumber(next.manifestNumber ?? "")
    setShipmentDate(next.shipmentDate ?? today)
    setExpectedArrivalDate(next.expectedArrivalDate ?? today)
    setOrigin(next.origin ?? "")
    setDestination(next.destination ?? "")

    setCurrency(
      next.currency &&
        activeCurrencies.some(
          (item) => item.isoCode === next.currency,
        )
        ? next.currency
        : transactionCurrency,
    )

    setNote(next.reviewNote ?? "")
    setSelected(new Set())
    setPage(0)
    setStep("items")

    setTimeout(() => {
      detailsLoaded.current = true
    }, 0)
  }

  const openSavedReview = async (importId: string) => {
    const api = window.electronAPI?.manifest
    if (!api) return

    setSaving(true)

    try {
      const result = await api.get(importId, actor)

      if (!result.success || !result.data) {
        throw new Error(result.error ?? "Unable to open review")
      }

      loadReview(result.data)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to open review",
      )
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const api = window.electronAPI?.manifest

    if (
      !open ||
      !review ||
      review.status !== "pending_review" ||
      !detailsLoaded.current ||
      !api
    ) {
      return
    }

    const timer = setTimeout(async () => {
      const supplier = suppliers.find(
        (item) => item.id === supplierId,
      )

      const patch: ManifestDetailsPatch = {
        shipmentNumber: shipmentNumber || null,
        supplierId: supplierId || null,
        supplierName:
          supplier?.name ?? review.supplierName,
        invoiceNumber: invoiceNumber || null,
        manifestNumber: manifestNumber || null,
        shipmentDate: shipmentDate || null,
        expectedArrivalDate:
          expectedArrivalDate || null,
        origin: origin || null,
        destination: destination || null,
        currency: currency || null,
        reviewNote: note || null,
      }

      setAutosaveState("saving")

      const result = await api.updateDetails(
        review.id,
        patch,
        actor,
      )

      if (result.success && result.data) {
        setReview(result.data)
        setAutosaveState("saved")
      } else {
        setAutosaveState("error")
      }
    }, 700)

    return () => clearTimeout(timer)

    // review identity is enough; field values are the autosave inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currency,
    destination,
    expectedArrivalDate,
    invoiceNumber,
    manifestNumber,
    note,
    open,
    origin,
    review?.id,
    shipmentDate,
    shipmentNumber,
    supplierId,
  ])

  const handleFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    event.target.value = ""

    if (!file) return

    const api = window.electronAPI?.manifest

    if (!api) {
      toast.error(
        "Manifest import is available in the desktop application only",
      )
      return
    }

    setReview(null)
    setProgress({
      stage: "uploading",
      percent: 1,
      message: "Preparing document",
    })

    try {
      const result = await api.upload(
        {
          fileName: file.name,
          mimeType: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
        },
        actor,
      )

      if (!result.success || !result.data) {
        throw new Error(
          result.error ?? "Unable to process manifest",
        )
      }

      setProgress(null)
      loadReview(result.data)

      if (result.data.duplicateOf) {
        toast.warning(
          "An existing review for this document was opened",
        )
      } else {
        toast.success("Manifest is ready for review")
      }

      void loadRecent()
    } catch (error) {
      setProgress(null)

      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to extract shipment data",
      )
    }
  }

  const filtered = useMemo(() => {
    if (!review) return []

    const query = search.trim().toLowerCase()

    const result = review.items.filter((item) => {
      if (
        problemsOnly &&
        item.status === "valid" &&
        !item.issues.some(
          (issue) => issue.details?.blocksReceipt === true,
        )
      ) {
        return false
      }

      if (!query) return true

      return [
        item.productName,
        item.manufacturer,
        item.model,
        item.caliber,
        item.sku,
        ...item.serialNumbers,
      ].some((value) =>
        value?.toLowerCase().includes(query),
      )
    })

    return [...result].sort((a, b) => {
      if (sort === "product") {
        return (a.productName ?? "").localeCompare(
          b.productName ?? "",
        )
      }

      if (sort === "status") {
        return a.status.localeCompare(b.status)
      }

      if (sort === "confidence") {
        return (
          averageConfidence(a) - averageConfidence(b)
        )
      }

      return a.rowIndex - b.rowIndex
    })
  }, [problemsOnly, review, search, sort])

  const pages = Math.max(
    1,
    Math.ceil(filtered.length / PAGE_SIZE),
  )

  const rows = filtered.slice(
    page * PAGE_SIZE,
    page * PAGE_SIZE + PAGE_SIZE,
  )

  useEffect(() => {
    if (page >= pages) {
      setPage(Math.max(0, pages - 1))
    }
  }, [page, pages])

  const patchItem = async (
    item: ManifestReviewItem,
    patch: ManifestItemPatch,
  ) => {
    const api = window.electronAPI?.manifest

    if (!review || !api) return

    const result = await api.updateItem(
      review.id,
      item.id,
      patch,
      actor,
    )

    if (!result.success || !result.data) {
      toast.error(
        result.error ?? "Unable to save item",
      )
      throw new Error(result.error)
    }

    setReview(result.data)
  }

  const openEdit = (item: ManifestReviewItem) => {
    setEditing(item)

    setDraft({
      productType: item.productType,
      productName: item.productName,
      weaponType: item.weaponType,
      category: item.category,
      manufacturer: item.manufacturer,
      model: item.model,
      caliber: item.caliber,
      sku: item.sku,
      serialNumbers: item.serialNumbers,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      currency: item.currency,
      storageLocationId: item.storageLocationId,
    })
  }

  const saveEdit = async () => {
    if (!editing) return

    setSaving(true)

    try {
      await patchItem(editing, draft)
      setEditing(null)
      toast.success("Item saved and revalidated")
    } finally {
      setSaving(false)
    }
  }

  const applyBulk = async () => {
    const api = window.electronAPI?.manifest

    if (!review || !api || selected.size === 0) return

    const patch: ManifestItemPatch = {}

    if (
      bulkDraft.productType &&
      bulkDraft.productType !== "__unchanged"
    ) {
      patch.productType =
        bulkDraft.productType as ManifestItemPatch["productType"]
    }

    if (bulkDraft.manufacturer) {
      patch.manufacturer = bulkDraft.manufacturer
    }

    if (bulkDraft.weaponType) {
      patch.weaponType = bulkDraft.weaponType
    }

    if (bulkDraft.category) {
      patch.category = bulkDraft.category
    }

    if (bulkDraft.model) {
      patch.model = bulkDraft.model
    }

    if (bulkDraft.caliber) {
      patch.caliber = bulkDraft.caliber
    }

    if (bulkDraft.unitPrice) {
      patch.unitPrice = Number(bulkDraft.unitPrice)
    }

    if (
      bulkDraft.currency &&
      bulkDraft.currency !== "__unchanged"
    ) {
      patch.currency = bulkDraft.currency
    }

    for (const field of ["storageLocationId"] as const) {
      if (
        bulkDraft[field] &&
        bulkDraft[field] !== "__unchanged"
      ) {
        patch[field] = bulkDraft[field]
      }
    }

    if (Object.keys(patch).length === 0) {
      toast.error("Choose at least one field to update")
      return
    }

    setSaving(true)

    try {
      const result = await api.updateItems(
        review.id,
        [...selected],
        patch,
        actor,
      )

      if (!result.success || !result.data) {
        throw new Error(
          result.error ??
          "Unable to update selected items",
        )
      }

      setReview(result.data)
      setBulkOpen(false)
      setBulkDraft({})

      toast.success(
        `${selected.size} items updated and revalidated`,
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to update selected items",
      )
    } finally {
      setSaving(false)
    }
  }

  const deleteReview = async () => {
    if (
      !deleteTarget ||
      !window.electronAPI?.manifest
    ) {
      return
    }

    setSaving(true)

    try {
      const result =
        await window.electronAPI.manifest.deleteReview(
          deleteTarget.id,
          actor,
        )

      if (!result.success) {
        throw new Error(
          result.error ?? "Unable to delete review",
        )
      }

      setDeleteTarget(null)
      await loadRecent()
      toast.success("Unconfirmed review deleted")
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to delete review",
      )
    } finally {
      setSaving(false)
    }
  }

  const structuralBlocking = review
    ? review.validationSummary.invalid +
    review.validationSummary.duplicate +
    review.validationSummary.conflict
    : 0

  const receiptRequirements =
    review?.issues.filter(
      (issue) => issue.details?.blocksReceipt === true && issue.code !== "MASTER_DATA_MAPPING_REQUIRED",
    ).length ?? 0

  const confirmationBlocking =
    structuralBlocking +
    (arrival === "arrived_now"
      ? receiptRequirements
      : 0)

  const confirmationFieldIssues = [
    !shipmentNumber && "Enter the shipment number.",
    !supplierId && "Select a supplier.",
    !shipmentDate && "Select the shipment date.",
    !currency && "Select the transaction currency.",
    arrival === "future" &&
    !expectedArrivalDate &&
    "Select the expected arrival date.",
  ].filter(
    (issue): issue is string => Boolean(issue),
  )

  const totalQuantity =
    review?.items.reduce(
      (sum, item) => sum + (item.quantity ?? 0),
      0,
    ) ?? 0

  const weaponQuantity =
    review?.items
      .filter((item) => item.productType === "weapon")
      .reduce(
        (sum, item) => sum + (item.quantity ?? 0),
        0,
      ) ?? 0

  const accessoryQuantity =
    review?.items
      .filter((item) => item.productType === "accessory")
      .reduce(
        (sum, item) => sum + (item.quantity ?? 0),
        0,
      ) ?? 0

  const ammunitionQuantity =
    review?.items
      .filter(
        (item) => item.productType === "ammunition",
      )
      .reduce(
        (sum, item) => sum + (item.quantity ?? 0),
        0,
      ) ?? 0

  const confirm = async () => {
    if (
      !review ||
      !window.electronAPI?.manifest
    ) {
      return
    }

    setSaving(true)

    try {
      const result =
        await window.electronAPI.manifest.confirm(
          {
            importId: review.id,
            shipmentNumber,
            supplierId,
            invoiceNumber:
              invoiceNumber || null,
            manifestNumber:
              manifestNumber || null,
            shipmentDate,
            expectedArrivalDate:
              arrival === "future"
                ? expectedArrivalDate
                : null,
            origin: origin || null,
            destination: destination || null,
            currency,
            arrival,
            note: note || null,
          },
          actor,
        )

      if (!result.success || !result.data) {
        throw new Error(
          result.error ??
          "Unable to confirm shipment",
        )
      }

      setReview(result.data)
      setConfirmOpen(false)
      await refreshFromDb()
      onComplete?.()

      toast.success(
        arrival === "future"
          ? "Shipment scheduled without changing inventory"
          : "Shipment received into inventory",
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to confirm shipment",
      )
    } finally {
      setSaving(false)
    }
  }

  const allVisibleSelected =
    rows.length > 0 &&
    rows.every((item) => selected.has(item.id))



  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
      >
        <DialogContent className="flex h-[94vh] max-h-[94vh] w-[calc(100vw-1.5rem)] max-w-[1800px] flex-col overflow-hidden p-0 sm:w-[calc(100vw-2rem)]">
          <DialogHeader className="shrink-0 border-b bg-background/95 px-4 py-3 backdrop-blur sm:px-5">
            <div className="flex min-h-10 items-center justify-between gap-3 pe-8">
              <div className="flex min-w-0 items-center gap-2">
                {review && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 shrink-0"
                    onClick={() => {
                      setReview(null)
                      setEditing(null)
                      void loadRecent()
                    }}
                  >
                    <ArrowLeft className="size-4 rtl:rotate-180" />
                  </Button>
                )}

                <FileSearch className="size-5 shrink-0 text-primary" />

                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <DialogTitle className="truncate">
                      {review
                        ? review.fileName
                        : "Shipment manifest workspace"}
                    </DialogTitle>

                    {review && (
                      <Badge
                        variant="outline"
                        className={
                          review.aiProvider === "deepseek"
                            ? "h-5 shrink-0 border-blue-500/30 bg-blue-500/10 px-1.5 text-[9px] text-blue-700"
                            : review.aiProvider === "openai"
                              ? "h-5 shrink-0 border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[9px]"
                              : "h-5 shrink-0 px-1.5 text-[9px]"
                        }
                      >
                        <Sparkles className="me-1 size-2.5" />
                        {aiProviderLabel(
                          review.aiProvider,
                          review.aiModel,
                        )}
                      </Badge>
                    )}
                  </div>

                  <p className="text-[11px] text-muted-foreground">
                    {review
                      ? "Review is stored in the database until you confirm or delete it"
                      : "Upload a new document or continue a saved review"}
                  </p>
                </div>
              </div>

              {review && (
                <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                  <Clock3 className="size-3.5" />
                  {autosaveState === "saving" ? (
                    "Saving…"
                  ) : autosaveState === "error" ? (
                    <span className="text-red-600">
                      Autosave failed
                    </span>
                  ) : (
                    "All changes saved"
                  )}
                </div>
              )}
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {!review ? (
              <div className="grid min-h-full gap-0 lg:grid-cols-[minmax(420px,0.9fr)_minmax(520px,1.1fr)]">
                <div className="flex min-h-[420px] items-center justify-center border-e p-5 sm:p-8">
                  {progress ? (
                    <Card className="w-full max-w-xl">
                      <CardContent className="space-y-4 p-6">
                        <div className="flex items-center gap-3">
                          <Loader2 className="size-5 animate-spin text-primary" />
                          <div>
                            <div className="font-medium">
                              Processing manifest
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {progress.message}
                            </div>
                          </div>
                        </div>

                        <Progress value={progress.percent} />

                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>
                            {progress.stage.replace(
                              "_",
                              " ",
                            )}
                          </span>
                          <span>
                            {progress.percent}%
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border border-dashed p-8 text-center sm:p-10">
                      <div className="rounded-full bg-primary/10 p-4">
                        <Upload className="size-8 text-primary" />
                      </div>

                      <div>
                        <h3 className="text-lg font-semibold">
                          Upload shipment manifest
                        </h3>

                        <p className="mt-1 text-sm text-muted-foreground">
                          Excel, CSV, PDF, or scanned image.
                          Extraction never changes inventory.
                        </p>
                      </div>

                      <Button
                        size="lg"
                        onClick={() =>
                          fileRef.current?.click()
                        }
                      >
                        <Upload className="size-4" />
                        Choose document
                      </Button>

                      <p className="text-xs text-muted-foreground">
                        Maximum 30 MB · Arabic and English ·
                        AI runs only in Electron Main
                      </p>
                    </div>
                  )}

                  <input
                    ref={fileRef}
                    type="file"
                    accept={ACCEPT}
                    className="hidden"
                    onChange={handleFile}
                  />
                </div>

                <div className="flex flex-col bg-muted/10">
                  <div className="flex items-center justify-between border-b px-5 py-3">
                    <div>
                      <h3 className="font-semibold">
                        Saved reviews
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Continue exactly where you stopped
                      </p>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void loadRecent()
                      }
                      disabled={loadingRecent}
                    >
                      <RefreshCw
                        className={`size-3.5 ${loadingRecent
                          ? "animate-spin"
                          : ""
                          }`}
                      />
                      Refresh
                    </Button>
                  </div>

                  <div className="p-4 sm:p-5">
                    {recent.length === 0 &&
                      !loadingRecent ? (
                      <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-muted-foreground">
                        <Layers3 className="size-10 opacity-30" />
                        <p className="text-sm">
                          No saved reviews
                        </p>
                      </div>
                    ) : (
                      <div className="grid gap-3 xl:grid-cols-2">
                        {recent.map((item) => {
                          const blocking =
                            item.validationSummary.invalid +
                            item.validationSummary
                              .duplicate +
                            item.validationSummary
                              .conflict

                          return (
                            <Card
                              key={item.id}
                              className="transition-colors hover:border-primary/40"
                            >
                              <CardContent className="space-y-3 p-4">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div
                                      className="truncate text-sm font-semibold"
                                      title={item.fileName}
                                    >
                                      {item.fileName}
                                    </div>

                                    <div className="mt-1 text-[10px] text-muted-foreground">
                                      {new Date(
                                        item.updatedAt,
                                      ).toLocaleString()}{" "}
                                      ·{" "}
                                      {aiProviderLabel(
                                        item.aiProvider,
                                        null,
                                      )}
                                    </div>
                                  </div>

                                  <Badge variant="outline">
                                    {item.status.replace(
                                      "_",
                                      " ",
                                    )}
                                  </Badge>
                                </div>

                                <div className="grid grid-cols-3 gap-2 text-center">
                                  <div className="rounded bg-muted p-2">
                                    <div className="text-[9px] text-muted-foreground">
                                      Rows
                                    </div>
                                    <div className="font-bold">
                                      {item.itemCount}
                                    </div>
                                  </div>

                                  <div className="rounded bg-emerald-500/5 p-2">
                                    <div className="text-[9px] text-muted-foreground">
                                      Valid
                                    </div>
                                    <div className="font-bold text-emerald-700">
                                      {
                                        item
                                          .validationSummary
                                          .valid
                                      }
                                    </div>
                                  </div>

                                  <div className="rounded bg-red-500/5 p-2">
                                    <div className="text-[9px] text-muted-foreground">
                                      Blocking
                                    </div>
                                    <div className="font-bold text-red-700">
                                      {blocking}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex gap-2">
                                  <Button
                                    className="flex-1"
                                    size="sm"
                                    onClick={() =>
                                      void openSavedReview(
                                        item.id,
                                      )
                                    }
                                  >
                                    Continue review
                                  </Button>

                                  {item.status !==
                                    "processing" && (
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        className="size-8 text-red-600"
                                        onClick={() =>
                                          setDeleteTarget(
                                            item,
                                          )
                                        }
                                      >
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
                <div className="shrink-0 border-b bg-background px-4 py-2.5 sm:px-5">
                  <div className="flex min-w-0 items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${step === "items" ? "bg-primary text-primary-foreground" : "bg-emerald-500/10 text-emerald-700"}`}>
                        {step === "items" ? "1" : <CheckCircle2 className="size-4" />}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold">Review Items</div>
                        <div className="hidden text-[10px] text-muted-foreground sm:block">Review, edit, and resolve extracted rows</div>
                      </div>
                      <div className="h-px w-8 bg-border sm:w-12" />
                      <div className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${step === "shipment" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                        2
                      </div>
                      <div className="min-w-0">
                        <div className={`truncate text-xs font-semibold ${step === "shipment" ? "text-foreground" : "text-muted-foreground"}`}>Shipment Information</div>
                        <div className="hidden text-[10px] text-muted-foreground sm:block">Complete shipment details and confirmation</div>
                      </div>
                    </div>

                    <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
                      Step {step === "items" ? "1" : "2"} of 2
                    </Badge>
                  </div>
                </div>

                {step === "items" ? (
                  <div className="flex min-h-0 flex-1 flex-col">
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

                    {/* أضفنا علامة الاستفهام هنا أيضاً */}
                    {review?.processingWarning && showWarning && (
                      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 sm:px-4">

                        <div className="flex items-center gap-2 overflow-hidden">
                          <AlertTriangle className="size-3.5 shrink-0" />
                          <span className="truncate">{review.processingWarning}</span>
                        </div>

                        <button
                          onClick={() => setShowWarning(false)}
                          className="shrink-0 rounded p-1 hover:bg-amber-500/20 transition-colors focus:outline-none"
                          aria-label="إغلاق"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    )}

                    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background px-3 py-2.5 sm:px-4">
                      <div className="relative min-w-0 flex-1 basis-60">
                        <Search className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={search}
                          onChange={(event) => {
                            setSearch(event.target.value)
                            setPage(0)
                          }}
                          placeholder="Search product, serial, model, caliber or SKU…"
                          className="h-8 ps-8 text-xs"
                        />
                      </div>

                      <Button
                        size="sm"
                        variant={problemsOnly ? "default" : "outline"}
                        className="h-8 shrink-0 text-xs"
                        onClick={() => {
                          setProblemsOnly((value) => !value)
                          setPage(0)
                        }}
                      >
                        <Filter className="size-3.5" />
                        <span className="hidden sm:inline">Needs attention</span>
                        <span className="sm:hidden">Attention</span>
                      </Button>

                      <Select value={sort} onValueChange={(value) => setSort(value as typeof sort)}>
                        <SelectTrigger className="h-8 w-32 shrink-0 text-xs sm:w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="row">Source order</SelectItem>
                          <SelectItem value="product">Product</SelectItem>
                          <SelectItem value="status">Status</SelectItem>
                          <SelectItem value="confidence">Lowest confidence</SelectItem>
                        </SelectContent>
                      </Select>

                      {selected.size > 0 && (
                        <Button size="sm" className="h-8 shrink-0 text-xs" onClick={() => setBulkOpen(true)}>
                          <Layers3 className="size-3.5" />
                          Edit {selected.size}
                        </Button>
                      )}
                    </div>

                    <div className="min-h-0 flex-1 overflow-hidden">
                      <div className="h-full overflow-auto">
                        <div className="min-w-[1180px] w-full">
                          <div className="sticky top-0 z-20 grid grid-cols-[32px_36px_52px_86px_minmax(120px,1.6fr)_minmax(80px,1fr)_minmax(80px,1fr)_minmax(70px,.8fr)_48px_minmax(100px,1.2fr)_88px_84px_68px] items-center gap-1 border-b bg-muted/95 px-2 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground shadow-sm backdrop-blur">
                            <Checkbox
                              checked={allVisibleSelected}
                              onCheckedChange={(checked) => {
                                setSelected((current) => {
                                  const next = new Set(current)
                                  for (const item of rows) {
                                    checked ? next.add(item.id) : next.delete(item.id)
                                  }
                                  return next
                                })
                              }}
                            />
                            <span>Action</span>
                            <span>Src</span>
                            <span>Type</span>
                            <span>Product</span>
                            <span>Maker</span>
                            <span>Model</span>
                            <span>Caliber</span>
                            <span>Qty</span>
                            <span>Serials</span>
                            <span>Price</span>
                            <span>Status</span>
                            <span>Conf.</span>
                          </div>

                          {rows.map((item) => (
                            <div
                              key={item.id}
                              className={`grid grid-cols-[32px_36px_52px_86px_minmax(120px,1.6fr)_minmax(80px,1fr)_minmax(80px,1fr)_minmax(70px,.8fr)_48px_minmax(100px,1.2fr)_88px_84px_68px] items-center gap-1 border-b px-2 py-1 ${selected.has(item.id) ? "bg-primary/[0.04]" : item.status !== "valid" ? "bg-amber-500/[0.035]" : "hover:bg-muted/20"}`}
                            >
                              <Checkbox
                                checked={selected.has(item.id)}
                                onCheckedChange={(checked) =>
                                  setSelected((current) => {
                                    const next = new Set(current)
                                    checked ? next.add(item.id) : next.delete(item.id)
                                    return next
                                  })
                                }
                              />

                              <Button size="icon" variant="ghost" className="size-7" onClick={() => openEdit(item)} title="Edit row">
                                <Pencil className="size-3.5" />
                              </Button>

                              <button type="button" onClick={() => openEdit(item)} className="min-w-0 truncate text-start font-mono text-[9px] text-muted-foreground hover:text-primary" title={`${item.source.sheet ?? "document"}:${item.source.row ?? "—"}`}>
                                #{item.rowIndex} · {item.source.sheet ?? "—"}:{item.source.row ?? "—"}
                              </button>

                              <Select
                                value={item.productType ?? "__none"}
                                onValueChange={(value) => void patchItem(item, { productType: value === "__none" ? null : (value as ManifestItemPatch["productType"]) })}
                              >
                                <SelectTrigger className="h-8 min-w-0 px-2 text-[10px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none">Unmapped</SelectItem>
                                  <SelectItem value="weapon">Weapon</SelectItem>
                                  <SelectItem value="ammunition">Ammunition</SelectItem>
                                  <SelectItem value="accessory">Accessory</SelectItem>
                                </SelectContent>
                              </Select>

                              <InlineCell value={item.productName} onCommit={(value) => patchItem(item, { productName: value as string | null })} className="font-medium" />
                              <InlineCell value={item.manufacturer} onCommit={(value) => patchItem(item, { manufacturer: value as string | null })} />
                              <InlineCell value={item.model} onCommit={(value) => patchItem(item, { model: value as string | null })} />
                              <InlineCell value={item.caliber} onCommit={(value) => patchItem(item, { caliber: value as string | null })} />
                              <InlineCell value={item.quantity} type="number" onCommit={(value) => patchItem(item, { quantity: value as number | null })} className="text-center tabular-nums" />

                              <button type="button" onClick={() => openEdit(item)} className="min-w-0 truncate rounded-md px-1.5 text-start font-mono text-[9px] hover:bg-primary/5" title={item.serialNumbers.join("\n")}>
                                {item.serialNumbers.length ? (
                                  <span className="truncate">{item.serialNumbers.length} serials</span>
                                ) : (
                                  <span className="text-muted-foreground">No serials</span>
                                )}
                              </button>

                              <div className="flex min-w-0 items-center gap-0.5">
                                <InlineCell value={item.unitPrice} type="number" onCommit={(value) => patchItem(item, { unitPrice: value as number | null })} className="tabular-nums" />
                                <span className="shrink-0 text-[8px] text-muted-foreground">{item.currency ?? currency}</span>
                              </div>


                              <button type="button" onClick={() => openEdit(item)} className="min-w-0 text-start" title={item.issues.map((issue) => issue.message).join("\n")}>
                                <StatusBadge status={item.status} />
                              </button>

                              <div className="min-w-0">
                                <ConfidenceBadge item={item} />
                              </div>

                            </div>
                          ))}

                          {rows.length === 0 && (
                            <div className="p-12 text-center text-sm text-muted-foreground">No matching items</div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-background px-3 py-2 text-xs text-muted-foreground">
                      <span>{filtered.length} rows · {selected.size} selected · Page {page + 1}/{pages}</span>
                      <div className="flex gap-1">
                        <Button size="icon" variant="outline" className="size-7" disabled={page === 0} onClick={() => setPage((value) => value - 1)} title="Previous page">
                          <ChevronLeft className="size-3.5 rtl:rotate-180" />
                        </Button>
                        <Button size="icon" variant="outline" className="size-7" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)} title="Next page">
                          <ChevronRight className="size-3.5 rtl:rotate-180" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center justify-end gap-3 border-t bg-muted/10 px-3 py-2.5 sm:px-4">
                      {confirmationBlocking > 0 && (
                        <span className="me-auto text-[11px] font-medium text-amber-700">
                          {confirmationBlocking} item{confirmationBlocking === 1 ? "" : "s"} need attention before confirmation.
                        </span>
                      )}
                      <Button className="h-9" onClick={() => setStep("shipment")}>
                        Continue to Shipment Information
                        <ChevronRight className="size-4 rtl:rotate-180" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 lg:px-8">
                      <div className="mx-auto w-full max-w-5xl space-y-5">
                        <div>
                          <h2 className="text-base font-semibold">Shipment Information</h2>
                          <p className="mt-0.5 text-xs text-muted-foreground">Complete shipment details before the final action. Changes are autosaved while this review is open.</p>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <Label className="text-xs font-medium">Shipment number <span className="text-destructive">*</span></Label>
                            <Input aria-invalid={!shipmentNumber} className={`mt-1 h-9 text-xs ${!shipmentNumber ? "border-amber-500/60 focus-visible:ring-amber-500/30" : ""}`} value={shipmentNumber} onChange={(event) => setShipmentNumber(event.target.value)} />
                          </div>

                          <div>
                            <Label className="text-xs font-medium">Supplier <span className="text-destructive">*</span></Label>
                            <Select value={supplierId || "__none"} onValueChange={(value) => setSupplierId(value === "__none" ? "" : value)}>
                              <SelectTrigger aria-invalid={!supplierId} className={`mt-1 h-9 text-xs ${!supplierId ? "border-amber-500/60" : ""}`}>
                                <SelectValue placeholder={review.supplierName ?? "Select supplier"} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none">Select supplier</SelectItem>
                                {suppliers.map((supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>

                          <div>
                            <Label className="text-xs">Invoice</Label>
                            <Input className="mt-1 h-9 text-xs" value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} />
                          </div>

                          <div>
                            <Label className="text-xs">Manifest</Label>
                            <Input className="mt-1 h-9 text-xs" value={manifestNumber} onChange={(event) => setManifestNumber(event.target.value)} />
                          </div>

                          <div>
                            <Label className="text-xs font-medium">Shipment date <span className="text-destructive">*</span></Label>
                            <DatePicker aria-invalid={!shipmentDate} className={`mt-1 h-9 text-xs ${!shipmentDate ? "border-amber-500/60 focus-visible:ring-amber-500/30" : ""}`} value={shipmentDate} onChange={setShipmentDate} required />
                          </div>

                          <div>
                            <Label className="text-xs font-medium">Currency <span className="text-destructive">*</span></Label>
                            <Select value={currency} onValueChange={setCurrency}>
                              <SelectTrigger aria-invalid={!currency} className={`mt-1 h-9 text-xs ${!currency ? "border-amber-500/60" : ""}`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {activeCurrencies.map((item) => <SelectItem key={item.isoCode} value={item.isoCode}>{item.isoCode} — {currencyPresentation(item.isoCode).name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">Original item values are preserved. Accounting valuations use {settings.accountingCurrencyCode} at the stored rate.</p>
                          </div>

                          <div>
                            <Label className="text-xs">Origin</Label>
                            <Input className="mt-1 h-9 text-xs" value={origin} onChange={(event) => setOrigin(event.target.value)} />
                          </div>

                          <div>
                            <Label className="text-xs">Destination</Label>
                            <Input className="mt-1 h-9 text-xs" value={destination} onChange={(event) => setDestination(event.target.value)} />
                          </div>
                        </div>

                        <div className="rounded-xl border bg-muted/10 p-4">
                          <div className="mb-3">
                            <Label className="text-xs font-semibold">Arrival workflow</Label>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">Choose whether inventory changes now or only when the shipment arrives.</p>
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <Select value={arrival} onValueChange={(value) => setArrival(value as typeof arrival)}>
                                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="future">Schedule — no inventory change</SelectItem>
                                  <SelectItem value="arrived_now">Receive into inventory now</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            {arrival === "future" && (
                              <div>
                                <Label className="text-xs font-medium">Expected arrival <span className="text-destructive">*</span></Label>
                                <DatePicker aria-invalid={!expectedArrivalDate} className={`mt-1 h-9 text-xs ${!expectedArrivalDate ? "border-amber-500/60 focus-visible:ring-amber-500/30" : ""}`} value={expectedArrivalDate} onChange={setExpectedArrivalDate} min={shipmentDate} required />
                              </div>
                            )}
                          </div>
                          <div className="mt-4">
                            <Label className="text-xs">Note</Label>
                            <Textarea className="mt-1 min-h-20 text-xs" placeholder="Review, arrival, or scheduling note" value={note} onChange={(event) => setNote(event.target.value)} />
                          </div>
                        </div>

                        <div className="rounded-xl border bg-background p-4">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-semibold">Validation & confirmation</h3>
                              <p className="text-[10px] text-muted-foreground">Existing validation rules are unchanged.</p>
                            </div>
                            <Badge variant={confirmationBlocking || confirmationFieldIssues.length ? "destructive" : "outline"}>
                              {confirmationBlocking || confirmationFieldIssues.length ? "Action required" : "Ready"}
                            </Badge>
                          </div>

                          {confirmationBlocking > 0 || confirmationFieldIssues.length > 0 ? (
                            <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                              {confirmationFieldIssues.map((issue) => (
                                <div key={issue} className="flex items-start gap-2 text-amber-800"><XCircle className="mt-0.5 size-3.5 shrink-0" /><span>{issue}</span></div>
                              ))}
                              {structuralBlocking > 0 && (
                                <div className="flex items-start gap-2 text-red-700"><XCircle className="mt-0.5 size-3.5 shrink-0" /><span>Resolve {structuralBlocking} structurally invalid or conflicting row(s).</span></div>
                              )}
                              {structuralBlocking === 0 && receiptRequirements > 0 && arrival === "arrived_now" && (
                                <div className="flex items-start gap-2 text-red-700"><XCircle className="mt-0.5 size-3.5 shrink-0" /><span>Complete {receiptRequirements} receipt requirement(s), such as price or a missing product detail.</span></div>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700">
                              <CheckCircle2 className="size-4 shrink-0" />
                              <span>{arrival === "future" ? "Ready to schedule. Inventory will remain unchanged." : "Ready for one transactional inventory receipt."}</span>
                            </div>
                          )}
                        </div>

                        <div className="rounded-lg bg-muted p-3 text-[10px] leading-relaxed text-muted-foreground">
                          <div>SHA-256: {review.fileHash.slice(0, 20)}…</div>
                          <div>Schema: {review.schemaVersion} · Prompt: {review.promptVersion ?? "—"}</div>
                          <div>Saved: {new Date(review.updatedAt).toLocaleString()}</div>
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-background px-4 py-3 sm:px-6">
                      <Button variant="outline" className="h-9" onClick={() => setStep("items")}>
                        <ChevronLeft className="size-4 rtl:rotate-180" />
                        Back to Items
                      </Button>
                      <div className="flex min-w-0 flex-1 justify-end gap-3">
                        {(confirmationBlocking > 0 || confirmationFieldIssues.length > 0) && (
                          <span className="hidden self-center text-end text-[11px] text-amber-700 md:block">Complete the required fields and resolve blocking issues.</span>
                        )}
                        <Button
                          className="h-9"
                          disabled={confirmationBlocking > 0 || !shipmentNumber || !supplierId || !shipmentDate || !currency || (arrival === "future" && !expectedArrivalDate)}
                          onClick={() => setConfirmOpen(true)}
                        >
                          {arrival === "future" ? "Schedule reviewed shipment" : "Confirm and receive inventory"}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Sheet
        open={Boolean(editing)}
        onOpenChange={(value) =>
          !value && setEditing(null)
        }
      >
        <SheetContent className="w-[560px] overflow-y-auto sm:max-w-[560px]">
          <SheetHeader>
            <SheetTitle>
              Edit row {editing?.rowIndex}
            </SheetTitle>

            {editing && (
              <p className="text-xs text-muted-foreground">
                Source{" "}
                {editing.source.sheet ??
                  "document"}{" "}
                · row{" "}
                {editing.source.row ?? "—"}
              </p>
            )}
          </SheetHeader>

          {editing && (
            <div className="grid gap-3 px-4 pb-6 sm:grid-cols-2">
              <div>
                <Label>Product type</Label>

                <Select
                  value={
                    draft.productType ??
                    "__none"
                  }
                  onValueChange={(value) =>
                    setDraft((state) => ({
                      ...state,
                      productType:
                        value === "__none"
                          ? null
                          : (value as ManifestItemPatch["productType"]),
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="__none">
                      Unmapped
                    </SelectItem>
                    <SelectItem value="weapon">
                      Weapon
                    </SelectItem>
                    <SelectItem value="ammunition">
                      Ammunition
                    </SelectItem>
                    <SelectItem value="accessory">
                      Accessory
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Product name</Label>
                <Input
                  value={draft.productName ?? ""}
                  onChange={(event) =>
                    setDraft((state) => ({
                      ...state,
                      productName:
                        event.target.value ||
                        null,
                    }))
                  }
                />
              </div>

              {draft.productType === "weapon" && (
                <>
                  <div>
                    <Label>Weapon type</Label>
                    <Input
                      list="manifest-weapon-types-edit"
                      placeholder="Example: Blank pistol"
                      value={draft.weaponType ?? ""}
                      onChange={(event) => setDraft((state) => ({ ...state, weaponType: event.target.value || null }))}
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">Matched automatically and saved for future shipments.</p>
                  </div>
                  <div>
                    <Label>Subtype / category <span className="font-normal text-muted-foreground">(optional)</span></Label>
                    <Input
                      list="manifest-weapon-subtypes-edit"
                      placeholder="Example: Semi-auto"
                      value={draft.category ?? ""}
                      onChange={(event) => setDraft((state) => ({ ...state, category: event.target.value || null }))}
                    />
                  </div>
                </>
              )}

              <div>
                <Label>Manufacturer</Label>
                <Input
                  list="manifest-manufacturers-edit"
                  value={draft.manufacturer ?? ""}
                  onChange={(event) =>
                    setDraft((state) => ({
                      ...state,
                      manufacturer:
                        event.target.value ||
                        null,
                    }))
                  }
                />
              </div>

              <div>
                <Label>Model</Label>
                <Input
                  list="manifest-models-edit"
                  value={draft.model ?? ""}
                  onChange={(event) =>
                    setDraft((state) => ({
                      ...state,
                      model:
                        event.target.value ||
                        null,
                    }))
                  }
                />
              </div>

              <div>
                <Label>Caliber</Label>
                <Input
                  list="manifest-calibers-edit"
                  value={draft.caliber ?? ""}
                  onChange={(event) =>
                    setDraft((state) => ({
                      ...state,
                      caliber:
                        event.target.value ||
                        null,
                    }))
                  }
                />
              </div>

              <div>
                <Label>Quantity</Label>
                <Input
                  type="number"
                  min={1}
                  value={draft.quantity ?? ""}
                  onChange={(event) =>
                    setDraft((state) => ({
                      ...state,
                      quantity: event.target.value
                        ? Number(
                          event.target.value,
                        )
                        : null,
                    }))
                  }
                />
              </div>

              <div>
                <Label>Unit purchase price</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.unitPrice ?? ""}
                  onChange={(event) =>
                    setDraft((state) => ({
                      ...state,
                      unitPrice: event.target.value
                        ? Number(
                          event.target.value,
                        )
                        : null,
                    }))
                  }
                />
              </div>

              <div>
                <Label>Currency</Label>

                <Select
                  value={draft.currency ?? currency}
                  onValueChange={(value) =>
                    setDraft((state) => ({
                      ...state,
                      currency: value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    {activeCurrencies.map(
                      (item) => (
                        <SelectItem
                          key={item.isoCode}
                          value={item.isoCode}
                        >
                          {item.isoCode} —{" "}
                          {
                            currencyPresentation(
                              item.isoCode,
                            ).name
                          }
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="sm:col-span-2">
                <Label>
                  Serial numbers — one per line
                </Label>

                <Textarea
                  className="min-h-40 font-mono text-xs"
                  value={(
                    draft.serialNumbers ?? []
                  ).join("\n")}
                  onChange={(event) =>
                    setDraft((state) => ({
                      ...state,
                      serialNumbers:
                        event.target.value
                          .split(/[\n,;]+/)
                          .map((value) =>
                            value.trim(),
                          )
                          .filter(Boolean),
                    }))
                  }
                />
              </div>

              {false && draft.productType ===
                "weapon" && (
                  <>
                    <div>
                      <Label>
                        Weapon type mapping
                      </Label>

                      <Select
                        value={
                          draft.weaponTypeId ??
                          "__none"
                        }
                        onValueChange={(value) =>
                          setDraft((state) => ({
                            ...state,
                            weaponTypeId:
                              value ===
                                "__none"
                                ? null
                                : value,
                            weaponSubtypeId: null,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>

                        <SelectContent>
                          <SelectItem value="__none">
                            Select
                          </SelectItem>

                          {md.weaponTypes.map(
                            (row) => (
                              <SelectItem
                                key={row.id}
                                value={row.id}
                              >
                                {row.label}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>
                        Subtype mapping
                      </Label>

                      <Select
                        value={
                          draft.weaponSubtypeId ??
                          "__none"
                        }
                        onValueChange={(value) =>
                          setDraft((state) => ({
                            ...state,
                            weaponSubtypeId:
                              value ===
                                "__none"
                                ? null
                                : value,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>

                        <SelectContent>
                          <SelectItem value="__none">
                            Select
                          </SelectItem>

                          {md.weaponSubtypes
                            .filter(
                              (row) =>
                                !draft.weaponTypeId ||
                                row.weapon_type_id ===
                                draft.weaponTypeId,
                            )
                            .map((row) => (
                              <SelectItem
                                key={row.id}
                                value={row.id}
                              >
                                {row.label}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>
                        Brand mapping
                      </Label>

                      <Select
                        value={
                          draft.brandId ??
                          "__none"
                        }
                        onValueChange={(value) =>
                          setDraft((state) => ({
                            ...state,
                            brandId:
                              value ===
                                "__none"
                                ? null
                                : value,
                            modelId: null,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>

                        <SelectContent>
                          <SelectItem value="__none">
                            Select
                          </SelectItem>

                          {md.brands.map(
                            (row) => (
                              <SelectItem
                                key={row.id}
                                value={row.id}
                              >
                                {row.label}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>
                        Model mapping
                      </Label>

                      <Select
                        value={
                          draft.modelId ??
                          "__none"
                        }
                        onValueChange={(value) =>
                          setDraft((state) => ({
                            ...state,
                            modelId:
                              value ===
                                "__none"
                                ? null
                                : value,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>

                        <SelectContent>
                          <SelectItem value="__none">
                            Select
                          </SelectItem>

                          {md.models
                            .filter(
                              (row) =>
                                !draft.brandId ||
                                row.brand_id ===
                                draft.brandId,
                            )
                            .map((row) => (
                              <SelectItem
                                key={row.id}
                                value={row.id}
                              >
                                {row.label}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>
                        Caliber mapping
                      </Label>

                      <Select
                        value={
                          draft.caliberId ??
                          "__none"
                        }
                        onValueChange={(value) =>
                          setDraft((state) => ({
                            ...state,
                            caliberId:
                              value ===
                                "__none"
                                ? null
                                : value,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>

                        <SelectContent>
                          <SelectItem value="__none">
                            Select
                          </SelectItem>

                          {md.calibers.map(
                            (row) => (
                              <SelectItem
                                key={row.id}
                                value={row.id}
                              >
                                {row.label}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}

              <div>
                <Label>Storage location</Label>

                <Select
                  value={
                    draft.storageLocationId ??
                    "__none"
                  }
                  onValueChange={(value) =>
                    setDraft((state) => ({
                      ...state,
                      storageLocationId:
                        value === "__none"
                          ? null
                          : value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="__none">
                      Select
                    </SelectItem>

                    {md.storageLocations.map(
                      (row) => {
                        const warehouse =
                          md.warehouses.find(
                            (candidate) =>
                              candidate.id ===
                              row.warehouse_id,
                          )

                        return (
                          <SelectItem
                            key={row.id}
                            value={row.id}
                          >
                            {warehouse?.label ??
                              row.warehouse_id}{" "}
                            · {row.shelf}/
                            {row.bin}
                          </SelectItem>
                        )
                      },
                    )}
                  </SelectContent>
                </Select>
              </div>

              <datalist id="manifest-weapon-types-edit">{md.weaponTypes.map((row) => <option key={row.id} value={row.label} />)}</datalist>
              <datalist id="manifest-weapon-subtypes-edit">{md.weaponSubtypes.map((row) => <option key={row.id} value={row.label} />)}</datalist>
              <datalist id="manifest-manufacturers-edit">{md.brands.map((row) => <option key={row.id} value={row.label} />)}</datalist>
              <datalist id="manifest-models-edit">{md.models.map((row) => <option key={row.id} value={row.label} />)}</datalist>
              <datalist id="manifest-calibers-edit">{md.calibers.map((row) => <option key={row.id} value={row.label} />)}</datalist>

              {editing.issues.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 sm:col-span-2">
                  <div className="mb-2 flex items-center gap-1 text-sm font-medium text-amber-700">
                    <AlertTriangle className="size-4" />
                    Validation and receipt
                    requirements
                  </div>

                  {editing.issues.map(
                    (issue) => (
                      <div
                        key={issue.id}
                        className="mb-1 text-xs text-amber-700"
                      >
                        • {issue.message}
                      </div>
                    ),
                  )}
                </div>
              )}

              <div className="rounded-lg bg-muted p-3 sm:col-span-2">
                <Label>Original source</Label>

                <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                  {editing.source.text ??
                    JSON.stringify(
                      editing.rawData,
                    )}
                </p>
              </div>
            </div>
          )}

          <SheetFooter>
            <Button
              variant="outline"
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>

            <Button
              disabled={saving}
              onClick={() => void saveEdit()}
            >
              {saving && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Save and revalidate
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
      >
        <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Bulk edit {selected.size} selected rows
            </DialogTitle>
          </DialogHeader>

          <p className="text-xs text-muted-foreground">
            Only populated fields below will be
            changed. Serial numbers are intentionally
            excluded from bulk editing.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>Product type</Label>

              <Select
                value={
                  bulkDraft.productType ??
                  "__unchanged"
                }
                onValueChange={(value) =>
                  setBulkDraft((state) => ({
                    ...state,
                    productType: value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="__unchanged">
                    Do not change
                  </SelectItem>
                  <SelectItem value="weapon">
                    Weapon
                  </SelectItem>
                  <SelectItem value="ammunition">
                    Ammunition
                  </SelectItem>
                  <SelectItem value="accessory">
                    Accessory
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Weapon type</Label>
              <Input
                list="manifest-weapon-types-bulk"
                placeholder="Do not change"
                value={bulkDraft.weaponType ?? ""}
                onChange={(event) => setBulkDraft((state) => ({ ...state, weaponType: event.target.value }))}
              />
            </div>

            <div>
              <Label>Subtype / category</Label>
              <Input
                list="manifest-weapon-subtypes-bulk"
                placeholder="Do not change"
                value={bulkDraft.category ?? ""}
                onChange={(event) => setBulkDraft((state) => ({ ...state, category: event.target.value }))}
              />
            </div>

            <div>
              <Label>Manufacturer</Label>
              <Input
                list="manifest-manufacturers-bulk"
                placeholder="Do not change"
                value={
                  bulkDraft.manufacturer ?? ""
                }
                onChange={(event) =>
                  setBulkDraft((state) => ({
                    ...state,
                    manufacturer:
                      event.target.value,
                  }))
                }
              />
            </div>

            <div>
              <Label>Model</Label>
              <Input
                list="manifest-models-bulk"
                placeholder="Do not change"
                value={bulkDraft.model ?? ""}
                onChange={(event) =>
                  setBulkDraft((state) => ({
                    ...state,
                    model:
                      event.target.value,
                  }))
                }
              />
            </div>

            <div>
              <Label>Caliber</Label>
              <Input
                list="manifest-calibers-bulk"
                placeholder="Do not change"
                value={
                  bulkDraft.caliber ?? ""
                }
                onChange={(event) =>
                  setBulkDraft((state) => ({
                    ...state,
                    caliber:
                      event.target.value,
                  }))
                }
              />
            </div>

            <div>
              <Label>Unit price</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="Do not change"
                value={
                  bulkDraft.unitPrice ?? ""
                }
                onChange={(event) =>
                  setBulkDraft((state) => ({
                    ...state,
                    unitPrice:
                      event.target.value,
                  }))
                }
              />
            </div>

            <div>
              <Label>Currency</Label>

              <Select
                value={
                  bulkDraft.currency ??
                  "__unchanged"
                }
                onValueChange={(value) =>
                  setBulkDraft((state) => ({
                    ...state,
                    currency: value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="__unchanged">
                    Do not change
                  </SelectItem>

                  {activeCurrencies.map(
                    (item) => (
                      <SelectItem
                        key={item.isoCode}
                        value={item.isoCode}
                      >
                        {item.isoCode}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Storage location</Label>

              <Select
                value={
                  bulkDraft.storageLocationId ??
                  "__unchanged"
                }
                onValueChange={(value) =>
                  setBulkDraft((state) => ({
                    ...state,
                    storageLocationId:
                      value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="__unchanged">
                    Do not change
                  </SelectItem>

                  {md.storageLocations.map(
                    (row) => (
                      <SelectItem
                        key={row.id}
                        value={row.id}
                      >
                        {
                          md.warehouses.find(
                            (candidate) =>
                              candidate.id ===
                              row.warehouse_id,
                          )?.label
                        }{" "}
                        · {row.shelf}/{row.bin}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="hidden">
              <Label>Weapon type mapping</Label>

              <Select
                value={
                  bulkDraft.weaponTypeId ??
                  "__unchanged"
                }
                onValueChange={(value) =>
                  setBulkDraft((state) => ({
                    ...state,
                    weaponTypeId: value,
                    weaponSubtypeId:
                      "__unchanged",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="__unchanged">
                    Do not change
                  </SelectItem>

                  {md.weaponTypes.map(
                    (row) => (
                      <SelectItem
                        key={row.id}
                        value={row.id}
                      >
                        {row.label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="hidden">
              <Label>Subtype mapping</Label>

              <Select
                value={
                  bulkDraft.weaponSubtypeId ??
                  "__unchanged"
                }
                onValueChange={(value) =>
                  setBulkDraft((state) => ({
                    ...state,
                    weaponSubtypeId: value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="__unchanged">
                    Do not change
                  </SelectItem>

                  {md.weaponSubtypes
                    .filter(
                      (row) =>
                        !bulkDraft.weaponTypeId ||
                        bulkDraft.weaponTypeId ===
                        "__unchanged" ||
                        row.weapon_type_id ===
                        bulkDraft.weaponTypeId,
                    )
                    .map((row) => (
                      <SelectItem
                        key={row.id}
                        value={row.id}
                      >
                        {row.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="hidden">
              <Label>Brand mapping</Label>

              <Select
                value={
                  bulkDraft.brandId ??
                  "__unchanged"
                }
                onValueChange={(value) =>
                  setBulkDraft((state) => ({
                    ...state,
                    brandId: value,
                    modelId: "__unchanged",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="__unchanged">
                    Do not change
                  </SelectItem>

                  {md.brands.map((row) => (
                    <SelectItem
                      key={row.id}
                      value={row.id}
                    >
                      {row.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="hidden">
              <Label>Model mapping</Label>

              <Select
                value={
                  bulkDraft.modelId ??
                  "__unchanged"
                }
                onValueChange={(value) =>
                  setBulkDraft((state) => ({
                    ...state,
                    modelId: value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="__unchanged">
                    Do not change
                  </SelectItem>

                  {md.models
                    .filter(
                      (row) =>
                        !bulkDraft.brandId ||
                        bulkDraft.brandId ===
                        "__unchanged" ||
                        row.brand_id ===
                        bulkDraft.brandId,
                    )
                    .map((row) => (
                      <SelectItem
                        key={row.id}
                        value={row.id}
                      >
                        {row.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="hidden">
              <Label>Caliber mapping</Label>

              <Select
                value={
                  bulkDraft.caliberId ??
                  "__unchanged"
                }
                onValueChange={(value) =>
                  setBulkDraft((state) => ({
                    ...state,
                    caliberId: value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="__unchanged">
                    Do not change
                  </SelectItem>

                  {md.calibers.map((row) => (
                    <SelectItem
                      key={row.id}
                      value={row.id}
                    >
                      {row.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <datalist id="manifest-weapon-types-bulk">{md.weaponTypes.map((row) => <option key={row.id} value={row.label} />)}</datalist>
            <datalist id="manifest-weapon-subtypes-bulk">{md.weaponSubtypes.map((row) => <option key={row.id} value={row.label} />)}</datalist>
            <datalist id="manifest-manufacturers-bulk">{md.brands.map((row) => <option key={row.id} value={row.label} />)}</datalist>
            <datalist id="manifest-models-bulk">{md.models.map((row) => <option key={row.id} value={row.label} />)}</datalist>
            <datalist id="manifest-calibers-bulk">{md.calibers.map((row) => <option key={row.id} value={row.label} />)}</datalist>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkOpen(false)}
            >
              Cancel
            </Button>

            <Button
              disabled={saving}
              onClick={() => void applyBulk()}
            >
              {saving && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Apply to {selected.size} rows
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {arrival === "future"
                ? "Schedule reviewed shipment"
                : "Confirm inventory receipt"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-3">
              <span>Total units</span>
              <strong>{totalQuantity}</strong>

              <span>Weapons</span>
              <strong>{weaponQuantity}</strong>

              <span>Accessories</span>
              <strong>{accessoryQuantity}</strong>

              <span>Ammunition</span>
              <strong>{ammunitionQuantity}</strong>
            </div>

            {arrival === "arrived_now" && (
              <div className="rounded-lg border p-3">
                <div className="font-medium">
                  Transaction currency: {currency}
                </div>

                <div className="text-xs text-muted-foreground">
                  Prices retain their item currency and
                  receive immutable accounting valuations.
                  All inventory changes roll back together
                  if any row fails.
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {arrival === "future"
                ? "This creates a scheduled shipment only. Inventory will not change until arrival is confirmed."
                : "This creates the shipment, inventory records, valuation snapshots, audit logs, and notifications in one transaction."}
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setConfirmOpen(false)
              }
            >
              Cancel
            </Button>

            <Button
              disabled={saving}
              onClick={() => void confirm()}
            >
              {saving && (
                <Loader2 className="size-4 animate-spin" />
              )}

              {arrival === "future"
                ? "Schedule"
                : "Receive inventory"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(value) =>
          !value && setDeleteTarget(null)
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete this unconfirmed review?
            </AlertDialogTitle>

            <AlertDialogDescription>
              {deleteTarget?.fileName} and all extracted
              rows, source document data, validation issues,
              and review changes will be permanently removed.
              No inventory or shipment record has been created.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>
              Keep review
            </AlertDialogCancel>

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
