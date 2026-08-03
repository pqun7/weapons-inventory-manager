import { useMemo, memo } from "react"
import {
  Package, TrendingUp, DollarSign, Landmark, AlertTriangle, Truck,
  ShoppingCart, Plus, FileSpreadsheet, Database, Receipt, Activity,
  ArrowRight, Boxes,
} from "lucide-react"
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart"
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Legend,
} from "recharts"
import { useStore } from "@/lib/store"
import { useNav } from "@/lib/nav"
import { useI18n } from "@/lib/i18n"
import { useCurrency } from "@/lib/currency-context"
import { formatDateShort, formatDateTime, formatMonthShort, invoiceStatusClass } from "@/lib/format"
import { ammoTotalRounds } from "@/lib/types"

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-1)"]

const KpiCard = memo(function KpiCard({
  label, value, icon: Icon, color, sub,
}: { label: string; value: string; icon: typeof Package; color: string; sub: string }) {
  return (
    <Card className="gap-0 py-3">
      <CardContent className="px-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
          <Icon className={`size-3.5 ${color}`} />
        </div>
        <div className="mt-1 text-lg font-bold tracking-tight tabular-nums">{value}</div>
        <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  )
})

export function DashboardPage() {
  const { t } = useI18n()
  const weapons = useStore((s) => s.weapons)
  const invoices = useStore((s) => s.invoices)
  const shipments = useStore((s) => s.shipments)
  const auditLogs = useStore((s) => s.auditLogs)
  const accessories = useStore((s) => s.accessories)
  const ammunition = useStore((s) => s.ammunition)
  const { navigate, setFinancialFilter } = useNav()
  const { format: formatUSD } = useCurrency()

  const chartConfig = {
    revenue: { label: t("dash.chart.revenue"), color: "var(--chart-1)" },
    profit: { label: t("dash.chart.profit"), color: "var(--chart-3)" },
    margin: { label: t("dash.chart.marginPct"), color: "var(--chart-2)" },
    sales: { label: t("dash.chart.sales"), color: "var(--chart-1)" },
  } satisfies ChartConfig

  const stats = useMemo(() => {
    const now = new Date()
    const available = weapons.filter((w) => w.status === "Available")
    const invValue = available.reduce((s, w) => s + (w.purchasePriceValuation?.accountingAmountUSD ?? w.purchasePrice), 0)
    const saleInvoices = invoices.filter((i) => i.type === "Sale" && !i.voided)
    const revenue = saleInvoices.reduce((s, i) => s + (i.totalValuation?.accountingAmountUSD ?? i.totalNegotiated), 0)
    const cost = saleInvoices.reduce((s, i) => {
      const invWeapons = weapons.filter((w) => i.weaponIds.includes(w.id))
      return s + invWeapons.reduce((ws, w) => ws + (w.purchasePriceValuation?.accountingAmountUSD ?? w.purchasePrice), 0)
    }, 0)
    const netProfit = revenue - cost
    const activeDebts = invoices.filter((i) => i.balance > 0 && !i.voided).reduce((s, i) => s + (i.totalValuation?.accountingAmountUSD ?? i.balance), 0)
    const overdueDebts = invoices.filter((i) => i.status === "Overdue" && !i.voided).reduce((s, i) => s + (i.totalValuation?.accountingAmountUSD ?? i.balance), 0)
    const pendingShipments = shipments.filter((s) => s.status !== "Arrived" && s.status !== "Cancelled")
    const inTransitShipments = shipments.filter((s) => s.status === "In Transit")
    const delayedShipments = shipments.filter((s) => s.status === "Delayed")
    const arrivedThisMonth = shipments.filter((s) => {
      if (s.status !== "Arrived" || !s.actualArrivalDate) return false
      const d = new Date(s.actualArrivalDate)
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    }).length
    const inTransitValue = inTransitShipments.reduce((sum, s) => {
      const items = s.lineItems ?? []
      return sum + items.reduce((li, item) => li + (item.purchasePriceValuation?.accountingAmountUSD ?? item.purchasePrice * item.quantity), 0)
    }, 0)

    return { invValue, revenue, netProfit, activeDebts, overdueDebts, pendingShipments: pendingShipments.length, inTransitShipments: inTransitShipments.length, delayedShipments: delayedShipments.length, arrivedThisMonth, inTransitValue, availableCount: available.length }
  }, [weapons, invoices, shipments])

  const monthlyData = useMemo(() => {
    const months: Record<string, { revenue: number; profit: number }> = {}
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = formatMonthShort(d)
      months[key] = { revenue: 0, profit: 0 }
    }
    invoices.filter((i) => i.type === "Sale" && !i.voided).forEach((i) => {
      const key = formatMonthShort(new Date(i.date))
      if (months[key]) {
        months[key].revenue += i.totalValuation?.accountingAmountUSD ?? i.totalNegotiated
        const invWeapons = weapons.filter((w) => i.weaponIds.includes(w.id))
        months[key].profit += (i.totalValuation?.accountingAmountUSD ?? i.totalNegotiated) - invWeapons.reduce((s, w) => s + (w.purchasePriceValuation?.accountingAmountUSD ?? w.purchasePrice), 0)
      }
    })
    return Object.entries(months).map(([month, v]) => ({
      month, revenue: Math.round(v.revenue), profit: Math.round(v.profit),
      margin: v.revenue > 0 ? Math.round((v.profit / v.revenue) * 100) : 0,
    }))
  }, [invoices, weapons, t])

  const categoryData = useMemo(() => {
    const counts: Record<string, number> = {}
    invoices.filter((i) => i.type === "Sale" && !i.voided).forEach((i) => {
      i.weaponIds.forEach((wid) => {
        const w = weapons.find((wp) => wp.id === wid)
        if (w) counts[w.weaponType] = (counts[w.weaponType] ?? 0) + 1
      })
    })
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [invoices, weapons])

  const supplierData = useMemo(() => {
    const counts: Record<string, number> = {}
    weapons.forEach((w) => {
      counts[w.supplierId] = (counts[w.supplierId] ?? 0) + 1
    })
    return Object.entries(counts)
      .map(([supId, count]) => ({ name: supId, value: count }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
  }, [weapons])

  const topCustomers = useMemo(() => {
    const spend: Record<string, number> = {}
    invoices.filter((i) => i.type === "Sale" && !i.voided).forEach((i) => {
      spend[i.customerName] = (spend[i.customerName] ?? 0) + i.totalNegotiated
    })
    return Object.entries(spend).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5)
  }, [invoices])

  const recentSales = useMemo(() => invoices.filter((i) => i.type === "Sale" && !i.voided).slice(0, 10), [invoices])
  const recentShipments = useMemo(() => shipments.slice(0, 5), [shipments])
  const overdueInvoices = useMemo(() => invoices.filter((i) => i.status === "Overdue" && !i.voided).slice(0, 5), [invoices])
  const lowStockAcc = useMemo(() => accessories.filter((a) => a.quantity < a.safetyThreshold), [accessories])
  const lowStockAmm = useMemo(() => ammunition.filter((a) => ammoTotalRounds(a) < a.safetyThreshold), [ammunition])
  const todayLogs = useMemo(() => auditLogs.slice(0, 12), [auditLogs])

  const kpis = [
    { label: t("dash.kpi.inventoryValue"), value: formatUSD(stats.invValue), icon: Package, color: "text-chart-2", sub: `${stats.availableCount} ${t("dash.kpi.available")}` },
    { label: t("dash.kpi.grossRevenue"), value: formatUSD(stats.revenue), icon: TrendingUp, color: "text-chart-1", sub: t("dash.kpi.allSales") },
    { label: t("dash.kpi.netProfit"), value: formatUSD(stats.netProfit), icon: DollarSign, color: "text-chart-3", sub: t("dash.kpi.revenueMinusCost") },
    { label: t("dash.kpi.activeDebts"), value: formatUSD(stats.activeDebts), icon: Landmark, color: "text-status-reserved", sub: t("dash.kpi.outstanding") },
    { label: t("dash.kpi.overdueDebts"), value: formatUSD(stats.overdueDebts), icon: AlertTriangle, color: "text-status-sold", sub: t("dash.kpi.pastDue") },
    { label: t("dash.kpi.pendingShipments"), value: stats.pendingShipments.toString(), icon: Truck, color: "text-status-returned", sub: `${stats.inTransitShipments} ${t("dash.kpi.inTransit")} · ${stats.delayedShipments} ${t("dash.kpi.delayed")}` },
  ]

  return (
    <div className="flex flex-col gap-3 p-3 lg:p-4">
      {/* KPI Row */}
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>

      {/* Action Bar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={() => navigate("sales")}>
          <ShoppingCart className="size-3.5" /> {t("dash.newSale")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate("inventory")}>
          <Plus className="size-3.5" /> {t("dash.bulkIntake")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate("shipments")}>
          <Truck className="size-3.5" /> {t("dash.createShipment")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate("financials")}>
          <Receipt className="size-3.5" /> {t("dash.registerPayment")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate("settings")}>
          <FileSpreadsheet className="size-3.5" /> {t("dash.exportChecklist")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate("settings")}>
          <Database className="size-3.5" /> {t("dash.createBackup")}
        </Button>
      </div>

      {/* Charts Row */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("dash.chart.monthlyRevenue")}</CardTitle>
            <CardDescription className="text-xs">{t("dash.chart.last6Months")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[200px] w-full">
              <BarChart accessibilityLayer data={monthlyData}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={6} tick={{ fontSize: 10 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v / 1000}k`} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("dash.chart.profitMargin")}</CardTitle>
            <CardDescription className="text-xs">{t("dash.chart.monthlyMargin")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[200px] w-full">
              <LineChart accessibilityLayer data={monthlyData}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={6} tick={{ fontSize: 10 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="margin" stroke="var(--color-margin)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("dash.chart.bestSelling")}</CardTitle>
            <CardDescription className="text-xs">{t("dash.chart.byCategory")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[200px] w-full">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={30} paddingAngle={2}>
                  {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("dash.chart.supplierPerformance")}</CardTitle>
            <CardDescription className="text-xs">{t("dash.chart.weaponsBySupplier")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[200px] w-full">
              <BarChart accessibilityLayer data={supplierData} layout="vertical">
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={60} tick={{ fontSize: 9 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" fill="var(--chart-4)" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("dash.chart.topMerchants")}</CardTitle>
            <CardDescription className="text-xs">{t("dash.chart.byTotalSpend")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[200px] w-full">
              <BarChart accessibilityLayer data={topCustomers} layout="vertical">
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v / 1000}k`} />
                <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={110} tick={{ fontSize: 9 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" fill="var(--chart-5)" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Operational Tickers */}
      <div className="grid gap-3 lg:grid-cols-3">
        {/* Recent Sales */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5"><ShoppingCart className="size-4" /> {t("dash.recentSales")}</span>
              <Button size="xs" variant="ghost" onClick={() => navigate("financials")}>{t("common.all")} <ArrowRight className="size-3" /></Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[260px] overflow-y-auto scrollbar-thin">
            <div className="flex flex-col gap-1.5">
              {recentSales.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-md border p-2 transition-colors hover:bg-muted/50 cursor-pointer"
                  onClick={() => { navigate("financials") }}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="font-mono text-[11px] font-medium">{s.invoiceNumber}</span>
                    <span className="truncate text-[10px] text-muted-foreground">{s.customerName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold tabular-nums">{formatUSD(s.totalValuation?.accountingAmountUSD ?? s.totalNegotiated)}</span>
                    <Badge variant="outline" className={`h-4 px-1 text-[9px] ${invoiceStatusClass(s.status)}`}>{t(`status.${s.status}`)}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent Shipments + Pending Serials */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5"><Truck className="size-4" /> {t("dash.shipmentsTracker")}</span>
              <Button size="xs" variant="ghost" onClick={() => navigate("shipments")}>{t("common.all")} <ArrowRight className="size-3" /></Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="rounded-md border border-status-reserved/30 bg-status-reserved/5 p-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-status-reserved-fg">
                <AlertTriangle className="size-3.5" />
                {t("dash.pendingSerials")}
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  {shipments.filter((s) => s.status !== "Arrived").reduce((sum, s) => {
                    const registered = weapons.filter((w) => w.shipmentId === s.id).length
                    return sum + (s.totalExpectedItems - registered)
                  }, 0)} {t("dash.weaponsAwaiting")}
                </span>
                <Button size="xs" variant="outline" className="h-5 text-[10px]" onClick={() => navigate("shipments")}>{t("dash.register")}</Button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              {recentShipments.map((s) => {
                const registered = weapons.filter((w) => w.shipmentId === s.id).length
                const pct = s.totalExpectedItems > 0 ? Math.round((registered / s.totalExpectedItems) * 100) : 0
                return (
                  <div key={s.id} className="flex items-center justify-between rounded-md border p-2 cursor-pointer hover:bg-muted/50" onClick={() => navigate("shipments")}>
                    <div className="flex min-w-0 flex-col">
                      <span className="font-mono text-[11px] font-medium">{s.shipmentNumber}</span>
                      <span className="text-[10px] text-muted-foreground">{formatDateShort(s.shipmentDate)} — {registered}/{s.totalExpectedItems}</span>
                    </div>
                    <Badge variant="outline" className={`h-4 px-1 text-[9px] ${s.status === "Arrived" ? invoiceStatusClass("Paid") : s.status === "Partial" ? invoiceStatusClass("Pending") : "bg-muted text-muted-foreground"}`}>
                      {pct}%
                    </Badge>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Overdue Debts + Low Stock */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <AlertTriangle className="size-4 text-status-sold" /> {t("dash.overdueDebts")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex flex-col gap-1.5">
              {overdueInvoices.length > 0 ? overdueInvoices.map((i) => (
                <div key={i.id} className="flex items-center justify-between rounded-md border border-status-sold/20 bg-status-sold/5 p-2 cursor-pointer hover:bg-status-sold/10" onClick={() => { navigate("financials"); setFinancialFilter("overdue") }}>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[11px] font-medium">{i.customerName}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{i.invoiceNumber}</span>
                  </div>
                  <span className="text-xs font-bold tabular-nums text-status-sold-fg">{formatUSD(i.totalValuation?.accountingAmountUSD ?? i.balance)}</span>
                </div>
              )) : <span className="py-4 text-center text-xs text-muted-foreground">{t("dash.noOverdueDebts")}</span>}
            </div>
            <Separator />
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <Boxes className="size-3.5" /> {t("dash.lowStockAlerts")}
            </div>
            <div className="flex flex-col gap-1">
              {lowStockAcc.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">{a.name}</span>
                  <Badge variant="outline" className="h-4 px-1 text-[9px] text-status-sold">{a.quantity}/{a.safetyThreshold}</Badge>
                </div>
              ))}
              {lowStockAmm.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">{a.caliber}</span>
                  <Badge variant="outline" className="h-4 px-1 text-[9px] text-status-sold">{ammoTotalRounds(a)}/{a.safetyThreshold}</Badge>
                </div>
              ))}
              {lowStockAcc.length === 0 && lowStockAmm.length === 0 && (
                <span className="text-[10px] text-muted-foreground">{t("dash.allStockAbove")}</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Audit Log Ticker */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5"><Activity className="size-4" /> {t("dash.auditStream")}</span>
            <Button size="xs" variant="ghost" onClick={() => navigate("audit")}>{t("dash.fullLog")} <ArrowRight className="size-3" /></Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {todayLogs.map((log) => (
              <div key={log.id} className="flex items-start gap-2 rounded-md border p-2">
                <div className="flex size-5 shrink-0 items-center justify-center rounded bg-muted">
                  <Activity className="size-3 text-muted-foreground" />
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[11px] font-medium">{log.description}</span>
                  <span className="text-[10px] text-muted-foreground">{formatDateTime(log.timestamp)}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
