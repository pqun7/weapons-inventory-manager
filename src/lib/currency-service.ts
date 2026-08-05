import Decimal from "decimal.js"
import {
  dbAddCurrency,
  dbGetCurrencies,
  dbGetOverrides,
  dbGetRateAuditLog,
  dbRecordRateAuditLog,
  dbRecordRateHistory,
  dbSetAutomaticMode,
  dbSetManualOverride,
  dbToggleCurrencyActive,
  dbUpdateCurrencyRate,
} from "./db/index.js"

const DecimalAny: any = Decimal as unknown as any

DecimalAny.set({ rounding: DecimalAny.ROUND_HALF_UP, precision: 28 })

export interface CurrencyInfo {
  isoCode: string
  name: string
  symbol: string
  decimalPrecision: number
  isActive: boolean
  lastKnownRate: number
  lastRateUpdatedAt: string | null
}

export interface ExchangeRateOverride {
  currencyCode: string
  mode: "automatic" | "manual"
  manualRate: number | null
  updatedBy: string | null
  updatedAt: string
  reason: string | null
}

export interface AuditLogEntry {
  id: string
  currencyCode: string
  oldRate: number | null
  newRate: number | null
  changedBy: string | null
  changedAt: string
  reason: string | null
}

export type RateSource = "api" | "manual" | "cache" | "default"

interface CachedRate {
  rate: number
  source: RateSource
  fetchedAt: Date
}

const ACCOUNTING_CURRENCY = "USD"
const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  SDG: 600,
  SAR: 3.75,
  AED: 3.67,
  EUR: 0.92,
  EGP: 48.5,
}

class CurrencyServiceClass {
  private currencies: Map<string, CurrencyInfo> = new Map()
  private overrides: Map<string, ExchangeRateOverride> = new Map()
  private rateCache: Map<string, CachedRate> = new Map()
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private listeners: Set<() => void> = new Set()

  get accountingCurrency(): string {
    return ACCOUNTING_CURRENCY
  }

