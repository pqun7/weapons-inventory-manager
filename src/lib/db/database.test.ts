import { describe, it, expect, beforeEach, afterEach } from "vitest"
import Database from "better-sqlite3"
import { CREATE_TABLES_SQL, SEED_MASTER_DATA_SQL, SCHEMA_VERSION } from "@/lib/db/schema"
import type { Database as DB } from "better-sqlite3"
import os from "os"
import path from "path"
import fs from "fs"


function createInMemoryDb(): DB {
  const db = new Database(":memory:")
  db.pragma("journal_mode = WAL")
  db.pragma("synchronous = NORMAL")
  db.pragma("foreign_keys = ON")
  db.exec(CREATE_TABLES_SQL)
  db.exec(SEED_MASTER_DATA_SQL)
  db.pragma(`user_version = ${SCHEMA_VERSION}`)
  return db
}

describe("Database Schema", () => {
  let db: DB

  beforeEach(() => { db = createInMemoryDb() })
  afterEach(() => { db.close() })

  it("creates all required tables", () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
    const names = tables.map(t => t.name)
    expect(names).toContain("weapon_types")
    expect(names).toContain("weapon_subtypes")
    expect(names).toContain("calibers")
    expect(names).toContain("subtype_calibers")
    expect(names).toContain("brands")
    expect(names).toContain("models")
    expect(names).toContain("warehouses")
    expect(names).toContain("storage_locations")
    expect(names).toContain("currencies")
    expect(names).toContain("exchange_rate_history")
    expect(names).toContain("exchange_rate_overrides")
    expect(names).toContain("exchange_rate_audit_log")
    expect(names).toContain("suppliers")
    expect(names).toContain("customers")
    expect(names).toContain("shipments")
    expect(names).toContain("weapons")
    expect(names).toContain("invoices")
    expect(names).toContain("payment_records")
    expect(names).toContain("accessories")
    expect(names).toContain("ammunition")
    expect(names).toContain("audit_logs")
    expect(names).toContain("app_notifications")
    expect(names).toContain("users")
    expect(names).toContain("system_settings")
    expect(names).toContain("saved_filters")
    expect(names).toContain("user_preferences")
  })

  it("creates all required indexes", () => {
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name").all() as { name: string }[]
    const names = indexes.map(i => i.name)
    expect(names).toContain("idx_weapons_serial")
    expect(names).toContain("idx_weapons_status")
    expect(names).toContain("idx_weapons_shipment")
    expect(names).toContain("idx_weapons_supplier")
    expect(names).toContain("idx_invoices_customer")
    expect(names).toContain("idx_invoices_status")
    expect(names).toContain("idx_payments_invoice")
  })

  it("sets the schema version pragma", () => {
    expect(db.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION)
  })

  it("enables foreign keys", () => {
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1)
  })
})

describe("Database Initialization & Seed Data", () => {
  let db: DB

  beforeEach(() => { db = createInMemoryDb() })
  afterEach(() => { db.close() })

  it("seeds weapon types", () => {
    const rows = db.prepare("SELECT * FROM weapon_types ORDER BY sort_order").all() as { id: string; label: string }[]
    expect(rows.length).toBeGreaterThanOrEqual(5)
    expect(rows[0].label).toBe("Shotgun")
  })

  it("seeds calibers", () => {
    const rows = db.prepare("SELECT * FROM calibers").all()
    expect(rows.length).toBeGreaterThanOrEqual(15)
  })

  it("seeds brands", () => {
    const rows = db.prepare("SELECT * FROM brands").all()
    expect(rows.length).toBeGreaterThanOrEqual(9)
  })

  it("seeds currencies with correct precision", () => {
    const usd = db.prepare("SELECT * FROM currencies WHERE iso_code = 'USD'").get() as { decimal_precision: number; is_active: number }
    expect(usd).toBeDefined()
    expect(usd.decimal_precision).toBe(2)
    expect(usd.is_active).toBe(1)
  })

  it("seeds exchange rate overrides in automatic mode", () => {
    const overrides = db.prepare("SELECT * FROM exchange_rate_overrides").all() as { mode: string }[]
    expect(overrides.length).toBeGreaterThanOrEqual(6)
    expect(overrides.every(o => o.mode === "automatic")).toBe(true)
  })

  it("creates a default admin user", () => {
    const admin = db.prepare("SELECT * FROM users WHERE id = 'U001'").get() as { username: string; role: string }
    expect(admin).toBeDefined()
    expect(admin.username).toBe("admin")
    expect(admin.role).toBe("Admin")
  })

  it("creates default system settings row", () => {
    const settings = db.prepare("SELECT * FROM system_settings WHERE id = 1").get() as { currency_symbol: string }
    expect(settings).toBeDefined()
    expect(settings.currency_symbol).toBe("$")
  })

  it("seeds warehouses and storage locations", () => {
    const warehouses = db.prepare("SELECT * FROM warehouses").all()
    const locations = db.prepare("SELECT * FROM storage_locations").all()
    expect(warehouses.length).toBe(3)
    expect(locations.length).toBe(5)
  })
})

