import { getDb } from "../database.js"
import { randomUUID } from "node:crypto"
import { mappers } from "../../src/lib/db/mappers.js"
import type { AllData, MasterDataAll } from "../../src/lib/db/mappers.js"
import type {
  Weapon, Shipment, Invoice, PaymentRecord, Accessory, Ammunition,
  Customer, Supplier, AuditLog, AppNotification, User, SystemSettings,
  SavedFilter, UserPreferences,
} from "../../src/lib/types.js"
import type { CurrencyRow, ExchangeRateOverrideRow, AuditLogEntry } from "../../src/lib/db/mappers.js"
import { cleanMasterDataLabel, findCanonicalMasterId } from "../../src/lib/master-data-normalization.js"
import { getInventoryCostSnapshot, listProductCosts, listShipmentCosts } from "../services/product-cost-service.js"

function rowToCurrencyRow(r: Record<string, unknown>): CurrencyRow {
  return {
    iso_code: r.iso_code as string,
    name: r.name as string,
    symbol: r.symbol as string,
    decimal_precision: r.decimal_precision as number,
    is_active: r.is_active as number,
    last_known_rate: r.last_known_rate as string | number,
    last_rate_updated_at: r.last_rate_updated_at as string | null,
  }
}
function assertValidPaymentMethod(method: string): void {
  const validMethods = new Set([
    "cash",
    "card",
    "bank_transfer",
    "check",
    "other",
  ])

  if (!validMethods.has(method)) {
    throw new Error(`Invalid payment method: ${method}`)
  }
}

export class AppRepository {
  getAll(): AllData {
    const db = getDb()

    const weapons = (db.prepare(`
      SELECT
        w.*,
        wt.label AS weapon_type,
        ws.label AS sub_type,
        c.label   AS caliber,
        b.label   AS brand,
        m.label   AS model,
        COALESCE(wh.label, '') AS warehouse,
        COALESCE(sl.shelf, '') AS shelf,
        COALESCE(sl.bin, '')   AS bin
      FROM weapons w
        LEFT JOIN weapon_types wt    ON w.weapon_type_id    = wt.id
        LEFT JOIN weapon_subtypes ws ON w.weapon_subtype_id = ws.id
        LEFT JOIN calibers c         ON w.caliber_id        = c.id
        LEFT JOIN brands b           ON w.brand_id          = b.id
        LEFT JOIN models m           ON w.model_id          = m.id
        LEFT JOIN storage_locations sl ON w.storage_location_id = sl.id
        LEFT JOIN warehouses wh      ON sl.warehouse_id     = wh.id
      WHERE w.deleted_at IS NULL
      ORDER BY w.date_added DESC
    `).all() as Record<string, unknown>[])
      .map((r) => mappers.rowToWeapon(r as never))
      .map((item) => ({ ...item, costSnapshot: getInventoryCostSnapshot("weapon", item.id), additionalCosts: listProductCosts("weapon", item.id) }))

    const shipments = (db.prepare("SELECT * FROM shipments ORDER BY shipment_date DESC").all() as Record<string, unknown>[])
      .map((r) => mappers.rowToShipment(r as never))
      .map((shipment) => ({ ...shipment, additionalCosts: listShipmentCosts(shipment.id) }))
    const invoices = (db.prepare("SELECT * FROM invoices ORDER BY date DESC").all() as Record<string, unknown>[])
      .map((r) => mappers.rowToInvoice(r as never))
    const payments = (db.prepare("SELECT * FROM payment_records ORDER BY date DESC").all() as Record<string, unknown>[])
      .map((r) => mappers.rowToPayment(r as never))
    const accessories = (db.prepare("SELECT * FROM accessories ORDER BY date_added DESC").all() as Record<string, unknown>[])
      .map((r) => mappers.rowToAccessory(r as never))
      .map((item) => ({ ...item, costSnapshot: getInventoryCostSnapshot("accessory", item.id), additionalCosts: listProductCosts("accessory", item.id) }))
    const ammunition = (db.prepare("SELECT * FROM ammunition ORDER BY date_added DESC").all() as Record<string, unknown>[])
      .map((r) => mappers.rowToAmmo(r as never))
      .map((item) => ({ ...item, costSnapshot: getInventoryCostSnapshot("ammunition", item.id), additionalCosts: listProductCosts("ammunition", item.id) }))
    const customers = (db.prepare("SELECT * FROM customers ORDER BY date_added DESC").all() as Record<string, unknown>[])
      .map((r) => mappers.rowToCustomer(r as never))
    const suppliers = (db.prepare("SELECT * FROM suppliers ORDER BY date_added DESC").all() as Record<string, unknown>[])
      .map((r) => mappers.rowToSupplier(r as never))
    const auditLogs = (db.prepare("SELECT * FROM audit_logs ORDER BY timestamp DESC").all() as Record<string, unknown>[])
      .map((r) => mappers.rowToAuditLog(r as never))
    const notifications = (db.prepare("SELECT * FROM app_notifications ORDER BY date DESC").all() as Record<string, unknown>[])
      .map((r) => mappers.rowToNotification(r as never))
    const users = (db.prepare("SELECT * FROM users ORDER BY id").all() as Record<string, unknown>[])
      .map((r) => mappers.rowToUser(r as never))
    const settingsRow = db.prepare("SELECT * FROM system_settings WHERE id = 1").get() as Record<string, unknown>
    const settings = mappers.rowToSettings(settingsRow as never)

    return { weapons, accessories, ammunition, shipments, invoices, payments, customers, suppliers, auditLogs, notifications, users, settings }
  }

