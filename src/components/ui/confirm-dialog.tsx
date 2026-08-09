import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AlertTriangle, Info, Trash2 } from "lucide-react"
import { useI18n } from "@/lib/i18n"

type ConfirmVariant = "default" | "destructive" | "warning"

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  impactSummary?: string[]
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmVariant
  onConfirm: () => void
}

const variantConfig: Record<ConfirmVariant, { icon: typeof Info; iconClass: string; buttonClass: string }> = {
  default: { icon: Info, iconClass: "text-primary", buttonClass: "" },
  destructive: { icon: Trash2, iconClass: "text-destructive", buttonClass: "bg-destructive text-destructive-foreground hover:bg-destructive/90" },
  warning: { icon: AlertTriangle, iconClass: "text-status-reserved", buttonClass: "bg-status-reserved text-status-reserved-fg hover:bg-status-reserved/90" },
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  impactSummary,
  confirmLabel,
  cancelLabel,
  variant = "default",
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useI18n()
  const cfg = variantConfig[variant]
  const Icon = cfg.icon

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-sm">
            <Icon className={cn("size-4", cfg.iconClass)} />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-xs">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {impactSummary && impactSummary.length > 0 && (
          <div className="rounded-md border bg-muted/50 p-2.5">
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">{t("common.impactSummary")}:</p>
            <ul className="flex flex-col gap-0.5">
              {impactSummary.map((item, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px]">
                  <span className="mt-0.5 size-1 shrink-0 rounded-full bg-muted-foreground" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel className="h-8 text-xs">{cancelLabel ?? t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className={cn("h-8 text-xs", cfg.buttonClass)}
            onClick={(e) => { e.preventDefault(); onConfirm() }}
          >
            {confirmLabel ?? t("common.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
