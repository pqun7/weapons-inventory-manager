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
  SavedFilter,
  StorageLocation,
  WeaponMovement,
  ShipmentTimelineEntry,
  ShipmentLineItem,
  ShipmentDocument,
  SaleLineItem,
  MoneyValuation,
  UserPermissions,
  PackageType,
  UserPreferences,
} from "../types.js"

export interface DbResult<T> {
  data: T | null
  error: string | null
}

export interface AllData {
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
  savedFilters: SavedFilter[]
}

export interface MasterDataAll {
  weaponTypes: { id: string; label: string; sort_order: number }[]
  weaponSubtypes: { id: string; weapon_type_id: string; label: string; sort_order: number }[]
  calibers: { id: string; label: string }[]
  subtypeCalibers: { subtype_id: string; caliber_id: string }[]
  brands: { id: string; label: string }[]
  models: { id: string; label: string; brand_id: string | null }[]
  warehouses: { id: string; label: string }[]
  storageLocations: { id: string; warehouse_id: string; shelf: string; bin: string }[]
}

export interface CurrencyRow {
  iso_code: string
  name: string
  symbol: string
  decimal_precision: number
  is_active: number | boolean
  last_known_rate: string | number
  last_rate_updated_at: string | null
}

export interface ExchangeRateOverrideRow {
  currency_code: string
  mode: "automatic" | "manual"
  manual_rate: number | null
  updated_by: string | null
  updated_at: string
  reason: string | null
}

export interface AuditLogEntry {
  id: string
  currencyCode: string
  oldRate: number | null
  newRate: number | null
  changedBy: string | null
  changedAt: string
  reason: string | null
  source?: "manual" | "api" | "cache" | "default"
}

// Explicit PostgreSQL row shapes returned by the typed Supabase queries.
interface WeaponRow {
  id: string
  serial_number: string
  // new FK columns (present in the weapons table)
  weapon_type_id: string
  weapon_subtype_id: string
  caliber_id: string
  brand_id: string
  model_id: string
  storage_location_id: string | null
  supplier_id: string
  shipment_id: string | null
  date_added: string
  batch_id: string | null
  notes: string
  images: unknown
  movement_history: unknown
  condition: string
  status: string
  purchase_price: number
  retail_price: number
  wholesale_price: number
  actual_final_price: number | null
  purchase_price_valuation: unknown
  retail_price_valuation: unknown
  wholesale_price_valuation: unknown
  actual_final_price_valuation: unknown
  sale_price_valuation: unknown
  deleted_at: string | null
  // aliased labels from the LEFT JOIN (still snake_case as they appear in the query)
  weapon_type: string
  sub_type: string
  caliber: string
  brand: string
  model: string
  warehouse: string
  shelf: string
  bin: string
}

interface ShipmentRow {
  id: string
  shipment_number: string
  supplier_id: string
  shipment_date: string
  expected_arrival_date: string
  total_expected_items: number
  attachments: unknown
  notes: string
  status: string
  timeline: unknown
  purchase_order_number: string | null
  invoice_number: string | null
  shipping_carrier: string | null
  container_number: string | null
  currency: string | null
  purchase_date: string | null
  actual_arrival_date: string | null
  line_items: unknown
  documents: unknown
  total_cost_valuation: unknown
  workflow_status?: Shipment["workflowStatus"] | null
  import_id?: string | null
  arrival_note?: string | null
  delay_reason?: string | null
  last_arrival_prompt_at?: string | null
}

interface InvoiceRow {
  id: string
  invoice_number: string
  type: string
  customer_id: string | null
  supplier_id: string | null
  customer_name: string
  date: string
  due_date: string
  total_original: number
  total_negotiated: number
  total_paid: number
  balance: number
  status: string
  weapon_ids: unknown
  line_items: unknown
  sale_mode: string
  employee_id: string
  employee_name: string
  attachments: unknown
  shipment_id: string | null
  notes: string
  voided: number | boolean
  tax_amount: number
  total_valuation: unknown
  currency: string | null
  accounting_currency: string | null
  exchange_rate: string | number | null
  exchange_rate_date: string | null
  rate_source: string | null
  total_original_accounting: string | number | null
  total_negotiated_accounting: string | number | null
  total_paid_accounting: string | number | null
  balance_accounting: string | number | null
  tax_amount_accounting: string | number | null
}

