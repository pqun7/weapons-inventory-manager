import { useState } from "react"
import { Bookmark, X, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useStore } from "@/lib/store"
import type { SavedFilter } from "@/lib/types"
import { useI18n } from "@/lib/i18n"

interface SavedFiltersBarProps {
  entityType: string
  currentFilterState: Record<string, unknown>
  onLoadFilter: (filter: SavedFilter) => void
}

export function SavedFiltersBar({ entityType, currentFilterState, onLoadFilter }: SavedFiltersBarProps) {
  const { t } = useI18n()
  const savedFilters = useStore((s) => s.savedFilters)
  const saveFilter = useStore((s) => s.saveFilter)
  const deleteFilter = useStore((s) => s.deleteFilter)
  const [saveOpen, setSaveOpen] = useState(false)
  const [filterName, setFilterName] = useState("")

  const entityFilters = savedFilters.filter((f) => f.entityType === entityType)

  const handleSave = async () => {
    if (!filterName.trim()) return
    await saveFilter(filterName.trim(), entityType, currentFilterState)
    setFilterName("")
    setSaveOpen(false)
  }

  return (
    <div className="flex items-center gap-1">
      <Popover open={saveOpen} onOpenChange={setSaveOpen}>
        <PopoverTrigger asChild>
          <Button size="xs" variant="ghost" className="h-5 text-[10px]">
            <Save className="size-3" /> {t("common.saveFilter")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-2" align="start">
          <Input
            placeholder={t("common.filterName")}
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className="h-7 text-xs"
            autoFocus
          />
          <Button size="xs" className="mt-1.5 w-full" onClick={handleSave}>{t("common.save")}</Button>
        </PopoverContent>
      </Popover>

      {entityFilters.map((filter) => (
        <div key={filter.id} className="group flex items-center gap-0.5 rounded-full border bg-muted/50 px-2 py-0.5">
          <button
            onClick={() => onLoadFilter(filter)}
            className="flex items-center gap-1 text-[10px] font-medium transition-colors hover:text-primary"
          >
            <Bookmark className="size-2.5" />
            {filter.name}
          </button>
          <button
            onClick={async () => await deleteFilter(filter.id)}
            className="opacity-0 transition-opacity group-hover:opacity-100"
          >
            <X className="size-2.5 text-muted-foreground hover:text-destructive" />
          </button>
        </div>
      ))}
    </div>
  )
}