  getSettings(): SystemSettings {
    const db = getDb()
    const row = db.prepare("SELECT * FROM system_settings WHERE id = 1").get() as Record<string, unknown>
    return mappers.rowToSettings(row as never)
  }

  updateSettings(s: SystemSettings): void {
    const db = getDb()
    const row = mappers.settingsToRow(s)
    db.prepare(`UPDATE system_settings SET
      currency_symbol = @currency_symbol,
      currency_code = @currency_code,
      accounting_currency_code = @accounting_currency_code,
      rate_base_currency_code = @rate_base_currency_code,
      supported_currencies = @supported_currencies,
      currency_frequency = @currency_frequency,
      tax_percent = @tax_percent,
      invoice_header = @invoice_header,
      invoice_footer = @invoice_footer,
      store_logo = @store_logo,
      thermal_printer_width = @thermal_printer_width,
      label_format = @label_format,
      hourly_snapshot = @hourly_snapshot,
      daily_closing_prompt = @daily_closing_prompt,
      weekly_verification = @weekly_verification,
      min_profit_margin_percent = @min_profit_margin_percent,
      theme = @theme,
      preferred_display_currency = @preferred_display_currency,
      app_language = @app_language,
      date_format = @date_format,
      number_format = @number_format,
      company_name = @company_name,
      company_address = @company_address,
      company_phone = @company_phone,
      company_email = @company_email,
      company_tax_id = @company_tax_id
      WHERE id = 1`).run(row)
  }

  getUserPreferences(userId: string): UserPreferences | null {
    const db = getDb()
    const row = db.prepare("SELECT * FROM user_preferences WHERE user_id = ?").get(userId) as Record<string, unknown> | undefined
    if (!row) return null
    return mappers.rowToUserPreferences(row as never)
  }

  upsertUserPreferences(p: UserPreferences): void {
    const db = getDb()
    const row = mappers.userPreferencesToRow(p)
    db.prepare(`INSERT INTO user_preferences (user_id, display_currency, report_view_mode, language, date_format, created_at, updated_at)
      VALUES (@user_id, @display_currency, @report_view_mode, @language, @date_format, datetime('now'), datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        display_currency = @display_currency,
        report_view_mode = @report_view_mode,
        language = @language,
        date_format = @date_format,
        updated_at = datetime('now')`).run(row)
  }

  insertWeapon(w: Weapon): void {
    const db = getDb()
    const row = mappers.weaponToRow(w)
    db.prepare(`INSERT INTO weapons (
      id, serial_number, weapon_type_id, weapon_subtype_id, brand_id, model_id, caliber_id,
      storage_location_id, supplier_id, shipment_id,
      condition, status,
      purchase_price, retail_price, wholesale_price, actual_final_price,
      date_added, batch_id, notes, images, movement_history,
      purchase_price_valuation, retail_price_valuation, wholesale_price_valuation,
      actual_final_price_valuation, sale_price_valuation, deleted_at
    ) VALUES (
      @id, @serial_number, @weapon_type_id, @weapon_subtype_id, @brand_id, @model_id, @caliber_id,
      @storage_location_id, @supplier_id, @shipment_id,
      @condition, @status,
      @purchase_price, @retail_price, @wholesale_price, @actual_final_price,
      @date_added, @batch_id, @notes, @images, @movement_history,
      @purchase_price_valuation, @retail_price_valuation, @wholesale_price_valuation,
      @actual_final_price_valuation, @sale_price_valuation, @deleted_at
    )`).run(row)
  }

