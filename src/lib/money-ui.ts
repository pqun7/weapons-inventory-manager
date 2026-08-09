import Decimal from "decimal.js"
import { CurrencyService } from "@/lib/currency-service"
import type { Invoice, MoneyValuation, PaymentRecord } from "@/lib/types"

export type MoneyViewMode = "original" | "accounting" | "display"
export type InvoiceMoneyField =
  | "totalOriginal"
  | "totalNegotiated"
  | "totalPaid"
  | "balance"
  | "taxAmount"

const ACCOUNTING_FIELD: Record<InvoiceMoneyField, keyof Invoice> = {
  totalOriginal: "totalOriginalAccounting",
  totalNegotiated: "totalNegotiatedAccounting",
  totalPaid: "totalPaidAccounting",
  balance: "balanceAccounting",
  taxAmount: "taxAmountAccounting",
}

function finiteAmount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function valuationAccountingAmount(
  valuation?: MoneyValuation | null,
  legacyAccountingAmount?: number | null,
): number | null {
  const snapshotAmount = finiteAmount(valuation?.accountingAmount ?? valuation?.accountingAmountUSD)
  if (snapshotAmount !== null) return snapshotAmount
  return finiteAmount(legacyAccountingAmount)
}

export function invoiceAccountingAmount(invoice: Invoice, field: InvoiceMoneyField): number | null {
  const direct = finiteAmount(invoice[ACCOUNTING_FIELD[field]])
  if (direct !== null) return direct
  if (field === "totalNegotiated") {
    const valued = valuationAccountingAmount(invoice.totalValuation)
    if (valued !== null) return valued
  }
  if (!invoice.currency && !invoice.accountingCurrency && invoice.exchangeRate == null && !invoice.totalValuation) {
    return finiteAmount(invoice[field])
  }
  return null
}

export function paymentAccountingAmount(payment: PaymentRecord): number | null {
  const direct = finiteAmount(payment.accountingAmount)
  if (direct !== null) return direct
  if (!payment.currency && !payment.accountingCurrency && payment.exchangeRate == null) {
    return finiteAmount(payment.amount)
  }
  return null
}

export function sumMoney(values: Array<number | null | undefined>): number {
  return values.reduce<Decimal>((sum, value) => {
    return value == null || !Number.isFinite(value) ? sum : sum.plus(value)
  }, new Decimal(0)).toNumber()
}

export function multiplyMoney(amount: number | null | undefined, quantity: number): number {
  if (amount == null || !Number.isFinite(amount) || !Number.isFinite(quantity)) return 0
  return new Decimal(amount).times(quantity).toNumber()
}

export function convertValuationToCurrency(
  valuation: MoneyValuation | undefined,
  currencyCode: string,
  legacyAccountingAmount?: number | null,
): number | null {
  if (valuation && valuation.originalCurrency === currencyCode) return valuation.originalAmount
  const accountingAmount = valuationAccountingAmount(valuation, legacyAccountingAmount)
  if (accountingAmount === null) return null
  if (valuation && valuation.accountingCurrency !== CurrencyService.accountingCurrency) return null
  return CurrencyService.roundDisplay(
    CurrencyService.convertFromAccounting(accountingAmount, currencyCode),
    currencyCode,
  )
}

export function formatUnknownOriginal(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(amount)
}

export function formatValuation(
  valuation: MoneyValuation | undefined,
  displayCurrency: string,
  locale: string,
  mode: MoneyViewMode = "display",
  unresolvedAmount?: number,
  unresolvedCurrency?: string,
): string {
  if (!valuation) {
    if (unresolvedAmount == null || !Number.isFinite(unresolvedAmount)) return "—"
    if (!unresolvedCurrency) return formatUnknownOriginal(unresolvedAmount, locale)
    if (unresolvedCurrency === displayCurrency) {
      return CurrencyService.format(unresolvedAmount, unresolvedCurrency, locale)
    }
    if (unresolvedCurrency === CurrencyService.accountingCurrency) {
      return CurrencyService.format(
        CurrencyService.convertFromAccounting(unresolvedAmount, displayCurrency),
        displayCurrency,
        locale,
      )
    }
    // A known non-accounting currency without a historical rate snapshot must
    // remain in its original currency instead of being converted with today's rate.
    return CurrencyService.format(unresolvedAmount, unresolvedCurrency, locale)
  }

  if (mode === "original") {
    return CurrencyService.format(valuation.originalAmount, valuation.originalCurrency, locale)
  }

  const accountingAmount = valuationAccountingAmount(valuation)
  if (accountingAmount === null) return "—"
  if (mode === "accounting") {
    return CurrencyService.format(accountingAmount, valuation.accountingCurrency, locale)
  }

  if (displayCurrency === valuation.originalCurrency) {
    return CurrencyService.format(valuation.originalAmount, valuation.originalCurrency, locale)
  }
  if (displayCurrency === valuation.accountingCurrency) {
    return CurrencyService.format(accountingAmount, valuation.accountingCurrency, locale)
  }

  const displayAmount = CurrencyService.convertFromAccounting(accountingAmount, displayCurrency)
  return CurrencyService.format(displayAmount, displayCurrency, locale)
}

