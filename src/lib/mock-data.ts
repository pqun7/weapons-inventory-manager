import type {
  Weapon,
  Accessory,
  Ammunition,
  Shipment,
  Invoice,
  PaymentRecord,
  Customer,
  Supplier,
  AuditLog,
  AppNotification,
  User,
  SystemSettings,
  WeaponStatus,
  WeaponCondition,
  SaleMode,
  InvoiceType,
  InvoiceStatus,
  PaymentMethod,
  WeaponMovement,
  ShipmentStatus,
  ShipmentTimelineEntry,
  SaleLineItem,
  StorageLocation,
  PackageType,
} from "./types.js"
import { ammoTotalRounds } from "./types.js"

const DEMO_SEED = 20260805
const DEMO_REFERENCE_DATE = new Date("2026-08-05T00:00:00.000Z")

function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x100000000
  }
}

let randomSource = createRandom(DEMO_SEED)

function resetRandomSource(): void {
  randomSource = createRandom(DEMO_SEED)
}

function random(): number {
  return randomSource()
}

function randInt(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(random() * arr.length)]
}

function pad(num: number, size: number): string {
  return num.toString().padStart(size, "0")
}

function dateOffset(daysAgo: number): string {
  const d = new Date(DEMO_REFERENCE_DATE)
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().split("T")[0]
}

function dateOffsetFuture(daysAhead: number): string {
  const d = new Date(DEMO_REFERENCE_DATE)
  d.setDate(d.getDate() + daysAhead)
  return d.toISOString().split("T")[0]
}

function dateTimeOffset(daysAgo: number): string {
  const d = new Date(DEMO_REFERENCE_DATE)
  d.setDate(d.getDate() - daysAgo)
  d.setHours(randInt(8, 18), randInt(0, 59), 0, 0)
  return d.toISOString()
}

// ── Seeded storage locations (must match SEED_MASTER_DATA_SQL) ──
interface StorageLocationOption {
  id: string
  location: StorageLocation
}

const STORAGE_LOCATION_OPTIONS: StorageLocationOption[] = [
  { id: "loc-1", location: { warehouse: "Main", shelf: "A", bin: "A-1" } },
  { id: "loc-2", location: { warehouse: "Main", shelf: "A", bin: "A-2" } },
  { id: "loc-3", location: { warehouse: "Main", shelf: "B", bin: "B-1" } },
  { id: "loc-4", location: { warehouse: "Secondary", shelf: "A", bin: "A-1" } },
  { id: "loc-5", location: { warehouse: "Archive", shelf: "A", bin: "A-1" } },
]

function randomStorageLocation(): StorageLocationOption {
  return pick(STORAGE_LOCATION_OPTIONS)
}

function randomLocation(): StorageLocation {
  return pick(STORAGE_LOCATION_OPTIONS).location
}

// ── Seed master-data IDs (must match SEED_MASTER_DATA_SQL) ──
const TYPE_IDS: Record<string, string> = {
  "Shotgun": "wt-1",
  "Air rifle": "wt-2",
  "Blank pistol": "wt-3",
  "Pistol": "wt-4",
  "Rifle": "wt-5",
}

const SUBTYPE_IDS: Record<string, Record<string, string>> = {
  "Shotgun": {
    "Semi-auto": "ws-1",
    "Magazine shotgun": "ws-2",
    "Folding shotgun": "ws-3",
    "Over&under": "ws-4",
    "Side by side": "ws-5",
    "Single barrel": "ws-6",
  },
  "Air rifle": { "PCP": "ws-7", "Break barrel": "ws-8" },
  "Blank pistol": { "9mm": "ws-9" },
  "Pistol": { "9x19mm": "ws-10", "7.62mm": "ws-11", "7.65mm": "ws-12", "380mm": "ws-13", ".22 LR": "ws-14" },
  "Rifle": { "223": "ws-15", "30-06": "ws-16" },
}

