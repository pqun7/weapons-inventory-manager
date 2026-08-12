import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from "react"
import { CurrencyService, type CurrencyInfo } from "@/lib/currency-service"
import { useStore } from "@/lib/store"
import {
  formatAccountingAggregate as formatAggregate,
  formatInvoiceMoney,
  formatInvoiceLineMoney,
  formatPaymentMoney,
  formatValuation as formatMoneyValuation,
  invoiceAccountingAmount,
  type InvoiceMoneyField,
} from "@/lib/money-ui"
import type { Invoice, MoneyValuation, PaymentRecord } from "@/lib/types"
import { getCurrencyPresentation, type CurrencyPresentation } from "@/lib/currency-display"

type ReportViewMode = "original" | "accounting" | "display"

interface CurrencyContextValue {
  displayCurrency: string
  accountingCurrency: string
  transactionCurrency: string
  setDisplayCurrency: (code: string) => void
  reportViewMode: ReportViewMode
  setReportViewMode: (mode: ReportViewMode) => void
  currencies: CurrencyInfo[]
  isLoaded: boolean
  format: (accountingAmount: number, currencyOverride?: string) => string
  formatOriginal: (amount: number, currencyCode: string) => string
  formatValuation: (valuation: MoneyValuation | undefined, mode?: ReportViewMode, unresolvedAmount?: number, unresolvedCurrency?: string) => string
  formatInvoice: (invoice: Invoice, field: InvoiceMoneyField, mode?: ReportViewMode) => string
  formatInvoiceLine: (invoice: Invoice, amount: number) => string
  formatPayment: (payment: PaymentRecord, mode?: ReportViewMode) => string
  formatAccountingAggregate: (amount: number, mode?: ReportViewMode) => string
  currencyPresentation: (code: string) => CurrencyPresentation
  convertToDisplay: (accountingAmount: number) => number
  refresh: () => void
}

const CurrencyContext = createContext<CurrencyContextValue | undefined>(undefined)
type CurrencyProviderProps = {
  children: ReactNode
  locale: string
  displayCurrency: string
  reportViewMode: ReportViewMode
  onDisplayCurrencyChange: (code: string) => void
  onReportViewModeChange: (mode: ReportViewMode) => void
}

