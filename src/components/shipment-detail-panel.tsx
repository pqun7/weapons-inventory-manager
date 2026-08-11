import { useMemo, useState } from "react"
import {
  Package, FileText, History, Info, Upload, Trash2, Download, ChevronDown,
  Truck, MapPin, DollarSign, Hash, Building2, Calendar,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { DatePicker } from "@/components/ui/date-picker"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useStore } from "@/lib/store"
import { useI18n } from "@/lib/i18n"
import { useNav } from "@/lib/nav"
import { useCurrency } from "@/lib/currency-context"
import { multiplyMoney, sumMoney, valuationAccountingAmount } from "@/lib/money-ui"
import { formatDate, formatDateTime, shipmentStatusClass, shipmentDelayDays } from "@/lib/format"
import type { ShipmentStatus, Shipment, ShipmentLineItem } from "@/lib/types"
import { toast } from "sonner"
import { manifestClient } from "@/lib/manifest-client"

const SHIPMENT_STATUSES: ShipmentStatus[] = ["Pending", "In Transit", "Delayed", "Arrived", "Cancelled", "Partial"]

interface ShipmentDetailPanelProps {
  shipment: Shipment
}

export function ShipmentDetailPanel({ shipment }: ShipmentDetailPanelProps) {
  const [costDetailsOpen, setCostDetailsOpen] = useState(false)
  const { t } = useI18n()
  const suppliers = useStore((s) => s.suppliers)
  const weapons = useStore((s) => s.weapons)
  const { formatValuation, formatAccountingAggregate } = useCurrency()
  const setShipmentStatus = useStore((s) => s.setShipmentStatus)
  const updateShipment = useStore((s) => s.updateShipment)
  const deleteShipment = useStore((s) => s.deleteShipment)
  const addShipmentDocument = useStore((s) => s.addShipmentDocument)
  const deleteShipmentDocument = useStore((s) => s.deleteShipmentDocument)
  const refreshFromDb = useStore((s) => s.refreshFromDb)
  const currentUser = useStore((s) => s.getCurrentUser())
  const { setSelectedWeaponId, navigate } = useNav()

  const [activeTab, setActiveTab] = useState("overview")
  const [docCategory, setDocCategory] = useState("Invoice")
  const [editingMeta, setEditingMeta] = useState(false)
  const [editCarrier, setEditCarrier] = useState(shipment.shippingCarrier ?? "")
  const [editContainer, setEditContainer] = useState(shipment.containerNumber ?? "")
  const [editNotes, setEditNotes] = useState(shipment.notes)
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [newExpectedDate, setNewExpectedDate] = useState(shipment.expectedArrivalDate)
  const [delayReason, setDelayReason] = useState("")
  const [arrivalBusy, setArrivalBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const supplier = suppliers.find((s) => s.id === shipment.supplierId)
  const shipmentWeapons = useMemo(() => weapons.filter((w) => w.shipmentId === shipment.id), [weapons, shipment.id])
  const registered = shipmentWeapons.length
  const pct = shipment.totalExpectedItems > 0 ? Math.round((registered / shipment.totalExpectedItems) * 100) : 0

  const statusKey: Record<ShipmentStatus, string> = {
    "Pending": "ship.pending",
    "In Transit": "ship.inTransit",
    "Delayed": "ship.delayed",
    "Arrived": "ship.arrived",
    "Cancelled": "ship.cancelled",
    "Partial": "ship.partial",
  }

  const lineItems = shipment.lineItems ?? []
  const documents = shipment.documents ?? []
  const delayDays = shipmentDelayDays(shipment.expectedArrivalDate, shipment.status)

  const handleSaveMeta = () => {
    updateShipment(shipment.id, {
      shippingCarrier: editCarrier,
      containerNumber: editContainer,
      notes: editNotes,
    })
    setEditingMeta(false)
    toast.success(t("toast.shipmentUpdated"))
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text().catch(() => "")
    addShipmentDocument(shipment.id, {
      fileName: file.name,
      fileType: file.type || file.name.split(".").pop() || "unknown",
      fileSize: file.size,
      category: docCategory,
      extractedText: text.slice(0, 5000),
    })
    toast.success(t("ship.docUploaded"))
    e.target.value = ""
  }

  const handleDownloadDoc = (doc: typeof documents[0]) => {
    const blob = new Blob([doc.extractedText || ""], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = doc.fileName
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleStatusChange = (status: ShipmentStatus) => {
    setShipmentStatus(shipment.id, status)
    if (status === "Arrived") toast.success(t("ship.shipmentArrived"))
    else toast.success(t("toast.shipmentUpdated"))
  }

  const handleDeleteShipment = async () => {
    const confirmed = window.confirm(t("ship.deleteConfirm"))
    if (!confirmed) return
    setDeleteBusy(true)
    try {
      const result = await deleteShipment(shipment.id)
      if (!result.success) throw new Error(result.error ?? t("ship.deleteFailed"))
      toast.success(t("ship.deleted"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("ship.deleteFailed"))
    } finally {
      setDeleteBusy(false)
    }
  }

  const confirmManifestArrival = async () => {
    if (!shipment.importId) return
    setArrivalBusy(true)
    try {
      const result = await manifestClient.confirmArrival(shipment.importId, { id: currentUser.id, name: currentUser.name })
      if (!result.success) throw new Error(result.error ?? "Unable to confirm arrival")
      await refreshFromDb()
      toast.success("Shipment arrival confirmed and inventory received")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to confirm arrival") }
    finally { setArrivalBusy(false) }
  }

  const rescheduleManifestArrival = async () => {
    if (!shipment.importId) return
    setArrivalBusy(true)
    try {
      const result = await manifestClient.reschedule(shipment.importId, newExpectedDate, delayReason, { id: currentUser.id, name: currentUser.name })
      if (!result.success) throw new Error(result.error ?? "Unable to reschedule shipment")
      await refreshFromDb(); setRescheduleOpen(false); setDelayReason("")
      toast.success("Shipment remains pending with a new expected date")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to reschedule shipment") }
    finally { setArrivalBusy(false) }
  }

  const productSubtotalAccounting = sumMoney(lineItems.map((item) => multiplyMoney(
      valuationAccountingAmount(item.purchasePriceValuation, item.purchasePrice),
      item.quantity,
    )))
  const shipmentAdditionalCostsAccounting = sumMoney((shipment.additionalCosts ?? []).map((cost) => Number(cost.baseAmount)))
  const totalCostAccounting = shipment.totalCostValuation?.accountingAmount
    ?? sumMoney([productSubtotalAccounting, shipmentAdditionalCostsAccounting])
  const totalRetailAccounting = sumMoney(lineItems.map((item) => multiplyMoney(
    valuationAccountingAmount(item.retailPriceValuation, item.retailPrice),
    item.quantity,
  )))

  return (
    <>
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5">
            <Truck className="size-4" />
            <span className="font-mono">{shipment.shipmentNumber}</span>
          </span>
          <span className="flex items-center gap-1">
            {currentUser.role === "Admin" && (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={deleteBusy}
                aria-label={t("ship.delete")}
                onClick={() => void handleDeleteShipment()}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
            <Badge variant="outline" className={`text-[9px] ${shipmentStatusClass(shipment.status)}`}>
              {t(statusKey[shipment.status])}
            </Badge>
          </span>
        </CardTitle>
        <p className="text-[10px] text-muted-foreground">
          {supplier?.name ?? shipment.supplierId} — {formatDate(shipment.shipmentDate)}
        </p>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-2">
        <div className="grid grid-cols-4 gap-2 rounded-md border p-2 text-center">
          <div>
            <div className="text-[10px] text-muted-foreground">{t("ship.expected")}</div>
            <div className="text-base font-bold tabular-nums">{shipment.totalExpectedItems}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">{t("ship.registered")}</div>
            <div className="text-base font-bold tabular-nums text-status-returned">{registered}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">{t("ship.of")}</div>
            <div className="text-base font-bold tabular-nums text-status-sold">{shipment.totalExpectedItems - registered}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">{t("ship.progress")}</div>
            <div className="text-base font-bold tabular-nums">{pct}%</div>
          </div>
        </div>
        <Progress value={pct} className="h-2" />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
          <TabsList className="h-8 w-full">
            <TabsTrigger value="overview" className="text-[11px]">
              <Info className="size-3" /> {t("ship.tabOverview")}
            </TabsTrigger>
            <TabsTrigger value="items" className="text-[11px]">
              <Package className="size-3" /> {t("ship.tabItems")} ({lineItems.length})
            </TabsTrigger>
            <TabsTrigger value="documents" className="text-[11px]">
              <FileText className="size-3" /> {t("ship.tabDocs")} ({documents.length})
            </TabsTrigger>
            <TabsTrigger value="timeline" className="text-[11px]">
              <History className="size-3" /> {t("ship.tabTimeline")} ({shipment.timeline.length})
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="mt-2">
            <ScrollArea className="max-h-[280px]">
              <div className="flex flex-col gap-2 pe-2">
                {/* Metadata grid */}
                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                  <MetaRow icon={Building2} label={t("ship.supplier")} value={supplier?.name ?? "—"} />
                  <MetaRow icon={Hash} label={t("ship.purchaseOrder")} value={shipment.purchaseOrderNumber || "—"} />
                  <MetaRow icon={Hash} label={t("ship.invoiceNumber")} value={shipment.invoiceNumber || "—"} />
                  <MetaRow icon={Truck} label={t("ship.shippingCarrier")} value={shipment.shippingCarrier || "—"} />
                  <MetaRow icon={Hash} label={t("ship.containerNumber")} value={shipment.containerNumber || "—"} />
                  <MetaRow icon={DollarSign} label={t("ship.currency")} value={shipment.currency || "—"} />
                  <MetaRow icon={Calendar} label={t("ship.purchaseDate")} value={shipment.purchaseDate ? formatDate(shipment.purchaseDate) : "—"} />
                  <MetaRow icon={Calendar} label={t("ship.expectedArrival")} value={formatDate(shipment.expectedArrivalDate)} />
                  <MetaRow icon={Calendar} label={t("ship.actualArrival")} value={shipment.actualArrivalDate ? formatDate(shipment.actualArrivalDate) : "—"} />
                  <MetaRow icon={MapPin} label={t("common.warehouse")} value={lineItems[0]?.location.warehouse ?? "—"} />
                </div>

                {delayDays > 0 && (
                  <div className="flex items-center gap-2 rounded-md border border-status-sold/30 bg-status-sold/10 p-2">
                    <span className="text-[11px] font-medium text-status-sold-fg">
                      {t("ship.delayed")} — {delayDays} {t("ship.delayDays")}
                    </span>
                  </div>
                )}

                {/* Financial summary */}
                {lineItems.length > 0 && (
                  <div className="rounded-md border p-2">
                    <div className="mb-1 text-[10px] font-medium text-muted-foreground">{t("ship.financialBreakdown")}</div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] lg:grid-cols-4">
                      <div>
                        <span className="text-muted-foreground">{t("cost.productSubtotal")}</span>
                        <div className="font-bold tabular-nums">{formatAccountingAggregate(productSubtotalAccounting)}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">{t("cost.shipmentAdditionalCosts")}</span>
                        <div className="font-bold tabular-nums">{formatAccountingAggregate(shipmentAdditionalCostsAccounting)}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">{t("cost.totalShipmentCost")}</span>
                        <div className="font-bold tabular-nums text-primary">{shipment.totalCostValuation ? formatValuation(shipment.totalCostValuation, "display") : formatAccountingAggregate(totalCostAccounting)}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">{t("ship.projectedProfit")}</span>
                        <div className="font-bold tabular-nums text-status-returned-fg">{formatAccountingAggregate(sumMoney([totalRetailAccounting, -totalCostAccounting]))}</div>
                      </div>
                    </div>
                    {(shipment.additionalCosts ?? []).length > 0 && (
                      <Collapsible open={costDetailsOpen} onOpenChange={setCostDetailsOpen} className="mt-2 border-t pt-1">
                        <CollapsibleTrigger asChild><Button size="xs" variant="ghost" className="px-0 text-muted-foreground">{t("cost.viewBreakdown")} <ChevronDown className={`size-3 transition-transform ${costDetailsOpen ? "rotate-180" : ""}`} /></Button></CollapsibleTrigger>
                        <CollapsibleContent className="space-y-1 pt-1">{shipment.additionalCosts!.map((cost) => <div key={cost.id} className="flex flex-wrap items-center justify-between gap-1 text-[10px]"><span>{cost.name} · {t(`cost.${cost.scope}`)} · {t(`cost.${cost.allocationMethod}`)}</span><span className="tabular-nums" dir="ltr">{cost.calculatedAmount} {cost.currency}</span></div>)}</CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>
                )}

                <Separator />

                {/* Status control */}
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">{t("common.status")}:</Label>
                  <Select disabled={Boolean(shipment.importId)} value={shipment.status} onValueChange={(v) => handleStatusChange(v as ShipmentStatus)}>
                    <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SHIPMENT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{t(statusKey[s])}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Edit metadata */}
                {editingMeta ? (
                  <div className="flex flex-col gap-2 rounded-md border p-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-[10px]">{t("ship.shippingCarrier")}</Label>
                        <Input value={editCarrier} onChange={(e) => setEditCarrier(e.target.value)} className="h-7 text-[11px]" />
                      </div>
                      <div>
                        <Label className="text-[10px]">{t("ship.containerNumber")}</Label>
                        <Input value={editContainer} onChange={(e) => setEditContainer(e.target.value)} className="h-7 text-[11px]" />
                      </div>
                    </div>
                    <div>
                      <Label className="text-[10px]">{t("common.notes")}</Label>
                      <Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="h-7 text-[11px]" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" className="h-7 text-[11px]" onClick={handleSaveMeta}>{t("common.save")}</Button>
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setEditingMeta(false)}>{t("common.cancel")}</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {shipment.importId && shipment.workflowStatus === "scheduled" && (
                      <>
                        <Button size="sm" className="h-7 text-[11px]" disabled={arrivalBusy} onClick={confirmManifestArrival}>✓ Confirm arrival</Button>
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={arrivalBusy} onClick={() => setRescheduleOpen(true)}>Not arrived yet</Button>
                      </>
                    )}
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setEditingMeta(true)}>
                      {t("ship.editMetadata")}
                    </Button>
                    {shipment.status !== "Arrived" && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => { setSelectedWeaponId(null); navigate("inventory") }}>
                        <Package className="size-3" /> {t("ship.registerWeapons")}
                      </Button>
                    )}
                  </div>
                )}

                {shipment.notes && !editingMeta && (
                  <p className="text-[11px] text-muted-foreground">{shipment.notes}</p>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Line Items Tab */}
          <TabsContent value="items" className="mt-2">
            <ScrollArea className="max-h-[280px]">
              <div className="pe-2">
                {lineItems.length === 0 ? (
                  <div className="flex h-20 items-center justify-center text-[11px] text-muted-foreground">
                    {t("ship.noLineItems")}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="h-7 text-[10px]">#</TableHead>
                        <TableHead className="h-7 text-[10px]">{t("common.type")}</TableHead>
                        <TableHead className="h-7 text-[10px]">{t("weapon.brand")}</TableHead>
                        <TableHead className="h-7 text-[10px]">{t("weapon.model")}</TableHead>
                        <TableHead className="h-7 text-[10px]">{t("common.quantity")}</TableHead>
                        <TableHead className="h-7 text-[10px]">{t("ship.serials")}</TableHead>
                        <TableHead className="h-7 text-[10px]">{t("common.purchasePrice")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lineItems.map((item, idx) => (
                        <LineItemRow key={item.id} item={item} idx={idx + 1} t={t} />
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </ScrollArea>

            {/* Registered weapons */}
            {shipmentWeapons.length > 0 && (
              <div className="mt-2">
                <Separator className="mb-2" />
                <h4 className="mb-1 text-[11px] font-medium">{t("ship.registered")} ({shipmentWeapons.length})</h4>
                <ScrollArea className="max-h-[120px]">
                  <div className="flex flex-wrap gap-1 pe-2">
                    {shipmentWeapons.map((w) => (
                      <Badge
                        key={w.id}
                        variant="outline"
                        className="cursor-pointer font-mono text-[9px] hover:bg-muted/50"
                        onClick={() => { setSelectedWeaponId(w.id); navigate("inventory") }}
                      >
                        {w.serialNumber}
                      </Badge>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents" className="mt-2">
            <ScrollArea className="max-h-[280px]">
              <div className="flex flex-col gap-2 pe-2">
                <div className="flex items-center gap-2 rounded-md border p-2">
                  <Select value={docCategory} onValueChange={setDocCategory}>
                    <SelectTrigger className="h-7 w-32 text-[11px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Invoice">{t("shipmentDoc.invoice")}</SelectItem>
                      <SelectItem value="Packing List">{t("shipmentDoc.packingList")}</SelectItem>
                      <SelectItem value="Bill of Lading">{t("shipmentDoc.billOfLading")}</SelectItem>
                      <SelectItem value="Certificate">{t("shipmentDoc.certificate")}</SelectItem>
                      <SelectItem value="Other">{t("shipmentDoc.other")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Label className="cursor-pointer flex-1">
                    <Button size="sm" variant="outline" className="h-7 w-full text-[11px]" asChild>
                      <span><Upload className="size-3" /> {t("ship.uploadDocs")}</span>
                    </Button>
                    <input type="file" className="hidden" onChange={handleFileUpload} />
                  </Label>
                </div>

                {documents.length === 0 ? (
                  <div className="flex h-20 items-center justify-center text-[11px] text-muted-foreground">
                    {t("ship.noDocuments")}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {documents.map((doc) => (
                      <div key={doc.id} className="flex items-center justify-between rounded-md border p-2">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <FileText className="size-3 text-muted-foreground" />
                            <span className="truncate text-[11px] font-medium">{doc.fileName}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                            <Badge variant="outline" className="h-3.5 px-1 text-[8px]">{doc.category}</Badge>
                            <span>{(doc.fileSize / 1024).toFixed(1)} KB</span>
                            <span>{formatDateTime(doc.uploadDate)}</span>
                            <span>{doc.uploadedBy}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button size="xs" variant="ghost" className="h-6 text-[10px]" onClick={() => handleDownloadDoc(doc)}>
                            <Download className="size-3" />
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            className="h-6 text-[10px] text-destructive"
                            onClick={() => { deleteShipmentDocument(shipment.id, doc.id); toast.success(t("ship.docDeleted")) }}
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Timeline Tab */}
          <TabsContent value="timeline" className="mt-2">
            <ScrollArea className="max-h-[280px]">
              <div className="pe-2">
                {shipment.timeline.map((entry, idx) => (
                  <div key={entry.id} className={`flex items-start gap-2 px-1 py-1.5 ${idx !== shipment.timeline.length - 1 ? "border-b" : ""}`}>
                    <div className="flex flex-col items-center pt-0.5">
                      <div className={`size-1.5 rounded-full ${shipmentStatusClass(entry.status).split(" ")[0]}`} />
                      {idx !== shipment.timeline.length - 1 && <div className="w-px flex-1 bg-border" />}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline" className={`text-[9px] ${shipmentStatusClass(entry.status)}`}>
                          {t(statusKey[entry.status as ShipmentStatus] ?? "ship.pending")}
                        </Badge>
                        <span className="text-[9px] text-muted-foreground tabular-nums">{formatDateTime(entry.timestamp)}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">{entry.userName}</span>
                      {entry.notes && <span className="text-[10px]">{entry.notes}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
    <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Shipment not arrived</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>New expected arrival date</Label><DatePicker value={newExpectedDate} onChange={setNewExpectedDate} required /></div>
          <div><Label>Delay reason</Label><Textarea value={delayReason} onChange={(event) => setDelayReason(event.target.value)} placeholder="Record the reason for the delay" /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setRescheduleOpen(false)}>Cancel</Button><Button disabled={arrivalBusy || !newExpectedDate || !delayReason.trim()} onClick={rescheduleManifestArrival}>Save and remind later</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}

function MetaRow({ icon: Icon, label, value }: { icon: typeof Info; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="size-3 text-muted-foreground shrink-0" />
      <div className="flex min-w-0 flex-col">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className="truncate text-[11px] font-medium">{value}</span>
      </div>
    </div>
  )
}

function LineItemRow({ item, idx, t }: { item: ShipmentLineItem; idx: number; t: (k: string) => string }) {
  const { formatValuation } = useCurrency()
  return (
    <TableRow>
      <TableCell className="py-1 text-[10px] tabular-nums">{idx}</TableCell>
      <TableCell className="py-1 text-[10px]">{t(`ship.prodType.${item.productType}`)}</TableCell>
      <TableCell className="py-1 text-[10px]">{item.brand}</TableCell>
      <TableCell className="py-1 text-[10px]">{item.model}</TableCell>
      <TableCell className="py-1 text-[10px] tabular-nums">{item.quantity}</TableCell>
      <TableCell className="py-1">
        {item.productType === "weapon" ? (
          <Badge variant="outline" className="text-[9px]">{item.serialNumbers.length} {t("ship.serials")}</Badge>
        ) : (
          <span className="text-[9px] text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="py-1 text-[10px] tabular-nums">{formatValuation(item.purchasePriceValuation, "display", item.purchasePrice)}</TableCell>
    </TableRow>
  )
}