const CALIBER_IDS: Record<string, string> = {
  "12 GA": "cal-1", "20 GA": "cal-2", ".177": "cal-3", ".22": "cal-4", ".25": "cal-5",
  "9mm blank": "cal-6", "9x19mm": "cal-7", "7.62mm": "cal-8", "7.65mm": "cal-9",
  ".380 ACP": "cal-10", ".22 LR": "cal-11", ".223 Rem": "cal-12", "30-06": "cal-13",
}

const BRAND_IDS: Record<string, string> = {
  "Glock": "br-1", "SIG Sauer": "br-2", "Remington": "br-3", "Benelli": "br-4",
  "Colt": "br-5", "Ruger": "br-6", "Benjamin": "br-7", "Ekol": "br-8", "Hatsan": "br-9",
}

const MODEL_IDS: Record<string, string> = {
  "870": "mdl-1", "Supersport": "mdl-2", "G17": "mdl-3", "P320": "mdl-4",
  "AR-15": "mdl-5", "Hawkeye": "mdl-6", "Trail": "mdl-7", "Volga": "mdl-8", "Escort": "mdl-9",
}

const SUPPLIER_NAMES = [
  "Global Arms Distributors", "Precision Firearms Supply", "Tactical Equipment Wholesalers",
  "Liberty Munitions Co.", "Frontier Defense Logistics", "Apex Weaponry Imports",
  "Sentinel Arms Trading", "Vanguard Tactical Supply",
]

const CUSTOMER_NAMES = [
  "James Mitchell", "Sarah Connor", "Michael Reyes", "Jennifer Park", "David Thompson",
  "Emily Watson", "Robert Hayes", "Lisa Anderson", "Kevin Brooks", "Maria Gonzalez",
  "Thomas Wright", "Patricia King", "Daniel Foster", "Nancy Russell", "Christopher Diaz",
]

const WHOLESALE_NAMES = [
  { name: "Downtown Tactical Shop", discount: 12 },
  { name: "Elite Defense Retailers", discount: 15 },
  { name: "Pioneer Arms Trading", discount: 10 },
  { name: "Summit Outdoor Supply", discount: 14 },
]

// ── All weapon templates use ONLY seeded brands/models ──
const WEAPON_TYPES = [
  { type: "Shotgun", subType: "Semi-auto", caliber: "12 GA", brand: "Remington", model: "870", basePrice: 550 },
  { type: "Shotgun", subType: "Over&under", caliber: "12 GA", brand: "Benelli", model: "Supersport", basePrice: 1200 },
  { type: "Pistol", subType: "9x19mm", caliber: "9x19mm", brand: "Glock", model: "G17", basePrice: 500 },
  { type: "Pistol", subType: "9x19mm", caliber: "9x19mm", brand: "SIG Sauer", model: "P320", basePrice: 550 },
  { type: "Pistol", subType: ".22 LR", caliber: ".22 LR", brand: "Ruger", model: "Hawkeye", basePrice: 400 },
  { type: "Rifle", subType: "223", caliber: ".223 Rem", brand: "Colt", model: "AR-15", basePrice: 1100 },
  { type: "Rifle", subType: "30-06", caliber: "30-06", brand: "Ruger", model: "Hawkeye", basePrice: 850 },
  { type: "Air rifle", subType: "PCP", caliber: ".22", brand: "Benjamin", model: "Trail", basePrice: 300 },
  { type: "Blank pistol", subType: "9mm", caliber: "9mm blank", brand: "Ekol", model: "Volga", basePrice: 180 },
  { type: "Shotgun", subType: "Single barrel", caliber: "20 GA", brand: "Hatsan", model: "Escort", basePrice: 350 },
]

