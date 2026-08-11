import { Decimal } from "decimal.js"

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

export const ACCOUNTING_DECIMAL_PLACES = 4
export type MoneyInput = number | string | Decimal

export function moneyDecimal(value: MoneyInput, field = "amount"): Decimal {
  let decimal: Decimal
  try { decimal = value instanceof Decimal ? value : new Decimal(value) }
  catch { throw new Error(`${field} must be a valid decimal amount`) }
  if (!decimal.isFinite()) throw new Error(`${field} must be finite`)
  return decimal
}

export function positiveMoney(value: MoneyInput, field = "amount"): Decimal {
  const decimal = moneyDecimal(value, field)
  if (!decimal.greaterThan(0)) throw new Error(`${field} must be greater than zero`)
  return decimal
}

export function nonNegativeMoney(value: MoneyInput, field = "amount"): Decimal {
  const decimal = moneyDecimal(value, field)
  if (decimal.isNegative()) throw new Error(`${field} cannot be negative`)
  return decimal
}

export function roundAccounting(value: MoneyInput): Decimal {
  return moneyDecimal(value).toDecimalPlaces(ACCOUNTING_DECIMAL_PLACES, Decimal.ROUND_HALF_UP)
}

export function moneyEquals(left: MoneyInput, right: MoneyInput, tolerance: MoneyInput = "0.0001"): boolean {
  return moneyDecimal(left).minus(moneyDecimal(right)).abs().lessThanOrEqualTo(moneyDecimal(tolerance))
}

export function authoritativeListPrice(snapshotAccountingAmount: MoneyInput | null | undefined, legacyAccountingAmount: MoneyInput, transactionExchangeRate: MoneyInput, quantity: MoneyInput): Decimal {
  const accountingPrice = snapshotAccountingAmount == null
    ? nonNegativeMoney(legacyAccountingAmount, "Legacy accounting list price")
    : nonNegativeMoney(snapshotAccountingAmount, "Accounting list price")
  return accountingPrice.times(positiveMoney(transactionExchangeRate, "Exchange rate")).times(positiveMoney(quantity, "Quantity"))
}

export function toAccountingAmount(amount: MoneyInput, exchangeRate: MoneyInput): Decimal {
  return roundAccounting(nonNegativeMoney(amount).dividedBy(positiveMoney(exchangeRate, "Exchange rate")))
}

export function fromAccountingAmount(amount: MoneyInput, exchangeRate: MoneyInput): Decimal {
  return roundAccounting(nonNegativeMoney(amount).times(positiveMoney(exchangeRate, "Exchange rate")))
}

export function convertBetweenBaseRates(amount: MoneyInput, fromUnitsPerBase: MoneyInput, toUnitsPerBase: MoneyInput): Decimal {
  const baseAmount = nonNegativeMoney(amount).dividedBy(positiveMoney(fromUnitsPerBase, "Source exchange rate"))
  return roundAccounting(baseAmount.times(positiveMoney(toUnitsPerBase, "Target exchange rate")))
}

export interface PaymentApplication {
  appliedOriginalAmount: Decimal
  newOriginalBalance: Decimal
  newAccountingBalance: Decimal
  isPaid: boolean
}

export function applyAccountingPayment(originalBalance: MoneyInput, accountingBalance: MoneyInput, invoiceExchangeRate: MoneyInput, paymentAccountingAmount: MoneyInput, tolerance: MoneyInput = "0.0001"): PaymentApplication {
  const currentOriginal = nonNegativeMoney(originalBalance, "Invoice balance")
  const currentAccounting = nonNegativeMoney(accountingBalance, "Invoice accounting balance")
  const payment = positiveMoney(paymentAccountingAmount, "Payment accounting amount")
  const allowedDifference = nonNegativeMoney(tolerance, "Payment tolerance")
  if (payment.minus(currentAccounting).greaterThan(allowedDifference)) throw new Error("Payment amount exceeds the remaining invoice balance")
  const appliedOriginalAmount = fromAccountingAmount(payment, invoiceExchangeRate)
  const newAccountingBalance = Decimal.max(0, currentAccounting.minus(payment))
  const newOriginalBalance = Decimal.max(0, currentOriginal.minus(appliedOriginalAmount))
  return { appliedOriginalAmount, newOriginalBalance, newAccountingBalance, isPaid: newAccountingBalance.lessThanOrEqualTo(allowedDifference) }
}
