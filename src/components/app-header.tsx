import { Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ModeToggle } from "@/components/mode-toggle"
import { LanguageSwitcher } from "@/components/language-switcher"
import { DisplayCurrencySelector } from "@/components/display-currency-selector"
import { NotificationCenter } from "@/components/notification-center"
import { useNav } from "@/lib/nav"
import { useStore } from "@/lib/store"
import { useI18n } from "@/lib/i18n"
import { useCurrency } from "@/lib/currency-context"
import type { PageKey } from "@/lib/nav"

export function AppHeader() {
  const { currentPage, setCommandBarOpen } = useNav()
  const getCurrentUser = useStore((s) => s.getCurrentUser)
  const currentUser = getCurrentUser()
  const { t } = useI18n()
  const { displayCurrency } = useCurrency()

  const PAGE_TITLES: Record<PageKey, string> = {
    dashboard: t("page.dashboard"),
    inventory: t("page.inventory"),
    sales: t("page.sales"),
    shipments: t("page.shipments"),
    financials: t("page.financials"),
    customers: t("page.customers"),
    suppliers: t("page.suppliers"),
    audit: t("page.audit"),
    settings: t("page.settings"),
  }

  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/60" data-display-currency={displayCurrency}>
      <SidebarTrigger className="-ms-1 size-7" />
      <Separator orientation="vertical" className="me-1 h-4" />
      <h1 className="text-sm font-semibold tracking-tight">{PAGE_TITLES[currentPage]}</h1>

      <div className="ms-4 hidden flex-1 items-center md:flex">
        <Button
          variant="outline"
          className="h-7 w-full max-w-xs justify-start gap-2 text-xs text-muted-foreground"
          onClick={() => setCommandBarOpen(true)}
        >
          <Search className="size-3.5" />
          <span>{t("app.searchPlaceholder")}</span>
          <kbd className="ms-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{t("app.searchKbd")}</kbd>
        </Button>
      </div>

      <div className="ms-auto flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          onClick={() => setCommandBarOpen(true)}
        >
          <Search className="size-4" />
        </Button>

        <NotificationCenter />
        <DisplayCurrencySelector />
        <LanguageSwitcher />
        <ModeToggle />
        <Separator orientation="vertical" className="mx-0.5 h-4" />
        <div className="flex items-center gap-1.5">
          <div className="flex size-7 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
            {currentUser.name.charAt(0)}
          </div>
          <div className="hidden flex-col sm:flex">
            <span className="text-[11px] font-medium leading-tight">{currentUser.name}</span>
            <span className="mt-0.5 h-3.5 px-1 text-[9px] leading-none rounded-md bg-secondary text-secondary-foreground inline-flex items-center">
              {t(`role.${currentUser.role}`)}
            </span>
          </div>
        </div>
      </div>
    </header>
  )
}
