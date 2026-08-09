import { useRef, useState } from "react"
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog"
import {
  exportExcelChecklist, analyzeExcelImport, DEFAULT_SHEET_OPTIONS,
  type ExcelSheetOption, type ImportConflictReport,
} from "@/lib/excel"
import { useI18n } from "@/lib/i18n"
import { toast } from "sonner"

export function ExcelToolbar() {
  const { t } = useI18n()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [sheets, setSheets] = useState<ExcelSheetOption[]>(DEFAULT_SHEET_OPTIONS)
  const [importPreview, setImportPreview] = useState<ImportConflictReport | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const handleExport = () => {
    const enabledSheets = sheets.filter((s) => s.enabled)
    if (enabledSheets.length === 0) {
      toast.error(t("excel.selectOneSheet"))
      return
    }
    exportExcelChecklist(enabledSheets)
    toast.success(t("toast.exportSuccess"))
    setExportOpen(false)
  }

  const toggleSheet = (key: string) => {
    setSheets((prev) => prev.map((s) => s.key === key ? { ...s, enabled: !s.enabled } : s))
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const report = await analyzeExcelImport(file)
      setImportPreview(report)
      setImportOpen(true)
    } catch {
      toast.error(t("toast.importError"))
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  return (
    <div className="flex items-center gap-1.5">
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileSelect} className="hidden" />

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="h-8"><Download className="size-3.5" /> {t("excel.export")}</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-sm flex items-center gap-2"><FileSpreadsheet className="size-4" /> {t("excel.exportData")}</DialogTitle></DialogHeader>
          <DialogDescription className="text-xs">{t("excel.selectSheets")}</DialogDescription>
          <div className="grid gap-2">
            {sheets.map((s) => (
              <div key={s.key} className="flex items-center gap-2 rounded-md border p-2">
                <Checkbox checked={s.enabled} onCheckedChange={() => toggleSheet(s.key)} />
                <Label className="text-xs flex-1 cursor-pointer" onClick={() => toggleSheet(s.key)}>{s.label}</Label>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setExportOpen(false)}>{t("common.cancel")}</Button>
            <Button size="sm" onClick={handleExport}><Download className="size-3.5" /> {t("excel.export")} {sheets.filter((s) => s.enabled).length}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Button size="sm" variant="outline" className="h-8" onClick={() => fileInputRef.current?.click()}>
        <Upload className="size-3.5" /> {t("excel.import")}
      </Button>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-sm">{t("excel.importData")}</DialogTitle></DialogHeader>
          {importPreview && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border p-2">
                  <span className="text-[10px] text-muted-foreground">{t("excel.totalRows")}</span>
                  <div className="text-lg font-bold">{importPreview.totalRows}</div>
                </div>
                <div className="rounded-md border p-2">
                  <span className="text-[10px] text-muted-foreground">{t("excel.newWeapons")}</span>
                  <div className="text-lg font-bold text-status-returned">{importPreview.newWeapons}</div>
                </div>
                <div className="rounded-md border p-2">
                  <span className="text-[10px] text-muted-foreground">{t("excel.newInvoices")}</span>
                  <div className="text-lg font-bold text-status-returned">{importPreview.newInvoices}</div>
                </div>
                <div className="rounded-md border p-2">
                  <span className="text-[10px] text-muted-foreground">{t("excel.duplicates")}</span>
                  <div className="text-lg font-bold text-status-sold">{importPreview.duplicateSerials.length + importPreview.duplicateInvoices.length}</div>
                </div>
              </div>

              {importPreview.conflicts.length > 0 ? (
                <div className="flex items-start gap-2 rounded-md border border-status-reserved/30 bg-status-reserved/10 p-2">
                  <AlertTriangle className="size-4 shrink-0 text-status-reserved" />
                  <div className="flex flex-col">
                    <span className="text-xs font-medium">{t("excel.conflicts")}</span>
                    {importPreview.conflicts.map((c, i) => <span key={i} className="text-[10px] text-muted-foreground">{c}</span>)}
                    {importPreview.duplicateSerials.length > 0 && (
                      <span className="text-[10px] text-muted-foreground mt-1">
                        {t("excel.duplicateSerials")}: {importPreview.duplicateSerials.slice(0, 3).join(", ")}{importPreview.duplicateSerials.length > 3 ? "..." : ""}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-md border border-status-returned/30 bg-status-returned/10 p-2">
                  <CheckCircle2 className="size-4 shrink-0 text-status-returned" />
                  <span className="text-xs font-medium">{t("excel.noConflicts")}</span>
                </div>
              )}

              <div className="text-[10px] text-muted-foreground">
                {t("excel.validationNote")}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setImportOpen(false)}>{t("common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
