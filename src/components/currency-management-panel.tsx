import { useState, useEffect, useCallback } from "react"
import {
  Coins, RefreshCw, Plus, AlertTriangle, History, ToggleLeft, ToggleRight, Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { CurrencyService, type CurrencyInfo, type ExchangeRateOverride, type AuditLogEntry } from "@/lib/currency-service"
import { useStore } from "@/lib/store"
import { useI18n } from "@/lib/i18n"
import { useCurrency } from "@/lib/currency-context"
import { toast } from "sonner"

export function CurrencyManagementPanel() {
  const { t } = useI18n()
  const { accountingCurrency, currencyPresentation } = useCurrency()
  const store = useStore()
  const currentUser = store.getCurrentUser()
  const isAdmin = currentUser?.role === "Admin"
  const [currencies, setCurrencies] = useState<CurrencyInfo[]>([])
  const [overrides, setOverrides] = useState<ExchangeRateOverride[]>([])
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([])
  const [syncing, setSyncing] = useState(false)
  const [editingRate, setEditingRate] = useState<string | null>(null)
  const [manualRateInput, setManualRateInput] = useState("")
  const [manualReason, setManualReason] = useState("")
  const [addCurrencyOpen, setAddCurrencyOpen] = useState(false)
  const [newCode, setNewCode] = useState("")
  const [newName, setNewName] = useState("")
  const [newSymbol, setNewSymbol] = useState("")
  const [newPrecision, setNewPrecision] = useState("2")
  const [newRate, setNewRate] = useState("")

  // ✅ حالة نافذة تأكيد الحذف
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [currencyToDelete, setCurrencyToDelete] = useState<CurrencyInfo | null>(null)
  const [deleting, setDeleting] = useState(false)

  // ✅ استخدام getAllCurrencies() لعرض جميع العملات في لوحة الإدارة
  const refreshData = useCallback(async () => {
    await CurrencyService.load()
    setCurrencies(CurrencyService.getAllCurrencies())
    setOverrides(CurrencyService.getOverrides())
    const log = await CurrencyService.getAuditLog(50)
    setAuditLog(log)
  }, [])

  useEffect(() => {
    refreshData()
    const unsub = CurrencyService.subscribe(() => {
      setCurrencies(CurrencyService.getAllCurrencies())
      setOverrides(CurrencyService.getOverrides())
    })
    return unsub
  }, [refreshData])

  const handleSync = async () => {
    setSyncing(true)
    try {
      const result = await CurrencyService.syncRatesFromAPI(currentUser.name)
      if (result.synced > 0 && result.failed === 0) {
        toast.success(`${result.synced} ${t("settings.currenciesSynced")}`)
      } else {
        toast.error(`${t("settings.syncFailed")} — ${result.errors.join(", ")}`)
      }
      await refreshData()
    } catch (error) {
      toast.error(`${t("settings.syncFailed")} — ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setSyncing(false)
    }
  }

  const handleSetManual = async (code: string) => {
    const rate = Number(manualRateInput)
    if (isNaN(rate) || rate <= 0) {
      toast.error(t("settings.invalidRate"))
      return
    }
    try {
      await CurrencyService.setManualOverride(code, rate, currentUser.name, manualReason || t("settings.manualOverrideReason"), currentUser.role)
      toast.success(`${code} ${t("settings.rateUpdated")}`)
      setEditingRate(null)
      setManualRateInput("")
      setManualReason("")
      await refreshData()
    } catch (err) {
      toast.error(`${t("settings.rateUpdateFailed")}: ${err instanceof Error ? err.message : "Unknown"}`)
    }
  }

  const handleSetAutomatic = async (code: string) => {
    try {
      await CurrencyService.setAutomaticMode(code, currentUser.name, currentUser.role)
      toast.success(`${code} ${t("settings.switchedToAutomatic")}`)
      await refreshData()
    } catch (err) {
      toast.error(`${t("settings.rateUpdateFailed")}: ${err instanceof Error ? err.message : "Unknown"}`)
    }
  }

  const handleAddCurrency = async () => {
    const code = newCode.trim().toUpperCase()
    if (!code || code.length !== 3) {
      toast.error(t("settings.invalidCurrencyCode"))
      return
    }
    if (!newName.trim()) {
      toast.error(t("settings.currencyNameRequired"))
      return
    }
    const rate = Number(newRate)
    if (isNaN(rate) || rate <= 0) {
      toast.error(t("settings.invalidRate"))
      return
    }
    try {
      const precision = Number(newPrecision)
      if (!Number.isInteger(precision) || precision < 0 || precision > 4) {
        toast.error(t("settings.invalidPrecision"))
        return
      }
      await CurrencyService.addCurrency(code, newName.trim(), newSymbol.trim() || code, precision, rate)
      toast.success(`${code} ${t("settings.currencyAdded")}`)
      setAddCurrencyOpen(false)
      setNewCode(""); setNewName(""); setNewSymbol(""); setNewPrecision("2"); setNewRate("")
      await refreshData()
    } catch (err) {
      toast.error(`${t("settings.currencyAddFailed")}: ${err instanceof Error ? err.message : "Unknown"}`)
    }
  }

  const handleToggleActive = async (code: string, isActive: boolean) => {
    try {
      await CurrencyService.toggleCurrencyActive(code, !isActive)
      toast.success(`${code} ${isActive ? t("settings.currencyDeactivated") : t("settings.currencyActivated")}`)
      await refreshData()
    } catch (err) {
      toast.error(`${t("settings.rateUpdateFailed")}: ${err instanceof Error ? err.message : "Unknown"}`)
    }
  }

  // ✅ معالج فتح نافذة تأكيد الحذف
  const handleDeleteRequest = (currency: CurrencyInfo) => {
    if (currency.isoCode === accountingCurrency) {
      toast.error(t("settings.cannotDeleteUSD"))
      return
    }
    setCurrencyToDelete(currency)
    setDeleteDialogOpen(true)
  }

  // ✅ معالج تنفيذ الحذف
  const handleDeleteConfirm = async () => {
    if (!currencyToDelete) return
    setDeleting(true)
    try {
      await CurrencyService.deleteCurrency(currencyToDelete.isoCode)
      toast.success(`${currencyToDelete.isoCode} ${t("settings.currencyDeleted")}`)
      setDeleteDialogOpen(false)
      setCurrencyToDelete(null)
      await refreshData()
    } catch (err) {
      toast.error(`${t("settings.currencyDeleteFailed")}: ${err instanceof Error ? err.message : "Unknown"}`)
    } finally {
      setDeleting(false)
    }
  }

  const getOverride = (code: string) => overrides.find((o) => o.currencyCode === code)

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center border border-destructive/30 rounded-lg bg-destructive/5">
        <AlertTriangle className="size-8 text-destructive" />
        <p className="text-sm font-semibold text-destructive">{t("settings.accessDenied")}</p>
        <p className="text-xs text-muted-foreground max-w-sm">{t("settings.adminOnlyCurrency")}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">

      <Tabs defaultValue="registry">
        <TabsList className="h-8">
          <TabsTrigger value="registry" className="text-xs"><Coins className="size-3" /> {t("settings.currencyRegistry")}</TabsTrigger>
          <TabsTrigger value="rates" className="text-xs"><RefreshCw className="size-3" /> {t("settings.exchangeRates")}</TabsTrigger>
          <TabsTrigger value="audit" className="text-xs"><History className="size-3" /> {t("settings.auditLog")}</TabsTrigger>
        </TabsList>

        {/* ── Currency Registry Tab ── */}
        <TabsContent value="registry">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{t("settings.currencyRegistry")}</CardTitle>
                <Dialog open={addCurrencyOpen} onOpenChange={setAddCurrencyOpen}>
                  <Button size="sm" className="h-7" onClick={() => setAddCurrencyOpen(true)}>
                    <Plus className="size-3.5" /> {t("settings.addCurrency")}
                  </Button>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="text-sm">{t("settings.addNewCurrency")}</DialogTitle>
                      <DialogDescription className="text-xs">{t("settings.addCurrencyDesc")}</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="text-xs">{t("settings.isoCode")}</Label>
                        <Input value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase().slice(0, 3))} placeholder="EUR" className="h-8 text-xs font-mono" />
                      </div>
                      <div>
                        <Label className="text-xs">{t("settings.currencyName")}</Label>
                        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Euro" className="h-8 text-xs" />
                      </div>
                      <div>
                        <Label className="text-xs">{t("settings.symbol")}</Label>
                        <Input value={newSymbol} onChange={(e) => setNewSymbol(e.target.value)} placeholder="€" className="h-8 text-xs" />
                      </div>
                      <div>
                        <Label className="text-xs">{t("settings.decimalPrecision")}</Label>
                        <Input type="number" value={newPrecision} onChange={(e) => setNewPrecision(e.target.value)} min={0} max={4} className="h-8 text-xs" />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-xs">{t("settings.initialRate")}</Label>
                        <Input type="number" step="any" value={newRate} onChange={(e) => setNewRate(e.target.value)} placeholder="0.92" className="h-8 text-xs" />
                        <p className="mt-1 text-[10px] text-muted-foreground">{t("settings.ratePerUSD", { currency: accountingCurrency })}</p>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button size="sm" variant="outline" onClick={() => setAddCurrencyOpen(false)}>{t("common.cancel")}</Button>
                      <Button size="sm" onClick={handleAddCurrency}>{t("common.add")}</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="h-8 text-[10px]">{t("settings.isoCode")}</TableHead>
                      <TableHead className="h-8 text-[10px]">{t("settings.currencyName")}</TableHead>
                      <TableHead className="h-8 text-[10px]">{t("settings.symbol")}</TableHead>
                      <TableHead className="h-8 text-[10px]">{t("settings.decimalPrecision")}</TableHead>
                      <TableHead className="h-8 text-[10px]">{t("settings.lastKnownRate")}</TableHead>
                      <TableHead className="h-8 text-[10px]">{t("settings.lastUpdated")}</TableHead>
                      <TableHead className="h-8 text-[10px]">{t("common.status")}</TableHead>
                      <TableHead className="h-8 text-[10px]">{t("common.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currencies.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-6 text-center text-xs text-muted-foreground">
                          {t("settings.noCurrencies")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      currencies.map((c) => (
                        <TableRow key={c.isoCode} className={!c.isActive ? "opacity-50 bg-muted/20" : ""}>
                          <TableCell className="py-1.5 text-[11px] font-mono font-medium">{c.isoCode}</TableCell>
                          <TableCell className="py-1.5 text-[11px]">{currencyPresentation(c.isoCode).name}</TableCell>
                          <TableCell className="py-1.5 text-[11px]">{currencyPresentation(c.isoCode).compactSymbol}</TableCell>
                          <TableCell className="py-1.5 text-[11px] tabular-nums">{c.decimalPrecision}</TableCell>
                          <TableCell className="py-1.5 text-[11px] tabular-nums">{c.lastKnownRate.toFixed(4)}</TableCell>
                          <TableCell className="py-1.5 text-[11px] text-muted-foreground">
                            {c.lastRateUpdatedAt ? new Date(c.lastRateUpdatedAt).toLocaleDateString() : "—"}
                          </TableCell>
                          <TableCell className="py-1.5">
                            <div className="flex items-center gap-1.5">
                              <Switch
                                checked={c.isActive}
                                onCheckedChange={() => handleToggleActive(c.isoCode, c.isActive)}
                              />
                              {c.isActive ? (
                                <Badge variant="default" className="text-[9px] h-4 px-1 bg-emerald-500/15 text-emerald-600 border-emerald-500/30">
                                  {t("common.active")}
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-[9px] h-4 px-1">
                                  {t("common.inactive")}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="py-1.5">
                            <div className="flex items-center gap-1">
                              {c.isoCode === accountingCurrency ? (
                                <Badge variant="secondary" className="text-[9px]">{t("settings.accounting")}</Badge>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="size-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => handleDeleteRequest(c)}
                                  title={t("common.delete")}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Exchange Rate Management Tab ── */}
        <TabsContent value="rates">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{t("settings.exchangeRateManagement")}</CardTitle>
                <Button size="sm" className="h-7" onClick={handleSync} disabled={syncing}>
                  <RefreshCw className={`size-3.5 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? t("settings.syncing") : t("settings.syncNow")}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-muted-foreground">
                    {t("settings.rateManagementDesc", { currency: accountingCurrency })}
                  </div>
                </div>
              </div>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="h-8 text-[10px]">{t("settings.isoCode")}</TableHead>
                      <TableHead className="h-8 text-[10px]">{t("settings.currentRate")}</TableHead>
                      <TableHead className="h-8 text-[10px]">{t("settings.rateSource")}</TableHead>
                      <TableHead className="h-8 text-[10px]">{t("settings.mode")}</TableHead>
                      <TableHead className="h-8 text-[10px]">{t("common.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currencies.map((c) => {
                      const override = getOverride(c.isoCode)
                      const isManual = override?.mode === "manual"
                      const rate = c.isActive ? CurrencyService.getRate(c.isoCode) : c.lastKnownRate
                      const source = CurrencyService.getRateSource(c.isoCode)
                      return (
                        <TableRow key={c.isoCode} className={!c.isActive ? "opacity-50 bg-muted/20" : ""}>
                          <TableCell className="py-1.5 text-[11px] font-mono font-medium">
                            {c.isoCode}
                            {!c.isActive && <span className="ml-1 text-[9px] text-muted-foreground">({t("common.inactive")})</span>}
                          </TableCell>
                          <TableCell className="py-1.5 text-[11px] tabular-nums">{rate.toFixed(4)}</TableCell>
                          <TableCell className="py-1.5">
                            <Badge variant="outline" className="text-[9px]">
                              {source === "api" && "API"}
                              {source === "manual" && t("settings.manual")}
                              {source === "cache" && t("settings.cached")}
                              {source === "default" && t("settings.default")}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-1.5">
                            <div className="flex items-center gap-1.5">
                              {isManual ? (
                                <ToggleRight className="size-4 text-primary" />
                              ) : (
                                <ToggleLeft className="size-4 text-muted-foreground" />
                              )}
                              <span className="text-[10px]">{isManual ? t("settings.manual") : t("settings.automatic")}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-1.5">
                            <div className="flex items-center gap-1">
                              {editingRate === c.isoCode ? (
                                <>
                                  <Input
                                    type="number"
                                    step="any"
                                    value={manualRateInput}
                                    onChange={(e) => setManualRateInput(e.target.value)}
                                    className="h-6 w-20 text-[10px]"
                                    placeholder={rate.toFixed(4)}
                                  />
                                  <Input
                                    value={manualReason}
                                    onChange={(e) => setManualReason(e.target.value)}
                                    className="h-6 w-28 text-[10px]"
                                    placeholder={t("settings.reason")}
                                  />
                                  <Button size="sm" className="h-6 text-[10px]" onClick={() => handleSetManual(c.isoCode)}>
                                    {t("common.save")}
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setEditingRate(null)}>
                                    {t("common.cancel")}
                                  </Button>
                                </>
                              ) : (
                                <>
                                  {c.isoCode !== accountingCurrency && (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-6 text-[10px]"
                                        onClick={() => {
                                          setEditingRate(c.isoCode)
                                          setManualRateInput(String(rate))
                                          setManualReason("")
                                        }}
                                      >
                                        {t("settings.setRate")}
                                      </Button>
                                      {isManual && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-6 text-[10px]"
                                          onClick={() => handleSetAutomatic(c.isoCode)}
                                        >
                                          {t("settings.auto")}
                                        </Button>
                                      )}
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              <Separator className="my-3" />
              <div className="text-[10px] text-muted-foreground">
                {t("settings.ratePerUSDNote", { currency: accountingCurrency })}{" · "}
                <a
                  href="https://www.exchangerate-api.com"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Rates by ExchangeRate-API
                </a>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Audit Log Tab ── */}
        <TabsContent value="audit">
          <Card>
            <CardHeader><CardTitle className="text-sm">{t("settings.exchangeRateAuditLog")}</CardTitle></CardHeader>
            <CardContent>
              {auditLog.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">{t("settings.noAuditEntries")}</div>
              ) : (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="h-8 text-[10px]">{t("settings.isoCode")}</TableHead>
                        <TableHead className="h-8 text-[10px]">{t("settings.oldRate")}</TableHead>
                        <TableHead className="h-8 text-[10px]">{t("settings.newRate")}</TableHead>
                        <TableHead className="h-8 text-[10px]">{t("settings.changedBy")}</TableHead>
                        <TableHead className="h-8 text-[10px]">{t("common.date")}</TableHead>
                        <TableHead className="h-8 text-[10px]">{t("settings.reason")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditLog.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="py-1.5 text-[11px] font-mono font-medium">{entry.currencyCode}</TableCell>
                          <TableCell className="py-1.5 text-[11px] tabular-nums">{entry.oldRate?.toFixed(4) ?? "—"}</TableCell>
                          <TableCell className="py-1.5 text-[11px] tabular-nums">{entry.newRate?.toFixed(4) ?? "—"}</TableCell>
                          <TableCell className="py-1.5 text-[11px]">{entry.changedBy ?? "—"}</TableCell>
                          <TableCell className="py-1.5 text-[11px] text-muted-foreground">
                            {new Date(entry.changedAt).toLocaleString()}
                          </TableCell>
                          <TableCell className="py-1.5 text-[11px] text-muted-foreground">{entry.reason ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ✅ نافذة تأكيد الحذف */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Trash2 className="size-4 text-destructive" />
              {t("settings.deleteCurrency")}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {t("settings.deleteCurrencyConfirm")}{" "}
              <span className="font-bold text-foreground">
                {currencyToDelete?.isoCode} — {currencyToDelete?.name}
              </span>
              {t("settings.deleteCurrencyWarning")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false)
                setCurrencyToDelete(null)
              }}
              disabled={deleting}
            >
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deleting}
            >
              {deleting ? t("common.deleting") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
