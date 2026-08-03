import * as XLSX from "xlsx"
import type {
  Weapon,
  Customer,
  Supplier,
  Invoice,
  PaymentRecord,
  Shipment,
  AuditLog,
  Accessory,
  Ammunition,
} from "./types"
import { useStore } from "./store"
import { checksum } from "./format"

// ============ JSON Snapshot Engine ============

export interface SnapshotData {
  version: number
  exportDate: string
  entities: {
    weapons: Weapon[]
    accessories: Accessory[]
    ammunition: Ammunition[]
    shipments: Shipment[]
    invoices: Invoice[]
    payments: PaymentRecord[]
    customers: Customer[]
    suppliers: Supplier[]
    auditLogs: AuditLog[]
  }
  aggregates: {
    weaponCount: number
    invoiceCount: number
    customerCount: number
    supplierCount: number
    shipmentCount: number
    paymentCount: number
  }
  checksum: string
}

export function createSnapshot(): SnapshotData {
  const state = useStore.getState()
  const entities = {
    weapons: state.weapons,
    accessories: state.accessories,
    ammunition: state.ammunition,
    shipments: state.shipments,
    invoices: state.invoices,
    payments: state.payments,
    customers: state.customers,
    suppliers: state.suppliers,
    auditLogs: state.auditLogs,
  }

  const aggregates = {
    weaponCount: state.weapons.length,
    invoiceCount: state.invoices.length,
    customerCount: state.customers.length,
    supplierCount: state.suppliers.length,
    shipmentCount: state.shipments.length,
    paymentCount: state.payments.length,
  }

  const dataStr = JSON.stringify({ entities, aggregates })
  const cs = checksum(dataStr)

  return {
    version: 3,
    exportDate: new Date().toISOString(),
    entities,
    aggregates,
    checksum: cs,
  }
}

export function downloadSnapshot() {
  const snapshot = createSnapshot()
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `weapon-erp-backup-${new Date().toISOString().split("T")[0]}.json`
  a.click()
  URL.revokeObjectURL(url)

  useStore.getState().addAuditLog("Backup", `JSON snapshot exported — ${snapshot.aggregates.weaponCount} weapons, ${snapshot.aggregates.invoiceCount} invoices. Checksum: ${snapshot.checksum}`, JSON.stringify({ checksum: snapshot.checksum }))
}

export interface SnapshotValidation {
  valid: boolean
  error?: string
  aggregatesMatch: boolean
  checksumValid: boolean
}

export function validateSnapshot(data: unknown): SnapshotValidation {
  if (!data || typeof data !== "object") {
    return { valid: false, error: "Invalid file format", aggregatesMatch: false, checksumValid: false }
  }

  const snapshot = data as SnapshotData
  if (!snapshot.version || !snapshot.entities || !snapshot.aggregates || !snapshot.checksum) {
    return { valid: false, error: "Missing required snapshot fields", aggregatesMatch: false, checksumValid: false }
  }

  const dataStr = JSON.stringify({ entities: snapshot.entities, aggregates: snapshot.aggregates })
  const computedChecksum = checksum(dataStr)
  const checksumValid = computedChecksum === snapshot.checksum

  const aggregatesMatch =
    snapshot.entities.weapons.length === snapshot.aggregates.weaponCount &&
    snapshot.entities.invoices.length === snapshot.aggregates.invoiceCount &&
    snapshot.entities.customers.length === snapshot.aggregates.customerCount

  return { valid: true, aggregatesMatch, checksumValid }
}

export async function importSnapshot(file: File): Promise<SnapshotValidation> {
  const text = await file.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { valid: false, error: "Invalid JSON file", aggregatesMatch: false, checksumValid: false }
  }

  const validation = validateSnapshot(data)
  if (!validation.valid) return validation

  const snapshot = data as SnapshotData
  const state = useStore.getState()
  useStore.setState({
    weapons: snapshot.entities.weapons,
    accessories: snapshot.entities.accessories,
    ammunition: snapshot.entities.ammunition,
    shipments: snapshot.entities.shipments,
    invoices: snapshot.entities.invoices,
    payments: snapshot.entities.payments,
    customers: snapshot.entities.customers,
    suppliers: snapshot.entities.suppliers,
    auditLogs: snapshot.entities.auditLogs,
  })

  state.addAuditLog("Backup", `JSON snapshot imported — Checksum: ${snapshot.checksum}`, JSON.stringify({ checksum: snapshot.checksum }))

  return validation
}

