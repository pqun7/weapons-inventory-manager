import type {
  AllData, AuditLogEntry, CurrencyRow, DbResult,
  ExchangeRateOverrideRow, MasterDataAll,
} from "./types.js"
import { mappers } from "./mappers.js"
import { getSupabaseClient } from "../supabase/client.js"
import type { Json, PublicTableName } from "../supabase/database.types.js"
import type {
  Accessory, Ammunition, AppNotification, AuditLog, Customer, Invoice,
  InventoryCostSnapshot, PaymentRecord, PersistedProductCost, PersistedShipmentCost,
  SavedFilter, Shipment, ShipmentCostAllocation, ShipmentDocument, Supplier, SystemSettings, User,
  UserPreferences, Weapon,
} from "../types.js"
import type {
  AddStockInput, BulkIntakeInput, BulkShipmentCreateInput, DueDateExtensionInput,
  PaymentInput, ReceiveAmmoByPackagesInput, ReceiveAmmoByRoundsInput, SaleInput,
  ShipmentInput, UpdateAmmoPackageInput,
} from "../store.js"
import type { ProductAdditionalCostInput } from "../types.js"

type Row = Record<string, Json>
type MapperInput<Mapper> = Mapper extends (row: infer Input) => unknown ? Input : never

let ready = false

function asMapperInput<Mapper>(row: Row): MapperInput<Mapper> {
  return row as unknown as MapperInput<Mapper>
}

function toJsonRecord(value: Record<string, unknown>): Record<string, Json | undefined> {
  return JSON.parse(JSON.stringify(value)) as Record<string, Json | undefined>
}

function requireRows(data: Row[] | null, error: { message: string } | null, context: string): Row[] {
  if (error) throw new Error(`${context}: ${error.message}`)
  return data ?? []
}

function requireRow(data: Row | null, error: { message: string } | null, context: string): Row {
  if (error) throw new Error(`${context}: ${error.message}`)
  if (!data) throw new Error(`${context}: row not found`)
  return data
}

export async function initDb(): Promise<void> {
  const { data, error } = await getSupabaseClient().auth.getSession()
  if (error) throw new Error(`Supabase authentication failed: ${error.message}`)
  if (!data.session) throw new Error("AUTH_REQUIRED")
  ready = true
}

export function isDbReady(): boolean {
  return ready
}

export async function dbGetCurrentUserId(): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc("current_app_user_id", {})
  if (error) throw new Error(`Resolve current user: ${error.message}`)
  if (typeof data !== "string" || !data) throw new Error("The authenticated account is not linked to an active application user")
  return data
}

export type {
  DbResult, AllData, MasterDataAll, CurrencyRow, ExchangeRateOverrideRow,
  AuditLogEntry,
}

const WEAPON_COLUMNS = "id,serial_number,weapon_type_id,weapon_subtype_id,brand_id,model_id,caliber_id,storage_location_id,supplier_id,shipment_id,condition,status,purchase_price,retail_price,wholesale_price,retail_price_mode,wholesale_price_mode,actual_final_price,date_added,batch_id,notes,images,movement_history,purchase_price_valuation,retail_price_valuation,wholesale_price_valuation,actual_final_price_valuation,sale_price_valuation,deleted_at"
const ACCESSORY_COLUMNS = "id,name,type,quantity,safety_threshold,price,price_currency,price_valuation,retail_price,wholesale_price,retail_price_valuation,wholesale_price_valuation,retail_price_mode,wholesale_price_mode,date_added,warehouse,shelf,bin"
const AMMUNITION_COLUMNS = "id,name,caliber,package_type,units_per_package,full_packages,loose_rounds,safety_threshold,price,price_currency,price_valuation,retail_price,wholesale_price,retail_price_valuation,wholesale_price_valuation,retail_price_mode,wholesale_price_mode,date_added,warehouse,shelf,bin"
const SHIPMENT_COLUMNS = "id,shipment_number,supplier_id,shipment_date,expected_arrival_date,total_expected_items,attachments,notes,status,timeline,purchase_order_number,invoice_number,shipping_carrier,container_number,currency,purchase_date,actual_arrival_date,line_items,documents,total_cost_valuation,workflow_status,import_id,arrival_note,delay_reason,last_arrival_prompt_at"
const INVOICE_COLUMNS = "id,invoice_number,type,customer_id,supplier_id,customer_name,date,due_date,total_original,total_negotiated,total_paid,balance,status,weapon_ids,line_items,sale_mode,employee_id,employee_name,attachments,shipment_id,notes,voided,tax_amount,total_valuation,currency,accounting_currency,exchange_rate,exchange_rate_date,rate_source,total_original_accounting,total_negotiated_accounting,total_paid_accounting,balance_accounting,tax_amount_accounting"
const PAYMENT_COLUMNS = "id,invoice_id,invoice_number,date,amount,currency,accounting_amount,accounting_currency,exchange_rate,exchange_rate_date,rate_source,rate_id,method,employee,notes"
const CUSTOMER_COLUMNS = "id,name,phone,email,address,is_wholesale_buyer,wholesale_discount_percent,notes,date_added"
const SUPPLIER_COLUMNS = "id,name,contact_person,phone,email,address,date_added"
const AUDIT_COLUMNS = "id,timestamp,date,user_id,action_type,description,metadata,entity_type,entity_id,entity_name,previous_values,new_values,reason"
const NOTIFICATION_COLUMNS = "id,type,title,message,date,is_read,entity_id"
const USER_COLUMNS = "id,username,name,role,permissions,password_set"
const SETTINGS_COLUMNS = "id,currency_symbol,currency_code,accounting_currency_code,rate_base_currency_code,supported_currencies,currency_frequency,tax_percent,invoice_header,invoice_footer,store_logo,thermal_printer_width,label_format,hourly_snapshot,daily_closing_prompt,weekly_verification,min_profit_margin_percent,target_retail_margin_percent,target_wholesale_margin_percent,maximum_markup_percent,psychological_pricing,theme,preferred_display_currency,show_demo_data,app_language,date_format,number_format,company_name,company_address,company_phone,company_email,company_tax_id"
const PRODUCT_COST_COLUMNS = "id,product_type,product_id,name,calculation_type,input_amount,percentage_rate,calculation_base,calculated_amount,currency_code,exchange_rate,base_amount,base_currency_code,exchange_rate_date,rate_source,source,created_by,created_at,updated_at"
const INVENTORY_COST_COLUMNS = "product_type,product_id,shipment_id,shipment_item_id,original_amount,original_currency_code,original_exchange_rate,original_base_amount,product_costs_base_amount,shipment_costs_base_amount,final_landed_base_amount,base_currency_code,exchange_rate_date,rate_source,finalized_at"
const SHIPMENT_COST_COLUMNS = "id,shipment_id,name,calculation_type,input_amount,percentage_rate,calculation_base,calculated_amount,currency_code,exchange_rate,base_amount,base_currency_code,exchange_rate_date,rate_source,scope,allocation_method,created_by,created_at,updated_at"
const SHIPMENT_ALLOCATION_COLUMNS = "id,shipment_id,shipment_item_id,cost_id,automatic_amount,final_amount,manual_override,difference,currency_code,exchange_rate,automatic_base_amount,final_base_amount,base_currency_code,allocation_method"