interface PaymentRow {
  id: string
  invoice_id: string
  invoice_number: string
  date: string
  amount: number
  currency: string | null
  accounting_amount: string | number | null
  accounting_currency: string | null
  exchange_rate: string | number | null
  exchange_rate_date: string | null
  rate_source: string | null
  rate_id: string | null
  method: string
  employee: string
  notes: string
}

interface AccessoryRow {
  id: string
  name: string
  type: string
  quantity: number
  safety_threshold: number
  price: number
  price_currency: string | null
  price_valuation: unknown
  date_added: string
  warehouse: string
  shelf: string
  bin: string
}

interface AmmoRow {
  id: string
  name?: string
  caliber: string
  package_type: string
  units_per_package: number
  full_packages: number
  loose_rounds: number
  safety_threshold: number
  price: number
  price_currency: string | null
  price_valuation: unknown
  date_added: string
  warehouse: string
  shelf: string
  bin: string
}

interface CustomerRow {
  id: string
  name: string
  phone: string
  email: string
  address: string
  is_wholesale_buyer: number | boolean
  wholesale_discount_percent: number
  date_added: string
}

interface SupplierRow {
  id: string
  name: string
  contact_person: string
  phone: string
  email: string
  address: string
  date_added: string
}

interface AuditRow {
  id: string
  timestamp: string
  date: string
  user_id: string
  action_type: string
  description: string
  metadata: unknown
}

interface NotificationRow {
  id: string
  type: string
  title: string
  message: string
  date: string
  is_read: number | boolean
  entity_id: string | null
}

interface UserRow {
  id: string
  username: string
  name: string
  role: string
  permissions: unknown
  password_set: number | boolean
  password_hash?: string
}

interface SettingsRow {
  id: number
  currency_symbol: string
  currency_code: string
  accounting_currency_code: string
  rate_base_currency_code: string
  supported_currencies: unknown
  currency_frequency: unknown
  tax_percent: number
  invoice_header: string
  invoice_footer: string
  store_logo: string
  thermal_printer_width: number
  label_format: string
  hourly_snapshot: number | boolean
  daily_closing_prompt: number | boolean
  weekly_verification: number | boolean
  min_profit_margin_percent: number
  theme: string | null
  preferred_display_currency: string | null
  show_demo_data: number
  app_language: string
  date_format: string
  number_format: string
  company_name: string
  company_address: string
  company_phone: string
  company_email: string
  company_tax_id: string
}

interface UserPreferencesRow {
  user_id: string
  display_currency: string | null
  report_view_mode: string
  language: string | null
  date_format: string | null
}

interface SavedFilterRow {
  id: string
  name: string
  entity_type: string
  filter_state: unknown
}

