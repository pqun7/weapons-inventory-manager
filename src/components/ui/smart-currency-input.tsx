import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import { useStore } from "@/lib/store"
import { useCurrency } from "@/lib/currency-context"
import { useI18n } from "@/lib/i18n"

interface SmartCurrencyInputProps {
  value: string | number
  onValueChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  currency?: string
  onCurrencyChange?: (currency: string) => void
}

export function SmartCurrencyInput({
  value,
  onValueChange,
  placeholder = "0.00",
  className,
  disabled,
  currency,
  onCurrencyChange,
}: SmartCurrencyInputProps) {
  const trackCurrencyUsage = useStore((state) => state.trackCurrencyUsage)
  const { currencies, transactionCurrency, currencyPresentation } = useCurrency()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [internalCurrency, setInternalCurrency] = useState(currency ?? transactionCurrency)
  const selectedCode = currency ?? internalCurrency

  const presentation = useMemo(() => currencyPresentation(selectedCode), [currencyPresentation, selectedCode])

  useEffect(() => {
    if (currency) setInternalCurrency(currency)
  }, [currency])

  useEffect(() => {
    trackCurrencyUsage(selectedCode)
  }, [selectedCode, trackCurrencyUsage])

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="flex h-8 shrink-0 items-center rounded-md border bg-muted/50 px-2 text-[10px] font-semibold tabular-nums transition-colors hover:bg-muted disabled:opacity-50"
          >
            {selectedCode}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-40 p-0" align="start">
          <Command>
            <CommandList>
              <CommandEmpty>{t("settings.noCurrencies")}</CommandEmpty>
              <CommandGroup>
                {currencies.map((item) => {
                  const itemPresentation = currencyPresentation(item.isoCode)
                  return (
                  <CommandItem
                    key={item.isoCode}
                    value={item.isoCode}
                    onSelect={() => {
                      setInternalCurrency(item.isoCode)
                      onCurrencyChange?.(item.isoCode)
                      setOpen(false)
                    }}
                    className="text-xs"
                  >
                    <span className="w-10 font-mono text-[10px]">{itemPresentation.code}</span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-xs">{itemPresentation.symbol}</span>
                      <span className="truncate text-[9px] text-muted-foreground">{itemPresentation.name}</span>
                    </span>
                  </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <div className="relative flex-1">
        <span className="absolute start-2 top-1/2 max-w-16 -translate-y-1/2 truncate text-[10px] text-muted-foreground">{presentation.compactSymbol}</span>
        <Input
          type="number"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="h-8 ps-16 text-xs tabular-nums"
        />
      </div>
    </div>
  )
}
