import { useEffect, useState } from "react"
import { useStore } from "@/lib/store"
import { useAppBootstrap } from "@/hooks/use-app-bootstrap"
import type { AppProps } from "./App.tsx"
import { useSupabaseAuth } from "@/hooks/use-supabase-auth"
import { AuthScreen } from "@/components/auth-screen"
import { useSupabaseSync } from "@/hooks/use-supabase-sync"
import { translations } from "@/lib/i18n/translations"

type Language = "en" | "ar"

const LANGUAGE_LOCALE: Record<Language, AppProps["locale"]> = {
    en: "en-US",
    ar: "ar-SA",
}

type LoadedModules = {
    App: React.ComponentType<AppProps>
}

performance.mark("boot:app-root:module:start")
console.info("[perf] app-root.tsx module start")
async function loadAppModules(): Promise<LoadedModules> {
    performance.mark("boot:app-root:app-import:start")

    const appModule = await import("./App")

    performance.mark("boot:app-root:app-import:end")
    performance.measure(
        "boot:app-root:app-import",
        "boot:app-root:app-import:start",
        "boot:app-root:app-import:end"
    )

    return {
        App: appModule.default,
    }
}

export function AppRoot() {
    const [modules, setModules] = useState<LoadedModules | null>(null)
    const auth = useSupabaseAuth()
    const { ready, error } = useAppBootstrap(!auth.loading && auth.session !== null)
    useSupabaseSync(ready && auth.session !== null)
    const settings = useStore((state) => state.settings)
    const userPreferences = useStore((state) => state.userPreferences)
    const updateSettings = useStore((state) => state.updateSettings)
    const updateUserPreferences = useStore((state) => state.updateUserPreferences)
    const lang = (settings.appLanguage ?? "en") as Language
    const t = (key: string) => translations[lang][key] ?? translations.en[key] ?? key

    useEffect(() => {
        let cancelled = false
        performance.mark("boot:app-root:load:start")
        loadAppModules().then((loaded) => {
            if (cancelled) return
            performance.mark("boot:app-root:load:end")
            performance.measure("boot:app-root:load", "boot:app-root:load:start", "boot:app-root:load:end")
            console.info("[perf] app-root.tsx modules loaded")
            setModules(loaded)
        }).catch((error) => {
            console.error("Failed to load app modules:", error)
        })

        return () => {
            cancelled = true
        }
    }, [])

    if (!modules || auth.loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-background text-foreground">
                <div className="space-y-2 text-center">
                    <div className="mx-auto size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
                    <p className="text-sm font-medium">{t("app.loadingApplication")}</p>
                </div>
            </div>
        )
    }

    if (!auth.session) {
        return (
            <AuthScreen
                lang={lang}
                error={auth.error}
                onResolve={auth.resolveAccount}
                onSignIn={auth.signIn}
                onCompleteFirstLogin={auth.completeFirstLogin}
            />
        )
    }

    if (error) {
        return (
            <div className="flex h-screen items-center justify-center">
                <div className="text-center space-y-2">
                    <p className="text-destructive font-medium">{t("app.databaseInitFailed")}</p>
                    <p className="text-muted-foreground text-sm">{error}</p>
                </div>
            </div>
        )
    }

    if (!ready) {
        return (
            <div className="flex h-screen items-center justify-center bg-background text-foreground">
                <div className="space-y-2 text-center">
                    <div className="mx-auto size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
                    <p className="text-sm font-medium">{t("app.loadingInventory")}</p>
                </div>
            </div>
        )
    }

    const { App } = modules
    const handleLangChange = (newLang: Language) => {
        updateSettings({ appLanguage: newLang })
    }

    return (
        <App
            ready={ready}
            lang={lang}
            theme={(settings.theme ?? "system") as "dark" | "light" | "system"}
            displayCurrency={userPreferences?.displayCurrency ?? settings.preferredDisplayCurrency ?? settings.currencyCode}
            reportViewMode={userPreferences?.reportViewMode ?? "display"}
            locale={LANGUAGE_LOCALE[lang]}
            onThemeChange={(theme: AppProps["theme"]) => { void updateSettings({ theme }) }}
            onDisplayCurrencyChange={(code: string) => { void updateUserPreferences({ displayCurrency: code }) }}
            onReportViewModeChange={(mode: AppProps["reportViewMode"]) => { void updateUserPreferences({ reportViewMode: mode }) }}
            onLangChange={handleLangChange}
        />
    )
}
