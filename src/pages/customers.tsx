import { useState, useMemo, useCallback, useEffect } from "react"
import {
  Search, Plus, Users, Phone, Mail, MapPin, Trash2, Clock,
  FileText, Download, Receipt, Pencil, Check, CreditCard, ChevronLeft, ChevronRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { SavedFiltersBar } from "@/components/ui/saved-filters-bar"
import { useStore } from "@/lib/store"
import { useCurrency } from "@/lib/currency-context"
import { invoiceAccountingAmount, sumMoney } from "@/lib/money-ui"
import { formatDate, invoiceStatusClass } from "@/lib/format"
import type { SavedFilter, Invoice, Customer } from "@/lib/types"
import { toast } from "sonner"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { userFacingError } from "@/lib/user-facing-error"
import { useNav } from "@/lib/nav"

type CustomerTab = "all" | "dealers" | "direct"
type CustomerSummary = {
  totalInvoices: number
  openInvoices: number
  grandTotalOutstanding: number
  totalOverdueBalance: number
  lastPaymentDate: string | null
}

type CustomerFormData = {
  name: string
  phone: string
  email: string
  address: string
  isWholesaleBuyer: boolean
  notes: string
  customFields: Record<string, string>
}

type CustomFieldDraft = { id: string; label: string; value: string }

// نموذج عميل موحد للإضافة والتعديل
function CustomerForm({
  initialValues,
  onSave,
  onCancel,
  t,
}: {
  initialValues?: Partial<Customer>
  onSave: (data: CustomerFormData) => Promise<void>
  onCancel: () => void
  t: (key: string) => string
}) {
  const [name, setName] = useState(initialValues?.name ?? "")
  const [phone, setPhone] = useState(initialValues?.phone ?? "")
  const [email, setEmail] = useState(initialValues?.email ?? "")
  const [address, setAddress] = useState(initialValues?.address ?? "")
  const [isWholesale, setIsWholesale] = useState(initialValues?.isWholesaleBuyer ?? false)
  const [notes, setNotes] = useState(initialValues?.notes ?? "")
  const [customFields, setCustomFields] = useState<CustomFieldDraft[]>(() =>
    Object.entries(initialValues?.customFields ?? {}).map(([label, value]) => ({
      id: crypto.randomUUID(), label, value,
    })),
  )
  const [saving, setSaving] = useState(false)

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error(t("cust.nameRequired"))
      return
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error(t("settings.validEmailRequired"))
      return
    }
    if (saving) return
    const normalizedCustomFields: Record<string, string> = {}
    for (const field of customFields) {
      const label = field.label.trim()
      const value = field.value.trim()
      if (!label && !value) continue
      if (!label) return toast.error(t("cust.customFieldNameRequired"))
      if (label.length > 80 || value.length > 1000) return toast.error(t("cust.customFieldTooLong"))
      if (Object.keys(normalizedCustomFields).some((existing) => existing.toLocaleLowerCase() === label.toLocaleLowerCase())) {
        return toast.error(t("cust.customFieldDuplicate"))
      }
      normalizedCustomFields[label] = value
    }
    setSaving(true)
    try {
      await onSave({ name: name.trim(), phone: phone.trim(), email: email.trim(), address: address.trim(), isWholesaleBuyer: isWholesale, notes: notes.trim(), customFields: normalizedCustomFields })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-xs">{t("cust.name")} *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("cust.namePlaceholder")} className="h-8 text-xs" />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">{t("cust.phone")}</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 234 567 890" className="h-8 text-xs" />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">{t("cust.email")}</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("settings.emailExample")} className="h-8 text-xs" />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">{t("cust.address")}</Label>
          <Textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("cust.addressPlaceholder")} className="min-h-[60px] text-xs" />
        </div>
      </div>
      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <Label className="text-xs font-medium">{t("cust.wholesaleBuyer")}</Label>
          <p className="text-[10px] text-muted-foreground">{t("cust.wholesaleBuyerDesc")}</p>
        </div>
        <Switch checked={isWholesale} onCheckedChange={setIsWholesale} />
      </div>
      <div className="space-y-2">
        <Label className="text-xs">{t("common.notes")}</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[60px] text-xs" />
      </div>
      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <Label className="text-xs font-medium">{t("cust.customFields")}</Label>
            <p className="text-[10px] text-muted-foreground">{t("cust.customFieldsDesc")}</p>
          </div>
          <Button type="button" variant="outline" size="xs" onClick={() => setCustomFields((fields) => [...fields, { id: crypto.randomUUID(), label: "", value: "" }])}>
            <Plus className="size-3" /> {t("cust.addCustomField")}
          </Button>
        </div>
        {customFields.map((field) => (
          <div key={field.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] gap-2">
            <Input value={field.label} maxLength={80} placeholder={t("cust.customFieldName")} className="h-8 text-xs" onChange={(event) => setCustomFields((fields) => fields.map((item) => item.id === field.id ? { ...item, label: event.target.value } : item))} />
            <Input value={field.value} maxLength={1000} placeholder={t("cust.customFieldValue")} className="h-8 text-xs" onChange={(event) => setCustomFields((fields) => fields.map((item) => item.id === field.id ? { ...item, value: event.target.value } : item))} />
            <Button type="button" variant="ghost" size="icon-sm" className="text-destructive" aria-label={t("common.delete")} onClick={() => setCustomFields((fields) => fields.filter((item) => item.id !== field.id))}><Trash2 className="size-3.5" /></Button>
          </div>
        ))}
      </div>
      <DialogFooter className="gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" disabled={saving} onClick={() => void handleSubmit()}>
          <Check className="size-3.5 mr-1" /> {initialValues ? t("common.update") : t("common.add")}
        </Button>
      </DialogFooter>
    </div>
  )
}

