import { useMemo, useState } from "react"
import {
  AlertTriangle, Archive, BarChart3, CalendarRange, CircleDollarSign, Clock3,
  ChevronRight, Gauge, Info, PackageCheck, PackageSearch, RefreshCw, ShoppingBasket, TrendingUp,
} from "lucide-react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { DashboardKpiCard } from "@/components/dashboard/dashboard-kpi-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { DatePicker } from "@/components/ui/date-picker"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useDashboardAnalytics } from "@/hooks/use-dashboard-analytics"
import { useCurrency } from "@/lib/currency-context"
import { dashboardChangePct } from "@/lib/dashboard/insights"
import { deriveDashboardIntelligence } from "@/lib/dashboard/intelligence"
import { completeDashboardTrend, dashboardRangeForPreset, isValidDashboardRange } from "@/lib/dashboard/period"
import type { DashboardInventoryItem, DashboardPeriodPreset } from "@/lib/dashboard/types"
import { useI18n } from "@/lib/i18n"
import { useNav } from "@/lib/nav"
import { cn } from "@/lib/utils"

const PERIODS: DashboardPeriodPreset[] = ["week", "month", "quarter", "year", "custom"]
type AgingFilter = "aged" | "slow" | "dead"

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-36" />)}</div>
      <div className="grid gap-4 xl:grid-cols-5"><Skeleton className="h-96 xl:col-span-3" /><Skeleton className="h-96 xl:col-span-2" /></div>
      <div className="grid gap-4 xl:grid-cols-2"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>
    </div>
  )
}

function formatDateLabel(value: string, locale: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat(locale === "ar-SA" ? "ar-SA-u-ca-gregory" : locale, options).format(new Date(`${value}T00:00:00`))
}

function MetricTooltip({ formula, meaning, note }: { formula: string; meaning: string; note?: string }) {
  const { t } = useI18n()
  return (
    <div className="space-y-2">
      <div><div className="mb-0.5 font-semibold">{t("dash.tooltip.formula")}</div><div className="text-background/80">{formula}</div></div>
      <div><div className="mb-0.5 font-semibold">{t("dash.tooltip.meaning")}</div><div className="text-background/80">{meaning}</div></div>
      {note && <div className="border-t border-background/20 pt-2 text-background/70">{note}</div>}
    </div>
  )
}

