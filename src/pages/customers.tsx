import { useState, useMemo, useCallback, useEffect } from "react"
import {
  Search, Plus, Users, Phone, Mail, MapPin, Trash2, Clock,
  FileText, Download, Receipt,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { SavedFiltersBar } from "@/components/ui/saved-filters-bar"
import { useStore } from "@/lib/store"
import { useCurrency } from "@/lib/currency-context"
import { invoiceAccountingAmount, sumMoney } from "@/lib/money-ui"
import { formatDate, invoiceStatusClass } from "@/lib/format"
import type { SavedFilter, Invoice } from "@/lib/types"
import { toast } from "sonner"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type CustomerTab = "all" | "dealers" | "direct"

export function CustomersPage() {
  const { t } = useI18n()
  const customers = useStore((s) => s.customers)
  const payments = useStore((s) => s.payments)
  const getInvoicesByCustomerId = useStore((s) => s.getInvoicesByCustomerId)
  const addCustomer = useStore((s) => s.addCustomer)
  const deleteCustomer = useStore((s) => s.deleteCustomer)
  const refreshFromDb = useStore((s) => s.refreshFromDb)
  const { formatAccountingAggregate, formatInvoice, formatInvoiceLine, formatPayment } = useCurrency()

  const [search, setSearch] = useState("")
  const [tab, setTab] = useState<CustomerTab>("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newPhone, setNewPhone] = useState("")
  const [newEmail, setNewEmail] = useState("")
  const [newAddress, setNewAddress] = useState("")
  const [newWholesale, setNewWholesale] = useState(false)

  // Invoice detail dialog
  const [detailInvoice, setDetailInvoice] = useState<Invoice | null>(null)

  useEffect(() => {
    void refreshFromDb()
  }, [refreshFromDb])

  const enriched = useMemo(() => {
    const activeInvoices = useStore.getState().invoices.filter((i) => !i.voided)
    const paymentsByInvoice = new Map<string, string>()
    for (const payment of payments) {
      const current = paymentsByInvoice.get(payment.invoiceId)
      if (!current || payment.date > current) paymentsByInvoice.set(payment.invoiceId, payment.date)
    }
    const summaryByCustomer = new Map<string, { totalInvoices: number; openInvoices: number; grandTotalOutstanding: number; totalOverdueBalance: number; lastPaymentDate: string | null }>()
    for (const invoice of activeInvoices) {
      if (!invoice.customerId) continue // 👈 Guard clause narrows type to 'string'

      const current = summaryByCustomer.get(invoice.customerId) ?? { totalInvoices: 0, openInvoices: 0, grandTotalOutstanding: 0, totalOverdueBalance: 0, lastPaymentDate: null }
      current.totalInvoices += 1
      if (invoice.balance > 0) {
        current.openInvoices += 1
        current.grandTotalOutstanding = sumMoney([current.grandTotalOutstanding, invoiceAccountingAmount(invoice, "balance")])
      }
      if (invoice.status === "Overdue") current.totalOverdueBalance = sumMoney([current.totalOverdueBalance, invoiceAccountingAmount(invoice, "balance")])
      const paymentDate = paymentsByInvoice.get(invoice.id)
      if (paymentDate && (!current.lastPaymentDate || paymentDate > current.lastPaymentDate)) current.lastPaymentDate = paymentDate
      summaryByCustomer.set(invoice.customerId, current)
    }
    return customers.map((c) => {
      const summary = summaryByCustomer.get(c.id)
      const daysSinceLastPayment = summary?.lastPaymentDate
        ? Math.max(0, Math.floor((Date.now() - new Date(summary.lastPaymentDate).getTime()) / 86400000))
        : null
      return {
        ...c,
        totalInvoices: summary?.totalInvoices ?? 0,
        openInvoices: summary?.openInvoices ?? 0,
        grandTotalOutstanding: summary?.grandTotalOutstanding ?? 0,
        totalOverdueBalance: summary?.totalOverdueBalance ?? 0,
        daysSinceLastPayment,
      }
    })
  }, [customers, payments])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return enriched.filter((c) => {
      const matchesSearch = !search || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || c.phone.includes(q)
      const matchesTab =
        tab === "all" ||
        (tab === "dealers" && c.isWholesaleBuyer === true) ||
        (tab === "direct" && c.isWholesaleBuyer === false)
      return matchesSearch && matchesTab
    })
  }, [enriched, search, tab])

  const selected = filtered.find((c) => c.id === selectedId) || enriched.find((c) => c.id === selectedId) || null
  const selectedInvoices = selectedId ? getInvoicesByCustomerId(selectedId) : []

  const handleLoadFilter = useCallback((filter: SavedFilter) => {
    const state = filter.filterState ?? {}
    if (typeof state.search === "string") setSearch(state.search)
    const savedTab = state.tab
    if (savedTab === "all" || savedTab === "dealers" || savedTab === "direct") setTab(savedTab)
    toast.success(`Loaded filter "${filter.name}"`)
  }, [])

  const handleAdd = async () => {
    if (!newName.trim()) { toast.error("Name required"); return }
    const result = await addCustomer({
      name: newName.trim(), phone: newPhone.trim(), email: newEmail.trim(),
      address: newAddress.trim(), isWholesaleBuyer: newWholesale, wholesaleDiscountPercent: newWholesale ? 10 : 0,
    })
    if (result.success) {
      toast.success(t("toast.customerAdded"))
      setNewName(""); setNewPhone(""); setNewEmail(""); setNewAddress(""); setNewWholesale(false)
      setAddOpen(false)
    } else {
      toast.error(result.error)
    }
  }

  const handleDelete = useCallback(async (id: string) => {
    const result = await deleteCustomer(id)
    if (result.success) { toast.success(t("toast.customerDeleted")); if (selectedId === id) setSelectedId(null) }
    else toast.error(result.error)
  }, [deleteCustomer, selectedId])

  // Parse attachment string back to { name, data }
  const parseAttachments = (attachments: string[]) =>
    attachments.map((a) => {
      try {
        return JSON.parse(a) as { name: string; data: string }
      } catch {
        return { name: "Unknown", data: a }
      }
    })

  return (
    <div className="flex flex-col gap-3 p-3 lg:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={t("cust.search")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 pl-8 text-xs" />
        </div>
        <SavedFiltersBar entityType="customers" currentFilterState={{ search, tab }} onLoadFilter={handleLoadFilter} />
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild><Button size="sm" className="h-8"><Plus className="size-3.5" /> {t("cust.addCustomer")}</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="text-sm">{t("cust.addCustomer")}</DialogTitle></DialogHeader>
            {/* ... same form ... */}
            <DialogFooter><Button size="sm" variant="outline" onClick={() => setAddOpen(false)}>{t("common.cancel")}</Button><Button size="sm" onClick={handleAdd}>{t("common.add")}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as CustomerTab)}>
        <TabsList className="h-8">
          <TabsTrigger value="all" className="text-xs">{t("common.all")}</TabsTrigger>
          <TabsTrigger value="dealers" className="text-xs">{t("cust.dealers")}</TabsTrigger>
          <TabsTrigger value="direct" className="text-xs">{t("cust.directBuyers")}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-xs"><Users className="size-3.5" /> {t("cust.title")} ({filtered.length})</CardTitle></CardHeader>
          <CardContent className="max-h-[500px] overflow-y-auto p-0 scrollbar-thin">
            <Table>
              <TableHeader><TableRow className="bg-muted/50"><TableHead className="h-8 text-[10px]">{t("cust.name")}</TableHead><TableHead className="h-8 text-[10px] text-end">{t("common.debt")}</TableHead><TableHead className="h-8"></TableHead></TableRow></TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id} className={`cursor-pointer ${selectedId === c.id ? "bg-muted" : ""}`} onClick={() => setSelectedId(c.id)}>
                    <TableCell className="py-1.5">
                      <div className="flex flex-col">
                        <span className="text-xs font-medium">{c.name}</span>
                        <span className="text-[10px] text-muted-foreground">{c.id}{c.isWholesaleBuyer ? " — W" : ""}</span>
                      </div>
                    </TableCell>
                    <TableCell className="py-1.5 text-right">
                      <span className={`text-xs tabular-nums ${c.grandTotalOutstanding > 0 ? "font-bold text-status-sold" : "text-muted-foreground"}`}>{formatAccountingAggregate(c.grandTotalOutstanding)}</span>
                    </TableCell>
                    <TableCell className="py-1.5"><Button size="icon-xs" variant="ghost" onClick={(e) => { e.stopPropagation(); handleDelete(c.id) }}><Trash2 className="size-3" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          {selected ? (
            <>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{selected.name}</CardTitle>
                    <p className="text-[10px] text-muted-foreground">{selected.id} — Added {formatDate(selected.dateAdded)}</p>
                  </div>
                  <div className="flex gap-1.5">
                    {selected.isWholesaleBuyer && <Badge variant="secondary" className="text-[10px]">Wholesale ({selected.wholesaleDiscountPercent}%)</Badge>}
                    {selected.totalOverdueBalance > 0 && <Badge variant="outline" className="text-[10px] text-status-sold">{t("common.overdue")}</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <SummaryBox label="Total Invoices" value={selected.totalInvoices.toString()} />
                  <SummaryBox label="Open" value={selected.openInvoices.toString()} />
                  <SummaryBox label="Outstanding" value={formatAccountingAggregate(selected.grandTotalOutstanding)} color={selected.grandTotalOutstanding > 0 ? "text-status-sold" : ""} />
                  <SummaryBox label="Overdue" value={formatAccountingAggregate(selected.totalOverdueBalance)} color={selected.totalOverdueBalance > 0 ? "text-status-sold" : ""} />
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Clock className="size-3" />
                  {selected.daysSinceLastPayment !== null ? `${selected.daysSinceLastPayment} days since last payment` : "No payment activity yet"}
                </div>
                <Separator />
                <div className="grid gap-1.5 text-xs">
                  <div className="flex items-center gap-2 text-muted-foreground"><Phone className="size-3" />{selected.phone || "—"}</div>
                  <div className="flex items-center gap-2 text-muted-foreground"><Mail className="size-3" />{selected.email || "—"}</div>
                  <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="size-3" />{selected.address || "—"}</div>
                </div>
                <Separator />
                <div>
                  <h4 className="mb-1.5 text-xs font-medium">{t("cust.invoiceHistory")}</h4>
                  <div className="max-h-[200px] overflow-y-auto rounded-md border scrollbar-thin">
                    <Table>
                      <TableHeader><TableRow className="bg-muted/50"><TableHead className="h-7 text-[10px]">{t("common.invoice")}</TableHead><TableHead className="h-7 text-[10px] text-end">{t("common.total")}</TableHead><TableHead className="h-7 text-[10px] text-end">{t("common.balance")}</TableHead><TableHead className="h-7 text-[10px]">{t("cust.status")}</TableHead><TableHead className="h-7 text-[10px]">{t("common.date")}</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {selectedInvoices.map((i) => (
                          <TableRow
                            key={i.id}
                            className="cursor-pointer hover:bg-muted/30"
                            onClick={() => setDetailInvoice(i)}
                          >
                            <TableCell className="py-1 font-mono text-[10px]">{i.invoiceNumber}</TableCell>
                            <TableCell className="py-1 text-right text-[10px] tabular-nums">{formatInvoice(i, "totalNegotiated")}</TableCell>
                            <TableCell className="py-1 text-right text-[10px] tabular-nums">{formatInvoice(i, "balance")}</TableCell>
                            <TableCell className="py-1"><Badge variant="outline" className={`text-[9px] ${invoiceStatusClass(i.status)}`}>{i.status}</Badge></TableCell>
                            <TableCell className="py-1 text-[10px] text-muted-foreground">{formatDate(i.date)}</TableCell>
                          </TableRow>
                        ))}
                        {selectedInvoices.length === 0 && <TableRow><TableCell colSpan={5} className="h-12 text-center text-[11px] text-muted-foreground">{t("cust.noInvoices")}</TableCell></TableRow>}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </CardContent>
            </>
          ) : (
            <CardContent className="flex h-full min-h-[200px] items-center justify-center">
              <div className="flex flex-col items-center gap-1 text-muted-foreground"><Users className="size-8 opacity-30" /><span className="text-xs">{t("cust.noCustomers")}</span></div>
            </CardContent>
          )}
        </Card>
      </div>

      {/* Invoice Detail Dialog */}
      <Dialog open={!!detailInvoice} onOpenChange={(open) => { if (!open) setDetailInvoice(null) }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto custom-scrollbar">
          {detailInvoice && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-sm">
                  <Receipt className="size-4 text-primary" />
                  Invoice {detailInvoice.invoiceNumber}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="text-muted-foreground">{t("nav.customers")}:</span> {detailInvoice.customerName}</div>
                  <div><span className="text-muted-foreground">{t("common.date")}:</span> {detailInvoice.date}</div>
                  <div><span className="text-muted-foreground">{t("sales.dueDate")}:</span> {detailInvoice.dueDate}</div>
                  <div>
                    <span className="text-muted-foreground">{t("common.status")}:</span>{" "}
                    <Badge variant="outline" className={cn("text-[9px]", invoiceStatusClass(detailInvoice.status))}>{detailInvoice.status}</Badge>
                  </div>
                  <div><span className="text-muted-foreground">{t("common.total")}:</span> {formatInvoice(detailInvoice, "totalNegotiated")}</div>
                  <div><span className="text-muted-foreground">{t("common.paid")}:</span> {formatInvoice(detailInvoice, "totalPaid")}</div>
                  <div><span className="text-muted-foreground">{t("common.balance")}:</span> {formatInvoice(detailInvoice, "balance")}</div>
                  <div><span className="text-muted-foreground">{t("common.tax")}:</span> {formatInvoice(detailInvoice, "taxAmount")}</div>
                </div>

                <Separator />

                {/* Line Items */}
                <div>
                  <h4 className="font-medium mb-1">{t("common.items")}</h4>
                  <div className="max-h-40 overflow-y-auto custom-scrollbar rounded border">
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead className="h-6 text-[10px]">{t("common.name")}</TableHead><TableHead className="h-6 text-[10px] text-end">{t("common.quantity")}</TableHead><TableHead className="h-6 text-[10px] text-end">{t("common.unitPrice")}</TableHead><TableHead className="h-6 text-[10px] text-end">{t("common.total")}</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {detailInvoice.lineItems.map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="py-0.5 text-[10px]">{item.name}</TableCell>
                            <TableCell className="py-0.5 text-right text-[10px]">{item.quantity}</TableCell>
                            <TableCell className="py-0.5 text-right text-[10px]">{formatInvoiceLine(detailInvoice, item.unitPrice)}</TableCell>
                            <TableCell className="py-0.5 text-right text-[10px]">{formatInvoiceLine(detailInvoice, item.total)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                <Separator />

                {/* Payments */}
                <div>
                  <h4 className="font-medium mb-1">{t("common.payments")}</h4>
                  {payments.filter(p => p.invoiceId === detailInvoice.id).length > 0 ? (
                    <div className="max-h-40 overflow-y-auto custom-scrollbar rounded border">
                      <Table>
                        <TableHeader>
                          <TableRow><TableHead className="h-6 text-[10px]">{t("common.date")}</TableHead><TableHead className="h-6 text-[10px] text-end">{t("common.amount")}</TableHead><TableHead className="h-6 text-[10px]">{t("common.method")}</TableHead></TableRow>
                        </TableHeader>
                        <TableBody>
                          {payments.filter(p => p.invoiceId === detailInvoice.id).map((p) => (
                            <TableRow key={p.id}>
                              <TableCell className="py-0.5 text-[10px]">{p.date}</TableCell>
                              <TableCell className="py-0.5 text-right text-[10px]">
                                <div>{formatPayment(p, "original")}</div>
                                {p.currency !== p.accountingCurrency && <div className="text-[9px] text-muted-foreground">≈ {formatPayment(p, "accounting")}</div>}
                              </TableCell>
                              <TableCell className="py-0.5 text-[10px]">{p.method}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">{t("cust.noPayments")}</p>
                  )}
                </div>

                {/* Attached Documents */}
                <div>
                  <h4 className="font-medium mb-1">{t("common.documents")}</h4>
                  {detailInvoice.attachments.length > 0 ? (
                    <div className="space-y-1">
                      {parseAttachments(detailInvoice.attachments).map((doc, i) => (
                        <div key={i} className="flex items-center justify-between rounded bg-muted/30 px-2 py-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="size-3.5 text-muted-foreground" />
                            <span className="truncate text-[10px] font-medium">{doc.name}</span>
                          </div>
                          <a
                            href={doc.data}
                            download={doc.name}
                            className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                          >
                            <Download className="size-3" /> Download
                          </a>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">{t("cust.noDocuments")}</p>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SummaryBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm font-bold tabular-nums ${color ?? ""}`}>{value}</div>
    </div>
  )
}
