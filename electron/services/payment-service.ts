import { Decimal } from "decimal.js"
import { getDb } from "../database.js"
import { repo } from "../repositories/index.js"
import { backendCurrencyService } from "./currency-service.js"
import { applyAccountingPayment, decimalToNumber, moneyDecimal, nonNegativeMoney, positiveMoney, roundAccounting } from "./money.js"
import type { AuditLog, Invoice, PaymentRecord } from "../../src/lib/types.js"
import type { PaymentInput } from "../../src/lib/store.js"

export interface PaymentResult {
  success: boolean
  newBalance?: number
  accountingBalance?: number
  error?: string
}

function generateId(prefix: string, table: string): string {
  const rows = getDb().prepare(`SELECT id FROM ${table} WHERE id LIKE ?`).all(`${prefix}%`) as { id: string }[]
  const max = rows.reduce((current, row) => {
    const value = Number.parseInt(row.id.slice(prefix.length), 10)
    return Number.isFinite(value) ? Math.max(current, value) : current
  }, 0)
  return `${prefix}${String(max + 1).padStart(5, "0")}`
}

function requireInvoiceSnapshot(invoice: Invoice): {
  currency: string
  accountingCurrency: string
  exchangeRate: Decimal
  accountingBalance: Decimal
  accountingPaid: Decimal
} {
  if (!invoice.currency || !invoice.accountingCurrency || invoice.exchangeRate == null || !invoice.exchangeRateDate || !invoice.rateSource) {
    throw new Error("Invoice has no trustworthy currency snapshot and requires financial data review")
  }
  const exchangeRate = positiveMoney(invoice.exchangeRate, "Invoice exchange rate")
  const accountingBalance = invoice.balanceAccounting == null
    ? roundAccounting(moneyDecimal(invoice.balance).dividedBy(exchangeRate))
    : nonNegativeMoney(invoice.balanceAccounting, "Invoice accounting balance")
  const accountingPaid = invoice.totalPaidAccounting == null
    ? roundAccounting(moneyDecimal(invoice.totalPaid).dividedBy(exchangeRate))
    : nonNegativeMoney(invoice.totalPaidAccounting, "Invoice accounting paid total")
  return {
    currency: invoice.currency,
    accountingCurrency: invoice.accountingCurrency,
    exchangeRate,
    accountingBalance,
    accountingPaid,
  }
}

export function registerPayment(
  input: PaymentInput,
  currentUser: { id: string; name: string },
): PaymentResult {
  try {
    return getDb().transaction((): PaymentResult => {
      if (!currentUser?.id || !currentUser.name?.trim()) throw new Error("A valid current user is required")
      const invoice = repo.getAll().invoices.find((candidate) => candidate.id === input.invoiceId)
      if (!invoice) throw new Error("Invoice not found")
      if (invoice.voided) throw new Error("Cannot pay a voided invoice")
      if (invoice.balance <= 0) throw new Error("Invoice is already fully paid")

      const snapshot = requireInvoiceSnapshot(invoice)
      const paymentCurrency = input.currency?.trim().toUpperCase() || snapshot.currency
      const paymentAmount = positiveMoney(input.amount, "Payment amount")
      const paymentValuation = backendCurrencyService.createValuation(paymentAmount.toString(), paymentCurrency)
      if (paymentValuation.accountingCurrency !== snapshot.accountingCurrency) {
        throw new Error("Payment and invoice accounting currencies do not match")
      }

      const accountingPayment = moneyDecimal(paymentValuation.accountingAmount)
      const tolerance = new Decimal("0.0001")
      const application = applyAccountingPayment(
        invoice.balance,
        snapshot.accountingBalance,
        snapshot.exchangeRate,
        accountingPayment,
        tolerance,
      )
      const appliedInvoiceAmount = application.appliedOriginalAmount
      const newAccountingBalance = application.newAccountingBalance
      const newInvoiceBalance = application.newOriginalBalance
      const newAccountingPaid = snapshot.accountingPaid.plus(accountingPayment)
      const newInvoicePaid = moneyDecimal(invoice.totalPaid).plus(appliedInvoiceAmount)
      const isPaid = application.isPaid
      const newStatus: Invoice["status"] = isPaid
        ? "Paid"
        : new Date(invoice.dueDate) < new Date() ? "Overdue" : "Pending"

      const payment: PaymentRecord = {
        id: generateId("PAY", "payment_records"),
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        date: new Date().toISOString().slice(0, 10),
        amount: paymentValuation.originalAmount,
        currency: paymentCurrency,
        accountingAmount: paymentValuation.accountingAmount,
        accountingCurrency: paymentValuation.accountingCurrency,
        exchangeRate: paymentValuation.exchangeRate,
        exchangeRateDate: paymentValuation.exchangeRateDate,
        rateSource: paymentValuation.rateSource,
        rateId: paymentValuation.rateId,
        method: input.method,
        employee: currentUser.name,
        notes: input.notes?.trim() ?? "",
      }

      repo.insertPayment(payment)
      repo.updateInvoice({
        ...invoice,
        totalPaid: decimalToNumber(newInvoicePaid),
        balance: isPaid ? 0 : decimalToNumber(newInvoiceBalance),
        totalPaidAccounting: decimalToNumber(roundAccounting(newAccountingPaid)),
        balanceAccounting: isPaid ? 0 : decimalToNumber(roundAccounting(newAccountingBalance)),
        status: newStatus,
      })

      const audit: AuditLog = {
        id: generateId("LOG", "audit_logs"),
        timestamp: new Date().toISOString(),
        date: new Date().toISOString().slice(0, 10),
        userId: currentUser.id,
        actionType: "Payment",
        description: `Payment registered for invoice ${invoice.invoiceNumber}`,
        metadata: JSON.stringify({
          schemaVersion: 2,
          actorName: currentUser.name,
          entityType: "payment",
          entityId: payment.id,
          paymentId: payment.id,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          paymentAmount: payment.amount,
          paymentCurrency,
          accountingAmount: payment.accountingAmount,
          accountingCurrency: payment.accountingCurrency,
          exchangeRate: payment.exchangeRate,
          exchangeRateDate: payment.exchangeRateDate,
          rateSource: payment.rateSource,
          appliedInvoiceAmount: decimalToNumber(appliedInvoiceAmount),
          invoiceCurrency: snapshot.currency,
          newBalance: isPaid ? 0 : decimalToNumber(newInvoiceBalance),
          newAccountingBalance: isPaid ? 0 : decimalToNumber(newAccountingBalance),
        }),
      }
      repo.insertAuditLog(audit)

      if (isPaid) {
        repo.insertNotification({
          id: generateId("NTF", "app_notifications"),
          type: "System",
          title: "Debt Fully Settled",
          message: `Invoice ${invoice.invoiceNumber} has been fully paid`,
          date: new Date().toISOString().slice(0, 10),
          read: false,
          entityId: invoice.id,
        })
      }

      return {
        success: true,
        newBalance: isPaid ? 0 : decimalToNumber(newInvoiceBalance),
        accountingBalance: isPaid ? 0 : decimalToNumber(newAccountingBalance),
      }
    })()
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
