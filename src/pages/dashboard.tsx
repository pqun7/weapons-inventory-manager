import { useMemo, useState } from "react"
import {
  AlertTriangle, ArrowRight, Banknote, Boxes, CalendarRange, CircleDollarSign, Clock3,
  Package, Percent, RefreshCw, ShoppingCart, TrendingUp, Truck,
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
import { completeDashboardTrend, dashboardRangeForPreset, isValidDashboardRange } from "@/lib/dashboard/period"
import type { DashboardPeriodPreset } from "@/lib/dashboard/types"
import { useI18n } from "@/lib/i18n"
import { useNav, type PageKey } from "@/lib/nav"
import { cn } from "@/lib/utils"

const PERIODS: DashboardPeriodPreset[] = ["today", "week", "month", "quarter", "year", "custom"]

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-36" />)}</div>
      <div className="grid gap-4 xl:grid-cols-3"><Skeleton className="h-80 xl:col-span-2" /><Skeleton className="h-80" /></div>
      <div className="grid gap-4 xl:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
    </div>
  )
}

function formatDateLabel(value: string, locale: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat(locale === "ar-SA" ? "ar-SA-u-ca-gregory" : locale, options).format(new Date(`${value}T00:00:00`))
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

  return (
    <main className="flex min-w-0 flex-col gap-4 p-3 md:p-4 xl:p-5">
      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between" aria-labelledby="dashboard-heading">
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
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <DashboardKpiCard label={t("dash.metric.revenue")} value={formatAccountingAggregate(data.current.revenue)} comparison={changeText(dashboardChangePct(data.current.revenue, data.previous.revenue))} tooltip={t("dash.tooltip.revenue")} icon={TrendingUp} trend={dashboardChangePct(data.current.revenue, data.previous.revenue)} onClick={() => navigate("sales")} openLabel={t("dash.openDetails")} />
              <DashboardKpiCard label={t("dash.metric.grossProfit")} value={data.current.profit == null ? t("common.notAvailable") : formatAccountingAggregate(data.current.profit)} comparison={data.current.profit == null ? t("dash.coverage", { coverage: number.format(data.current.costCoveragePct) }) : changeText(data.previous.profit == null ? null : dashboardChangePct(data.current.profit, data.previous.profit))} tooltip={t("dash.tooltip.grossProfit")} icon={CircleDollarSign} trend={data.current.profit == null || data.previous.profit == null ? null : dashboardChangePct(data.current.profit, data.previous.profit)} attention={data.current.profit == null} onClick={() => navigate("sales")} openLabel={t("dash.openDetails")} />
              <DashboardKpiCard label={t("dash.metric.margin")} value={data.current.marginPct == null ? t("common.notAvailable") : `${number.format(data.current.marginPct)}%`} comparison={data.current.marginPct == null || data.previous.marginPct == null ? t("dash.coverage", { coverage: number.format(data.current.costCoveragePct) }) : t("dash.compare.points", { change: number.format(data.current.marginPct - data.previous.marginPct) })} tooltip={t("dash.tooltip.margin")} icon={Percent} trend={data.current.marginPct == null || data.previous.marginPct == null ? null : data.current.marginPct - data.previous.marginPct} attention={data.current.marginPct == null} onClick={() => navigate("sales")} openLabel={t("dash.openDetails")} />
              <DashboardKpiCard label={t("dash.metric.inventoryValue")} value={data.inventory.valueComplete ? formatAccountingAggregate(data.inventory.value) : t("common.notAvailable")} comparison={data.inventory.valueComplete ? t("dash.asOfNow") : t("dash.coverage", { coverage: number.format(data.inventory.valuationCoveragePct) })} tooltip={t("dash.tooltip.inventoryValue")} icon={Package} trend={null} attention={!data.inventory.valueComplete} onClick={() => navigate("inventory")} openLabel={t("dash.openDetails")} />
              <DashboardKpiCard label={t("dash.metric.receivables")} value={formatAccountingAggregate(data.current.receivables)} comparison={data.current.overdue > 0 ? t("dash.overdueAmount", { amount: formatAccountingAggregate(data.current.overdue) }) : t("dash.noOverdue")} tooltip={t("dash.tooltip.receivables")} icon={Banknote} trend={dashboardChangePct(data.current.receivables, data.previous.receivables)} positiveIsGood={false} attention={data.current.overdue > 0} onClick={() => navigate("financials")} openLabel={t("dash.openDetails")} />
            </div>
          </section>

          <section className="grid min-w-0 gap-4 xl:grid-cols-3" aria-label={t("dash.section.performance")}>
            <Card className="min-w-0 xl:col-span-2">
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div><CardTitle className="text-base">{t("dash.chart.salesTrend")}</CardTitle><CardDescription>{t("dash.chart.salesTrendDescription")}</CardDescription></div>
                <Button variant="ghost" size="sm" onClick={() => navigate("sales")}>{t("dash.viewDetails")}<ArrowRight className="size-3.5 rtl:rotate-180" /></Button>
              </CardHeader>
              <CardContent>
                {data.current.orderCount === 0 ? <div className="flex h-64 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">{t("dash.empty.sales")}</div> : (
                  <ChartContainer config={chartConfig} className="h-64 w-full" aria-label={t("dash.chart.salesTrendAria")}>
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

            <Card className="min-w-0">
              <CardHeader><CardTitle className="text-base">{t("dash.chart.categoryPerformance")}</CardTitle><CardDescription>{t("dash.chart.categoryPerformanceDescription")}</CardDescription></CardHeader>
              <CardContent>
                {data.categories.length === 0 ? <div className="flex h-64 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">{t("dash.empty.categories")}</div> : (
                  <ChartContainer config={chartConfig} className="h-64 w-full" aria-label={t("dash.chart.categoryAria")}>
                    <BarChart accessibilityLayer data={data.categories.map((item) => ({ ...item, label: item.segment === item.category ? categoryLabel(item.category) : item.segment }))} layout="vertical" margin={{ left: 10 }}>
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
            <Card className="min-w-0">
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div><CardTitle className="text-base">{t("dash.products.title")}</CardTitle><CardDescription>{t("dash.products.description")}</CardDescription></div>
                <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label={t("dash.tooltip.concentration")}><AlertTriangle className={cn("size-4", data.concentration.topThreeSharePct >= 70 && "text-status-reserved-fg")} /></Button></TooltipTrigger><TooltipContent className="max-w-72">{t("dash.concentration.summary", { share: number.format(data.concentration.topThreeSharePct) })}</TooltipContent></Tooltip>
              </CardHeader>
              <CardContent className="overflow-x-auto">
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

            <Card className="min-w-0">
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div><CardTitle className="text-base">{t("dash.inventory.title")}</CardTitle><CardDescription>{t("dash.inventory.description")}</CardDescription></div>
                <Button variant="ghost" size="sm" onClick={() => navigate("inventory")}>{t("dash.viewDetails")}<ArrowRight className="size-3.5 rtl:rotate-180" /></Button>
              </CardHeader>
              <CardContent>
                <div className="mb-3 grid grid-cols-3 gap-2">
                  <div className="rounded-lg border p-2"><div className="text-[10px] text-muted-foreground">{t("dash.inventory.low")}</div><div className="mt-1 text-lg font-semibold tabular-nums">{integer.format(data.inventory.lowStock)}</div></div>
                  <div className="rounded-lg border p-2"><div className="text-[10px] text-muted-foreground">{t("dash.inventory.out")}</div><div className="mt-1 text-lg font-semibold tabular-nums">{integer.format(data.inventory.outOfStock)}</div></div>
                  <div className="rounded-lg border p-2"><div className="text-[10px] text-muted-foreground">{t("dash.inventory.slow")}</div><div className="mt-1 text-lg font-semibold tabular-nums">{integer.format(data.inventory.slowMoving)}</div></div>
                </div>
                {data.inventory.items.filter((item) => item.status !== "active").length === 0 ? <div className="flex h-36 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">{t("dash.empty.inventoryAttention")}</div> : (
                  <div className="space-y-2">{data.inventory.items.filter((item) => item.status !== "active").slice(0, 6).map((item) => (
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
            <Card>
              <CardHeader><CardTitle className="text-base">{t("dash.recommendations.title")}</CardTitle><CardDescription>{t("dash.recommendations.description")}</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                {insightViews.filter((item) => item.action).slice(0, 4).map((item) => (
                  <article key={`recommendation:${item.id}`} className="border-b pb-3 last:border-0 last:pb-0">
                    <h3 className="text-sm font-medium">{item.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
                    {item.onOpen && <Button variant="outline" size="sm" className="mt-2 h-7 text-xs" onClick={item.onOpen}>{t("dash.recommendations.suggestedAction")}: {item.action}</Button>}
                  </article>
                ))}
                {insightViews.filter((item) => item.action).length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("dash.recommendations.empty")}</p>}
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 lg:grid-cols-3" aria-labelledby="operations-heading">
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-start justify-between"><div><CardTitle id="operations-heading" className="text-base">{t("dash.shipments.title")}</CardTitle><CardDescription>{t("dash.shipments.description")}</CardDescription></div><Button variant="ghost" size="sm" onClick={() => navigate("shipments")}>{t("dash.viewDetails")}<ArrowRight className="size-3.5 rtl:rotate-180" /></Button></CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-3">
                  {[{ key: "pending", value: data.shipments.pending, icon: Clock3 }, { key: "inTransit", value: data.shipments.inTransit, icon: Truck }, { key: "delayed", value: data.shipments.delayed, icon: AlertTriangle }].map(({ key, value, icon: Icon }) => <div key={key} className="flex items-center gap-3 rounded-lg border p-3"><span className="flex size-8 items-center justify-center rounded-md bg-muted"><Icon className="size-4" /></span><div><div className="text-lg font-semibold tabular-nums">{integer.format(value)}</div><div className="text-[10px] text-muted-foreground">{t(`dash.shipments.${key}`)}</div></div></div>)}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">{data.shipments.recent.slice(0, 4).map((shipment) => <button type="button" key={shipment.id} onClick={() => navigate("shipments")} className="flex items-center justify-between rounded-lg border p-2.5 text-start hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span><span className="block font-mono text-xs font-medium">{shipment.shipmentNumber}</span><span className="text-[10px] text-muted-foreground">{shipment.supplierName || t("common.notAvailable")} · {formatDateLabel(shipment.expectedArrivalDate, locale)}</span></span><Badge variant="outline" className="text-[10px]">{t(`status.${shipment.status}`)}</Badge></button>)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">{t("dash.actions.title")}</CardTitle><CardDescription>{t("dash.actions.description")}</CardDescription></CardHeader>
              <CardContent className="grid gap-2">
                <Button onClick={() => navigate("sales")} className="justify-start"><ShoppingCart className="size-4" />{t("dash.newSale")}</Button>
                <Button variant="outline" onClick={() => navigate("inventory")} className="justify-start"><Boxes className="size-4" />{t("dash.bulkIntake")}</Button>
                <Button variant="outline" onClick={() => navigate("shipments")} className="justify-start"><Truck className="size-4" />{t("dash.createShipment")}</Button>
                <Button variant="outline" onClick={() => navigate("financials")} className="justify-start"><Banknote className="size-4" />{t("dash.registerPayment")}</Button>
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </main>
  )
}