export function CustomersPage() {
  const { t } = useI18n()
  const customers = useStore((s) => s.customers)
  const invoices = useStore((s) => s.invoices)
  const payments = useStore((s) => s.payments)
  const getInvoicesByCustomerId = useStore((s) => s.getInvoicesByCustomerId)
  const addCustomer = useStore((s) => s.addCustomer)
  const updateCustomer = useStore((s) => s.updateCustomer)
  const deleteCustomer = useStore((s) => s.deleteCustomer)
  const refreshFromDb = useStore((s) => s.refreshFromDb)
  const { formatAccountingAggregate, formatInvoice, formatInvoiceLine, formatPayment } = useCurrency()
  const { selectedCustomerId: selectedId, setSelectedCustomerId: setSelectedId } = useNav()

  const [search, setSearch] = useState("")
  const [tab, setTab] = useState<CustomerTab>("all")
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<Customer | null>(null)
  const [page, setPage] = useState(0)

  // Invoice detail dialog
  const [detailInvoice, setDetailInvoice] = useState<Invoice | null>(null)

  useEffect(() => {
    void refreshFromDb()
  }, [refreshFromDb])

  // حساب الإحصائيات لكل عميل (نفس المنطق السابق)
  const enriched = useMemo(() => {
    // ... الكود نفسه من السؤال لإنشاء enriched ...
    // سأختصره هنا للتركيز على UI، لكنه موجود بالكامل في التطبيق
    const activeInvoices = invoices.filter((i) => !i.voided)
    const paymentsByInvoice = new Map<string, string>()
    for (const payment of payments) {
      const current = paymentsByInvoice.get(payment.invoiceId)
      if (!current || payment.date > current) paymentsByInvoice.set(payment.invoiceId, payment.date)
    }
    const summaryByCustomer = new Map<string, CustomerSummary>()
    for (const invoice of activeInvoices) {
      if (!invoice.customerId) continue
      const current = summaryByCustomer.get(invoice.customerId) ?? {
        totalInvoices: 0, openInvoices: 0, grandTotalOutstanding: 0,
        totalOverdueBalance: 0, lastPaymentDate: null,
      }
      current.totalInvoices++
      if (invoice.balance > 0) {
        current.openInvoices++
        current.grandTotalOutstanding = sumMoney([current.grandTotalOutstanding, invoiceAccountingAmount(invoice, "balance")])
      }
      if (invoice.status === "Overdue") current.totalOverdueBalance = sumMoney([current.totalOverdueBalance, invoiceAccountingAmount(invoice, "balance")])
      const paymentDate = paymentsByInvoice.get(invoice.id)
      if (paymentDate && (!current.lastPaymentDate || paymentDate > current.lastPaymentDate)) current.lastPaymentDate = paymentDate
      summaryByCustomer.set(invoice.customerId, current)
    }
    return customers.map((c) => {
      const summary = summaryByCustomer.get(c.id)
      const lastPaymentDate = summary?.lastPaymentDate ?? null
      return ({
      ...c,
      totalInvoices: summary?.totalInvoices ?? 0,
      openInvoices: summary?.openInvoices ?? 0,
      grandTotalOutstanding: summary?.grandTotalOutstanding ?? 0,
      totalOverdueBalance: summary?.totalOverdueBalance ?? 0,
      daysSinceLastPayment: lastPaymentDate
        ? Math.max(0, Math.floor((Date.now() - new Date(lastPaymentDate).getTime()) / 86400000))
        : null,
      })
    })
  }, [customers, invoices, payments])

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
  useEffect(() => { setPage(0) }, [search, tab])
  const pageSize = 25
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pagedCustomers = filtered.slice(page * pageSize, (page + 1) * pageSize)

  const selected = filtered.find((c) => c.id === selectedId) || enriched.find((c) => c.id === selectedId) || null
  const selectedInvoices = selectedId ? getInvoicesByCustomerId(selectedId) : []

  const handleLoadFilter = useCallback((filter: SavedFilter) => {
    const state = filter.filterState ?? {}
    if (typeof state.search === "string") setSearch(state.search)
    const savedTab = state.tab
    if (savedTab === "all" || savedTab === "dealers" || savedTab === "direct") setTab(savedTab)
    toast.success(`Loaded filter "${filter.name}"`)
  }, [])

  const handleAdd = async (data: CustomerFormData) => {
    const result = await addCustomer({
      ...data,
      wholesaleDiscountPercent: data.isWholesaleBuyer ? 10 : 0,
    })
    if (result.success) {
      toast.success(t("toast.customerAdded"))
      setAddOpen(false)
    } else {
      console.error("Customer creation failed", result.error)
      toast.error(userFacingError(result.error, "Unable to create the customer."))
    }
  }

  const handleUpdate = async (id: string, data: CustomerFormData) => {
    const result = await updateCustomer(id, {
      ...data,
      wholesaleDiscountPercent: data.isWholesaleBuyer ? 10 : 0,
    })
    if (result.success) {
      toast.success(t("toast.customerUpdated"))
      setEditOpen(false)
      setEditingCustomer(null)
    } else {
      console.error("Customer update failed", result.error)
      toast.error(t("toast.customerUpdateFailed"))
    }
  }

  const handleDelete = async (id: string) => {
    const result = await deleteCustomer(id)
    if (result.success) {
      toast.success(t("toast.customerDeleted"))
      if (selectedId === id) setSelectedId(null)
      setDeleteCandidate(null)
    } else {
      console.error("Customer deletion failed", result.error)
      toast.error(userFacingError(result.error, "Unable to delete the customer."))
    }
  }

  const parseAttachments = (attachments: string[]) =>
    attachments.map((a) => {
      try {
        return JSON.parse(a) as { name: string; data: string }
      } catch {
        return { name: "Unknown", data: a }
      }
    })

  // للتبديل إلى وضع التعديل
  const openEditDialog = () => {
    if (!selected) return
    setEditingCustomer(selected)
    setEditOpen(true)
  }

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      {/* الرأسية: عنوان وزر الإضافة */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("cust.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("cust.description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="h-8" onClick={() => setAddOpen(true)}>
            <Plus className="size-3.5" /> {t("cust.addCustomer")}
          </Button>
        </div>
      </div>

      {/* البحث والتصفية */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("cust.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as CustomerTab)}>
          <TabsList className="h-8">
            <TabsTrigger value="all" className="text-xs">{t("common.all")}</TabsTrigger>
            <TabsTrigger value="dealers" className="text-xs">{t("cust.dealers")}</TabsTrigger>
            <TabsTrigger value="direct" className="text-xs">{t("cust.directBuyers")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <SavedFiltersBar
          entityType="customers"
          currentFilterState={{ search, tab }}
          onLoadFilter={handleLoadFilter}
        />
      </div>

      {/* التخطيط الرئيسي: قائمة العملاء + التفاصيل */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* قائمة العملاء */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-xs">
              <Users className="size-3.5" /> {t("cust.customersList")} ({filtered.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[500px] overflow-y-auto p-0 scrollbar-thin">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="h-8 text-[10px]">{t("cust.name")}</TableHead>
                  <TableHead className="h-8 text-[10px] text-end">{t("common.balance")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedCustomers.map((c) => (
                  <TableRow
                    key={c.id}
                    className={cn("cursor-pointer", selectedId === c.id && "bg-muted")}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <TableCell className="py-1.5">
                      <div className="flex flex-col">
                        <span className="text-xs font-medium">{c.name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {c.id.slice(0, 8)}... {c.isWholesaleBuyer ? "(W)" : ""}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="py-1.5 text-right">
                      <span
                        className={cn(
                          "text-xs tabular-nums font-medium",
                          c.grandTotalOutstanding > 0 ? "text-status-sold" : "text-muted-foreground"
                        )}
                      >
                        {formatAccountingAggregate(c.grandTotalOutstanding)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="h-12 text-center text-xs text-muted-foreground">
                      {t("cust.noCustomersFound")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {filtered.length > pageSize && <div className="flex items-center justify-center gap-2 border-t p-2 text-[10px] text-muted-foreground"><Button size="xs" variant="outline" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronLeft className="size-3" /></Button><span>{page + 1} / {pageCount}</span><Button size="xs" variant="outline" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}><ChevronRight className="size-3" /></Button></div>}
          </CardContent>
        </Card>

        {/* تفاصيل العميل */}
        <Card className="lg:col-span-2">
          {selected ? (
            <>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      {selected.name}
                      {selected.isWholesaleBuyer && (
                        <Badge variant="secondary" className="text-[10px]">
                          {t("cust.wholesale")} ({selected.wholesaleDiscountPercent}%)
                        </Badge>
                      )}
                    </CardTitle>
                    <p className="text-[10px] text-muted-foreground">
                      {selected.id} — {t("cust.since")} {formatDate(selected.dateAdded)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="xs" onClick={openEditDialog}>
                      <Pencil className="size-3 mr-1" /> {t("common.edit")}
                    </Button>
                    <Button variant="outline" size="xs" className="text-status-sold" onClick={() => setDeleteCandidate(selected)}>
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                {/* ملخص الأرقام */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <SummaryBox label={t("cust.totalInvoices")} value={selected.totalInvoices.toString()} />
                  <SummaryBox label={t("cust.open")} value={selected.openInvoices.toString()} />
                  <SummaryBox
                    label={t("cust.outstanding")}
                    value={formatAccountingAggregate(selected.grandTotalOutstanding)}
                    color={selected.grandTotalOutstanding > 0 ? "text-status-sold" : ""}
                  />
                  <SummaryBox
                    label={t("cust.overdue")}
                    value={formatAccountingAggregate(selected.totalOverdueBalance)}
                    color={selected.totalOverdueBalance > 0 ? "text-status-sold" : ""}
                  />
                </div>

                {/* معلومات الاتصال */}
                <div className="grid gap-2 text-xs">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="size-3" /> {selected.phone || "—"}
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="size-3" /> {selected.email || "—"}
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="size-3" /> {selected.address || "—"}
                  </div>
                  {selected.daysSinceLastPayment !== null && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="size-3" />
                      {t("cust.lastPayment")}: {selected.daysSinceLastPayment} {t("common.days")}
                    </div>
                  )}
                  {Object.entries(selected.customFields ?? {}).map(([label, value]) => (
                    <div key={label} className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-3 rounded-md border bg-muted/20 px-3 py-2">
                      <span className="font-medium text-foreground">{label}</span>
                      <span className="break-words text-muted-foreground">{value || "—"}</span>
                    </div>
                  ))}
                </div>

                <Separator />

                {/* تبويبات: نظرة عامة والفواتير */}
                <Tabs defaultValue="invoices" className="w-full">
                  <TabsList className="h-7">
                    <TabsTrigger value="invoices" className="text-xs">
                      <Receipt className="size-3 mr-1" /> {t("cust.invoices")}
                    </TabsTrigger>
                    <TabsTrigger value="overview" className="text-xs">
                      <CreditCard className="size-3 mr-1" /> {t("common.overview")}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="invoices" className="mt-2">
                    <div className="max-h-[300px] overflow-y-auto rounded-md border scrollbar-thin">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead className="h-7 text-[10px]">{t("common.invoice")}</TableHead>
                            <TableHead className="h-7 text-[10px] text-end">{t("common.total")}</TableHead>
                            <TableHead className="h-7 text-[10px] text-end">{t("common.balance")}</TableHead>
                            <TableHead className="h-7 text-[10px]">{t("common.status")}</TableHead>
                            <TableHead className="h-7 text-[10px]">{t("common.date")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedInvoices.map((i) => (
                            <TableRow
                              key={i.id}
                              className="cursor-pointer hover:bg-muted/30"
                              onClick={() => setDetailInvoice(i)}
                            >
                              <TableCell className="py-1 font-mono text-[10px]">{i.invoiceNumber}</TableCell>
                              <TableCell className="py-1 text-right text-[10px] tabular-nums">
                                {formatInvoice(i, "totalNegotiated")}
                              </TableCell>
                              <TableCell className="py-1 text-right text-[10px] tabular-nums">
                                {formatInvoice(i, "balance")}
                              </TableCell>
                              <TableCell className="py-1">
                                <Badge variant="outline" className={cn("text-[9px]", invoiceStatusClass(i.status))}>
                                  {i.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="py-1 text-[10px] text-muted-foreground">
                                {formatDate(i.date)}
                              </TableCell>
                            </TableRow>
                          ))}
                          {selectedInvoices.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={5} className="h-12 text-center text-[11px] text-muted-foreground">
                                {t("cust.noInvoices")}
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </TabsContent>

                  <TabsContent value="overview" className="mt-2">
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("cust.totalInvoices")}</span>
                        <span className="font-medium">{selected.totalInvoices}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("cust.openInvoices")}</span>
                        <span className="font-medium">{selected.openInvoices}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("cust.totalOutstanding")}</span>
                        <span className="font-medium text-status-sold">
                          {formatAccountingAggregate(selected.grandTotalOutstanding)}
                        </span>
                      </div>
                      <Separator />
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("cust.wholesaleBuyer")}</span>
                        <span>{selected.isWholesaleBuyer ? t("common.yes") : t("common.no")}</span>
                      </div>
                      {selected.notes && (
                        <div className="mt-2 rounded bg-muted/50 p-2 text-[10px]">
                          {selected.notes}
                        </div>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </>
          ) : (
            <CardContent className="flex h-full min-h-[300px] items-center justify-center">
              <div className="flex flex-col items-center gap-1 text-muted-foreground">
                <Users className="size-8 opacity-30" />
                <span className="text-xs">{t("cust.selectCustomer")}</span>
              </div>
            </CardContent>
          )}
        </Card>
      </div>

      {/* حوار إضافة عميل */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">{t("cust.addCustomer")}</DialogTitle>
          </DialogHeader>
          <CustomerForm
            onSave={handleAdd}
            onCancel={() => setAddOpen(false)}
            t={t}
          />
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleteCandidate !== null}
        onOpenChange={(open) => { if (!open) setDeleteCandidate(null) }}
        title={t("cust.deleteCustomer")}
        description={deleteCandidate ? `Delete ${deleteCandidate.name}? This is only allowed when no active invoices exist.` : ""}
        variant="destructive"
        onConfirm={() => { if (deleteCandidate) void handleDelete(deleteCandidate.id) }}
      />

      {/* حوار تعديل عميل */}
      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setEditingCustomer(null) }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">{t("cust.editCustomer")}</DialogTitle>
          </DialogHeader>
          {editingCustomer && (
            <CustomerForm
              initialValues={editingCustomer}
              onSave={(data) => handleUpdate(editingCustomer.id, data)}
              onCancel={() => { setEditOpen(false); setEditingCustomer(null) }}
              t={t}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* حوار تفاصيل الفاتورة (كما هو) مع تحسينات طفيفة */}
      <Dialog open={!!detailInvoice} onOpenChange={(open) => { if (!open) setDetailInvoice(null) }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto custom-scrollbar">
          {detailInvoice && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-sm">
                  <Receipt className="size-4" />
                  {t("common.invoice")} {detailInvoice.invoiceNumber}
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
                            <Download className="size-3" /> {t("common.download")}
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