function persistedProductCost(row: Row): PersistedProductCost {
  return {
    id: String(row.id), productType: String(row.product_type), productId: String(row.product_id), name: String(row.name),
    calculationType: String(row.calculation_type) as PersistedProductCost["calculationType"],
    inputAmount: String(row.input_amount), percentageRate: row.percentage_rate == null ? undefined : String(row.percentage_rate),
    calculationBase: "original_purchase_cost", calculatedAmount: String(row.calculated_amount),
    currency: String(row.currency_code), exchangeRate: String(row.exchange_rate), baseAmount: String(row.base_amount),
    baseCurrency: String(row.base_currency_code), exchangeRateDate: String(row.exchange_rate_date),
    rateSource: String(row.rate_source) as PersistedProductCost["rateSource"], source: "product_level",
    createdBy: String(row.created_by), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }
}

function inventoryCostSnapshot(row: Row): InventoryCostSnapshot {
  return {
    productType: String(row.product_type), productId: String(row.product_id),
    shipmentId: row.shipment_id == null ? undefined : String(row.shipment_id),
    shipmentItemId: row.shipment_item_id == null ? undefined : String(row.shipment_item_id),
    originalAmount: String(row.original_amount), originalCurrency: String(row.original_currency_code),
    originalExchangeRate: String(row.original_exchange_rate), originalBaseAmount: String(row.original_base_amount),
    productCostsBaseAmount: String(row.product_costs_base_amount), shipmentCostsBaseAmount: String(row.shipment_costs_base_amount),
    finalLandedBaseAmount: String(row.final_landed_base_amount), baseCurrency: String(row.base_currency_code),
    exchangeRateDate: String(row.exchange_rate_date), rateSource: String(row.rate_source) as InventoryCostSnapshot["rateSource"],
    finalizedAt: String(row.finalized_at),
  }
}

function shipmentAllocation(row: Row): ShipmentCostAllocation {
  return {
    id: String(row.id), shipmentId: String(row.shipment_id), shipmentItemId: String(row.shipment_item_id),
    costId: String(row.cost_id), automaticAmount: String(row.automatic_amount), finalAmount: String(row.final_amount),
    manualOverride: row.manual_override === true, difference: String(row.difference), currency: String(row.currency_code),
    exchangeRate: String(row.exchange_rate), automaticBaseAmount: String(row.automatic_base_amount),
    finalBaseAmount: String(row.final_base_amount), baseCurrency: String(row.base_currency_code),
    allocationMethod: String(row.allocation_method) as ShipmentCostAllocation["allocationMethod"],
  }
}

