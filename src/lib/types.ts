// ============ Core Enums & Status Types ============

export type WeaponStatus = "Available" | "Reserved" | "Sold" | "Returned"

export type WeaponCondition = "Excellent" | "Good" | "Fair" | "Poor"
export type PricingMode = "auto" | "manual"

export type InvoiceType = "Sale" | "Purchase"

export type InvoiceStatus = "Pending" | "Overdue" | "Paid" | "Void"

export type DebtLifecycle = "Pending" | "Overdue" | "Paid"

export type PaymentMethod = "cash" | "card" | "bank_transfer" | "check" | "other"

export type SaleMode = "Retail" | "Wholesale"

export type UserRole = "Admin" | "Employee"

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

export type CostCalculationType = "fixed" | "percentage"
export type CostCalculationBase = "original_purchase_cost"
export type CostSource = "product_level" | "shipment_level"
export type ShipmentCostScope = "entire_shipment" | "selected_products" | "single_product" | "manual"
export type ShipmentAllocationMethod = "by_value" | "by_quantity" | "equal" | "manual"

export interface ProductAdditionalCostInput {
  id?: string
  name: string
  calculationType: CostCalculationType
  amount: string
  percentageRate?: string
  calculationBase: CostCalculationBase
  currency: string
}

export interface ShipmentAdditionalCostInput extends ProductAdditionalCostInput {
  scope: ShipmentCostScope
  allocationMethod: ShipmentAllocationMethod
  selectedShipmentItemIds: string[]
  manualAllocations?: Record<string, string>
}