function generateSuppliers(): Supplier[] {
  return SUPPLIER_NAMES.map((name, i) => ({
    id: `SUP${pad(i + 1, 3)}`, name,
    contactPerson: `${pick(["John", "Robert", "Carol", "Mark", "Diana"])} ${pick(["Adams", "Lee", "Baker", "Carter"])}`,
    phone: `555-0${pad(randInt(100, 999), 3)}`,
    email: `sales@${name.toLowerCase().replace(/[^a-z]/g, "")}.com`,
    address: `${randInt(100, 9999)} ${pick(["Industrial", "Commerce", "Logistics"])} ${pick(["Blvd", "Way", "Ave"])}, ${pick(["Houston, TX", "Phoenix, AZ", "Denver, CO"])}`,
    dateAdded: dateOffset(randInt(200, 700)),
  }))
}

function generateCustomers(): Customer[] {
  const retail = CUSTOMER_NAMES.map((name, i) => ({
    id: `CUST${pad(i + 1, 4)}`, name,
    phone: `555-1${pad(randInt(100, 999), 3)}`,
    email: `${name.toLowerCase().replace(/[^a-z]/g, "")}@email.com`,
    address: `${randInt(100, 9999)} ${pick(["Maple", "Oak", "Cedar"])} ${pick(["St", "Ave", "Ln"])}, ${pick(["Austin, TX", "Portland, OR"])}`,
    isWholesaleBuyer: false, wholesaleDiscountPercent: 0,
    dateAdded: dateOffset(randInt(100, 500)),
  }))
  const wholesale = WHOLESALE_NAMES.map((b, i) => ({
    id: `WB${pad(i + 1, 3)}`, name: b.name,
    phone: `555-2${pad(randInt(100, 999), 3)}`,
    email: `purchasing@${b.name.toLowerCase().replace(/[^a-z]/g, "")}.com`,
    address: `${randInt(100, 9999)} ${pick(["Business", "Corporate", "Trade"])} ${pick(["Park", "Center", "Plaza"])}, ${pick(["Dallas, TX", "Chicago, IL"])}`,
    isWholesaleBuyer: true, wholesaleDiscountPercent: b.discount,
    dateAdded: dateOffset(randInt(150, 600)),
  }))
  return [...retail, ...wholesale]
}

function generateShipments(suppliers: Supplier[]): Shipment[] {
  const shipments: Shipment[] = []
  for (let i = 0; i < 12; i++) {
    const supplier = pick(suppliers)
    const expected = randInt(3, 15)
    const daysAgo = randInt(5, 120)
    const arrivalOffset = randInt(-20, 30)
    const expectedArrivalDate = arrivalOffset >= 0 ? dateOffsetFuture(arrivalOffset) : dateOffset(Math.abs(arrivalOffset))
    const statusRoll = random()
    let status: ShipmentStatus
    if (statusRoll < 0.35) status = "Arrived"
    else if (statusRoll < 0.55) status = "In Transit"
    else if (statusRoll < 0.70) status = "Pending"
    else if (statusRoll < 0.82) status = "Partial"
    else if (statusRoll < 0.92 && expectedArrivalDate < dateOffset(0)) status = "Delayed"
    else status = "Cancelled"

    const timeline: ShipmentTimelineEntry[] = [{
      id: `STL${pad(i + 1, 4)}`, timestamp: dateTimeOffset(daysAgo),
      status: "Pending", userId: "U001", userName: "Admin User", notes: "Shipment created",
    }]
    if (status === "In Transit" || status === "Arrived" || status === "Delayed" || status === "Partial") {
      timeline.push({ id: `STL${pad(i + 2, 4)}`, timestamp: dateTimeOffset(daysAgo - 2), status: "In Transit", userId: "U001", userName: "Admin User", notes: "Shipment in transit" })
    }
    if (status === "Arrived") {
      timeline.push({ id: `STL${pad(i + 3, 4)}`, timestamp: dateTimeOffset(Math.max(0, daysAgo - 5)), status: "Arrived", userId: "U001", userName: "Admin User", notes: "Shipment arrived" })
    }
    if (status === "Delayed") {
      timeline.push({ id: `STL${pad(i + 3, 4)}`, timestamp: dateTimeOffset(0), status: "Delayed", userId: "SYSTEM", userName: "System", notes: "Auto-flagged as delayed" })
    }

    shipments.push({
      id: `SHP${pad(i + 1, 4)}`,
      shipmentNumber: `SHP-${new Date(dateOffset(daysAgo)).getFullYear()}${pad(i + 1, 4)}`,
      supplierId: supplier.id,
      shipmentDate: dateOffset(daysAgo),
      expectedArrivalDate,
      totalExpectedItems: expected,
      attachments: [],
      notes: status === "Arrived" ? "All items received and registered" : status === "Delayed" ? "Awaiting delivery — past expected date" : "Awaiting remaining inventory",
      status,
      timeline,
    })
  }
  return shipments.sort((a, b) => b.shipmentDate.localeCompare(a.shipmentDate))
}