function parseJSON<T>(value: unknown, fallback: T): T {
  if (value == null || value === "") return fallback
  if (typeof value !== "string") return value as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function parseValuation(value: unknown): MoneyValuation | undefined {
  if (!value) return undefined
  const parsed = parseJSON<Partial<MoneyValuation>>(value, {})
  if (!parsed.originalCurrency || parsed.originalAmount == null || parsed.exchangeRate == null || !parsed.exchangeRateDate) {
    return undefined
  }
  const accountingCurrency = parsed.accountingCurrency ?? (parsed.accountingAmountUSD != null ? "USD" : undefined)
  const accountingAmount = parsed.accountingAmount ?? parsed.accountingAmountUSD
  const validSources = new Set<MoneyValuation["rateSource"]>(["manual", "api", "cache", "default"])
  if (!accountingCurrency || accountingAmount == null || !parsed.rateSource || !validSources.has(parsed.rateSource)) return undefined
  const originalAmount = Number(parsed.originalAmount)
  const normalizedAccountingAmount = Number(accountingAmount)
  const exchangeRate = Number(parsed.exchangeRate)
  if (![originalAmount, normalizedAccountingAmount, exchangeRate].every(Number.isFinite) || originalAmount < 0 || normalizedAccountingAmount < 0 || exchangeRate <= 0) {
    return undefined
  }
  return {
    originalAmount,
    originalCurrency: parsed.originalCurrency,
    accountingAmount: normalizedAccountingAmount,
    accountingCurrency,
    accountingAmountUSD: accountingCurrency === "USD" ? Number(accountingAmount) : undefined,
    exchangeRate,
    exchangeRateDate: parsed.exchangeRateDate,
    rateSource: parsed.rateSource,
    rateId: parsed.rateId,
  }
}

function parseLocation(warehouse: string, shelf: string, bin: string): StorageLocation {
  return { warehouse, shelf, bin }
}

function locationToCols(loc: StorageLocation) {
  return { warehouse: loc.warehouse, shelf: loc.shelf, bin: loc.bin }
}

function rowToWeapon(r: WeaponRow): Weapon {
  return {
    id: r.id,
    serialNumber: r.serial_number,
    // labels from join
    weaponType: r.weapon_type,
    subType: r.sub_type,
    caliber: r.caliber,
    brand: r.brand,
    model: r.model,
    // Foreign keys
    weaponTypeId: r.weapon_type_id,
    weaponSubtypeId: r.weapon_subtype_id,
    caliberId: r.caliber_id,
    brandId: r.brand_id,
    modelId: r.model_id,
    storageLocationId: r.storage_location_id,
    // Keep location for backward compatibility (built from joined columns)
    location: parseLocation(r.warehouse, r.shelf, r.bin),
    condition: r.condition as Weapon["condition"],
    status: r.status as Weapon["status"],
    purchasePrice: r.purchase_price,
    retailPrice: r.retail_price,
    wholesalePrice: r.wholesale_price,
    actualFinalPrice: r.actual_final_price,
    supplierId: r.supplier_id,
    shipmentId: r.shipment_id,
    dateAdded: r.date_added,
    batchId: r.batch_id ?? undefined,
    notes: r.notes,
    images: parseJSON(r.images, []),
    movementHistory: parseJSON(r.movement_history, []),
    purchasePriceValuation: parseValuation(r.purchase_price_valuation),
    retailPriceValuation: parseValuation(r.retail_price_valuation),
    wholesalePriceValuation: parseValuation(r.wholesale_price_valuation),
    actualFinalPriceValuation: parseValuation(r.actual_final_price_valuation),
    salePriceValuation: parseValuation(r.sale_price_valuation),
  }
}

function weaponToRow(w: Weapon): Record<string, unknown> {
  return {
    id: w.id,
    serial_number: w.serialNumber,
    // Only the FK columns – no text labels
    weapon_type_id: w.weaponTypeId,
    weapon_subtype_id: w.weaponSubtypeId,
    caliber_id: w.caliberId,
    brand_id: w.brandId,
    model_id: w.modelId,
    storage_location_id: w.storageLocationId,
    supplier_id: w.supplierId,
    shipment_id: w.shipmentId,
    condition: w.condition,
    status: w.status,
    purchase_price: w.purchasePrice,
    retail_price: w.retailPrice,
    wholesale_price: w.wholesalePrice,
    actual_final_price: w.actualFinalPrice,
    date_added: w.dateAdded,
    batch_id: w.batchId ?? null,
    notes: w.notes,
    images: w.images,
    movement_history: w.movementHistory,
    purchase_price_valuation: w.purchasePriceValuation ?? null,
    retail_price_valuation: w.retailPriceValuation ?? null,
    wholesale_price_valuation: w.wholesalePriceValuation ?? null,
    actual_final_price_valuation: w.actualFinalPriceValuation ?? null,
    sale_price_valuation: w.salePriceValuation ?? null,
    deleted_at: null,
  }
}

function rowToShipment(r: ShipmentRow): Shipment {
  return {
    id: r.id,
    shipmentNumber: r.shipment_number,
    supplierId: r.supplier_id,
    shipmentDate: r.shipment_date,
    expectedArrivalDate: r.expected_arrival_date,
    totalExpectedItems: r.total_expected_items,
    attachments: parseJSON(r.attachments, []),
    notes: r.notes,
    status: r.status as Shipment["status"],
    timeline: parseJSON(r.timeline, []),
    purchaseOrderNumber: r.purchase_order_number ?? undefined,
    invoiceNumber: r.invoice_number ?? undefined,
    shippingCarrier: r.shipping_carrier ?? undefined,
    containerNumber: r.container_number ?? undefined,
    currency: r.currency ?? undefined,
    purchaseDate: r.purchase_date ?? undefined,
    actualArrivalDate: r.actual_arrival_date ?? undefined,
    lineItems: parseJSON(r.line_items, []),
    documents: parseJSON(r.documents, []),
    totalCostValuation: parseValuation(r.total_cost_valuation),
    workflowStatus: r.workflow_status ?? undefined,
    importId: r.import_id ?? undefined,
    arrivalNote: r.arrival_note ?? undefined,
    delayReason: r.delay_reason ?? undefined,
    lastArrivalPromptAt: r.last_arrival_prompt_at ?? undefined,
  }
}

function shipmentToRow(s: Shipment): Record<string, unknown> {
  return {
    id: s.id,
    shipment_number: s.shipmentNumber,
    supplier_id: s.supplierId,
    shipment_date: s.shipmentDate,
    expected_arrival_date: s.expectedArrivalDate,
    total_expected_items: s.totalExpectedItems,
    attachments: s.attachments,
    notes: s.notes,
    status: s.status,
    timeline: s.timeline,
    purchase_order_number: s.purchaseOrderNumber ?? null,
    invoice_number: s.invoiceNumber ?? null,
    shipping_carrier: s.shippingCarrier ?? null,
    container_number: s.containerNumber ?? null,
    currency: s.currency ?? null,
    purchase_date: s.purchaseDate ?? null,
    actual_arrival_date: s.actualArrivalDate ?? null,
    line_items: s.lineItems ?? [],
    documents: s.documents ?? [],
    total_cost_valuation: s.totalCostValuation ?? null,
  }
}

function rowToInvoice(r: InvoiceRow): Invoice {
  return {
    id: r.id,
    invoiceNumber: r.invoice_number,
    type: r.type as Invoice["type"],
    customerId: r.customer_id,
    supplierId: r.supplier_id,
    customerName: r.customer_name,
    date: r.date,
    dueDate: r.due_date,
    totalOriginal: r.total_original,
    totalNegotiated: r.total_negotiated,
    totalPaid: r.total_paid,
    balance: r.balance,
    status: r.status as Invoice["status"],
    weaponIds: parseJSON(r.weapon_ids, []),
    lineItems: parseJSON(r.line_items, []),
    saleMode: r.sale_mode as Invoice["saleMode"],
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    attachments: parseJSON(r.attachments, []),
    shipmentId: r.shipment_id,
    notes: r.notes,
    voided: r.voided === true || r.voided === 1,
    taxAmount: r.tax_amount,
    currency: r.currency ?? undefined,
    accountingCurrency: r.accounting_currency ?? undefined,
    exchangeRate: r.exchange_rate == null ? undefined : Number(r.exchange_rate),
    exchangeRateDate: r.exchange_rate_date ?? undefined,
    rateSource: (r.rate_source as Invoice["rateSource"]) ?? undefined,
    totalOriginalAccounting: r.total_original_accounting == null ? undefined : Number(r.total_original_accounting),
    totalNegotiatedAccounting: r.total_negotiated_accounting == null ? undefined : Number(r.total_negotiated_accounting),
    totalPaidAccounting: r.total_paid_accounting == null ? undefined : Number(r.total_paid_accounting),
    balanceAccounting: r.balance_accounting == null ? undefined : Number(r.balance_accounting),
    taxAmountAccounting: r.tax_amount_accounting == null ? undefined : Number(r.tax_amount_accounting),
    totalValuation: parseValuation(r.total_valuation),
  }
}

function invoiceToRow(inv: Invoice): Record<string, unknown> {
  return {
    id: inv.id,
    invoice_number: inv.invoiceNumber,
    type: inv.type,
    customer_id: inv.customerId,
    supplier_id: inv.supplierId,
    customer_name: inv.customerName,
    date: inv.date,
    due_date: inv.dueDate,
    total_original: inv.totalOriginal,
    total_negotiated: inv.totalNegotiated,
    total_paid: inv.totalPaid,
    balance: inv.balance,
    status: inv.status,
    weapon_ids: inv.weaponIds,
    line_items: inv.lineItems,
    sale_mode: inv.saleMode,
    employee_id: inv.employeeId,
    employee_name: inv.employeeName,
    attachments: inv.attachments,
    shipment_id: inv.shipmentId,
    notes: inv.notes,
    voided: inv.voided,
    tax_amount: inv.taxAmount,
    currency: inv.currency ?? null,
    accounting_currency: inv.accountingCurrency ?? null,
    exchange_rate: inv.exchangeRate == null ? null : String(inv.exchangeRate),
    exchange_rate_date: inv.exchangeRateDate ?? null,
    rate_source: inv.rateSource ?? null,
    total_original_accounting: inv.totalOriginalAccounting == null ? null : String(inv.totalOriginalAccounting),
    total_negotiated_accounting: inv.totalNegotiatedAccounting == null ? null : String(inv.totalNegotiatedAccounting),
    total_paid_accounting: inv.totalPaidAccounting == null ? null : String(inv.totalPaidAccounting),
    balance_accounting: inv.balanceAccounting == null ? null : String(inv.balanceAccounting),
    tax_amount_accounting: inv.taxAmountAccounting == null ? null : String(inv.taxAmountAccounting),
    total_valuation: inv.totalValuation ?? null,
  }
}

function rowToPayment(r: PaymentRow): PaymentRecord {
  return {
    id: r.id,
    invoiceId: r.invoice_id,
    invoiceNumber: r.invoice_number,
    date: r.date,
    amount: r.amount,
    currency: r.currency ?? undefined,
    accountingAmount: r.accounting_amount == null ? undefined : Number(r.accounting_amount),
    accountingCurrency: r.accounting_currency ?? undefined,
    exchangeRate: r.exchange_rate == null ? undefined : Number(r.exchange_rate),
    exchangeRateDate: r.exchange_rate_date ?? undefined,
    rateSource: (r.rate_source as PaymentRecord["rateSource"]) ?? undefined,
    rateId: r.rate_id ?? undefined,
    method: r.method as PaymentRecord["method"],
    employee: r.employee,
    notes: r.notes,
  }
}

function paymentToRow(p: PaymentRecord): Record<string, unknown> {
  return {
    id: p.id,
    invoice_id: p.invoiceId,
    invoice_number: p.invoiceNumber,
    date: p.date,
    amount: p.amount,
    currency: p.currency ?? null,
    accounting_amount: p.accountingAmount == null ? null : String(p.accountingAmount),
    accounting_currency: p.accountingCurrency ?? null,
    exchange_rate: p.exchangeRate == null ? null : String(p.exchangeRate),
    exchange_rate_date: p.exchangeRateDate ?? null,
    rate_source: p.rateSource ?? null,
    rate_id: p.rateId ?? null,
    method: p.method,
    employee: p.employee,
    notes: p.notes,
  }
}

function rowToAccessory(r: AccessoryRow): Accessory {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    quantity: r.quantity,
    safetyThreshold: r.safety_threshold,
    price: r.price,
    priceCurrency: r.price_currency ?? undefined,
    priceValuation: parseValuation(r.price_valuation),
    dateAdded: r.date_added,
    location: parseLocation(r.warehouse, r.shelf, r.bin),
  }
}

