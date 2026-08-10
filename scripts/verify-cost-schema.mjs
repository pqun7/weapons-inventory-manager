import assert from "node:assert/strict"
import Database from "better-sqlite3"
import { CREATE_TABLES_SQL, SCHEMA_VERSION, SEED_MASTER_DATA_SQL } from "../dist-electron/src/lib/db/schema.js"

const database = new Database(":memory:")
try {
  database.pragma("foreign_keys = ON")
  database.exec(CREATE_TABLES_SQL)
  database.exec(SEED_MASTER_DATA_SQL)
  database.pragma(`user_version = ${SCHEMA_VERSION}`)

  const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all())
  for (const table of [
    "shipment_items", "product_costs", "shipment_costs", "shipment_cost_scope_items",
    "shipment_cost_allocations", "inventory_cost_snapshots",
  ]) assert(tables.has(table), `missing table ${table}`)
  assert.equal(database.pragma("user_version", { simple: true }), 8)

  database.prepare(`
    INSERT INTO shipments
      (id, shipment_number, supplier_id, shipment_date, expected_arrival_date, currency)
    VALUES ('VERIFY-SHP', 'VERIFY-SHP', '', '2026-08-10', '2026-08-10', 'USD')
  `).run()
  database.prepare(`
    INSERT INTO shipment_items
      (id, shipment_id, product_type, quantity, unit_purchase_amount, currency_code,
       exchange_rate, unit_purchase_base_amount, base_currency_code, exchange_rate_date, rate_source)
    VALUES ('VERIFY-ITEM', 'VERIFY-SHP', 'future-product', '1', '50.00', 'USD', '1',
      '50.0000', 'USD', '2026-08-10T00:00:00.000Z', 'manual')
  `).run()
  database.prepare(`
    INSERT INTO shipment_costs
      (id, shipment_id, name, calculation_type, input_amount, calculation_base,
       calculated_amount, currency_code, exchange_rate, base_amount, base_currency_code,
       exchange_rate_date, rate_source, scope, allocation_method, created_by)
    VALUES ('VERIFY-COST', 'VERIFY-SHP', 'Customs', 'fixed', '10.00',
      'original_purchase_cost', '10.00', 'USD', '1', '10.0000', 'USD',
      '2026-08-10T00:00:00.000Z', 'manual', 'single_product', 'by_value', 'U001')
  `).run()
  database.prepare("INSERT INTO shipment_cost_scope_items VALUES ('VERIFY-COST', 'VERIFY-ITEM')").run()
  database.prepare(`
    INSERT INTO shipment_cost_allocations
      (id, shipment_id, shipment_item_id, cost_id, automatic_amount, final_amount,
       manual_override, difference, currency_code, exchange_rate, automatic_base_amount,
       final_base_amount, base_currency_code, allocation_method)
    VALUES ('VERIFY-ALLOC', 'VERIFY-SHP', 'VERIFY-ITEM', 'VERIFY-COST', '8.00', '10.00',
      1, '2.00', 'USD', '1', '8.0000', '10.0000', 'USD', 'by_value')
  `).run()
  const allocation = database.prepare("SELECT * FROM shipment_cost_allocations WHERE id = 'VERIFY-ALLOC'").get()
  assert.equal(allocation.automatic_amount, "8.00")
  assert.equal(allocation.final_amount, "10.00")
  assert.equal(allocation.manual_override, 1)
  assert.equal(allocation.difference, "2.00")
  assert.deepEqual(database.pragma("foreign_key_check"), [])
  console.log("Cost schema verification passed (V8, constraints, allocations, foreign keys).")
} finally {
  database.close()
}