function generateWeapons(suppliers: Supplier[], shipments: Shipment[]): Weapon[] {
  const weapons: Weapon[] = []
  let serialIndex = 1
  const statuses: WeaponStatus[] = ["Available", "Sold", "Reserved", "Returned"]
  const weights = [0.48, 0.32, 0.08, 0.12]
  const conditions: WeaponCondition[] = ["Excellent", "Good", "Good", "Good", "Fair", "Poor"]
  const arrivedShipments = shipments.filter((s) => s.status === "Arrived")
  const partialShipments = shipments.filter((s) => s.status === "Partial" || s.status === "Delayed" || s.status === "In Transit")

  for (let i = 0; i < 140; i++) {
    const wt = pick(WEAPON_TYPES)
    const purchasePrice = wt.basePrice + randInt(-50, 100)
    const retailPrice = Math.round((purchasePrice * 1.4) / 5) * 5
    const wholesalePrice = Math.round((purchasePrice * 1.18) / 5) * 5
    const supplier = pick(suppliers)

    let status: WeaponStatus = "Available"
    const roll = random()
    let cum = 0
    for (let s = 0; s < statuses.length; s++) { cum += weights[s]; if (roll < cum) { status = statuses[s]; break } }

    let shipmentId: string | null = null
    if (status !== "Available" || random() > 0.3) {
      const pool = random() > 0.5 ? arrivedShipments : [...arrivedShipments, ...partialShipments]
      if (pool.length > 0) shipmentId = pick(pool).id
    }

    const movementHistory: WeaponMovement[] = [{
      id: `MV${pad(serialIndex, 5)}`, timestamp: dateTimeOffset(randInt(1, 400)),
      fromStatus: "Available", toStatus: status, userId: "U001", userName: "Admin User",
      reason: status === "Available" ? "Initial intake" : `Status set to ${status}`,
    }]

    // ── Pick a consistent storage location (ID + display object) ──
    const sl = randomStorageLocation()

    weapons.push({
      id: `W${pad(serialIndex, 5)}`,
      serialNumber: `${wt.brand.substring(0, 3).toUpperCase()}${new Date().getFullYear()}${pad(serialIndex, 5)}`,
      // FK IDs from seed master data
      weaponTypeId: TYPE_IDS[wt.type],
      weaponSubtypeId: SUBTYPE_IDS[wt.type]?.[wt.subType] ?? "",
      caliberId: CALIBER_IDS[wt.caliber] ?? "",
      brandId: BRAND_IDS[wt.brand] ?? "",
      modelId: MODEL_IDS[wt.model] ?? "",
      storageLocationId: sl.id,
      // Display labels
      weaponType: wt.type,
      subType: wt.subType,
      caliber: wt.caliber,
      brand: wt.brand,
      model: wt.model,
      location: sl.location,
      condition: pick(conditions), status,
      purchasePrice, retailPrice, wholesalePrice,
      actualFinalPrice: status === "Sold" ? Math.round((retailPrice * (1 - random() * 0.1)) / 5) * 5 : null,
      supplierId: supplier.id, shipmentId, dateAdded: dateOffset(randInt(1, 400)),
      notes: random() > 0.8 ? "Minor surface wear on grip" : "",
      images: [`/images/weapons/${wt.brand.toLowerCase()}_${wt.model.toLowerCase()}.jpg`],
      movementHistory,
    })
    serialIndex++
  }
  return weapons
}