function accessoryToRow(a: Accessory): Record<string, unknown> {
  const loc = locationToCols(a.location)
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    quantity: a.quantity,
    safety_threshold: a.safetyThreshold,
    price: a.price,
    price_currency: a.priceCurrency ?? null,
    price_valuation: a.priceValuation ?? null,
    date_added: a.dateAdded,
    warehouse: loc.warehouse,
    shelf: loc.shelf,
    bin: loc.bin,
  }
}

function rowToAmmo(r: AmmoRow): Ammunition {
  return {
    id: r.id,
    name: r.name ?? r.caliber,
    caliber: r.caliber,
    packageType: r.package_type as PackageType,
    unitsPerPackage: r.units_per_package,
    fullPackages: r.full_packages,
    looseRounds: r.loose_rounds,
    safetyThreshold: r.safety_threshold,
    price: r.price,
    priceCurrency: r.price_currency ?? undefined,
    priceValuation: parseValuation(r.price_valuation),
    dateAdded: r.date_added,
    location: parseLocation(r.warehouse, r.shelf, r.bin),
  }
}

function ammoToRow(a: Ammunition): Record<string, unknown> {
  const loc = locationToCols(a.location)
  return {
    id: a.id,
    caliber: a.caliber,
    package_type: a.packageType,
    units_per_package: a.unitsPerPackage,
    full_packages: a.fullPackages,
    loose_rounds: a.looseRounds,
    safety_threshold: a.safetyThreshold,
    price: a.price,
    price_currency: a.priceCurrency ?? null,
    price_valuation: a.priceValuation ?? null,
    date_added: a.dateAdded,
    warehouse: loc.warehouse,
    shelf: loc.shelf,
    bin: loc.bin,
  }
}

