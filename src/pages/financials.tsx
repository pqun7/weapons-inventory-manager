import { useMemo, useState, useCallback, useEffect } from "react"
import {
  Search, Receipt, DollarSign, Check, X,
  Calendar, Eye, Clock, CheckCircle, AlertCircle,
  SlidersHorizontal, ArrowUpDown, ChevronLeft, ChevronRight,
  Columns, List
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SavedFiltersBar } from "@/components/ui/saved-filters-bar"
import { DatePicker } from "@/components/ui/date-picker"
import { useStore } from "@/lib/store"
import { useNav } from "@/lib/nav"
import { useI18n } from "@/lib/i18n"
import { useCurrency } from "@/lib/currency-context"
import { DebtService } from "@/lib/services"
import { cn } from "@/lib/utils"
import {
  formatDate, formatDateShort, daysUntilDue, invoiceStatusClass,
} from "@/lib/format"
import type { Invoice, PaymentMethod, SavedFilter } from "@/lib/types"
import { toast } from "sonner"
import { invoiceAccountingAmount, sumMoney, type InvoiceMoneyField } from "@/lib/money-ui"
import { Textarea } from "@/components/ui/textarea"


type QuickFilter = "all" | "overdue" | "not-overdue"

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "card", "bank_transfer", "check", "other"]

const paymentMethodKey: Record<PaymentMethod, string> = {
  "cash": "fin.cash",
  "card": "fin.card",
  "bank_transfer": "fin.transfer",
  "check": "fin.transfer",
  "other": "fin.credit",
}

