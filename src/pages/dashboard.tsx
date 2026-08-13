import { useMemo, useState } from "react"
import {
  AlertTriangle, Banknote, BadgeDollarSign, CalendarRange, CircleDollarSign, Clock3,
  Gauge, Layers3, Package, PackageSearch, Percent, RefreshCw, TrendingUp, Truck, WalletCards,
} from "lucide-react"
import { DashboardKpiCard } from "@/components/dashboard/dashboard-kpi-card"
import { DashboardInsightsPanel, type DashboardInsightView } from "@/components/dashboard/dashboard-insights-panel"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { DatePicker } from "@/components/ui/date-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { useDashboardAnalytics } from "@/hooks/use-dashboard-analytics"
import { useCurrency } from "@/lib/currency-context"
import { buildDashboardInsights, dashboardChangePct } from "@/lib/dashboard/insights"
import { deriveDashboardIntelligence } from "@/lib/dashboard/intelligence"
import { completeDashboardTrend, dashboardRangeForPreset, isValidDashboardRange } from "@/lib/dashboard/period"
import type { DashboardInventoryItem, DashboardPeriodPreset } from "@/lib/dashboard/types"
import { useI18n } from "@/lib/i18n"
import { useNav, type PageKey } from "@/lib/nav"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

const PERIODS: DashboardPeriodPreset[] = ["today", "week", "month", "quarter", "year", "custom"]

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-36" />)}</div>
      <div className="grid gap-4 xl:grid-cols-3"><Skeleton className="h-80 xl:col-span-2" /><Skeleton className="h-80" /></div>
      <div className="grid gap-4 xl:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
    </div>
  )
}

function formatDateLabel(value: string, locale: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat(locale === "ar-SA" ? "ar-SA-u-ca-gregory" : locale, options).format(new Date(`${value}T00:00:00`))
}

function IntelligenceMetric({ label, value, attention = false }: { label: string; value: string; attention?: boolean }) {
  return <div className={cn("rounded-xl border bg-muted/20 p-3", attention && "border-status-reserved/40 bg-status-reserved/5")}><div className="text-[10px] leading-tight text-muted-foreground">{label}</div><div className={cn("mt-1 text-base font-semibold tabular-nums", attention && "text-status-reserved-fg")}>{value}</div></div>
}

function ItemEvidenceList({ items, empty, value, subtitle }: {
  items: DashboardInventoryItem[]
  empty: string
  value: (item: DashboardInventoryItem) => string
  subtitle: (item: DashboardInventoryItem) => string
}) {
  if (!items.length) return <p className="rounded-lg border border-dashed p-5 text-center text-xs text-muted-foreground">{empty}</p>
  return <div className="space-y-2">{items.map((item) => <div key={`${item.category}:${item.id}`} className="flex items-center justify-between gap-3 rounded-lg border p-2.5"><div className="min-w-0"><div className="truncate text-xs font-medium">{item.name}</div><div className="truncate text-[10px] text-muted-foreground">{subtitle(item)}</div></div><div className="shrink-0 text-xs font-semibold tabular-nums">{value(item)}</div></div>)}</div>
}