  get isLoaded(): boolean {
    return this.loaded
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() {
    this.listeners.forEach((l) => l())
  }

  clearRateCache(): void {
    this.rateCache.clear()
    this.notify()
  }

  async load(): Promise<void> {
    if (this.loaded) return
    if (this.loadPromise) return this.loadPromise

    this.loadPromise = this._doLoad()
    await this.loadPromise
  }

  private async _doLoad(): Promise<void> {
    try {
      await Promise.all([this.loadCurrencies(), this.loadOverrides()])
      this.loaded = true
    } catch (err) {
      console.error("CurrencyService load failed, using fallbacks:", err)
      this.loadFallbacks()
      this.loaded = true
    }
    this.notify()
  }

  private loadFallbacks() {
    for (const [code, rate] of Object.entries(FALLBACK_RATES)) {
      this.currencies.set(code, {
        isoCode: code,
        name: code,
        symbol: code,
        decimalPrecision: 2,
        isActive: true,
        lastKnownRate: rate,
        lastRateUpdatedAt: null,
      })
    }
  }

  private async loadCurrencies(): Promise<void> {
    const rows = await dbGetCurrencies()
    this.currencies.clear()
    for (const row of rows) {
      const rateStr = typeof row.last_known_rate === "string"
        ? Number(row.last_known_rate)
        : row.last_known_rate
      this.currencies.set(row.iso_code, {
        isoCode: row.iso_code,
        name: row.name,
        symbol: row.symbol,
        decimalPrecision: row.decimal_precision,
        isActive: row.is_active === 1,
        lastKnownRate: rateStr,
        lastRateUpdatedAt: row.last_rate_updated_at,
      })
    }
  }

  private async loadOverrides(): Promise<void> {
    const rows = await dbGetOverrides()
    this.overrides.clear()
    for (const row of rows) {
      this.overrides.set(row.currency_code, {
        currencyCode: row.currency_code,
        mode: row.mode as "automatic" | "manual",
        manualRate: row.manual_rate,
        updatedBy: row.updated_by,
        updatedAt: row.updated_at,
        reason: row.reason,
      })
    }
  }

  getCurrencies(): CurrencyInfo[] {
    return Array.from(this.currencies.values()).filter((c) => c.isActive)
  }

  getCurrency(code: string): CurrencyInfo | undefined {
    return this.currencies.get(code)
  }

  getOverrides(): ExchangeRateOverride[] {
    return Array.from(this.overrides.values())
  }

  getOverride(code: string): ExchangeRateOverride | undefined {
    return this.overrides.get(code)
  }

  getRate(currencyCode: string): number {
    if (currencyCode === ACCOUNTING_CURRENCY) return 1

    const override = this.overrides.get(currencyCode)
    if (override?.mode === "manual" && override.manualRate != null) {
      return override.manualRate
    }

    const cached = this.rateCache.get(currencyCode)
    if (cached) return cached.rate

    const currency = this.currencies.get(currencyCode)
    if (currency && currency.lastKnownRate) return currency.lastKnownRate

    return FALLBACK_RATES[currencyCode] ?? 1
  }

  getRateSource(currencyCode: string): RateSource {
    if (currencyCode === ACCOUNTING_CURRENCY) return "default"
    const override = this.overrides.get(currencyCode)
    if (override?.mode === "manual" && override.manualRate != null) return "manual"
    const cached = this.rateCache.get(currencyCode)
    if (cached) return cached.source
    const currency = this.currencies.get(currencyCode)
    if (currency && currency.lastKnownRate) return "cache"
    return "default"
  }

  convertToUSD(amount: number, fromCurrency: string): number {
    if (fromCurrency === ACCOUNTING_CURRENCY) return amount
    const rate = this.getRate(fromCurrency)
    if (rate === 0) return 0

    const decAmount = new DecimalAny(amount)
    const decRate = new DecimalAny(rate)
    return decAmount.dividedBy(decRate).toNumber()
  }

  convertFromUSD(usdAmount: number, toCurrency: string): number {
    if (toCurrency === ACCOUNTING_CURRENCY) return usdAmount
    const rate = this.getRate(toCurrency)

    const decUsd = new DecimalAny(usdAmount)
    const decRate = new DecimalAny(rate)
    return decUsd.times(decRate).toNumber()
  }

  convert(amount: number, fromCurrency: string, toCurrency: string): number {
    const usd = this.convertToUSD(amount, fromCurrency)
    return this.convertFromUSD(usd, toCurrency)
  }

  format(amount: number, currencyCode: string, locale: string = "en-US"): string {
    const currency = this.currencies.get(currencyCode)
    const precision = currency?.decimalPrecision ?? 2

    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    }).format(amount)

