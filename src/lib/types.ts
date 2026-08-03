// ============ Core Enums & Status Types ============

export type WeaponStatus = "Available" | "Reserved" | "Sold" | "Returned"

export type WeaponCondition = "Excellent" | "Good" | "Fair" | "Poor"

export type InvoiceType = "Sale" | "Purchase"

export type InvoiceStatus = "Pending" | "Overdue" | "Paid" | "Void"

export type DebtLifecycle = "Pending" | "Overdue" | "Paid"

export type PaymentMethod = "Cash" | "Card" | "Bank Transfer" | "Check" | "Other"

export type SaleMode = "Retail" | "Wholesale"

export type UserRole = "Admin" | "Manager" | "Sales" | "Inventory" | "Accountant" | "Read-Only"

export type ShipmentStatus = "Pending" | "In Transit" | "Delayed" | "Arrived" | "Cancelled" | "Partial"

export type ShipmentEventType =
  | "ShipmentCreated"
  | "CarrierAssigned"
  | "DelayedAlert"
  | "Arrived"
  | "ItemsIntakeCompleted"
  | "DocumentsUploaded"
  | "StatusChanged"
  | "MetadataUpdated"

export type ShipmentProductType = "weapon" | "ammunition" | "accessory"

/**
 * Dual-valuation pattern: every monetary value stores its original currency,
 * the exchange rate at time of transaction, and the USD accounting amount.
 * Historical rates are immutable — never recomputed retroactively.
 */
export interface MoneyValuation {
  originalAmount: number
  originalCurrency: string
  exchangeRate: number
  accountingAmountUSD: number
  exchangeRateDate: string
}

export interface ShipmentLineItem {
  id: string
  productType: ShipmentProductType
  weaponType: string
  subType: string
  brand: string
  model: string
  caliber: string
  quantity: number
  purchasePrice: number
  retailPrice: number
  wholesalePrice: number
  location: StorageLocation
  serialNumbers: string[]
  received: number
  // Dual-valuation for purchase price
  purchasePriceValuation?: MoneyValuation
  retailPriceValuation?: MoneyValuation
}

export interface ShipmentDocument {
  id: string
  fileName: string
  fileType: string
  fileSize: number
  uploadDate: string
  uploadedBy: string
  category: string
  extractedText: string
}

export type NotificationType =
  | "OverdueDebt"
  | "DuplicateSerial"
  | "IncompleteShipment"
  | "LowStock"
  | "BackupOmission"
  | "ShipmentDelayed"
  | "System"

export type AuditActionType =
  | "Intake"
  | "Sale"
  | "Return"
  | "Payment"
  | "Shipment"
  | "DebtWarning"
  | "Login"
  | "Export"
  | "Import"
  | "Update"
  | "Delete"
  | "Void"
  | "Backup"
  | "RoleChange"
  | "DueDateExtension"
  | "StockAdjustment"

// ============ Product Classification Tree ============

export interface WeaponSubType {
  label: string
  calibers: string[]
}

export interface WeaponTypeClass {
  label: string
  subTypes: WeaponSubType[]
}

export const WEAPON_CLASSIFICATION: WeaponTypeClass[] = [
  {
    label: "Shotgun",
    subTypes: [
      { label: "Semi-auto", calibers: ["12 GA", "20 GA"] },
      { label: "Magazine shotgun", calibers: ["12 GA"] },
      { label: "Folding shotgun", calibers: ["12 GA"] },
      { label: "Over&under", calibers: ["12 GA", "20 GA"] },
      { label: "Side by side", calibers: ["12 GA"] },
      { label: "Single barrel", calibers: ["12 GA", "20 GA"] },
    ],
  },
  {
    label: "Air rifle",
    subTypes: [
      { label: "PCP", calibers: [".177", ".22", ".25"] },
      { label: "Break barrel", calibers: [".177", ".22"] },
    ],
  },
  {
    label: "Blank pistol",
    subTypes: [{ label: "9mm", calibers: ["9mm blank"] }],
  },
  {
    label: "Pistol",
    subTypes: [
      { label: "9x19mm", calibers: ["9x19mm"] },
      { label: "7.62mm", calibers: ["7.62mm"] },
      { label: "7.65mm", calibers: ["7.65mm"] },
      { label: "380mm", calibers: [".380 ACP"] },
      { label: ".22 LR", calibers: [".22 LR"] },
    ],
  },
  {
    label: "Rifle",
    subTypes: [
      { label: "223", calibers: [".223 Rem"] },
      { label: "30-06", calibers: ["30-06"] },
    ],
  },
]

