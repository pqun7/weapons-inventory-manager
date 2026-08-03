import { useMemo, useState } from "react"
import { Bell, CheckCheck, X, AlertTriangle, Package, TrendingDown, Database, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useStore } from "@/lib/store"
import { useNav } from "@/lib/nav"
import { useI18n } from "@/lib/i18n"
import { formatDateTime } from "@/lib/format"
import type { NotificationType } from "@/lib/types"

const NOTIF_ICONS: Record<NotificationType, typeof Bell> = {
  OverdueDebt: AlertTriangle,
  DuplicateSerial: AlertTriangle,
  IncompleteShipment: Package,
  LowStock: TrendingDown,
  BackupOmission: Database,
  ShipmentDelayed: Truck,
  System: Bell,
}

const NOTIF_COLORS: Record<NotificationType, string> = {
  OverdueDebt: "text-status-sold",
  DuplicateSerial: "text-status-reserved",
  IncompleteShipment: "text-status-returned",
  LowStock: "text-status-reserved",
  BackupOmission: "text-muted-foreground",
  ShipmentDelayed: "text-status-sold",
  System: "text-primary",
}

const NOTIF_TITLE_KEYS: Record<NotificationType, string> = {
  OverdueDebt: "notif.title.overdueDebt",
  DuplicateSerial: "notif.title.duplicateSerial",
  IncompleteShipment: "notif.title.incompleteShipment",
  LowStock: "notif.title.lowStock",
  BackupOmission: "notif.title.backup",
  ShipmentDelayed: "notif.title.shipmentDelayed",
  System: "notif.title.system",
}

export function NotificationCenter() {
  const notifications = useStore((s) => s.notifications)
  const markRead = useStore((s) => s.markNotificationRead)
  const markAllRead = useStore((s) => s.markAllNotificationsRead)
  const dismiss = useStore((s) => s.dismissNotification)
  const { navigate, setFinancialFilter } = useNav()
  const { t } = useI18n()
  const [filterUnread, setFilterUnread] = useState(false)

  const unreadCount = notifications.filter((n) => !n.read).length
  const displayed = useMemo(
    () => filterUnread ? notifications.filter((n) => !n.read) : notifications,
    [notifications, filterUnread]
  )

  const handleNotifClick = (notifType: NotificationType, _entityId: string | null) => {
    if (notifType === "OverdueDebt") {
      navigate("financials")
      setFinancialFilter("overdue")
    } else if (notifType === "LowStock") {
      navigate("inventory")
    } else if (notifType === "IncompleteShipment" || notifType === "ShipmentDelayed") {
      navigate("shipments")
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative">
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-status-sold text-[10px] font-bold text-status-sold-fg">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{t("notif.title")}</span>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{unreadCount} {t("notif.new")}</Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="xs"
              variant={filterUnread ? "secondary" : "ghost"}
              onClick={() => setFilterUnread(!filterUnread)}
              className="h-6"
            >
              {t("notif.unread")}
            </Button>
            <Button size="xs" variant="ghost" onClick={markAllRead} className="h-6" disabled={unreadCount === 0}>
              <CheckCheck className="size-3" />
              {t("notif.all")}
            </Button>
          </div>
        </div>
        <DropdownMenuSeparator />
        <ScrollArea className="h-[320px]">
          {displayed.length > 0 ? (
            <div className="flex flex-col">
              {displayed.map((n) => {
                const Icon = NOTIF_ICONS[n.type]
                const colorClass = NOTIF_COLORS[n.type]
                return (
                  <div
                    key={n.id}
                    className={`group flex items-start gap-2 border-b p-2.5 transition-colors hover:bg-muted/50 ${!n.read ? "bg-accent/30" : ""}`}
                  >
                    <Icon className={`mt-0.5 size-4 shrink-0 ${colorClass}`} />
                    <div
                      className="flex min-w-0 flex-1 cursor-pointer flex-col"
                      onClick={() => {
                        markRead(n.id)
                        handleNotifClick(n.type, n.entityId)
                      }}
                    >
                      <span className="text-xs font-medium">{t(NOTIF_TITLE_KEYS[n.type])}</span>
                      <span className="text-xs text-muted-foreground">{n.message}</span>
                      <span className="mt-0.5 text-[10px] text-muted-foreground">{formatDateTime(n.date)}</span>
                    </div>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="opacity-0 group-hover:opacity-100"
                      onClick={() => dismiss(n.id)}
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              {t("notif.none")}
            </div>
          )}
        </ScrollArea>
        <DropdownMenuSeparator />
        <div className="flex items-center justify-center p-2">
          <Button size="sm" variant="ghost" className="w-full" onClick={() => setFilterUnread(false)}>
            {t("notif.viewAll")}
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
