import type { WeaponStatus, InvoiceStatus, DebtLifecycle } from "./types"
import type { Language } from "./i18n/translations"

const LOCALE_MAP: Record<Language, string> = {
  en: "en-US",
  ar: "ar-SA",
}

let _lang: Language = "en"

export function setFormatLanguage(lang: Language) {
  _lang = lang
}

export function getLocale(): string {
  return LOCALE_MAP[_lang]
}

export function formatCurrency(value: number, symbol: string = "$"): string {
  const num = new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
  return `${symbol}${num}`
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString(getLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function formatDateShort(date: string): string {
  return new Date(date).toLocaleDateString(getLocale(), {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  })
}

export function formatDateTime(date: string): string {
  return new Date(date).toLocaleString(getLocale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function formatMonthShort(date: Date): string {
  return date.toLocaleDateString(getLocale(), { month: "short" })
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(getLocale()).format(value)
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(value) + "%"
}

export function daysUntilDue(dueDate: string): number {
  return Math.ceil((new Date(dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

export function isOverdue(dueDate: string, balance: number): boolean {
  return balance > 0 && new Date(dueDate) < new Date()
}

const STATUS_BADGE_CLASS: Record<WeaponStatus, string> = {
  Available: "bg-secondary text-foreground border-border",
  Sold: "bg-status-sold text-status-sold-fg border-transparent",
  Reserved: "bg-status-reserved text-status-reserved-fg border-transparent",
  Returned: "bg-status-returned text-status-returned-fg border-transparent",
}

const STATUS_ROW_CLASS: Record<WeaponStatus, string> = {
  Available: "row-available",
  Sold: "row-sold",
  Reserved: "row-reserved",
  Returned: "row-returned",
}

const STATUS_DOT_CLASS: Record<WeaponStatus, string> = {
  Available: "bg-muted-foreground",
  Sold: "bg-status-sold",
  Reserved: "bg-status-reserved",
  Returned: "bg-status-returned",
}

const INVOICE_STATUS_CLASS: Record<InvoiceStatus, string> = {
  Pending: "bg-status-reserved/20 text-white border-status-reserved/30",
  Overdue: "bg-status-sold/20 text-status-sold-fg border-status-sold/30",
  Paid: "bg-status-returned/20 text-status-returned-fg border-status-returned/30",
  Void: "bg-muted text-muted-foreground border-border",
}

const DEBT_LIFECYCLE_ICON: Record<DebtLifecycle, string> = {
  Pending: "🟠",
  Overdue: "🔴",
  Paid: "🟢",
}

export function statusBadgeClass(status: WeaponStatus): string {
  return STATUS_BADGE_CLASS[status]
}

export function statusRowClass(status: WeaponStatus): string {
  return STATUS_ROW_CLASS[status]
}

export function statusDotClass(status: WeaponStatus): string {
  return STATUS_DOT_CLASS[status]
}

export function invoiceStatusClass(status: InvoiceStatus): string {
  return INVOICE_STATUS_CLASS[status]
}

export function debtLifecycleIcon(lifecycle: DebtLifecycle): string {
  return DEBT_LIFECYCLE_ICON[lifecycle]
}

export function predictSerialPrefix(serials: string[]): string | null {
  const filled = serials.filter((s) => s.trim().length > 0)
  if (filled.length === 0) return null

  const prefixes = filled.map((s) => {
    const match = s.trim().match(/^([A-Za-z]+)/)
    return match ? match[1] : ""
  })

  const validPrefixes = prefixes.filter((p) => p.length >= 2)
  if (validPrefixes.length === 0) return null

  const firstPrefix = validPrefixes[0]
  const allSame = validPrefixes.every((p) => p === firstPrefix)
  if (allSame && firstPrefix.length >= 2) return firstPrefix

  const last = filled[filled.length - 1].trim()
  const numMatch = last.match(/(\d+)$/)
  if (numMatch) {
    const numPart = numMatch[1]
    const incremented = (parseInt(numPart, 10) + 1).toString().padStart(numPart.length, "0")
    const prefix = last.substring(0, last.length - numPart.length)
    return `${prefix}${incremented}`
  }

  return null
}

export function nextSerialSuggestion(serials: string[], prefix: string): string {
  const nums = serials
    .filter((s) => s.trim().startsWith(prefix))
    .map((s) => {
      const rest = s.trim().substring(prefix.length)
      const match = rest.match(/^(\d+)/)
      return match ? parseInt(match[1], 10) : 0
    })
    .filter((n) => n > 0)

  const max = nums.length > 0 ? Math.max(...nums) : 0
  return `${prefix}${(max + 1).toString().padStart(5, "0")}`
}

export function generateInvoiceNumber(existing: { invoiceNumber: string }[]): string {
  const today = new Date().toISOString().split("T")[0].replace(/-/g, "")
  const prefix = `INV-${today}-`
  const todayCount = existing.filter((s) => s.invoiceNumber.startsWith(prefix)).length + 1
  return `${prefix}${todayCount.toString().padStart(4, "0")}`
}

export function generateShipmentNumber(existing: { shipmentNumber: string }[]): string {
  const year = new Date().getFullYear()
  const yearCount = existing.filter((s) => s.shipmentNumber.includes(`${year}`)).length + 1
  return `SHP-${year}${yearCount.toString().padStart(4, "0")}`
}

const SHIPMENT_STATUS_CLASS: Record<string, string> = {
  "Pending": "bg-muted text-muted-foreground border-border",
  "In Transit": "bg-chart-4/20 text-chart-4 border-chart-4/30",
  "Delayed": "bg-status-sold/20 text-status-sold-fg border-status-sold/30",
  "Arrived": "bg-status-returned/20 text-status-returned-fg border-status-returned/30",
  "Cancelled": "bg-destructive/20 text-destructive border-destructive/30",
  "Partial": "bg-status-reserved/20 text-status-reserved-fg border-status-reserved/30",
}

export function shipmentStatusClass(status: string): string {
  return SHIPMENT_STATUS_CLASS[status] ?? "bg-muted text-muted-foreground border-border"
}

export function shipmentDelayDays(expectedArrivalDate: string, status: string): number {
  if (status === "Arrived" || status === "Cancelled") return 0
  const today = new Date().toISOString().split("T")[0]
  if (expectedArrivalDate >= today) return 0
  return Math.floor((Date.now() - new Date(expectedArrivalDate).getTime()) / (1000 * 60 * 60 * 24))
}

export function checksum(data: string): string {
  let hash = 0
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0
  }
  return `CS-${Math.abs(hash).toString(16).toUpperCase().padStart(8, "0")}`
}
