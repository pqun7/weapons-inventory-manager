import { useState, useMemo, useCallback, useRef } from "react"
import { Search, CheckCircle2, AlertTriangle, Copy, Trash2 } from "lucide-react"
import { DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useStore } from "@/lib/store"
import { useI18n } from "@/lib/i18n"
import { parseSerialInput, deduplicateSerials, getSerialStats, type ParsedSerial } from "@/lib/serial-parser"

interface BulkSerialParserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  expectedQuantity: number
  onConfirm: (serials: string[]) => void
  title?: string
}

export function BulkSerialParserDialog({
  open: _open,
  onOpenChange,
  expectedQuantity,
  onConfirm,
}: BulkSerialParserDialogProps) {
  const { t } = useI18n()
  const weapons = useStore((s) => s.weapons)
  const [rawInput, setRawInput] = useState("")
  const [search, setSearch] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedInput, setDebouncedInput] = useState("")

  const existingSerials = useMemo(() => {
    return new Set(weapons.map((w) => w.serialNumber.toLowerCase()))
  }, [weapons])

  const handleInputChange = useCallback((value: string) => {
    setRawInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedInput(value), 200)
  }, [])

  const parsed = useMemo((): ParsedSerial[] => {
    const lines = parseSerialInput(debouncedInput)
    return deduplicateSerials(lines, existingSerials)
  }, [debouncedInput, existingSerials])

  const stats = useMemo(() => getSerialStats(parsed), [parsed])

  const filteredParsed = useMemo(() => {
    if (!search.trim()) return parsed
    const q = search.toLowerCase()
    return parsed.filter((p) => p.serial.toLowerCase().includes(q))
  }, [parsed, search])

  const quantityMatches = stats.uniqueCount === expectedQuantity
  const canConfirm = quantityMatches && stats.uniqueCount > 0

  const handleConfirm = () => {
    const validSerials = parsed.filter((p) => p.status === "valid").map((p) => p.serial)
    const seen = new Set<string>()
    const unique: string[] = []
    for (const s of validSerials) {
      const lower = s.toLowerCase()
      if (!seen.has(lower)) {
        seen.add(lower)
        unique.push(s)
      }
    }
    onConfirm(unique)
    setRawInput("")
    setDebouncedInput("")
    onOpenChange(false)
  }

  const handleClear = () => {
    setRawInput("")
    setDebouncedInput("")
    setSearch("")
  }

  return (
    <DialogContent className="max-w-3xl max-h-[85vh]">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-sm">
          <Copy className="size-4" />
          {t("ship.bulkSerialEntry")}
        </DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-4 gap-2">
          <div className="rounded-md border p-2 text-center">
            <div className="text-[10px] text-muted-foreground">{t("ship.serialParsed")}</div>
            <div className="text-lg font-bold tabular-nums">{parsed.length}</div>
          </div>
          <div className="rounded-md border border-status-returned/30 bg-status-returned/10 p-2 text-center">
            <div className="text-[10px] text-muted-foreground">{t("ship.serialValid")}</div>
            <div className="text-lg font-bold tabular-nums text-status-returned-fg">{stats.uniqueCount}</div>
          </div>
          <div className="rounded-md border border-status-sold/30 bg-status-sold/10 p-2 text-center">
            <div className="text-[10px] text-muted-foreground">{t("ship.serialDBDup")}</div>
            <div className="text-lg font-bold tabular-nums text-status-sold-fg">{stats.dbDup}</div>
          </div>
          <div className="rounded-md border border-status-reserved/30 bg-status-reserved/10 p-2 text-center">
            <div className="text-[10px] text-muted-foreground">{t("ship.serialLocalDup")}</div>
            <div className="text-lg font-bold tabular-nums text-status-reserved-fg">{stats.localDup}</div>
          </div>
        </div>

        <div className={`flex items-center gap-2 rounded-md p-2 text-xs ${quantityMatches ? "bg-status-returned/10 text-status-returned-fg" : "bg-muted text-muted-foreground"}`}>
          {quantityMatches ? (
            <CheckCircle2 className="size-3.5" />
          ) : (
            <AlertTriangle className="size-3.5" />
          )}
          <span>
            {t("ship.serialQuantityMatch")}: {stats.uniqueCount} / {expectedQuantity}
            {!quantityMatches && stats.uniqueCount > 0 && (
              <span className="ms-2 font-medium text-status-sold-fg">
                ({Math.abs(stats.uniqueCount - expectedQuantity)} {stats.uniqueCount > expectedQuantity ? t("ship.serialExcess") : t("ship.serialShort")})
              </span>
            )}
          </span>
        </div>

        <div>
          <Textarea
            value={rawInput}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder={t("ship.serialPastePlaceholder")}
            className="min-h-[120px] font-mono text-xs"
          />
        </div>

        {parsed.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t("common.search")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 ps-8 text-xs"
                />
              </div>
              <Button size="sm" variant="outline" className="h-8" onClick={handleClear}>
                <Trash2 className="size-3.5" /> {t("common.reset")}
              </Button>
            </div>

            <ScrollArea className="h-[200px] rounded-md border">
              <div className="flex flex-wrap gap-1.5 p-2">
                {filteredParsed.map((p, idx) => (
                  <Badge
                    key={idx}
                    variant="outline"
                    className={`font-mono text-[10px] ${
                      p.status === "valid"
                        ? "bg-status-returned/10 text-status-returned-fg border-status-returned/30"
                        : p.status === "dbDuplicate"
                        ? "bg-status-sold/10 text-status-sold-fg border-status-sold/30"
                        : "bg-status-reserved/10 text-status-reserved-fg border-status-reserved/30"
                    }`}
                  >
                    {p.serial}
                  </Badge>
                ))}
                {filteredParsed.length === 0 && (
                  <span className="text-xs text-muted-foreground p-2">{t("common.noData")}</span>
                )}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" disabled={!canConfirm} onClick={handleConfirm}>
          <CheckCircle2 className="size-3.5" /> {t("common.confirm")} ({stats.uniqueCount})
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
