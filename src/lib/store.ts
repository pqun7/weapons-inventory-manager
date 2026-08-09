import { create } from "zustand"
import type {
  Weapon, Accessory, Ammunition, Shipment, ShipmentDocument,
  ShipmentEventType, Invoice, PaymentRecord, Customer, Supplier, AuditLog,
  AppNotification, User, SystemSettings, WeaponStatus, WeaponCondition, SaleMode,
  InvoiceStatus, PaymentMethod, AuditActionType, NotificationType, ShipmentStatus,
  SaleLineItem, SavedFilter, StorageLocation, PackageType, UserPreferences,
} from "./types.js"
import { ammoTotalRounds } from "./types.js"
import * as db from "./db/index.js"

declare const window: any

// ============ Input Types ============

export interface BulkIntakeInput {
  serialNumbers: string[]
  // New foreign keys
  weaponTypeId: string
  weaponSubtypeId: string
  caliberId: string
  brandId: string
  modelId: string
  storageLocationId: string
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
  supplierId: string
  shipmentId: string | null          // ← corrected to allow null
  currency?: string
  notes: string
}

export interface SaleInput {
  weaponIds: string[]
  lineItems: SaleLineItem[]
  customerId: string
  customerName: string
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
  lineItems?: ShipmentLineItemInput[]
}

// Updated: now contains the FK IDs required by the backend
export interface ShipmentLineItemInput {
  productType: "weapon" | "ammunition" | "accessory"
  weaponTypeId: string
  weaponSubtypeId: string
  caliberId: string
  brandId: string
  modelId: string
  storageLocationId: string
  quantity: number
  purchasePrice: number
  retailPrice: number
  wholesalePrice: number
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
}

export interface BulkShipmentCreateInput {
  shipment: ShipmentInput
  lineItems: ShipmentLineItemInput[]
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
  reason: string
}