export function formatInvoiceMoney(
  invoice: Invoice,
  field: InvoiceMoneyField,
  displayCurrency: string,
  locale: string,
  mode: MoneyViewMode,
): string {
  const originalAmount = finiteAmount(invoice[field]) ?? 0
  const originalCurrency = invoice.currency
  const isLegacyAccountingRecord = !invoice.currency && !invoice.accountingCurrency
    && invoice.exchangeRate == null && !invoice.totalValuation
  if (mode === "original") {
    return originalCurrency
      ? CurrencyService.format(originalAmount, originalCurrency, locale)
      : isLegacyAccountingRecord
        ? CurrencyService.format(originalAmount, CurrencyService.accountingCurrency, locale)
        : formatUnknownOriginal(originalAmount, locale)
  }

  const accountingAmount = invoiceAccountingAmount(invoice, field)
  const accountingCurrency = invoice.accountingCurrency
    ?? invoice.totalValuation?.accountingCurrency
    ?? (isLegacyAccountingRecord ? CurrencyService.accountingCurrency : undefined)
  if (accountingAmount === null || !accountingCurrency) return "—"
  if (mode === "accounting") return CurrencyService.format(accountingAmount, accountingCurrency, locale)
  if (displayCurrency === originalCurrency && originalCurrency) {
    return CurrencyService.format(originalAmount, originalCurrency, locale)
  }
  if (displayCurrency === accountingCurrency) {
    return CurrencyService.format(accountingAmount, accountingCurrency, locale)
  }

  return CurrencyService.format(
    CurrencyService.convertFromAccounting(accountingAmount, displayCurrency),
    displayCurrency,
    locale,
  )
}

export function formatInvoiceLineMoney(
  invoice: Invoice,
  amount: number,
  displayCurrency: string,
  locale: string,
): string {
  if (!Number.isFinite(amount)) return "—"
  const originalCurrency = invoice.currency
  if (!originalCurrency) {
    return CurrencyService.format(
      CurrencyService.convertFromAccounting(amount, displayCurrency),
      displayCurrency,
      locale,
    )
  }
  if (displayCurrency === originalCurrency) {
    return CurrencyService.format(amount, originalCurrency, locale)
  }
  const accountingCurrency = invoice.accountingCurrency ?? invoice.totalValuation?.accountingCurrency
  const rate = finiteAmount(invoice.exchangeRate ?? invoice.totalValuation?.exchangeRate)
  if (!accountingCurrency || rate === null || rate <= 0) {
    return CurrencyService.format(amount, originalCurrency, locale)
  }
  const accountingAmount = originalCurrency === accountingCurrency
    ? amount
    : new Decimal(amount).div(rate).toNumber()
  if (displayCurrency === accountingCurrency) {
    return CurrencyService.format(accountingAmount, accountingCurrency, locale)
  }
  return CurrencyService.format(
    CurrencyService.convertFromAccounting(accountingAmount, displayCurrency),
    displayCurrency,
    locale,
  )
}

export function formatPaymentMoney(
  payment: PaymentRecord,
  displayCurrency: string,
  locale: string,
  mode: MoneyViewMode,
): string {
  const isLegacyAccountingRecord = !payment.currency && !payment.accountingCurrency && payment.exchangeRate == null
  if (mode === "original") {
    return payment.currency
      ? CurrencyService.format(payment.amount, payment.currency, locale)
      : isLegacyAccountingRecord
        ? CurrencyService.format(payment.amount, CurrencyService.accountingCurrency, locale)
        : formatUnknownOriginal(payment.amount, locale)
  }
  const accountingAmount = paymentAccountingAmount(payment)
  const accountingCurrency = payment.accountingCurrency
    ?? (isLegacyAccountingRecord ? CurrencyService.accountingCurrency : undefined)
  if (accountingAmount === null || !accountingCurrency) return "—"
  if (mode === "accounting") return CurrencyService.format(accountingAmount, accountingCurrency, locale)
  if (displayCurrency === payment.currency && payment.currency) {
    return CurrencyService.format(payment.amount, payment.currency, locale)
  }
  if (displayCurrency === accountingCurrency) {
    return CurrencyService.format(accountingAmount, accountingCurrency, locale)
  }
  return CurrencyService.format(
    CurrencyService.convertFromAccounting(accountingAmount, displayCurrency),
    displayCurrency,
    locale,
  )
}

export function formatAccountingAggregate(
  amount: number,
  accountingCurrency: string,
  displayCurrency: string,
  locale: string,
  mode: MoneyViewMode,
): string {
  if (mode === "display") {
    return CurrencyService.format(
      CurrencyService.convertFromAccounting(amount, displayCurrency),
      displayCurrency,
      locale,
    )
  }
  return CurrencyService.format(amount, accountingCurrency, locale)
}
