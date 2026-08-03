import { Languages, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { useI18n } from "@/lib/i18n"
import { LANGUAGE_META, type Language } from "@/lib/i18n/translations"

export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm">
          <Languages className="size-4" />
          <span className="sr-only">{LANGUAGE_META[lang].nativeLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-xs">{t("language.label")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(Object.keys(LANGUAGE_META) as Language[]).map((code) => (
          <DropdownMenuItem
            key={code}
            onClick={() => setLang(code)}
            className="gap-2 text-xs"
          >
            <span className="flex-1">{LANGUAGE_META[code].nativeLabel}</span>
            {lang === code && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
