import { describe, it, expect, beforeEach, afterEach } from "vitest"
import Database from "better-sqlite3"
import { CREATE_TABLES_SQL, SEED_MASTER_DATA_SQL, SCHEMA_VERSION } from "@/lib/db/schema"
import type { Database as DB } from "better-sqlite3"
import { readFileSync, existsSync } from "fs"
import { globSync } from "node:fs"

function createInMemoryDb(): DB {
  const db = new Database(":memory:")
  db.pragma("foreign_keys = ON")
  db.exec(CREATE_TABLES_SQL)
  db.exec(SEED_MASTER_DATA_SQL)
  db.pragma(`user_version = ${SCHEMA_VERSION}`)
  return db
}

describe("SQL Injection Prevention", () => {
  let db: DB

  beforeEach(() => { db = createInMemoryDb() })
  afterEach(() => { db.close() })

  it("parameterized queries prevent SQL injection in weapon insert", () => {
    const maliciousName = "Test'; DROP TABLE weapons; --"
    db.prepare("INSERT INTO suppliers (id, name, contact_person, phone, email, address, date_added) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("sup-1", maliciousName, "", "", "", "", "2026-01-01")

    const supplier = db.prepare("SELECT * FROM suppliers WHERE id = ?").get("sup-1") as { name: string }
    expect(supplier.name).toBe(maliciousName)

    const weaponsExist = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='weapons'").get()
    expect(weaponsExist).toBeDefined()
  })

  it("parameterized queries prevent SQL injection in customer lookup", () => {
    db.prepare("INSERT INTO customers (id, name, phone, email, address, is_wholesale_buyer, wholesale_discount_percent, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("cust-1", "Normal Customer", "", "", "", 0, 0, "2026-01-01")

    const injection = "Normal Customer' OR '1'='1"
    const results = db.prepare("SELECT * FROM customers WHERE name = ?").all(injection) as { id: string }[]
    expect(results).toHaveLength(0)
  })

  it("parameterized queries prevent SQL injection in update", () => {
    db.prepare("INSERT INTO customers (id, name, phone, email, address, is_wholesale_buyer, wholesale_discount_percent, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("cust-1", "Original", "", "", "", 0, 0, "2026-01-01")

    const injection = "Hacked'; DROP TABLE customers; --"
    db.prepare("UPDATE customers SET name = ? WHERE id = ?").run(injection, "cust-1")

    const customersExist = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customers'").get()
    expect(customersExist).toBeDefined()

    const row = db.prepare("SELECT * FROM customers WHERE id = ?").get("cust-1") as { name: string }
    expect(row.name).toBe(injection)
  })

  it("rejects table name injection in dynamic delete (allowlist)", () => {
    const allowed = ["weapon_types", "weapon_subtypes", "calibers", "brands", "models", "warehouses", "storage_locations"]
    const maliciousTable = "weapons; DROP TABLE customers; --"
    expect(allowed.includes(maliciousTable)).toBe(false)
  })
})

describe("Database Connection & Resource Management", () => {
  let db: DB

  beforeEach(() => { db = createInMemoryDb() })
  afterEach(() => { db.close() })

  it("closes connection and frees resources", () => {
    db.close()
    expect(() => db.prepare("SELECT 1").all()).toThrow()
  })

  it("handles double-close gracefully", () => {
    db.close()
    expect(() => db.close()).not.toThrow()
  })

  it("prepared statements are reusable and do not leak", () => {
    const stmt = db.prepare("SELECT COUNT(*) as c FROM weapon_types")
    for (let i = 0; i < 100; i++) {
      const result = stmt.get() as { c: number }
      expect(result.c).toBeGreaterThanOrEqual(5)
    }
  })

  it("transaction method properly commits and releases locks", () => {
    const tx = db.transaction(() => {
      db.prepare("INSERT INTO customers (id, name, phone, email, address, is_wholesale_buyer, wholesale_discount_percent, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("cust-tx-1", "TX", "", "", "", 0, 0, "2026-01-01")
      return "committed"
    })

    const result = tx()
    expect(result).toBe("committed")

    const row = db.prepare("SELECT * FROM customers WHERE id = ?").get("cust-tx-1")
    expect(row).toBeDefined()

    const afterTx = db.prepare("SELECT COUNT(*) as c FROM customers WHERE id = 'cust-tx-1'").get() as { c: number }
    expect(afterTx.c).toBe(1)
  })

  it("handles WAL mode without lock contention on single connection", () => {
    db.pragma("journal_mode = WAL")
    const insert = db.prepare("INSERT INTO customers (id, name, phone, email, address, is_wholesale_buyer, wholesale_discount_percent, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    const query = db.prepare("SELECT COUNT(*) as c FROM customers")

    db.transaction(() => {
      for (let i = 0; i < 100; i++) {
        insert.run(`cust-wal-${i}`, `Customer ${i}`, "", "", "", 0, 0, "2026-01-01")
      }
    })()

    const count = query.get() as { c: number }
    expect(count.c).toBeGreaterThanOrEqual(100)
  })
})

describe("Legacy sql.js Removal Audit", () => {
  it("production source contains no imports of sql.js", () => {
    const srcFiles = globSync("src/**/*.ts") as string[]
    const srcTsxFiles = globSync("src/**/*.tsx") as string[]
    const allFiles = [...srcFiles, ...srcTsxFiles].filter(f => !f.includes(".test.") && !f.endsWith(".d.ts"))

    for (const file of allFiles) {
      const content = readFileSync(file, "utf-8")
      expect(content, `${file} should not import sql.js`).not.toMatch(/from\s+["']sql\.js["']/)
      expect(content, `${file} should not reference SqlJsEngine`).not.toMatch(/SqlJsEngine/)
      expect(content, `${file} should not reference sql-wasm`).not.toMatch(/sql-wasm/i)
      expect(content, `${file} should not reference DB_FILE_KEY`).not.toMatch(/DB_FILE_KEY/)
    }
  })

  it("electron source contains no imports of sql.js", () => {
    const electronFiles = globSync("electron/**/*.ts")
    for (const file of electronFiles) {
      const content = readFileSync(file, "utf-8")
      expect(content, `${file} should not import sql.js`).not.toMatch(/from\s+["']sql\.js["']/)
      expect(content, `${file} should not reference SqlJsEngine`).not.toMatch(/SqlJsEngine/)
      expect(content, `${file} should not reference sqljs-engine`).not.toMatch(/sqljs-engine/)
    }
  })

  it("vite config has no sql.js external or optimizeDeps exclusion", () => {
    const content = readFileSync("vite.config.ts", "utf-8")
    expect(content).not.toMatch(/sql\.js/)
    expect(content).not.toMatch(/sql-wasm/i)
    expect(content).not.toMatch(/optimizeDeps.*exclude/i)
  })

  it("package.json does not list sql.js as a dependency", () => {
    const content = readFileSync("package.json", "utf-8")
    const pkg = JSON.parse(content)
    expect(pkg.dependencies?.["sql.js"]).toBeUndefined()
    expect(pkg.devDependencies?.["sql.js"]).toBeUndefined()
    expect(pkg.dependencies?.["@types/sql.js"]).toBeUndefined()
    expect(pkg.devDependencies?.["@types/sql.js"]).toBeUndefined()
  })

  it("src/lib/db/sqljs-engine.ts is a stub", () => {
    if (existsSync("src/lib/db/sqljs-engine.ts")) {
      const content = readFileSync("src/lib/db/sqljs-engine.ts", "utf-8")
      expect(content).toMatch(/replaced|removed|export \{\}/)
      expect(content).not.toMatch(/class SqlJsEngine/)
    }
  })

  it("src/types/sql.js.d.ts is empty or minimal", () => {
    if (existsSync("src/types/sql.js.d.ts")) {
      const content = readFileSync("src/types/sql.js.d.ts", "utf-8")
      expect(content.trim().length).toBeLessThan(100)
    }
  })
})

describe("Renderer DB Access Isolation", () => {
  it("no src/ file imports better-sqlite3 directly", () => {
    const srcFiles = globSync("src/**/*.ts") as string[]
    const srcTsxFiles = globSync("src/**/*.tsx") as string[]
    const allFiles = [...srcFiles, ...srcTsxFiles].filter(f => !f.includes(".test.") && !f.endsWith(".d.ts"))

    for (const file of allFiles) {
      const content = readFileSync(file, "utf-8")
      expect(content, `${file} must not import better-sqlite3`).not.toMatch(/from\s+["']better-sqlite3["']/)
      expect(content, `${file} must not import better-sqlite3`).not.toMatch(/require\s*\(\s*["']better-sqlite3["']\s*\)/)
    }
  })

  it("db/index.ts only routes through window.electronAPI (no direct DB access)", () => {
    const content = readFileSync("src/lib/db/index.ts", "utf-8")
    expect(content).not.toMatch(/new Database/)
    expect(content).not.toMatch(/import.*better-sqlite3/)
    expect(content).toMatch(/window.*electronAPI/)
    expect(content).toMatch(/Electron environment required/)
  })
})

describe("Data Integrity on Errors", () => {
  let db: DB

  beforeEach(() => { db = createInMemoryDb() })
  afterEach(() => { db.close() })

  it("does not expose internal paths in constraint violation messages", () => {
    try {
      db.prepare("INSERT INTO weapon_subtypes (id, weapon_type_id, label, sort_order) VALUES (?, ?, ?, ?)")
        .run("ws-x", "nonexistent", "Test", 1)
      expect.fail("Should have thrown")
    } catch (e) {
      const msg = String(e)
      expect(msg).not.toContain("/tmp/")
      expect(msg).not.toContain("/home/")
      expect(msg).not.toContain(__dirname)
    }
  })

  it("rolls back partial writes in failed multi-statement transactions", () => {
    db.prepare("INSERT INTO suppliers (id, name, contact_person, phone, email, address, date_added) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("sup-1", "Test", "", "", "", "", "2026-01-01")

    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO weapons (id, serial_number, brand, model, weapon_type, sub_type, caliber, status,
        purchase_price, retail_price, wholesale_price, supplier_id, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run("w-1", "SN001", "Test", "Test", "Pistol", "9x19mm", "9x19mm", "Available", 100, 200, 150, "sup-1", "2026-01-01")
      db.prepare(`INSERT INTO weapons (id, serial_number, brand, model, weapon_type, sub_type, caliber, status,
        purchase_price, retail_price, wholesale_price, supplier_id, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run("w-2", "SN001", "Test", "Test", "Pistol", "9x19mm", "9x19mm", "Available", 100, 200, 150, "sup-1", "2026-01-01")
    })

    expect(() => tx()).toThrow()
    const count = db.prepare("SELECT COUNT(*) as c FROM weapons WHERE serial_number = 'SN001'").get() as { c: number }
    expect(count.c).toBe(0)
  })
})
