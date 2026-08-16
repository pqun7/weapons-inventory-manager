import { create } from "zustand"
import type {
  Weapon, Accessory, Ammunition, Shipment, ShipmentDocument,
  ShipmentEventType, Invoice, PaymentRecord, Customer, Supplier, AuditLog,
  AppNotification, User, SystemSettings, WeaponStatus, WeaponCondition, SaleMode,
  PaymentMethod, AuditActionType, NotificationType, ShipmentStatus,
  SaleLineItem, SavedFilter, StorageLocation, PackageType, UserPreferences,
  ProductAdditionalCostInput, ShipmentAdditionalCostInput,
  InventoryProductType, PricingMode,
} from "./types.js"
import { ammoTotalRounds } from "./types.js"
import * as db from "./db/index.js"
import { optimisticShipment } from "./shipment-workflow.js"
import { permissionsForRole } from "./rbac.js"
import { invalidateDashboardAnalyticsCache } from "./dashboard/cache.js"
import type { WeaponDetailsInput } from "./store-inputs.js"

// ============ Input Types ============

export interface BulkIntakeInput {
  serialNumbers: string[]
  // New foreign keys
  weaponTypeId: string
  weaponSubtypeId: string
  caliberId: string
  brandId: string
  modelId: string
  storageLocationId?: string | null
  // Labels (optional, for display in audit logs, etc.)
  weaponTypeLabel?: string
  subTypeLabel?: string
  caliberLabel?: string
  brandLabel?: string
  modelLabel?: string
  // Prices and status
  condition: WeaponCondition
  purchasePrice: number
  retailPrice: number
  wholesalePrice: number
  retailPriceMode?: PricingMode
  wholesalePriceMode?: PricingMode
  supplierId: string
  shipmentId: string | null          // ← corrected to allow null
  currency?: string
  notes: string
  additionalCosts?: ProductAdditionalCostInput[]
}

export interface SaleInput {
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

// Updated: now contains the FK IDs required by the backend
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
  // Optional display labels – used by backend for audit/logs and shipment line item display
  weaponTypeLabel?: string
  subTypeLabel?: string
  caliberLabel?: string
  brandLabel?: string
  modelLabel?: string
  // Optional location object (if known) – overrides DB lookup in backend
  location?: StorageLocation
  additionalCosts?: ProductAdditionalCostInput[]
}

export interface BulkShipmentCreateInput {
  shipment: ShipmentInput
  lineItems: ShipmentLineItemInput[]
  additionalCosts?: ShipmentAdditionalCostInput[]
}

export interface ShipmentDocumentInput {
  fileName: string
  fileType: string
  fileSize: number
  category: string
  extractedText: string
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
  operationId: string;
  itemType: "accessory" | "ammunition";
  itemId: string;
  // حقول خاصة بالقطع (Accessories)
  quantityDelta: number;
  // حقول خاصة بالذخائر (Ammunition)
  // تحديث السعر (اختياري)
  costUpdate?: { amount: number; currency: string };
  // حقول قديمة محفوظة للتوافق مع الإصدارات السابقة (غير مستخدمة في الـ handler الحالي)
  shipmentId?: string | null;
  notes?: string;
  location?: StorageLocation;
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

// ============ Store State ============

export interface StoreState {
  weapons: Weapon[]
  accessories: Accessory[]
  ammunition: Ammunition[]
  shipments: Shipment[]
  invoices: Invoice[]
  payments: PaymentRecord[]
  customers: Customer[]
  suppliers: Supplier[]
  auditLogs: AuditLog[]
  notifications: AppNotification[]
  users: User[]
  settings: SystemSettings
  userPreferences: UserPreferences | null
  currentUserId: string
  // Removed redundant custom master-data arrays (now managed via useDynamicMasterData)
  searchHistory: string[]
  pinnedSearchItems: string[]
  savedFilters: SavedFilter[]
  inventoryProductTypes: InventoryProductType[]

  // Computed getters
  getCurrentUser: () => User
  getWeaponBySerial: (serial: string) => Weapon | undefined
  getInvoiceById: (id: string) => Invoice | undefined
  getInvoicesByCustomerId: (customerId: string) => Invoice[]
  getWeaponsByShipmentId: (shipmentId: string) => Weapon[]
  getPaymentsByInvoiceId: (invoiceId: string) => PaymentRecord[]
  getOverdueInvoices: () => Invoice[]
  getUnreadNotifications: () => AppNotification[]
  getDefaultCurrency: () => string