export function CurrencyProvider({
  children,
  locale,
  displayCurrency: externalDisplayCurrency,
  reportViewMode: externalReportViewMode,
  onDisplayCurrencyChange,
  onReportViewModeChange,
}: CurrencyProviderProps) {
  performance.mark("boot:provider:currency:render:start")
  const [displayCurrency, setDisplayCurrencyState] = useState<string>(externalDisplayCurrency)
  const [reportViewMode, setReportViewModeState] = useState<ReportViewMode>(externalReportViewMode)
  const [currencies, setCurrencies] = useState<CurrencyInfo[]>([])
  const [isLoaded, setIsLoaded] = useState(false)
  const [, forceUpdate] = useState({})
  const settings = useStore((state) => state.settings)
  const accountingCurrency = settings.accountingCurrencyCode
  const transactionCurrency = settings.currencyCode
  CurrencyService.configureAccountingCurrency(accountingCurrency)

  useEffect(() => {
    setDisplayCurrencyState(externalDisplayCurrency)
  }, [externalDisplayCurrency])

  useEffect(() => {
    setReportViewModeState(externalReportViewMode)
  }, [externalReportViewMode])

  const refresh = useCallback(() => {
    setCurrencies(CurrencyService.getCurrencies())
    forceUpdate({})
  }, [])

  useEffect(() => {
    performance.mark("boot:provider:currency:effect:start")
    let mounted = true;

    CurrencyService.load()
      .then(() => {
        if (!mounted) return;
        setCurrencies(CurrencyService.getCurrencies());
        setIsLoaded(true);
      })
      .catch(console.error);

    return () => {
      mounted = false;
    };
  }, [accountingCurrency]);

  useEffect(() => CurrencyService.subscribe(refresh), [refresh])

  const resolvedDisplayCurrency = useMemo(() => {
    if (!isLoaded || currencies.length === 0) return displayCurrency
    if (currencies.some((currency) => currency.isoCode === displayCurrency)) return displayCurrency
    return currencies.find((currency) => currency.isoCode === settings.preferredDisplayCurrency)?.isoCode
      ?? currencies.find((currency) => currency.isoCode === transactionCurrency)?.isoCode
      ?? currencies.find((currency) => currency.isoCode === accountingCurrency)?.isoCode
      ?? currencies[0].isoCode
  }, [accountingCurrency, currencies, displayCurrency, isLoaded, settings.preferredDisplayCurrency, transactionCurrency])

  useEffect(() => {
    if (!isLoaded || resolvedDisplayCurrency === displayCurrency) return
    setDisplayCurrencyState(resolvedDisplayCurrency)
    onDisplayCurrencyChange(resolvedDisplayCurrency)
  }, [displayCurrency, isLoaded, onDisplayCurrencyChange, resolvedDisplayCurrency])

  useEffect(() => {
    performance.mark("boot:provider:currency:mounted")
    performance.measure("boot:provider:currency:mount", "boot:provider:currency:render:start", "boot:provider:currency:mounted")
  }, [])

  const setDisplayCurrency = useCallback((code: string) => {
    if (!currencies.some((currency) => currency.isoCode === code && currency.isActive)) return
    setDisplayCurrencyState(code)
    onDisplayCurrencyChange(code)
  }, [currencies, onDisplayCurrencyChange])

  const setReportViewMode = useCallback((mode: ReportViewMode) => {
    setReportViewModeState(mode)
    onReportViewModeChange(mode)
  }, [onReportViewModeChange])

  const convertToDisplay = useCallback(
    (accountingAmount: number) => CurrencyService.convertFromAccounting(accountingAmount, resolvedDisplayCurrency),
    [resolvedDisplayCurrency]
  )

  const format = useCallback(
    (accountingAmount: number, currencyOverride?: string) => {
      const targetCurrency = currencyOverride || resolvedDisplayCurrency
      const displayAmount = CurrencyService.convertFromAccounting(accountingAmount, targetCurrency)
      return CurrencyService.format(displayAmount, targetCurrency, locale)
    },
    [resolvedDisplayCurrency, locale]
  )

  const formatOriginal = useCallback(
    (amount: number, currencyCode: string) => CurrencyService.format(amount, currencyCode, locale),
    [locale]
  )

  const formatValuation = useCallback(
    (valuation: MoneyValuation | undefined, mode: ReportViewMode = "display", unresolvedAmount?: number, unresolvedCurrency?: string) =>
      formatMoneyValuation(
        valuation,
        resolvedDisplayCurrency,
        locale,
        mode,
        unresolvedAmount,
        unresolvedCurrency ?? accountingCurrency,
      ),
    [accountingCurrency, resolvedDisplayCurrency, locale],
  )

  const formatInvoice = useCallback(
    (invoice: Invoice, field: InvoiceMoneyField, mode: ReportViewMode = "display") => {
      try {
        return formatInvoiceMoney(invoice, field, resolvedDisplayCurrency, locale, mode)
      } catch {
        const invoiceCurrency = invoice.accountingCurrency ?? accountingCurrency
        const accountingValue = invoiceAccountingAmount(invoice, field)
        return CurrencyService.format(accountingValue ?? (Number(invoice[field]) || 0), invoiceCurrency, locale)
      }
    },
    [accountingCurrency, resolvedDisplayCurrency, locale],
  )

  const formatInvoiceLine = useCallback(
    (invoice: Invoice, amount: number) => {
      try { return formatInvoiceLineMoney(invoice, amount, resolvedDisplayCurrency, locale) }
      catch { return CurrencyService.format(amount, invoice.currency ?? accountingCurrency, locale) }
    },
    [accountingCurrency, resolvedDisplayCurrency, locale],
  )

  const formatPayment = useCallback(
    (payment: PaymentRecord, mode: ReportViewMode = "display") => {
      try { return formatPaymentMoney(payment, resolvedDisplayCurrency, locale, mode) }
      catch { return CurrencyService.format(payment.amount, payment.currency ?? accountingCurrency, locale) }
    },
    [accountingCurrency, resolvedDisplayCurrency, locale],
  )

  const formatAccountingAggregate = useCallback(
    (amount: number, mode: ReportViewMode = "display") => {
      try {
        return formatAggregate(amount, accountingCurrency, resolvedDisplayCurrency, locale, mode)
      } catch {
        return CurrencyService.format(amount, accountingCurrency, locale)
      }
    },
    [accountingCurrency, resolvedDisplayCurrency, locale],
  )

  const currencyPresentation = useCallback((code: string) => {
    const currency = currencies.find((item) => item.isoCode === code)
    return getCurrencyPresentation({
      isoCode: code,
      name: currency?.name,
      symbol: currency?.symbol,
    }, locale)
  }, [currencies, locale])

  return (
    <CurrencyContext.Provider
      value={{
        displayCurrency: resolvedDisplayCurrency,
        accountingCurrency,
        transactionCurrency,
        setDisplayCurrency,
        reportViewMode,
        setReportViewMode,
        currencies,
        isLoaded,
        format,
        formatOriginal,
        formatValuation,
        formatInvoice,
        formatInvoiceLine,
        formatPayment,
        formatAccountingAggregate,
        currencyPresentation,
        convertToDisplay,
        refresh,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext)
  if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider")
  return ctx
}