export const ACCESSORY_TYPES: string[] = [
  "Pistol case",
  "Shotgun case",
  "Cleaning kit",
  "Cleaning-oil",
  "Pistol grip",
  "Others",
]

export const AMMUNITION_CALIBERS: string[] = [
  "9 mm rubber",
  "9 mm blank",
  "Cal 12 shotgun cartridges",
  "9x19",
  "7.62",
  "7.65",
  "223",
]

// ============ Compatibility Validation Matrix ============

export const INVALID_BRAND_TYPE_PAIRS: Record<string, string[]> = {
  "Glock": ["Shotgun", "Air rifle", "Rifle", "Blank pistol"],
  "SIG Sauer": ["Shotgun", "Air rifle"],
  "Remington": ["Pistol", "Air rifle", "Blank pistol"],
  "Benelli": ["Pistol", "Rifle", "Air rifle", "Blank pistol"],
  "Colt": ["Shotgun", "Air rifle", "Blank pistol"],
  "Ruger": ["Shotgun", "Blank pistol"],
  "Benjamin": ["Shotgun", "Pistol", "Rifle", "Blank pistol"],
  "Ekol": ["Shotgun", "Air rifle", "Rifle", "Pistol"],
  "Hatsan": ["Pistol", "Rifle", "Air rifle", "Blank pistol"],
}

export const INVALID_TYPE_CALIBER_PAIRS: Record<string, string[]> = {
  "Shotgun": ["9x19mm", "7.62mm", "7.65mm", ".380 ACP", ".22 LR", ".223 Rem", "30-06", "9mm blank", ".177", ".22", ".25"],
  "Pistol": ["12 GA", "20 GA", ".223 Rem", "30-06", ".177", ".25"],
  "Rifle": ["12 GA", "20 GA", "9x19mm", "9mm blank", ".380 ACP"],
  "Air rifle": ["12 GA", "20 GA", "9x19mm", "7.62mm", "7.65mm", ".380 ACP", "9mm blank", ".223 Rem", "30-06"],
  "Blank pistol": ["12 GA", "20 GA", "9x19mm", "7.62mm", "7.65mm", ".380 ACP", ".22 LR", ".223 Rem", "30-06", ".177", ".22", ".25"],
}

// ============ Storage Location ============

export interface StorageLocation {
  warehouse: string
  shelf: string
  bin: string
}

// ============ Sale Line Items ============

export interface SaleLineItem {
  itemType: "weapon" | "ammunition" | "accessory"
  itemId: string
  name: string
  quantity: number
  unitPrice: number
  total: number
}

// ============ Saved Filters ============

export interface SavedFilter {
  id: string
  name: string
  entityType: string
  filterState: Record<string, unknown>
}

// ============ Entity Interfaces ============

export interface Weapon {
  id: string
  serialNumber: string
  brand: string
  model: string
  weaponType: string
  subType: string
  caliber: string
  condition: WeaponCondition
  status: WeaponStatus
  purchasePrice: number
  retailPrice: number
  wholesalePrice: number
  actualFinalPrice: number | null
  supplierId: string
  shipmentId: string | null
  dateAdded: string
  batchId?: string
  notes: string
  images: string[]
  movementHistory: WeaponMovement[]
  location: StorageLocation
  // Dual-valuation: original currency, exchange rate, USD accounting amounts
  purchasePriceValuation?: MoneyValuation
  retailPriceValuation?: MoneyValuation
  salePriceValuation?: MoneyValuation
}

export interface WeaponMovement {
  id: string
  timestamp: string
  fromStatus: WeaponStatus
  toStatus: WeaponStatus
  userId: string
  userName: string
  reason: string
}

export interface Accessory {
  id: string
  name: string
  type: string
  quantity: number
  safetyThreshold: number
  price: number
  dateAdded: string
  location: StorageLocation
}

export type PackageType = "Carton" | "Box" | "Case" | "Custom"

export interface Ammunition {
  id: string
  caliber: string
  packageType: PackageType
  unitsPerPackage: number
  fullPackages: number
  looseRounds: number
  safetyThreshold: number
  price: number
  dateAdded: string
  location: StorageLocation
}

export function ammoTotalRounds(a: Pick<Ammunition, "fullPackages" | "unitsPerPackage" | "looseRounds">): number {
  return a.fullPackages * a.unitsPerPackage + a.looseRounds
}

