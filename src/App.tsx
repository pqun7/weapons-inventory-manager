import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { DirectionProvider } from "@/components/ui/direction"
import { AppSidebar } from "@/components/app-sidebar"
import { AppHeader } from "@/components/app-header"
import { CommandBar } from "@/components/command-bar"
import { Toaster } from "@/components/ui/sonner"
import { NavProvider, useNav } from "@/lib/nav"
import { I18nProvider, useI18n } from "@/lib/i18n"
import { CurrencyProvider } from "@/lib/currency-context"
import { DashboardPage } from "@/pages/dashboard"
import { InventoryPage } from "@/pages/inventory"
import { SalesPage } from "@/pages/sales"
import { ShipmentsPage } from "@/pages/shipments"
import { FinancialsPage } from "@/pages/financials"
import { CustomersPage } from "@/pages/customers"
import { SuppliersPage } from "@/pages/suppliers"
import { AuditPage } from "@/pages/audit"
import { SettingsPage } from "@/pages/settings"
import { useAppBootstrap } from "@/hooks/use-app-bootstrap"
import { Spinner } from "@/components/ui/spinner"

function PageRouter() {
  const { currentPage } = useNav()

  switch (currentPage) {
    case "dashboard": return <DashboardPage />
    case "inventory": return <InventoryPage />
    case "sales": return <SalesPage />
    case "shipments": return <ShipmentsPage />
    case "financials": return <FinancialsPage />
    case "customers": return <CustomersPage />
    case "suppliers": return <SuppliersPage />
    case "audit": return <AuditPage />
    case "settings": return <SettingsPage />
    default: return <DashboardPage />
  }
}

function AppContent() {
  const { dir } = useI18n()
  return (
    <CurrencyProvider>
      <DirectionProvider dir={dir}>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <AppHeader />
            <div className="flex-1 overflow-auto scrollbar-thin">
              <PageRouter />
            </div>
          </SidebarInset>
          <CommandBar />
          <Toaster position={dir === "rtl" ? "bottom-left" : "bottom-right"} richColors />
        </SidebarProvider>
      </DirectionProvider>
    </CurrencyProvider>
  )
}

export function App() {
  return (
    <I18nProvider>
      <NavProvider>
        <AppShell />
      </NavProvider>
    </I18nProvider>
  )
}

function AppShell() {
  const { ready, error } = useAppBootstrap()

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

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner className="size-8" />
          <p className="text-muted-foreground text-sm">Loading database...</p>
        </div>
      </div>
    )
  }

  return <AppContent />
}

export default App