function rowToCustomer(r: CustomerRow): Customer {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    address: r.address,
    isWholesaleBuyer: r.is_wholesale_buyer === true || r.is_wholesale_buyer === 1,
    wholesaleDiscountPercent: r.wholesale_discount_percent,
    dateAdded: r.date_added,
  }
}

function customerToRow(c: Customer): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    address: c.address,
    is_wholesale_buyer: c.isWholesaleBuyer,
    wholesale_discount_percent: c.wholesaleDiscountPercent,
    date_added: c.dateAdded,
  }
}

function rowToSupplier(r: SupplierRow): Supplier {
  return {
    id: r.id,
    name: r.name,
    contactPerson: r.contact_person,
    phone: r.phone,
    email: r.email,
    address: r.address,
    dateAdded: r.date_added,
  }
}

function supplierToRow(s: Supplier): Record<string, unknown> {
  return {
    id: s.id,
    name: s.name,
    contact_person: s.contactPerson,
    phone: s.phone,
    email: s.email,
    address: s.address,
    date_added: s.dateAdded,
  }
}

function rowToAuditLog(r: AuditRow): AuditLog {
  return {
    id: r.id,
    timestamp: r.timestamp,
    date: r.date,
    userId: r.user_id,
    actionType: r.action_type as AuditLog["actionType"],
    description: r.description,
    metadata: typeof r.metadata === "string" ? r.metadata : JSON.stringify(r.metadata ?? {}),
  }
}

