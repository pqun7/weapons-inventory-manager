import type {
  PaymentMethod,
  PricingMode,
  ProductAdditionalCostInput,
  SaleLineItem,
  SaleMode,
  ShipmentAdditionalCostInput,
  ShipmentStatus,
  StorageLocation,
  WeaponCondition,
  PackageType,
} from "./types.js"

export interface BulkIntakeInput {
  serialNumbers: string[]
  weaponTypeId: string
  weaponSubtypeId: string
  caliberId: string
  brandId: string
  modelId: string
  storageLocationId?: string | null
  weaponTypeLabel?: string
  subTypeLabel?: string
  caliberLabel?: string
  brandLabel?: string
  modelLabel?: string
  condition: WeaponCondition
  purchasePrice: number
  retailPrice: number
  wholesalePrice: number
  retailPriceMode?: PricingMode
  wholesalePriceMode?: PricingMode
  supplierId: string
  shipmentId: string | null
  currency?: string
  notes: string
  additionalCosts?: ProductAdditionalCostInput[]
}

export interface SaleInput {
  /** Stable for the lifetime of one user submission and reused for safe retries. */
  operationId: string
  weaponIds: string[]
  lineItems: SaleLineItem[]
  customerId?: string
  customerName?: string
  newCustomer?: {
    name: string
    phone: string
    email: string
    address: string
    isWholesaleBuyer: boolean
    wholesaleDiscountPercent: number
  }
  mode: SaleMode
  invoiceNumber: string
  totalNegotiated: number
  totalOriginal: number
  dueDate: string
  attachments: string[]
  notes: string
  taxAmount: number
  paidAmount?: number
  balance?: number
  paymentMethod?: PaymentMethod
  date?: string
  currency?: string
}

export interface WeaponDetailsInput {
  serialNumber: string
  weaponTypeId: string
  weaponSubtypeId: string
  caliberId: string
  brandId: string
  modelId: string
  storageLocationId: string | null
  supplierId: string | null
  condition: WeaponCondition
  purchasePrice: number
  retailPrice: number
  wholesalePrice: number
  retailPriceMode: PricingMode
  wholesalePriceMode: PricingMode
  currency: string
}

export interface ShipmentInput {
  shipmentNumber: string
  supplierId: string
  newSupplier?: { name: string; contactPerson: string; phone: string; email: string; address: string }
  shipmentDate: string
  expectedArrivalDate: string
  totalExpectedItems: number
  attachments: string[]
  notes: string
  purchaseOrderNumber?: string
  invoiceNumber?: string
  shippingCarrier?: string
  containerNumber?: string
  currency?: string
  purchaseDate?: string
  actualArrivalDate?: string
  status?: ShipmentStatus
  additionalCosts?: ShipmentAdditionalCostInput[]
  lineItems?: ShipmentLineItemInput[]
}

export interface ShipmentLineItemInput {
  id?: string
  productType: "weapon" | "ammunition" | "accessory"
  weaponTypeId: string
  weaponSubtypeId: string
  caliberId: string
  brandId: string
  modelId: string
  storageLocationId?: string | null
  quantity: number
  purchasePrice: number
  retailPrice: number
  wholesalePrice: number
  retailPriceMode?: PricingMode
  wholesalePriceMode?: PricingMode
  serialNumbers: string[]
  currency?: string
  weaponTypeLabel?: string
  subTypeLabel?: string
  caliberLabel?: string
  brandLabel?: string
  modelLabel?: string
  location?: StorageLocation
  additionalCosts?: ProductAdditionalCostInput[]
}

export interface BulkShipmentCreateInput {
  shipment: ShipmentInput
  lineItems: ShipmentLineItemInput[]
  additionalCosts?: ShipmentAdditionalCostInput[]
}

export interface PaymentInput {
  invoiceId: string
  amount: number
  currency?: string
  method: PaymentMethod
  notes: string
}

export interface DueDateExtensionInput {
  invoiceId: string
  newDueDate: string
  reason?: string
}

export interface AddStockInput {
  operationId: string
  itemType: "accessory" | "ammunition"
  itemId: string
  quantityDelta: number
  costUpdate?: { amount: number; currency: string }
  shipmentId?: string | null
  notes?: string
  location?: StorageLocation
}

export interface ReceiveAmmoByPackagesInput {
  operationId: string
  itemId: string
  numberOfPackages: number
  unitsPerPackage: number
  purchasePrice: number
  currency?: string
  shipmentId: string | null
  notes: string
  location?: StorageLocation
}

export interface ReceiveAmmoByRoundsInput {
  operationId: string
  itemId: string
  totalRounds: number
  purchasePrice: number
  currency?: string
  shipmentId: string | null
  notes: string
  location?: StorageLocation
}

export interface SellAmmoInput {
  itemId: string
  rounds: number
}

export interface UpdateAmmoPackageInput {
  itemId: string
  packageType: PackageType
  unitsPerPackage: number
}
