export interface CurrencyPresentationInput {
  isoCode: string
  name?: string
  symbol?: string
}

export interface CurrencyPresentation {
  code: string
  name: string
  symbol: string
  compactSymbol: string
}

const ARABIC_CURRENCIES: Record<string, { name: string; symbol: string; compactSymbol: string }> = {
  USD: { name: "دولار أمريكي", symbol: "$", compactSymbol: "$" },
  SDG: { name: "جنيه سوداني", symbol: "جنيه سوداني", compactSymbol: "ج.س" },
  SAR: { name: "ريال سعودي", symbol: "ريال", compactSymbol: "ر.س" },
  AED: { name: "درهم إماراتي", symbol: "درهم", compactSymbol: "د.إ" },
  EGP: { name: "جنيه مصري", symbol: "جنيه مصري", compactSymbol: "ج.م" },
  EUR: { name: "يورو", symbol: "€", compactSymbol: "€" },
  GBP: { name: "جنيه إسترليني", symbol: "£", compactSymbol: "£" },
  KWD: { name: "دينار كويتي", symbol: "دينار", compactSymbol: "د.ك" },
  QAR: { name: "ريال قطري", symbol: "ريال قطري", compactSymbol: "ر.ق" },
  OMR: { name: "ريال عُماني", symbol: "ريال عُماني", compactSymbol: "ر.ع" },
  BHD: { name: "دينار بحريني", symbol: "دينار بحريني", compactSymbol: "د.ب" },
}

// Presentation-only symbols. These are never used to validate currencies or
// calculate exchange rates; they only keep known currencies readable while
// the renderer is waiting for the authoritative registry from Settings.
const STANDARD_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
}

function validSymbol(symbol: string | undefined, code: string): string {
  const normalized = symbol?.trim()
  return !normalized || normalized === "?" || normalized === "[?]"
    ? STANDARD_SYMBOLS[code] ?? code
    : normalized
}

export function getCurrencyPresentation(
  currency: CurrencyPresentationInput,
  locale: string,
): CurrencyPresentation {
  const code = currency.isoCode.trim().toUpperCase()
  if (locale.toLowerCase().startsWith("ar")) {
    const localized = ARABIC_CURRENCIES[code]
    if (localized) return { code, ...localized }
  }
  const symbol = validSymbol(currency.symbol, code)
  return {
    code,
    name: currency.name?.trim() || code,
    symbol,
    compactSymbol: symbol,
  }
}

export function formatLocalizedCurrency(
  amount: number,
  currency: CurrencyPresentationInput,
  locale: string,
  decimalPrecision: number,
): string {
  if (!Number.isFinite(amount)) return "—"
  const presentation = getCurrencyPresentation(currency, locale)
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimalPrecision,
    maximumFractionDigits: decimalPrecision,
  }).format(amount)
  return locale.toLowerCase().startsWith("ar")
    ? `${formatted} ${presentation.compactSymbol}`
    : `${presentation.compactSymbol} ${formatted}`
}