export function FinancialsPage() {
  const { t } = useI18n()
  const invoices = useStore((s) => s.invoices)
  const payments = useStore((s) => s.payments)
  const voidInvoice = useStore((s) => s.voidInvoice)
  const refreshFromDb = useStore((s) => s.refreshFromDb)
  const getCurrentUser = useStore((s) => s.getCurrentUser)
  const currentUser = getCurrentUser()
  const { financialFilter, setFinancialFilter } = useNav()
  const {
    reportViewMode, setReportViewMode, displayCurrency, currencies,
    transactionCurrency, accountingCurrency, formatInvoice, formatPayment,
    formatOriginal, formatAccountingAggregate, currencyPresentation,
  } = useCurrency()

  const [tab, setTab] = useState<"receivable" | "payable">("receivable")
  const [search, setSearch] = useState("")
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null)
  const [payOpen, setPayOpen] = useState(false)
  const [extendOpen, setExtendOpen] = useState(false)
  const [voidConfirmOpen, setVoidConfirmOpen] = useState(false)

  // Dialog internal tab
  const [detailTab, setDetailTab] = useState<"overview" | "payments">("overview")

  // Payment form
  const [payAmount, setPayAmount] = useState("")
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash")
  const [payNotes, setPayNotes] = useState("")
  const [payCurrency, setPayCurrency] = useState(transactionCurrency)

  // Extend form
  const [newDueDate, setNewDueDate] = useState("")
  const [extendReason, setExtendReason] = useState("")

  useEffect(() => {
    void refreshFromDb()
  }, [refreshFromDb])

  const fmtAmount = useCallback((invoice: Invoice, field: InvoiceMoneyField): string => {
    return formatInvoice(invoice, field, reportViewMode)
  }, [formatInvoice, reportViewMode])

  const formatReportAggregate = useCallback((amount: number): string => {
    return formatAccountingAggregate(amount, reportViewMode)
  }, [formatAccountingAggregate, reportViewMode])

  // Reset forms when selected invoice changes
  useEffect(() => {
    setPayAmount("")
    setPayNotes("")
    const invoice = invoices.find((item) => item.id === selectedInvoiceId)
    const invoiceCurrency = invoice?.currency
    setPayCurrency(currencies.some((item) => item.isoCode === invoiceCurrency) ? invoiceCurrency! : transactionCurrency)
    setNewDueDate("")
    setExtendReason("")
  }, [selectedInvoiceId, invoices, currencies, transactionCurrency])

  useEffect(() => {
    setQuickFilterState(financialFilter === "overdue" ? "overdue" : "all")
  }, [financialFilter])

  const [quickFilter, setQuickFilterState] = useState<QuickFilter>(financialFilter === "overdue" ? "overdue" : "all")

  const setQuickFilter = useCallback((f: QuickFilter) => {
    setQuickFilterState(f)
    setFinancialFilter(f === "overdue" ? "overdue" : "all")
  }, [setFinancialFilter])

  const filteredInvoices = useMemo(() => {
    let data = invoices.filter((i) => !i.voided)
    if (tab === "receivable") data = data.filter((i) => i.type === "Sale")
    else data = data.filter((i) => i.type === "Purchase")

    if (quickFilter === "overdue") {
      data = data.filter((i) => i.status === "Overdue")
    } else if (quickFilter === "not-overdue") {
      data = data.filter((i) => i.status !== "Overdue" && i.balance > 0)
    }

    if (search) {
      const q = search.toLowerCase()
      data = data.filter((i) => i.invoiceNumber.toLowerCase().includes(q) || i.customerName.toLowerCase().includes(q))
    }
    return data
  }, [invoices, tab, quickFilter, search])

  const totals = useMemo(() => {
    const active = filteredInvoices.filter((i) => i.balance > 0)
    const overdue = filteredInvoices.filter((i) => i.status === "Overdue")
    const grandBalance = sumMoney(active.map((invoice) => invoiceAccountingAmount(invoice, "balance")))
    const overdueTotal = sumMoney(overdue.map((invoice) => invoiceAccountingAmount(invoice, "balance")))
    return { grandBalance, overdueTotal, count: active.length }
  }, [filteredInvoices])

  const selectedInvoice = invoices.find((i) => i.id === selectedInvoiceId)
  const invoicePayments = selectedInvoiceId ? payments.filter((p) => p.invoiceId === selectedInvoiceId) : []

  const handleLoadFilter = useCallback((filter: SavedFilter) => {
    const state = filter.filterState ?? {}
    if (typeof state.tab === "string" && (state.tab === "receivable" || state.tab === "payable")) {
      setTab(state.tab)
    }
    if (typeof state.search === "string") {
      setSearch(state.search)
    }
    if (state.quickFilter === "overdue" || state.quickFilter === "not-overdue" || state.quickFilter === "all") {
      setQuickFilter(state.quickFilter as QuickFilter)
    }
    toast.success(`Filter "${filter.name}" applied`)
  }, [setQuickFilter])

  const handlePay = async () => {
    if (!selectedInvoiceId) return
    const amount = Number(payAmount)
    if (!amount || amount <= 0) {
      toast.error(t("fin.validAmountRequired"))
      return
    }
    const result = await DebtService.registerPayment({
      invoiceId: selectedInvoiceId,
      amount,
      currency: payCurrency,
      method: payMethod,
      notes: payNotes,
    })
    if (result.success) {
      const invoiceCurrency = selectedInvoice?.currency ?? transactionCurrency
      toast.success(`${t("toast.paymentRegistered")} — ${t("fin.balance")}: ${formatOriginal(result.newBalance ?? 0, invoiceCurrency)}`)
      setPayOpen(false)
      await refreshFromDb()
    } else {
      toast.error(result.error)
    }
  }

  const handleExtend = async () => {
    if (!selectedInvoiceId || !newDueDate) {
      toast.error(t("fin.newDueDateRequired"))
      return
    }
    const result = await DebtService.extendDueDate({
      invoiceId: selectedInvoiceId,
      newDueDate,
      reason: extendReason,
    })
    if (result.success) {
      toast.success(t("toast.dueDateExtended"))
      setExtendOpen(false)
      await refreshFromDb()
    } else {
      toast.error(result.error)
    }
  }

  const handleVoid = async () => {
    if (!selectedInvoiceId) return
    const result = await voidInvoice(selectedInvoiceId)
    if (result.success) {
      toast.success(t("toast.invoiceVoided"))
      setVoidConfirmOpen(false)
      setSelectedInvoiceId(null)
      await refreshFromDb()
    } else {
      toast.error(result.error)
    }
  }

  const quickFilterChips: { key: QuickFilter; label: string }[] = [
    { key: "all", label: t("fin.allInvoices") },
    { key: "overdue", label: t("fin.overdue") },
    { key: "not-overdue", label: t("status.NotOverdue") },
  ]

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "receivable" | "payable")} className="flex flex-col gap-4">
        {/* Header */}
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {t("fin.financials")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("fin.financialsDesc")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={reportViewMode} onValueChange={(v) => setReportViewMode(v as "original" | "accounting" | "display")}>
              <SelectTrigger className="h-7 w-auto gap-1.5 text-[10px]">
                <Eye className="size-3" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="accounting">{t("report.accountingCurrency")}</SelectItem>
                <SelectItem value="original">{t("report.originalCurrency")}</SelectItem>
                <SelectItem value="display">{t("report.displayCurrency")} ({displayCurrency})</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 👇 هنا بالضبط: أزرار الفلتر السريع + شريط الفلاتر المحفوظة */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {quickFilterChips.map((chip) => (
              <Button
                key={chip.key}
                size="xs"
                variant={quickFilter === chip.key ? "default" : "outline"}
                className={cn(
                  "h-6 rounded-full px-3 text-[10px] font-medium",
                  chip.key === "overdue" && quickFilter === chip.key && "bg-status-sold text-status-sold-fg hover:bg-status-sold/90",
                  chip.key === "overdue" && quickFilter !== chip.key && "text-status-sold border-status-sold/40 hover:bg-status-sold/10",
                )}
                onClick={() => setQuickFilterState(chip.key)}
              >
                {chip.label}
              </Button>
            ))}
          </div>
          <SavedFiltersBar
            entityType="financials"
            currentFilterState={{ tab, search, quickFilter }}
            onLoadFilter={handleLoadFilter}
          />
        </div>

        {/* Tabs */}
        <TabsList className="h-8">
          <TabsTrigger value="receivable" className="text-xs gap-1.5">
            <Receipt className="size-3.5" />
            {t("fin.invoicesTab")} ({filteredInvoices.length})
          </TabsTrigger>
          <TabsTrigger value="payable" className="text-xs gap-1.5">
            <DollarSign className="size-3.5" />
            {t("fin.paymentsTab")} ({filteredInvoices.length})
          </TabsTrigger>
        </TabsList>

        {/* محتوى التبويب */}
        <TabsContent value="receivable" className="mt-0">
          <FinancialGrid
            invoices={filteredInvoices}
            selectedInvoiceId={selectedInvoiceId}
            onSelect={setSelectedInvoiceId}
            search={search}
            setSearch={setSearch}
            totals={totals}
            t={t}
            fmtAmount={fmtAmount}
            formatAccountingAggregate={formatReportAggregate}
          />
        </TabsContent>

        <TabsContent value="payable" className="mt-0">
          <FinancialGrid
            invoices={filteredInvoices}
            selectedInvoiceId={selectedInvoiceId}
            onSelect={setSelectedInvoiceId}
            search={search}
            setSearch={setSearch}
            totals={totals}
            t={t}
            fmtAmount={fmtAmount}
            formatAccountingAggregate={formatReportAggregate}
          />
        </TabsContent>
      </Tabs>

      {/* Invoice Detail Dialog – main dialog, no nested dialogs inside */}
      <Dialog open={!!selectedInvoiceId} onOpenChange={(open) => { if (!open) setSelectedInvoiceId(null); }}>
        <DialogContent className="max-w-2xl">
          {selectedInvoice && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <Receipt className="size-4" />
                  <span className="font-mono">{selectedInvoice.invoiceNumber}</span>
                  <Badge variant="outline" className={cn("text-[10px]", invoiceStatusClass(selectedInvoice.status))}>
                    {t(`status.${selectedInvoice.status}`)}
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {selectedInvoice.customerName} — {formatDate(selectedInvoice.date)}
                </DialogDescription>
              </DialogHeader>

              {/* Financial Summary Cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatBox label={t("fin.total")} value={fmtAmount(selectedInvoice, "totalOriginal")} />
                <StatBox label={t("fin.invoiceType")} value={fmtAmount(selectedInvoice, "totalNegotiated")} />
                <StatBox label={t("fin.paid")} value={fmtAmount(selectedInvoice, "totalPaid")} color="text-status-returned" />
                <StatBox label={t("fin.balance")} value={fmtAmount(selectedInvoice, "balance")} color={selectedInvoice.balance > 0 ? "text-status-sold" : "text-status-returned"} />
              </div>

              {/* Due Date & Lifecycle */}
              <div className="grid gap-2 rounded-md border p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("fin.newDueDate")}</span>
                  <span className="font-medium">
                    {formatDate(selectedInvoice.dueDate)} (
                    {daysUntilDue(selectedInvoice.dueDate) >= 0
                      ? `${daysUntilDue(selectedInvoice.dueDate)}d left`
                      : `${Math.abs(daysUntilDue(selectedInvoice.dueDate))}d overdue`})
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("common.status")}</span>
                  <span className="font-medium flex items-center gap-1">
                    <LifecycleIcon
                      status={
                        selectedInvoice.balance <= 0
                          ? "Paid"
                          : selectedInvoice.status === "Overdue"
                            ? "Overdue"
                            : "Pending"
                      }
                    />
                    {selectedInvoice.balance <= 0
                      ? t("status.Paid")
                      : selectedInvoice.status === "Overdue"
                        ? t("status.Overdue")
                        : t("status.Pending")}
                  </span>
                </div>
              </div>

              <Separator />

              {/* Financial Lifecycle Timeline */}
              <div>
                <h4 className="mb-2 text-xs font-semibold">{t("fin.payments")}</h4>
                <div className="flex flex-col gap-2">
                  <TimelineEntry
                    icon={<Receipt className="size-3" />}
                    label={t("fin.invoiceNumber")}
                    date={selectedInvoice.date}
                    detail={fmtAmount(selectedInvoice, "totalNegotiated")}
                  />
                  {invoicePayments.map((p) => (
                    <TimelineEntry
                      key={p.id}
                      icon={<DollarSign className="size-3" />}
                      label={`${t("fin.registerPayment")} (${t(paymentMethodKey[p.method])})`}
                      date={p.date}
                      detail={`${formatPayment(p, "original")} → ${formatPayment(p, "accounting")} — ${p.employee}`}
                    />
                  ))}
                  {selectedInvoice.status === "Paid" && (
                    <TimelineEntry
                      icon={<Check className="size-3" />}
                      label={t("status.Paid")}
                      date={selectedInvoice.date}
                      detail={t("fin.paid")}
                      color="text-status-returned"
                    />
                  )}
                </div>
              </div>

              <Separator />

              {/* Payment Sub‑Ledger */}
              <div>
                <h4 className="mb-1.5 text-xs font-semibold">{t("fin.payments")} ({invoicePayments.length})</h4>
                {invoicePayments.length > 0 ? (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="h-7 text-[10px]">{t("common.date")}</TableHead>
                          <TableHead className="h-7 text-[10px]">{t("fin.amount")}</TableHead>
                          <TableHead className="h-7 text-[10px]">{t("fin.paymentMethod")}</TableHead>
                          <TableHead className="h-7 text-[10px]">{t("common.name")}</TableHead>
                          <TableHead className="h-7 text-[10px]">{t("common.notes")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invoicePayments.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="py-1 text-[10px]">{formatDateShort(p.date)}</TableCell>
                            <TableCell className="py-1 text-[10px] font-medium tabular-nums">
                              <div>{formatPayment(p, "original")}</div>
                              {p.currency !== p.accountingCurrency && (
                                <div className="text-[9px] font-normal text-muted-foreground">
                                  ≈ {formatPayment(p, "accounting")} · {t("fin.exchangeRate")} {p.exchangeRate} · {p.exchangeRateDate ? formatDateShort(p.exchangeRateDate) : "—"}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="py-1 text-[10px]">{t(paymentMethodKey[p.method])}</TableCell>
                            <TableCell className="py-1 text-[10px]">{p.employee}</TableCell>
                            <TableCell className="py-1 text-[10px] text-muted-foreground">{p.notes}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <span className="text-[11px] text-muted-foreground">{t("fin.noPayments")}</span>
                )}
              </div>

              {/* Action Buttons (only when invoice is active) */}
              {selectedInvoice.balance > 0 && !selectedInvoice.voided && (
                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button size="sm" className="h-8 gap-1.5" onClick={() => setPayOpen(true)}>
                    <DollarSign className="size-3.5" />
                    {t("fin.registerPayment")}
                  </Button>

                  {currentUser.permissions.canExtendDueDates && (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setExtendOpen(true)}>
                      <Calendar className="size-3.5" />
                      {t("fin.extendDueDate")}
                    </Button>
                  )}

                  {currentUser.permissions.canVoidInvoices && (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-status-sold" onClick={() => setVoidConfirmOpen(true)}>
                      <X className="size-3.5" />
                      {t("fin.voidInvoice")}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Separate dialogs for actions – avoid nesting inside main dialog */}
      {/* Register Payment Dialog */}
      {/* Invoice Detail Dialog – reorganized with internal tabs */}
      <Dialog
        open={!!selectedInvoiceId}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedInvoiceId(null)
            setDetailTab("overview")
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          {selectedInvoice && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <Receipt className="size-4" />
                  <span className="font-mono">{selectedInvoice.invoiceNumber}</span>
                  <Badge variant="outline" className={cn("text-[10px]", invoiceStatusClass(selectedInvoice.status))}>
                    {t(`status.${selectedInvoice.status}`)}
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {selectedInvoice.customerName} — {formatDate(selectedInvoice.date)}
                </DialogDescription>
              </DialogHeader>

              {/* Financial Summary Cards – always visible */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatBox label={t("fin.total")} value={fmtAmount(selectedInvoice, "totalOriginal")} />
                <StatBox label={t("fin.invoiceType")} value={fmtAmount(selectedInvoice, "totalNegotiated")} />
                <StatBox label={t("fin.paid")} value={fmtAmount(selectedInvoice, "totalPaid")} color="text-green-600" />
                <StatBox
                  label={t("fin.balance")}
                  value={fmtAmount(selectedInvoice, "balance")}
                  color={selectedInvoice.balance > 0 ? "text-red-500" : "text-green-600"}
                />
              </div>

              {/* Tabs for Overview & Payments */}
              <Tabs value={detailTab} onValueChange={(v) => setDetailTab(v as "overview" | "payments")} className="w-full">
                <TabsList className="h-7 w-full justify-start">
                  <TabsTrigger value="overview" className="text-xs">{t("common.overview")}</TabsTrigger>
                  <TabsTrigger value="payments" className="text-xs">{t("fin.payments")} ({invoicePayments.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="mt-3 space-y-3">
                  {/* Due Date & Lifecycle */}
                  <div className="rounded-md border p-3 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{t("fin.newDueDate")}</span>
                      <span className="font-medium">
                        {formatDate(selectedInvoice.dueDate)} (
                        {daysUntilDue(selectedInvoice.dueDate) >= 0
                          ? `${daysUntilDue(selectedInvoice.dueDate)}d left`
                          : `${Math.abs(daysUntilDue(selectedInvoice.dueDate))}d overdue`})
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{t("common.status")}</span>
                      <span className="font-medium flex items-center gap-1">
                        <LifecycleIcon
                          status={
                            selectedInvoice.balance <= 0
                              ? "Paid"
                              : selectedInvoice.status === "Overdue"
                                ? "Overdue"
                                : "Pending"
                          }
                        />
                        {selectedInvoice.balance <= 0
                          ? t("status.Paid")
                          : selectedInvoice.status === "Overdue"
                            ? t("status.Overdue")
                            : t("status.Pending")}
                      </span>
                    </div>
                  </div>

                  {/* Financial Lifecycle Timeline */}
                  <div>
                    <h4 className="mb-2 text-xs font-semibold">{t("fin.lifecycle")}</h4>
                    <div className="flex flex-col gap-2">
                      <TimelineEntry
                        icon={<Receipt className="size-3" />}
                        label={t("fin.invoiceNumber")}
                        date={selectedInvoice.date}
                        detail={fmtAmount(selectedInvoice, "totalNegotiated")}
                      />
                      {invoicePayments.map((p) => (
                        <TimelineEntry
                          key={p.id}
                          icon={<DollarSign className="size-3" />}
                          label={`${t("fin.registerPayment")} (${t(paymentMethodKey[p.method])})`}
                          date={p.date}
                          detail={`${formatPayment(p, "original")} → ${formatPayment(p, "accounting")} — ${p.employee}`}
                        />
                      ))}
                      {selectedInvoice.status === "Paid" && (
                        <TimelineEntry
                          icon={<CheckCircle className="size-3 text-green-600" />}
                          label={t("status.Paid")}
                          date={selectedInvoice.date}
                          detail={t("fin.paid")}
                          color="text-green-600"
                        />
                      )}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="payments" className="mt-3">
                  {invoicePayments.length > 0 ? (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead className="h-7 text-[10px]">{t("common.date")}</TableHead>
                            <TableHead className="h-7 text-[10px]">{t("fin.amount")}</TableHead>
                            <TableHead className="h-7 text-[10px]">{t("fin.paymentMethod")}</TableHead>
                            <TableHead className="h-7 text-[10px]">{t("common.name")}</TableHead>
                            <TableHead className="h-7 text-[10px]">{t("common.notes")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {invoicePayments.map((p) => (
                            <TableRow key={p.id}>
                              <TableCell className="py-1 text-[10px]">{formatDateShort(p.date)}</TableCell>
                              <TableCell className="py-1 text-[10px] font-medium tabular-nums">
                                <div>{formatPayment(p, "original")}</div>
                                {p.currency !== p.accountingCurrency && (
                                  <div className="text-[9px] font-normal text-muted-foreground">
                                    ≈ {formatPayment(p, "accounting")} · {t("fin.exchangeRate")} {p.exchangeRate} · {p.exchangeRateDate ? formatDateShort(p.exchangeRateDate) : "—"}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="py-1 text-[10px]">{t(paymentMethodKey[p.method])}</TableCell>
                              <TableCell className="py-1 text-[10px]">{p.employee}</TableCell>
                              <TableCell className="py-1 text-[10px] text-muted-foreground">{p.notes}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">{t("fin.noPayments")}</p>
                  )}
                </TabsContent>
              </Tabs>

              {/* Action Buttons (only when invoice is active) */}
              {selectedInvoice.balance > 0 && !selectedInvoice.voided && (
                <div className="flex items-center justify-end gap-2 pt-2 border-t mt-3">
                  <Button size="sm" className="h-8 gap-1.5" onClick={() => setPayOpen(true)}>
                    <DollarSign className="size-3.5" />
                    {t("fin.registerPayment")}
                  </Button>

                  {currentUser.permissions.canExtendDueDates && (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setExtendOpen(true)}>
                      <Calendar className="size-3.5" />
                      {t("fin.extendDueDate")}
                    </Button>
                  )}

                  {currentUser.permissions.canVoidInvoices && (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-red-500" onClick={() => setVoidConfirmOpen(true)}>
                      <X className="size-3.5" />
                      {t("fin.voidInvoice")}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Register Payment Dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-sm">{t("fin.registerPayment")}</DialogTitle>
            <DialogDescription className="text-xs">
              {selectedInvoice ? `${t("fin.invoiceNumber")}: ${selectedInvoice.invoiceNumber} — ${t("fin.balance")}: ${fmtAmount(selectedInvoice, "balance")}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label className="text-xs">{t("fin.paymentAmount")} ({payCurrency})</Label>
              <Input type="number" min="0" step="any" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="h-8 text-xs" />
              {selectedInvoice && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {t("fin.balance")}: {fmtAmount(selectedInvoice, "balance")} · {t("report.accountingCurrency")}: {accountingCurrency}
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">{t("settings.currency")}</Label>
              <Select value={payCurrency} onValueChange={setPayCurrency}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {currencies.map((currency) => (
                    <SelectItem key={currency.isoCode} value={currency.isoCode}>
                      {currency.isoCode} — {currencyPresentation(currency.isoCode).name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("fin.paymentMethod")}</Label>
              <Select value={payMethod} onValueChange={(v) => setPayMethod(v as PaymentMethod)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{t(paymentMethodKey[m])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("common.notes")}</Label>
              <Input value={payNotes} onChange={(e) => setPayNotes(e.target.value)} className="h-8 text-xs" />
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setPayOpen(false)}>{t("fin.cancel")}</Button>
            <Button size="sm" onClick={handlePay}><Check className="size-3.5" /> {t("fin.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Extend Due Date Dialog */}
      <Dialog open={extendOpen} onOpenChange={setExtendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-sm">{t("fin.extendDueDate")}</DialogTitle>
            <DialogDescription className="text-xs">
              {selectedInvoice ? `${t("fin.newDueDate")}: ${formatDate(selectedInvoice.dueDate)}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label className="text-xs">{t("fin.newDueDate")}</Label>
              <DatePicker value={newDueDate} onChange={setNewDueDate} className="h-8 text-xs" required />
            </div>
            <div>
              <Label className="text-xs">{t("common.notes")}</Label>
              <Textarea value={extendReason} onChange={(e) => setExtendReason(e.target.value)} className="min-h-[60px] text-xs" />
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setExtendOpen(false)}>{t("fin.cancel")}</Button>
            <Button size="sm" onClick={handleExtend}><Check className="size-3.5" /> {t("fin.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void Confirmation Dialog */}
      <Dialog open={voidConfirmOpen} onOpenChange={setVoidConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-sm">{t("fin.voidInvoice")}</DialogTitle>
            <DialogDescription className="text-xs">
              {t("fin.voidConfirm")} {selectedInvoice?.invoiceNumber}? {t("fin.voidWarning")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setVoidConfirmOpen(false)}>{t("fin.cancel")}</Button>
            <Button variant="destructive" size="sm" onClick={handleVoid}><X className="size-3.5 me-1" /> {t("fin.voidInvoice")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}



function FinancialGrid({
  invoices,
  selectedInvoiceId,
  onSelect,
  search,
  setSearch,
  totals,
  t,
  fmtAmount,
  formatAccountingAggregate,
}: {
  invoices: Invoice[]
  selectedInvoiceId: string | null
  onSelect: (id: string) => void
  search: string
  setSearch: (v: string) => void
  totals: { grandBalance: number; overdueTotal: number; count: number }
  t: (key: string, params?: Record<string, string | number>) => string
  fmtAmount: (invoice: Invoice, field: InvoiceMoneyField) => string
  formatAccountingAggregate: (accountingAmount: number) => string
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [denseMode, setDenseMode] = useState(false)

  // تعريف الأعمدة مع دعم الفرز والعرض الاختياري
  const columns = useMemo<ColumnDef<Invoice>[]>(
    () => [
      {
        accessorKey: "invoiceNumber",
        header: t("fin.invoiceNumber"),
        cell: ({ row }) => (
          <span className="font-mono text-[10px]">{row.original.invoiceNumber}</span>
        ),
        size: 120,
        enableSorting: true,
      },
      {
        accessorKey: "customerName",
        header: t("common.name"),
        cell: ({ row }) => (
          <span className={cn("text-[10px]", row.original.status === "Overdue" && "font-medium text-status-sold")}>            {row.original.customerName}
          </span>
        ),
        size: 150,
        enableSorting: true,
      },
      {
        accessorKey: "date",
        header: t("common.date"),
        cell: ({ row }) => (
          <span className="text-[10px] text-muted-foreground">{formatDateShort(row.original.date)}</span>
        ),
        size: 100,
        enableSorting: true,
      },
      {
        accessorKey: "dueDate",
        header: t("fin.newDueDate"),
        cell: ({ row }) => (
          <span className="text-[10px] text-muted-foreground">{formatDateShort(row.original.dueDate)}</span>
        ),
        size: 100,
        enableSorting: true,
      },
      {
        accessorKey: "totalNegotiated",
        header: t("fin.invoiceType"),
        cell: ({ row }) => (
          <span className="text-[10px] tabular-nums">{fmtAmount(row.original, "totalNegotiated")}</span>
        ),
        size: 120,
        enableSorting: false,
      },
      {
        accessorKey: "totalPaid",
        header: t("fin.paid"),
        cell: ({ row }) => (
          <span className="text-[10px] tabular-nums text-green-600">{fmtAmount(row.original, "totalPaid")}</span>
        ),
        size: 120,
        enableSorting: false,
      },
      {
        accessorKey: "balance",
        header: t("fin.balance"),
        cell: ({ row }) => (
          <span className={cn("text-[10px] font-medium tabular-nums", row.original.balance > 0 && "text-status-sold")}>
            {fmtAmount(row.original, "balance")}
          </span>
        ),
        size: 120,
        enableSorting: false,
      },
      {
        accessorKey: "status",
        header: t("common.status"),
        cell: ({ row }) => {
          const status = row.original.status
          return (
            <Badge variant="outline" className={cn("text-[9px]", invoiceStatusClass(status))}>
              {t(`status.${status}`)}
            </Badge>
          )
        },
        size: 100,
        enableSorting: true,
      },
    ],
    [t, fmtAmount]
  )

  const table = useReactTable({
    data: invoices,
    columns,
    state: {
      sorting,
      columnVisibility,
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    initialState: {
      pagination: { pageSize: 15 },
    },
  })

  const allColumnKeys = table.getAllLeafColumns().map(col => col.id)

  const grandBalanceDisplay = formatAccountingAggregate(totals.grandBalance)
  const overdueDisplay = formatAccountingAggregate(totals.overdueTotal)

  return (
    <div className="flex flex-col gap-4">
      {/* بطاقات إحصائية */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatBox label={t("fin.totalInvoices")} value={invoices.length.toString()} />
        <StatBox label={t("fin.outstandingBalance")} value={grandBalanceDisplay} color={totals.grandBalance > 0 ? "text-red-500" : "text-green-600"} />
        <StatBox label={t("fin.overdueBalance")} value={overdueDisplay} color="text-red-500" />
      </div>


      {/* شريط البحث + الفلاتر المحفوظة */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("fin.searchInvoices")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <SavedFiltersBar
          entityType="financials"
          currentFilterState={{}} // سنضبطها لاحقًا
          onLoadFilter={() => { }}
        />
      </div>

      {/* شريط الفلاتر (مثال – يمكن تخصيصه) */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* هنا يمكن إضافة أزرار فلاتر سريعة مثل الموجودة في الأعلى، وفلتر النوع، التاريخ، إلخ. */}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px] gap-1"
          onClick={() => {/* فتح نافذة المزيد من الفلاتر */ }}
        >
          <SlidersHorizontal className="size-3" />
          {t("inv.moreFilters")}
        </Button>
      </div>

      {/* أدوات الجدول (إظهار الأعمدة + الكثافة) */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="xs" className="h-7 gap-1 text-[11px]">
                <Columns className="size-3" /> {t("inv.columns")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {allColumnKeys.map((key) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={table.getColumn(key)?.getIsVisible() ?? true}
                  onCheckedChange={(value) => table.getColumn(key)?.toggleVisibility(!!value)}
                >
                  {key === "invoiceNumber" ? t("fin.invoiceNumber") :
                    key === "customerName" ? t("common.name") :
                      key === "date" ? t("common.date") :
                        key === "dueDate" ? t("fin.newDueDate") :
                          key === "totalNegotiated" ? t("fin.invoiceType") :
                            key === "totalPaid" ? t("fin.paid") :
                              key === "balance" ? t("fin.balance") :
                                key === "status" ? t("common.status") : key}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="xs"
            className="h-7 text-[11px]"
            onClick={() => setDenseMode(!denseMode)}
          >
            {denseMode ? <List className="size-3 mr-1" /> : <Columns className="size-3 mr-1" />}
            {denseMode ? t("inv.comfortable") : t("inv.dense")}
          </Button>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {t("inv.showingCount", {
            shown: table.getRowModel().rows.length,
            total: invoices.length,
          })}
        </span>
      </div>

      {/* الجدول */}
      <div className="overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="bg-muted/50">
                {hg.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="h-8 px-2 relative"
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder ? null : (
                      <div className="flex items-center gap-1">
                        <button
                          className="inline-flex items-center gap-1 text-[10px] font-medium"
                          onClick={header.column.getToggleSortingHandler()}
                          disabled={!header.column.getCanSort()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getCanSort() && (
                            <ArrowUpDown className="size-2.5 opacity-50" />
                          )}
                        </button>
                        {header.column.getCanResize() && (
                          <div
                            onMouseDown={header.getResizeHandler()}
                            onTouchStart={header.getResizeHandler()}
                            className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none bg-border opacity-0 hover:opacity-100"
                          />
                        )}
                      </div>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(
                    "cursor-pointer border-b hover:bg-accent/50",
                    selectedInvoiceId === row.original.id && "bg-muted",
                    row.original.status === "Overdue" && "bg-status-sold/5", // خلفية خفيفة جداً
                  )}
                  onClick={() => onSelect(row.original.id)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={denseMode ? "py-1" : "py-2"}
                      style={{ width: cell.column.getSize() }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={allColumnKeys.length} className="h-24 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-1">
                    <Receipt className="size-8" />
                    <span className="text-xs">{t("fin.noInvoices")}</span>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] text-muted-foreground">
          {t("inv.showingCount", {
            shown: table.getRowModel().rows.length,
            total: invoices.length,
          })}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="xs"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="size-3" /> {t("common.prev")}
          </Button>
          <span className="text-[10px] text-muted-foreground">
            {table.getState().pagination.pageIndex + 1} / {table.getPageCount() || 1}
          </span>
          <Button
            variant="outline"
            size="xs"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            {t("common.next")} <ChevronRight className="size-3" />
          </Button>
        </div>
      </div>
    </div>
  )
}


function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-sm font-bold tabular-nums", color)}>{value}</div>
    </div>
  )
}

function TimelineEntry({ icon, label, date, detail, color }: { icon: React.ReactNode; label: string; date: string; detail: string; color?: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className={cn("flex size-5 shrink-0 items-center justify-center rounded-full bg-muted", color)}>{icon}</div>
      <div className="flex flex-1 items-center justify-between">
        <span className="text-[11px] font-medium">{label}</span>
        <span className="text-[10px] text-muted-foreground">{formatDate(date)}</span>
      </div>
      <span className="text-[10px] tabular-nums">{detail}</span>
    </div>
  )
}

function LifecycleIcon({ status }: { status: "Paid" | "Overdue" | "Pending" }) {
  if (status === "Paid") return <CheckCircle className="size-3.5 text-green-600 dark:text-green-400" />
  if (status === "Overdue") return <AlertCircle className="size-3.5 text-status-sold" />
  return <Clock className="size-3.5 text-amber-500 dark:text-amber-400" />
}
