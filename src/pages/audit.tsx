import { useState, useMemo } from "react"
import { Search, ScrollText, ChevronDown, ChevronRight, ArrowRight } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useStore } from "@/lib/store"
import { useNav } from "@/lib/nav"
import { formatDateTime } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import type { AuditActionType, AuditLog } from "@/lib/types"

const CATEGORY_FILTERS: (AuditActionType | "All")[] = [
  "All", "Intake", "Sale", "Return", "Payment", "Shipment", "DebtWarning",
  "Login", "Export", "Import", "Update", "Delete", "Void", "Backup", "RoleChange", "DueDateExtension", "StockAdjustment",
]

const CATEGORY_BADGE: Record<AuditActionType, string> = {
  Intake: "bg-status-returned/20 text-status-returned-fg border-status-returned/30",
  Sale: "bg-status-sold/20 text-status-sold-fg border-status-sold/30",
  Return: "bg-status-reserved/20 text-status-reserved-fg border-status-reserved/30",
  Payment: "bg-chart-2/20 text-chart-2 border-chart-2/30",
  Shipment: "bg-chart-4/20 text-chart-4 border-chart-4/30",
  DebtWarning: "bg-status-sold/30 text-status-sold-fg border-status-sold/40",
  Login: "bg-muted text-muted-foreground border-border",
  Export: "bg-chart-2/20 text-chart-2 border-chart-2/30",
  Import: "bg-chart-1/20 text-chart-1 border-chart-1/30",
  Update: "bg-secondary text-secondary-foreground border-border",
  Delete: "bg-destructive/20 text-destructive border-destructive/30",
  Void: "bg-destructive/20 text-destructive border-destructive/30",
  Backup: "bg-chart-3/20 text-chart-3 border-chart-3/30",
  RoleChange: "bg-chart-5/20 text-chart-5 border-chart-5/30",
  DueDateExtension: "bg-status-reserved/20 text-status-reserved-fg border-status-reserved/30",
  StockAdjustment: "bg-chart-2/20 text-chart-2 border-chart-2/30",
}

// Metadata fields that can link to a record page
const RECORD_LINKS: { key: string; label: string; page: "inventory" | "sales" | "shipments"; kind: "weapon" | "invoice" | "shipment" }[] = [
  { key: "weaponId", label: "Weapon", page: "inventory", kind: "weapon" },
  { key: "invoiceId", label: "Invoice", page: "sales", kind: "invoice" },
  { key: "shipmentId", label: "Shipment", page: "shipments", kind: "shipment" },
]

function parseMetadata(raw: string): Record<string, unknown> | null {
  if (!raw || raw === "{}") return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

// Pretty-print a metadata value for the key-value layout
function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]"
    return value.map((v) => formatMetadataValue(v)).join(", ")
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

