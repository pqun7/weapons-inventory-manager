import { AlertCircle, ArrowRight, CircleAlert, Lightbulb, type LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { DashboardInsightPriority } from "@/lib/dashboard/types"

export interface DashboardInsightView {
  id: string
  priority: DashboardInsightPriority
  priorityLabel: string
  title: string
  description: string
  action?: string
  onOpen?: () => void
}

const priorityStyle: Record<DashboardInsightPriority, { icon: LucideIcon; className: string }> = {
  high: { icon: AlertCircle, className: "border-status-sold/30 bg-status-sold/5 text-status-sold-fg" },
  attention: { icon: CircleAlert, className: "border-status-reserved/30 bg-status-reserved/5 text-status-reserved-fg" },
  opportunity: { icon: Lightbulb, className: "border-status-returned/30 bg-status-returned/5 text-status-returned-fg" },
  info: { icon: CircleAlert, className: "border-border bg-muted/30 text-muted-foreground" },
}

export function DashboardInsightsPanel({
  title, description, empty, insights,
}: { title: string; description: string; empty: string; insights: DashboardInsightView[] }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {insights.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{empty}</p> : insights.map((insight) => {
          const style = priorityStyle[insight.priority]
          const Icon = style.icon
          return (
            <article key={insight.id} className="rounded-lg border p-3">
              <div className="flex items-start gap-3">
                <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border", style.className)}>
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium">{insight.title}</h3>
                    <Badge variant="outline" className={cn("h-5 text-[10px]", style.className)}>{insight.priorityLabel}</Badge>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{insight.description}</p>
                  {insight.action && insight.onOpen && (
                    <Button variant="link" size="sm" className="mt-1 h-auto p-0 text-xs" onClick={insight.onOpen}>
                      {insight.action}<ArrowRight className="size-3 rtl:rotate-180" />
                    </Button>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </CardContent>
    </Card>
  )
}
