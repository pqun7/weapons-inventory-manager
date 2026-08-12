import { Suspense, lazy, useEffect } from "react"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { DirectionProvider } from "@/components/ui/direction"
import { Toaster } from "@/components/ui/sonner"
import { NavProvider, useNav } from "@/lib/nav"
import { CurrencyProvider } from "@/lib/currency-context"
import { ThemeProvider } from "@/components/theme-provider"
import { Spinner } from "@/components/ui/spinner"
import type { Language } from "@/lib/i18n/translations"
import { I18nProvider } from "@/lib/i18n"
// <-- new import

import { ErrorBoundary } from "@/components/ErrorBoundary"
import { useStore } from "@/lib/store"
import { canAccessPage } from "@/lib/rbac"
import { EntityDialogProvider } from "@/components/entity-dialog-provider"

const DashboardPage = lazy(() => import("@/pages/dashboard").then((m) => ({ default: m.DashboardPage })))
const InventoryPage = lazy(() => import("@/pages/inventory").then((m) => ({ default: m.InventoryPage })))
const SalesPage = lazy(() => import("@/pages/sales").then((m) => ({ default: m.SalesPage })))
const ShipmentsPage = lazy(() => import("@/pages/shipments").then((m) => ({ default: m.ShipmentsPage })))
const FinancialsPage = lazy(() => import("@/pages/financials").then((m) => ({ default: m.FinancialsPage })))
const CustomersPage = lazy(() => import("@/pages/customers").then((m) => ({ default: m.CustomersPage })))
const SuppliersPage = lazy(() => import("@/pages/suppliers").then((m) => ({ default: m.SuppliersPage })))
const AuditPage = lazy(() => import("@/pages/audit").then((m) => ({ default: m.AuditPage })))
const SettingsPage = lazy(() => import("@/pages/settings").then((m) => ({ default: m.SettingsPage })))
const AppSidebar = lazy(() => import("@/components/app-sidebar").then((m) => ({ default: m.AppSidebar })))
const AppHeader = lazy(() => import("@/components/app-header").then((m) => ({ default: m.AppHeader })))
const CommandBar = lazy(() => import("@/components/command-bar").then((m) => ({ default: m.CommandBar })))

function RouteLoadingFallback() {
  return (
    <div className="flex h-full min-h-48 items-center justify-center">
      <Spinner className="size-6" />
    </div>
  )
}

function PageRouter() {
  const { currentPage, navigate } = useNav()
  const currentUser = useStore((state) => state.getCurrentUser())
  const allowed = canAccessPage(currentUser, currentPage)

  useEffect(() => {
    if (!allowed) navigate("inventory")
  }, [allowed, navigate])

  if (!allowed) return <RouteLoadingFallback />
  let PageComponent: React.ComponentType

  switch (currentPage) {
    case "dashboard":
      PageComponent = DashboardPage
      break
    case "inventory":
      PageComponent = InventoryPage
      break
    case "sales":
      PageComponent = SalesPage
      break
    case "shipments":
      PageComponent = ShipmentsPage
      break
    case "financials":
      PageComponent = FinancialsPage
      break
    case "customers":
      PageComponent = CustomersPage
      break
    case "suppliers":
      PageComponent = SuppliersPage
      break
    case "audit":
      PageComponent = AuditPage
      break
    case "settings":
      PageComponent = SettingsPage
      break
    default:
      PageComponent = DashboardPage
      break
  }

  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <PageComponent />
    </Suspense>
  )
}

export type AppProps = {
  ready: boolean
  lang: Language
  theme: "dark" | "light" | "system"
  displayCurrency: string
  reportViewMode: "original" | "accounting" | "display"
  locale: string
  onThemeChange: (theme: "dark" | "light" | "system") => void
  onDisplayCurrencyChange: (code: string) => void
  onReportViewModeChange: (mode: "original" | "accounting" | "display") => void
  onLangChange: (lang: Language) => void
}

function AppContent({
  ready,
  lang,
  theme,
  displayCurrency,
  reportViewMode,
  locale,
  onThemeChange,
  onDisplayCurrencyChange,
  onReportViewModeChange,
  onLangChange,
}: AppProps) {
  const dir = lang === "ar" ? "rtl" : "ltr"
  return (
    <ThemeProvider theme={theme} onThemeChange={onThemeChange}>
      {/* I18nProvider must be placed high enough to cover all components that use useI18n */}
      <I18nProvider lang={lang} onLangChange={onLangChange}>
        <CurrencyProvider
          locale={locale}
          displayCurrency={displayCurrency}
          reportViewMode={reportViewMode}
          onDisplayCurrencyChange={onDisplayCurrencyChange}
          onReportViewModeChange={onReportViewModeChange}
        >
          <DirectionProvider dir={dir}>
            <EntityDialogProvider>
              <SidebarProvider>
                <Suspense
                  fallback={
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
                      <Spinner className="size-8 text-primary" />
                    </div>
                  }
                >
                  <AppSidebar />
                  <SidebarInset>
                    <AppHeader />
                    <div className="flex-1 overflow-auto scrollbar-thin">
                      {ready ? <PageRouter /> : <BootPlaceholder />}
                    </div>
                  </SidebarInset>
                  <CommandBar />
                </Suspense>
                {/* Toaster is now inside I18nProvider, so useI18n will work */}
                <Toaster position={dir === "rtl" ? "bottom-left" : "bottom-right"} richColors />
              </SidebarProvider>
            </EntityDialogProvider>
          </DirectionProvider>
        </CurrencyProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}

export function App(props: AppProps) {
  useEffect(() => {
    performance.mark("boot:app-shell:mounted")
    console.info("[perf] boot:app-shell mounted")
  }, [])

  return (
    <NavProvider>
      <ErrorBoundary>
        <AppContent {...props} />
      </ErrorBoundary>
    </NavProvider>
  )
}

function BootPlaceholder() {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-4 p-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-xl border bg-muted/40" />
        ))}
      </div>
      <div className="grid flex-1 gap-4 lg:grid-cols-[1.4fr_0.9fr]">
        <div className="min-h-72 animate-pulse rounded-xl border bg-muted/40" />
        <div className="grid gap-4">
          <div className="min-h-36 animate-pulse rounded-xl border bg-muted/40" />
          <div className="min-h-36 animate-pulse rounded-xl border bg-muted/40" />
        </div>
      </div>
    </div>
  )
}

export default App
