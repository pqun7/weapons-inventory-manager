import { useState, useMemo, useEffect } from "react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import { useStore } from "@/lib/store"

interface SmartCurrencyInputProps {
  value: string | number
  onValueChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function SmartCurrencyInput({
  value,
  onValueChange,
  placeholder = "0.00",
  className,
  disabled,
}: SmartCurrencyInputProps) {
  const settings = useStore((s) => s.settings)
  const trackCurrencyUsage = useStore((s) => s.trackCurrencyUsage)
  const [open, setOpen] = useState(false)
  const [selectedCode, setSelectedCode] = useState(settings.currencyCode)

  const symbol = useMemo(() => {
    const map: Record<string, string> = { USD: "$", SAR: "ر.س", EUR: "€", GBP: "£", JPY: "¥" }
    return map[selectedCode] ?? selectedCode
  }, [selectedCode])

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
        <PopoverContent className="w-32 p-0" align="start">
          <Command>
            <CommandList>
              <CommandEmpty>No currency found.</CommandEmpty>
              <CommandGroup>
                {settings.supportedCurrencies.map((code) => (
                  <CommandItem
                    key={code}
                    value={code}
                    onSelect={(v) => { setSelectedCode(v); setOpen(false) }}
                    className="text-xs"
                  >
                    {code}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <div className="relative flex-1">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{symbol}</span>
        <Input
          type="number"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="h-8 pl-6 text-xs tabular-nums"
        />
      </div>
    </div>
  )
}