export async function dbGetAll(): Promise<AllData> {
  const client = getSupabaseClient()
  const [
    masterData,
    weaponsResult, accessoriesResult, ammunitionResult, shipmentsResult,
    invoicesResult, paymentsResult, customersResult, suppliersResult,
    auditResult, notificationsResult, usersResult, settingsResult, filtersResult,
    productCostsResult, inventoryCostsResult, shipmentCostsResult, shipmentScopesResult, shipmentAllocationsResult,
    productTypesResult,
  ] = await Promise.all([
    dbGetMasterData(),
    client.from("weapons").select(WEAPON_COLUMNS).is("deleted_at", null).order("created_at", { ascending: false }).limit(5000),
    client.from("accessories").select(ACCESSORY_COLUMNS).order("date_added", { ascending: false }).limit(5000),
    client.from("ammunition").select(AMMUNITION_COLUMNS).order("date_added", { ascending: false }).limit(5000),
    client.from("shipments").select(SHIPMENT_COLUMNS).order("shipment_date", { ascending: false }).limit(2000),
    client.from("invoices").select(INVOICE_COLUMNS).order("date", { ascending: false }).limit(5000),
    client.from("payment_records").select(PAYMENT_COLUMNS).order("date", { ascending: false }).limit(5000),
    client.from("customers").select(CUSTOMER_COLUMNS).order("date_added", { ascending: false }).limit(5000),
    client.from("suppliers").select(SUPPLIER_COLUMNS).order("date_added", { ascending: false }).limit(5000),
    client.from("audit_logs").select(AUDIT_COLUMNS).order("timestamp", { ascending: false }).limit(1000),
    client.from("app_notifications").select(NOTIFICATION_COLUMNS).order("date", { ascending: false }).limit(500),
    client.from("users").select(USER_COLUMNS).order("id", { ascending: true }).limit(500),
    client.from("system_settings").select(SETTINGS_COLUMNS).eq("id", 1).single(),
    client.from("saved_filters").select("id,name,entity_type,filter_state").order("created_at", { ascending: true }).limit(500),
    client.from("product_costs").select(PRODUCT_COST_COLUMNS).order("created_at", { ascending: true }).limit(10000),
    client.from("inventory_cost_snapshots").select(INVENTORY_COST_COLUMNS).limit(10000),
    client.from("shipment_costs").select(SHIPMENT_COST_COLUMNS).order("created_at", { ascending: true }).limit(10000),
    client.from("shipment_cost_scope_items").select("cost_id,shipment_item_id").limit(20000),
    client.from("shipment_cost_allocations").select(SHIPMENT_ALLOCATION_COLUMNS).limit(20000),
    client.from("inventory_product_types").select("id,category,name").order("name").limit(1000),
  ])

  const typeLabels = new Map(masterData.weaponTypes.map((row) => [row.id, row.label]))
  const subtypeLabels = new Map(masterData.weaponSubtypes.map((row) => [row.id, row.label]))
  const caliberLabels = new Map(masterData.calibers.map((row) => [row.id, row.label]))
  const brandLabels = new Map(masterData.brands.map((row) => [row.id, row.label]))
  const modelLabels = new Map(masterData.models.map((row) => [row.id, row.label]))
  const warehouseLabels = new Map(masterData.warehouses.map((row) => [row.id, row.label]))
  const locations = new Map(masterData.storageLocations.map((row) => [row.id, row]))

  const productCosts = requireRows(productCostsResult.data, productCostsResult.error, "Load product costs")
    .map(persistedProductCost)
  const costsByProduct = new Map<string, PersistedProductCost[]>()
  for (const cost of productCosts) {
    const key = `${cost.productType}:${cost.productId}`
    costsByProduct.set(key, [...(costsByProduct.get(key) ?? []), cost])
  }
  const snapshotsByProduct = new Map(
    requireRows(inventoryCostsResult.data, inventoryCostsResult.error, "Load inventory cost snapshots")
      .map(inventoryCostSnapshot).map((snapshot) => [`${snapshot.productType}:${snapshot.productId}`, snapshot] as const),
  )
  const scopeIds = new Map<string, string[]>()
  for (const row of requireRows(shipmentScopesResult.data, shipmentScopesResult.error, "Load shipment cost scopes")) {
    const costId = String(row.cost_id)
    scopeIds.set(costId, [...(scopeIds.get(costId) ?? []), String(row.shipment_item_id)])
  }
  const allocations = requireRows(shipmentAllocationsResult.data, shipmentAllocationsResult.error, "Load shipment cost allocations")
    .map(shipmentAllocation)
  const allocationsByCost = new Map<string, ShipmentCostAllocation[]>()
  for (const allocation of allocations) {
    allocationsByCost.set(allocation.costId, [...(allocationsByCost.get(allocation.costId) ?? []), allocation])
  }
  const shipmentCostsByShipment = new Map<string, PersistedShipmentCost[]>()
  for (const row of requireRows(shipmentCostsResult.data, shipmentCostsResult.error, "Load shipment costs")) {
    const cost: PersistedShipmentCost = {
      id: String(row.id), shipmentId: String(row.shipment_id), name: String(row.name),
      calculationType: String(row.calculation_type) as PersistedShipmentCost["calculationType"],
      inputAmount: String(row.input_amount), percentageRate: row.percentage_rate == null ? undefined : String(row.percentage_rate),
      calculationBase: "original_purchase_cost", calculatedAmount: String(row.calculated_amount),
      currency: String(row.currency_code), exchangeRate: String(row.exchange_rate), baseAmount: String(row.base_amount),
      baseCurrency: String(row.base_currency_code), exchangeRateDate: String(row.exchange_rate_date),
      rateSource: String(row.rate_source) as PersistedShipmentCost["rateSource"],
      scope: String(row.scope) as PersistedShipmentCost["scope"],
      allocationMethod: String(row.allocation_method) as PersistedShipmentCost["allocationMethod"],
      selectedShipmentItemIds: scopeIds.get(String(row.id)) ?? [], allocations: allocationsByCost.get(String(row.id)) ?? [],
      createdBy: String(row.created_by), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }
    shipmentCostsByShipment.set(cost.shipmentId, [...(shipmentCostsByShipment.get(cost.shipmentId) ?? []), cost])
  }

  const weaponRows = requireRows(weaponsResult.data, weaponsResult.error, "Load weapons")
  const weapons = weaponRows.map((row) => {
    const locationId = typeof row.storage_location_id === "string" ? row.storage_location_id : null
    const location = locationId ? locations.get(locationId) : undefined
    const enriched: Row = {
      ...row,
      weapon_type: typeLabels.get(String(row.weapon_type_id)) ?? "",
      sub_type: subtypeLabels.get(String(row.weapon_subtype_id)) ?? "",
      caliber: caliberLabels.get(String(row.caliber_id)) ?? "",
      brand: brandLabels.get(String(row.brand_id)) ?? "",
      model: modelLabels.get(String(row.model_id)) ?? "",
      warehouse: location ? warehouseLabels.get(location.warehouse_id) ?? "" : "",
      shelf: location?.shelf ?? "",
      bin: location?.bin ?? "",
      supplier_id: row.supplier_id ?? "",
    }
    const weapon = mappers.rowToWeapon(asMapperInput<typeof mappers.rowToWeapon>(enriched))
    return { ...weapon, costSnapshot: snapshotsByProduct.get(`weapon:${weapon.id}`), additionalCosts: costsByProduct.get(`weapon:${weapon.id}`) ?? [] }
  })

  const accessories = requireRows(accessoriesResult.data, accessoriesResult.error, "Load accessories")
    .map((row) => mappers.rowToAccessory(asMapperInput<typeof mappers.rowToAccessory>(row)))
    .map((item) => ({ ...item, costSnapshot: snapshotsByProduct.get(`accessory:${item.id}`), additionalCosts: costsByProduct.get(`accessory:${item.id}`) ?? [] }))
  const ammunition = requireRows(ammunitionResult.data, ammunitionResult.error, "Load ammunition")
    .map((row) => mappers.rowToAmmo(asMapperInput<typeof mappers.rowToAmmo>(row)))
    .map((item) => ({ ...item, costSnapshot: snapshotsByProduct.get(`ammunition:${item.id}`), additionalCosts: costsByProduct.get(`ammunition:${item.id}`) ?? [] }))
  const shipments = requireRows(shipmentsResult.data, shipmentsResult.error, "Load shipments")
    .map((row) => mappers.rowToShipment(asMapperInput<typeof mappers.rowToShipment>(row)))
    .map((shipment) => ({ ...shipment, additionalCosts: shipmentCostsByShipment.get(shipment.id) ?? [] }))

  const allData: AllData = {
    weapons,
    accessories,
    ammunition,
    shipments,
    invoices: requireRows(invoicesResult.data, invoicesResult.error, "Load invoices")
      .map((row) => mappers.rowToInvoice(asMapperInput<typeof mappers.rowToInvoice>(row))),
    payments: requireRows(paymentsResult.data, paymentsResult.error, "Load payments")
      .map((row) => mappers.rowToPayment(asMapperInput<typeof mappers.rowToPayment>(row))),
    customers: requireRows(customersResult.data, customersResult.error, "Load customers")
      .map((row) => mappers.rowToCustomer(asMapperInput<typeof mappers.rowToCustomer>(row))),
    suppliers: requireRows(suppliersResult.data, suppliersResult.error, "Load suppliers")
      .map((row) => mappers.rowToSupplier(asMapperInput<typeof mappers.rowToSupplier>(row))),
    auditLogs: requireRows(auditResult.data, auditResult.error, "Load audit logs")
      .map((row) => mappers.rowToAuditLog(asMapperInput<typeof mappers.rowToAuditLog>(row))),
    notifications: requireRows(notificationsResult.data, notificationsResult.error, "Load notifications")
      .map((row) => mappers.rowToNotification(asMapperInput<typeof mappers.rowToNotification>(row))),
    users: requireRows(usersResult.data, usersResult.error, "Load users")
      .map((row) => mappers.rowToUser(asMapperInput<typeof mappers.rowToUser>(row))),
    settings: mappers.rowToSettings(asMapperInput<typeof mappers.rowToSettings>(
      requireRow(settingsResult.data, settingsResult.error, "Load settings"),
    )),
    savedFilters: requireRows(filtersResult.data, filtersResult.error, "Load saved filters")
      .map((row) => mappers.rowToSavedFilter(asMapperInput<typeof mappers.rowToSavedFilter>(row))),
    inventoryProductTypes: requireRows(productTypesResult.data, productTypesResult.error, "Load inventory product types")
      .map((row) => ({ id: String(row.id), category: String(row.category) as "accessory" | "ammunition", name: String(row.name) })),
  }
  return allData
}

