import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  Activity, ArrowUpRight, Clock3, Coins, FileText, Filter, Hash,
  Search, ScrollText, UserRound,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  AUDIT_ACTIONS, auditActionLabel, auditMoneyCurrencyKey, auditSummary,
  getAuditCurrency, groupedAuditMetadata, humanizeAuditKey, parseAuditMetadata,
  type AuditMetadataGroup,
} from "@/lib/audit-presentation"
import { useCurrency } from "@/lib/currency-context"
import { formatDateTime } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useNav } from "@/lib/nav"
import { useStore } from "@/lib/store"
import type { AuditActionType, AuditLog } from "@/lib/types"

const CATEGORY_BADGE: Record<AuditActionType, string> = {
  Intake: "bg-status-returned/15 text-status-returned-fg border-status-returned/30",
  Sale: "bg-status-sold/15 text-status-sold-fg border-status-sold/30",
  Return: "bg-status-reserved/15 text-status-reserved-fg dark:text-status-reserved/90 border-status-reserved/30",
  Payment: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  Shipment: "bg-chart-4/15 text-chart-4 border-chart-4/30",
  DebtWarning: "bg-status-sold/20 text-status-sold-fg border-status-sold/40",
  Login: "bg-muted text-muted-foreground border-border",
  Export: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  Import: "bg-chart-1/15 text-chart-1 border-chart-1/30",
  Update: "bg-secondary text-secondary-foreground border-border",
  Delete: "bg-destructive/15 text-destructive border-destructive/30",
  Void: "bg-destructive/15 text-destructive border-destructive/30",
  Backup: "bg-chart-3/15 text-chart-3 border-chart-3/30",
  RoleChange: "bg-chart-5/15 text-chart-5 border-chart-5/30",
  DueDateExtension: "bg-status-reserved/15 text-status-reserved-fg dark:text-status-reserved/90 border-status-reserved/30",
  StockAdjustment: "bg-chart-2/15 text-chart-2 border-chart-2/30",
}

const GROUP_ICON: Record<AuditMetadataGroup, typeof Hash> = {
  identity: Hash,
  money: Coins,
  changes: Activity,
  details: FileText,
}

const RECORD_LINKS = [
  { key: "weaponId", labelKey: "audit.entity.weapon", page: "inventory", kind: "weapon" },
  { key: "invoiceId", labelKey: "audit.entity.invoice", page: "sales", kind: "invoice" },
  { key: "shipmentId", labelKey: "audit.entity.shipment", page: "shipments", kind: "shipment" },
] as const

function primitiveText(value: unknown, locale: string, t: (key: string) => string): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return t(value ? "common.yes" : "common.no")
  if (typeof value === "number") return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value)
  return String(value)
}

