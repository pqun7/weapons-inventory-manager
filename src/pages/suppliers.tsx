import { useState, useMemo, useEffect } from "react"
import { Search, Plus, Building2, Phone, Mail, MapPin, Package, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Separator } from "@/components/ui/separator"
import { useStore } from "@/lib/store"
import { useNav } from "@/lib/nav"
import { useCurrency } from "@/lib/currency-context"
import { invoiceAccountingAmount, sumMoney, valuationAccountingAmount } from "@/lib/money-ui"
import { formatDate } from "@/lib/format"
import { toast } from "sonner"
import { useI18n } from "@/lib/i18n"

export function SuppliersPage() {
  const { t } = useI18n()
  const suppliers = useStore((s) => s.suppliers)
  const weapons = useStore((s) => s.weapons)
  const shipments = useStore((s) => s.shipments)
  const invoices = useStore((s) => s.invoices)
  const addSupplier = useStore((s) => s.addSupplier)
  const refreshFromDb = useStore((s) => s.refreshFromDb)
  const { formatAccountingAggregate, formatValuation } = useCurrency()
  const { navigate } = useNav()

  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newContact, setNewContact] = useState("")
  const [newPhone, setNewPhone] = useState("")
  const [newEmail, setNewEmail] = useState("")
  const [newAddress, setNewAddress] = useState("")

  useEffect(() => {
    void refreshFromDb()
  }, [refreshFromDb])

  const enriched = useMemo(() => {
    const weaponCounts = new Map<string, number>()
    const supplyValues = new Map<string, number>()
    for (const weapon of weapons) {
      if (!weapon.supplierId) continue
      weaponCounts.set(weapon.supplierId, (weaponCounts.get(weapon.supplierId) ?? 0) + 1)
      supplyValues.set(weapon.supplierId, sumMoney([
        supplyValues.get(weapon.supplierId),
        valuationAccountingAmount(weapon.purchasePriceValuation, weapon.purchasePrice),
      ]))
    }
    const shipmentCounts = new Map<string, number>()
    for (const shipment of shipments) shipmentCounts.set(shipment.supplierId, (shipmentCounts.get(shipment.supplierId) ?? 0) + 1)
    const debtBySupplier = new Map<string, { grandTotalOutstanding: number; totalOverdueBalance: number }>()
    for (const invoice of invoices) {
      if (invoice.type !== "Purchase" || invoice.voided || !invoice.supplierId) continue
      const current = debtBySupplier.get(invoice.supplierId) ?? { grandTotalOutstanding: 0, totalOverdueBalance: 0 }
      if (invoice.balance > 0) current.grandTotalOutstanding = sumMoney([current.grandTotalOutstanding, invoiceAccountingAmount(invoice, "balance")])
      if (invoice.status === "Overdue") current.totalOverdueBalance = sumMoney([current.totalOverdueBalance, invoiceAccountingAmount(invoice, "balance")])
      debtBySupplier.set(invoice.supplierId, current)
    }
    return suppliers.map((supplier) => {
      const debt = debtBySupplier.get(supplier.id)
      return {
        ...supplier,
        grandTotalOutstanding: debt?.grandTotalOutstanding ?? 0,
        totalOverdueBalance: debt?.totalOverdueBalance ?? 0,
        weaponCount: weaponCounts.get(supplier.id) ?? 0,
        supplyValue: supplyValues.get(supplier.id) ?? 0,
        shipmentCount: shipmentCounts.get(supplier.id) ?? 0,
      }
    })
  }, [suppliers, weapons, shipments, invoices])

  const filtered = useMemo(() => {
    if (!search) return enriched
    const q = search.toLowerCase()
    return enriched.filter((s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
  }, [enriched, search])

  const selected = filtered.find((s) => s.id === selectedId) || null
  const selectedShipments = selectedId ? shipments.filter((sh) => sh.supplierId === selectedId) : []
  const selectedWeapons = selectedId ? weapons.filter((w) => w.supplierId === selectedId).slice(0, 10) : []

  const handleAdd = async () => {
    if (!newName.trim()) { toast.error(t("sup.name")); return }
    const result = await addSupplier({
      name: newName.trim(),
      contactPerson: newContact.trim(),
      phone: newPhone.trim(),
      email: newEmail.trim(),
      address: newAddress.trim(),
    })
    if (!result.success) {
      toast.error(result.error ?? "Failed to add supplier")
      return
    }
    await refreshFromDb()
    toast.success(t("toast.supplierAdded"))
    setNewName(""); setNewContact(""); setNewPhone(""); setNewEmail(""); setNewAddress("")
    setAddOpen(false)
  }

  return (
    <div className="flex flex-col gap-3 p-3 lg:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={t("sup.search")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 ps-8 text-xs" />
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild><Button size="sm" className="h-8"><Plus className="size-3.5" /> {t("sup.addSupplier")}</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="text-sm">{t("sup.addSupplier")}</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div><Label className="text-xs">{t("sup.supplierName")}</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} className="h-8 text-xs" /></div>
              <div><Label className="text-xs">{t("sup.contactPerson")}</Label><Input value={newContact} onChange={(e) => setNewContact(e.target.value)} className="h-8 text-xs" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">{t("sup.phoneNumber")}</Label><Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} className="h-8 text-xs" /></div>
                <div><Label className="text-xs">{t("sup.emailAddress")}</Label><Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="h-8 text-xs" /></div>
              </div>
              <div><Label className="text-xs">{t("sup.supplierAddress")}</Label><Input value={newAddress} onChange={(e) => setNewAddress(e.target.value)} className="h-8 text-xs" /></div>
            </div>
            <DialogFooter><Button size="sm" variant="outline" onClick={() => setAddOpen(false)}>{t("common.cancel")}</Button><Button size="sm" onClick={handleAdd}>{t("common.add")}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-xs"><Building2 className="size-3.5" /> {t("sup.title")} ({filtered.length})</CardTitle></CardHeader>
          <CardContent className="max-h-[500px] overflow-y-auto p-0 scrollbar-thin">
            <Table>
              <TableHeader><TableRow className="bg-muted/50"><TableHead className="h-8 text-[10px]">{t("sup.name")}</TableHead><TableHead className="h-8 text-[10px] text-end">{t("settings.weapons")}</TableHead><TableHead className="h-8 text-[10px] text-end">{t("common.total")}</TableHead></TableRow></TableHeader>
              <TableBody>
                {filtered.map((s) => (
                  <TableRow key={s.id} className={`cursor-pointer ${selectedId === s.id ? "bg-muted" : ""}`} onClick={() => setSelectedId(s.id)}>
                    <TableCell className="py-1.5">
                      <div className="flex flex-col"><span className="text-xs font-medium">{s.name}</span><span className="text-[10px] text-muted-foreground">{s.id}</span></div>
                    </TableCell>
                    <TableCell className="py-1.5 text-end text-xs tabular-nums">{s.weaponCount}</TableCell>
                    <TableCell className="py-1.5 text-end text-xs tabular-nums text-muted-foreground">{formatAccountingAggregate(s.supplyValue)}</TableCell>
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
                <CardTitle className="text-base">{selected.name}</CardTitle>
                <p className="text-[10px] text-muted-foreground">{selected.id} — Added {formatDate(selected.dateAdded)}</p>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Box label={t("settings.weapons")} value={selected.weaponCount.toString()} />
                  <Box label={t("common.total")} value={formatAccountingAggregate(selected.supplyValue)} />
                  <Box label={t("sup.totalOrders")} value={selected.shipmentCount.toString()} />
                  <Box label={t("fin.totalOutstanding")} value={formatAccountingAggregate(selected.grandTotalOutstanding)} color={selected.grandTotalOutstanding > 0 ? "text-status-sold" : ""} />
                </div>
                <Separator />
                <div className="grid gap-1.5 text-xs">
                  <div className="flex items-center gap-2 text-muted-foreground"><Package className="size-3" />{selected.contactPerson || "—"}</div>
                  <div className="flex items-center gap-2 text-muted-foreground"><Phone className="size-3" />{selected.phone || "—"}</div>
                  <div className="flex items-center gap-2 text-muted-foreground"><Mail className="size-3" />{selected.email || "—"}</div>
                  <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="size-3" />{selected.address || "—"}</div>
                </div>
                <Separator />

                {selectedShipments.length > 0 && (
                  <div>
                    <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium"><Truck className="size-3.5" /> Shipments ({selectedShipments.length})</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedShipments.map((sh) => (
                        <Badge key={sh.id} variant="outline" className="cursor-pointer text-[10px]" onClick={() => navigate("shipments")}>
                          {sh.shipmentNumber} — {sh.status}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <h4 className="mb-1.5 text-xs font-medium">{t("inv.weapons")}</h4>
                  <div className="max-h-[150px] overflow-y-auto rounded-md border scrollbar-thin">
                    <Table>
                      <TableHeader><TableRow className="bg-muted/50"><TableHead className="h-7 text-[10px]">{t("weapon.serial")}</TableHead><TableHead className="h-7 text-[10px]">{t("weapon.brand")}</TableHead><TableHead className="h-7 text-[10px] text-end">{t("common.purchasePrice")}</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {selectedWeapons.map((w) => (
                          <TableRow key={w.id}><TableCell className="py-1 font-mono text-[10px]">{w.serialNumber}</TableCell><TableCell className="py-1 text-[10px]">{w.brand} {w.model}</TableCell><TableCell className="py-1 text-end text-[10px] tabular-nums">{formatValuation(w.purchasePriceValuation, "display", w.purchasePrice)}</TableCell></TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </CardContent>
            </>
          ) : (
            <CardContent className="flex h-full min-h-[200px] items-center justify-center">
              <div className="flex flex-col items-center gap-1 text-muted-foreground"><Building2 className="size-8 opacity-30" /><span className="text-xs">{t("sup.noSuppliers")}</span></div>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  )
}

function Box({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm font-bold tabular-nums ${color ?? ""}`}>{value}</div>
    </div>
  )
}