function auditLogToRow(a: AuditLog): Record<string, unknown> {
  return {
    id: a.id,
    timestamp: a.timestamp,
    date: a.date,
    user_id: a.userId,
    action_type: a.actionType,
    description: a.description,
    metadata: parseJSON(a.metadata, {}),
  }
}

function rowToNotification(r: NotificationRow): AppNotification {
  return {
    id: r.id,
    type: r.type as AppNotification["type"],
    title: r.title,
    message: r.message,
    date: r.date,
    read: r.is_read === true || r.is_read === 1,
    entityId: r.entity_id,
  }
}

function notificationToRow(n: AppNotification): Record<string, unknown> {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    date: n.date,
    is_read: n.read,
    entity_id: n.entityId,
  }
}

function rowToUser(r: UserRow): User {
  return {
    id: r.id,
    username: r.username,
    name: r.name,
    role: r.role as User["role"],
    permissions: parseJSON<Partial<UserPermissions>>(r.permissions, {}) as UserPermissions,
    passwordSet: r.password_set === true || r.password_set === 1,
    passwordHash: "",
  }
}

function userToRow(u: User): Record<string, unknown> {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    permissions: u.permissions,
    password_set: u.passwordSet,
  }
}

function rowToSettings(r: SettingsRow): SystemSettings {
  return {
    currencySymbol: r.currency_symbol,
    currencyCode: r.currency_code,
    accountingCurrencyCode: r.accounting_currency_code,
    rateBaseCurrencyCode: r.rate_base_currency_code,
    supportedCurrencies: parseJSON(r.supported_currencies, ["USD", "SAR", "SDG", "EGP"]),
    currencyFrequency: parseJSON(r.currency_frequency, {}),
    taxPercent: r.tax_percent,
    invoiceHeader: r.invoice_header,
    invoiceFooter: r.invoice_footer,
    storeLogo: r.store_logo,
    thermalPrinterWidth: r.thermal_printer_width,
    labelFormat: r.label_format,
    hourlySnapshot: r.hourly_snapshot === true || r.hourly_snapshot === 1,
    dailyClosingPrompt: r.daily_closing_prompt === true || r.daily_closing_prompt === 1,
    weeklyVerification: r.weekly_verification === true || r.weekly_verification === 1,
    minProfitMarginPercent: r.min_profit_margin_percent,
    theme: (r.theme as SystemSettings["theme"]) ?? "system",
    preferredDisplayCurrency: r.preferred_display_currency ?? undefined,
    appLanguage: r.app_language,
    dateFormat: r.date_format,
    numberFormat: r.number_format,
    companyName: r.company_name,
    companyAddress: r.company_address,
    companyPhone: r.company_phone,
    companyEmail: r.company_email,
    companyTaxId: r.company_tax_id,
  }
}