function SectionHeading({ id, icon: Icon, title, description, tooltip }: {
  id: string
  icon: typeof BarChart3
  title: string
  description: string
  tooltip?: string
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" aria-hidden="true" /></span>
        <div className="min-w-0"><h2 id={id} className="text-sm font-semibold">{title}</h2><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p></div>
      </div>
      {tooltip && (
        <Tooltip>
          <TooltipTrigger asChild><Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={title}><Info className="size-4" /></Button></TooltipTrigger>
          <TooltipContent sideOffset={8} className="max-w-80 text-start leading-relaxed">{tooltip}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

function StatusMetric({ label, value, tone = "neutral", onClick }: { label: string; value: string; tone?: "neutral" | "warning" | "danger" | "good"; onClick?: () => void }) {
  const className = cn(
      "rounded-xl border bg-muted/20 p-3 text-start outline-none",
      tone === "warning" && "border-status-reserved/35 bg-status-reserved/5",
      tone === "danger" && "border-status-sold/35 bg-status-sold/5",
      tone === "good" && "border-status-returned/35 bg-status-returned/5",
      onClick && "group cursor-pointer transition-colors hover:bg-muted/55 focus-visible:ring-2 focus-visible:ring-ring",
    )
  const content = <><div className="flex items-center justify-between gap-2"><span className="text-[10px] leading-tight text-muted-foreground">{label}</span>{onClick && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" aria-hidden="true" />}</div><div className="mt-1 text-lg font-semibold tabular-nums">{value}</div></>
  return onClick ? <button type="button" className={className} onClick={onClick} aria-label={`${label}: ${value}`}>{content}</button> : <div className={className}>{content}</div>
}

function AgingProductsDialog({ filter, items, onClose, formatValue, categoryLabel, statusLabel, integer, t, onOpenInventory }: {
  filter: AgingFilter | null
  items: DashboardInventoryItem[]
  onClose: () => void
  formatValue: (value: number) => string
  categoryLabel: (category: DashboardInventoryItem["category"]) => string
  statusLabel: (status: DashboardInventoryItem["status"]) => string
  integer: Intl.NumberFormat
  t: (key: string, params?: Record<string, string | number>) => string
  onOpenInventory: () => void
}) {
  const titleKey = filter === "slow" ? "dash.aging.dialog.slowTitle" : filter === "dead" ? "dash.aging.dialog.deadTitle" : "dash.aging.dialog.agedTitle"
  return (
    <Dialog open={filter != null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="w-[min(46rem,calc(100vw-1rem))]">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2"><DialogTitle>{t(titleKey)}</DialogTitle><Badge variant="secondary">{t("dash.aging.dialog.count", { count: integer.format(items.length) })}</Badge></div>
          <DialogDescription>{t("dash.aging.dialog.description")}</DialogDescription>
        </DialogHeader>
        {items.length === 0 ? <div className="flex min-h-44 items-center justify-center rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t("dash.aging.dialog.empty")}</div> : (
          <div className="grid max-h-[58vh] gap-2 overflow-y-auto pe-1 scrollbar-thin sm:grid-cols-2">
            {items.map((item) => (
              <article key={`${item.category}:${item.id}`} className="rounded-xl border p-3">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-medium">{item.name}</h3><div className="mt-1 flex flex-wrap items-center gap-1.5"><Badge variant="outline" className="text-[10px]">{categoryLabel(item.category)}</Badge><Badge variant="outline" className={cn("text-[10px]", item.status === "dead" ? "border-status-sold/35 text-status-sold-fg" : "border-status-reserved/35 text-status-reserved-fg")}>{statusLabel(item.status)}</Badge></div></div><div className="shrink-0 text-end"><div className="text-sm font-semibold tabular-nums">{formatValue(item.value ?? 0)}</div><div className="text-[9px] text-muted-foreground">{t("dash.aging.dialog.value")}</div></div></div>
                <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-2 text-[11px] text-muted-foreground"><span>{t("dash.inventory.quantity", { count: integer.format(item.quantity) })}</span><span className="text-end">{item.daysSinceSale == null ? t("dash.aging.dialog.neverSold") : t("dash.aging.dialog.daysSinceSale", { days: integer.format(item.daysSinceSale) })}</span></div>
              </article>
            ))}
          </div>
        )}
        <DialogFooter showCloseButton><Button onClick={onOpenInventory}>{t("dash.aging.dialog.openInventory")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InventoryList({ items, empty, formatValue, categoryLabel, statusLabel, onOpen }: {
  items: DashboardInventoryItem[]
  empty: string
  formatValue: (item: DashboardInventoryItem) => string
  categoryLabel: (category: DashboardInventoryItem["category"]) => string
  statusLabel: (status: DashboardInventoryItem["status"]) => string
  onOpen: () => void
}) {
  if (!items.length) return <p className="flex min-h-40 items-center justify-center rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">{empty}</p>
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <button key={`${item.category}:${item.id}`} type="button" onClick={onOpen} className="flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-start transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="min-w-0"><span className="block truncate text-sm font-medium">{item.name}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{categoryLabel(item.category)} · {statusLabel(item.status)}</span></span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">{formatValue(item)}</span>
        </button>
      ))}
    </div>
  )
}

export function DashboardPage() {
  const { t, locale, dir } = useI18n()
  const { navigate } = useNav()
  const { formatAccountingAggregate, convertToDisplay } = useCurrency()
  const [preset, setPreset] = useState<DashboardPeriodPreset>("quarter")
  const [range, setRange] = useState(() => dashboardRangeForPreset("quarter"))
  const [agingFilter, setAgingFilter] = useState<AgingFilter | null>(null)
  const validRange = isValidDashboardRange(range)
  const { data, loading, refreshing, error, refresh } = useDashboardAnalytics(range, validRange)

  const number = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale])
  const decimal = useMemo(() => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), [locale])
  const integer = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }), [locale])
  const compact = useMemo(() => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }), [locale])
  const intelligence = useMemo(() => data ? deriveDashboardIntelligence(data) : null, [data])
  const trendData = useMemo(() => data ? completeDashboardTrend(data.trend, data.period) : [], [data])

  const setPeriod = (value: DashboardPeriodPreset) => {
    setPreset(value)
    if (value !== "custom") setRange(dashboardRangeForPreset(value))
  }

  const categoryLabel = (category: DashboardInventoryItem["category"]) => t(`dash.category.${category}`)
  const statusLabel = (status: DashboardInventoryItem["status"]) => t(`dash.inventory.status.${status}`)
  const periodLabel = `${formatDateLabel(range.start, locale, { year: "numeric", month: "short", day: "numeric" })} – ${formatDateLabel(range.end, locale, { year: "numeric", month: "short", day: "numeric" })}`
  const averageOrderValue = data && data.current.orderCount > 0 ? data.current.revenue / data.current.orderCount : null
  const previousAverageOrderValue = data && data.previous.orderCount > 0 ? data.previous.revenue / data.previous.orderCount : null
  const aovChange = averageOrderValue != null && previousAverageOrderValue != null ? dashboardChangePct(averageOrderValue, previousAverageOrderValue) : null
  const annualTurnover = intelligence?.capital.turnoverProxy == null ? null : intelligence.capital.turnoverProxy * 365 / intelligence.capital.periodDays
  const slowCapitalShare = intelligence?.capital.slowCapitalSharePct ?? null

  const changeText = (change: number | null) => {
    if (change == null) return t("dash.compare.noBaseline")
    if (change === 0) return t("dash.compare.noChange")
    return t(change > 0 ? "dash.compare.increase" : "dash.compare.decrease", { change: number.format(Math.abs(change)) })
  }

  const categoryProfitData = useMemo(() => data?.categories
    .filter((item) => item.profit != null)
    .sort((left, right) => (right.profit ?? 0) - (left.profit ?? 0))
    .map((item) => ({ ...item, label: item.segment === item.category ? categoryLabel(item.category) : item.segment })) ?? [], [data?.categories, locale, t])
  const productProfitData = useMemo(() => data?.products
    .filter((item) => item.profit != null)
    .sort((left, right) => (right.profit ?? 0) - (left.profit ?? 0)) ?? [], [data?.products])
  const agingItems = useMemo(() => data?.inventory.items
    .filter((item) => item.quantity > 0 && (item.status === "slow" || item.status === "dead"))
    .sort((left, right) => (right.daysSinceSale ?? 9999) - (left.daysSinceSale ?? 9999) || (right.value ?? 0) - (left.value ?? 0))
    .slice(0, 7) ?? [], [data?.inventory.items])
  const agingDialogItems = useMemo(() => data?.inventory.items
    .filter((item) => item.quantity > 0 && (agingFilter === "slow" ? item.status === "slow" : agingFilter === "dead" ? item.status === "dead" : item.status === "slow" || item.status === "dead"))
    .sort((left, right) => (right.daysSinceSale ?? 9999) - (left.daysSinceSale ?? 9999) || (right.value ?? 0) - (left.value ?? 0)) ?? [], [agingFilter, data?.inventory.items])
  const planningItems = useMemo(() => data?.inventory.items
    .filter((item) => item.status === "out" || item.status === "low")
    .slice(0, 6) ?? [], [data?.inventory.items])

  const chartConfig: ChartConfig = {
    revenue: { label: t("dash.metric.revenue"), color: "var(--chart-1)" },
    profit: { label: t("dash.metric.grossProfit"), color: "var(--chart-3)" },
  }
  const chartLabel = (name: string) => name === "profit" ? t("dash.metric.grossProfit") : t("dash.metric.revenue")

  return (
    <main className="flex min-w-0 flex-col gap-5 p-3 md:p-5 xl:p-6">
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm" aria-labelledby="dashboard-heading">
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><BarChart3 className="size-5" /></span>
            <div><h1 id="dashboard-heading" className="text-lg font-semibold tracking-tight">{t("dash.strategic.title")}</h1><p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{t("dash.strategic.subtitle")}</p></div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select value={preset} onValueChange={(value) => setPeriod(value as DashboardPeriodPreset)} dir={dir}>
              <SelectTrigger className="w-full sm:w-44" aria-label={t("dash.period.label")}><CalendarRange className="size-4" /><SelectValue /></SelectTrigger>
              <SelectContent dir={dir}>{PERIODS.map((period) => <SelectItem key={period} value={period}>{t(`dash.period.${period}`)}</SelectItem>)}</SelectContent>
            </Select>
            {preset === "custom" && <div className="grid grid-cols-2 gap-2 sm:w-[21rem]"><DatePicker value={range.start} max={range.end} onChange={(start) => setRange((current) => ({ ...current, start }))} aria-label={t("dash.period.start")} /><DatePicker value={range.end} min={range.start} onChange={(end) => setRange((current) => ({ ...current, end }))} aria-label={t("dash.period.end")} /></div>}
            <Button variant="outline" size="icon" onClick={refresh} disabled={refreshing || !validRange} aria-label={t("dash.refresh")}><RefreshCw className={cn("size-4", refreshing && "animate-spin")} /></Button>
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t bg-muted/25 px-5 py-3 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-1.5"><Clock3 className="size-3.5" />{t("dash.strategic.cadenceNote")}</span>
          <span>{periodLabel}{data ? ` · ${t("dash.updatedAt", { date: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(data.generatedAt)) })}` : ""}</span>
        </div>
      </section>

      {!validRange && <Alert variant="destructive"><AlertTriangle /><AlertTitle>{t("dash.error.invalidRange")}</AlertTitle><AlertDescription>{t("dash.error.invalidRangeDescription")}</AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertTriangle /><AlertTitle>{t("dash.error.title")}</AlertTitle><AlertDescription><span>{t("dash.error.description")}</span><Button variant="outline" size="sm" className="mt-2" onClick={refresh}>{t("dash.retry")}</Button></AlertDescription></Alert>}
      {loading && !data ? <DashboardSkeleton /> : data && (
        <>
          {refreshing && <div role="status" className="sr-only">{t("dash.refreshing")}</div>}
          <section aria-labelledby="strategic-kpis-heading">
            <SectionHeading id="strategic-kpis-heading" icon={Gauge} title={t("dash.strategic.kpisTitle")} description={t("dash.strategic.kpisDescription")} />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <DashboardKpiCard label={t("dash.metric.turnover")} value={`${decimal.format(annualTurnover ?? 0)}×`} comparison={annualTurnover == null ? t("dash.capital.insufficient") : annualTurnover >= 4 && annualTurnover <= 6 ? t("dash.turnover.inTarget") : annualTurnover < 4 ? t("dash.turnover.belowTarget") : t("dash.turnover.aboveTarget")} tooltip={<MetricTooltip formula={t("dash.tooltip.turnoverFormula")} meaning={t("dash.tooltip.turnoverMeaning")} note={t("dash.tooltip.turnoverNote")} />} icon={Gauge} trend={null} attention={annualTurnover == null || annualTurnover < 4} onClick={() => navigate("inventory")} openLabel={t("dash.openDetails")} />
              <DashboardKpiCard label={t("dash.metric.grossProfit")} value={formatAccountingAggregate(data.current.profit ?? 0)} comparison={data.current.marginPct == null ? t("dash.coverage", { coverage: number.format(data.current.costCoveragePct) }) : t("dash.margin.value", { margin: number.format(data.current.marginPct) })} tooltip={<MetricTooltip formula={t("dash.tooltip.profitFormula")} meaning={t("dash.tooltip.profitMeaning")} note={t("dash.tooltip.profitNote")} />} icon={CircleDollarSign} trend={data.current.profit == null || data.previous.profit == null ? null : dashboardChangePct(data.current.profit, data.previous.profit)} attention={data.current.profit == null} onClick={() => navigate("sales")} openLabel={t("dash.openDetails")} />
              <DashboardKpiCard label={t("dash.metric.aov")} value={formatAccountingAggregate(averageOrderValue ?? 0)} comparison={changeText(aovChange)} tooltip={<MetricTooltip formula={t("dash.tooltip.aovFormula")} meaning={t("dash.tooltip.aovMeaning")} note={t("dash.tooltip.aovNote")} />} icon={ShoppingBasket} trend={aovChange} onClick={() => navigate("sales")} openLabel={t("dash.openDetails")} />
              <DashboardKpiCard label={t("dash.metric.slowCapital")} value={formatAccountingAggregate(data.inventory.slowCapitalComplete ? data.inventory.slowCapital : 0)} comparison={slowCapitalShare == null ? t("dash.coverage", { coverage: number.format(data.inventory.valuationCoveragePct) }) : t("dash.slowCapital.share", { share: number.format(slowCapitalShare) })} tooltip={<MetricTooltip formula={t("dash.tooltip.slowCapitalFormula")} meaning={t("dash.tooltip.slowCapitalMeaning")} note={t("dash.tooltip.slowCapitalNote")} />} icon={Archive} trend={null} positiveIsGood={false} attention={data.inventory.slowMoving > 0} onClick={() => navigate("inventory")} openLabel={t("dash.openDetails")} />
              <DashboardKpiCard label={t("dash.metric.inventoryDays")} value={t("dash.capital.daysValue", { days: decimal.format(intelligence?.capital.daysInventoryProxy ?? 0) })} comparison={t("dash.inventoryDays.caption")} tooltip={<MetricTooltip formula={t("dash.tooltip.inventoryDaysFormula")} meaning={t("dash.tooltip.inventoryDaysMeaning")} note={t("dash.tooltip.turnoverNote")} />} icon={Clock3} trend={null} attention={intelligence?.capital.daysInventoryProxy == null} onClick={() => navigate("inventory")} openLabel={t("dash.openDetails")} />
            </div>
          </section>

          <section className="grid min-w-0 gap-4 xl:grid-cols-5" aria-labelledby="trend-heading">
            <Card className="min-w-0 overflow-hidden rounded-2xl xl:col-span-3">
              <CardHeader className="pb-2"><SectionHeading id="trend-heading" icon={TrendingUp} title={t("dash.seasonal.title")} description={t("dash.seasonal.description")} tooltip={t("dash.seasonal.tooltip")} /></CardHeader>
              <CardContent>
                {data.current.orderCount === 0 ? <div className="flex h-72 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">{t("dash.empty.sales")}</div> : (
                  <ChartContainer config={chartConfig} className="h-72 w-full" aria-label={t("dash.seasonal.aria")}>
                    <LineChart accessibilityLayer data={trendData} margin={{ left: 4, right: 8 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(value) => formatDateLabel(String(value), locale)} minTickGap={24} />
                      <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(value) => compact.format(convertToDisplay(Number(value)))} />
                      <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, payload) => payload?.[0]?.payload?.date ? formatDateLabel(String(payload[0].payload.date), locale, { year: "numeric", month: "short", day: "numeric" }) : ""} formatter={(value, name) => <div className="flex min-w-40 items-center justify-between gap-4"><span className="text-muted-foreground">{chartLabel(String(name))}</span><span className="font-mono font-medium tabular-nums">{formatAccountingAggregate(Number(value))}</span></div>} />} />
                      <Line type="monotone" dataKey="revenue" stroke="var(--color-revenue)" strokeWidth={2.5} dot={trendData.length <= 12 ? { r: 3 } : false} activeDot={{ r: 4 }} />
                      <Line type="monotone" dataKey="profit" stroke="var(--color-profit)" strokeWidth={2} dot={trendData.length <= 12 ? { r: 3 } : false} connectNulls={false} />
                    </LineChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0 overflow-hidden rounded-2xl xl:col-span-2">
              <CardHeader className="pb-2"><SectionHeading id="category-profit-heading" icon={BarChart3} title={t("dash.categoryProfit.title")} description={t("dash.categoryProfit.description")} tooltip={t("dash.categoryProfit.tooltip")} /></CardHeader>
              <CardContent>
                {categoryProfitData.length === 0 ? <div className="flex h-72 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">{t("dash.empty.categories")}</div> : (
                  <ChartContainer config={chartConfig} className="h-72 w-full" aria-label={t("dash.categoryProfit.aria")}>
                    <BarChart accessibilityLayer data={categoryProfitData} layout="vertical" margin={{ left: 8 }}>
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                      <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(value) => compact.format(convertToDisplay(Number(value)))} />
                      <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={105} tick={{ fontSize: 10 }} />
                      <ChartTooltip content={<ChartTooltipContent formatter={(value) => <span className="font-mono font-medium tabular-nums">{formatAccountingAggregate(Number(value))}</span>} />} />
                      <Bar dataKey="profit" fill="var(--color-profit)" radius={4} />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          </section>

          <section className="grid min-w-0 gap-4 xl:grid-cols-2">
            <Card className="min-w-0 overflow-hidden rounded-2xl">
              <CardHeader className="pb-2"><SectionHeading id="product-profit-heading" icon={CircleDollarSign} title={t("dash.productProfit.title")} description={t("dash.productProfit.description")} tooltip={t("dash.productProfit.tooltip")} /></CardHeader>
              <CardContent className="overflow-x-auto">
                {productProfitData.length === 0 ? <div className="flex h-64 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">{t("dash.empty.products")}</div> : (
                  <table className="w-full min-w-[36rem] text-sm">
                    <thead><tr className="border-b text-xs text-muted-foreground"><th className="pb-2 text-start font-medium">{t("common.name")}</th><th className="pb-2 text-end font-medium">{t("dash.metric.grossProfit")}</th><th className="pb-2 text-end font-medium">{t("dash.metric.margin")}</th><th className="pb-2 text-end font-medium">{t("dash.metric.revenue")}</th><th className="pb-2 text-end font-medium">{t("dash.metric.units")}</th></tr></thead>
                    <tbody>{productProfitData.slice(0, 8).map((product, index) => <tr key={product.key} className="border-b last:border-0">
                      <td className="py-2.5"><button type="button" onClick={() => navigate("sales")} className="flex max-w-64 items-center gap-2 text-start font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] text-muted-foreground">{integer.format(index + 1)}</span><span className="truncate">{product.name}</span></button><div className="ms-7 text-[10px] text-muted-foreground">{categoryLabel(product.category)}</div></td>
                      <td className="py-2.5 text-end font-semibold tabular-nums">{formatAccountingAggregate(product.profit ?? 0)}</td>
                      <td className="py-2.5 text-end tabular-nums">{product.marginPct == null ? "—" : `${number.format(product.marginPct)}%`}</td>
                      <td className="py-2.5 text-end tabular-nums">{formatAccountingAggregate(product.revenue)}</td>
                      <td className="py-2.5 text-end tabular-nums">{integer.format(product.units)}</td>
                    </tr>)}</tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-2xl">
              <CardHeader className="pb-2"><SectionHeading id="aging-heading" icon={PackageSearch} title={t("dash.aging.title")} description={t("dash.aging.description")} tooltip={t("dash.aging.tooltip")} /></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <StatusMetric label={t("dash.inventory.agingTotal")} value={integer.format(data.inventory.slowMoving)} tone={data.inventory.slowMoving ? "warning" : "good"} onClick={() => setAgingFilter("aged")} />
                  <StatusMetric label={t("dash.inventory.slow")} value={integer.format(Math.max(0, data.inventory.slowMoving - data.inventory.deadStock))} tone="warning" onClick={() => setAgingFilter("slow")} />
                  <StatusMetric label={t("dash.inventory.dead")} value={integer.format(data.inventory.deadStock)} tone="danger" onClick={() => setAgingFilter("dead")} />
                </div>
                <InventoryList items={agingItems} empty={t("dash.aging.empty")} formatValue={(item) => formatAccountingAggregate(item.value ?? 0)} categoryLabel={categoryLabel} statusLabel={statusLabel} onOpen={() => navigate("inventory")} />
              </CardContent>
            </Card>
          </section>

          <section aria-labelledby="planning-heading">
            <Card className="overflow-hidden rounded-2xl">
              <CardHeader className="pb-2"><SectionHeading id="planning-heading" icon={PackageCheck} title={t("dash.planning.title")} description={t("dash.planning.description")} tooltip={t("dash.planning.tooltip")} /></CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,1.2fr)]">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
                  <StatusMetric label={t("dash.inventory.low")} value={integer.format(data.inventory.lowStock)} tone={data.inventory.lowStock ? "warning" : "good"} />
                  <StatusMetric label={t("dash.inventory.out")} value={integer.format(data.inventory.outOfStock)} tone={data.inventory.outOfStock ? "danger" : "good"} />
                  <StatusMetric label={t("dash.inventory.overstock")} value={integer.format(intelligence?.capital.overstockItems.length ?? 0)} tone={intelligence?.capital.overstockItems.length ? "warning" : "good"} />
                  <StatusMetric label={t("dash.inventory.recentMoving")} value={integer.format(intelligence?.capital.recentMovingItems.length ?? 0)} />
                </div>
                <InventoryList items={planningItems} empty={t("dash.planning.empty")} formatValue={(item) => t("dash.inventory.quantity", { count: integer.format(item.quantity) })} categoryLabel={categoryLabel} statusLabel={statusLabel} onOpen={() => navigate("inventory")} />
              </CardContent>
            </Card>
          </section>
          <AgingProductsDialog filter={agingFilter} items={agingDialogItems} onClose={() => setAgingFilter(null)} formatValue={formatAccountingAggregate} categoryLabel={categoryLabel} statusLabel={statusLabel} integer={integer} t={t} onOpenInventory={() => { setAgingFilter(null); navigate("inventory") }} />
        </>
      )}
    </main>
  )
}
