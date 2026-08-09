import { getDb } from "../database.js"
import { repo } from "../repositories/index.js"
import { generateMockData } from "../../src/lib/mock-data.js"
import { backendCurrencyService } from "./currency-service.js"

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
        const currency = backendCurrencyService.getDefaultTransactionCurrency()
        const snapshot = backendCurrencyService.getRateSnapshot(currency)
        const valuation = (amount: number) => backendCurrencyService.createValuationFromSnapshot(String(amount), snapshot)
        const weapons = mock.weapons.map((weapon) => ({
            ...weapon,
            purchasePriceValuation: valuation(weapon.purchasePrice),
            retailPriceValuation: valuation(weapon.retailPrice),
            wholesalePriceValuation: valuation(weapon.wholesalePrice),
            actualFinalPriceValuation: weapon.actualFinalPrice == null ? undefined : valuation(weapon.actualFinalPrice),
            salePriceValuation: weapon.actualFinalPrice == null ? undefined : valuation(weapon.actualFinalPrice),
        }))
        const accessories = mock.accessories.map((item) => ({
            ...item,
            priceCurrency: currency,
            priceValuation: valuation(item.price),
        }))
        const ammunition = mock.ammunition.map((item) => ({
            ...item,
            priceCurrency: currency,
            priceValuation: valuation(item.price),
        }))
        const invoices = mock.invoices.map((invoice) => ({
            ...invoice,
            currency,
            accountingCurrency: snapshot.accountingCurrency,
            exchangeRate: snapshot.exchangeRate,
            exchangeRateDate: snapshot.exchangeRateDate,
            rateSource: snapshot.rateSource,
            totalOriginalAccounting: valuation(invoice.totalOriginal).accountingAmount,
            totalNegotiatedAccounting: valuation(invoice.totalNegotiated).accountingAmount,
            totalPaidAccounting: valuation(invoice.totalPaid).accountingAmount,
            balanceAccounting: valuation(invoice.balance).accountingAmount,
            taxAmountAccounting: valuation(invoice.taxAmount).accountingAmount,
            totalValuation: valuation(invoice.totalNegotiated + invoice.taxAmount),
        }))
        const payments = mock.payments.map((payment) => {
            const paymentValuation = valuation(payment.amount)
            return {
                ...payment,
                currency,
                accountingAmount: paymentValuation.accountingAmount,
                accountingCurrency: paymentValuation.accountingCurrency,
                exchangeRate: paymentValuation.exchangeRate,
                exchangeRateDate: paymentValuation.exchangeRateDate,
                rateSource: paymentValuation.rateSource,
                rateId: paymentValuation.rateId,
            }
        })
        // Correct insertion order respecting foreign keys
        for (const s of mock.suppliers) repo.insertSupplier(s)
        for (const s of mock.shipments) repo.insertShipment({ ...s, currency })
        for (const w of weapons) repo.insertWeapon(w)
        for (const c of mock.customers) repo.insertCustomer(c)
        for (const inv of invoices) repo.insertInvoice(inv)
        for (const p of payments) repo.insertPayment(p)
        for (const a of accessories) repo.insertAccessory(a)
        for (const a of ammunition) repo.insertAmmunition(a)
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