export async function dbGetMasterData(): Promise<MasterDataAll> {
  const client = getSupabaseClient()
  const [types, subtypes, calibers, links, brands, models, warehouses, locations] = await Promise.all([
    client.from("weapon_types").select("id,label,sort_order").order("sort_order"),
    client.from("weapon_subtypes").select("id,weapon_type_id,label,sort_order").order("sort_order"),
    client.from("calibers").select("id,label").order("label"),
    client.from("subtype_calibers").select("subtype_id,caliber_id"),
    client.from("brands").select("id,label").order("label"),
    client.from("models").select("id,label,brand_id").order("label"),
    client.from("warehouses").select("id,label").order("label"),
    client.from("storage_locations").select("id,warehouse_id,shelf,bin").order("shelf"),
  ])
  return {
    weaponTypes: requireRows(types.data, types.error, "Load weapon types") as MasterDataAll["weaponTypes"],
    weaponSubtypes: requireRows(subtypes.data, subtypes.error, "Load weapon subtypes") as MasterDataAll["weaponSubtypes"],
    calibers: requireRows(calibers.data, calibers.error, "Load calibers") as MasterDataAll["calibers"],
    subtypeCalibers: requireRows(links.data, links.error, "Load subtype calibers") as MasterDataAll["subtypeCalibers"],
    brands: requireRows(brands.data, brands.error, "Load brands") as MasterDataAll["brands"],
    models: requireRows(models.data, models.error, "Load models") as MasterDataAll["models"],
    warehouses: requireRows(warehouses.data, warehouses.error, "Load warehouses") as MasterDataAll["warehouses"],
    storageLocations: requireRows(locations.data, locations.error, "Load storage locations") as MasterDataAll["storageLocations"],
  }
}

export async function dbGetSettings(): Promise<SystemSettings> {
  const result = await getSupabaseClient().from("system_settings").select(SETTINGS_COLUMNS).eq("id", 1).single()
  return mappers.rowToSettings(asMapperInput<typeof mappers.rowToSettings>(requireRow(result.data, result.error, "Load settings")))
}

export async function dbUpdateSettings(settings: SystemSettings): Promise<void> {
  const { error } = await getSupabaseClient().from("system_settings").update(toJsonRecord(mappers.settingsToRow(settings))).eq("id", 1)
  if (error) throw new Error(`Update settings: ${error.message}`)
}

export async function dbGetUserPreferences(userId: string): Promise<UserPreferences | null> {
  const { data, error } = await getSupabaseClient().from("user_preferences")
    .select("user_id,display_currency,report_view_mode,language,date_format,inventory_visible_columns").eq("user_id", userId).maybeSingle()
  if (error) throw new Error(`Load user preferences: ${error.message}`)
  return data ? mappers.rowToUserPreferences(asMapperInput<typeof mappers.rowToUserPreferences>(data)) : null
}

export async function dbUpsertUserPreferences(preferences: UserPreferences): Promise<void> {
  const { error } = await getSupabaseClient().from("user_preferences")
    .upsert(toJsonRecord(mappers.userPreferencesToRow(preferences)), { onConflict: "user_id" })
  if (error) throw new Error(`Save user preferences: ${error.message}`)
}

async function insertRow(table: PublicTableName, row: Record<string, unknown>, context: string): Promise<void> {
  const { error } = await getSupabaseClient().from(table).insert(toJsonRecord(row))
  if (error) throw new Error(`${context}: ${error.message}`)
}

async function updateRow(table: PublicTableName, id: string, row: Record<string, unknown>, context: string): Promise<void> {
  const { error } = await getSupabaseClient().from(table).update(toJsonRecord(row)).eq("id", id)
  if (error) throw new Error(`${context}: ${error.message}`)
}