export function AuditPage() {
  const { t } = useI18n()
  const auditLogs = useStore((s) => s.auditLogs)
  const { navigate, setSelectedWeaponId } = useNav()
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<AuditActionType | "All">("All")
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null)

  const actionTypeLabel = (type: AuditActionType): string => {
    const map: Partial<Record<AuditActionType, string>> = {
      Intake: t("audit.actionType.create"),
      Sale: t("audit.actionType.sale"),
      Payment: t("audit.actionType.payment"),
      Shipment: t("audit.actionType.shipment"),
      Login: t("audit.actionType.login"),
      Export: t("audit.actionType.export"),
      Import: t("audit.actionType.import"),
      Update: t("audit.actionType.update"),
      Delete: t("audit.actionType.delete"),
      Void: t("audit.actionType.void"),
      StockAdjustment: t("audit.actionType.stockAdjustment"),
    }
    return map[type] ?? type
  }

  const filtered = useMemo(() => {
    let data = auditLogs
    if (categoryFilter !== "All") data = data.filter((l) => l.actionType === categoryFilter)
    if (search) {
      const q = search.toLowerCase()
      data = data.filter((l) => l.actionType.toLowerCase().includes(q) || l.description.toLowerCase().includes(q) || l.userId.toLowerCase().includes(q))
    }
    return data.slice(0, 200) // Cap for performance
  }, [auditLogs, categoryFilter, search])

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: auditLogs.length }
    auditLogs.forEach((l) => { c[l.actionType] = (c[l.actionType] ?? 0) + 1 })
    return c
  }, [auditLogs])

  const selectedMetadata = selectedLog ? parseMetadata(selectedLog.metadata) : null

  const goToRecord = (key: string, page: "inventory" | "sales" | "shipments", kind: "weapon" | "invoice" | "shipment") => {
    const id = selectedMetadata?.[key]
    const idStr = typeof id === "string" ? id : id != null ? String(id) : null
    if (kind === "weapon" && idStr) {
      setSelectedWeaponId(idStr)
    }
    setSelectedLog(null)
    navigate(page)
  }

  return (
    <div className="flex flex-col gap-3 p-3 lg:p-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><ScrollText className="size-4" /> {t("audit.title")}</CardTitle>
          <CardDescription className="text-xs">{auditLogs.length} {t("audit.total")} — immutable record of all system actions</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder={t("audit.search")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 ps-8 text-xs" />
            </div>
            <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as AuditActionType | "All")}>
              <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORY_FILTERS.map((c) => <SelectItem key={c} value={c}>{c === "All" ? "All" : actionTypeLabel(c)} ({counts[c] ?? 0})</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border">
            <div className="max-h-[600px] overflow-y-auto scrollbar-thin">
              <Table>
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="bg-muted/50">
                    <TableHead className="h-8 w-6 text-[10px]"></TableHead>
                    <TableHead className="h-8 text-[10px]">{t("audit.timestamp")}</TableHead>
                    <TableHead className="h-8 text-[10px]">{t("audit.action")}</TableHead>
                    <TableHead className="h-8 text-[10px]">Type</TableHead>
                    <TableHead className="h-8 text-[10px]">{t("audit.user")}</TableHead>
                    <TableHead className="h-8 text-[10px]">{t("audit.description")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((log) => {
                    const hasMetadata = log.metadata && log.metadata !== "{}"
                    return (
                      <TableRow
                        key={log.id}
                        className="cursor-pointer hover:bg-muted/40"
                        onClick={() => setSelectedLog(log)}
                      >
                        <TableCell className="py-1.5 w-6">
                          <ChevronRight className="size-3 text-muted-foreground" />
                        </TableCell>
                        <TableCell className="py-1.5 text-[10px] text-muted-foreground whitespace-nowrap">{formatDateTime(log.timestamp)}</TableCell>
                        <TableCell className="py-1.5 text-[10px] font-medium whitespace-nowrap">{actionTypeLabel(log.actionType)}</TableCell>
                        <TableCell className="py-1.5"><Badge variant="outline" className={`text-[9px] ${CATEGORY_BADGE[log.actionType]}`}>{actionTypeLabel(log.actionType)}</Badge></TableCell>
                        <TableCell className="py-1.5 text-[10px] text-muted-foreground whitespace-nowrap">{log.userId}</TableCell>
                        <TableCell className="py-1.5 text-[10px] text-muted-foreground">
                          <span className="line-clamp-1">{log.description}</span>
                          {hasMetadata && <span className="ms-1 text-[9px] text-muted-foreground/60">• {t("audit.description")}</span>}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {filtered.length === 0 && <TableRow><TableCell colSpan={6} className="h-16 text-center text-xs text-muted-foreground">{t("audit.noLogs")}</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={selectedLog !== null} onOpenChange={(open) => { if (!open) setSelectedLog(null) }}>
        <DialogContent className="sm:max-w-2xl">
          {selectedLog && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <Badge variant="outline" className={`text-[10px] ${CATEGORY_BADGE[selectedLog.actionType]}`}>{actionTypeLabel(selectedLog.actionType)}</Badge>
                  <span className="text-sm font-semibold">{actionTypeLabel(selectedLog.actionType)} Event</span>
                </DialogTitle>
                <DialogDescription className="text-xs">{selectedLog.description}</DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-3">
                {/* Core log metadata */}
                <div className="grid grid-cols-1 gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("audit.user")} (ID)</span>
                    <span className="text-xs font-medium">{selectedLog.userId || "—"}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("audit.timestamp")}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(selectedLog.timestamp)}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("audit.action")}</span>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className={`text-[9px] ${CATEGORY_BADGE[selectedLog.actionType]}`}>{actionTypeLabel(selectedLog.actionType)}</Badge>
                      <ChevronDown className="size-3 text-muted-foreground/40" />
                    </div>
                  </div>
                </div>

                {/* Go to Record buttons */}
                {selectedMetadata && RECORD_LINKS.some((r) => r.key in selectedMetadata) && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("audit.entity")}</span>
                    <div className="flex flex-wrap gap-2">
                      {RECORD_LINKS.map((r) => {
                        const id = selectedMetadata[r.key]
                        if (id === undefined || id === null) return null
                        return (
                          <Button
                            key={r.key}
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1.5 text-xs"
                            onClick={() => goToRecord(r.key, r.page, r.kind)}
                          >
                            {r.label}
                            <span className="text-muted-foreground">#{String(id)}</span>
                            <ArrowRight className="size-3" />
                          </Button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Formatted metadata key-value layout */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Metadata</span>
                  {selectedMetadata ? (
                    <div className="rounded-lg border">
                      <div className="grid grid-cols-1 divide-y sm:grid-cols-[minmax(120px,180px)_1fr] sm:divide-x sm:divide-y-0">
                        {Object.entries(selectedMetadata).map(([key, value]) => (
                          <div key={key} className="contents">
                            <div className="bg-muted/30 px-3 py-1.5 text-[10px] font-medium text-muted-foreground sm:border-b">{key}</div>
                            <div className="px-3 py-1.5 text-[11px] font-mono break-words">{formatMetadataValue(value)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                      No metadata recorded for this event
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedLog(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
