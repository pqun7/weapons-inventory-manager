import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Truck,
  Landmark,
  Users,
  Building2,
  ScrollText,
  Settings,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { useNav, type PageKey } from "@/lib/nav"
import { useStore } from "@/lib/store"
import { useI18n } from "@/lib/i18n"
import { canAccessPage } from "@/lib/rbac"

const NAV_GROUPS: { labelKey: string; items: { key: PageKey; labelKey: string; icon: typeof LayoutDashboard }[] }[] = [
  {
    labelKey: "nav.operations",
    items: [
      { key: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
      { key: "inventory", labelKey: "nav.inventory", icon: Package },
      { key: "sales", labelKey: "nav.sales", icon: ShoppingCart },
      { key: "shipments", labelKey: "nav.shipments", icon: Truck },
    ],
  },
  {
    labelKey: "nav.finance",
    items: [
      { key: "financials", labelKey: "nav.financials", icon: Landmark },
    ],
  },
  {
    labelKey: "nav.directory",
    items: [
      { key: "customers", labelKey: "nav.customers", icon: Users },
      { key: "suppliers", labelKey: "nav.suppliers", icon: Building2 },
    ],
  },
  {
    labelKey: "nav.system",
    items: [
      { key: "audit", labelKey: "nav.audit", icon: ScrollText },
      { key: "settings", labelKey: "nav.settings", icon: Settings },
    ],
  },
]

export function AppSidebar() {
  const { currentPage, navigate } = useNav()
  const getCurrentUser = useStore((s) => s.getCurrentUser)
  const currentUser = getCurrentUser()
  const { t, dir } = useI18n()

  return (
    <Sidebar collapsible="icon" side={dir === "rtl" ? "right" : "left"}>
      {/* <SidebarHeader>
        <div className="flex h-12 items-center gap-2 px-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Crosshair className="size-5" />
          </div>
          <div className="flex flex-col overflow-hidden group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold tracking-tight">{t("app.name")}</span>
            <span className="text-xs text-muted-foreground">{t("app.version")}</span>
          </div>
        </div>
      </SidebarHeader> */}

      <SidebarContent>
        {NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => canAccessPage(currentUser, item.key)) }))
          .filter((group) => group.items.length > 0)
          .map((group) => (
          <SidebarGroup key={group.labelKey}>
            <SidebarGroupLabel>{t(group.labelKey)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      isActive={currentPage === item.key}
                      onClick={() => navigate(item.key)}
                      tooltip={t(item.labelKey)}
                    >
                      <item.icon />
                      <span>{t(item.labelKey)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2 rounded-md p-2 group-data-[collapsible=icon]:hidden">
          <div className="flex size-7 items-center justify-center rounded-md bg-sidebar-accent text-xs font-semibold">
            {currentUser.name.charAt(0)}
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="truncate text-xs font-medium">{currentUser.name}</span>
            <span className="truncate text-xs text-muted-foreground">{t(`role.${currentUser.role}`)}</span>
          </div>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