  bulkInsertWeapons(weapons: Weapon[]): void {
    const db = getDb()
    const stmt = db.prepare(`INSERT INTO weapons (
      id, serial_number, weapon_type_id, weapon_subtype_id, brand_id, model_id, caliber_id,
      storage_location_id, supplier_id, shipment_id,
      condition, status,
      purchase_price, retail_price, wholesale_price, actual_final_price,
      date_added, batch_id, notes, images, movement_history,
      purchase_price_valuation, retail_price_valuation, wholesale_price_valuation,
      actual_final_price_valuation, sale_price_valuation, deleted_at
    ) VALUES (
      @id, @serial_number, @weapon_type_id, @weapon_subtype_id, @brand_id, @model_id, @caliber_id,
      @storage_location_id, @supplier_id, @shipment_id,
      @condition, @status,
      @purchase_price, @retail_price, @wholesale_price, @actual_final_price,
      @date_added, @batch_id, @notes, @images, @movement_history,
      @purchase_price_valuation, @retail_price_valuation, @wholesale_price_valuation,
      @actual_final_price_valuation, @sale_price_valuation, @deleted_at
    )`)
    for (const w of weapons) {
      stmt.run(mappers.weaponToRow(w))
    }
  }

  updateWeapon(w: Weapon): void {
    const db = getDb()
    const row = mappers.weaponToRow(w)
    db.prepare(`UPDATE weapons SET
      serial_number = @serial_number,
      weapon_type_id = @weapon_type_id,
      weapon_subtype_id = @weapon_subtype_id,
      brand_id = @brand_id,
      model_id = @model_id,
      caliber_id = @caliber_id,
      storage_location_id = @storage_location_id,
      supplier_id = @supplier_id,
      shipment_id = @shipment_id,
      condition = @condition,
      status = @status,
      purchase_price = @purchase_price,
      retail_price = @retail_price,
      wholesale_price = @wholesale_price,
      actual_final_price = @actual_final_price,
      date_added = @date_added,
      batch_id = @batch_id,
      notes = @notes,
      images = @images,
      movement_history = @movement_history,
      purchase_price_valuation = @purchase_price_valuation,
      retail_price_valuation = @retail_price_valuation,
      wholesale_price_valuation = @wholesale_price_valuation,
      actual_final_price_valuation = @actual_final_price_valuation,
      sale_price_valuation = @sale_price_valuation,
      deleted_at = @deleted_at
      WHERE id = @id`).run(row)
  }

  deleteWeapon(id: string): void {
    getDb().prepare("DELETE FROM weapons WHERE id = ?").run(id)
  }

  insertShipment(s: Shipment): void {
    const db = getDb()
    const row = mappers.shipmentToRow(s)
    db.prepare(`INSERT INTO shipments (id, shipment_number, supplier_id, shipment_date, expected_arrival_date,
      total_expected_items, attachments, notes, status, timeline, purchase_order_number, invoice_number,
      shipping_carrier, container_number, currency, purchase_date, actual_arrival_date,
      line_items, documents, total_cost_valuation)
      VALUES (@id, @shipment_number, @supplier_id, @shipment_date, @expected_arrival_date,
      @total_expected_items, @attachments, @notes, @status, @timeline, @purchase_order_number, @invoice_number,
      @shipping_carrier, @container_number, @currency, @purchase_date, @actual_arrival_date,
      @line_items, @documents, @total_cost_valuation)`).run(row)
  }

  updateShipment(s: Shipment): void {
    const db = getDb()
    const row = mappers.shipmentToRow(s)
    db.prepare(`UPDATE shipments SET
      shipment_number = @shipment_number, supplier_id = @supplier_id, shipment_date = @shipment_date,
      expected_arrival_date = @expected_arrival_date, total_expected_items = @total_expected_items,
      attachments = @attachments, notes = @notes, status = @status, timeline = @timeline,
      purchase_order_number = @purchase_order_number, invoice_number = @invoice_number,
      shipping_carrier = @shipping_carrier, container_number = @container_number, currency = @currency,
      purchase_date = @purchase_date, actual_arrival_date = @actual_arrival_date,
      line_items = @line_items, documents = @documents, total_cost_valuation = @total_cost_valuation
      WHERE id = @id`).run(row)
  }

