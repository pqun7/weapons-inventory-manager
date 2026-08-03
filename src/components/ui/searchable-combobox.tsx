import { useState, useMemo, useRef, useEffect } from "react"
import { Check, ChevronsUpDown, Plus, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"

interface SearchableComboboxProps {
  value: string
  onValueChange: (value: string) => void
  options: string[]
  placeholder?: string
  searchPlaceholder?: string
  onCreateNew?: (value: string) => void
  allowCreate?: boolean
  className?: string
  invalid?: boolean
}

export function SearchableCombobox({
  value,
  onValueChange,
  options,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  onCreateNew,
  allowCreate = false,
  className,
  invalid,
}: SearchableComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const filtered = useMemo(() => {
    if (!search) return options
    const q = search.toLowerCase()
    return options.filter((o) => o.toLowerCase().includes(q))
  }, [options, search])

  const showCreate = allowCreate && search.trim() && !options.some((o) => o.toLowerCase() === search.trim().toLowerCase())

  const handleCreate = () => {
    const trimmed = search.trim()
    if (!trimmed) return
    onCreateNew?.(trimmed)
    onValueChange(trimmed)
    setSearch("")
    setOpen(false)
  }

  const handleSelect = (selected: string) => {
    onValueChange(selected === value ? "" : selected)
    setSearch("")
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("h-8 w-full justify-between text-xs font-normal", !value && "text-muted-foreground", invalid && "border-destructive", className)}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown className="ml-1 size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-2">
            <Search className="mr-1 size-3.5 shrink-0 text-muted-foreground" />
            <CommandInput
              ref={inputRef}
              placeholder={searchPlaceholder}
              value={search}
              onValueChange={setSearch}
              className="h-7 text-xs"
            />
          </div>
          <CommandList>
            <CommandEmpty>{showCreate ? "Type to create new..." : "No results found."}</CommandEmpty>
            {filtered.length > 0 && (
              <CommandGroup>
                {filtered.map((option) => (
                  <CommandItem key={option} value={option} onSelect={() => handleSelect(option)} className="text-xs">
                    <Check className={cn("mr-1 size-3.5", value === option ? "opacity-100" : "opacity-0")} />
                    {option}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {showCreate && (
              <CommandGroup>
                <CommandItem onSelect={handleCreate} className="text-xs">
                  <Plus className="mr-1 size-3.5 text-primary" />
                  <span>Create <span className="font-medium">"{search.trim()}"</span></span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