function generateAccessories(): Accessory[] {
  const types = [
    { name: "Pistol Case", type: "Pistol case", price: 25, qty: 45 },
    { name: "Shotgun Case", type: "Shotgun case", price: 35, qty: 8 },
    { name: "Cleaning Kit Universal", type: "Cleaning kit", price: 22, qty: 60 },
    { name: "Gun Oil 100ml", type: "Cleaning-oil", price: 12, qty: 5 },
    { name: "Pistol Grip Rubber", type: "Pistol grip", price: 18, qty: 30 },
    { name: "Sling Adapter", type: "Others", price: 15, qty: 3 },
  ]
  return types.map((t, i) => ({
    id: `ACC${pad(i + 1, 3)}`, name: t.name, type: t.type,
    quantity: t.qty, safetyThreshold: 10, price: t.price,
    dateAdded: dateOffset(randInt(30, 300)), location: randomLocation(),
  }))
}

function generateAmmunition(): Ammunition[] {
  const calibers = [
    { caliber: "9x19", price: 0.35, pkgType: "Carton" as PackageType, unitsPerPkg: 50, packages: 100, loose: 35 },
    { caliber: "9 mm rubber", price: 0.5, pkgType: "Box" as PackageType, unitsPerPkg: 25, packages: 8, loose: 0 },
    { caliber: "9 mm blank", price: 0.3, pkgType: "Carton" as PackageType, unitsPerPkg: 100, packages: 8, loose: 0 },
    { caliber: "Cal 12 shotgun cartridges", price: 0.6, pkgType: "Box" as PackageType, unitsPerPkg: 25, packages: 6, loose: 0 },
    { caliber: "7.62", price: 0.45, pkgType: "Carton" as PackageType, unitsPerPkg: 20, packages: 150, loose: 10 },
    { caliber: "7.65", price: 0.4, pkgType: "Box" as PackageType, unitsPerPkg: 50, packages: 1, loose: 30 },
    { caliber: "223", price: 0.55, pkgType: "Case" as PackageType, unitsPerPkg: 250, packages: 2, loose: 0 },
  ]
  return calibers.map((c, i) => ({
    id: `AMM${pad(i + 1, 3)}`, caliber: c.caliber,
    packageType: c.pkgType, unitsPerPackage: c.unitsPerPkg,
    fullPackages: c.packages, looseRounds: c.loose,
    safetyThreshold: 200, price: c.price,
    dateAdded: dateOffset(randInt(30, 300)), location: randomLocation(),
  }))
}