export async function dbInsertWeapon(weapon: Weapon): Promise<void> { await insertRow("weapons", mappers.weaponToRow(weapon), "Insert weapon") }
export async function dbBulkInsertWeapons(weapons: Weapon[]): Promise<void> {
  const { error } = await getSupabaseClient().from("weapons").insert(weapons.map((weapon) => toJsonRecord(mappers.weaponToRow(weapon))))
  if (error) throw new Error(`Insert weapons: ${error.message}`)
}
export async function dbUpdateWeapon(weapon: Weapon): Promise<void> { await updateRow("weapons", weapon.id, mappers.weaponToRow(weapon), "Update weapon") }
export async function dbInsertShipment(shipment: Shipment): Promise<void> { await insertRow("shipments", mappers.shipmentToRow(shipment), "Insert shipment") }
export async function dbUpdateShipment(shipment: Shipment): Promise<void> { await updateRow("shipments", shipment.id, mappers.shipmentToRow(shipment), "Update shipment") }
export async function dbInsertInvoice(invoice: Invoice): Promise<void> { await insertRow("invoices", mappers.invoiceToRow(invoice), "Insert invoice") }
export async function dbUpdateInvoice(invoice: Invoice): Promise<void> { await updateRow("invoices", invoice.id, mappers.invoiceToRow(invoice), "Update invoice") }
export async function dbInsertPayment(payment: PaymentRecord): Promise<void> { await insertRow("payment_records", mappers.paymentToRow(payment), "Insert payment") }
export async function dbInsertAccessory(accessory: Accessory): Promise<void> { await insertRow("accessories", mappers.accessoryToRow(accessory), "Insert accessory") }
export async function dbUpdateAccessory(accessory: Accessory): Promise<void> { await updateRow("accessories", accessory.id, mappers.accessoryToRow(accessory), "Update accessory") }
export async function dbInsertAmmunition(ammunition: Ammunition): Promise<void> { await insertRow("ammunition", mappers.ammoToRow(ammunition), "Insert ammunition") }
export async function dbUpdateAmmunition(ammunition: Ammunition): Promise<void> { await updateRow("ammunition", ammunition.id, mappers.ammoToRow(ammunition), "Update ammunition") }
export async function dbInsertCustomer(customer: Customer): Promise<void> { await insertRow("customers", mappers.customerToRow(customer), "Insert customer") }
export async function dbUpdateCustomer(customerId: string, patch: Partial<Customer>): Promise<void> {
  const { error } = await getSupabaseClient().rpc("update_customer", { p_customer_id: customerId, p_patch: patch as unknown as Json })
  if (error) throw new Error(error.message)
}
export async function dbDeleteCustomer(id: string): Promise<void> {
  const { error } = await getSupabaseClient().from("customers").delete().eq("id", id)
  if (error) throw new Error(`Delete customer: ${error.message}`)
}
export async function dbInsertSupplier(supplier: Supplier): Promise<void> { await insertRow("suppliers", mappers.supplierToRow(supplier), "Insert supplier") }
export async function dbInsertAuditLog(log: AuditLog): Promise<void> { await insertRow("audit_logs", mappers.auditLogToRow(log), "Insert audit log") }
export async function dbInsertNotification(notification: AppNotification): Promise<void> { await insertRow("app_notifications", mappers.notificationToRow(notification), "Insert notification") }
export async function dbUpdateNotification(notification: AppNotification): Promise<void> { await updateRow("app_notifications", notification.id, mappers.notificationToRow(notification), "Update notification") }
export async function dbMarkAllNotificationsRead(): Promise<void> {
  const userId = await dbGetCurrentUserId()
  const { error } = await getSupabaseClient().from("app_notifications").update({ is_read: true })
    .eq("user_id", userId).eq("is_read", false)
  if (error) throw new Error(`Mark notifications read: ${error.message}`)
}
export async function dbDeleteNotification(id: string): Promise<void> {
  const { error } = await getSupabaseClient().from("app_notifications").delete().eq("id", id)
  if (error) throw new Error(`Delete notification: ${error.message}`)
}
export async function dbCreateNotification(type: string, title: string, message: string, entityId?: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("create_app_notification", {
    p_type: type, p_title: title, p_message: message, p_entity_id: entityId ?? null,
  })
  if (error) throw new Error(error.message)
}
export async function dbFlagOverdueShipments(): Promise<void> {
  const { error } = await getSupabaseClient().rpc("flag_overdue_shipments", {})
  if (error) throw new Error(error.message)
}
export async function dbWriteAuditEvent(actionType: string, description: string, metadata?: string): Promise<void> {
  let parsed: Json = {}
  if (metadata?.trim()) {
    const value: unknown = JSON.parse(metadata)
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Audit metadata must be a JSON object")
    parsed = value as Json
  }
  const { error } = await getSupabaseClient().rpc("write_audit_event", {
    p_action_type: actionType, p_description: description, p_metadata: parsed,
  })
  if (error) throw new Error(error.message)
}

async function invokeAdminUsers(body: Record<string, Json>): Promise<void> {
  const { error } = await getSupabaseClient().functions.invoke("admin-users", { body })
  if (error) throw new Error(`User administration failed: ${error.message}`)
}
export async function dbInsertUser(user: User): Promise<void> { await invokeAdminUsers({ action: "create", user: toJsonRecord(mappers.userToRow(user)) as Json }) }
export async function dbUpdateUser(user: User): Promise<void> { await invokeAdminUsers({ action: "update", user: toJsonRecord(mappers.userToRow(user)) as Json }) }
export async function dbDeleteUser(id: string): Promise<void> { await invokeAdminUsers({ action: "delete", userId: id }) }

export async function dbInsertSavedFilter(filter: SavedFilter): Promise<void> {
  const { data: userId, error: userError } = await getSupabaseClient().rpc("current_app_user_id", {})
  if (userError || typeof userId !== "string") throw new Error(userError?.message ?? "Authenticated user is required")
  await insertRow("saved_filters", { ...mappers.savedFilterToRow(filter), user_id: userId }, "Insert saved filter")
}
export async function dbDeleteSavedFilter(id: string): Promise<void> {
  const { error } = await getSupabaseClient().from("saved_filters").delete().eq("id", id)
  if (error) throw new Error(`Delete saved filter: ${error.message}`)
}