function settingsToRow(s: SystemSettings): Record<string, unknown> {
  return {
    id: 1,
    currency_symbol: s.currencySymbol,
    currency_code: s.currencyCode,
    accounting_currency_code: s.accountingCurrencyCode,
    rate_base_currency_code: s.rateBaseCurrencyCode,
    supported_currencies: s.supportedCurrencies,
    currency_frequency: s.currencyFrequency,
    tax_percent: s.taxPercent,
    invoice_header: s.invoiceHeader,
    invoice_footer: s.invoiceFooter,
    store_logo: s.storeLogo,
    thermal_printer_width: s.thermalPrinterWidth,
    label_format: s.labelFormat,
    hourly_snapshot: s.hourlySnapshot,
    daily_closing_prompt: s.dailyClosingPrompt,
    weekly_verification: s.weeklyVerification,
    min_profit_margin_percent: s.minProfitMarginPercent,
    theme: s.theme ?? "system",
    preferred_display_currency: s.preferredDisplayCurrency ?? null,
    app_language: s.appLanguage ?? "en",
    date_format: s.dateFormat ?? "YYYY-MM-DD",
    number_format: s.numberFormat ?? "en-US",
    company_name: s.companyName ?? "",
    company_address: s.companyAddress ?? "",
    company_phone: s.companyPhone ?? "",
    company_email: s.companyEmail ?? "",
    company_tax_id: s.companyTaxId ?? "",
  }
}

function rowToUserPreferences(r: UserPreferencesRow): UserPreferences {
  return {
    userId: r.user_id,
    displayCurrency: r.display_currency ?? undefined,
    reportViewMode: r.report_view_mode as UserPreferences["reportViewMode"],
    language: r.language ?? undefined,
    dateFormat: r.date_format ?? undefined,
  }
}

function userPreferencesToRow(p: UserPreferences): Record<string, unknown> {
  return {
    user_id: p.userId,
    display_currency: p.displayCurrency ?? null,
    report_view_mode: p.reportViewMode,
    language: p.language ?? null,
    date_format: p.dateFormat ?? null,
  }
}

function rowToSavedFilter(r: SavedFilterRow): SavedFilter {
  return {
    id: r.id,
    name: r.name,
    entityType: r.entity_type,
    filterState: parseJSON(r.filter_state, {}),
  }
}

function savedFilterToRow(f: SavedFilter): Record<string, unknown> {
  return {
    id: f.id,
    name: f.name,
    entity_type: f.entityType,
    filter_state: f.filterState,
  }
}

export const mappers = {
  rowToWeapon, weaponToRow,
  rowToShipment, shipmentToRow,
  rowToInvoice, invoiceToRow,
  rowToPayment, paymentToRow,
  rowToAccessory, accessoryToRow,
  rowToAmmo, ammoToRow,
  rowToCustomer, customerToRow,
  rowToSupplier, supplierToRow,
  rowToAuditLog, auditLogToRow,
  rowToNotification, notificationToRow,
  rowToUser, userToRow,
  rowToSettings, settingsToRow,
  rowToSavedFilter, savedFilterToRow,
  rowToUserPreferences, userPreferencesToRow,
}

export type {
  WeaponRow, ShipmentRow, InvoiceRow, PaymentRow,
  AccessoryRow, AmmoRow, CustomerRow, SupplierRow,
  AuditRow, NotificationRow, UserRow, SettingsRow, SavedFilterRow, UserPreferencesRow,
  WeaponMovement, ShipmentTimelineEntry, ShipmentLineItem, ShipmentDocument, SaleLineItem,
}
