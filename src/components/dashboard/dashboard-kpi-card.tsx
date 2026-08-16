import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { AlertTriangle, ArrowRight, Info, TrendingDown, TrendingUp } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface DashboardKpiCardProps {
  label: string
  value: string
  comparison: string
  tooltip: ReactNode
  icon: LucideIcon
  trend: number | null
  attention?: boolean
  positiveIsGood?: boolean
  onClick?: () => void
  openLabel?: string
}

export function DashboardKpiCard({
  label, value, comparison, tooltip, icon: Icon, trend, attention, positiveIsGood = true, onClick, openLabel,
}: DashboardKpiCardProps) {
  const TrendIcon = trend != null && trend < 0 ? TrendingDown : TrendingUp
  return (
    <Card className={cn("h-full gap-0 overflow-hidden py-0 transition-colors", attention && "border-status-reserved/50")}>
      <CardContent className="h-full p-0">
        <div className="flex h-full w-full flex-col p-4 text-start">
          <div className="flex items-start justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span>{label}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={label}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <Info className="size-3.5" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent sideOffset={8} className="max-w-80 p-3 text-start leading-relaxed">{tooltip}</TooltipContent>
              </Tooltip>
            </span>
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground", attention && "text-status-reserved-fg")}>
              {attention ? <AlertTriangle className="size-4" /> : <Icon className="size-4" />}
            </span>
          </div>
          <div className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
          <div className="mt-1.5 flex min-h-4 items-center gap-1.5 text-[11px] text-muted-foreground">
            {trend != null && trend !== 0 && <TrendIcon aria-hidden="true" className={cn("size-3.5 shrink-0", (trend > 0) === positiveIsGood ? "text-status-returned-fg" : "text-status-sold-fg")} />}
            <span className="line-clamp-2">{comparison}</span>
          </div>
          {onClick && openLabel && (
            <button type="button" onClick={onClick} className="mt-2 flex w-fit items-center gap-1 rounded-sm text-[11px] font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              {openLabel}<ArrowRight className="size-3 rtl:rotate-180" aria-hidden="true" />
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