// ============ Excel Checklist Utility ============

export interface ExcelSheetOption {
  key: string
  label: string
  enabled: boolean
}

export const DEFAULT_SHEET_OPTIONS: ExcelSheetOption[] = [
  { key: "Inventory", label: "Inventory", enabled: true },
  { key: "Sales", label: "Sales", enabled: true },
  { key: "Customers", label: "Customers", enabled: true },
  { key: "Suppliers", label: "Suppliers", enabled: true },
  { key: "Shipments", label: "Shipments", enabled: true },
  { key: "Debts", label: "Debts", enabled: true },
  { key: "Logs", label: "Audit Logs", enabled: true },
]

function autoFitColumns(ws: XLSX.WorkSheet, data: Record<string, unknown>[]) {
  if (data.length === 0) return
  const keys = Object.keys(data[0])
  const colWidths = keys.map((key) => {
    let maxLen = key.length
    data.forEach((row) => {
      const val = String(row[key] ?? "")
      if (val.length > maxLen) maxLen = val.length
    })
    return { wch: Math.min(maxLen + 2, 40) }
  })
  ws["!cols"] = colWidths
}

export function exportExcelChecklist(sheets: ExcelSheetOption[]): void {
  const state = useStore.getState()
  const wb = XLSX.utils.book_new()

  if (sheets.find((s) => s.key === "Inventory" && s.enabled)) {
    const data = state.weapons.map((w) => ({
      ID: w.id, "Serial Number": w.serialNumber, Brand: w.brand, Model: w.model,
      Type: w.weaponType, "Sub-Type": w.subType, Caliber: w.caliber, Condition: w.condition,
      Status: w.status, "Purchase Price": w.purchasePrice, "Retail Price": w.retailPrice,
      "Wholesale Price": w.wholesalePrice, "Actual Final Price": w.actualFinalPrice ?? "",
      "Supplier ID": w.supplierId, "Shipment ID": w.shipmentId ?? "", "Date Added": w.dateAdded,
      Notes: w.notes,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    autoFitColumns(ws, data)
    XLSX.utils.book_append_sheet(wb, ws, "Inventory")
  }

  if (sheets.find((s) => s.key === "Sales" && s.enabled)) {
    const data = state.invoices.filter((i) => i.type === "Sale").map((i) => ({
      "Invoice Number": i.invoiceNumber, Customer: i.customerName, Date: i.date,
      "Due Date": i.dueDate, "Original Total": i.totalOriginal, "Negotiated Total": i.totalNegotiated,
      "Paid": i.totalPaid, "Balance": i.balance, Status: i.status, Mode: i.saleMode,
      Employee: i.employeeName, Voided: i.voided ? "Yes" : "No",
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    autoFitColumns(ws, data)
    XLSX.utils.book_append_sheet(wb, ws, "Sales")
  }

  if (sheets.find((s) => s.key === "Customers" && s.enabled)) {
    const data = state.customers.map((c) => ({
      ID: c.id, Name: c.name, Phone: c.phone, Email: c.email, Address: c.address,
      "Wholesale Buyer": c.isWholesaleBuyer ? "Yes" : "No",
      "Discount %": c.wholesaleDiscountPercent, "Date Added": c.dateAdded,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    autoFitColumns(ws, data)
    XLSX.utils.book_append_sheet(wb, ws, "Customers")
  }

  if (sheets.find((s) => s.key === "Suppliers" && s.enabled)) {
    const data = state.suppliers.map((s) => ({
      ID: s.id, Name: s.name, "Contact Person": s.contactPerson, Phone: s.phone,
      Email: s.email, Address: s.address, "Date Added": s.dateAdded,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    autoFitColumns(ws, data)
    XLSX.utils.book_append_sheet(wb, ws, "Suppliers")
  }

  if (sheets.find((s) => s.key === "Shipments" && s.enabled)) {
    const data = state.shipments.map((s) => {
      const registered = state.weapons.filter((w) => w.shipmentId === s.id).length
      return {
        "Shipment Number": s.shipmentNumber, "Supplier ID": s.supplierId, Date: s.shipmentDate,
        "Expected Items": s.totalExpectedItems, "Registered": registered,
        "Remaining": s.totalExpectedItems - registered, Status: s.status, Notes: s.notes,
      }
    })
    const ws = XLSX.utils.json_to_sheet(data)
    autoFitColumns(ws, data)
    XLSX.utils.book_append_sheet(wb, ws, "Shipments")
  }

  if (sheets.find((s) => s.key === "Debts" && s.enabled)) {
    const data = state.invoices.filter((i) => i.balance > 0 && !i.voided).map((i) => ({
      "Invoice Number": i.invoiceNumber, "Customer/Supplier": i.customerName,
      Type: i.type, "Original": i.totalOriginal, "Negotiated": i.totalNegotiated,
      "Paid": i.totalPaid, "Balance": i.balance, "Due Date": i.dueDate, Status: i.status,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    autoFitColumns(ws, data)
    XLSX.utils.book_append_sheet(wb, ws, "Debts")
  }

  if (sheets.find((s) => s.key === "Logs" && s.enabled)) {
    const data = state.auditLogs.map((l) => ({
      ID: l.id, Timestamp: l.timestamp, User: l.userId, "Action Type": l.actionType,
      Description: l.description, Metadata: l.metadata,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    autoFitColumns(ws, data)
    XLSX.utils.book_append_sheet(wb, ws, "Audit Logs")
  }

  XLSX.writeFile(wb, `WeaponERP_Export_${new Date().toISOString().split("T")[0]}.xlsx`)
  state.addAuditLog("Export", `Excel export — sheets: ${sheets.filter((s) => s.enabled).map((s) => s.key).join(", ")}`, "{}")
}

export interface ImportConflictReport {
  newWeapons: number
  duplicateSerials: string[]
  newInvoices: number
  duplicateInvoices: string[]
  totalRows: number
  conflicts: string[]
}

export async function analyzeExcelImport(file: File): Promise<ImportConflictReport> {
  const arrayBuffer = await file.arrayBuffer()
  const wb = XLSX.read(arrayBuffer, { type: "array" })
  const state = useStore.getState()
  const report: ImportConflictReport = {
    newWeapons: 0,
    duplicateSerials: [],
    newInvoices: 0,
    duplicateInvoices: [],
    totalRows: 0,
    conflicts: [],
  }

  if (wb.SheetNames.includes("Inventory")) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Inventory"])
    const existingSerials = new Set(state.weapons.map((w) => w.serialNumber.toLowerCase()))
    rows.forEach((row) => {
      const sn = String(row["Serial Number"] ?? "").trim()
      if (!sn) return
      report.totalRows++
      if (existingSerials.has(sn.toLowerCase())) {
        report.duplicateSerials.push(sn)
      } else {
        report.newWeapons++
      }
    })
    if (report.duplicateSerials.length > 0) {
      report.conflicts.push(`${report.duplicateSerials.length} duplicate serial numbers found`)
    }
  }

  if (wb.SheetNames.includes("Sales")) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Sales"])
    const existingInvoices = new Set(state.invoices.map((i) => i.invoiceNumber))
    rows.forEach((row) => {
      const inv = String(row["Invoice Number"] ?? "").trim()
      if (!inv) return
      report.totalRows++
      if (existingInvoices.has(inv)) {
        report.duplicateInvoices.push(inv)
      } else {
        report.newInvoices++
      }
    })
    if (report.duplicateInvoices.length > 0) {
      report.conflicts.push(`${report.duplicateInvoices.length} duplicate invoice numbers found`)
    }
  }

  return report
}
