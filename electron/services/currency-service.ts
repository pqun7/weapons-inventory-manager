import { Decimal } from "decimal.js"
import { getDb } from "../database.js"
import type { MoneyValuation } from "../../src/lib/types.js"
import { decimalToNumber, moneyDecimal, nonNegativeMoney, positiveMoney, roundAccounting, toAccountingAmount } from "./money.js"

type RateSource = MoneyValuation["rateSource"]

interface CurrencyDbRow {
  iso_code: string
  decimal_precision: number
  is_active: number
  last_known_rate: string | number
  last_rate_updated_at: string | null
}

interface OverrideDbRow {
  mode: "automatic" | "manual"
  manual_rate: string | number | null
  updated_at: string
}

export interface ExchangeRateSnapshot {
  exchangeRate: number
  exchangeRateDate: string
  rateSource: RateSource
  rateId?: string
  accountingCurrency: string
  transactionCurrency: string
  transactionPrecision: number
}

function normalizeCode(code: string | undefined, field: string): string {
  const normalized = code?.trim().toUpperCase()
  if (!normalized) throw new Error(`${field} is required`)
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error(`${field} must be a valid 3-letter currency code`)
  return normalized
}

export class BackendCurrencyService {
  getAccountingCurrency(): string {
    const row = getDb().prepare(
      "SELECT accounting_currency_code FROM system_settings WHERE id = 1",
    ).get() as { accounting_currency_code?: string } | undefined
    return normalizeCode(row?.accounting_currency_code, "Accounting currency")
  }

  getRateBaseCurrency(): string {
    const row = getDb().prepare(
      "SELECT rate_base_currency_code FROM system_settings WHERE id = 1",
    ).get() as { rate_base_currency_code?: string } | undefined
    return normalizeCode(row?.rate_base_currency_code, "Rate base currency")
  }

  getDefaultTransactionCurrency(): string {
    const row = getDb().prepare("SELECT currency_code FROM system_settings WHERE id = 1").get() as
      | { currency_code?: string }
      | undefined
    const code = normalizeCode(row?.currency_code, "Default transaction currency")
    this.requireCurrency(code, true)
    return code
  }

  requireCurrency(code: string, requireActive = true): CurrencyDbRow {
    const normalized = normalizeCode(code, "Currency")
    const row = getDb().prepare(
      "SELECT iso_code, decimal_precision, is_active, last_known_rate, last_rate_updated_at FROM currencies WHERE iso_code = ?",
    ).get(normalized) as CurrencyDbRow | undefined
    if (!row) throw new Error(`Unknown currency: ${normalized}`)
    if (requireActive && row.is_active !== 1) throw new Error(`Currency is inactive: ${normalized}`)
    if (!Number.isInteger(row.decimal_precision) || row.decimal_precision < 0 || row.decimal_precision > 4) {
      throw new Error(`Currency ${normalized} has invalid decimal precision`)
    }
    return row
  }

  private getRawRate(code: string): { rate: Decimal; date: string; source: RateSource; rateId?: string } {
    const currency = this.requireCurrency(code, true)
    const baseCurrency = this.getRateBaseCurrency()
    if (currency.iso_code === baseCurrency) {
      return {
        rate: new Decimal(1),
        date: currency.last_rate_updated_at ?? new Date().toISOString(),
        source: "default",
      }
    }

    const override = getDb().prepare(
      "SELECT mode, manual_rate, updated_at FROM exchange_rate_overrides WHERE currency_code = ?",
    ).get(currency.iso_code) as OverrideDbRow | undefined

    const isManual = override?.mode === "manual"
    const value = isManual ? override.manual_rate : currency.last_known_rate
    const rate = positiveMoney(value as string | number, `Exchange rate for ${currency.iso_code}`)
    const date = isManual
      ? override!.updated_at
      : currency.last_rate_updated_at
    if (!date) throw new Error(`Exchange rate timestamp is missing for ${currency.iso_code}`)

    const history = getDb().prepare(
      "SELECT id, source FROM exchange_rate_history WHERE currency_code = ? AND rate = ? ORDER BY fetched_at DESC LIMIT 1",
    ).get(currency.iso_code, rate.toString()) as { id: string; source: string } | undefined
    const persistedSource: RateSource = history && new Set(["manual", "api", "cache", "default"]).has(history.source)
      ? history.source as RateSource
      : "cache"

    return {
      rate,
      date,
      source: isManual ? "manual" : persistedSource,
      rateId: history?.id,
    }
  }

