import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import { translations, LANGUAGE_META, type Language, type Locale } from "./translations"
import { setFormatLanguage } from "../format"

interface I18nContextValue {
  lang: Language
  locale: Locale
  dir: "ltr" | "rtl"
  setLang: (lang: Language) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined)
type I18nProviderProps = {
  children: ReactNode
  lang: Language
  onLangChange: (lang: Language) => void
}

export function I18nProvider({ children, lang: externalLang, onLangChange }: I18nProviderProps) {
  performance.mark("boot:provider:i18n:render:start")
  const [lang, setLangState] = useState<Language>(externalLang)

  useEffect(() => {
    setLangState(externalLang)
  }, [externalLang])

  const dir = LANGUAGE_META[lang].dir
  const locale = LANGUAGE_META[lang].locale

  const setLang = useCallback((newLang: Language) => {
    setLangState(newLang)
    onLangChange(newLang)
  }, [onLangChange])

  const t = useCallback((key: string, params?: Record<string, string | number>) => {
    const dict = translations[lang]
    let value = dict[key] ?? translations.en[key] ?? key
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        value = value.replace(new RegExp(`\\{${k}\\}`, "g"), String(v))
      }
    }
    return value
  }, [lang])

  useEffect(() => {
    performance.mark("boot:provider:i18n:mounted")
    performance.measure("boot:provider:i18n:mount", "boot:provider:i18n:render:start", "boot:provider:i18n:mounted")
    const meta = LANGUAGE_META[lang]
    document.documentElement.lang = lang
    document.documentElement.dir = meta.dir
    setFormatLanguage(lang)
  }, [lang, dir])

  return (
    <I18nContext.Provider value={{ lang, locale, dir, setLang, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error("useI18n must be used within I18nProvider")
  return ctx
}
