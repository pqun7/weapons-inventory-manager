import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import { Boxes, Building2, FileText, Package, UserRound } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useCurrency } from "@/lib/currency-context"
import type { DialogEntityKind, DialogEntityTarget } from "@/lib/audit-entity"
import { formatDate } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useStore } from "@/lib/store"

type EntityDialogContextValue = {
  openEntity: (target: DialogEntityTarget) => void
  closeEntity: () => void
}

const EntityDialogContext = createContext<EntityDialogContextValue | null>(null)

export function useEntityDialog(): EntityDialogContextValue {
  const value = useContext(EntityDialogContext)
  if (!value) throw new Error("useEntityDialog must be used inside EntityDialogProvider")
  return value
}

const ENTITY_ICON: Record<DialogEntityKind, typeof FileText> = {
  invoice: FileText,
  shipment: Package,
  weapon: Boxes,
  customer: UserRound,
  supplier: Building2,
}

export function EntityDialogProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<DialogEntityTarget | null>(null)
  const openEntity = useCallback((next: DialogEntityTarget) => setTarget(next), [])
  const closeEntity = useCallback(() => setTarget(null), [])
  const value = useMemo(() => ({ openEntity, closeEntity }), [closeEntity, openEntity])

  return (
    <EntityDialogContext.Provider value={value}>
      {children}
      <ResolvedEntityDialog target={target} onClose={closeEntity} />
    </EntityDialogContext.Provider>
  )
}

function ResolvedEntityDialog({ target, onClose }: { target: DialogEntityTarget | null; onClose: () => void }) {
  const { t } = useI18n()
  const { formatInvoice, formatInvoiceLine, formatOriginal } = useCurrency()
  const invoices = useStore((state) => state.invoices)
  const shipments = useStore((state) => state.shipments)
  const weapons = useStore((state) => state.weapons)
  const customers = useStore((state) => state.customers)
  const suppliers = useStore((state) => state.suppliers)

  const invoice = target?.kind === "invoice" ? invoices.find((item) => item.id === target.id) : undefined
  const shipment = target?.kind === "shipment" ? shipments.find((item) => item.id === target.id) : undefined
  const weapon = target?.kind === "weapon" ? weapons.find((item) => item.id === target.id) : undefined
  const customer = target?.kind === "customer" ? customers.find((item) => item.id === target.id) : undefined
  const supplier = target?.kind === "supplier" ? suppliers.find((item) => item.id === target.id) : undefined
  const entityFound = Boolean(invoice ?? shipment ?? weapon ?? customer ?? supplier)

  if (!target) return null
  const Icon = ENTITY_ICON[target.kind]

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90vh] w-[min(96vw,72rem)] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Icon className="size-5 text-primary" />{t(`audit.entityDialog.${target.kind}`)}</DialogTitle>
          <DialogDescription>{t("audit.entityDialog.description")}</DialogDescription>
        </DialogHeader>
        {!entityFound ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t("audit.entityDialog.notFound")}</div> : null}

        {invoice && (
          <div className="grid gap-4">
            <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label={t("common.invoice")} value={invoice.invoiceNumber ?? invoice.id} />
              <Fact label={t("common.type")} value={t(invoice.type === "Purchase" ? "audit.entityDialog.purchase" : "audit.entityDialog.sale")} />
              <Fact label={t("common.status")} value={invoice.status} />
              <Fact label={t("common.date")} value={formatDate(invoice.date)} />
              <Fact label={t("cust.name")} value={invoice.customerName || t("common.notAvailable")} />
              <Fact label={t("common.total")} value={formatInvoice(invoice, "totalNegotiated")} />
              <Fact label={t("common.paid")} value={formatInvoice(invoice, "totalPaid")} />
              <Fact label={t("common.balance")} value={formatInvoice(invoice, "balance")} />
            </div>
            <DetailTable headers={[t("common.name"), t("common.quantity"), t("common.unitPrice"), t("common.total")]}
              rows={invoice.lineItems.map((item) => [item.name, String(item.quantity), formatInvoiceLine(invoice, item.unitPrice), formatInvoiceLine(invoice, item.total)])} />
          </div>
        )}

        {shipment && (
          <div className="grid gap-4">
            <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label={t("ship.shipmentNumber")} value={shipment.shipmentNumber} />
              <Fact label={t("common.status")} value={shipment.status} />
              <Fact label={t("ship.date")} value={formatDate(shipment.shipmentDate)} />
              <Fact label={t("ship.expectedArrival")} value={formatDate(shipment.expectedArrivalDate)} />
              <Fact label={t("ship.totalExpected")} value={String(shipment.totalExpectedItems)} />
              <Fact label={t("ship.purchaseOrder")} value={shipment.purchaseOrderNumber || t("common.notAvailable")} />
              <Fact label={t("ship.containerNumber")} value={shipment.containerNumber || t("common.notAvailable")} />
              <Fact label={t("common.total")} value={shipment.totalCostValuation ? formatOriginal(shipment.totalCostValuation.originalAmount, shipment.totalCostValuation.originalCurrency) : t("common.notAvailable")} />
            </div>
            <DetailTable headers={[t("common.name"), t("common.quantity"), t("ship.registered"), t("weapon.serial")]}
              rows={(shipment.lineItems ?? []).map((item) => [[item.brand, item.model, item.caliber].filter(Boolean).join(" · ") || item.productType, String(item.quantity), String(item.received), item.serialNumbers.join(", ") || t("common.notAvailable")])} />
          </div>
        )}

        {weapon && (
          <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={t("weapon.serial")} value={weapon.serialNumber} />
            <Fact label={t("weapon.weaponType")} value={weapon.weaponType} />
            <Fact label={t("weapon.model")} value={[weapon.brand, weapon.model].filter(Boolean).join(" · ")} />
            <Fact label={t("weapon.caliber")} value={weapon.caliber} />
            <Fact label={t("common.status")} value={weapon.status} />
            <Fact label={t("audit.field.location")} value={[weapon.location.warehouse, weapon.location.shelf, weapon.location.bin].filter(Boolean).join(" · ")} />
          </div>
        )}

        {customer && (
          <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2">
            <Fact label={t("cust.name")} value={customer.name} />
            <Fact label={t("cust.phone")} value={customer.phone || t("common.notAvailable")} />
            <Fact label={t("cust.email")} value={customer.email || t("common.notAvailable")} />
            <Fact label={t("cust.address")} value={customer.address || t("common.notAvailable")} />
            {Object.entries(customer.customFields ?? {}).map(([label, value]) => <Fact key={label} label={label} value={value} />)}
          </div>
        )}

        {supplier && (
          <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2">
            <Fact label={t("common.name")} value={supplier.name} />
            <Fact label={t("sup.contactPerson")} value={supplier.contactPerson || t("common.notAvailable")} />
            <Fact label={t("common.phone")} value={supplier.phone || t("common.notAvailable")} />
            <Fact label={t("cust.email")} value={supplier.email || t("common.notAvailable")} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><div className="text-[10px] text-muted-foreground">{label}</div><div className="break-words text-sm font-medium">{value}</div></div>
}

function DetailTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  const { t } = useI18n()
  if (!rows.length) return <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">{t("audit.entityDialog.noItems")}</div>
  return <div className="overflow-hidden rounded-xl border"><Table><TableHeader><TableRow>{headers.map((header) => <TableHead key={header}>{header}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row, rowIndex) => <TableRow key={rowIndex}>{row.map((value, cellIndex) => <TableCell key={cellIndex} className="max-w-72 break-words text-xs">{value}</TableCell>)}</TableRow>)}</TableBody></Table></div>
}
