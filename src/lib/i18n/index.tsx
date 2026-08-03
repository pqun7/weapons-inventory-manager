import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import { translations, LANGUAGE_META, type Language, type Locale } from "./translations"
import { setFormatLanguage } from "../format"
import { useStore } from "../store"

interface I18nContextValue {
  lang: Language
  locale: Locale
  dir: "ltr" | "rtl"
  setLang: (lang: Language) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined)

export function I18nProvider({ children }: { children: ReactNode }) {
  const settings = useStore((s) => s.settings)
  const userPreferences = useStore((s) => s.userPreferences)
  const updateSettings = useStore((s) => s.updateSettings)
  const updateUserPreferences = useStore((s) => s.updateUserPreferences)

  const [lang, setLangState] = useState<Language>(() => {
    const dbLang = userPreferences?.language ?? settings.appLanguage
    if (dbLang === "en" || dbLang === "ar") return dbLang
    return "en"
  })

  useEffect(() => {
    const dbLang = userPreferences?.language ?? settings.appLanguage
    if (dbLang === "en" || dbLang === "ar") setLangState(dbLang)
  }, [settings.appLanguage, userPreferences?.language])

  const dir = LANGUAGE_META[lang].dir
  const locale = LANGUAGE_META[lang].locale

  const setLang = useCallback((newLang: Language) => {
    setLangState(newLang)
    updateUserPreferences({ language: newLang }).catch(() => {
      updateSettings({ appLanguage: newLang }).catch(() => {})
    })
  }, [updateSettings, updateUserPreferences])

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