function generatedId(prefix: string): string { return `${prefix}-${crypto.randomUUID()}` }
async function insertMaster(table: PublicTableName, row: Record<string, unknown>, prefix: string): Promise<string> {
  const id = generatedId(prefix)
  await insertRow(table, { id, ...row }, `Insert ${table}`)
  return id
}
async function ensureMasterByLabel(
  table: "weapon_types" | "calibers" | "brands",
  label: string,
  prefix: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const normalized = label.trim().replace(/\s+/g, " ")
  if (!normalized) throw new Error("A name is required")
  const client = getSupabaseClient()
  const existing = await client.from(table).select("id,label").ilike("label", normalized).limit(1).maybeSingle()
  if (existing.error) throw new Error(`Find ${table}: ${existing.error.message}`)
  if (existing.data) return String(existing.data.id)
  const id = generatedId(prefix)
  const inserted = await client.from(table).insert(toJsonRecord({ id, label: normalized, ...extra })).select("id").single()
  if (!inserted.error) return String(inserted.data.id)
  if (inserted.error.code !== "23505") throw new Error(`Insert ${table}: ${inserted.error.message}`)
  const raced = await client.from(table).select("id,label").ilike("label", normalized).limit(1).single()
  if (raced.error) throw new Error(`Resolve ${table}: ${raced.error.message}`)
  return String(raced.data.id)
}
export function dbInsertMasterWeaponType(label: string, sortOrder: number): Promise<string> { return ensureMasterByLabel("weapon_types", label, "wt", { sort_order: sortOrder }) }
export async function dbInsertMasterWeaponSubtype(weaponTypeId: string, label: string, sortOrder: number): Promise<string> {
  const normalized = label.trim().replace(/\s+/g, " ")
  const client = getSupabaseClient()
  const existing = await client.from("weapon_subtypes").select("id,label").eq("weapon_type_id", weaponTypeId).ilike("label", normalized).limit(1).maybeSingle()
  if (existing.error) throw new Error(`Find weapon subtype: ${existing.error.message}`)
  if (existing.data) return String(existing.data.id)
  try { return await insertMaster("weapon_subtypes", { weapon_type_id: weaponTypeId, label: normalized, sort_order: sortOrder }, "ws") }
  catch (error) {
    const raced = await client.from("weapon_subtypes").select("id,label").eq("weapon_type_id", weaponTypeId).ilike("label", normalized).limit(1).maybeSingle()
    if (raced.data) return String(raced.data.id)
    throw error
  }
}
export function dbInsertMasterCaliber(label: string): Promise<string> { return ensureMasterByLabel("calibers", label, "cal") }
export async function dbLinkSubtypeCaliber(subtypeId: string, caliberId: string): Promise<void> {
  const { error } = await getSupabaseClient().from("subtype_calibers")
    .upsert({ subtype_id: subtypeId, caliber_id: caliberId }, { onConflict: "subtype_id,caliber_id", ignoreDuplicates: true })
  if (error) throw new Error(`Link subtype caliber: ${error.message}`)
}
export function dbInsertMasterBrand(label: string): Promise<string> { return ensureMasterByLabel("brands", label, "br") }
export function dbInsertMasterModel(label: string, brandId: string | null): Promise<string> {
  if (!brandId) return Promise.reject(new Error("Brand is required for a model"))
  return (async () => {
    const normalized = label.trim().replace(/\s+/g, " ")
    const client = getSupabaseClient()
    const existing = await client.from("models").select("id,label").eq("brand_id", brandId).ilike("label", normalized).limit(1).maybeSingle()
    if (existing.error) throw new Error(`Find model: ${existing.error.message}`)
    if (existing.data) return String(existing.data.id)
    try { return await insertMaster("models", { label: normalized, brand_id: brandId }, "mdl") }
    catch (error) {
      const raced = await client.from("models").select("id,label").eq("brand_id", brandId).ilike("label", normalized).limit(1).maybeSingle()
      if (raced.data) return String(raced.data.id)
      throw error
    }
  })()
}
export function dbInsertMasterWarehouse(label: string): Promise<string> { return insertMaster("warehouses", { label }, "wh") }
export function dbInsertMasterStorageLocation(warehouseId: string, shelf: string, bin: string): Promise<string> { return insertMaster("storage_locations", { warehouse_id: warehouseId, shelf, bin }, "loc") }
export async function dbDeleteMasterRow(table: string, id: string): Promise<void> {
  const allowed = new Set<PublicTableName>(["weapon_types", "weapon_subtypes", "calibers", "brands", "models", "warehouses", "storage_locations"])
  if (!allowed.has(table as PublicTableName)) throw new Error("Invalid master-data table")
  const { error } = await getSupabaseClient().from(table as PublicTableName).delete().eq("id", id)
  if (error) throw new Error(`Delete master data: ${error.message}`)
}

export async function dbGetCurrencies(): Promise<CurrencyRow[]> {
  const { data, error } = await getSupabaseClient().from("currencies").select("iso_code,name,symbol,decimal_precision,is_active,last_known_rate,last_rate_updated_at").order("iso_code")
  return requireRows(data, error, "Load currencies") as unknown as CurrencyRow[]
}
export async function dbGetOverrides(): Promise<ExchangeRateOverrideRow[]> {
  const { data, error } = await getSupabaseClient().from("exchange_rate_overrides").select("currency_code,mode,manual_rate,updated_by,updated_at,reason").order("currency_code")
  return requireRows(data, error, "Load exchange-rate overrides") as unknown as ExchangeRateOverrideRow[]
}
export async function dbUpdateCurrencyRate(code: string, rate: number, updatedAt: string): Promise<void> {
  const { error } = await getSupabaseClient().from("currencies").update({ last_known_rate: rate, last_rate_updated_at: updatedAt }).eq("iso_code", code)
  if (error) throw new Error(`Update currency rate: ${error.message}`)
}
export async function dbRecordRateHistory(code: string, rate: number, source: string): Promise<void> { await insertRow("exchange_rate_history", { id: generatedId("RATE"), currency_code: code, rate, source, fetched_at: new Date().toISOString() }, "Record rate history") }
export async function dbSetManualOverride(code: string, rate: number, changedBy: string, reason: string, updatedAt: string): Promise<void> {
  const { error } = await getSupabaseClient().from("exchange_rate_overrides").upsert({ currency_code: code, mode: "manual", manual_rate: rate, updated_by: changedBy, reason, updated_at: updatedAt }, { onConflict: "currency_code" })
  if (error) throw new Error(`Set manual currency rate: ${error.message}`)
}
export async function dbSetAutomaticMode(code: string, changedBy: string, updatedAt: string): Promise<void> {
  const { error } = await getSupabaseClient().from("exchange_rate_overrides").upsert({ currency_code: code, mode: "automatic", manual_rate: null, updated_by: changedBy, updated_at: updatedAt }, { onConflict: "currency_code" })
  if (error) throw new Error(`Set automatic currency rate: ${error.message}`)
}
export async function dbGetRateAuditLog(limit = 50): Promise<AuditLogEntry[]> {
  const { data, error } = await getSupabaseClient().from("exchange_rate_audit_log").select("id,currency_code,old_rate,new_rate,changed_by,changed_at,reason,source").order("changed_at", { ascending: false }).limit(limit)
  return requireRows(data, error, "Load rate audit log").map((row) => ({
    id: String(row.id), currencyCode: String(row.currency_code), oldRate: row.old_rate == null ? null : Number(row.old_rate),
    newRate: row.new_rate == null ? null : Number(row.new_rate), changedBy: row.changed_by == null ? null : String(row.changed_by),
    changedAt: String(row.changed_at), reason: row.reason == null ? null : String(row.reason), source: String(row.source) as AuditLogEntry["source"],
  }))
}
export async function dbAddCurrency(isoCode: string, name: string, symbol: string, decimalPrecision: number, initialRate: number): Promise<void> {
  await insertRow("currencies", { iso_code: isoCode, name, symbol, decimal_precision: decimalPrecision, last_known_rate: initialRate, last_rate_updated_at: new Date().toISOString(), is_active: true }, "Add currency")
}
export async function dbToggleCurrencyActive(code: string, isActive: boolean): Promise<void> {
  const { error } = await getSupabaseClient().from("currencies").update({ is_active: isActive }).eq("iso_code", code)
  if (error) throw new Error(`Toggle currency: ${error.message}`)
}
export async function dbRecordRateAuditLog(code: string, oldRate: number | null, newRate: number | null, changedBy: string, reason: string, changedAt: string): Promise<void> {
  await insertRow("exchange_rate_audit_log", { id: generatedId("FXA"), currency_code: code, old_rate: oldRate, new_rate: newRate, changed_by: changedBy, reason, changed_at: changedAt, source: "manual" }, "Record currency audit")
}
export async function dbDeleteCurrency(code: string): Promise<void> {
  const { error } = await getSupabaseClient().from("currencies").delete().eq("iso_code", code)
  if (error) throw new Error(`Delete currency: ${error.message}`)
}

