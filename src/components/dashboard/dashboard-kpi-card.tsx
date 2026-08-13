import type { LucideIcon } from "lucide-react"
import { AlertTriangle, Info, TrendingDown, TrendingUp } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface DashboardKpiCardProps {
  label: string
  value: string
  comparison: string
  tooltip: string
  icon: LucideIcon
  trend: number | null
  attention?: boolean
  positiveIsGood?: boolean
  onClick: () => void
  openLabel: string
}

export function DashboardKpiCard({
  label, value, comparison, tooltip, icon: Icon, trend, attention, positiveIsGood = true, onClick, openLabel,
}: DashboardKpiCardProps) {
  const TrendIcon = trend != null && trend < 0 ? TrendingDown : TrendingUp
  return (
    <Card className={cn("gap-0 py-0 transition-colors focus-within:ring-2 focus-within:ring-ring/50", attention && "border-status-reserved/50")}>
      <CardContent className="p-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={onClick} aria-label={`${openLabel}: ${label}`} className="w-full rounded-xl p-4 text-start outline-none hover:bg-muted/35 focus-visible:bg-muted/35">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{label}<Info className="size-3.5" aria-hidden="true" /></span>
                <span className={cn("flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground", attention && "text-status-reserved-fg")}>
                  {attention ? <AlertTriangle className="size-4" /> : <Icon className="size-4" />}
                </span>
              </div>
              <div className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
              <div className="mt-1.5 flex min-h-4 items-center gap-1.5 text-[11px] text-muted-foreground">
                {trend != null && trend !== 0 && <TrendIcon aria-hidden="true" className={cn("size-3.5", (trend > 0) === positiveIsGood ? "text-status-returned-fg" : "text-status-sold-fg")} />}
                <span>{comparison}</span>
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{tooltip}</TooltipContent>
        </Tooltip>
      </CardContent>
    </Card>
  )
}