export interface AddStockInput {
  itemType: "accessory" | "ammunition";
  itemId: string;
  // حقول خاصة بالقطع (Accessories)
  quantity?: number;
  // حقول خاصة بالذخائر (Ammunition)
  packages?: number;
  looseRounds?: number;
  // تحديث السعر (اختياري)
  price?: number;
  currency?: string;
  // حقول قديمة محفوظة للتوافق مع الإصدارات السابقة (غير مستخدمة في الـ handler الحالي)
  purchasePrice?: number;
  shipmentId?: string | null;
  notes?: string;
  location?: StorageLocation;
}
export interface ReceiveAmmoByPackagesInput {
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

// ============ IPC Helper ============

function getElectronAPI(): any | null {
  if (typeof window !== "undefined" && (window as any).electronAPI) {
    return (window as any).electronAPI
  }
  return null
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
  updateWeaponNotes: (weaponId: string, notes: string) => Promise<{ success: boolean; error?: string }>
  updateWeaponLocation: (weaponId: string, storageLocationId: string) => Promise<{ success: boolean; error?: string }>
  addWeaponImage: (weaponId: string, imageBase64: string) => void
  completeSale: (input: SaleInput) => Promise<{ success: boolean; invoiceId?: string; invoiceNumber?: string; error?: string }>
  returnWeapon: (weaponId: string) => Promise<{ success: boolean; error?: string }>

  createShipment: (input: ShipmentInput) => Promise<{ success: boolean; shipmentId?: string; error?: string }>
  bindWeaponToShipment: (weaponId: string, shipmentId: string) => Promise<{ success: boolean; error?: string }>
  updateShipmentStatus: (shipmentId: string) => void
  setShipmentStatus: (shipmentId: string, status: ShipmentStatus, notes?: string) => Promise<{ success: boolean; error?: string }>
  autoFlagDelayedShipments: () => void
  updateShipment: (shipmentId: string, updates: Partial<Shipment>) => Promise<{ success: boolean; error?: string }>
  bulkCreateShipmentWithItems: (input: BulkShipmentCreateInput) => Promise<{ success: boolean; shipmentId?: string; error?: string }>
  addShipmentDocument: (shipmentId: string, doc: ShipmentDocumentInput) => void
  deleteShipmentDocument: (shipmentId: string, docId: string) => void
  addShipmentTimelineEvent: (shipmentId: string, eventType: ShipmentEventType, notes: string) => void

  registerPayment: (input: PaymentInput) => Promise<{ success: boolean; error?: string; newBalance?: number }>
  extendDueDate: (input: DueDateExtensionInput) => Promise<{ success: boolean; error?: string }>
  voidInvoice: (invoiceId: string) => Promise<{ success: boolean; error?: string }>
  updateInvoiceNotes: (invoiceId: string, notes: string) => void

  addCustomer: (customer: Omit<Customer, "id" | "dateAdded">) => Promise<{ success: boolean; customer?: Customer; error?: string }>
  addSupplier: (supplier: Omit<Supplier, "id" | "dateAdded">) => Promise<{ success: boolean; supplier?: Supplier; error?: string }>
  deleteCustomer: (customerId: string) => Promise<{ success: boolean; error?: string }>

  updateAccessory: (id: string, updates: Partial<Accessory>) => void
  updateAmmunition: (id: string, updates: Partial<Ammunition>) => void
  addAccessory: (accessory: Omit<Accessory, "id" | "dateAdded">) => Promise<{ success: boolean; error?: string }>
  addAmmunition: (ammo: Omit<Ammunition, "id" | "dateAdded">) => Promise<{ success: boolean; error?: string }>
  addStock: (input: AddStockInput) => Promise<{ success: boolean; error?: string }>
  receiveAmmoByPackages: (input: ReceiveAmmoByPackagesInput) => Promise<{ success: boolean; error?: string }>
  receiveAmmoByRounds: (input: ReceiveAmmoByRoundsInput) => Promise<{ success: boolean; error?: string }>
  sellAmmo: (input: SellAmmoInput) => Promise<{ success: boolean; error?: string }>
  updateAmmoPackage: (input: UpdateAmmoPackageInput) => Promise<{ success: boolean; error?: string }>

  updateSettings: (updates: Partial<SystemSettings>) => Promise<{ success: boolean; error?: string }>
  updateUserPreferences: (updates: Partial<UserPreferences>) => Promise<{ success: boolean; error?: string }>
  trackCurrencyUsage: (code: string) => void
  addUser: (user: Omit<User, "id" | "passwordSet" | "passwordHash">) => Promise<{ success: boolean; error?: string }>
  updateUser: (id: string, updates: Partial<User>) => Promise<{ success: boolean; error?: string }>
  deleteUser: (id: string) => Promise<{ success: boolean; error?: string }>
  setCurrentUser: (userId: string) => void

  markNotificationRead: (id: string) => Promise<{ success: boolean; error?: string }>
  markAllNotificationsRead: () => void
  dismissNotification: (id: string) => void
  pushNotification: (type: NotificationType, title: string, message: string, entityId?: string) => void
  refreshNotifications: () => void

  addAuditLog: (actionType: AuditActionType, description: string, metadata?: string) => void

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
  theme: "system",
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
    ready: false,

    bootstrap: async () => {
      if (bootstrapPromise) return bootstrapPromise

      bootstrapPromise = (async () => {
        const perf = typeof performance !== "undefined" ? performance : null
        perf?.mark("boot:store-bootstrap:start")

        try {
          await db.initDb()
          const currentUserId = get().currentUserId
          let data = null as Awaited<ReturnType<typeof db.dbGetAll>> | null

          if (db.isDbReady()) {
            const deadline = Date.now() + 15000
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
              userPreferences: userPrefs,
              ready: true,
            })
          } else {
            set({ ready: true })
          }
        } catch (e) {
          console.error("DB bootstrap failed:", e)
          set({ ready: true })
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
        })
      } catch (e) {
        console.error("refreshFromDb failed:", e)
      }
    },

    getCurrentUser: () => {
      const state = get()
      return state.users.find((u) => u.id === state.currentUserId) ?? state.users[0] ?? {
        id: "U001", username: "admin", name: "Admin User", role: "Admin" as const,
        permissions: { canImportExcel: true, canExportData: true, canViewReports: true, canManageUsers: true, canRegisterPayments: true, canVoidInvoices: true, canExtendDueDates: true, canDeleteRecords: true },
        passwordSet: true, passwordHash: "",
      }
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
      const state = get()
      const api = getElectronAPI()
      if (api) {
        const currentUser = state.getCurrentUser()
        const result = await api.weapon.bulkInsert(input, { id: currentUser.id, name: currentUser.name })
        if (!result.success) return { success: false, added: 0, duplicates: [], error: result.error }
        await get().refreshFromDb()
        return { success: true, added: result.data.added, duplicates: result.data.duplicates }
      }
      return {
        success: false,
        added: 0,
        duplicates: [],
        error: "The authoritative backend is required for financial inventory intake",
      }
    },

    updateWeaponStatus: async (weaponId, status, reason) => {
      const api = getElectronAPI()
      const state = get()
      const currentUser = state.getCurrentUser()
      if (api) {
        const result = await api.weapon.updateStatus(weaponId, status, reason ?? "", { id: currentUser.id, name: currentUser.name })
        if (!result.success) return { success: false, error: result.error }
        await get().refreshFromDb()
        return { success: true }
      }
      const weapon = state.weapons.find((w) => w.id === weaponId)
      if (!weapon) return { success: false, error: "Weapon not found" }
      const updatedWeapon = {
        ...weapon, status,
        movementHistory: [...weapon.movementHistory, {
          id: `MV${pad(state.weapons.length + 1, 5)}`, timestamp: new Date().toISOString(),
          fromStatus: weapon.status, toStatus: status,
          userId: currentUser.id, userName: currentUser.name,
          reason: reason || `Status changed to ${status}`,
        }],
      }
      set({ weapons: state.weapons.map((w) => w.id === weaponId ? updatedWeapon : w) })
      try { await db.dbUpdateWeapon(updatedWeapon) } catch (e) { console.error("DB persist failed:", e) }
      return { success: true }
    },

    updateWeaponNotes: async (weaponId, notes) => {
      set((state) => ({ weapons: state.weapons.map((w) => w.id === weaponId ? { ...w, notes } : w) }))
      const w = get().weapons.find((w) => w.id === weaponId)
      if (w) {
        const api = getElectronAPI()
        if (api) { await api.weapon.update(w) }
        else { try { await db.dbUpdateWeapon(w) } catch (e) { console.error("DB persist failed:", e) } }
      }
      return { success: true }
    },

    updateWeaponLocation: async (weaponId: string, storageLocationId: string) => {
      const state = get()
      const weapon = state.weapons.find(w => w.id === weaponId)
      if (!weapon) return { success: false, error: "Weapon not found" }

      // Build the exact normalized entity that must be persisted.
      // The database stores storage_location_id, not warehouse/shelf/bin on weapons.
      const updatedWeapon: Weapon = { ...weapon, storageLocationId }

      set(state => ({
        weapons: state.weapons.map(w => w.id === weaponId ? updatedWeapon : w),
      }))

      const api = getElectronAPI()
      try {
        if (api) {
          const result = await api.weapon.update(updatedWeapon)
          if (!result?.success) {
            throw new Error(result?.error ?? "Failed to update weapon location")
          }
          await get().refreshFromDb()
        } else {
          await db.dbUpdateWeapon(updatedWeapon)
          await get().refreshFromDb()
        }
      } catch (e) {
        // Roll back the optimistic update if persistence fails.
        set(state => ({
          weapons: state.weapons.map(w => w.id === weaponId ? weapon : w),
        }))
        console.error("Failed to update weapon location:", e)
        return { success: false, error: String(e) }
      }
      return { success: true }
    },

    addWeaponImage: (weaponId, imageBase64) => {
      set((state) => ({
        weapons: state.weapons.map((w) => w.id === weaponId ? { ...w, images: [...w.images, imageBase64] } : w),
      }))
    },

    completeSale: async (input) => {
      const api = getElectronAPI()
      const state = get()
      const currentUser = state.getCurrentUser()
      if (api) {
        const result = await api.sale.complete(input, { id: currentUser.id, name: currentUser.name })
        if (!result.success) return { success: false, error: result.error }
        await get().refreshFromDb()
        return { success: true, invoiceId: result.data.invoiceId, invoiceNumber: result.data.invoiceNumber }
      }
      return { success: false, error: "The authoritative backend is required to complete a sale" }
    },

    returnWeapon: async (weaponId) => {
      return get().updateWeaponStatus(weaponId, "Returned", "Weapon returned by customer")
    },

    createShipment: async (input) => {
      const api = getElectronAPI()
      const state = get()
      const currentUser = state.getCurrentUser()
      if (api) {
        const result = await api.shipment.create(input, { id: currentUser.id, name: currentUser.name })
        if (!result.success) return { success: false, error: result.error }
        await get().refreshFromDb()
        return { success: true, shipmentId: result.data.shipmentId }
      }
      return { success: false, error: "The authoritative backend is required to create a shipment" }
    },

    bindWeaponToShipment: async (weaponId, shipmentId) => {
      set((state) => ({
        weapons: state.weapons.map((w) => w.id === weaponId ? { ...w, shipmentId } : w),
      }))
      const w = get().weapons.find((w) => w.id === weaponId)
      if (w) {
        const api = getElectronAPI()
        if (api) { await api.weapon.update(w) }
        else { try { await db.dbUpdateWeapon(w) } catch (e) { console.error("DB persist failed:", e) } }
      }
      get().updateShipmentStatus(shipmentId)
      return { success: true }
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
      const state = get()
      const shipment = state.shipments.find((s) => s.id === shipmentId)
      if (!shipment) return { success: false, error: "Shipment not found" }
      const currentUser = state.getCurrentUser()
      const updated = {
        ...shipment, status,
        timeline: [...shipment.timeline, { id: `STL${pad(state.shipments.length + 1, 4)}`, timestamp: new Date().toISOString(), status, userId: currentUser.id, userName: currentUser.name, notes: notes || `Status manually changed to ${status}` }],
      }
      set({ shipments: state.shipments.map((s) => s.id === shipmentId ? updated : s) })
      const api = getElectronAPI()
      if (api) { await api.shipment.update(updated) }
      else { try { await db.dbUpdateShipment(updated) } catch (e) { console.error("DB persist failed:", e) } }
      return { success: true }
    },

    autoFlagDelayedShipments: () => {
      const state = get()
      const today = new Date().toISOString().split("T")[0]
      const delayed: Shipment[] = []
      const updated = state.shipments.map((s) => {
        if (s.status !== "Arrived" && s.status !== "Cancelled" && s.expectedArrivalDate < today) {
          const updatedShipment: Shipment = { ...s, status: "Delayed", timeline: [...s.timeline, { id: `STL${pad(state.shipments.length + 1, 4)}`, timestamp: new Date().toISOString(), status: "Delayed", userId: "SYSTEM", userName: "System", notes: "Auto-flagged as delayed", eventType: "DelayedAlert" }] }
          delayed.push(updatedShipment)
          return updatedShipment
        }
        return s
      })
      if (delayed.length > 0) {
        set({ shipments: updated })
        const newNotifs: AppNotification[] = delayed.map((d, i) => ({ id: `NTF${pad(state.notifications.length + 1 + i, 4)}`, type: "ShipmentDelayed" as NotificationType, title: "Shipment Delayed", message: `Shipment ${d.shipmentNumber} is past its expected arrival date`, date: today, read: false, entityId: d.id })).filter((n) => !state.notifications.some((ex) => ex.entityId === n.entityId && ex.type === "ShipmentDelayed"))
        if (newNotifs.length > 0) set({ notifications: [...newNotifs, ...state.notifications] })
      }
    },

    updateShipment: async (shipmentId, updates) => {
      const state = get()
      const currentUser = state.getCurrentUser()
      const shipment = state.shipments.find((s) => s.id === shipmentId)
      if (!shipment) return { success: false, error: "Shipment not found" }
      const updated = { ...shipment, ...updates, timeline: [...shipment.timeline, { id: `STL${pad(state.shipments.length + 1, 4)}`, timestamp: new Date().toISOString(), status: shipment.status, userId: currentUser.id, userName: currentUser.name, notes: "Shipment metadata updated", eventType: "MetadataUpdated" as ShipmentEventType }] }
      set({ shipments: state.shipments.map((s) => s.id === shipmentId ? updated : s) })
      const api = getElectronAPI()
      if (api) { await api.shipment.update(updated) }
      else { try { await db.dbUpdateShipment(updated) } catch (e) { console.error("DB persist failed:", e) } }
      return { success: true }
    },

    bulkCreateShipmentWithItems: async (input) => {
      const api = getElectronAPI()
      const state = get()
      const currentUser = state.getCurrentUser()
      if (api) {
        const result = await api.shipment.bulkCreate(input, { id: currentUser.id, name: currentUser.name })
        if (!result.success) return { success: false, error: result.error }
        await get().refreshFromDb()
        return { success: true, shipmentId: result.data.shipmentId }
      }
      // Browser fallback omitted for brevity — IPC path is primary
      return { success: false, error: "Not available in browser mode" }
    },

    addShipmentDocument: (shipmentId, doc) => {
      const state = get()
      const currentUser = state.getCurrentUser()
      const newDoc: ShipmentDocument = { id: generateId("DOC", state.shipments.flatMap((s) => s.documents ?? [])), fileName: doc.fileName, fileType: doc.fileType, fileSize: doc.fileSize, uploadDate: new Date().toISOString(), uploadedBy: currentUser.name, category: doc.category, extractedText: doc.extractedText }
      set({ shipments: state.shipments.map((s) => s.id === shipmentId ? { ...s, documents: [...(s.documents ?? []), newDoc] } : s) })
    },

    deleteShipmentDocument: (shipmentId, docId) => {
      set((state) => ({ shipments: state.shipments.map((s) => s.id === shipmentId ? { ...s, documents: (s.documents ?? []).filter((d) => d.id !== docId) } : s) }))
    },

    addShipmentTimelineEvent: (shipmentId, eventType, notes) => {
      const state = get()
      const currentUser = state.getCurrentUser()
      set({ shipments: state.shipments.map((s) => s.id === shipmentId ? { ...s, timeline: [...s.timeline, { id: `STL${pad(state.shipments.length + 1, 4)}`, timestamp: new Date().toISOString(), status: s.status, userId: currentUser.id, userName: currentUser.name, notes, eventType }] } : s) })
    },

    registerPayment: async (input) => {
      const api = getElectronAPI()
      const state = get()
      const currentUser = state.getCurrentUser()
      if (api) {
        const result = await api.payment.register(input, { id: currentUser.id, name: currentUser.name })
        if (!result.success) return { success: false, error: result.error }
        await get().refreshFromDb()
        return { success: true, newBalance: result.data.newBalance }
      }
      return { success: false, error: "The authoritative backend is required to register a payment" }
    },

    extendDueDate: async (input) => {
      const api = getElectronAPI()
      const state = get()
      const currentUser = state.getCurrentUser()
      if (api) {
        const result = await api.invoice.extendDueDate(input, { id: currentUser.id, name: currentUser.name })
        if (!result.success) return { success: false, error: result.error }
        await get().refreshFromDb()
        return { success: true }
      }
      const invoice = state.invoices.find((i) => i.id === input.invoiceId)
      if (!invoice) return { success: false, error: "Invoice not found" }
      if (invoice.voided) return { success: false, error: "Cannot extend voided invoice" }
      if (!currentUser.permissions.canExtendDueDates) return { success: false, error: "You do not have permission to extend due dates" }
      const updatedInv = { ...invoice, dueDate: input.newDueDate, status: new Date(input.newDueDate) < new Date() && invoice.balance > 0 ? "Overdue" as InvoiceStatus : invoice.status }
      set({ invoices: state.invoices.map((i) => i.id === input.invoiceId ? updatedInv : i) })
      try { await db.dbUpdateInvoice(updatedInv) } catch (e) { console.error("DB persist failed:", e) }
      return { success: true }
    },

    voidInvoice: async (invoiceId) => {
      const api = getElectronAPI()
      const state = get()
      const currentUser = state.getCurrentUser()
      if (api) {
        const result = await api.invoice.void(invoiceId, { id: currentUser.id, name: currentUser.name })
        if (!result.success) return { success: false, error: result.error }
        await get().refreshFromDb()
        return { success: true }
      }
      const invoice = state.invoices.find((i) => i.id === invoiceId)
      if (!invoice) return { success: false, error: "Invoice not found" }
      if (!currentUser.permissions.canVoidInvoices) return { success: false, error: "You do not have permission to void invoices" }
      const updatedInvoice = { ...invoice, voided: true, status: "Void" as InvoiceStatus }
      set({ invoices: state.invoices.map((i) => i.id === invoiceId ? updatedInvoice : i) })
      try { await db.dbUpdateInvoice(updatedInvoice) } catch (e) { console.error("DB persist failed:", e) }
      return { success: true }
    },

    updateInvoiceNotes: (invoiceId, notes) => {
      set((state) => ({ invoices: state.invoices.map((i) => i.id === invoiceId ? { ...i, notes } : i) }))
    },

    addCustomer: async (customer) => {
      const newCustomer: Customer = { ...customer, id: generateId("CUST", get().customers), dateAdded: new Date().toISOString().split("T")[0] }
      set((state) => ({ customers: [newCustomer, ...state.customers] }))
      const api = getElectronAPI()
      if (api) {
        const result = await api.customer.insert(newCustomer)
        if (!result.success) {
          set((state) => ({ customers: state.customers.filter((c) => c.id !== newCustomer.id) }))
          return { success: false, error: result.error }
        }
      } else {
        try { await db.dbInsertCustomer(newCustomer) } catch (e) {
          set((state) => ({ customers: state.customers.filter((c) => c.id !== newCustomer.id) }))
          return { success: false, error: String(e) }
        }
      }
      return { success: true, customer: newCustomer }
    },

    addSupplier: async (supplier) => {
      const newSupplier: Supplier = { ...supplier, id: generateId("SUP", get().suppliers), dateAdded: new Date().toISOString().split("T")[0] }
      set((state) => ({ suppliers: [newSupplier, ...state.suppliers] }))
      const api = getElectronAPI()
      if (api) {
        const result = await api.supplier.insert(newSupplier)
        if (!result.success) {
          set((state) => ({ suppliers: state.suppliers.filter((s) => s.id !== newSupplier.id) }))
          return { success: false, error: result.error }
        }
      } else {
        try { await db.dbInsertSupplier(newSupplier) } catch (e) {
          set((state) => ({ suppliers: state.suppliers.filter((s) => s.id !== newSupplier.id) }))
          return { success: false, error: String(e) }
        }
      }
      return { success: true, supplier: newSupplier }
    },

    deleteCustomer: async (customerId) => {
      const state = get()
      if (state.invoices.some((i) => i.customerId === customerId && !i.voided)) return { success: false, error: "Cannot delete customer with active invoices" }
      set({ customers: state.customers.filter((c) => c.id !== customerId) })
      const api = getElectronAPI()
      if (api) { const result = await api.customer.delete(customerId); if (!result.success) return { success: false, error: result.error } }
      else { try { await db.dbDeleteCustomer(customerId) } catch (e) { console.error("DB persist failed:", e) } }
      return { success: true }
    },

    updateAccessory: (id, updates) => {
      set((state) => ({ accessories: state.accessories.map((a) => a.id === id ? { ...a, ...updates } : a) }))
    },

    updateAmmunition: (id, updates) => {
      set((state) => ({ ammunition: state.ammunition.map((a) => a.id === id ? { ...a, ...updates } : a) }))
    },

    addAccessory: async (accessory) => {
      const newAccessory: Accessory = {
        ...accessory,
        id: generateId("ACC", get().accessories),
        dateAdded: new Date().toISOString().split("T")[0],
      }

      const api = getElectronAPI()
      if (api) {
        const result = await api.accessory.insert(newAccessory)
        if (!result.success) return { success: false, error: result.error }
        await get().refreshFromDb()
        return { success: true }
      }

      return { success: false, error: "The authoritative backend is required to create priced inventory" }
    },

    addAmmunition: async (ammo) => {
      const newAmmo: Ammunition = {
        ...ammo,
        id: generateId("AMM", get().ammunition),
        dateAdded: new Date().toISOString().split("T")[0],
      }

      const api = getElectronAPI()
      if (api) {
        const result = await api.ammunition.insert(newAmmo)
        if (!result.success) return { success: false, error: result.error }
        await get().refreshFromDb()
        return { success: true }
      }

      return { success: false, error: "The authoritative backend is required to create priced inventory" }
    },

    addStock: async (input) => {
      const api = getElectronAPI()
      const state = get()
      const currentUser = state.getCurrentUser()
      if (api) {
        const result = await api.inventory.addStock(input, { id: currentUser.id, name: currentUser.name })
        if (!result.success) return { success: false, error: result.error }
        await get().refreshFromDb()
        return { success: true }
      }
      return { success: false, error: "The authoritative backend is required for inventory changes" }
    },

    receiveAmmoByPackages: async (input) => {
      const api = getElectronAPI()
      const state = get()
      const currentUser = state.getCurrentUser()
      if (api) {
        const result = await api.inventory.receiveAmmoByPackages(input, { id: currentUser.id, name: currentUser.name })
        if (!result.success) return { success: false, error: result.error }
        await get().refreshFromDb()
        return { success: true }
      }
      return { success: false, error: "The authoritative backend is required for ammunition receipts" }
    },

    receiveAmmoByRounds: async (input) => {
      const api = getElectronAPI()
      const state = get()
      const currentUser = state.getCurrentUser()
      if (api) {
        const result = await api.inventory.receiveAmmoByRounds(input, { id: currentUser.id, name: currentUser.name })
        if (!result.success) return { success: false, error: result.error }
        await get().refreshFromDb()
        return { success: true }
      }
      return { success: false, error: "The authoritative backend is required for ammunition receipts" }
    },

    sellAmmo: async (input) => {
      const api = getElectronAPI()
      const state = get()
      const currentUser = state.getCurrentUser()
      if (api) {
        const result = await api.inventory.sellAmmo(input, { id: currentUser.id, name: currentUser.name })
        if (!result.success) return { success: false, error: result.error }
        await get().refreshFromDb()
        return { success: true }
      }
      return { success: false, error: "The authoritative backend is required for ammunition sales" }
    },

    updateAmmoPackage: async (input) => {
      const api = getElectronAPI()
      const state = get()
      const currentUser = state.getCurrentUser()
      if (api) {
        const result = await api.inventory.updateAmmoPackage(input, { id: currentUser.id, name: currentUser.name })
        if (!result.success) return { success: false, error: result.error }
        await get().refreshFromDb()
        return { success: true }
      }
      return { success: false, error: "The authoritative backend is required for inventory changes" }
    },

    updateSettings: async (updates) => {
      const previous = get().settings
      const requested = { ...previous, ...updates }
      const api = getElectronAPI()
      if (!api) return { success: false, error: "The authoritative backend is required to update currency settings" }
      const result = await api.settings.update(requested)
      if (!result.success) {
        set({ settings: previous })
        return { success: false, error: result.error }
      }
      set({ settings: result.data as SystemSettings })
      return { success: true }
    },

    updateUserPreferences: async (updates) => {
      const state = get()
      const previous = state.userPreferences
      const current = previous ?? {
        userId: state.currentUserId,
        displayCurrency: state.settings.preferredDisplayCurrency ?? state.settings.currencyCode,
        reportViewMode: "display" as const,
      }
      const merged = { ...current, ...updates }
      set({ userPreferences: merged })
      const api = getElectronAPI()
      try {
        if (api) {
          const result = await api.userPreferences.upsert(merged)
          if (!result.success) throw new Error(result.error ?? "Failed to save user preferences")
        } else {
          await db.dbUpsertUserPreferences(merged)
        }
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
      const newUser: User = { ...user, id: generateId("U", get().users), passwordSet: false, passwordHash: "" }
      set((state) => ({ users: [...state.users, newUser] }))
      const api = getElectronAPI()
      if (api) { const result = await api.user.insert(newUser); if (!result.success) return { success: false, error: result.error } }
      else { try { await db.dbInsertUser(newUser) } catch (e) { console.error("DB persist failed:", e) } }
      return { success: true }
    },

    updateUser: async (id, updates) => {
      set((state) => ({ users: state.users.map((u) => u.id === id ? { ...u, ...updates } : u) }))
      const u = get().users.find((u) => u.id === id)
      if (u) {
        const api = getElectronAPI()
        if (api) {
          const result = await api.user.update(u)
          if (!result?.success) return { success: false, error: result?.error ?? "Failed to update user" }
        } else {
          try { await db.dbUpdateUser(u) } catch (e) {
            console.error("DB persist failed:", e)
            return { success: false, error: String(e) }
          }
        }
      }
      return { success: true }
    },

    deleteUser: async (id) => {
      set((state) => ({ users: state.users.filter((u) => u.id !== id) }))
      const api = getElectronAPI()
      if (api) { const result = await api.user.delete(id); if (!result.success) return { success: false, error: result.error } }
      else { try { await db.dbDeleteUser(id) } catch (e) { console.error("DB persist failed:", e) } }
      return { success: true }
    },

    setCurrentUser: (userId) => { set({ currentUserId: userId }) },

    markNotificationRead: async (id) => {
      set((state) => ({ notifications: state.notifications.map((n) => n.id === id ? { ...n, read: true } : n) }))
      const n = get().notifications.find((n) => n.id === id)
      if (n) {
        const api = getElectronAPI()
        if (api) {
          const result = await api.notification.update(n)
          if (!result?.success) return { success: false, error: result?.error ?? "Failed to update notification" }
        } else {
          try { await db.dbUpdateNotification(n) } catch (e) {
            console.error("DB persist failed:", e)
            return { success: false, error: String(e) }
          }
        }
      }
      return { success: true }
    },

    markAllNotificationsRead: () => { set((state) => ({ notifications: state.notifications.map((n) => ({ ...n, read: true })) })) },

    dismissNotification: (id) => { set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) })) },

    pushNotification: (type, title, message, entityId) => {
      set((state) => ({ notifications: [{ id: `NTF${pad(state.notifications.length + 1, 4)}`, type, title, message, date: new Date().toISOString().split("T")[0], read: false, entityId: entityId ?? null }, ...state.notifications] }))
    },

    refreshNotifications: () => {
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
      if (notifs.length > 0) set({ notifications: [...notifs, ...state.notifications] })
    },

    addAuditLog: (actionType, description, metadata) => {
      const state = get()
      set({ auditLogs: [{ id: `LOG${pad(state.auditLogs.length + 1, 5)}`, timestamp: new Date().toISOString(), date: new Date().toISOString().split("T")[0], userId: get().getCurrentUser().id, actionType, description, metadata: metadata || "{}" }, ...state.auditLogs] })
    },

    addSearchHistory: (query) => { set((state) => ({ searchHistory: [query, ...state.searchHistory.filter((q) => q !== query)].slice(0, 5) })) },
    togglePinSearch: (item) => { set((state) => state.pinnedSearchItems.includes(item) ? { pinnedSearchItems: state.pinnedSearchItems.filter((i) => i !== item) } : { pinnedSearchItems: [item, ...state.pinnedSearchItems].slice(0, 10) }) },

    saveFilter: async (name, entityType, filterState) => {
      const newFilter: SavedFilter = { id: `FLT${pad(get().savedFilters.length + 1, 4)}`, name, entityType, filterState }
      set((state) => ({ savedFilters: [...state.savedFilters, newFilter] }))
      const api = getElectronAPI()
      if (api) { const result = await api.savedFilter.insert(newFilter); if (!result.success) return { success: false, error: result.error } }
      else { try { await db.dbInsertSavedFilter(newFilter) } catch (e) { console.error("DB persist failed:", e) } }
      return { success: true }
    },

    deleteFilter: async (id) => {
      set((state) => ({ savedFilters: state.savedFilters.filter((f) => f.id !== id) }))
      const api = getElectronAPI()
      if (api) { const result = await api.savedFilter.delete(id); if (!result.success) return { success: false, error: result.error } }
      else { try { await db.dbDeleteSavedFilter(id) } catch (e) { console.error("DB persist failed:", e) } }
      return { success: true }
    },
  }),
)