  insertInvoice(inv: Invoice): void {
    const db = getDb()
    const row = mappers.invoiceToRow(inv)
    db.prepare(`INSERT INTO invoices (id, invoice_number, type, customer_id, supplier_id, customer_name,
      date, due_date, total_original, total_negotiated, total_paid, balance, status,
      weapon_ids, line_items, sale_mode, employee_id, employee_name, attachments, shipment_id,
      notes, voided, tax_amount, total_valuation, currency, accounting_currency,
      exchange_rate, exchange_rate_date, rate_source, total_original_accounting,
      total_negotiated_accounting, total_paid_accounting, balance_accounting, tax_amount_accounting)
      VALUES (@id, @invoice_number, @type, @customer_id, @supplier_id, @customer_name,
      @date, @due_date, @total_original, @total_negotiated, @total_paid, @balance, @status,
      @weapon_ids, @line_items, @sale_mode, @employee_id, @employee_name, @attachments, @shipment_id,
      @notes, @voided, @tax_amount, @total_valuation, @currency, @accounting_currency,
      @exchange_rate, @exchange_rate_date, @rate_source, @total_original_accounting,
      @total_negotiated_accounting, @total_paid_accounting, @balance_accounting, @tax_amount_accounting)`).run(row)
  }

  updateInvoice(inv: Invoice): void {
    const db = getDb()
    const row = mappers.invoiceToRow(inv)
    db.prepare(`UPDATE invoices SET
      invoice_number = @invoice_number, type = @type, customer_id = @customer_id, supplier_id = @supplier_id,
      customer_name = @customer_name, date = @date, due_date = @due_date,
      total_original = @total_original, total_negotiated = @total_negotiated, total_paid = @total_paid,
      balance = @balance, status = @status, weapon_ids = @weapon_ids, line_items = @line_items,
      sale_mode = @sale_mode, employee_id = @employee_id, employee_name = @employee_name,
      attachments = @attachments, shipment_id = @shipment_id, notes = @notes, voided = @voided,
      tax_amount = @tax_amount, total_valuation = @total_valuation
      , currency = @currency, accounting_currency = @accounting_currency,
      exchange_rate = @exchange_rate, exchange_rate_date = @exchange_rate_date,
      rate_source = @rate_source, total_original_accounting = @total_original_accounting,
      total_negotiated_accounting = @total_negotiated_accounting,
      total_paid_accounting = @total_paid_accounting, balance_accounting = @balance_accounting,
      tax_amount_accounting = @tax_amount_accounting
      WHERE id = @id`).run(row)
  }

  insertPayment(p: PaymentRecord): void {
    const db = getDb()
    const row = mappers.paymentToRow(p)

    assertValidPaymentMethod(row.method as string)

    db.prepare(`
    INSERT INTO payment_records (
      id,
      invoice_id,
      invoice_number,
      date,
      amount,
      currency,
      accounting_amount,
      accounting_currency,
      exchange_rate,
      exchange_rate_date,
      rate_source,
      rate_id,
      method,
      employee,
      notes
    )
    VALUES (
      @id,
      @invoice_id,
      @invoice_number,
      @date,
      @amount,
      @currency,
      @accounting_amount,
      @accounting_currency,
      @exchange_rate,
      @exchange_rate_date,
      @rate_source,
      @rate_id,
      @method,
      @employee,
      @notes
    )
  `).run(row)
  }

  insertAccessory(a: Accessory): void {
    const db = getDb()
    const row = mappers.accessoryToRow(a)
    db.prepare(`INSERT INTO accessories (id, name, type, quantity, safety_threshold, price, price_currency, price_valuation, date_added, warehouse, shelf, bin)
      VALUES (@id, @name, @type, @quantity, @safety_threshold, @price, @price_currency, @price_valuation, @date_added, @warehouse, @shelf, @bin)`).run(row)
  }

  updateAccessory(a: Accessory): void {
    const db = getDb()
    const row = mappers.accessoryToRow(a)
    db.prepare(`UPDATE accessories SET name = @name, type = @type, quantity = @quantity, safety_threshold = @safety_threshold,
      price = @price, price_currency = @price_currency, price_valuation = @price_valuation,
      warehouse = @warehouse, shelf = @shelf, bin = @bin WHERE id = @id`).run(row)
  }

  insertAmmunition(a: Ammunition): void {
    const db = getDb()
    const row = mappers.ammoToRow(a)
    db.prepare(`INSERT INTO ammunition (id, caliber, package_type, units_per_package, full_packages, loose_rounds,
      safety_threshold, price, price_currency, price_valuation, date_added, warehouse, shelf, bin)
      VALUES (@id, @caliber, @package_type, @units_per_package, @full_packages, @loose_rounds,
      @safety_threshold, @price, @price_currency, @price_valuation, @date_added, @warehouse, @shelf, @bin)`).run(row)
  }

