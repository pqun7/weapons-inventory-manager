import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  Activity, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3, Coins, FileText, Filter, Hash,
  Search, ScrollText, UserRound,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  AUDIT_ACTIONS, auditActionLabel, auditDetails, auditMoneyCurrencyKey, auditSummary,
  getAuditCurrency, groupedAuditMetadata, humanizeAuditKey,
  isBusinessAuditLog, type AuditMetadataGroup,
} from "@/lib/audit-presentation"
import { resolveAuditEntity } from "@/lib/audit-entity"
import { useEntityDialog } from "@/components/entity-dialog-provider"
import { useCurrency } from "@/lib/currency-context"
import { formatDateTime } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useStore } from "@/lib/store"
import type { AuditActionType } from "@/lib/types"

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
  const { openEntity } = useEntityDialog()
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<AuditActionType | "All">("All")
  const [userFilter, setUserFilter] = useState("All")
  const [entityFilter, setEntityFilter] = useState("All")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [sortDirection, setSortDirection] = useState<"newest" | "oldest">("newest")
  const [page, setPage] = useState(0)
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null)

  useEffect(() => { void refreshFromDb() }, [refreshFromDb])

  const userById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users])
  const businessLogs = useMemo(() => auditLogs.filter(isBusinessAuditLog), [auditLogs])
  const counts = useMemo(() => {
    const result: Record<string, number> = { All: businessLogs.length }
    for (const log of businessLogs) result[log.actionType] = (result[log.actionType] ?? 0) + 1
    return result
  }, [businessLogs])
  const entityTypes = useMemo(() => [...new Set(businessLogs.map((log) => log.entityType).filter((value): value is string => Boolean(value)))].sort(), [businessLogs])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return [...businessLogs]
      .sort((left, right) => sortDirection === "newest" ? right.timestamp.localeCompare(left.timestamp) : left.timestamp.localeCompare(right.timestamp))
      .filter((log) => categoryFilter === "All" || log.actionType === categoryFilter)
      .filter((log) => userFilter === "All" || log.userId === userFilter)
      .filter((log) => entityFilter === "All" || log.entityType === entityFilter)
      .filter((log) => !dateFrom || log.timestamp.slice(0, 10) >= dateFrom)
      .filter((log) => !dateTo || log.timestamp.slice(0, 10) <= dateTo)
      .filter((log) => {
        if (!query) return true
        const user = userById.get(log.userId)
        return [
          log.id, log.actionType, log.description, log.userId, user?.name, user?.username,
          auditActionLabel(log.actionType, t), log.metadata, log.entityType, log.entityId, log.entityName,
        ].some((value) => value?.toLocaleLowerCase().includes(query))
      })
  }, [businessLogs, categoryFilter, dateFrom, dateTo, entityFilter, search, sortDirection, t, userById, userFilter])

  useEffect(() => { setPage(0) }, [categoryFilter, dateFrom, dateTo, entityFilter, search, sortDirection, userFilter])
  const pageSize = 50
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pagedLogs = filtered.slice(page * pageSize, (page + 1) * pageSize)

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

  const todayCount = businessLogs.filter((log) => log.date === new Date().toISOString().slice(0, 10)).length
  const activeUsers = new Set(businessLogs.map((log) => log.userId).filter(Boolean)).size

  return (
    <div className="flex flex-col gap-3 p-3 lg:p-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <Card className="py-3"><CardContent className="flex items-center gap-3 px-3"><ScrollText className="size-5 text-primary" /><div><div className="text-lg font-bold tabular-nums">{businessLogs.length}</div><div className="text-[10px] text-muted-foreground">{t("audit.total")}</div></div></CardContent></Card>
        <Card className="py-3"><CardContent className="flex items-center gap-3 px-3"><Clock3 className="size-5 text-chart-2" /><div><div className="text-lg font-bold tabular-nums">{todayCount}</div><div className="text-[10px] text-muted-foreground">{t("audit.today")}</div></div></CardContent></Card>
        <Card className="py-3"><CardContent className="flex items-center gap-3 px-3"><UserRound className="size-5 text-chart-4" /><div><div className="text-lg font-bold tabular-nums">{activeUsers}</div><div className="text-[10px] text-muted-foreground">{t("audit.activeUsers")}</div></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Activity className="size-4" />{t("audit.businessEvents")}</CardTitle>
          <CardDescription className="text-xs">{t("audit.businessDescription")}</CardDescription>
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
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="h-9 w-full text-xs sm:w-44"><SelectValue placeholder={t("audit.user")} /></SelectTrigger>
              <SelectContent><SelectItem value="All">{t("common.all")}</SelectItem>{users.map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={entityFilter} onValueChange={setEntityFilter}>
              <SelectTrigger className="h-9 w-full text-xs sm:w-44"><SelectValue placeholder={t("audit.entity")} /></SelectTrigger>
              <SelectContent><SelectItem value="All">{t("common.all")}</SelectItem>{entityTypes.map((entity) => <SelectItem key={entity} value={entity}>{entity}</SelectItem>)}</SelectContent>
            </Select>
            <DatePicker value={dateFrom} onChange={setDateFrom} placeholder={t("audit.fromDate")} className="h-9 w-full text-xs sm:w-40" max={dateTo || undefined} />
            <DatePicker value={dateTo} onChange={setDateTo} placeholder={t("audit.toDate")} className="h-9 w-full text-xs sm:w-40" min={dateFrom || undefined} />
            <Select value={sortDirection} onValueChange={(value) => setSortDirection(value as "newest" | "oldest")}>
              <SelectTrigger className="h-9 w-full text-xs sm:w-36"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="newest">{t("audit.newestFirst")}</SelectItem><SelectItem value="oldest">{t("audit.oldestFirst")}</SelectItem></SelectContent>
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
                  {pagedLogs.map((log) => {
                    const metadata = auditDetails(log)
                    const currency = getAuditCurrency(metadata)
                    const user = userById.get(log.userId)
                    const actorName = log.userName || user?.name || t("audit.systemUser")
                    const expanded = expandedLogId === log.id
                    const entityTarget = resolveAuditEntity(log)
                    const detailGroups = groupedAuditMetadata(metadata)
                    return (
                      <Fragment key={log.id}>
                        <TableRow className="align-top hover:bg-muted/40">
                          <TableCell className="py-2"><Badge variant="outline" className={`whitespace-nowrap text-[9px] ${CATEGORY_BADGE[log.actionType]}`}>{auditActionLabel(log.actionType, t)}</Badge></TableCell>
                          <TableCell className="hidden py-2 md:table-cell"><div className="text-[10px] font-medium">{actorName}</div><div className="text-[9px] text-muted-foreground">{user?.username}</div></TableCell>
                          <TableCell className="hidden whitespace-nowrap py-2 text-[10px] text-muted-foreground sm:table-cell">{formatDateTime(log.timestamp)}</TableCell>
                          <TableCell className="min-w-0 py-2">
                            <div className="text-[11px] font-medium leading-relaxed">{auditSummary(log, metadata, t, actorName)}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {log.itemCount ? <Badge variant="secondary" className="h-4 px-1.5 text-[8px]">{t("audit.itemCount", { count: log.itemCount })}</Badge> : null}
                              {currency ? <Badge variant="secondary" className="h-4 px-1 text-[8px]">{currencyPresentation(currency).symbol}</Badge> : null}
                              {entityTarget ? <Button size="xs" variant="link" className="h-5 gap-1 px-1 text-[9px]" onClick={() => openEntity(entityTarget)}>{t("audit.openEntity")}<ArrowUpRight className="size-3" /></Button> : null}
                              {metadata ? <Button size="xs" variant="ghost" className="h-5 gap-1 px-1 text-[9px]" onClick={() => setExpandedLogId(expanded ? null : log.id)}>{expanded ? t("audit.hideDetails") : t("audit.showDetails")}{expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}</Button> : null}
                            </div>
                          </TableCell>
                          <TableCell className="py-2"><Button size="icon-xs" variant="ghost" aria-label={expanded ? t("audit.hideDetails") : t("audit.showDetails")} disabled={!metadata} onClick={() => setExpandedLogId(expanded ? null : log.id)}>{expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}</Button></TableCell>
                        </TableRow>
                        {expanded && metadata ? (
                          <TableRow className="bg-muted/15 hover:bg-muted/15">
                            <TableCell colSpan={5} className="p-3">
                              <div className="grid gap-3 lg:grid-cols-2">
                                {(Object.keys(detailGroups) as AuditMetadataGroup[]).map((group) => {
                                  const entries = detailGroups[group]
                                  if (!entries.length) return null
                                  const Icon = GROUP_ICON[group]
                                  return <section key={group} className="overflow-hidden rounded-lg border bg-background"><div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2"><Icon className="size-3.5 text-primary" /><h3 className="text-[10px] font-semibold">{t(`audit.group.${group}`)}</h3></div><div className="divide-y">{entries.map(([key, value]) => <div key={key} className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(8rem,.7fr)_minmax(0,1.3fr)]"><span className="text-[10px] text-muted-foreground">{humanizeAuditKey(key, t)}</span><div className="min-w-0 break-words text-[10px] sm:text-end">{formatAuditValue(key, value, metadata)}</div></div>)}</div></section>
                                })}
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    )
                  })}
                  {filtered.length === 0 && <TableRow><TableCell colSpan={5} className="h-24 text-center text-xs text-muted-foreground">{t("audit.noLogs")}</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{t("audit.eventCount", { count: filtered.length })}</span>
            <div className="flex items-center gap-2">
              <Button size="xs" variant="outline" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronLeft className="size-3" />{t("common.previous")}</Button>
              <span>{page + 1} / {pageCount}</span>
              <Button size="xs" variant="outline" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>{t("common.nextPage")}<ChevronRight className="size-3" /></Button>
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
