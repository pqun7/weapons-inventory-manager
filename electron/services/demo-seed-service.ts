import { getDb } from "../database.js"
import { repo } from "../repositories/index.js"
import { generateMockData } from "../../src/lib/mock-data.js"

type SeedCountMap = Record<string, number>

function log(event: string, details: Record<string, unknown> = {}): void {
    console.log(JSON.stringify({ scope: "demo-seed", event, timestamp: new Date().toISOString(), ...details }))
}

function countRows(table: string): number {
    const row = getDb().prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }
    return row.c
}

function alreadySeeded(): boolean {
    return countRows("weapons") > 0 || countRows("shipments") > 0 || countRows("invoices") > 0
}

export function seedDemoDataIfNeeded(): { seeded: boolean; skipped: boolean; counts?: SeedCountMap } {
    const existingCounts = {
        weapons: countRows("weapons"),
        shipments: countRows("shipments"),
        invoices: countRows("invoices"),
        payments: countRows("payment_records"),
        accessories: countRows("accessories"),
        ammunition: countRows("ammunition"),
        customers: countRows("customers"),
        suppliers: countRows("suppliers"),
        auditLogs: countRows("audit_logs"),
        notifications: countRows("app_notifications"),
    }

    log("seed-check", existingCounts)

    if (alreadySeeded()) {
        log("seed-skip", { reason: "demo data already exists", existingCounts })
        return { seeded: false, skipped: true, counts: existingCounts }
    }

    const mock = generateMockData()
    const db = getDb()

    const insertAll = db.transaction(() => {
        // Correct insertion order respecting foreign keys
        for (const s of mock.suppliers) repo.insertSupplier(s)
        for (const s of mock.shipments) repo.insertShipment(s)
        for (const w of mock.weapons) repo.insertWeapon(w)
        for (const c of mock.customers) repo.insertCustomer(c)
        for (const inv of mock.invoices) repo.insertInvoice(inv)
        for (const p of mock.payments) repo.insertPayment(p)
        for (const a of mock.accessories) repo.insertAccessory(a)
        for (const a of mock.ammunition) repo.insertAmmunition(a)
        for (const l of mock.auditLogs) repo.insertAuditLog(l)
        for (const n of mock.notifications) repo.insertNotification(n)
    })

    log("seed-start", {
        weapons: mock.weapons.length,
        shipments: mock.shipments.length,
        invoices: mock.invoices.length,
        payments: mock.payments.length,
        accessories: mock.accessories.length,
        ammunition: mock.ammunition.length,
        customers: mock.customers.length,
        suppliers: mock.suppliers.length,
        auditLogs: mock.auditLogs.length,
        notifications: mock.notifications.length,
    })

    insertAll()

    const finalCounts = {
        weapons: countRows("weapons"),
        shipments: countRows("shipments"),
        invoices: countRows("invoices"),
        payments: countRows("payment_records"),
        accessories: countRows("accessories"),
        ammunition: countRows("ammunition"),
        customers: countRows("customers"),
        suppliers: countRows("suppliers"),
        auditLogs: countRows("audit_logs"),
        notifications: countRows("app_notifications"),
    }

    log("seed-complete", finalCounts)
    return { seeded: true, skipped: false, counts: finalCounts }
}