  // CRUD operations (async — go through IPC in Electron, fall back to db layer in browser)
  addBulkWeapons: (input: BulkIntakeInput) => Promise<{ success: boolean; added: number; duplicates: string[]; error?: string }>
  updateWeaponStatus: (weaponId: string, status: WeaponStatus, reason?: string) => Promise<{ success: boolean; error?: string }>
  updateWeaponDetails: (weaponId: string, updates: WeaponDetailsInput) => Promise<{ success: boolean; error?: string }>
  updateWeaponNotes: (weaponId: string, notes: string) => Promise<{ success: boolean; error?: string }>
  updateWeaponLocation: (weaponId: string, storageLocationId: string | null) => Promise<{ success: boolean; error?: string }>
  addWeaponImage: (weaponId: string, imageBase64: string) => Promise<{ success: boolean; error?: string }>
  completeSale: (input: SaleInput) => Promise<{ success: boolean; invoiceId?: string; invoiceNumber?: string; error?: string }>
  returnWeapon: (weaponId: string) => Promise<{ success: boolean; error?: string }>

  createShipment: (input: ShipmentInput) => Promise<{ success: boolean; shipmentId?: string; error?: string }>
  bindWeaponToShipment: (weaponId: string, shipmentId: string) => Promise<{ success: boolean; error?: string }>
  updateShipmentStatus: (shipmentId: string) => void
  setShipmentStatus: (shipmentId: string, status: ShipmentStatus, notes?: string) => Promise<{ success: boolean; error?: string }>
  autoFlagDelayedShipments: () => Promise<{ success: boolean; error?: string }>
  updateShipment: (shipmentId: string, updates: Partial<Shipment>) => Promise<{ success: boolean; error?: string }>
  deleteShipment: (shipmentId: string) => Promise<{ success: boolean; error?: string }>
  bulkCreateShipmentWithItems: (input: BulkShipmentCreateInput) => Promise<{ success: boolean; shipmentId?: string; error?: string }>
  receiveScheduledShipment: (shipmentId: string) => Promise<{ success: boolean; shipmentId?: string; error?: string }>
  rescheduleShipment: (shipmentId: string, expectedArrivalDate: string, reason: string) => Promise<{ success: boolean; error?: string }>
  updateScheduledShipment: (shipmentId: string, input: ShipmentInput) => Promise<{ success: boolean; error?: string }>
  addShipmentDocument: (shipmentId: string, doc: ShipmentDocumentInput) => Promise<{ success: boolean; error?: string }>
  deleteShipmentDocument: (shipmentId: string, docId: string) => Promise<{ success: boolean; error?: string }>
  addShipmentTimelineEvent: (shipmentId: string, eventType: ShipmentEventType, notes: string) => Promise<{ success: boolean; error?: string }>
  updateProductCosts: (productType: string, productId: string, costs: ProductAdditionalCostInput[]) => Promise<{ success: boolean; error?: string }>

  registerPayment: (input: PaymentInput) => Promise<{ success: boolean; error?: string; newBalance?: number }>
  extendDueDate: (input: DueDateExtensionInput) => Promise<{ success: boolean; error?: string }>
  voidInvoice: (invoiceId: string) => Promise<{ success: boolean; error?: string }>
  updateInvoiceNotes: (invoiceId: string, notes: string) => Promise<{ success: boolean; error?: string }>

  addCustomer: (customer: Omit<Customer, "id" | "dateAdded">) => Promise<{ success: boolean; customer?: Customer; error?: string }>
  updateCustomer: (customerId: string, updates: Partial<Omit<Customer, "id" | "dateAdded">>) => Promise<{ success: boolean; error?: string }>
  addSupplier: (supplier: Omit<Supplier, "id" | "dateAdded">) => Promise<{ success: boolean; supplier?: Supplier; error?: string }>
  deleteCustomer: (customerId: string) => Promise<{ success: boolean; error?: string }>