function generateInvoices(weapons: Weapon[], customers: Customer[], suppliers: Supplier[]): { invoices: Invoice[]; payments: PaymentRecord[] } {
  const invoices: Invoice[] = []
  const payments: PaymentRecord[] = []
  let invCounter = 1
  let payCounter = 1

  const soldWeapons = weapons.filter((w) => w.status === "Sold" || w.status === "Returned")

  soldWeapons.forEach((w) => {
    const isWholesale = random() > 0.6
    const buyer = isWholesale ? pick(customers.filter((c) => c.isWholesaleBuyer)) : pick(customers.filter((c) => !c.isWholesaleBuyer))
    if (!buyer) return
    const mode: SaleMode = buyer.isWholesaleBuyer ? "Wholesale" : "Retail"
    const basePrice = mode === "Wholesale" ? w.wholesalePrice : w.retailPrice
    const negotiated = Math.round((basePrice * (1 - random() * 0.08)) / 5) * 5
    const daysAgo = randInt(1, 350)
    const date = dateOffset(daysAgo)
    const dueDate = dateOffset(daysAgo - 30)
    const paidAmount = random() > 0.35 ? negotiated : random() > 0.5 ? Math.round((negotiated * 0.5) / 5) * 5 : 0
    const balance = negotiated - paidAmount
    let status: InvoiceStatus
    if (balance <= 0) status = "Paid"
    else if (new Date(dueDate) < new Date()) status = "Overdue"
    else status = "Pending"

    const invoiceId = `INV${pad(invCounter, 5)}`
    const invoiceNumber = `INV-${date.replace(/-/g, "")}-${pad(invCounter, 4)}`
    const lineItems: SaleLineItem[] = [{
      itemType: "weapon", itemId: w.id, name: `${w.brand} ${w.model}`,
      quantity: 1, unitPrice: negotiated, total: negotiated,
    }]

    invoices.push({
      id: invoiceId, invoiceNumber, type: "Sale" as InvoiceType,
      customerId: buyer.id, supplierId: null, customerName: buyer.name,
      date, dueDate, totalOriginal: basePrice, totalNegotiated: negotiated,
      totalPaid: paidAmount, balance, status,
      weaponIds: [w.id], lineItems, saleMode: mode,
      employeeId: "U001", employeeName: "Admin User",
      attachments: [], shipmentId: null, notes: "", voided: false, taxAmount: 0,
    })
    if (paidAmount > 0) {
      payments.push({
        id: `PAY${pad(payCounter, 5)}`, invoiceId, invoiceNumber,
        date, amount: paidAmount, method: pick(["cash", "card", "bank_transfer"] as PaymentMethod[]),
        employee: "Admin User", notes: paidAmount >= negotiated ? "Full payment" : "Partial payment",
      })
      payCounter++
    }
    invCounter++
  })

  suppliers.slice(0, 5).forEach((s, i) => {
    const daysAgo = randInt(10, 200)
    const date = dateOffset(daysAgo)
    const dueDate = dateOffset(daysAgo - 45)
    const total = randInt(2000, 8000)
    const paid = random() > 0.3 ? total : Math.round(total * 0.6)
    const balance = total - paid
    const status: InvoiceStatus = balance <= 0 ? "Paid" : new Date(dueDate) < new Date() ? "Overdue" : "Pending"
    const invoiceId = `INV${pad(invCounter, 5)}`
    invoices.push({
      id: invoiceId, invoiceNumber: `PUR-${date.replace(/-/g, "")}-${pad(i + 1, 4)}`,
      type: "Purchase" as InvoiceType, customerId: null, supplierId: s.id, customerName: s.name,
      date, dueDate, totalOriginal: total, totalNegotiated: total, totalPaid: paid, balance, status,
      weaponIds: [], lineItems: [], saleMode: "Wholesale" as SaleMode,
      employeeId: "U001", employeeName: "Admin User", attachments: [], shipmentId: null,
      notes: "Supplier purchase order", voided: false, taxAmount: 0,
    })
    if (paid > 0) {
      payments.push({
        id: `PAY${pad(payCounter, 5)}`, invoiceId, invoiceNumber: `PUR-${date.replace(/-/g, "")}-${pad(i + 1, 4)}`,
        date, amount: paid, method: pick(["bank_transfer", "check"] as PaymentMethod[]),
        employee: "Admin User", notes: "Supplier payment",
      })
      payCounter++
    }
    invCounter++
  })

  return {
    invoices: invoices.sort((a, b) => b.date.localeCompare(a.date)),
    payments: payments.sort((a, b) => b.date.localeCompare(a.date)),
  }
}

