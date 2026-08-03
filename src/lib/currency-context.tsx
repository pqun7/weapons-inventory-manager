import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { CurrencyService, type CurrencyInfo } from "@/lib/currency-service"
import { useI18n } from "@/lib/i18n"
import { useStore } from "@/lib/store"

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

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { locale } = useI18n()
  const settings = useStore((s) => s.settings)
  const userPreferences = useStore((s) => s.userPreferences)
  const updateUserPreferences = useStore((s) => s.updateUserPreferences)
  const updateSettings = useStore((s) => s.updateSettings)

  const [displayCurrency, setDisplayCurrencyState] = useState<string>(
    () => userPreferences?.displayCurrency ?? settings.preferredDisplayCurrency ?? "USD"
  )
  const [reportViewMode, setReportViewModeState] = useState<ReportViewMode>(
    () => userPreferences?.reportViewMode ?? "accounting"
  )
  const [currencies, setCurrencies] = useState<CurrencyInfo[]>([])
  const [isLoaded, setIsLoaded] = useState(false)
  const [, forceUpdate] = useState({})

  useEffect(() => {
    const dbCurrency = userPreferences?.displayCurrency ?? settings.preferredDisplayCurrency
    if (dbCurrency) setDisplayCurrencyState(dbCurrency)
    const dbReportView = userPreferences?.reportViewMode
    if (dbReportView) setReportViewModeState(dbReportView as ReportViewMode)
  }, [settings.preferredDisplayCurrency, userPreferences?.displayCurrency, userPreferences?.reportViewMode])

  const refresh = useCallback(() => {
    setCurrencies(CurrencyService.getCurrencies())
    forceUpdate({})
  }, [])

  useEffect(() => {
    (async () => {
      await CurrencyService.load()
      setCurrencies(CurrencyService.getCurrencies())
      setIsLoaded(true)
    })()

    const unsub = CurrencyService.subscribe(() => {
      setCurrencies(CurrencyService.getCurrencies())
      forceUpdate({})
    })
    return unsub
  }, [])

  const setDisplayCurrency = useCallback((code: string) => {
    setDisplayCurrencyState(code)
    updateUserPreferences({ displayCurrency: code }).catch(() => {
      updateSettings({ preferredDisplayCurrency: code }).catch(() => {})
    })
  }, [updateSettings, updateUserPreferences])

  const setReportViewMode = useCallback((mode: ReportViewMode) => {
    setReportViewModeState(mode)
    updateUserPreferences({ reportViewMode: mode }).catch(() => {})
  }, [updateUserPreferences])

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