export interface PersistedProductCost {
  id: string
  productType: string
  productId: string
  name: string
  calculationType: CostCalculationType
  inputAmount: string
  percentageRate?: string
  calculationBase: CostCalculationBase
  calculatedAmount: string
  currency: string
  exchangeRate: string
  baseAmount: string
  baseCurrency: string
  exchangeRateDate: string
  rateSource: MoneyValuation["rateSource"]
  source: CostSource
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface PersistedShipmentCost {
  id: string
  shipmentId: string
  name: string
  calculationType: CostCalculationType
  inputAmount: string
  percentageRate?: string
  calculationBase: CostCalculationBase
  calculatedAmount: string
  currency: string
  exchangeRate: string
  baseAmount: string
  baseCurrency: string
  exchangeRateDate: string
  rateSource: MoneyValuation["rateSource"]
  scope: ShipmentCostScope
  allocationMethod: ShipmentAllocationMethod
  selectedShipmentItemIds: string[]
  allocations: ShipmentCostAllocation[]
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface ShipmentCostAllocation {
  id: string
  shipmentId: string
  shipmentItemId: string
  costId: string
  automaticAmount: string
  finalAmount: string
  manualOverride: boolean
  difference: string
  currency: string
  exchangeRate: string
  automaticBaseAmount: string
  finalBaseAmount: string
  baseCurrency: string
  allocationMethod: ShipmentAllocationMethod
}

export interface InventoryCostSnapshot {
  productType: string
  productId: string
  shipmentId?: string
  shipmentItemId?: string
  originalAmount: string
  originalCurrency: string
  originalExchangeRate: string
  originalBaseAmount: string
  productCostsBaseAmount: string
  shipmentCostsBaseAmount: string
  finalLandedBaseAmount: string
  baseCurrency: string
  exchangeRateDate: string
  rateSource: MoneyValuation["rateSource"]
  finalizedAt: string
}

/**
 * Dual-valuation pattern: every monetary value stores its original currency,
 * the exchange rate at time of transaction, and the configured accounting amount.
 * Historical rates are immutable — never recomputed retroactively.
 */
export interface MoneyValuation {
  originalAmount: number
  originalCurrency: string
  exchangeRate: number
  accountingAmount: number
  accountingCurrency: string
  exchangeRateDate: string
  rateSource: "manual" | "api" | "cache" | "default"
  rateId?: string
  /** @deprecated Compatibility alias for legacy USD valuations. */
  accountingAmountUSD?: number
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
  retailPriceMode?: PricingMode
  wholesalePriceMode?: PricingMode
  weaponTypeId?: string
  weaponSubtypeId?: string
  caliberId?: string
  brandId?: string
  modelId?: string
  storageLocationId?: string
  /** Optional for scheduled/imported shipment lines; inventory location is assigned on receipt. */
  location?: StorageLocation
  serialNumbers: string[]
  received: number
  // Dual-valuation for purchase price
  purchasePriceValuation?: MoneyValuation
  retailPriceValuation?: MoneyValuation
  wholesalePriceValuation?: MoneyValuation
  productAdditionalCosts?: ProductAdditionalCostInput[]
  additionalCosts?: ProductAdditionalCostInput[]
  landedUnitCostAccounting?: number
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
  | "ShipmentArrivalDue"
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
  /** Immutable cost-of-goods snapshot captured when the sale is committed. */
  unitLandedCostAccounting?: number
  costAccountingCurrency?: string
  costSnapshotFinalizedAt?: string
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

  // Foreign keys (new)
  weaponTypeId: string
  weaponSubtypeId: string
  caliberId: string
  brandId: string
  modelId: string
  storageLocationId: string | null

  // Display labels (preserved for backward compatibility)
  weaponType: string
  subType: string
  caliber: string
  brand: string
  model: string
  location: StorageLocation   // still computed from storageLocationId join

  condition: "Excellent" | "Good" | "Fair" | "Poor"
  status: "Available" | "Reserved" | "Sold" | "Returned"

  purchasePrice: number
  retailPrice: number
  wholesalePrice: number
  retailPriceMode: PricingMode
  wholesalePriceMode: PricingMode
  actualFinalPrice: number | null

  supplierId: string
  shipmentId: string | null

  dateAdded: string
  batchId?: string
  notes: string
  images: string[]
  movementHistory: WeaponMovement[]

  purchasePriceValuation?: MoneyValuation
  retailPriceValuation?: MoneyValuation
  wholesalePriceValuation?: MoneyValuation
  actualFinalPriceValuation?: MoneyValuation
  salePriceValuation?: MoneyValuation
  costSnapshot?: InventoryCostSnapshot
  additionalCosts?: PersistedProductCost[]
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
  priceCurrency?: string
  priceValuation?: MoneyValuation
  retailPrice: number
  wholesalePrice: number
  retailPriceValuation?: MoneyValuation
  wholesalePriceValuation?: MoneyValuation
  retailPriceMode: PricingMode
  wholesalePriceMode: PricingMode
  dateAdded: string
  location: StorageLocation
  costSnapshot?: InventoryCostSnapshot
  additionalCosts?: PersistedProductCost[]
}

export type PackageType = "Carton" | "Box" | "Case" | "Custom"

export interface Ammunition {
  id: string;
  name?: string;
  caliber: string;
  packageType: PackageType;
  unitsPerPackage: number;
  fullPackages: number;
  looseRounds: number;
  safetyThreshold: number;
  price: number;
  priceCurrency?: string;
  priceValuation?: MoneyValuation;
  retailPrice: number;
  wholesalePrice: number;
  retailPriceValuation?: MoneyValuation;
  wholesalePriceValuation?: MoneyValuation;
  retailPriceMode: PricingMode;
  wholesalePriceMode: PricingMode;
  dateAdded: string;
  location: StorageLocation;
  costSnapshot?: InventoryCostSnapshot;
  additionalCosts?: PersistedProductCost[];
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
  // Dual-valuation: total shipment cost in original and accounting currencies
  totalCostValuation?: MoneyValuation
  workflowStatus?: "draft" | "processing" | "pending_review" | "scheduled" | "arrived" | "received" | "failed" | "cancelled"
  importId?: string
  arrivalNote?: string
  delayReason?: string
  lastArrivalPromptAt?: string
  additionalCosts?: PersistedShipmentCost[]
  plannedCosts?: ShipmentAdditionalCostInput[]
  /** Database creation timestamp; used as the default shipment-list ordering key. */
  createdAt?: string
  /** Client-only optimistic state while the backend is registering the shipment. */
  isSaving?: boolean
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
  currency?: string
  accountingCurrency?: string
  exchangeRate?: number
  exchangeRateDate?: string
  rateSource?: MoneyValuation["rateSource"]
  totalOriginalAccounting?: number
  totalNegotiatedAccounting?: number
  totalPaidAccounting?: number
  balanceAccounting?: number
  taxAmountAccounting?: number
  // Dual-valuation: original currency, exchange rate, and accounting amount
  totalValuation?: MoneyValuation
}

export interface PaymentRecord {
  id: string
  invoiceId: string
  invoiceNumber: string
  date: string
  amount: number
  currency?: string
  accountingAmount?: number
  accountingCurrency?: string
  exchangeRate?: number
  exchangeRateDate?: string
  rateSource?: MoneyValuation["rateSource"]
  rateId?: string
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
  notes?: string
  customFields?: Record<string, string>
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
  entityType?: string
  entityId?: string
  entityName?: string
  previousValues?: Record<string, unknown>
  newValues?: Record<string, unknown>
  reason?: string
  userName?: string
  eventKey?: string
  details?: Record<string, unknown>
  itemCount?: number
  importance?: 0 | 1 | 2 | 3
  isVisible?: boolean
}

export interface InventoryProductType {
  id: string
  category: "accessory" | "ammunition"
  name: string
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
  /** Login identifier shown in legacy views. Prefer email when it exists, otherwise name. */
  username: string
  email?: string
  name: string
  role: UserRole
  isPrimaryAdmin?: boolean
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
  "inventory.view"?: boolean
  "inventory.edit"?: boolean
  "sales.create"?: boolean
  "customers.manage"?: boolean
  "suppliers.manage"?: boolean
  "currencies.view"?: boolean
  "currencies.edit"?: boolean
  "currencies.add"?: boolean
  "currencies.delete"?: boolean
  "backups.view"?: boolean
  "backups.personal.create"?: boolean
  "backups.personal.restore"?: boolean
  "backups.system.create"?: boolean
  "shipment.import"?: boolean
  "shipment.review"?: boolean
  "shipment.edit"?: boolean
  "shipment.receive"?: boolean
  "shipment.cancel"?: boolean
  "shipment.reschedule"?: boolean
}

export interface SystemSettings {
  currencySymbol: string
  currencyCode: string
  accountingCurrencyCode: string
  rateBaseCurrencyCode: string
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
  targetRetailMarginPercent: number
  targetWholesaleMarginPercent: number
  maximumMarkupPercent: number
  psychologicalPricing: boolean
  theme?: "dark" | "light" | "system"
  // Multi-currency display preferences
  preferredDisplayCurrency?: string
  // Application-wide preferences persisted for the authenticated Supabase user.
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
  inventoryVisibleColumns?: string[]
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
