import { useMemo, useState } from "react"
import { CalendarDays, ChevronDown } from "lucide-react"
import { arSA } from "date-fns/locale/ar-SA"
import { enUS } from "date-fns/locale/en-US"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export interface DatePickerProps {
  value?: string | null
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  required?: boolean
  min?: string
  max?: string
  id?: string
  name?: string
  "aria-label"?: string
  "aria-invalid"?: boolean
}

function parseIsoDate(value?: string | null): Date | undefined {
  if (!value) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day)
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : undefined
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function DatePicker({
  value,
  onChange,
  placeholder,
  className,
  disabled,
  required,
  min,
  max,
  id,
  name,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
}: DatePickerProps) {
  const { lang, locale, dir } = useI18n()
  const [open, setOpen] = useState(false)
  const selected = useMemo(() => parseIsoDate(value), [value])
  const minDate = useMemo(() => parseIsoDate(min), [min])
  const maxDate = useMemo(() => parseIsoDate(max), [max])
  const displayLocale = locale === "ar-SA" ? "ar-SA-u-ca-gregory" : locale
  const label = selected
    ? new Intl.DateTimeFormat(displayLocale, { year: "numeric", month: "short", day: "numeric" }).format(selected)
    : placeholder ?? (lang === "ar" ? "اختر التاريخ" : "Select date")
  const disabledDays = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          name={name}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={ariaLabel ?? label}
          aria-invalid={ariaInvalid}
          aria-required={required}
          data-empty={!selected}
          className={cn(
            "w-full justify-between px-3 font-normal data-[empty=true]:text-muted-foreground",
            ariaInvalid && "border-destructive focus-visible:ring-destructive/30",
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" dir={dir}>
        <Calendar
          key={value || "empty"}
          mode="single"
          selected={selected}
          defaultMonth={selected ?? minDate ?? new Date()}
          onSelect={(date) => {
            if (!date) return
            onChange(toIsoDate(date))
            setOpen(false)
          }}
          disabled={disabledDays}
          locale={lang === "ar" ? arSA : enUS}
          captionLayout="dropdown"
          startMonth={minDate ?? new Date(1900, 0, 1)}
          endMonth={maxDate ?? new Date(2100, 11, 31)}
        />
        <div className="flex items-center justify-between border-t p-2">
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" disabled={!value || required} onClick={() => { onChange(""); setOpen(false) }}>
            {lang === "ar" ? "مسح" : "Clear"}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { const today = new Date(); today.setHours(0, 0, 0, 0); if ((!minDate || today >= minDate) && (!maxDate || today <= maxDate)) onChange(toIsoDate(today)); setOpen(false) }}>
            {lang === "ar" ? "اليوم" : "Today"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
