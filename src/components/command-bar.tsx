import { useEffect, useMemo, useState } from "react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { Package, Users, Receipt, Truck, Search, Pin } from "lucide-react"
import { useNav } from "@/lib/nav"
import { useStore } from "@/lib/store"
import { useI18n } from "@/lib/i18n"
import { useDebounce } from "@/hooks"

export function CommandBar() {
  const { commandBarOpen, setCommandBarOpen, navigate, setSelectedWeaponId } = useNav()
  const { t } = useI18n()
  const weapons = useStore((s) => s.weapons)
  const customers = useStore((s) => s.customers)
  const suppliers = useStore((s) => s.suppliers)
  const invoices = useStore((s) => s.invoices)
  const shipments = useStore((s) => s.shipments)
  const payments = useStore((s) => s.payments)
  const searchHistory = useStore((s) => s.searchHistory)
  const pinnedItems = useStore((s) => s.pinnedSearchItems)
  const addSearchHistory = useStore((s) => s.addSearchHistory)
  const togglePin = useStore((s) => s.togglePinSearch)

  const [query, setQuery] = useState("")
  const debouncedQuery = useDebounce(query, 150)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setCommandBarOpen(!commandBarOpen)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [commandBarOpen, setCommandBarOpen])

  useEffect(() => {
    if (!commandBarOpen) setQuery("")
  }, [commandBarOpen])

  const results = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    if (!q) return { weapons: [], customers: [], suppliers: [], invoices: [], shipments: [], payments: [] }

    return {
      weapons: weapons.filter((w) =>
        w.serialNumber.toLowerCase().includes(q) ||
        w.brand.toLowerCase().includes(q) ||
        w.model.toLowerCase().includes(q)
      ).slice(0, 5),
      customers: customers.filter((c) =>
        c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)
      ).slice(0, 5),
      suppliers: suppliers.filter((s) =>
        s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
      ).slice(0, 5),
      invoices: invoices.filter((i) =>
        i.invoiceNumber.toLowerCase().includes(q) || i.customerName.toLowerCase().includes(q)
      ).slice(0, 5),
      shipments: shipments.filter((s) =>
        s.shipmentNumber.toLowerCase().includes(q)
      ).slice(0, 3),
      payments: payments.filter((p) =>
        p.invoiceNumber.toLowerCase().includes(q)
      ).slice(0, 3),
    }
  }, [debouncedQuery, weapons, customers, suppliers, invoices, shipments, payments])

  const hasResults = Object.values(results).some((r) => r.length > 0)

  const handleSelect = (action: () => void) => {
    if (debouncedQuery.trim()) addSearchHistory(debouncedQuery.trim())
    action()
    setCommandBarOpen(false)
  }

  return (
    <CommandDialog
      open={commandBarOpen}
      onOpenChange={setCommandBarOpen}
      title="Command Bar"
      description={t("cmd.search")}
    >
      <CommandInput
        placeholder={t("cmd.placeholder")}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>{t("cmd.noResults")}</CommandEmpty>

        {!debouncedQuery && pinnedItems.length > 0 && (
          <>
            <CommandGroup heading="Pinned">
              {pinnedItems.map((item) => (
                <CommandItem key={item} onSelect={() => { setQuery(item); }}>
                  <Pin className="size-4 text-primary" />
                  <span>{item}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {!debouncedQuery && searchHistory.length > 0 && (
          <>
            <CommandGroup heading="Recent Searches">
              {searchHistory.map((q) => (
                <CommandItem key={q} onSelect={() => { setQuery(q); }}>
                  <Search className="size-4 text-muted-foreground" />
                  <span>{q}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {results.weapons.length > 0 && (
          <CommandGroup heading="Weapons">
            {results.weapons.map((w) => (
              <CommandItem
                key={w.id}
                onSelect={() => handleSelect(() => {
                  setSelectedWeaponId(w.id)
                  navigate("inventory")
                })}
              >
                <Package className="size-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{w.brand} {w.model}</span>
                  <span className="text-xs text-muted-foreground">SN: {w.serialNumber} — {t(`status.${w.status}`)}</span>
                </div>
                {debouncedQuery && (
                  <CommandShortcut onSelect={() => togglePin(w.serialNumber)}>
                    <Pin className="size-3" />
                  </CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {results.customers.length > 0 && (
          <CommandGroup heading="Customers">
            {results.customers.map((c) => (
              <CommandItem key={c.id} onSelect={() => handleSelect(() => navigate("customers"))}>
                <Users className="size-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.id}{c.isWholesaleBuyer ? " — Wholesale" : ""}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {results.suppliers.length > 0 && (
          <CommandGroup heading="Suppliers">
            {results.suppliers.map((s) => (
              <CommandItem key={s.id} onSelect={() => handleSelect(() => navigate("suppliers"))}>
                <Users className="size-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{s.name}</span>
                  <span className="text-xs text-muted-foreground">{s.id}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {results.invoices.length > 0 && (
          <CommandGroup heading="Invoices">
            {results.invoices.map((i) => (
              <CommandItem key={i.id} onSelect={() => handleSelect(() => navigate("financials"))}>
                <Receipt className="size-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{i.invoiceNumber}</span>
                  <span className="text-xs text-muted-foreground">{i.customerName} — ${i.balance} bal.</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {results.shipments.length > 0 && (
          <CommandGroup heading="Shipments">
            {results.shipments.map((s) => (
              <CommandItem key={s.id} onSelect={() => handleSelect(() => navigate("shipments"))}>
                <Truck className="size-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{s.shipmentNumber}</span>
                  <span className="text-xs text-muted-foreground">{t(`status.${s.status}`)} — {s.totalExpectedItems} items</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {debouncedQuery && !hasResults && (
          <CommandGroup heading={t("cmd.navigation")}>
            <CommandItem onSelect={() => handleSelect(() => navigate("dashboard"))}>{t("nav.dashboard")}</CommandItem>
            <CommandItem onSelect={() => handleSelect(() => navigate("inventory"))}>{t("nav.inventory")}</CommandItem>
            <CommandItem onSelect={() => handleSelect(() => navigate("sales"))}>{t("nav.sales")}</CommandItem>
            <CommandItem onSelect={() => handleSelect(() => navigate("financials"))}>{t("nav.financials")}</CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