export function DashboardPage() {
  const { t, locale, dir } = useI18n()
  const { navigate, setFinancialFilter } = useNav()
  const { formatAccountingAggregate, convertToDisplay } = useCurrency()
  const [preset, setPreset] = useState<DashboardPeriodPreset>("quarter")
  const [range, setRange] = useState(() => dashboardRangeForPreset("quarter"))
  const validRange = isValidDashboardRange(range)
  const { data, loading, refreshing, error, refresh } = useDashboardAnalytics(range, validRange)

  const number = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale])
  const integer = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }), [locale])
  const compact = useMemo(() => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }), [locale])

  const insights = useMemo(() => data ? buildDashboardInsights(data) : [], [data])
  const trendData = useMemo(() => data ? completeDashboardTrend(data.trend, data.period) : [], [data])
  const insightViews = useMemo<DashboardInsightView[]>(() => insights.map((insight) => {
    const params = { ...insight.params }
    if (typeof params.amount === "number") params.amount = formatAccountingAggregate(params.amount)
    for (const key of ["share", "coverage", "margin", "average", "change"]) {
      if (typeof params[key] === "number") params[key] = number.format(params[key])
    }
    return {
      id: insight.id,
      priority: insight.priority,
      priorityLabel: t(`dash.priority.${insight.priority}`),
      title: t(insight.titleKey, params),
      description: t(insight.descriptionKey, params),
      action: insight.actionKey ? t(insight.actionKey) : undefined,
      onOpen: insight.page ? () => {
        if (insight.page === "financials" && insight.id === "overdue-receivables") setFinancialFilter("overdue")
        navigate(insight.page as PageKey)
      } : undefined,
    }
  }), [formatAccountingAggregate, insights, navigate, number, setFinancialFilter, t])

  const setPeriod = (value: DashboardPeriodPreset) => {
    setPreset(value)
    if (value !== "custom") setRange(dashboardRangeForPreset(value))
  }

  const changeText = (change: number | null) => {
    if (change == null) return t("dash.compare.noBaseline")
    if (change === 0) return t("dash.compare.noChange")
    return t(change > 0 ? "dash.compare.increase" : "dash.compare.decrease", { change: number.format(Math.abs(change)) })
  }

  const chartConfig: ChartConfig = {
    revenue: { label: t("dash.metric.revenue"), color: "var(--chart-1)" },
    profit: { label: t("dash.metric.grossProfit"), color: "var(--chart-3)" },
  }
  const chartLabel = (name: string) => name === "profit" ? t("dash.metric.grossProfit") : t("dash.metric.revenue")

  const categoryLabel = (category: string) => t(`dash.category.${category}`)
  const periodLabel = `${formatDateLabel(range.start, locale, { year: "numeric", month: "short", day: "numeric" })} – ${formatDateLabel(range.end, locale, { year: "numeric", month: "short", day: "numeric" })}`

  const inventoryAttentionItems = useMemo(
    () => data?.inventory.items.filter((item) => item.status !== "active").slice(0, 6) ?? [],
    [data],
  )

  const categoryChartData = useMemo(() => data?.categories.map((item) => ({
    ...item,
    label: item.segment === item.category ? categoryLabel(item.category) : item.segment,
  })) ?? [], [data?.categories, locale, t])
  const intelligence = useMemo(() => data ? deriveDashboardIntelligence(data) : null, [data])
  const productProfitChartData = useMemo(() => data?.products
    .filter((product) => product.profit != null)
    .sort((left, right) => (right.profit ?? 0) - (left.profit ?? 0))
    .slice(0, 7)
    .map((product) => ({ ...product, shortName: product.name.length > 22 ? `${product.name.slice(0, 20)}…` : product.name })) ?? [], [data?.products])
  const receivableInvoiceCount = useStore((state) => state.invoices.filter((invoice) => !invoice.voided && invoice.type === "Sale" && invoice.balance > 0.01).length)
  const overdueInvoiceCount = useStore((state) => state.invoices.filter((invoice) => !invoice.voided && invoice.type === "Sale" && invoice.balance > 0.01 && invoice.dueDate < new Date().toISOString().slice(0, 10)).length)
  const shipmentValue = useMemo(() => data?.shipments.recent.reduce((sum, shipment) => sum + (shipment.value ?? 0), 0) ?? 0, [data?.shipments.recent])
  const shipmentValueCoverage = useMemo(() => data?.shipments.recent.length ? data.shipments.recent.filter((shipment) => shipment.value != null).length / data.shipments.recent.length * 100 : 0, [data?.shipments.recent])
  const mostActiveSupplier = useMemo(() => {
    const counts = new Map<string, number>()
    for (const shipment of data?.shipments.recent ?? []) {
      if (shipment.supplierName) counts.set(shipment.supplierName, (counts.get(shipment.supplierName) ?? 0) + 1)
    }
    return [...counts].sort((left, right) => right[1] - left[1])[0] ?? null
  }, [data?.shipments.recent])

  return (
    <main className="flex min-w-0 flex-col gap-5 p-3 md:p-5 xl:p-6">
      <section className="flex flex-col gap-3 rounded-2xl border bg-card p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between" aria-labelledby="dashboard-heading">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><TrendingUp className="size-5" /></span>
            <div>
              <h1 id="dashboard-heading" className="text-lg font-semibold tracking-tight">{t("dash.title")}</h1>
              <p className="text-xs text-muted-foreground">{t("dash.subtitle")}</p>
            </div>
          </div>
          {data && <p className="mt-2 text-[11px] text-muted-foreground">{t("dash.updatedAt", { date: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(data.generatedAt)) })}</p>}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={preset} onValueChange={(value) => setPeriod(value as DashboardPeriodPreset)} dir={dir}>
            <SelectTrigger className="w-full sm:w-44" aria-label={t("dash.period.label")}><CalendarRange className="size-4" /><SelectValue /></SelectTrigger>
            <SelectContent dir={dir}>{PERIODS.map((period) => <SelectItem key={period} value={period}>{t(`dash.period.${period}`)}</SelectItem>)}</SelectContent>
          </Select>
          {preset === "custom" && (
            <div className="grid grid-cols-2 gap-2 sm:w-[21rem]">
              <DatePicker value={range.start} max={range.end} onChange={(start) => setRange((current) => ({ ...current, start }))} aria-label={t("dash.period.start")} />
              <DatePicker value={range.end} min={range.start} onChange={(end) => setRange((current) => ({ ...current, end }))} aria-label={t("dash.period.end")} />
            </div>
          )}
          <Button variant="outline" size="icon" onClick={refresh} disabled={refreshing || !validRange} aria-label={t("dash.refresh")}>
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
          </Button>
        </div>
      </section>

      {!validRange && <Alert variant="destructive"><AlertTriangle /><AlertTitle>{t("dash.error.invalidRange")}</AlertTitle><AlertDescription>{t("dash.error.invalidRangeDescription")}</AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertTriangle /><AlertTitle>{t("dash.error.title")}</AlertTitle><AlertDescription><span>{t("dash.error.description")}</span><Button variant="outline" size="sm" className="mt-2" onClick={refresh}>{t("dash.retry")}</Button></AlertDescription></Alert>}
      {loading && !data ? <DashboardSkeleton /> : data && (
        <>
          {refreshing && <div role="status" className="sr-only">{t("dash.refreshing")}</div>}
          <section aria-labelledby="overview-heading">
            <div className="mb-2 flex items-end justify-between gap-3">
              <div><h2 id="overview-heading" className="text-sm font-semibold">{t("dash.section.overview")}</h2><p className="text-xs text-muted-foreground">{periodLabel}</p></div>
              <span className="text-[11px] text-muted-foreground">{t("dash.compare.previousEquivalent")}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <DashboardKpiCard label={t("dash.metric.revenue")} value={formatAccountingAggregate(data.current.revenue)} comparison={changeText(dashboardChangePct(data.current.revenue, data.previous.revenue))} tooltip={t("dash.tooltip.revenue")} icon={TrendingUp} trend={dashboardChangePct(data.current.revenue, data.previous.revenue)} />
              <DashboardKpiCard label={t("dash.metric.cost")} value={data.current.costCoveragePct >= 95 ? formatAccountingAggregate(data.current.cost) : t("common.notAvailable")} comparison={t("dash.coverage", { coverage: number.format(data.current.costCoveragePct) })} tooltip={t("dash.tooltip.cost")} icon={WalletCards} trend={dashboardChangePct(data.current.cost, data.previous.cost)} positiveIsGood={false} attention={data.current.costCoveragePct < 95} />
              <DashboardKpiCard label={t("dash.metric.grossProfit")} value={data.current.profit == null ? t("common.notAvailable") : formatAccountingAggregate(data.current.profit)} comparison={data.current.profit == null ? t("dash.coverage", { coverage: number.format(data.current.costCoveragePct) }) : changeText(data.previous.profit == null ? null : dashboardChangePct(data.current.profit, data.previous.profit))} tooltip={t("dash.tooltip.grossProfit")} icon={CircleDollarSign} trend={data.current.profit == null || data.previous.profit == null ? null : dashboardChangePct(data.current.profit, data.previous.profit)} attention={data.current.profit == null} />
              <DashboardKpiCard label={t("dash.metric.margin")} value={data.current.marginPct == null ? t("common.notAvailable") : `${number.format(data.current.marginPct)}%`} comparison={data.current.marginPct == null || data.previous.marginPct == null ? t("dash.coverage", { coverage: number.format(data.current.costCoveragePct) }) : t("dash.compare.points", { change: number.format(data.current.marginPct - data.previous.marginPct) })} tooltip={t("dash.tooltip.margin")} icon={Percent} trend={data.current.marginPct == null || data.previous.marginPct == null ? null : data.current.marginPct - data.previous.marginPct} attention={data.current.marginPct == null} />
              <DashboardKpiCard label={t("dash.metric.inventoryValue")} value={data.inventory.valueComplete ? formatAccountingAggregate(data.inventory.value) : t("common.notAvailable")} comparison={data.inventory.valueComplete ? t("dash.inventory.unitsValue", { count: integer.format(data.inventory.units) }) : t("dash.coverage", { coverage: number.format(data.inventory.valuationCoveragePct) })} tooltip={t("dash.tooltip.inventoryValue")} icon={Package} trend={null} attention={!data.inventory.valueComplete} />
              <DashboardKpiCard label={t("dash.metric.receivables")} value={formatAccountingAggregate(data.current.receivables)} comparison={data.current.overdue > 0 ? t("dash.overdueAmount", { amount: formatAccountingAggregate(data.current.overdue) }) : t("dash.noOverdue")} tooltip={t("dash.tooltip.receivables")} icon={Banknote} trend={dashboardChangePct(data.current.receivables, data.previous.receivables)} positiveIsGood={false} attention={data.current.overdue > 0} />
            </div>
          </section>

          <section className="grid min-w-0 gap-4 xl:grid-cols-3" aria-label={t("dash.section.performance")}>
            <Card className="min-w-0 overflow-hidden rounded-2xl xl:col-span-2">
              <CardHeader><CardTitle className="text-base">{t("dash.chart.salesTrend")}</CardTitle><CardDescription>{t("dash.chart.salesTrendDescription")}</CardDescription></CardHeader>
              <CardContent>
                {data.current.orderCount === 0 ? <div className="flex h-72 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">{t("dash.empty.sales")}</div> : (
                  <ChartContainer config={chartConfig} className="h-72 w-full" aria-label={t("dash.chart.salesTrendAria")}>
                    <LineChart accessibilityLayer data={trendData} margin={{ left: 4, right: 8 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(value) => formatDateLabel(String(value), locale)} minTickGap={24} />
                      <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(value) => compact.format(convertToDisplay(Number(value)))} />
                      <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, payload) => payload?.[0]?.payload?.date ? formatDateLabel(String(payload[0].payload.date), locale, { year: "numeric", month: "short", day: "numeric" }) : ""} formatter={(value, name) => <div className="flex min-w-40 items-center justify-between gap-4"><span className="text-muted-foreground">{chartLabel(String(name))}</span><span className="font-mono font-medium tabular-nums">{formatAccountingAggregate(Number(value))}</span></div>} />} />
                      <Line type="monotone" dataKey="revenue" stroke="var(--color-revenue)" strokeWidth={2.5} dot={trendData.length === 1 ? { r: 4 } : false} activeDot={{ r: 4 }} />
                      <Line type="monotone" dataKey="profit" stroke="var(--color-profit)" strokeWidth={2} dot={trendData.length === 1 ? { r: 4 } : false} connectNulls={false} />
                    </LineChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0 overflow-hidden rounded-2xl">
              <CardHeader><CardTitle className="text-base">{t("dash.chart.categoryPerformance")}</CardTitle><CardDescription>{t("dash.chart.categoryPerformanceDescription")}</CardDescription></CardHeader>
              <CardContent>
                {data.categories.length === 0 ? <div className="flex h-72 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">{t("dash.empty.categories")}</div> : (
                  <ChartContainer config={chartConfig} className="h-72 w-full" aria-label={t("dash.chart.categoryAria")}>
                    <BarChart accessibilityLayer data={categoryChartData} layout="vertical" margin={{ left: 10 }}>
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                      <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(value) => compact.format(convertToDisplay(Number(value)))} />
                      <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={96} tick={{ fontSize: 11 }} />
                      <ChartTooltip content={<ChartTooltipContent formatter={(value, name) => <div className="flex min-w-40 items-center justify-between gap-4"><span className="text-muted-foreground">{chartLabel(String(name))}</span><span className="font-mono font-medium tabular-nums">{formatAccountingAggregate(Number(value))}</span></div>} />} />
                      <Bar dataKey="revenue" fill="var(--color-revenue)" radius={3} />
                      <Bar dataKey="profit" fill="var(--color-profit)" radius={3} />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          </section>

          <section className="grid min-w-0 gap-4 xl:grid-cols-2">
            <Card className="min-w-0 overflow-hidden rounded-2xl">
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div><CardTitle className="text-base">{t("dash.products.title")}</CardTitle><CardDescription>{t("dash.products.description")}</CardDescription></div>
                <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label={t("dash.tooltip.concentration")}><AlertTriangle className={cn("size-4", data.concentration.topThreeSharePct >= 70 && "text-status-reserved-fg")} /></Button></TooltipTrigger><TooltipContent className="max-w-72">{t("dash.concentration.summary", { share: number.format(data.concentration.topThreeSharePct) })}</TooltipContent></Tooltip>
              </CardHeader>
              <CardContent className="overflow-x-auto pt-1">
                {data.products.length === 0 ? <div className="flex h-52 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">{t("dash.empty.products")}</div> : (
                  <table className="w-full min-w-[38rem] text-sm">
                    <thead><tr className="border-b text-start text-xs text-muted-foreground"><th className="pb-2 text-start font-medium">{t("common.name")}</th><th className="pb-2 text-end font-medium">{t("dash.metric.revenue")}</th><th className="pb-2 text-end font-medium">{t("dash.metric.grossProfit")}</th><th className="pb-2 text-end font-medium">{t("dash.metric.margin")}</th><th className="pb-2 text-end font-medium">{t("dash.metric.units")}</th></tr></thead>
                    <tbody>{data.products.slice(0, 8).map((product) => <tr key={product.key} className="border-b last:border-0">
                      <td className="py-2.5"><Button variant="link" className="h-auto max-w-64 justify-start p-0 text-start" onClick={() => navigate("sales")}><span className="truncate">{product.name}</span></Button><div className="text-[10px] text-muted-foreground">{categoryLabel(product.category)}</div></td>
                      <td className="py-2.5 text-end font-medium tabular-nums">{formatAccountingAggregate(product.revenue)}</td>
                      <td className="py-2.5 text-end font-medium tabular-nums">{product.profit == null ? <span className="text-muted-foreground" title={t("dash.coverage", { coverage: number.format(product.costCoveragePct) })}>—</span> : formatAccountingAggregate(product.profit)}</td>
                      <td className="py-2.5 text-end tabular-nums">{product.marginPct == null ? <span className="text-muted-foreground" title={t("dash.coverage", { coverage: number.format(product.costCoveragePct) })}>—</span> : `${number.format(product.marginPct)}%`}</td>
                      <td className="py-2.5 text-end tabular-nums">{integer.format(product.units)}</td>
                    </tr>)}</tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0 overflow-hidden rounded-2xl">
              <CardHeader><CardTitle className="text-base">{t("dash.inventory.title")}</CardTitle><CardDescription>{t("dash.inventory.description")}</CardDescription></CardHeader>
              <CardContent>
                <div className="mb-4 grid grid-cols-3 gap-3">
                  <div className="rounded-xl border bg-muted/20 p-3"><div className="text-[10px] text-muted-foreground">{t("dash.inventory.low")}</div><div className="mt-1 text-lg font-semibold tabular-nums">{integer.format(data.inventory.lowStock)}</div></div>
                  <div className="rounded-xl border bg-muted/20 p-3"><div className="text-[10px] text-muted-foreground">{t("dash.inventory.out")}</div><div className="mt-1 text-lg font-semibold tabular-nums">{integer.format(data.inventory.outOfStock)}</div></div>
                  <div className="rounded-xl border bg-muted/20 p-3"><div className="text-[10px] text-muted-foreground">{t("dash.inventory.slow")}</div><div className="mt-1 text-lg font-semibold tabular-nums">{integer.format(data.inventory.slowMoving)}</div></div>
                </div>
                {data.inventory.items.filter((item) => item.status !== "active").length === 0 ? <div className="flex h-36 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">{t("dash.empty.inventoryAttention")}</div> : (
                  <div className="space-y-2.5">{inventoryAttentionItems.map((item) => (
                    <button key={`${item.category}:${item.id}`} type="button" onClick={() => navigate("inventory")} className="flex w-full items-center justify-between gap-3 rounded-lg border p-2.5 text-start hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="min-w-0"><span className="block truncate text-sm font-medium">{item.name}</span><span className="text-[10px] text-muted-foreground">{categoryLabel(item.category)} · {t("dash.inventory.quantity", { count: integer.format(item.quantity) })}</span></span>
                      <Badge variant="outline" className={cn("shrink-0 text-[10px]", item.status === "out" && "border-status-sold/30 text-status-sold-fg", item.status === "low" && "border-status-reserved/30 text-status-reserved-fg")}>{t(`dash.inventory.status.${item.status}`)}</Badge>
                    </button>
                  ))}</div>
                )}
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2"><DashboardInsightsPanel title={t("dash.insights.title")} description={t("dash.insights.description")} empty={t("dash.insights.empty")} insights={insightViews} /></div>
            <Card className="overflow-hidden rounded-2xl">
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BadgeDollarSign className="size-4 text-primary" />{t("dash.opportunity.title")}</CardTitle><CardDescription>{t("dash.opportunity.description")}</CardDescription></CardHeader>
              <CardContent className="space-y-2">
                {intelligence?.productSignals.map((signal) => (
                  <article key={`${signal.kind}:${signal.product.key}`} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2"><h3 className="truncate text-sm font-medium">{signal.product.name}</h3><Badge variant="outline" className="shrink-0 text-[9px]">{t(`dash.signal.${signal.kind}`)}</Badge></div>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("dash.opportunity.productEvidence", { revenue: formatAccountingAggregate(signal.product.revenue), profit: signal.product.profit == null ? "—" : formatAccountingAggregate(signal.product.profit), margin: signal.product.marginPct == null ? "—" : number.format(signal.product.marginPct), categoryMargin: number.format(signal.categoryMarginPct) })}</p>
                  </article>
                ))}
                {!intelligence?.productSignals.length && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("dash.opportunity.empty")}</p>}
              </CardContent>
            </Card>
          </section>

          <section className="grid min-w-0 gap-4 xl:grid-cols-3">
            <Card className="min-w-0 overflow-hidden rounded-2xl xl:col-span-2">
              <CardHeader><CardTitle className="text-base">{t("dash.profitByProduct.title")}</CardTitle><CardDescription>{t("dash.profitByProduct.description")}</CardDescription></CardHeader>
              <CardContent>
                {productProfitChartData.length ? (
                  <ChartContainer config={chartConfig} className="h-72 w-full" aria-label={t("dash.profitByProduct.aria")}>
                    <BarChart accessibilityLayer data={productProfitChartData} layout="vertical" margin={{ left: 12 }}>
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                      <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(value) => compact.format(convertToDisplay(Number(value)))} />
                      <YAxis type="category" dataKey="shortName" tickLine={false} axisLine={false} width={120} tick={{ fontSize: 10 }} />
                      <ChartTooltip content={<ChartTooltipContent formatter={(value) => <span className="font-mono font-medium tabular-nums">{formatAccountingAggregate(Number(value))}</span>} />} />
                      <Bar dataKey="profit" fill="var(--color-profit)" radius={4} />
                    </BarChart>
                  </ChartContainer>
                ) : <div className="flex h-72 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">{t("dash.empty.products")}</div>}
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-2xl">
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Gauge className="size-4 text-primary" />{t("dash.capital.title")}</CardTitle><CardDescription>{t("dash.capital.description")}</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <IntelligenceMetric label={t("dash.capital.tied")} value={data.inventory.valueComplete ? formatAccountingAggregate(data.inventory.value) : t("common.notAvailable")} />
                  <IntelligenceMetric label={t("dash.capital.slow")} value={data.inventory.slowCapitalComplete ? formatAccountingAggregate(data.inventory.slowCapital) : t("common.notAvailable")} attention={data.inventory.slowCapital > 0} />
                  <IntelligenceMetric label={t("dash.capital.turnover")} value={intelligence?.capital.turnoverProxy == null ? t("common.notAvailable") : `${number.format(intelligence.capital.turnoverProxy)}×`} />
                  <IntelligenceMetric label={t("dash.capital.days")} value={intelligence?.capital.daysInventoryProxy == null ? t("common.notAvailable") : t("dash.capital.daysValue", { days: integer.format(Math.round(intelligence.capital.daysInventoryProxy)) })} />
                </div>
                <p className="text-[10px] leading-relaxed text-muted-foreground">{intelligence?.capital.turnoverProxy == null ? t("dash.capital.insufficient") : t("dash.capital.method")}</p>
                {intelligence?.capital.slowCapitalSharePct != null && <div className="rounded-lg border p-3"><div className="flex items-center justify-between text-xs"><span>{t("dash.capital.slowShare")}</span><span className="font-semibold tabular-nums">{number.format(intelligence.capital.slowCapitalSharePct)}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-status-reserved" style={{ width: `${Math.min(100, intelligence.capital.slowCapitalSharePct)}%` }} /></div></div>}
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <Card className="overflow-hidden rounded-2xl">
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><PackageSearch className="size-4 text-primary" />{t("dash.inventory.intelligenceTitle")}</CardTitle><CardDescription>{t("dash.inventory.intelligenceDescription")}</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <IntelligenceMetric label={t("dash.inventory.overstock")} value={integer.format(intelligence?.capital.overstockItems.length ?? 0)} attention={Boolean(intelligence?.capital.overstockItems.length)} />
                  <IntelligenceMetric label={t("dash.inventory.dead")} value={integer.format(data.inventory.deadStock)} attention={data.inventory.deadStock > 0} />
                  <IntelligenceMetric label={t("dash.inventory.recentMoving")} value={integer.format(intelligence?.capital.recentMovingItems.length ?? 0)} />
                </div>
                <ItemEvidenceList items={intelligence?.capital.highValueItems.slice(0, 4) ?? []} empty={t("dash.inventory.noValuation")} value={(item) => item.value == null ? "—" : formatAccountingAggregate(item.value)} subtitle={(item) => `${categoryLabel(item.category)} · ${integer.format(item.quantity)} ${t("dash.metric.units")}`} />
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-2xl">
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Layers3 className="size-4 text-primary" />{t("dash.pricing.title")}</CardTitle><CardDescription>{t("dash.pricing.description")}</CardDescription></CardHeader>
              <CardContent>
                <ItemEvidenceList items={intelligence?.pricingReviewItems.slice(0, 5) ?? []} empty={t("dash.pricing.empty")} value={(item) => item.marginPct == null ? t("common.notAvailable") : `${number.format(item.marginPct)}%`} subtitle={(item) => item.shipmentCostSharePct != null && item.shipmentCostSharePct >= 15 ? t("dash.pricing.shipmentImpact", { share: number.format(item.shipmentCostSharePct) }) : t("dash.pricing.lowMargin")} />
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-2xl">
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Banknote className="size-4 text-primary" />{t("dash.receivables.title")}</CardTitle><CardDescription>{t("dash.receivables.description")}</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2"><IntelligenceMetric label={t("dash.metric.receivables")} value={formatAccountingAggregate(data.current.receivables)} /><IntelligenceMetric label={t("dash.receivables.overdue")} value={formatAccountingAggregate(data.current.overdue)} attention={data.current.overdue > 0} /></div>
                <div className="grid grid-cols-2 gap-2"><IntelligenceMetric label={t("dash.receivables.openInvoices")} value={integer.format(receivableInvoiceCount)} /><IntelligenceMetric label={t("dash.receivables.overdueInvoices")} value={integer.format(overdueInvoiceCount)} attention={overdueInvoiceCount > 0} /></div>
                <p className="text-[10px] leading-relaxed text-muted-foreground">{data.current.overdue > 0 ? t("dash.receivables.attention") : t("dash.receivables.clear")}</p>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4" aria-labelledby="operations-heading">
            <Card className="overflow-hidden rounded-2xl">
              <CardHeader><CardTitle id="operations-heading" className="text-base">{t("dash.shipments.title")}</CardTitle><CardDescription>{t("dash.shipments.description")}</CardDescription></CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {[{ key: "pending", value: data.shipments.pending, icon: Clock3 }, { key: "inTransit", value: data.shipments.inTransit, icon: Truck }, { key: "delayed", value: data.shipments.delayed, icon: AlertTriangle }].map(({ key, value, icon: Icon }) => <div key={key} className="flex items-center gap-3 rounded-lg border p-3"><span className="flex size-8 items-center justify-center rounded-md bg-muted"><Icon className="size-4" /></span><div><div className="text-lg font-semibold tabular-nums">{integer.format(value)}</div><div className="text-[10px] text-muted-foreground">{t(`dash.shipments.${key}`)}</div></div></div>)}
                  <div className="flex items-center gap-3 rounded-lg border p-3"><span className="flex size-8 items-center justify-center rounded-md bg-muted"><WalletCards className="size-4" /></span><div><div className="text-lg font-semibold tabular-nums">{shipmentValueCoverage >= 95 ? formatAccountingAggregate(shipmentValue) : t("common.notAvailable")}</div><div className="text-[10px] text-muted-foreground">{t("dash.shipments.recentValue")}</div></div></div>
                </div>
                {mostActiveSupplier && <p className="mt-3 rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{t("dash.shipments.mostActiveSupplier", { supplier: mostActiveSupplier[0], count: integer.format(mostActiveSupplier[1]) })}</p>}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">{data.shipments.recent.slice(0, 4).map((shipment) => <button type="button" key={shipment.id} onClick={() => navigate("shipments")} className="flex items-center justify-between rounded-lg border p-2.5 text-start hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span><span className="block font-mono text-xs font-medium">{shipment.shipmentNumber}</span><span className="text-[10px] text-muted-foreground">{shipment.supplierName || t("common.notAvailable")} · {formatDateLabel(shipment.expectedArrivalDate, locale)}</span></span><Badge variant="outline" className="text-[10px]">{t(`status.${shipment.status}`)}</Badge></button>)}</div>
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </main>
  )
}