  updateAccessory: (id: string, updates: Partial<Accessory>) => Promise<{ success: boolean; error?: string }>
  updateAmmunition: (id: string, updates: Partial<Ammunition>) => Promise<{ success: boolean; error?: string }>
  addAccessory: (accessory: Omit<Accessory, "id" | "dateAdded" | "additionalCosts" | "costSnapshot"> & { additionalCostInputs?: ProductAdditionalCostInput[] }) => Promise<{ success: boolean; error?: string }>
  addAmmunition: (ammo: Omit<Ammunition, "id" | "dateAdded" | "additionalCosts" | "costSnapshot"> & { additionalCostInputs?: ProductAdditionalCostInput[] }) => Promise<{ success: boolean; error?: string }>
  addStock: (input: AddStockInput) => Promise<{ success: boolean; error?: string }>
  createInventoryProductType: (category: "accessory" | "ammunition", name: string) => Promise<{ success: boolean; type?: InventoryProductType; created?: boolean; error?: string }>
  updateProductPricing: (input: { productType: "weapon" | "accessory" | "ammunition"; productId: string; retailPrice: number; wholesalePrice: number; currency: string; retailMode: PricingMode; wholesaleMode: PricingMode }) => Promise<{ success: boolean; error?: string }>
  receiveAmmoByPackages: (input: ReceiveAmmoByPackagesInput) => Promise<{ success: boolean; error?: string }>
  receiveAmmoByRounds: (input: ReceiveAmmoByRoundsInput) => Promise<{ success: boolean; error?: string }>
  sellAmmo: (input: SellAmmoInput) => Promise<{ success: boolean; error?: string }>
  updateAmmoPackage: (input: UpdateAmmoPackageInput) => Promise<{ success: boolean; error?: string }>

  updateSettings: (updates: Partial<SystemSettings>) => Promise<{ success: boolean; error?: string }>
  updateUserPreferences: (updates: Partial<UserPreferences>) => Promise<{ success: boolean; error?: string }>
  trackCurrencyUsage: (code: string) => void
  addUser: (user: Omit<User, "id" | "passwordSet" | "passwordHash">) => Promise<{ success: boolean; activationCode?: string; userId?: string; error?: string }>
  updateUser: (id: string, updates: Partial<User>) => Promise<{ success: boolean; error?: string }>
  deleteUser: (id: string) => Promise<{ success: boolean; error?: string }>
  resetUserActivation: (id: string) => Promise<{ success: boolean; activationCode?: string; error?: string }>
  setCurrentUser: (userId: string) => void

  markNotificationRead: (id: string) => Promise<{ success: boolean; error?: string }>
  markAllNotificationsRead: () => Promise<{ success: boolean; error?: string }>
  dismissNotification: (id: string) => Promise<{ success: boolean; error?: string }>
  pushNotification: (type: NotificationType, title: string, message: string, entityId?: string) => Promise<{ success: boolean; error?: string }>
  refreshNotifications: () => Promise<{ success: boolean; error?: string }>

  addAuditLog: (actionType: AuditActionType, description: string, metadata?: string) => Promise<{ success: boolean; error?: string }>

  addSearchHistory: (query: string) => void
  togglePinSearch: (item: string) => void

