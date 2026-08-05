import { useEffect, useState } from "react"
import { useStore } from "@/lib/store"
import { useAppBootstrap } from "@/hooks/use-app-bootstrap"
import type { AppProps } from "./App.tsx"

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
    performance.mark("boot:app-root:css-import:start")
    await import("./index.css")
    performance.mark("boot:app-root:css-import:end")
    performance.measure("boot:app-root:css-import", "boot:app-root:css-import:start", "boot:app-root:css-import:end")

    performance.mark("boot:app-root:app-import:start")
    const appModule = await import("./App.tsx")
    performance.mark("boot:app-root:app-import:end")
    performance.measure("boot:app-root:app-import", "boot:app-root:app-import:start", "boot:app-root:app-import:end")

    return {
        App: appModule.default,
    }
}

export function AppRoot() {
    const [modules, setModules] = useState<LoadedModules | null>(null)
    const { ready, error } = useAppBootstrap()
    const settings = useStore((state) => state.settings)
    const userPreferences = useStore((state) => state.userPreferences)
    const updateSettings = useStore((state) => state.updateSettings)
    const updateUserPreferences = useStore((state) => state.updateUserPreferences)

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

    if (!modules) {
        return null
    }

    if (error) {
        return (
            <div className="flex h-screen items-center justify-center">
                <div className="text-center space-y-2">
                    <p className="text-destructive font-medium">Database initialization failed</p>
                    <p className="text-muted-foreground text-sm">{error}</p>
                </div>
            </div>
        )
    }

    const { App } = modules
    const lang = (settings.appLanguage ?? "en") as Language

    return (
        <App
            ready={ready}
            lang={lang}
            theme={(settings.theme ?? "system") as "dark" | "light" | "system"}
            displayCurrency={userPreferences?.displayCurrency ?? settings.preferredDisplayCurrency ?? settings.currencyCode}
            reportViewMode={userPreferences?.reportViewMode ?? "accounting"}
            locale={LANGUAGE_LOCALE[lang]}
            onThemeChange={(theme: AppProps["theme"]) => { void updateSettings({ theme }) }}
            onDisplayCurrencyChange={(code: string) => { void updateSettings({ preferredDisplayCurrency: code }) }}
            onReportViewModeChange={(mode: AppProps["reportViewMode"]) => { void updateUserPreferences({ reportViewMode: mode }) }}
        />
    )
}