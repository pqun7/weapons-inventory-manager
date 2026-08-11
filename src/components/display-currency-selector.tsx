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
  const { displayCurrency, setDisplayCurrency, currencies, isLoaded, currencyPresentation } = useCurrency();
  const { t } = useI18n();

  const activeCurrencies = currencies.filter((c) => c.isActive);

  if (!isLoaded || activeCurrencies.length === 0) return null;
  const selected = currencyPresentation(displayCurrency)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-9 gap-2 px-2" title={`${selected.name} (${selected.code})`}>
          <Coins className="h-4 w-4" />
          <span className="flex min-w-0 flex-col items-start leading-none">
            <span className="text-xs font-semibold">{selected.symbol}</span>
            <span className="mt-0.5 max-w-24 truncate text-[9px] text-muted-foreground">{selected.name}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t("settings.displayCurrency")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {activeCurrencies.map((c) => {
          const presentation = currencyPresentation(c.isoCode)
          return (
            <DropdownMenuItem
              key={c.isoCode}
              onClick={() => setDisplayCurrency(c.isoCode)}
              className={displayCurrency === c.isoCode ? "bg-accent" : ""}
            >
              <span className="w-12 font-mono text-xs">{presentation.code}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs font-medium">{presentation.symbol}</span>
                <span className="truncate text-[10px] text-muted-foreground">{presentation.name}</span>
              </span>
              {displayCurrency === c.isoCode && <Check className="size-3.5 text-primary" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