    const symbol = currency?.symbol ?? currencyCode
    return `${symbol} ${formatted}`
  }

  formatUSD(usdAmount: number, displayCurrency: string, locale: string = "en-US"): string {
    const displayAmount = this.convertFromUSD(usdAmount, displayCurrency)
    return this.format(displayAmount, displayCurrency, locale)
  }

  roundAccounting(amount: number): number {
    return new DecimalAny(amount).toDecimalPlaces(4, DecimalAny.ROUND_HALF_UP).toNumber()
  }

  roundDisplay(amount: number, currencyCode: string): number {
    const currency = this.currencies.get(currencyCode)
    const precision = currency?.decimalPrecision ?? 2
    return new DecimalAny(amount).toDecimalPlaces(precision, DecimalAny.ROUND_HALF_UP).toNumber()
  }

  createValuation(originalAmount: number, originalCurrency: string): {
    originalAmount: number
    originalCurrency: string
    exchangeRate: number
    accountingAmountUSD: number
    exchangeRateDate: string
  } {
    const rate = this.getRate(originalCurrency)
    return {
      originalAmount: this.roundAccounting(originalAmount),
      originalCurrency,
      exchangeRate: rate,
      accountingAmountUSD: this.roundAccounting(this.convertToUSD(originalAmount, originalCurrency)),
      exchangeRateDate: new Date().toISOString(),
    }
  }

  async updateCurrencyRate(code: string, rate: number, source: RateSource = "api"): Promise<void> {
    const now = new Date().toISOString()
    await dbUpdateCurrencyRate(code, rate, now)

    const currency = this.currencies.get(code)
    if (currency) {
      currency.lastKnownRate = rate
      currency.lastRateUpdatedAt = now
    }

    this.rateCache.set(code, { rate, source, fetchedAt: new Date() })
    this.notify()
  }

  async recordRateHistory(code: string, rate: number, source: string): Promise<void> {
    await dbRecordRateHistory(code, rate, source)
  }

  async recordRateAuditLog(
    code: string,
    oldRate: number | null,
    newRate: number,
    changedBy: string,
    reason: string
  ): Promise<void> {
    const now = new Date().toISOString()
    await dbRecordRateAuditLog(code, oldRate, newRate, changedBy, reason, now)
  }

  async setManualOverride(
    code: string,
    rate: number,
    changedBy: string,
    reason: string,
    userRole: string
  ): Promise<void> {
    if (!userRole || userRole.toLowerCase() !== "admin") {
      throw new Error("Unauthorized: Administrator role required to modify currency rates.")
    }

    if (rate <= 0) {
      throw new Error("Rate must be greater than zero.")
    }

    const oldRate = this.getRate(code)
    const now = new Date().toISOString()

    await dbSetManualOverride(code, rate, changedBy, reason, now)
    await dbUpdateCurrencyRate(code, rate, now)
    await dbRecordRateHistory(code, rate, "manual")
    await dbRecordRateAuditLog(code, oldRate, rate, changedBy, reason, now)

    this.overrides.set(code, {
      currencyCode: code,
      mode: "manual",
      manualRate: rate,
      updatedBy: changedBy,
      updatedAt: now,
      reason,
    })

    this.rateCache.delete(code)
    this.notify()
  }

  async setAutomaticMode(code: string, changedBy: string, userRole: string): Promise<void> {
    if (!userRole || userRole.toLowerCase() !== "admin") {
      throw new Error("Unauthorized: Administrator role required to modify currency rates.")
    }

    const oldRate = this.getRate(code)
    const now = new Date().toISOString()

    await dbSetAutomaticMode(code, changedBy, now)
    await dbRecordRateAuditLog(code, oldRate, null, changedBy, "Switched to automatic mode", now)

    this.overrides.set(code, {
      currencyCode: code,
      mode: "automatic",
      manualRate: null,
      updatedBy: changedBy,
      updatedAt: now,
      reason: "Switched to automatic API sync",
    })

    this.rateCache.delete(code)
    this.notify()
  }

  async getAuditLog(limit: number = 50): Promise<AuditLogEntry[]> {
    return dbGetRateAuditLog(limit)
  }

  async addCurrency(
    isoCode: string,
    name: string,
    symbol: string,
    decimalPrecision: number,
    initialRate: number,
    userRole?: string
  ): Promise<void> {
    if (decimalPrecision < 0 || decimalPrecision > 4) {
      throw new Error("Decimal precision must be between 0 and 4.")
    }
    if (initialRate <= 0) {
      throw new Error("Initial rate must be greater than zero.")
    }

    await dbAddCurrency(isoCode.toUpperCase(), name, symbol, decimalPrecision, initialRate)

    const code = isoCode.toUpperCase()
    this.currencies.set(code, {
      isoCode: code,
      name,
      symbol,
      decimalPrecision,
      isActive: true,
      lastKnownRate: initialRate,
      lastRateUpdatedAt: new Date().toISOString(),
    })
    this.overrides.set(code, {
      currencyCode: code,
      mode: "automatic",
      manualRate: null,
      updatedBy: null,
      updatedAt: new Date().toISOString(),
      reason: null,
    })
    this.rateCache.delete(code)
    this.notify()

    if (userRole && userRole.toLowerCase() === "admin") {
      await this.recordRateAuditLog(
        code,
        null,
        initialRate,
        "system",
        `Currency ${code} added with initial rate ${initialRate}`
      )
    }
  }

  async toggleCurrencyActive(code: string, isActive: boolean): Promise<void> {
    await dbToggleCurrencyActive(code, isActive)

    const currency = this.currencies.get(code)
    if (currency) currency.isActive = isActive

    this.notify()
  }

  async syncRatesFromAPI(): Promise<{ synced: number; failed: number; errors: string[] }> {
    return {
      synced: 0,
      failed: 0,
      errors: ["Rate sync is not available in offline mode"],
    }
  }
}

export const CurrencyService = new CurrencyServiceClass()