  updateAmmunition(a: Ammunition): void {
    const db = getDb()
    const row = mappers.ammoToRow(a)
    db.prepare(`UPDATE ammunition SET caliber = @caliber, package_type = @package_type, units_per_package = @units_per_package,
      full_packages = @full_packages, loose_rounds = @loose_rounds, safety_threshold = @safety_threshold,
      price = @price, price_currency = @price_currency, price_valuation = @price_valuation,
      warehouse = @warehouse, shelf = @shelf, bin = @bin WHERE id = @id`).run(row)
  }

  insertCustomer(c: Customer): void {
    const db = getDb()
    const row = mappers.customerToRow(c)
    db.prepare(`INSERT INTO customers (id, name, phone, email, address, is_wholesale_buyer, wholesale_discount_percent, date_added)
      VALUES (@id, @name, @phone, @email, @address, @is_wholesale_buyer, @wholesale_discount_percent, @date_added)`).run(row)
  }

  deleteCustomer(id: string): void {
    getDb().prepare("DELETE FROM customers WHERE id = ?").run(id)
  }

  insertSupplier(s: Supplier): void {
    const db = getDb()
    const row = mappers.supplierToRow(s)
    db.prepare(`INSERT INTO suppliers (id, name, contact_person, phone, email, address, date_added)
      VALUES (@id, @name, @contact_person, @phone, @email, @address, @date_added)`).run(row)
  }

  insertAuditLog(a: AuditLog): void {
    const db = getDb()
    const row = mappers.auditLogToRow(a)
    db.prepare(`INSERT INTO audit_logs (id, timestamp, date, user_id, action_type, description, metadata)
      VALUES (@id, @timestamp, @date, @user_id, @action_type, @description, @metadata)`).run(row)
  }

  insertNotification(n: AppNotification): void {
    const db = getDb()
    const row = mappers.notificationToRow(n)
    db.prepare(`INSERT INTO app_notifications (id, type, title, message, date, is_read, entity_id)
      VALUES (@id, @type, @title, @message, @date, @is_read, @entity_id)`).run(row)
  }

  updateNotification(n: AppNotification): void {
    const db = getDb()
    const row = mappers.notificationToRow(n)
    db.prepare(`UPDATE app_notifications SET type = @type, title = @title, message = @message,
      date = @date, is_read = @is_read, entity_id = @entity_id WHERE id = @id`).run(row)
  }

  deleteNotification(id: string): void {
    getDb().prepare("DELETE FROM app_notifications WHERE id = ?").run(id)
  }

  insertUser(u: User): void {
    const db = getDb()
    const row = mappers.userToRow(u)
    db.prepare(`INSERT INTO users (id, username, name, role, permissions, password_set, password_hash)
      VALUES (@id, @username, @name, @role, @permissions, @password_set, @password_hash)`).run(row)
  }

  updateUser(u: User): void {
    const db = getDb()
    const row = mappers.userToRow(u)
    db.prepare(`UPDATE users SET username = @username, name = @name, role = @role, permissions = @permissions,
      password_set = @password_set, password_hash = @password_hash WHERE id = @id`).run(row)
  }

  deleteUser(id: string): void {
    getDb().prepare("DELETE FROM users WHERE id = ?").run(id)
  }

  insertSavedFilter(f: SavedFilter): void {
    const db = getDb()
    const row = mappers.savedFilterToRow(f)
    db.prepare(`INSERT INTO saved_filters (id, name, entity_type, filter_state)
      VALUES (@id, @name, @entity_type, @filter_state)`).run(row)
  }

  deleteSavedFilter(id: string): void {
    getDb().prepare("DELETE FROM saved_filters WHERE id = ?").run(id)
  }

  // Currency operations
  getCurrencies(): CurrencyRow[] {
    const rows = getDb().prepare("SELECT * FROM currencies ORDER BY iso_code").all() as Record<string, unknown>[]
    return rows.map(rowToCurrencyRow)
  }

  getOverrides(): ExchangeRateOverrideRow[] {
    return getDb().prepare("SELECT * FROM exchange_rate_overrides ORDER BY currency_code").all() as ExchangeRateOverrideRow[]
  }

  updateCurrencyRate(code: string, rate: number, updatedAt: string): void {
    getDb().prepare("UPDATE currencies SET last_known_rate = ?, last_rate_updated_at = ? WHERE iso_code = ?").run(String(rate), updatedAt, code)
  }

