import { Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTheme } from "@/components/theme-provider"
import { useI18n } from "@/lib/i18n"

export function ModeToggle() {
  const { setTheme } = useTheme()
  const { t } = useI18n()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-sm">
          <Sun className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
          <span className="sr-only">{t("theme.toggle")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>{t("theme.light")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>{t("theme.dark")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>{t("theme.system")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