function generateAuditLogs(invoices: Invoice[]): AuditLog[] {
  const logs: AuditLog[] = []
  let id = 1
  logs.push({ id: `LOG${pad(id++, 5)}`, timestamp: dateTimeOffset(0), date: dateOffset(0), userId: "U001", actionType: "Login", description: "Admin User logged into the system", metadata: "{}" })
  invoices.slice(0, 30).forEach((inv) => {
    logs.push({ id: `LOG${pad(id++, 5)}`, timestamp: dateTimeOffset(randInt(1, 350)), date: inv.date, userId: "U001", actionType: "Sale", description: `Invoice ${inv.invoiceNumber} created — ${inv.customerName} — ${inv.totalNegotiated}`, metadata: JSON.stringify({ invoiceId: inv.id, amount: inv.totalNegotiated }) })
    if (inv.status === "Overdue") {
      logs.push({ id: `LOG${pad(id++, 5)}`, timestamp: dateTimeOffset(1), date: dateOffset(1), userId: "SYSTEM", actionType: "DebtWarning", description: `Debt Overdue for ${inv.customerName} - Invoice: ${inv.invoiceNumber}`, metadata: JSON.stringify({ invoiceId: inv.id, balance: inv.balance }) })
    }
  })
  return logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

function generateNotifications(invoices: Invoice[], accessories: Accessory[], ammunition: Ammunition[]): AppNotification[] {
  const notifs: AppNotification[] = []
  let id = 1
  invoices.filter((i) => i.status === "Overdue").forEach((inv) => {
    notifs.push({ id: `NTF${pad(id++, 4)}`, type: "OverdueDebt", title: "Overdue Debt Alert", message: `${inv.customerName} — Invoice ${inv.invoiceNumber} is overdue (Balance: $${inv.balance})`, date: dateOffset(0), read: false, entityId: inv.id })
  })
  accessories.filter((a) => a.quantity < a.safetyThreshold).forEach((a) => {
    notifs.push({ id: `NTF${pad(id++, 4)}`, type: "LowStock", title: "Low Stock: Accessory", message: `${a.name} is below safety threshold (${a.quantity}/${a.safetyThreshold})`, date: dateOffset(0), read: false, entityId: a.id })
  })
  ammunition.filter((a) => ammoTotalRounds(a) < a.safetyThreshold).forEach((a) => {
    notifs.push({ id: `NTF${pad(id++, 4)}`, type: "LowStock", title: "Low Stock: Ammunition", message: `${a.caliber} is below safety threshold (${ammoTotalRounds(a)}/${a.safetyThreshold})`, date: dateOffset(0), read: false, entityId: a.id })
  })
  notifs.push({ id: `NTF${pad(id++, 4)}`, type: "BackupOmission", title: "Backup Reminder", message: "No backup snapshot has been created in the last 7 days", date: dateOffset(1), read: false, entityId: null })
  return notifs
}

const DEFAULT_USERS: User[] = [
  { id: "U001", username: "admin", name: "Admin User", role: "Admin", permissions: { canImportExcel: true, canExportData: true, canViewReports: true, canManageUsers: true, canRegisterPayments: true, canVoidInvoices: true, canExtendDueDates: true, canDeleteRecords: true }, passwordSet: true, passwordHash: "admin123" },
  { id: "U002", username: "sarah", name: "Sarah Chen", role: "Manager", permissions: { canImportExcel: true, canExportData: true, canViewReports: true, canManageUsers: false, canRegisterPayments: true, canVoidInvoices: true, canExtendDueDates: true, canDeleteRecords: false }, passwordSet: true, passwordHash: "sarah123" },
]

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
}

export function generateMockData() {
  resetRandomSource()
  const suppliers = generateSuppliers()
  const customers = generateCustomers()
  const shipments = generateShipments(suppliers)
  const weapons = generateWeapons(suppliers, shipments)
  const accessories = generateAccessories()
  const ammunition = generateAmmunition()
  const { invoices, payments } = generateInvoices(weapons, customers, suppliers)
  const auditLogs = generateAuditLogs(invoices)
  const notifications = generateNotifications(invoices, accessories, ammunition)
  return {
    weapons, accessories, ammunition, shipments, invoices, payments,
    customers, suppliers, auditLogs, notifications,
    users: DEFAULT_USERS, settings: DEFAULT_SETTINGS, currentUserId: "U001",
  }
}