  getRateSnapshot(transactionCurrency: string): ExchangeRateSnapshot {
    const original = normalizeCode(transactionCurrency, "Transaction currency")
    const accounting = this.getAccountingCurrency()
    this.requireCurrency(accounting, true)
    const transactionDefinition = this.requireCurrency(original, true)

    if (original === accounting) {
      return {
        exchangeRate: 1,
        exchangeRateDate: new Date().toISOString(),
        rateSource: "default",
        accountingCurrency: accounting,
        transactionCurrency: original,
        transactionPrecision: transactionDefinition.decimal_precision,
      }
    }

    const originalRate = this.getRawRate(original)
    const accountingRate = this.getRawRate(accounting)
    const crossRate = originalRate.rate.dividedBy(accountingRate.rate)
    positiveMoney(crossRate, `Exchange rate ${accounting}/${original}`)

    const originalDate = new Date(originalRate.date).getTime()
    const accountingDate = new Date(accountingRate.date).getTime()
    const timestamp = Math.min(originalDate, accountingDate)
    if (!Number.isFinite(timestamp)) throw new Error(`Invalid exchange rate timestamp for ${original}`)

    return {
      exchangeRate: decimalToNumber(crossRate),
      exchangeRateDate: new Date(timestamp).toISOString(),
      rateSource: originalRate.source === "manual" || accountingRate.source === "manual"
        ? "manual"
        : originalRate.source === "api" || accountingRate.source === "api"
          ? "api"
          : "cache",
      rateId: [originalRate.rateId, accountingRate.rateId].filter(Boolean).join("|") || undefined,
      accountingCurrency: accounting,
      transactionCurrency: original,
      transactionPrecision: transactionDefinition.decimal_precision,
    }
  }

  createValuation(amount: number | string, transactionCurrency: string): MoneyValuation {
    const snapshot = this.getRateSnapshot(transactionCurrency)
    return this.createValuationFromSnapshot(amount, snapshot)
  }

  createValuationFromSnapshot(amount: number | string, snapshot: ExchangeRateSnapshot): MoneyValuation {
    const original = nonNegativeMoney(amount, "Amount").toDecimalPlaces(
      snapshot.transactionPrecision,
      Decimal.ROUND_HALF_UP,
    )
    const accountingAmount = toAccountingAmount(original, snapshot.exchangeRate)
    const valuation: MoneyValuation = {
      originalAmount: decimalToNumber(original),
      originalCurrency: snapshot.transactionCurrency,
      accountingAmount: decimalToNumber(accountingAmount),
      accountingCurrency: snapshot.accountingCurrency,
      exchangeRate: snapshot.exchangeRate,
      exchangeRateDate: snapshot.exchangeRateDate,
      rateSource: snapshot.rateSource,
      rateId: snapshot.rateId,
    }
    if (snapshot.accountingCurrency === "USD") valuation.accountingAmountUSD = valuation.accountingAmount
    return valuation
  }

  convertWithSnapshot(amount: number | string, snapshot: ExchangeRateSnapshot): Decimal {
    return roundAccounting(moneyDecimal(amount, "Amount").dividedBy(positiveMoney(snapshot.exchangeRate, "Exchange rate")))
  }
}

export const backendCurrencyService = new BackendCurrencyService()
