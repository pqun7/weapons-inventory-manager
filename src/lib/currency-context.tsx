import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { CurrencyService, type CurrencyInfo } from "@/lib/currency-service"

type ReportViewMode = "original" | "accounting" | "display"

interface CurrencyContextValue {
  displayCurrency: string
  setDisplayCurrency: (code: string) => void
  reportViewMode: ReportViewMode
  setReportViewMode: (mode: ReportViewMode) => void
  currencies: CurrencyInfo[]
  isLoaded: boolean
  format: (usdAmount: number, currencyOverride?: string) => string
  formatOriginal: (amount: number, currencyCode: string) => string
  convertToDisplay: (usdAmount: number) => number
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
  }, []);

  useEffect(() => {
    performance.mark("boot:provider:currency:mounted")
    performance.measure("boot:provider:currency:mount", "boot:provider:currency:render:start", "boot:provider:currency:mounted")
  }, [])

  const setDisplayCurrency = useCallback((code: string) => {
    setDisplayCurrencyState(code)
    onDisplayCurrencyChange(code)
  }, [onDisplayCurrencyChange])

  const setReportViewMode = useCallback((mode: ReportViewMode) => {
    setReportViewModeState(mode)
    onReportViewModeChange(mode)
  }, [onReportViewModeChange])

  const convertToDisplay = useCallback(
    (usdAmount: number) => CurrencyService.convertFromUSD(usdAmount, displayCurrency),
    [displayCurrency]
  )

  const format = useCallback(
    (usdAmount: number, currencyOverride?: string) => {
      const targetCurrency = currencyOverride || displayCurrency
      const displayAmount = CurrencyService.convertFromUSD(usdAmount, targetCurrency)
      return CurrencyService.format(displayAmount, targetCurrency, locale)
    },
    [displayCurrency, locale]
  )

  const formatOriginal = useCallback(
    (amount: number, currencyCode: string) => CurrencyService.format(amount, currencyCode, locale),
    [locale]
  )

  return (
    <CurrencyContext.Provider
      value={{
        displayCurrency,
        setDisplayCurrency,
        reportViewMode,
        setReportViewMode,
        currencies,
        isLoaded,
        format,
        formatOriginal,
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