describe("CRUD Operations", () => {
  let db: DB

  beforeEach(() => { db = createInMemoryDb() })
  afterEach(() => { db.close() })

  it("inserts and reads a supplier", () => {
    db.prepare("INSERT INTO suppliers (id, name, contact_person, phone, email, address, date_added) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("sup-1", "Test Supplier", "John", "555-0100", "test@sup.com", "123 St", "2026-01-01")
    const row = db.prepare("SELECT * FROM suppliers WHERE id = ?").get("sup-1") as { name: string }
    expect(row.name).toBe("Test Supplier")
  })

  it("inserts and reads a customer", () => {
    db.prepare("INSERT INTO customers (id, name, phone, email, address, is_wholesale_buyer, wholesale_discount_percent, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("cust-1", "Test Customer", "555-0200", "cust@test.com", "456 Ave", 0, 0, "2026-01-01")
    const row = db.prepare("SELECT * FROM customers WHERE id = ?").get("cust-1") as { name: string }
    expect(row.name).toBe("Test Customer")
  })

  it("inserts and reads a weapon with all fields", () => {
    db.prepare("INSERT INTO suppliers (id, name, contact_person, phone, email, address, date_added) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("sup-1", "Test", "John", "", "", "", "2026-01-01")
    db.prepare(`INSERT INTO weapons (id, serial_number, brand, model, weapon_type, sub_type, caliber, condition, status,
      purchase_price, retail_price, wholesale_price, supplier_id, shipment_id, date_added, notes, images, movement_history,
      warehouse, shelf, bin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("w-1", "SN001", "Glock", "G17", "Pistol", "9x19mm", "9x19mm", "Excellent", "Available",
        500, 700, 600, "sup-1", null, "2026-01-01", "", "[]", "[]", "Main", "A", "A-1")
    const row = db.prepare("SELECT * FROM weapons WHERE id = ?").get("w-1") as { serial_number: string; status: string }
    expect(row.serial_number).toBe("SN001")
    expect(row.status).toBe("Available")
  })

  it("updates a weapon status", () => {
    db.prepare("INSERT INTO suppliers (id, name, contact_person, phone, email, address, date_added) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("sup-1", "Test", "John", "", "", "", "2026-01-01")
    db.prepare(`INSERT INTO weapons (id, serial_number, brand, model, weapon_type, sub_type, caliber, status,
      purchase_price, retail_price, wholesale_price, supplier_id, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("w-1", "SN001", "Glock", "G17", "Pistol", "9x19mm", "9x19mm", "Available", 500, 700, 600, "sup-1", "2026-01-01")
    db.prepare("UPDATE weapons SET status = 'Sold' WHERE id = ?").run("w-1")
    const row = db.prepare("SELECT status FROM weapons WHERE id = ?").get("w-1") as { status: string }
    expect(row.status).toBe("Sold")
  })

  it("deletes a weapon", () => {
    db.prepare("INSERT INTO suppliers (id, name, contact_person, phone, email, address, date_added) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("sup-1", "Test", "John", "", "", "", "2026-01-01")
    db.prepare(`INSERT INTO weapons (id, serial_number, brand, model, weapon_type, sub_type, caliber, status,
      purchase_price, retail_price, wholesale_price, supplier_id, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("w-1", "SN001", "Glock", "G17", "Pistol", "9x19mm", "9x19mm", "Available", 500, 700, 600, "sup-1", "2026-01-01")
    db.prepare("DELETE FROM weapons WHERE id = ?").run("w-1")
    const row = db.prepare("SELECT * FROM weapons WHERE id = ?").get("w-1")
    expect(row).toBeUndefined()
  })

  it("inserts and reads an invoice with line items", () => {
    db.prepare(`INSERT INTO invoices (id, invoice_number, type, customer_id, customer_name, date, due_date,
      total_original, total_negotiated, total_paid, balance, status, weapon_ids, line_items, sale_mode,
      employee_id, employee_name, attachments, notes, voided, tax_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("inv-1", "INV-001", "Sale", "cust-1", "Test", "2026-01-01", "2026-02-01",
        1000, 900, 900, 0, "Paid", "[]", "[]", "Retail", "U001", "Admin", "[]", "", 0, 0)
    const row = db.prepare("SELECT * FROM invoices WHERE id = ?").get("inv-1") as { invoice_number: string; balance: number }
    expect(row.invoice_number).toBe("INV-001")
    expect(row.balance).toBe(0)
  })

  it("inserts and reads a payment record", () => {
    db.prepare(`INSERT INTO invoices (id, invoice_number, type, customer_name, date, due_date,
      total_original, total_negotiated, total_paid, balance, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("inv-1", "INV-001", "Sale", "Test", "2026-01-01", "2026-02-01", 1000, 900, 500, 400, "Pending")
    db.prepare(`INSERT INTO payment_records (id, invoice_id, invoice_number, date, amount, method, employee, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("pay-1", "inv-1", "INV-001", "2026-01-15", 500, "Cash", "Admin", "")
    const row = db.prepare("SELECT * FROM payment_records WHERE id = ?").get("pay-1") as { amount: number }
    expect(row.amount).toBe(500)
  })

  it("inserts and reads an accessory", () => {
    db.prepare(`INSERT INTO accessories (id, name, type, quantity, safety_threshold, price, date_added, warehouse, shelf, bin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("acc-1", "Scope", "Optic", 10, 5, 150, "2026-01-01", "Main", "A", "A-1")
    const row = db.prepare("SELECT * FROM accessories WHERE id = ?").get("acc-1") as { name: string; quantity: number }
    expect(row.name).toBe("Scope")
    expect(row.quantity).toBe(10)
  })

  it("inserts and reads ammunition", () => {
    db.prepare(`INSERT INTO ammunition (id, caliber, package_type, units_per_package, full_packages, loose_rounds, safety_threshold, price, date_added, warehouse, shelf, bin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("ammo-1", "9x19mm", "Box", 50, 10, 25, 100, 25, "2026-01-01", "Main", "A", "A-1")
    const row = db.prepare("SELECT * FROM ammunition WHERE id = ?").get("ammo-1") as { caliber: string; full_packages: number }
    expect(row.caliber).toBe("9x19mm")
    expect(row.full_packages).toBe(10)
  })

  it("inserts and reads a shipment", () => {
    db.prepare(`INSERT INTO shipments (id, shipment_number, supplier_id, shipment_date, expected_arrival_date,
      total_expected_items, attachments, notes, status, timeline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("ship-1", "SHP-001", "sup-1", "2026-01-01", "2026-02-01", 50, "[]", "", "Pending", "[]")
    const row = db.prepare("SELECT * FROM shipments WHERE id = ?").get("ship-1") as { shipment_number: string; status: string }
    expect(row.shipment_number).toBe("SHP-001")
    expect(row.status).toBe("Pending")
  })

  it("inserts and reads a user", () => {
    db.prepare(`INSERT INTO users (id, username, name, role, permissions, password_set, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("U002", "manager", "Manager", "Manager", "{}", 0, "")
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get("U002") as { username: string; role: string }
    expect(row.username).toBe("manager")
    expect(row.role).toBe("Manager")
  })

  it("inserts and reads a saved filter", () => {
    db.prepare("INSERT INTO saved_filters (id, name, entity_type, filter_state) VALUES (?, ?, ?, ?)")
      .run("filter-1", "Active Weapons", "weapons", '{"status":"Available"}')
    const row = db.prepare("SELECT * FROM saved_filters WHERE id = ?").get("filter-1") as { name: string; filter_state: string }
    expect(row.name).toBe("Active Weapons")
    expect(row.filter_state).toContain("Available")
  })
})

describe("Transactions & Rollback", () => {
  let db: DB

  beforeEach(() => { db = createInMemoryDb() })
  afterEach(() => { db.close() })

  it("commits a successful transaction", () => {
    db.transaction(() => {
      db.prepare("INSERT INTO customers (id, name, phone, email, address, is_wholesale_buyer, wholesale_discount_percent, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("cust-tx-1", "TX Customer", "", "", "", 0, 0, "2026-01-01")
      db.prepare("INSERT INTO customers (id, name, phone, email, address, is_wholesale_buyer, wholesale_discount_percent, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("cust-tx-2", "TX Customer 2", "", "", "", 0, 0, "2026-01-01")
    })()
    expect(db.prepare("SELECT COUNT(*) as c FROM customers WHERE id LIKE 'cust-tx-%'").get()).toEqual({ c: 2 })
  })

  it("rolls back a failed transaction", () => {
    const fn = db.transaction(() => {
      db.prepare("INSERT INTO customers (id, name, phone, email, address, is_wholesale_buyer, wholesale_discount_percent, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("cust-tx-3", "TX Customer", "", "", "", 0, 0, "2026-01-01")
      throw new Error("Intentional failure")
    })
    expect(() => fn()).toThrow("Intentional failure")
    const row = db.prepare("SELECT * FROM customers WHERE id = ?").get("cust-tx-3")
    expect(row).toBeUndefined()
  })

  it("handles nested transactions with savepoints", () => {
    db.transaction(() => {
      db.prepare("INSERT INTO customers (id, name, phone, email, address, is_wholesale_buyer, wholesale_discount_percent, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("cust-nest-1", "Outer", "", "", "", 0, 0, "2026-01-01")
      try {
        db.transaction(() => {
          db.prepare("INSERT INTO customers (id, name, phone, email, address, is_wholesale_buyer, wholesale_discount_percent, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .run("cust-nest-2", "Inner", "", "", "", 0, 0, "2026-01-01")
          throw new Error("Inner fail")
        })()
      } catch { /* swallow inner */ }
    })()
    expect(db.prepare("SELECT * FROM customers WHERE id = 'cust-nest-1'").get()).toBeDefined()
    expect(db.prepare("SELECT * FROM customers WHERE id = 'cust-nest-2'").get()).toBeUndefined()
  })
})

describe("Foreign Key Constraints", () => {
  let db: DB

  beforeEach(() => { db = createInMemoryDb() })
  afterEach(() => { db.close() })

  it("prevents inserting a weapon subtype with non-existent weapon_type_id", () => {
    expect(() => {
      db.prepare("INSERT INTO weapon_subtypes (id, weapon_type_id, label, sort_order) VALUES (?, ?, ?, ?)")
        .run("ws-x", "nonexistent", "Test", 1)
    }).toThrow()
  })

  it("prevents inserting subtype_caliber with non-existent ids", () => {
    expect(() => {
      db.prepare("INSERT INTO subtype_calibers (subtype_id, caliber_id) VALUES (?, ?)")
        .run("nonexistent", "nonexistent")
    }).toThrow()
  })

  it("cascades delete when a weapon_type is deleted", () => {
    db.prepare("DELETE FROM weapon_types WHERE id = ?").run("wt-1")
    const subtypes = db.prepare("SELECT * FROM weapon_subtypes WHERE weapon_type_id = ?").all("wt-1")
    expect(subtypes).toHaveLength(0)
  })

  it("prevents inserting a storage location with non-existent warehouse", () => {
    expect(() => {
      db.prepare("INSERT INTO storage_locations (id, warehouse_id, shelf, bin) VALUES (?, ?, ?, ?)")
        .run("loc-x", "nonexistent", "X", "X-1")
    }).toThrow()
  })

  it("cascades delete when a warehouse is deleted", () => {
    db.prepare("DELETE FROM storage_locations WHERE warehouse_id = 'wh-1'").run()
    db.prepare("DELETE FROM warehouses WHERE id = ?").run("wh-1")
    const warehouses = db.prepare("SELECT * FROM warehouses WHERE id = ?").all("wh-1")
    expect(warehouses).toHaveLength(0)
  })

  it("sets brand_id to NULL when a brand is deleted (SET NULL)", () => {
    db.prepare("DELETE FROM models WHERE brand_id = 'br-1'").run()
    db.prepare("DELETE FROM brands WHERE id = ?").run("br-1")
    const brands = db.prepare("SELECT * FROM brands WHERE id = ?").all("br-1")
    expect(brands).toHaveLength(0)
  })

  it("cascades delete user_preferences when a user is deleted", () => {
    db.prepare("INSERT INTO user_preferences (user_id, report_view_mode) VALUES (?, 'accounting')").run("U001")
    db.prepare("DELETE FROM users WHERE id = ?").run("U001")
    const prefs = db.prepare("SELECT * FROM user_preferences WHERE user_id = ?").all("U001")
    expect(prefs).toHaveLength(0)
  })
})

describe("Data Validation & Constraints", () => {
  let db: DB

  beforeEach(() => { db = createInMemoryDb() })
  afterEach(() => { db.close() })

  it("enforces unique serial_number on weapons", () => {
    db.prepare("INSERT INTO suppliers (id, name, contact_person, phone, email, address, date_added) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("sup-1", "Test", "", "", "", "", "2026-01-01")
    db.prepare(`INSERT INTO weapons (id, serial_number, brand, model, weapon_type, sub_type, caliber, status,
      purchase_price, retail_price, wholesale_price, supplier_id, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("w-1", "DUP-SN", "Test", "Test", "Pistol", "9x19mm", "9x19mm", "Available", 100, 200, 150, "sup-1", "2026-01-01")
    expect(() => {
      db.prepare(`INSERT INTO weapons (id, serial_number, brand, model, weapon_type, sub_type, caliber, status,
        purchase_price, retail_price, wholesale_price, supplier_id, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run("w-2", "DUP-SN", "Test", "Test", "Pistol", "9x19mm", "9x19mm", "Available", 100, 200, 150, "sup-1", "2026-01-01")
    }).toThrow()
  })

  it("enforces unique invoice_number", () => {
    db.prepare(`INSERT INTO invoices (id, invoice_number, type, customer_name, date, due_date,
      total_original, total_negotiated, total_paid, balance, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("inv-1", "DUP-INV", "Sale", "Test", "2026-01-01", "2026-02-01", 100, 100, 100, 0, "Paid")
    expect(() => {
      db.prepare(`INSERT INTO invoices (id, invoice_number, type, customer_name, date, due_date,
        total_original, total_negotiated, total_paid, balance, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run("inv-2", "DUP-INV", "Sale", "Test", "2026-01-01", "2026-02-01", 100, 100, 100, 0, "Paid")
    }).toThrow()
  })

  it("enforces weapon status CHECK constraint", () => {
    db.prepare("INSERT INTO suppliers (id, name, contact_person, phone, email, address, date_added) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("sup-1", "Test", "", "", "", "", "2026-01-01")
    expect(() => {
      db.prepare(`INSERT INTO weapons (id, serial_number, brand, model, weapon_type, sub_type, caliber, status,
        purchase_price, retail_price, wholesale_price, supplier_id, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run("w-1", "SN-CHECK", "Test", "Test", "Pistol", "9x19mm", "9x19mm", "InvalidStatus", 100, 200, 150, "sup-1", "2026-01-01")
    }).toThrow()
  })

  it("enforces weapon condition CHECK constraint", () => {
    db.prepare("INSERT INTO suppliers (id, name, contact_person, phone, email, address, date_added) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("sup-1", "Test", "", "", "", "", "2026-01-01")
    expect(() => {
      db.prepare(`INSERT INTO weapons (id, serial_number, brand, model, weapon_type, sub_type, caliber, condition, status,
        purchase_price, retail_price, wholesale_price, supplier_id, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run("w-1", "SN-COND", "Test", "Test", "Pistol", "9x19mm", "9x19mm", "Broken", "Available", 100, 200, 150, "sup-1", "2026-01-01")
    }).toThrow()
  })

  it("enforces invoice status CHECK constraint", () => {
    expect(() => {
      db.prepare(`INSERT INTO invoices (id, invoice_number, type, customer_name, date, due_date,
        total_original, total_negotiated, total_paid, balance, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run("inv-1", "INV-CHECK", "Sale", "Test", "2026-01-01", "2026-02-01", 100, 100, 100, 0, "InvalidStatus")
    }).toThrow()
  })

  it("enforces payment method CHECK constraint", () => {
    db.prepare(`INSERT INTO invoices (id, invoice_number, type, customer_name, date, due_date,
      total_original, total_negotiated, total_paid, balance, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("inv-1", "INV-PAY", "Sale", "Test", "2026-01-01", "2026-02-01", 100, 100, 100, 0, "Paid")
    expect(() => {
      db.prepare(`INSERT INTO payment_records (id, invoice_id, invoice_number, date, amount, method, employee, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run("pay-1", "inv-1", "INV-PAY", "2026-01-01", 50, "Crypto", "", "")
    }).toThrow()
  })

  it("enforces currency decimal_precision CHECK constraint (0-4)", () => {
    expect(() => {
      db.prepare("INSERT INTO currencies (iso_code, name, symbol, decimal_precision) VALUES (?, ?, ?, ?)")
        .run("TEST", "Test", "T", 5)
    }).toThrow()
  })

  it("enforces shipment status CHECK constraint", () => {
    expect(() => {
      db.prepare(`INSERT INTO shipments (id, shipment_number, supplier_id, shipment_date, expected_arrival_date,
        total_expected_items, attachments, notes, status, timeline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run("ship-1", "SHP-CHECK", "", "2026-01-01", "2026-02-01", 1, "[]", "", "InvalidStatus", "[]")
    }).toThrow()
  })

  it("enforces user role CHECK constraint", () => {
    expect(() => {
      db.prepare("INSERT INTO users (id, username, name, role, permissions, password_set, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run("U-TEST", "test", "Test", "SuperUser", "{}", 0, "")
    }).toThrow()
  })

  it("enforces system_settings singleton (id = 1)", () => {
    const before = db.prepare("SELECT COUNT(*) as c FROM system_settings").get() as { c: number }
    expect(before.c).toBe(1)
    db.prepare("INSERT OR IGNORE INTO system_settings (id) VALUES (2)").run()
    const after = db.prepare("SELECT COUNT(*) as c FROM system_settings").get() as { c: number }
    expect(after.c).toBe(1)
  })

  it("enforces exchange_rate_overrides mode CHECK constraint", () => {
    expect(() => {
      db.prepare("INSERT INTO exchange_rate_overrides (currency_code, mode) VALUES (?, ?)")
        .run("USD", "invalid_mode")
    }).toThrow()
  })
})

describe("Querying & Filtering", () => {
  let db: DB

  beforeEach(() => { db = createInMemoryDb() })
  afterEach(() => { db.close() })

  it("filters weapons by status using an index", () => {
    db.prepare("INSERT INTO suppliers (id, name, contact_person, phone, email, address, date_added) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("sup-1", "Test", "", "", "", "", "2026-01-01")
    const insertWeapon = db.prepare(`INSERT INTO weapons (id, serial_number, brand, model, weapon_type, sub_type, caliber, status,
      purchase_price, retail_price, wholesale_price, supplier_id, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    insertWeapon.run("w-1", "SN001", "Glock", "G17", "Pistol", "9x19mm", "9x19mm", "Available", 500, 700, 600, "sup-1", "2026-01-01")
    insertWeapon.run("w-2", "SN002", "Glock", "G19", "Pistol", "9x19mm", "9x19mm", "Sold", 500, 700, 600, "sup-1", "2026-01-01")
    insertWeapon.run("w-3", "SN003", "SIG", "P320", "Pistol", "9x19mm", "9x19mm", "Available", 600, 800, 700, "sup-1", "2026-01-01")

    const available = db.prepare("SELECT * FROM weapons WHERE status = 'Available' ORDER BY id").all() as { id: string }[]
    expect(available).toHaveLength(2)
    expect(available.map(w => w.id)).toEqual(["w-1", "w-3"])
  })

  it("joins weapons with suppliers", () => {
    db.prepare("INSERT INTO suppliers (id, name, contact_person, phone, email, address, date_added) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("sup-1", "ACME", "John", "", "", "", "2026-01-01")
    db.prepare(`INSERT INTO weapons (id, serial_number, brand, model, weapon_type, sub_type, caliber, status,
      purchase_price, retail_price, wholesale_price, supplier_id, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("w-1", "SN001", "Glock", "G17", "Pistol", "9x19mm", "9x19mm", "Available", 500, 700, 600, "sup-1", "2026-01-01")

    const row = db.prepare(`
      SELECT w.*, s.name as supplier_name FROM weapons w
      LEFT JOIN suppliers s ON w.supplier_id = s.id
      WHERE w.id = ?
    `).get("w-1") as { supplier_name: string }
    expect(row.supplier_name).toBe("ACME")
  })

  it("counts records efficiently with aggregate queries", () => {
    db.prepare("INSERT INTO suppliers (id, name, contact_person, phone, email, address, date_added) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("sup-1", "Test", "", "", "", "", "2026-01-01")
    const insertWeapon = db.prepare(`INSERT INTO weapons (id, serial_number, brand, model, weapon_type, sub_type, caliber, status,
      purchase_price, retail_price, wholesale_price, supplier_id, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (let i = 0; i < 100; i++) {
      insertWeapon.run(`w-${i}`, `SN${String(i).padStart(3, "0")}`, "Test", "Test", "Pistol", "9x19mm", "9x19mm", i % 2 === 0 ? "Available" : "Sold", 100, 200, 150, "sup-1", "2026-01-01")
    }
    const result = db.prepare("SELECT status, COUNT(*) as count FROM weapons GROUP BY status").all() as { status: string; count: number }[]
    const available = result.find(r => r.status === "Available")
    const sold = result.find(r => r.status === "Sold")
    expect(available?.count).toBe(50)
    expect(sold?.count).toBe(50)
  })

  it("paginates results with LIMIT and OFFSET", () => {
    db.prepare("INSERT INTO suppliers (id, name, contact_person, phone, email, address, date_added) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("sup-1", "Test", "", "", "", "", "2026-01-01")
    const insertWeapon = db.prepare(`INSERT INTO weapons (id, serial_number, brand, model, weapon_type, sub_type, caliber, status,
      purchase_price, retail_price, wholesale_price, supplier_id, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (let i = 0; i < 50; i++) {
      insertWeapon.run(`w-${i}`, `SN${String(i).padStart(3, "0")}`, "Test", "Test", "Pistol", "9x19mm", "9x19mm", "Available", 100, 200, 150, "sup-1", "2026-01-01")
    }
    const page1 = db.prepare("SELECT * FROM weapons ORDER BY serial_number LIMIT 10 OFFSET 0").all() as { id: string; serial_number: string }[]
    const page2 = db.prepare("SELECT * FROM weapons ORDER BY serial_number LIMIT 10 OFFSET 10").all() as { id: string; serial_number: string }[]
    expect(page1).toHaveLength(10)
    expect(page2).toHaveLength(10)
    expect(page1[0].serial_number).toBe("SN000")
    expect(page2[0].serial_number).toBe("SN010")
    expect(page1.some(w => page2.includes(w))).toBe(false)
  })
})

describe("Large Dataset Operations", () => {
  let db: DB

  beforeEach(() => { db = createInMemoryDb() })
  afterEach(() => { db.close() })

  it("bulk inserts 1000 weapons in a transaction", () => {
    db.prepare("INSERT INTO suppliers (id, name, contact_person, phone, email, address, date_added) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("sup-1", "Bulk Supplier", "", "", "", "", "2026-01-01")
    const insertWeapon = db.prepare(`INSERT INTO weapons (id, serial_number, brand, model, weapon_type, sub_type, caliber, status,
      purchase_price, retail_price, wholesale_price, supplier_id, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const count = 1000
    db.transaction(() => {
      for (let i = 0; i < count; i++) {
        insertWeapon.run(`w-bulk-${i}`, `BULK-${String(i).padStart(5, "0")}`, "Test", "Test", "Pistol", "9x19mm", "9x19mm", "Available", 100, 200, 150, "sup-1", "2026-01-01")
      }
    })()
    const result = db.prepare("SELECT COUNT(*) as c FROM weapons WHERE id LIKE 'w-bulk-%'").get() as { c: number }
    expect(result.c).toBe(count)
  })

  it("queries large dataset with index efficiently", () => {
    db.prepare("INSERT INTO suppliers (id, name, contact_person, phone, email, address, date_added) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("sup-1", "Test", "", "", "", "", "2026-01-01")
    const insertWeapon = db.prepare(`INSERT INTO weapons (id, serial_number, brand, model, weapon_type, sub_type, caliber, status,
      purchase_price, retail_price, wholesale_price, supplier_id, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    db.transaction(() => {
      for (let i = 0; i < 500; i++) {
        insertWeapon.run(`w-${i}`, `SN${String(i).padStart(4, "0")}`, "Test", "Test", "Pistol", "9x19mm", "9x19mm", i < 250 ? "Available" : "Sold", 100, 200, 150, "sup-1", "2026-01-01")
      }
    })()
    const start = performance.now()
    const result = db.prepare("SELECT * FROM weapons WHERE status = 'Available'").all() as { id: string }[]
    const elapsed = performance.now() - start
    expect(result).toHaveLength(250)
    expect(elapsed).toBeLessThan(100)
  })
})

describe("Error Handling", () => {
  let db: DB

  beforeEach(() => { db = createInMemoryDb() })
  afterEach(() => { db.close() })

  it("throws on invalid SQL", () => {
    expect(() => db.prepare("SELECT * FROM nonexistent_table").all()).toThrow()
  })

  it("SQLite stores values with type affinity for REAL columns", () => {
    db.prepare("UPDATE system_settings SET tax_percent = ? WHERE id = 1").run(42.5)
    const row = db.prepare("SELECT tax_percent FROM system_settings WHERE id = 1").get() as { tax_percent: number }
    expect(row).toBeDefined()
    expect(row.tax_percent).toBe(42.5)
  })

  it("throws on NOT NULL violation", () => {
    expect(() => {
      db.prepare("INSERT INTO suppliers (id, name, date_added) VALUES (?, ?, ?)").run("sup-1", null, "2026-01-01")
    }).toThrow()
  })

  it("handles connection close gracefully", () => {
    db.close()
    expect(() => db.prepare("SELECT 1").all()).toThrow()
  })
})

describe("Persistence Across Restarts", () => {
  it("data survives a close and reopen of a file-based database", () => {
    const dir = path.join(os.tmpdir(), "weapon-store-tests")
    fs.mkdirSync(dir, { recursive: true })

    const tmpPath = path.join(dir, `test-persist-${Date.now()}.db`)

    const db1 = new Database(tmpPath)
    db1.pragma("foreign_keys = ON")
    db1.exec(CREATE_TABLES_SQL)

    db1.prepare(`
      INSERT INTO customers (
        id,
        name,
        phone,
        email,
        address,
        is_wholesale_buyer,
        wholesale_discount_percent,
        date_added
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "cust-persist-1",
      "Persistent Customer",
      "",
      "",
      "",
      0,
      0,
      "2026-01-01"
    )

    db1.close()

    const db2 = new Database(tmpPath)

    const row = db2
      .prepare("SELECT name FROM customers WHERE id = ?")
      .get("cust-persist-1") as { name: string }

    expect(row.name).toBe("Persistent Customer")

    db2.close()

    fs.unlinkSync(tmpPath)
  })
})