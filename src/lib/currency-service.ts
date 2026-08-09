import Decimal from "decimal.js"
import { formatLocalizedCurrency } from "./currency-display.js"
import {
  dbAddCurrency,
  dbGetCurrencies,
  dbGetSettings,
  dbGetOverrides,
  dbGetRateAuditLog,
  dbRecordRateAuditLog,
  dbRecordRateHistory,
  dbSetAutomaticMode,
  dbSetManualOverride,
  dbToggleCurrencyActive,
  dbUpdateCurrencyRate,
  dbDeleteCurrency, // ← جديدة: دالة حذف العملة من قاعدة البيانات
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
  source?: RateSource
}

export type RateSource = "api" | "manual" | "cache" | "default"

interface CachedRate {
  rate: number
  source: RateSource
  fetchedAt: Date
}

class CurrencyServiceClass {
  private currencies: Map<string, CurrencyInfo> = new Map()
  private overrides: Map<string, ExchangeRateOverride> = new Map()
  private rateCache: Map<string, CachedRate> = new Map()
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private listeners: Set<() => void> = new Set()
  private accountingCurrencyCode = ""

  get accountingCurrency(): string {
    if (!this.accountingCurrencyCode) throw new Error("Accounting currency is not configured")
    return this.accountingCurrencyCode
  }

  configureAccountingCurrency(code: string): void {
    const normalized = code.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(normalized)) throw new Error("Accounting currency is not configured")
    if (this.accountingCurrencyCode === normalized) return
    this.accountingCurrencyCode = normalized
    this.loaded = false
    this.rateCache.clear()
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
    try {
      await this.loadPromise
    } finally {
      this.loadPromise = null
    }
  }

  private async _doLoad(): Promise<void> {
    try {
      const [, , settings] = await Promise.all([this.loadCurrencies(), this.loadOverrides(), dbGetSettings()])
      const accountingCurrency = settings.accountingCurrencyCode?.trim().toUpperCase()
      if (!accountingCurrency || !/^[A-Z]{3}$/.test(accountingCurrency)) {
        throw new Error("Accounting currency is not configured")
      }
      const accountingDefinition = this.currencies.get(accountingCurrency)
      if (!accountingDefinition?.isActive) throw new Error(`Accounting currency is unavailable: ${accountingCurrency}`)
      this.accountingCurrencyCode = accountingCurrency
      this.loaded = true
    } catch (err) {
      this.loaded = false
      throw err
    }
    this.notify()
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

  // ✅ الطريقة الأصلية: ترجع العملات المفعلة فقط (للاستخدام في القوائم المنسدلة والهيدر)
  getCurrencies(): CurrencyInfo[] {
    return Array.from(this.currencies.values()).filter((c) => c.isActive)
  }

  // ✅ جديدة: ترجع جميع العملات بغض النظر عن حالة التفعيل (للاستخدام في لوحة الإدارة)
  getAllCurrencies(): CurrencyInfo[] {
    return Array.from(this.currencies.values())
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
    if (currencyCode === this.accountingCurrencyCode) return 1
    const override = this.overrides.get(currencyCode)
    if (override?.mode === "manual" && override.manualRate != null) {
      return override.manualRate
    }
    const cached = this.rateCache.get(currencyCode)
    if (cached) return cached.rate
    const currency = this.currencies.get(currencyCode)
    if (currency && currency.isActive && Number.isFinite(currency.lastKnownRate) && currency.lastKnownRate > 0) {
      return currency.lastKnownRate
    }
    throw new Error(`No valid exchange rate is available for ${currencyCode}`)
  }

  getRateSource(currencyCode: string): RateSource {
    if (currencyCode === this.accountingCurrencyCode) return "default"
    const override = this.overrides.get(currencyCode)
    if (override?.mode === "manual" && override.manualRate != null) return "manual"
    const cached = this.rateCache.get(currencyCode)
    if (cached) return cached.source
    const currency = this.currencies.get(currencyCode)
    if (currency && currency.lastKnownRate) return "cache"
    return "default"
  }

  convertToAccounting(amount: number, fromCurrency: string): number {
    if (fromCurrency === this.accountingCurrencyCode) return amount
    const rate = this.getRate(fromCurrency)
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Invalid exchange rate for ${fromCurrency}`)
    const decAmount = new DecimalAny(amount)
    const decRate = new DecimalAny(rate)
    return decAmount.dividedBy(decRate).toNumber()
  }

  convertFromAccounting(accountingAmount: number, toCurrency: string): number {
    if (toCurrency === this.accountingCurrencyCode) return accountingAmount
    const rate = this.getRate(toCurrency)
    const decUsd = new DecimalAny(accountingAmount)
    const decRate = new DecimalAny(rate)
    return decUsd.times(decRate).toNumber()
  }

  convert(amount: number, fromCurrency: string, toCurrency: string): number {
    const accountingAmount = this.convertToAccounting(amount, fromCurrency)
    return this.convertFromAccounting(accountingAmount, toCurrency)
  }

  format(amount: number, currencyCode: string, locale: string = "en-US"): string {
    const currency = this.currencies.get(currencyCode)
    const precision = currency?.decimalPrecision ?? 2
    return formatLocalizedCurrency(
      amount,
      { isoCode: currencyCode, name: currency?.name, symbol: currency?.symbol },
      locale,
      precision,
    )
  }

  roundAccounting(amount: number): number {
    return new DecimalAny(amount).toDecimalPlaces(4, DecimalAny.ROUND_HALF_UP).toNumber()
  }

  roundDisplay(amount: number, currencyCode: string): number {
    const currency = this.currencies.get(currencyCode)
    const precision = currency?.decimalPrecision ?? 2
    return new DecimalAny(amount).toDecimalPlaces(precision, DecimalAny.ROUND_HALF_UP).toNumber()
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
    const now = new Date().toISOString()
    await dbSetManualOverride(code, rate, changedBy, reason, now)
    const currency = this.currencies.get(code)
    if (currency) {
      currency.lastKnownRate = rate
      currency.lastRateUpdatedAt = now
    }
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
    const now = new Date().toISOString()
    await dbSetAutomaticMode(code, changedBy, now)
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

  async deleteCurrency(code: string): Promise<void> {
    if (code === this.accountingCurrencyCode) {
      throw new Error(`Cannot delete the accounting currency (${this.accountingCurrencyCode}).`)
    }
    if (!this.currencies.has(code)) {
      throw new Error(`Currency ${code} does not exist.`)
    }
    await dbDeleteCurrency(code)
    this.currencies.delete(code)
    this.overrides.delete(code)
    this.rateCache.delete(code)
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
