import { useCurrency } from "@/lib/currency-context";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Coins, Check } from "lucide-react";

export function DisplayCurrencySelector() {
  const { displayCurrency, setDisplayCurrency, currencies, isLoaded } = useCurrency();
  const { t } = useI18n();

  // 🟢 تصفية العملات النشطة فقط
  const activeCurrencies = currencies.filter((c) => c.isActive);

  // إذا لم تُحمَّل البيانات بعد، أو لا توجد عملات نشطة → إخفاء المُكوّن
  if (!isLoaded || activeCurrencies.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 font-mono">
          <Coins className="h-4 w-4" />
          {displayCurrency}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t("settings.displayCurrency")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {activeCurrencies.map((c) => (
          <DropdownMenuItem
            key={c.isoCode}
            onClick={() => setDisplayCurrency(c.isoCode)}
            className={displayCurrency === c.isoCode ? "bg-accent" : ""}
          >
            <span className="font-mono text-sm w-12">{c.isoCode}</span>
            <span className="text-muted-foreground text-sm flex-1">{c.name}</span>
            <span className="text-xs text-muted-foreground mr-2">{c.symbol}</span>
            {displayCurrency === c.isoCode && <Check className="size-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}