export interface Shipment {
  id: string
  shipmentNumber: string
  supplierId: string
  shipmentDate: string
  expectedArrivalDate: string
  totalExpectedItems: number
  attachments: string[]
  notes: string
  status: ShipmentStatus
  timeline: ShipmentTimelineEntry[]
  // Extended fields for enterprise wizard
  purchaseOrderNumber?: string
  invoiceNumber?: string
  shippingCarrier?: string
  containerNumber?: string
  currency?: string
  purchaseDate?: string
  actualArrivalDate?: string
  lineItems?: ShipmentLineItem[]
  documents?: ShipmentDocument[]
  // Dual-valuation: total shipment cost in original currency + USD accounting
  totalCostValuation?: MoneyValuation
}

export interface ShipmentTimelineEntry {
  id: string
  timestamp: string
  status: ShipmentStatus
  userId: string
  userName: string
  notes: string
  eventType?: ShipmentEventType
}

export interface Invoice {
  id: string
  invoiceNumber: string
  type: InvoiceType
  customerId: string | null
  supplierId: string | null
  customerName: string
  date: string
  dueDate: string
  totalOriginal: number
  totalNegotiated: number
  totalPaid: number
  balance: number
  status: InvoiceStatus
  weaponIds: string[]
  lineItems: SaleLineItem[]
  saleMode: SaleMode
  employeeId: string
  employeeName: string
  attachments: string[]
  shipmentId: string | null
  notes: string
  voided: boolean
  taxAmount: number
  // Dual-valuation: original currency, exchange rate, USD accounting amount
  totalValuation?: MoneyValuation
}

export interface PaymentRecord {
  id: string
  invoiceId: string
  invoiceNumber: string
  date: string
  amount: number
  method: PaymentMethod
  employee: string
  notes: string
}

export interface Customer {
  id: string
  name: string
  phone: string
  email: string
  address: string
  isWholesaleBuyer: boolean
  wholesaleDiscountPercent: number
  dateAdded: string
}

export interface Supplier {
  id: string
  name: string
  contactPerson: string
  phone: string
  email: string
  address: string
  dateAdded: string
}

export interface AuditLog {
  id: string
  timestamp: string
  date: string
  userId: string
  actionType: AuditActionType
  description: string
  metadata: string
}

export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  message: string
  date: string
  read: boolean
  entityId: string | null
}

export interface User {
  id: string
  username: string
  name: string
  role: UserRole
  permissions: UserPermissions
  passwordSet: boolean
  passwordHash: string
}

export interface UserPermissions {
  canImportExcel: boolean
  canExportData: boolean
  canViewReports: boolean
  canManageUsers: boolean
  canRegisterPayments: boolean
  canVoidInvoices: boolean
  canExtendDueDates: boolean
  canDeleteRecords: boolean
}

export interface SystemSettings {
  currencySymbol: string
  currencyCode: string
  supportedCurrencies: string[]
  currencyFrequency: Record<string, number>
  taxPercent: number
  invoiceHeader: string
  invoiceFooter: string
  storeLogo: string
  thermalPrinterWidth: number
  labelFormat: string
  hourlySnapshot: boolean
  dailyClosingPrompt: boolean
  weeklyVerification: boolean
  minProfitMarginPercent: number
  // Multi-currency display preferences
  preferredDisplayCurrency?: string
  // Application-wide preferences (stored in SQLite, not localStorage)
  appLanguage?: string
  dateFormat?: string
  numberFormat?: string
  // Company information
  companyName?: string
  companyAddress?: string
  companyPhone?: string
  companyEmail?: string
  companyTaxId?: string
}

export interface UserPreferences {
  userId: string
  displayCurrency?: string
  reportViewMode: "original" | "accounting" | "display"
  language?: string
  dateFormat?: string
}

// ============ Store Indices ============

export interface StoreIndices {
  bySerial: Map<string, string>
  byInvoiceNumber: Map<string, string>
  byCustomerId: Map<string, string[]>
  byShipmentId: Map<string, string[]>
  byInvoiceId: Map<string, string[]>
}

// ============ Service Result Types ============

export interface ServiceResult {
  success: boolean
  error?: string
  data?: unknown
}

export interface SaleResult extends ServiceResult {
  invoiceId?: string
  invoiceNumber?: string
}

export interface DebtResult extends ServiceResult {
  newBalance?: number
  lifecycle?: DebtLifecycle
}