export async function dbCompleteSale(input: SaleInput): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const { data, error } = await getSupabaseClient().rpc("complete_sale", {
    p_customer_id: input.customerId, p_customer_name: input.customerName, p_mode: input.mode,
    p_invoice_number: input.invoiceNumber, p_line_items: input.lineItems as unknown as Json,
    p_total_original: input.totalOriginal, p_total_negotiated: input.totalNegotiated,
    p_tax_amount: input.taxAmount, p_due_date: input.dueDate, p_paid_amount: input.paidAmount ?? 0,
    p_payment_method: input.paymentMethod ?? "cash", p_currency: input.currency,
    p_attachments: input.attachments as unknown as Json, p_notes: input.notes, p_sale_date: input.date,
  })
  if (error) throw new Error(error.message)
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Sale RPC returned an invalid response")
  const invoiceId = data.invoiceId
  const invoiceNumber = data.invoiceNumber
  if (typeof invoiceId !== "string" || typeof invoiceNumber !== "string") throw new Error("Sale RPC response is incomplete")
  return { invoiceId, invoiceNumber }
}

export async function dbRegisterPayment(input: PaymentInput): Promise<{ newBalance: number }> {
  const { data, error } = await getSupabaseClient().rpc("register_payment", {
    p_invoice_id: input.invoiceId, p_amount: input.amount, p_currency: input.currency,
    p_method: input.method, p_notes: input.notes,
  })
  if (error) throw new Error(error.message)
  if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.newBalance !== "number") throw new Error("Payment RPC returned an invalid response")
  return { newBalance: data.newBalance }
}

export async function dbUpdateWeaponStatus(weaponId: string, status: string, reason: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("update_weapon_status", { p_weapon_id: weaponId, p_status: status, p_reason: reason })
  if (error) throw new Error(error.message)
}

export async function dbUpdateWeaponNotes(weaponId: string, notes: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("update_weapon_notes", { p_weapon_id: weaponId, p_notes: notes })
  if (error) throw new Error(error.message)
}

export async function dbUpdateWeaponLocation(weaponId: string, storageLocationId: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("update_weapon_location", {
    p_weapon_id: weaponId, p_storage_location_id: storageLocationId,
  })
  if (error) throw new Error(error.message)
}

export async function dbAppendWeaponImage(weaponId: string, imageDataUrl: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("append_weapon_image", {
    p_weapon_id: weaponId,
    p_image_data_url: imageDataUrl,
  })
  if (error) throw new Error(`Append weapon image: ${error.message}`)
}

export async function dbBindWeaponToShipment(weaponId: string, shipmentId: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("bind_weapon_to_shipment", {
    p_weapon_id: weaponId, p_shipment_id: shipmentId,
  })
  if (error) throw new Error(error.message)
}

export async function dbSetShipmentStatus(shipmentId: string, status: string, notes: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("set_shipment_status", {
    p_shipment_id: shipmentId, p_status: status, p_notes: notes,
  })
  if (error) throw new Error(error.message)
}

export async function dbUpdateShipmentDetails(shipmentId: string, patch: Partial<Shipment>): Promise<void> {
  const { error } = await getSupabaseClient().rpc("update_shipment_details", {
    p_shipment_id: shipmentId, p_patch: patch as unknown as Json,
  })
  if (error) throw new Error(error.message)
}

export async function dbDeleteShipment(shipmentId: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("delete_shipment", { p_shipment_id: shipmentId })
  if (error) throw new Error(error.message)
}

export async function dbAddShipmentDocument(shipmentId: string, document: ShipmentDocument): Promise<void> {
  const { error } = await getSupabaseClient().rpc("add_shipment_document_metadata", {
    p_shipment_id: shipmentId, p_document: document as unknown as Json,
  })
  if (error) throw new Error(error.message)
}

export async function dbDeleteShipmentDocument(shipmentId: string, documentId: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("delete_shipment_document_metadata", {
    p_shipment_id: shipmentId, p_document_id: documentId,
  })
  if (error) throw new Error(error.message)
}

export async function dbAddShipmentTimelineEvent(shipmentId: string, eventType: string, notes: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("add_shipment_timeline_event", {
    p_shipment_id: shipmentId,
    p_event_type: eventType,
    p_notes: notes,
  })
  if (error) throw new Error(`Add shipment timeline event: ${error.message}`)
}

export async function dbUpdateInvoiceNotes(invoiceId: string, notes: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("update_invoice_notes", { p_invoice_id: invoiceId, p_notes: notes })
  if (error) throw new Error(error.message)
}

export async function dbUpdateInventoryProduct(productType: "accessory" | "ammunition", productId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await getSupabaseClient().rpc("update_inventory_product", {
    p_product_type: productType, p_product_id: productId, p_patch: toJsonRecord(patch) as Json,
  })
  if (error) throw new Error(error.message)
}