  saveFilter: (name: string, entityType: string, filterState: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
  deleteFilter: (id: string) => Promise<{ success: boolean; error?: string }>

  ready: boolean
  bootstrap: () => Promise<void>

  refreshFromDb: () => Promise<void>
}

function pad(num: number, size: number): string {
  return num.toString().padStart(size, "0")
}

function generateId(prefix: string, existing: { id: string }[]): string {
  let max = 0
  existing.forEach((item) => {
    const num = parseInt(item.id.replace(/\D/g, ""), 10)
    if (num > max) max = num
  })
  return `${prefix}${pad(max + 1, 4)}`
}

const DEFAULT_SETTINGS: SystemSettings = {
  currencySymbol: "$",
  currencyCode: "USD",
  accountingCurrencyCode: "USD",
  rateBaseCurrencyCode: "USD",
  preferredDisplayCurrency: "USD",
  supportedCurrencies: ["USD", "SAR", "SDG", "EGP"],
  currencyFrequency: {},
  taxPercent: 0,
  invoiceHeader: "WEAPON STORE MANAGEMENT SYSTEM",
  invoiceFooter: "All sales are final. Items sold as-is. Store license #WS-2024-001.",
  storeLogo: "",
  thermalPrinterWidth: 80,
  labelFormat: "Standard",
  hourlySnapshot: true,
  dailyClosingPrompt: true,
  weeklyVerification: false,
  minProfitMarginPercent: 5,
  targetRetailMarginPercent: 30,
  targetWholesaleMarginPercent: 20,
  maximumMarkupPercent: 200,
  psychologicalPricing: false,
  showDemoData: true,
  theme: "system",
}

const UNLINKED_USER: User = {
  id: "UNLINKED",
  username: "",
  name: "Unlinked User",
  role: "Employee",
  permissions: {
    canImportExcel: false,
    canExportData: false,
    canViewReports: false,
    canManageUsers: false,
    canRegisterPayments: false,
    canVoidInvoices: false,
    canExtendDueDates: false,
    canDeleteRecords: false,
  },
  passwordSet: false,
  passwordHash: "",
}

let bootstrapPromise: Promise<void> | null = null

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const useStore = create<StoreState>()(
  (set, get) => ({
    weapons: [],
    accessories: [],
    ammunition: [],
    shipments: [],
    invoices: [],
    payments: [],
    customers: [],
    suppliers: [],
    auditLogs: [],
    notifications: [],
    users: [],
    settings: DEFAULT_SETTINGS,
    userPreferences: null,
    currentUserId: "U001",
    // custom arrays removed
    searchHistory: [],
    pinnedSearchItems: [],
    savedFilters: [],
    inventoryProductTypes: [],
    ready: false,

    bootstrap: async () => {
      if (bootstrapPromise) return bootstrapPromise

      bootstrapPromise = (async () => {
        const perf = typeof performance !== "undefined" ? performance : null
        perf?.mark("boot:store-bootstrap:start")

        try {
          await db.initDb()
          const currentUserId = await db.dbGetCurrentUserId()
          let data = null as Awaited<ReturnType<typeof db.dbGetAll>> | null

          if (db.isDbReady()) {
            const deadline = Date.now() + 5000
            let lastError: unknown = null

            while (Date.now() < deadline) {
              try {
                data = await db.dbGetAll()
                break
              } catch (error) {
                lastError = error
                await sleep(100)
              }
            }

            if (!data) {
              throw lastError instanceof Error ? lastError : new Error("Database did not become ready in time")
            }

            const [userPrefs] = await Promise.all([
              db.dbGetUserPreferences(currentUserId).catch(() => null),
            ])

            set({
              weapons: data.weapons,
              accessories: data.accessories,
              ammunition: data.ammunition,
              shipments: data.shipments,
              invoices: data.invoices,
              payments: data.payments,
              customers: data.customers,
              suppliers: data.suppliers,
              auditLogs: data.auditLogs,
              notifications: data.notifications,
              users: data.users,
              settings: data.settings,
              savedFilters: data.savedFilters,
              inventoryProductTypes: data.inventoryProductTypes ?? [],
              userPreferences: userPrefs,
              currentUserId,
              ready: true,
            })
          } else {
            set({ ready: true })
          }
        } catch (e) {
          console.error("DB bootstrap failed:", e)
          set({ ready: false })
          throw e
        } finally {
          perf?.mark("boot:store-bootstrap:end")
          perf?.measure("boot:store-bootstrap", "boot:store-bootstrap:start", "boot:store-bootstrap:end")
          const entries = perf?.getEntriesByName("boot:store-bootstrap")
          const last = entries?.[entries.length - 1]
          if (last) {
            console.info(`[perf] boot:store-bootstrap ${last.duration.toFixed(1)}ms`)
          }
          bootstrapPromise = null
        }
      })()

      return bootstrapPromise
    },

    refreshFromDb: async () => {
      try {
        const data = await db.dbGetAll()
        invalidateDashboardAnalyticsCache()
        set((state) => ({
          weapons: data.weapons,
          accessories: data.accessories,
          ammunition: data.ammunition,
          shipments: [...state.shipments.filter((shipment) => shipment.isSaving), ...data.shipments],
          invoices: data.invoices,
          payments: data.payments,
          customers: data.customers,
          suppliers: data.suppliers,
          auditLogs: data.auditLogs,
          notifications: data.notifications,
          users: data.users,
          settings: data.settings,
          savedFilters: data.savedFilters,
          inventoryProductTypes: data.inventoryProductTypes ?? [],
        }))
      } catch (e) {
        console.error("refreshFromDb failed:", e)
      }
    },

    getCurrentUser: () => {
      const state = get()
      return state.users.find((u) => u.id === state.currentUserId) ?? state.users[0] ?? UNLINKED_USER
    },

    getWeaponBySerial: (serial) => {
      return get().weapons.find((w) => w.serialNumber.toLowerCase() === serial.toLowerCase())
    },

    getInvoiceById: (id) => get().invoices.find((i) => i.id === id),

    getInvoicesByCustomerId: (customerId) =>
      get().invoices.filter((i) => i.customerId === customerId && !i.voided),

    getWeaponsByShipmentId: (shipmentId) =>
      get().weapons.filter((w) => w.shipmentId === shipmentId),

    getPaymentsByInvoiceId: (invoiceId) =>
      get().payments.filter((p) => p.invoiceId === invoiceId),

    getOverdueInvoices: () =>
      get().invoices.filter((i) => i.status === "Overdue" && !i.voided),

    getUnreadNotifications: () => get().notifications.filter((n) => !n.read),

    getDefaultCurrency: () => {
      return get().settings.currencyCode
    },

    addBulkWeapons: async (input: BulkIntakeInput) => {
      try {
        const result = await db.dbBulkIntakeWeapons(input)
        await get().refreshFromDb()
        return { success: true, added: result.added, duplicates: result.duplicates }
      } catch (error) {
        return { success: false, added: 0, duplicates: [], error: error instanceof Error ? error.message : String(error) }
      }
    },

    updateWeaponStatus: async (weaponId, status, reason) => {
      try {
        await db.dbUpdateWeaponStatus(weaponId, status, reason ?? "")
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    updateWeaponDetails: async (weaponId, updates) => {
      const actor = get().getCurrentUser()
      if (actor.role !== "Admin" && actor.permissions?.["inventory.edit"] !== true) {
        return { success: false, error: "Inventory edit permission is required" }
      }
      try {
        await db.dbUpdateWeaponDetails(weaponId, updates)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    updateWeaponNotes: async (weaponId, notes) => {
      try {
        await db.dbUpdateWeaponNotes(weaponId, notes)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    updateWeaponLocation: async (weaponId: string, storageLocationId: string | null) => {
      const state = get()
      const weapon = state.weapons.find(w => w.id === weaponId)
      if (!weapon) return { success: false, error: "Weapon not found" }

      try {
        await db.dbUpdateWeaponLocation(weaponId, storageLocationId)
        await get().refreshFromDb()
      } catch (e) {
        console.error("Failed to update weapon location:", e)
        return { success: false, error: String(e) }
      }
      return { success: true }
    },

    addWeaponImage: async (weaponId, imageBase64) => {
      try {
        await db.dbAppendWeaponImage(weaponId, imageBase64)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    completeSale: async (input) => {
      try {
        const result = await db.dbCompleteSale(input)
        await get().refreshFromDb()
        return { success: true, invoiceId: result.invoiceId, invoiceNumber: result.invoiceNumber }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    returnWeapon: async (weaponId) => {
      return get().updateWeaponStatus(weaponId, "Returned", "Weapon returned by customer")
    },

    createShipment: async (input) => {
      const temporaryId = `TMP-SHIP-${crypto.randomUUID()}`
      set((state) => ({ shipments: [optimisticShipment(input, temporaryId), ...state.shipments] }))
      try {
        const shipmentId = await db.dbCreateShipmentRpc(input)
        await get().refreshFromDb()
        set((state) => ({ shipments: state.shipments.filter((shipment) => shipment.id !== temporaryId) }))
        return { success: true, shipmentId }
      } catch (error) {
        set((state) => ({ shipments: state.shipments.filter((shipment) => shipment.id !== temporaryId) }))
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    bindWeaponToShipment: async (weaponId, shipmentId) => {
      try {
        await db.dbBindWeaponToShipment(weaponId, shipmentId)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    updateShipmentStatus: (shipmentId) => {
      const state = get()
      const shipment = state.shipments.find((s) => s.id === shipmentId)
      if (!shipment) return
      const registered = state.weapons.filter((w) => w.shipmentId === shipmentId).length
      let status: ShipmentStatus = shipment.status
      if (registered >= shipment.totalExpectedItems) status = "Arrived"
      else if (registered > 0 && shipment.status !== "Delayed" && shipment.status !== "Cancelled") status = "Partial"
      set({ shipments: state.shipments.map((s) => s.id === shipmentId ? { ...s, status } : s) })
    },

    setShipmentStatus: async (shipmentId, status, notes) => {
      try {
        await db.dbSetShipmentStatus(shipmentId, status, notes ?? "")
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    autoFlagDelayedShipments: async () => {
      try {
        await db.dbFlagOverdueShipments()
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    updateShipment: async (shipmentId, updates) => {
      try {
        await db.dbUpdateShipmentDetails(shipmentId, updates)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    bulkCreateShipmentWithItems: async (input) => {
      const temporaryId = `TMP-SHIP-${crypto.randomUUID()}`
      const optimisticInput: ShipmentInput = {
        ...input.shipment,
        lineItems: input.lineItems,
        additionalCosts: input.additionalCosts,
      }
      set((state) => ({ shipments: [optimisticShipment(optimisticInput, temporaryId), ...state.shipments] }))
      try {
        const shipmentId = await db.dbBulkCreateShipment(input)
        await get().refreshFromDb()
        set((state) => ({ shipments: state.shipments.filter((shipment) => shipment.id !== temporaryId) }))
        return { success: true, shipmentId }
      } catch (error) {
        set((state) => ({ shipments: state.shipments.filter((shipment) => shipment.id !== temporaryId) }))
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
      // Browser fallback omitted for brevity — IPC path is primary
    },

    addShipmentDocument: async (shipmentId, doc) => {
      const state = get()
      const currentUser = state.getCurrentUser()
      const newDoc: ShipmentDocument = { id: generateId("DOC", state.shipments.flatMap((s) => s.documents ?? [])), fileName: doc.fileName, fileType: doc.fileType, fileSize: doc.fileSize, uploadDate: new Date().toISOString(), uploadedBy: currentUser.name, category: doc.category, extractedText: doc.extractedText }
      try {
        await db.dbAddShipmentDocument(shipmentId, newDoc)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    receiveScheduledShipment: async (shipmentId) => {
      try {
        const receivedShipmentId = await db.dbReceiveScheduledShipment(shipmentId)
        await get().refreshFromDb()
        return { success: true, shipmentId: receivedShipmentId }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    rescheduleShipment: async (shipmentId, expectedArrivalDate, reason) => {
      try {
        await db.dbRescheduleShipment(shipmentId, expectedArrivalDate, reason)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    updateScheduledShipment: async (shipmentId, input) => {
      try {
        await db.dbUpdateScheduledShipment(shipmentId, input)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    deleteShipment: async (shipmentId) => {
      try {
        await db.dbDeleteShipment(shipmentId)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    deleteShipmentDocument: async (shipmentId, docId) => {
      try {
        await db.dbDeleteShipmentDocument(shipmentId, docId)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    addShipmentTimelineEvent: async (shipmentId, eventType, notes) => {
      try {
        await db.dbAddShipmentTimelineEvent(shipmentId, eventType, notes)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    registerPayment: async (input) => {
      try {
        const result = await db.dbRegisterPayment(input)
        await get().refreshFromDb()
        return { success: true, newBalance: result.newBalance }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    extendDueDate: async (input) => {
      try {
        await db.dbExtendInvoiceDueDate(input)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    voidInvoice: async (invoiceId) => {
      try {
        await db.dbVoidInvoice(invoiceId)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    updateInvoiceNotes: async (invoiceId, notes) => {
      try {
        await db.dbUpdateInvoiceNotes(invoiceId, notes)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    addCustomer: async (customer) => {
      const newCustomer: Customer = { ...customer, id: generateId("CUST", get().customers), dateAdded: new Date().toISOString().split("T")[0] }
      set((state) => ({ customers: [newCustomer, ...state.customers] }))
      try { await db.dbInsertCustomer(newCustomer) } catch (e) {
        set((state) => ({ customers: state.customers.filter((c) => c.id !== newCustomer.id) }))
        return { success: false, error: String(e) }
      }
      return { success: true, customer: newCustomer }
    },

    updateCustomer: async (customerId, updates) => {
      try {
        await db.dbUpdateCustomer(customerId, updates)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    addSupplier: async (supplier) => {
      const newSupplier: Supplier = { ...supplier, id: generateId("SUP", get().suppliers), dateAdded: new Date().toISOString().split("T")[0] }
      set((state) => ({ suppliers: [newSupplier, ...state.suppliers] }))
      try { await db.dbInsertSupplier(newSupplier) } catch (e) {
        set((state) => ({ suppliers: state.suppliers.filter((s) => s.id !== newSupplier.id) }))
        return { success: false, error: String(e) }
      }
      return { success: true, supplier: newSupplier }
    },

    deleteCustomer: async (customerId) => {
      const state = get()
      if (state.invoices.some((i) => i.customerId === customerId && !i.voided)) return { success: false, error: "Cannot delete customer with active invoices" }
      set({ customers: state.customers.filter((c) => c.id !== customerId) })
      try { await db.dbDeleteCustomer(customerId) } catch (e) { console.error("DB persist failed:", e) }
      return { success: true }
    },

    updateAccessory: async (id, updates) => {
      try {
        await db.dbUpdateInventoryProduct("accessory", id, updates)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    updateAmmunition: async (id, updates) => {
      try {
        await db.dbUpdateInventoryProduct("ammunition", id, updates)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    addAccessory: async (accessory) => {
      const newAccessory: Accessory = {
        ...accessory,
        id: generateId("ACC", get().accessories),
        dateAdded: new Date().toISOString().split("T")[0],
      }

      try {
        await db.dbCreateAccessory(newAccessory, accessory.additionalCostInputs ?? [])
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    addAmmunition: async (ammo) => {
      const newAmmo: Ammunition = {
        ...ammo,
        id: generateId("AMM", get().ammunition),
        dateAdded: new Date().toISOString().split("T")[0],
      }

      try {
        await db.dbCreateAmmunition(newAmmo, ammo.additionalCostInputs ?? [])
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    addStock: async (input) => {
      try {
        await db.dbAdjustInventoryStock(input)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    receiveAmmoByPackages: async (input) => {
      try {
        await db.dbReceiveAmmoByPackages(input)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    receiveAmmoByRounds: async (input) => {
      try {
        await db.dbReceiveAmmoByRounds(input)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    sellAmmo: async (_input) => {
      return { success: false, error: "Ammunition sales must be completed through the atomic sale and invoice workflow" }
    },

    updateAmmoPackage: async (input) => {
      try {
        await db.dbUpdateAmmoPackage(input)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    updateSettings: async (updates) => {
      const previous = get().settings
      const requested = { ...previous, ...updates }
      try {
        await db.dbUpdateSettings(requested)
        const saved = await db.dbGetSettings()
        set({ settings: saved })
        return { success: true }
      } catch (error) {
        set({ settings: previous })
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    createInventoryProductType: async (category, name) => {
      try {
        const result = await db.dbCreateInventoryProductType(category, name)
        await get().refreshFromDb()
        return { success: true, type: { id: result.id, category: result.category, name: result.name }, created: result.created }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    updateProductPricing: async (input) => {
      try {
        await db.dbUpdateProductPricing(input)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    updateProductCosts: async (productType, productId, costs) => {
      try {
        await db.dbReplaceProductCosts(productType, productId, costs)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    updateUserPreferences: async (updates) => {
      const state = get()
      const previous = state.userPreferences
      const current = previous ?? {
        userId: state.currentUserId,
        displayCurrency: "USD",
        reportViewMode: "display" as const,
      }
      const merged = { ...current, ...updates }
      set({ userPreferences: merged })
      try {
        await db.dbUpsertUserPreferences(merged)
        return { success: true }
      } catch (error) {
        set({ userPreferences: previous })
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    trackCurrencyUsage: (code) => {
      set((state) => ({ settings: { ...state.settings, currencyFrequency: { ...state.settings.currencyFrequency, [code]: (state.settings.currencyFrequency[code] ?? 0) + 1 } } }))
    },

    addUser: async (user) => {
      const newUser: User = {
        ...user,
        username: user.email ?? user.name,
        permissions: permissionsForRole(user.role, user.permissions),
        id: `TMP-USER-${crypto.randomUUID()}`,
        passwordSet: false,
        passwordHash: "",
      }
      set((state) => ({ users: [...state.users, newUser] }))
      try {
        const created = await db.dbInsertUser(newUser)
        set((state) => ({
          users: state.users.map((item) => item.id === newUser.id ? { ...item, id: created.userId } : item),
        }))
        return { success: true, activationCode: created.activationCode, userId: created.userId }
      } catch (e) {
        set((state) => ({ users: state.users.filter((item) => item.id !== newUser.id) }))
        return { success: false, error: String(e) }
      }
    },

    updateUser: async (id, updates) => {
      const { name: _name, username: _username, ...allowedUpdates } = updates
      set((state) => ({ users: state.users.map((u) => u.id === id ? {
        ...u,
        ...allowedUpdates,
        username: allowedUpdates.email ?? u.name,
        permissions: permissionsForRole(allowedUpdates.role ?? u.role, allowedUpdates.permissions ?? u.permissions),
      } : u) }))
      const u = get().users.find((u) => u.id === id)
      if (u) {
        try { await db.dbUpdateUser(u) } catch (e) {
          console.error("DB persist failed:", e)
          await get().refreshFromDb()
          return { success: false, error: String(e) }
        }
      }
      return { success: true }
    },

    deleteUser: async (id) => {
      set((state) => ({ users: state.users.filter((u) => u.id !== id) }))
      try { await db.dbDeleteUser(id) } catch (e) {
        await get().refreshFromDb()
        return { success: false, error: String(e) }
      }
      return { success: true }
    },

    resetUserActivation: async (id) => {
      try {
        return { success: true, activationCode: await db.dbResetUserActivation(id) }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },

    setCurrentUser: (userId) => { set({ currentUserId: userId }) },

    markNotificationRead: async (id) => {
      set((state) => ({ notifications: state.notifications.map((n) => n.id === id ? { ...n, read: true } : n) }))
      const n = get().notifications.find((n) => n.id === id)
      if (n) {
        try { await db.dbUpdateNotification(n) } catch (e) {
          console.error("DB persist failed:", e)
          await get().refreshFromDb()
          return { success: false, error: String(e) }
        }
      }
      return { success: true }
    },

    markAllNotificationsRead: async () => {
      try {
        await db.dbMarkAllNotificationsRead()
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    dismissNotification: async (id) => {
      try {
        await db.dbDeleteNotification(id)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    pushNotification: async (type, title, message, entityId) => {
      try {
        await db.dbCreateNotification(type, title, message, entityId)
        await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    refreshNotifications: async () => {
      const state = get()
      const notifs: AppNotification[] = []
      let id = state.notifications.length + 1
      state.invoices.filter((i) => i.status === "Overdue" && !i.voided).forEach((inv) => {
        if (!state.notifications.some((n) => n.entityId === inv.id && n.type === "OverdueDebt")) notifs.push({ id: `NTF${pad(id++, 4)}`, type: "OverdueDebt", title: "Overdue Debt Alert", message: `${inv.customerName} — Invoice ${inv.invoiceNumber} is overdue (Balance: ${inv.balance})`, date: new Date().toISOString().split("T")[0], read: false, entityId: inv.id })
      })
      state.accessories.filter((a) => a.quantity < a.safetyThreshold).forEach((a) => {
        if (!state.notifications.some((n) => n.entityId === a.id && n.type === "LowStock")) notifs.push({ id: `NTF${pad(id++, 4)}`, type: "LowStock", title: "Low Stock: Accessory", message: `${a.name} is below safety threshold (${a.quantity}/${a.safetyThreshold})`, date: new Date().toISOString().split("T")[0], read: false, entityId: a.id })
      })
      state.ammunition.filter((a) => ammoTotalRounds(a) < a.safetyThreshold).forEach((a) => {
        if (!state.notifications.some((n) => n.entityId === a.id && n.type === "LowStock")) notifs.push({ id: `NTF${pad(id++, 4)}`, type: "LowStock", title: "Low Stock: Ammunition", message: `${a.caliber} is below safety threshold (${ammoTotalRounds(a)}/${a.safetyThreshold})`, date: new Date().toISOString().split("T")[0], read: false, entityId: a.id })
      })
      try {
        await Promise.all(notifs.map((notification) => db.dbCreateNotification(
          notification.type, notification.title, notification.message, notification.entityId ?? undefined,
        )))
        if (notifs.length > 0) await get().refreshFromDb()
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    addAuditLog: async (actionType, description, metadata) => {
      try {
        await db.dbWriteAuditEvent(actionType, description, metadata)
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    addSearchHistory: (query) => { set((state) => ({ searchHistory: [query, ...state.searchHistory.filter((q) => q !== query)].slice(0, 5) })) },
    togglePinSearch: (item) => { set((state) => state.pinnedSearchItems.includes(item) ? { pinnedSearchItems: state.pinnedSearchItems.filter((i) => i !== item) } : { pinnedSearchItems: [item, ...state.pinnedSearchItems].slice(0, 10) }) },

    saveFilter: async (name, entityType, filterState) => {
      const newFilter: SavedFilter = { id: `FLT${pad(get().savedFilters.length + 1, 4)}`, name, entityType, filterState }
      set((state) => ({ savedFilters: [...state.savedFilters, newFilter] }))
      try { await db.dbInsertSavedFilter(newFilter) } catch (e) {
        set((state) => ({ savedFilters: state.savedFilters.filter((item) => item.id !== newFilter.id) }))
        return { success: false, error: String(e) }
      }
      return { success: true }
    },

    deleteFilter: async (id) => {
      set((state) => ({ savedFilters: state.savedFilters.filter((f) => f.id !== id) }))
      try { await db.dbDeleteSavedFilter(id) } catch (e) {
        await get().refreshFromDb()
        return { success: false, error: String(e) }
      }
      return { success: true }
    },
  }),
)