  recordRateHistory(code: string, rate: number, source: string): void {
    const id = `rh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    getDb().prepare("INSERT INTO exchange_rate_history (id, currency_code, rate, source) VALUES (?, ?, ?, ?)").run(id, code, String(rate), source)
  }

  setManualOverride(code: string, rate: number, changedBy: string, reason: string, updatedAt: string): void {
    getDb().prepare(`INSERT INTO exchange_rate_overrides (currency_code, mode, manual_rate, updated_by, updated_at, reason)
      VALUES (?, 'manual', ?, ?, ?, ?)
      ON CONFLICT(currency_code) DO UPDATE SET mode = 'manual', manual_rate = ?, updated_by = ?, updated_at = ?, reason = ?`).run(
      code, String(rate), changedBy, updatedAt, reason, String(rate), changedBy, updatedAt, reason
    )
  }

  setAutomaticMode(code: string, changedBy: string, updatedAt: string): void {
    getDb().prepare(`INSERT INTO exchange_rate_overrides (currency_code, mode, updated_by, updated_at)
      VALUES (?, 'automatic', ?, ?)
      ON CONFLICT(currency_code) DO UPDATE SET mode = 'automatic', manual_rate = NULL, updated_by = ?, updated_at = ?`).run(
      code, changedBy, updatedAt, changedBy, updatedAt
    )
  }

  recordRateAuditLog(code: string, oldRate: number | null, newRate: number | null, changedBy: string, reason: string, changedAt: string, source: "manual" | "api" | "cache" | "default" = "manual"): void {
    const id = `ral-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    getDb().prepare(`INSERT INTO exchange_rate_audit_log (id, currency_code, old_rate, new_rate, changed_by, changed_at, reason, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, code, oldRate != null ? String(oldRate) : null, newRate != null ? String(newRate) : null, changedBy, changedAt, reason, source)
  }

  getRateAuditLog(limit: number = 50): AuditLogEntry[] {
    const rows = getDb().prepare(`SELECT * FROM exchange_rate_audit_log ORDER BY changed_at DESC LIMIT ?`).all(limit) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r.id as string,
      currencyCode: r.currency_code as string,
      oldRate: r.old_rate != null ? Number(r.old_rate) : null,
      newRate: r.new_rate != null ? Number(r.new_rate) : null,
      changedBy: r.changed_by as string | null,
      changedAt: r.changed_at as string,
      reason: r.reason as string | null,
      source: r.source as AuditLogEntry["source"],
    }))
  }

  addCurrency(isoCode: string, name: string, symbol: string, decimalPrecision: number, initialRate: number): void {
    getDb().prepare(`INSERT INTO currencies (iso_code, name, symbol, decimal_precision, is_active, last_known_rate, last_rate_updated_at)
      VALUES (?, ?, ?, ?, 1, ?, datetime('now'))`).run(isoCode, name, symbol, decimalPrecision, String(initialRate))
    getDb().prepare(`INSERT INTO exchange_rate_overrides (currency_code, mode) VALUES (?, 'automatic')`).run(isoCode)
  }

  toggleCurrencyActive(code: string, isActive: boolean): void {
    getDb().prepare("UPDATE currencies SET is_active = ? WHERE iso_code = ?").run(isActive ? 1 : 0, code)
  }

  // ===== Master Data CRUD =====

  getMasterData(): MasterDataAll {
    const db = getDb()
    return {
      weaponTypes: db.prepare("SELECT * FROM weapon_types ORDER BY sort_order, label").all() as never,
      weaponSubtypes: db.prepare("SELECT * FROM weapon_subtypes ORDER BY sort_order, label").all() as never,
      calibers: db.prepare("SELECT * FROM calibers ORDER BY label").all() as never,
      subtypeCalibers: db.prepare("SELECT * FROM subtype_calibers").all() as never,
      brands: db.prepare("SELECT * FROM brands ORDER BY label").all() as never,
      models: db.prepare("SELECT * FROM models ORDER BY label").all() as never,
      warehouses: db.prepare("SELECT * FROM warehouses ORDER BY label").all() as never,
      storageLocations: db.prepare("SELECT * FROM storage_locations ORDER BY shelf, bin").all() as never,
    }
  }


  // ---------- Get‑Or‑Create Helpers ----------

  getOrCreateWeaponType(label: string, sortOrder: number = 99): string {
    const db = getDb()
    const canonical = cleanMasterDataLabel(label, "Weapon type")
    const existing = findCanonicalMasterId(db.prepare("SELECT id, label FROM weapon_types").all() as Array<{ id: string; label: string }>, canonical)
    if (existing) return existing
    const id = `wt-${randomUUID()}`
    db.prepare("INSERT INTO weapon_types (id, label, sort_order) VALUES (?, ?, ?)").run(id, canonical, sortOrder)
    return id
  }

  getOrCreateWeaponSubtype(weaponTypeId: string, label: string, sortOrder: number = 99): string {
    const db = getDb()
    const canonical = cleanMasterDataLabel(label, "Weapon subtype")
    const rows = db.prepare("SELECT id, label FROM weapon_subtypes WHERE weapon_type_id = ?").all(weaponTypeId) as Array<{ id: string; label: string }>
    const existing = findCanonicalMasterId(rows, canonical)
    if (existing) return existing
    const id = `ws-${randomUUID()}`
    db.prepare("INSERT INTO weapon_subtypes (id, weapon_type_id, label, sort_order) VALUES (?, ?, ?, ?)").run(id, weaponTypeId, canonical, sortOrder)
    return id
  }

  getOrCreateCaliber(label: string): string {
    const db = getDb()
    const canonical = cleanMasterDataLabel(label, "Caliber")
    const existing = findCanonicalMasterId(db.prepare("SELECT id, label FROM calibers").all() as Array<{ id: string; label: string }>, canonical)
    if (existing) return existing
    const id = `cal-${randomUUID()}`
    db.prepare("INSERT INTO calibers (id, label) VALUES (?, ?)").run(id, canonical)
    return id
  }

  linkSubtypeCaliber(subtypeId: string, caliberId: string): void {
    getDb().prepare("INSERT OR IGNORE INTO subtype_calibers (subtype_id, caliber_id) VALUES (?, ?)").run(subtypeId, caliberId)
  }

  getOrCreateBrand(label: string): string {
    const db = getDb()
    const canonical = cleanMasterDataLabel(label, "Manufacturer")
    const existing = findCanonicalMasterId(db.prepare("SELECT id, label FROM brands").all() as Array<{ id: string; label: string }>, canonical)
    if (existing) return existing
    const id = `br-${randomUUID()}`
    db.prepare("INSERT INTO brands (id, label) VALUES (?, ?)").run(id, canonical)
    return id
  }

  getOrCreateModel(label: string, brandId: string): string {
    const db = getDb()
    const canonical = cleanMasterDataLabel(label, "Model")
    const rows = db.prepare("SELECT id, label FROM models WHERE brand_id = ?").all(brandId) as Array<{ id: string; label: string }>
    const existing = findCanonicalMasterId(rows, canonical)
    if (existing) return existing
    const id = `mdl-${randomUUID()}`
    db.prepare("INSERT INTO models (id, label, brand_id) VALUES (?, ?, ?)").run(id, canonical, brandId)
    return id
  }

  getOrCreateWarehouse(label: string): string {
    const db = getDb()
    const existing = db.prepare("SELECT id FROM warehouses WHERE label = ?").get(label) as { id: string } | undefined
    if (existing) return existing.id
    const id = `wh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    db.prepare("INSERT INTO warehouses (id, label) VALUES (?, ?)").run(id, label)
    return id
  }

  getOrCreateStorageLocation(warehouseId: string, shelf: string, bin: string): string {
    const db = getDb()
    const existing = db.prepare(
      "SELECT id FROM storage_locations WHERE warehouse_id = ? AND shelf = ? AND bin = ?"
    ).get(warehouseId, shelf, bin) as { id: string } | undefined
    if (existing) return existing.id
    const id = `loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    db.prepare("INSERT INTO storage_locations (id, warehouse_id, shelf, bin) VALUES (?, ?, ?, ?)").run(id, warehouseId, shelf, bin)
    return id
  }

  deleteMasterRow(table: string, id: string): void {
    const allowed = ["weapon_types", "weapon_subtypes", "calibers", "brands", "models", "warehouses", "storage_locations"]
    if (!allowed.includes(table)) throw new Error(`Cannot delete from table: ${table}`)
    getDb().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
  }


  getAccessoryById(id: string): Accessory | undefined {
    const db = getDb()
    const row = db.prepare("SELECT * FROM accessories WHERE id = ?").get(id) as Record<string, unknown> | undefined
    return row ? mappers.rowToAccessory(row as never) : undefined
  }

  getAmmunitionById(id: string): Ammunition | undefined {
    const db = getDb()
    const row = db.prepare("SELECT * FROM ammunition WHERE id = ?").get(id) as Record<string, unknown> | undefined
    return row ? mappers.rowToAmmo(row as never) : undefined
  }

  getWeaponById(id: string): Weapon | undefined {
    const db = getDb()
    const row = db.prepare(`
      SELECT
        w.*,
        wt.label AS weapon_type,
        ws.label AS sub_type,
        c.label AS caliber,
        b.label AS brand,
        m.label AS model,
        COALESCE(wh.label, '') AS warehouse,
        COALESCE(sl.shelf, '') AS shelf,
        COALESCE(sl.bin, '') AS bin
      FROM weapons w
      LEFT JOIN weapon_types wt ON wt.id = w.weapon_type_id
      LEFT JOIN weapon_subtypes ws ON ws.id = w.weapon_subtype_id
      LEFT JOIN calibers c ON c.id = w.caliber_id
      LEFT JOIN brands b ON b.id = w.brand_id
      LEFT JOIN models m ON m.id = w.model_id
      LEFT JOIN storage_locations sl ON sl.id = w.storage_location_id
      LEFT JOIN warehouses wh ON wh.id = sl.warehouse_id
      WHERE w.id = ? AND w.deleted_at IS NULL
    `).get(id) as Record<string, unknown> | undefined

    return row ? mappers.rowToWeapon(row as never) : undefined
  }

  // Compatibility getters (return weapon IDs)
  getAmmunitionCompatibleWeaponIds(ammoId: string): string[] {
    const db = getDb()
    const rows = db.prepare("SELECT weapon_id FROM ammunition_weapon_compatibility WHERE ammunition_id = ?").all(ammoId) as { weapon_id: string }[];
    return rows.map(r => r.weapon_id);
  }

  getAccessoryCompatibleWeaponIds(accessoryId: string): string[] {
    const db = getDb()
    const rows = db.prepare("SELECT weapon_id FROM accessory_weapon_compatibility WHERE accessory_id = ?").all(accessoryId) as { weapon_id: string }[];
    return rows.map(r => r.weapon_id);
  }

  // Set compatibility (atomic replace)
  setAmmunitionCompatibility(ammoId: string, weaponIds: string[]): void {
    const db = getDb()
    const deleteAll = db.prepare("DELETE FROM ammunition_weapon_compatibility WHERE ammunition_id = ?");
    const insert = db.prepare("INSERT OR IGNORE INTO ammunition_weapon_compatibility (ammunition_id, weapon_id) VALUES (?, ?)");
    db.transaction(() => {
      deleteAll.run(ammoId);
      for (const wid of weaponIds) {
        insert.run(ammoId, wid);
      }
    })();
  }

  setAccessoryCompatibility(accessoryId: string, weaponIds: string[]): void {
    const db = getDb()
    const deleteAll = db.prepare("DELETE FROM accessory_weapon_compatibility WHERE accessory_id = ?");
    const insert = db.prepare("INSERT OR IGNORE INTO accessory_weapon_compatibility (accessory_id, weapon_id) VALUES (?, ?)");
    db.transaction(() => {
      deleteAll.run(accessoryId);
      for (const wid of weaponIds) {
        insert.run(accessoryId, wid);
      }
    })();
  }

  // Weapon search for compatibility (with pagination)
  searchWeaponsForCompatibility(query: string, limit: number, offset: number): Weapon[] {
    const normalizedQuery = query.trim()
    const like = `%${normalizedQuery}%`
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 500))
    const safeOffset = Math.max(0, Math.trunc(offset))
    const db = getDb()

    const rows = db.prepare(`
      SELECT
        w.*,
        wt.label AS weapon_type,
        ws.label AS sub_type,
        c.label AS caliber,
        b.label AS brand,
        m.label AS model,
        COALESCE(wh.label, '') AS warehouse,
        COALESCE(sl.shelf, '') AS shelf,
        COALESCE(sl.bin, '') AS bin
      FROM weapons w
      LEFT JOIN weapon_types wt ON wt.id = w.weapon_type_id
      LEFT JOIN weapon_subtypes ws ON ws.id = w.weapon_subtype_id
      LEFT JOIN calibers c ON c.id = w.caliber_id
      LEFT JOIN brands b ON b.id = w.brand_id
      LEFT JOIN models m ON m.id = w.model_id
      LEFT JOIN storage_locations sl ON sl.id = w.storage_location_id
      LEFT JOIN warehouses wh ON wh.id = sl.warehouse_id
      WHERE w.deleted_at IS NULL
        AND (
          ? = ''
          OR w.serial_number LIKE ?
          OR b.label LIKE ?
          OR m.label LIKE ?
          OR wt.label LIKE ?
          OR ws.label LIKE ?
          OR c.label LIKE ?
        )
      ORDER BY w.serial_number COLLATE NOCASE
      LIMIT ? OFFSET ?
    `).all(
      normalizedQuery,
      like, like, like, like, like, like,
      safeLimit, safeOffset,
    ) as Record<string, unknown>[]

    return rows.map((row) => mappers.rowToWeapon(row as never))
  }

}

export const repo = new AppRepository()