export async function dbBulkIntakeWeapons(input: BulkIntakeInput): Promise<{ added: number; duplicates: string[] }> {
  const { data, error } = await getSupabaseClient().rpc("bulk_intake_weapons", { p_input: input as unknown as Json })
  if (error) throw new Error(error.message)
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Weapon intake RPC returned an invalid response")
  const added = data.added
  const duplicates = data.duplicates
  if (typeof added !== "number" || !Array.isArray(duplicates) || !duplicates.every((value) => typeof value === "string")) {
    throw new Error("Weapon intake RPC response is incomplete")
  }
  return { added, duplicates }
}

export async function dbCreateShipmentRpc(input: ShipmentInput): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc("create_shipment", { p_input: input as unknown as Json })
  if (error) throw new Error(error.message)
  if (typeof data !== "string") throw new Error("Shipment RPC returned an invalid response")
  return data
}

export async function dbBulkCreateShipment(input: BulkShipmentCreateInput): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc("bulk_create_shipment", { p_input: input as unknown as Json })
  if (error) throw new Error(error.message)
  if (typeof data !== "string") throw new Error("Bulk shipment RPC returned an invalid response")
  return data
}

export async function dbAdjustInventoryStock(input: AddStockInput): Promise<void> {
  const { error } = await getSupabaseClient().rpc("adjust_inventory_stock", {
    p_item_type: input.itemType,
    p_item_id: input.itemId,
    p_quantity: input.quantity ?? 0,
    p_packages: input.packages ?? 0,
    p_loose_rounds: input.looseRounds ?? 0,
    p_price: input.price ?? null,
    p_purchase_price: input.purchasePrice ?? null,
    p_currency: input.currency ?? null,
    p_shipment_id: input.shipmentId ?? null,
    p_notes: input.notes ?? "",
    p_location: (input.location ?? null) as unknown as Json,
  })
  if (error) throw new Error(error.message)
}

async function receiveAmmunition(input: {
  itemId: string
  rounds: number
  unitsPerPackage?: number
  purchasePrice: number
  currency?: string
  shipmentId: string | null
  notes: string
}): Promise<void> {
  const { error } = await getSupabaseClient().rpc("receive_ammunition", {
    p_item_id: input.itemId,
    p_rounds: input.rounds,
    p_units_per_package: input.unitsPerPackage ?? null,
    p_purchase_price: input.purchasePrice,
    p_currency: input.currency ?? null,
    p_shipment_id: input.shipmentId,
    p_notes: input.notes,
  })
  if (error) throw new Error(error.message)
}

export function dbReceiveAmmoByPackages(input: ReceiveAmmoByPackagesInput): Promise<void> {
  return receiveAmmunition({
    itemId: input.itemId,
    rounds: input.numberOfPackages * input.unitsPerPackage,
    unitsPerPackage: input.unitsPerPackage,
    purchasePrice: input.purchasePrice,
    currency: input.currency,
    shipmentId: input.shipmentId,
    notes: input.notes,
  })
}

export function dbReceiveAmmoByRounds(input: ReceiveAmmoByRoundsInput): Promise<void> {
  return receiveAmmunition({
    itemId: input.itemId,
    rounds: input.totalRounds,
    purchasePrice: input.purchasePrice,
    currency: input.currency,
    shipmentId: input.shipmentId,
    notes: input.notes,
  })
}

export async function dbUpdateAmmoPackage(input: UpdateAmmoPackageInput): Promise<void> {
  const { error } = await getSupabaseClient().rpc("update_ammunition_package", {
    p_item_id: input.itemId,
    p_package_type: input.packageType,
    p_units_per_package: input.unitsPerPackage,
  })
  if (error) throw new Error(error.message)
}

export async function dbExtendInvoiceDueDate(input: DueDateExtensionInput): Promise<void> {
  const { error } = await getSupabaseClient().rpc("extend_invoice_due_date", {
    p_invoice_id: input.invoiceId,
    p_new_due_date: input.newDueDate,
    p_reason: input.reason,
  })
  if (error) throw new Error(error.message)
}

export async function dbVoidInvoice(invoiceId: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("void_invoice", { p_invoice_id: invoiceId })
  if (error) throw new Error(error.message)
}

async function createInventoryProduct(
  productType: "accessory" | "ammunition",
  product: Accessory | Ammunition,
  costs: ProductAdditionalCostInput[],
): Promise<void> {
  const row = productType === "accessory"
    ? mappers.accessoryToRow(product as Accessory)
    : mappers.ammoToRow(product as Ammunition)
  const { error } = await getSupabaseClient().rpc("create_inventory_product", {
    p_product_type: productType,
    p_product: toJsonRecord(row) as Json,
    p_costs: costs as unknown as Json,
  })
  if (error) throw new Error(error.message)
}

export function dbCreateAccessory(accessory: Accessory, costs: ProductAdditionalCostInput[]): Promise<void> {
  return createInventoryProduct("accessory", accessory, costs)
}

export function dbCreateAmmunition(ammunition: Ammunition, costs: ProductAdditionalCostInput[]): Promise<void> {
  return createInventoryProduct("ammunition", ammunition, costs)
}

export async function dbCreateInventoryProductType(category: "accessory" | "ammunition", name: string): Promise<{ id: string; category: "accessory" | "ammunition"; name: string; created: boolean }> {
  const { data, error } = await getSupabaseClient().rpc("create_inventory_product_type", { p_category: category, p_name: name })
  if (error) throw new Error(error.message)
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Product type response is invalid")
  return { id: String(data.id), category: String(data.category) as "accessory" | "ammunition", name: String(data.name), created: data.created === true }
}

export async function dbUpdateProductPricing(input: { productType: "weapon" | "accessory" | "ammunition"; productId: string; retailPrice: number; wholesalePrice: number; currency: string; retailMode: "auto" | "manual"; wholesaleMode: "auto" | "manual" }): Promise<void> {
  const { error } = await getSupabaseClient().rpc("update_product_pricing", {
    p_product_type: input.productType, p_product_id: input.productId,
    p_retail_price: input.retailPrice, p_wholesale_price: input.wholesalePrice,
    p_currency: input.currency, p_retail_mode: input.retailMode, p_wholesale_mode: input.wholesaleMode,
  })
  if (error) throw new Error(error.message)
}

export async function dbReplaceProductCosts(productType: string, productId: string, costs: ProductAdditionalCostInput[]): Promise<void> {
  const { error } = await getSupabaseClient().rpc("replace_product_costs", {
    p_product_type: productType,
    p_product_id: productId,
    p_costs: costs as unknown as Json,
  })
  if (error) throw new Error(error.message)
}