export function AuditPage() {
  const { t, locale } = useI18n()
  const { formatOriginal, currencyPresentation } = useCurrency()
  const auditLogs = useStore((state) => state.auditLogs)
  const users = useStore((state) => state.users)
  const refreshFromDb = useStore((state) => state.refreshFromDb)
  const { navigate, setSelectedWeaponId } = useNav()
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<AuditActionType | "All">("All")
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null)

  useEffect(() => { void refreshFromDb() }, [refreshFromDb])

  const userById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users])
  const counts = useMemo(() => {
    const result: Record<string, number> = { All: auditLogs.length }
    for (const log of auditLogs) result[log.actionType] = (result[log.actionType] ?? 0) + 1
    return result
  }, [auditLogs])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return [...auditLogs]
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      .filter((log) => categoryFilter === "All" || log.actionType === categoryFilter)
      .filter((log) => {
        if (!query) return true
        const user = userById.get(log.userId)
        return [
          log.id, log.actionType, log.description, log.userId, user?.name, user?.username,
          auditActionLabel(log.actionType, t), log.metadata,
        ].some((value) => value?.toLocaleLowerCase().includes(query))
      })
      .slice(0, 500)
  }, [auditLogs, categoryFilter, search, t, userById])

  const selectedMetadata = useMemo(
    () => selectedLog ? parseAuditMetadata(selectedLog.metadata) : null,
    [selectedLog],
  )
  const selectedGroups = useMemo(() => groupedAuditMetadata(selectedMetadata), [selectedMetadata])

  const formatAuditValue = (key: string, value: unknown, metadata: Record<string, unknown>): ReactNode => {
    if (Array.isArray(value)) {
      if (value.length === 0) return "—"
      return (
        <div className="grid gap-2">
          {value.map((item, index) => (
            <div key={index} className="rounded-md border bg-muted/20 p-2">
              <div className="mb-1 text-[9px] font-semibold text-muted-foreground">{t("audit.itemNumber", { number: index + 1 })}</div>
              {item && typeof item === "object" && !Array.isArray(item) ? (
                <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                  {Object.entries(item as Record<string, unknown>).map(([childKey, childValue]) => (
                    <div key={childKey} className="flex min-w-0 items-baseline justify-between gap-2 text-[10px]">
                      <span className="shrink-0 text-muted-foreground">{humanizeAuditKey(childKey, t)}</span>
                      <span className="min-w-0 break-words text-end font-medium">{primitiveText(childValue, locale, t)}</span>
                    </div>
                  ))}
                </div>
              ) : primitiveText(item, locale, t)}
            </div>
          ))}
        </div>
      )
    }
    if (value && typeof value === "object") {
      return (
        <div className="grid gap-1 rounded-md bg-muted/20 p-2">
          {Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => (
            <div key={childKey} className="flex min-w-0 justify-between gap-3 text-[10px]">
              <span className="text-muted-foreground">{humanizeAuditKey(childKey, t)}</span>
              <span className="break-words text-end font-medium">{primitiveText(childValue, locale, t)}</span>
            </div>
          ))}
        </div>
      )
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const currencyKey = auditMoneyCurrencyKey(key)
      const currency = currencyKey ? metadata[currencyKey] : null
      if (typeof currency === "string" && /^[A-Za-z]{3}$/.test(currency)) {
        return <span className="font-semibold tabular-nums">{formatOriginal(value, currency.toUpperCase())}</span>
      }
    }
    if (/currency/i.test(key) && typeof value === "string") {
      const presentation = currencyPresentation(value)
      return (
        <span className="inline-flex items-baseline gap-1.5">
          <span className="font-semibold">{presentation.symbol}</span>
          <span className="text-[9px] text-muted-foreground">{presentation.name} · {presentation.code}</span>
        </span>
      )
    }
    if (/date|timestamp/i.test(key) && typeof value === "string" && !Number.isNaN(Date.parse(value))) {
      return formatDateTime(value)
    }
    return primitiveText(value, locale, t)
  }

  const goToRecord = (key: string, page: "inventory" | "sales" | "shipments", kind: string) => {
    const value = selectedMetadata?.[key]
    if (value == null) return
    if (kind === "weapon") setSelectedWeaponId(String(value))
    setSelectedLog(null)
    navigate(page)
  }

  const todayCount = auditLogs.filter((log) => log.date === new Date().toISOString().slice(0, 10)).length
  const activeUsers = new Set(auditLogs.map((log) => log.userId).filter(Boolean)).size

  return (
    <div className="flex flex-col gap-3 p-3 lg:p-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <Card className="py-3"><CardContent className="flex items-center gap-3 px-3"><ScrollText className="size-5 text-primary" /><div><div className="text-lg font-bold tabular-nums">{auditLogs.length}</div><div className="text-[10px] text-muted-foreground">{t("audit.total")}</div></div></CardContent></Card>
        <Card className="py-3"><CardContent className="flex items-center gap-3 px-3"><Clock3 className="size-5 text-chart-2" /><div><div className="text-lg font-bold tabular-nums">{todayCount}</div><div className="text-[10px] text-muted-foreground">{t("audit.today")}</div></div></CardContent></Card>
        <Card className="py-3"><CardContent className="flex items-center gap-3 px-3"><UserRound className="size-5 text-chart-4" /><div><div className="text-lg font-bold tabular-nums">{activeUsers}</div><div className="text-[10px] text-muted-foreground">{t("audit.activeUsers")}</div></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Activity className="size-4" />{t("audit.title")}</CardTitle>
          <CardDescription className="text-xs">{t("audit.descriptionHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("audit.search")} className="h-9 ps-8 text-xs" />
            </div>
            <Select value={categoryFilter} onValueChange={(value) => setCategoryFilter(value as AuditActionType | "All")}>
              <SelectTrigger className="h-9 w-full text-xs sm:w-56"><Filter className="size-3.5" /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="All">{t("common.all")} ({counts.All})</SelectItem>
                {AUDIT_ACTIONS.map((action) => <SelectItem key={action} value={action}>{auditActionLabel(action, t)} ({counts[action] ?? 0})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-hidden rounded-xl border">
            <div className="max-h-[65vh] overflow-auto scrollbar-thin">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow className="bg-muted/50">
                    <TableHead className="h-9 text-[10px]">{t("audit.event")}</TableHead>
                    <TableHead className="hidden h-9 text-[10px] md:table-cell">{t("audit.user")}</TableHead>
                    <TableHead className="hidden h-9 text-[10px] sm:table-cell">{t("audit.timestamp")}</TableHead>
                    <TableHead className="h-9 text-[10px]">{t("audit.summary")}</TableHead>
                    <TableHead className="h-9 w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((log) => {
                    const metadata = parseAuditMetadata(log.metadata)
                    const currency = getAuditCurrency(metadata)
                    const user = userById.get(log.userId)
                    return (
                      <TableRow key={log.id} className="cursor-pointer align-top hover:bg-muted/40" onClick={() => setSelectedLog(log)}>
                        <TableCell className="py-2"><Badge variant="outline" className={`whitespace-nowrap text-[9px] ${CATEGORY_BADGE[log.actionType]}`}>{auditActionLabel(log.actionType, t)}</Badge></TableCell>
                        <TableCell className="hidden py-2 md:table-cell"><div className="text-[10px] font-medium">{user?.name ?? (log.userId || t("audit.systemUser"))}</div><div className="text-[9px] text-muted-foreground">{user?.username ?? log.userId}</div></TableCell>
                        <TableCell className="hidden whitespace-nowrap py-2 text-[10px] text-muted-foreground sm:table-cell">{formatDateTime(log.timestamp)}</TableCell>
                        <TableCell className="min-w-0 py-2"><div className="line-clamp-2 text-[11px] font-medium leading-relaxed">{auditSummary(log, metadata, t)}</div><div className="mt-1 flex flex-wrap items-center gap-1 md:hidden"><span className="text-[9px] text-muted-foreground">{user?.name ?? log.userId}</span>{currency && <Badge variant="secondary" className="h-4 px-1 text-[8px]">{currencyPresentation(currency).symbol}</Badge>}</div>{currency && <div className="mt-1 hidden items-center gap-1 text-[9px] text-muted-foreground md:flex"><Coins className="size-3" />{currencyPresentation(currency).name} · {currency}</div>}</TableCell>
                        <TableCell className="py-2"><ArrowUpRight className="size-3.5 text-muted-foreground" /></TableCell>
                      </TableRow>
                    )
                  })}
                  {filtered.length === 0 && <TableRow><TableCell colSpan={5} className="h-24 text-center text-xs text-muted-foreground">{t("audit.noLogs")}</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </div>
          {auditLogs.length > 500 && <p className="text-[10px] text-muted-foreground">{t("audit.latestLimit", { count: 500 })}</p>}
        </CardContent>
      </Card>

      <Dialog open={selectedLog !== null} onOpenChange={(open) => { if (!open) setSelectedLog(null) }}>
        <DialogContent className="w-[min(94vw,64rem)] sm:max-w-4xl">
          {selectedLog && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={`text-[9px] ${CATEGORY_BADGE[selectedLog.actionType]}`}>{auditActionLabel(selectedLog.actionType, t)}</Badge>
                  <span className="text-[10px] text-muted-foreground">#{selectedLog.id}</span>
                </div>
                <DialogTitle className="text-base leading-relaxed">{auditSummary(selectedLog, selectedMetadata, t)}</DialogTitle>
                <DialogDescription>{t("audit.detailDescription")}</DialogDescription>
              </DialogHeader>

              <div className="grid gap-3">
                <div className="grid gap-2 rounded-xl border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-4">
                  <InfoCell icon={UserRound} label={t("audit.user")} value={userById.get(selectedLog.userId)?.name ?? (selectedLog.userId || t("audit.systemUser"))} hint={userById.get(selectedLog.userId)?.username} />
                  <InfoCell icon={Clock3} label={t("audit.timestamp")} value={formatDateTime(selectedLog.timestamp)} />
                  <InfoCell icon={Activity} label={t("audit.action")} value={auditActionLabel(selectedLog.actionType, t)} />
                  <InfoCell icon={Hash} label={t("audit.logId")} value={selectedLog.id} />
                </div>

                {selectedMetadata && RECORD_LINKS.some((link) => selectedMetadata[link.key] != null) && (
                  <section className="grid gap-1.5">
                    <h3 className="text-[10px] font-semibold text-muted-foreground">{t("audit.relatedRecords")}</h3>
                    <div className="flex flex-wrap gap-2">
                      {RECORD_LINKS.map((link) => selectedMetadata[link.key] == null ? null : (
                        <Button key={link.key} size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => goToRecord(link.key, link.page, link.kind)}>
                          {t(link.labelKey)} <span className="font-mono text-[10px] text-muted-foreground">#{String(selectedMetadata[link.key])}</span><ArrowUpRight className="size-3" />
                        </Button>
                      ))}
                    </div>
                  </section>
                )}

                {selectedMetadata ? (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {(Object.keys(selectedGroups) as AuditMetadataGroup[]).map((group) => {
                      const entries = selectedGroups[group]
                      if (entries.length === 0) return null
                      const Icon = GROUP_ICON[group]
                      return (
                        <section key={group} className="min-w-0 overflow-hidden rounded-xl border">
                          <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2"><Icon className="size-3.5 text-primary" /><h3 className="text-[11px] font-semibold">{t(`audit.group.${group}`)}</h3></div>
                          <div className="divide-y">
                            {entries.map(([key, value]) => (
                              <div key={key} className="grid min-w-0 gap-1 px-3 py-2 sm:grid-cols-[minmax(8rem,0.7fr)_minmax(0,1.3fr)] sm:gap-3">
                                <span className="text-[10px] text-muted-foreground">{humanizeAuditKey(key, t)}</span>
                                <div className="min-w-0 break-words text-[11px] sm:text-end">{formatAuditValue(key, value, selectedMetadata)}</div>
                              </div>
                            ))}
                          </div>
                        </section>
                      )
                    })}
                  </div>
                ) : <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">{t("audit.noMetadata")}</div>}

                {selectedLog.description && selectedLog.description !== auditSummary(selectedLog, selectedMetadata, t) && (
                  <details className="rounded-lg border bg-muted/10 px-3 py-2 text-[10px]">
                    <summary className="cursor-pointer font-medium text-muted-foreground">{t("audit.originalRecord")}</summary>
                    <p className="mt-2 break-words leading-relaxed text-foreground">{selectedLog.description}</p>
                  </details>
                )}
              </div>

              <DialogFooter><Button variant="outline" onClick={() => setSelectedLog(null)}>{t("common.close")}</Button></DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function InfoCell({ icon: Icon, label, value, hint }: { icon: typeof Hash; label: string; value: string; hint?: string }) {
  return <div className="flex min-w-0 gap-2"><Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><div className="min-w-0"><div className="text-[9px] text-muted-foreground">{label}</div><div className="break-words text-[11px] font-medium">{value}</div>{hint && <div className="text-[9px] text-muted-foreground">{hint}</div>}</div></div>
}
