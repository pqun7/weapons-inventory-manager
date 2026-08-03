import { useState, useRef } from "react"
import {
  Settings as SettingsIcon, Database, Download, Upload, RotateCcw, Shield, Users,
  DollarSign, FileText, Printer, Clock, Info, Crosshair, Coins, Layers,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useStore } from "@/lib/store"
import { downloadSnapshot, importSnapshot } from "@/lib/excel"
import { useI18n } from "@/lib/i18n"
import type { UserRole, UserPermissions } from "@/lib/types"
import { CurrencyManagementPanel } from "@/components/currency-management-panel"
import { MasterDataPanel } from "@/components/master-data-panel"
import { toast } from "sonner"

const ROLE_VALUES: UserRole[] = ["Admin", "Manager", "Sales", "Inventory", "Accountant", "Read-Only"]

export function SettingsPage() {
  const { t } = useI18n()
  const store = useStore()
  const settings = store.settings
  const users = store.users
  const updateSettings = store.updateSettings
  const addUser = store.addUser
  const updateUser = store.updateUser
  const deleteUser = store.deleteUser
  const refreshFromDb = store.refreshFromDb
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [addUserOpen, setAddUserOpen] = useState(false)
  const [newUsername, setNewUsername] = useState("")
  const [newName, setNewName] = useState("")
  const [newRole, setNewRole] = useState<UserRole>("Sales")

  const roleLabel = (role: UserRole): string => {
    const map: Record<UserRole, string> = {
      "Admin": t("role.Admin"),
      "Manager": t("role.Manager"),
      "Sales": t("role.Sales"),
      "Inventory": t("role.Inventory"),
      "Accountant": t("role.Accountant"),
      "Read-Only": t("role.Read-Only"),
    }
    return map[role]
  }

  const PERMISSION_LABELS: Record<keyof UserPermissions, string> = {
    canImportExcel: t("settings.canImportExcel"),
    canExportData: t("settings.canExportData"),
    canViewReports: t("settings.canViewReports"),
    canManageUsers: t("settings.canManageUsers"),
    canRegisterPayments: t("settings.canRegisterPayments"),
    canVoidInvoices: t("settings.canVoidInvoices"),
    canExtendDueDates: t("settings.canExtendDueDates"),
    canDeleteRecords: t("settings.canDeleteRecords"),
  }

  const handleSnapshotDownload = () => {
    downloadSnapshot()
    toast.success(t("settings.backupCreated"))
  }

  const handleSnapshotImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const result = await importSnapshot(file)
    if (result.valid && result.checksumValid) {
      toast.success(t("settings.snapshotRestored"))
    } else if (result.valid && !result.checksumValid) {
      toast.error(t("settings.checksumMismatch"))
    } else {
      toast.error(result.error || t("settings.invalidSnapshot"))
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  return (
    <div className="flex flex-col gap-3 p-3 lg:p-4">
      <Tabs defaultValue="general">
        <TabsList className="h-8">
          <TabsTrigger value="general" className="text-xs"><SettingsIcon className="size-3" /> {t("settings.general")}</TabsTrigger>
          <TabsTrigger value="taxation" className="text-xs"><DollarSign className="size-3" /> {t("settings.taxation")}</TabsTrigger>
          <TabsTrigger value="invoice" className="text-xs"><FileText className="size-3" /> {t("settings.invoice")}</TabsTrigger>
          <TabsTrigger value="hardware" className="text-xs"><Printer className="size-3" /> {t("settings.hardware")}</TabsTrigger>
          <TabsTrigger value="automation" className="text-xs"><Clock className="size-3" /> {t("settings.automation")}</TabsTrigger>
          <TabsTrigger value="currency" className="text-xs"><Coins className="size-3" /> {t("settings.currency")}</TabsTrigger>
          <TabsTrigger value="masterdata" className="text-xs"><Layers className="size-3" /> {t("settings.masterData")}</TabsTrigger>
          <TabsTrigger value="users" className="text-xs"><Users className="size-3" /> {t("settings.users")}</TabsTrigger>
          <TabsTrigger value="data" className="text-xs"><Database className="size-3" /> {t("settings.data")}</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Info className="size-4" /> {t("settings.systemInfo")}</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Crosshair className="size-6" /></div>
                <div><div className="text-sm font-semibold">Weapon Store ERP</div><div className="text-[10px] text-muted-foreground">{t("settings.versionInfo")}</div></div>
              </div>
              <Separator />
              <div className="grid gap-2 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">{t("settings.currentUser")}</span><span>{store.getCurrentUser().name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t("settings.role")}</span><Badge variant="secondary">{roleLabel(store.getCurrentUser().role)}</Badge></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t("settings.weapons")}</span><span className="tabular-nums">{store.weapons.length}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t("settings.invoices")}</span><span className="tabular-nums">{store.invoices.length}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t("settings.shipments")}</span><span className="tabular-nums">{store.shipments.length}</span></div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="taxation">
          <Card>
            <CardHeader><CardTitle className="text-sm">{t("settings.currencyTax")}</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div><Label className="text-xs">{t("settings.currencySymbol")}</Label><Input value={settings.currencySymbol} onChange={(e) => updateSettings({ currencySymbol: e.target.value })} className="h-8 text-xs" /></div>
              <div><Label className="text-xs">{t("settings.currencyCode")}</Label><Input value={settings.currencyCode} onChange={(e) => updateSettings({ currencyCode: e.target.value })} className="h-8 text-xs" /></div>
              <div><Label className="text-xs">{t("settings.taxPercent")}</Label><Input type="number" value={settings.taxPercent} onChange={(e) => updateSettings({ taxPercent: Number(e.target.value) })} className="h-8 text-xs" /></div>
              <div><Label className="text-xs">{t("settings.minProfitMargin")}</Label><Input type="number" value={settings.minProfitMarginPercent} onChange={(e) => updateSettings({ minProfitMarginPercent: Number(e.target.value) })} className="h-8 text-xs" /></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoice">
          <Card>
            <CardHeader><CardTitle className="text-sm">{t("settings.invoiceDesigner")}</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <div><Label className="text-xs">{t("settings.invoiceHeader")}</Label><Input value={settings.invoiceHeader} onChange={(e) => updateSettings({ invoiceHeader: e.target.value })} className="h-8 text-xs" /></div>
              <div><Label className="text-xs">{t("settings.invoiceFooter")}</Label><Textarea value={settings.invoiceFooter} onChange={(e) => updateSettings({ invoiceFooter: e.target.value })} className="min-h-[60px] text-xs" /></div>
              <div><Label className="text-xs">{t("settings.storeLogo")}</Label><Input value={settings.storeLogo} onChange={(e) => updateSettings({ storeLogo: e.target.value })} placeholder={t("settings.logoPlaceholder")} className="h-8 text-xs font-mono" /></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hardware">
          <Card>
            <CardHeader><CardTitle className="text-sm">{t("settings.hardwareProfiles")}</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">{t("settings.thermalWidth")}</Label>
                <Select value={String(settings.thermalPrinterWidth)} onValueChange={(v) => updateSettings({ thermalPrinterWidth: Number(v) })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="58">58mm</SelectItem><SelectItem value="80">80mm</SelectItem><SelectItem value="110">110mm</SelectItem></SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("settings.labelFormat")}</Label>
                <Select value={settings.labelFormat} onValueChange={(v) => updateSettings({ labelFormat: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Standard">Standard</SelectItem><SelectItem value="Compact">Compact</SelectItem><SelectItem value="Detailed">Detailed</SelectItem></SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="automation">
          <Card>
            <CardHeader><CardTitle className="text-sm">{t("settings.automationSchedules")}</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
              <SettingSwitch label={t("settings.hourlySnapshot")} description={t("settings.hourlySnapshotDesc")} checked={settings.hourlySnapshot} onChange={(v) => updateSettings({ hourlySnapshot: v })} />
              <SettingSwitch label={t("settings.dailyClosing")} description={t("settings.dailyClosingDesc")} checked={settings.dailyClosingPrompt} onChange={(v) => updateSettings({ dailyClosingPrompt: v })} />
              <SettingSwitch label={t("settings.weeklyVerification")} description={t("settings.weeklyVerificationDesc")} checked={settings.weeklyVerification} onChange={(v) => updateSettings({ weeklyVerification: v })} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="currency">
          <CurrencyManagementPanel />
        </TabsContent>

        <TabsContent value="masterdata">
          <MasterDataPanel />
        </TabsContent>

        <TabsContent value="users">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm"><Shield className="size-4" /> {t("settings.userMgmt")}</CardTitle>
                <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
                  <DialogTrigger asChild><Button size="sm" className="h-7"><Users className="size-3.5" /> {t("settings.addUser")}</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle className="text-sm">{t("settings.addNewUser")}</DialogTitle></DialogHeader>
                    <DialogDescription className="text-xs">{t("settings.userFirstLogin")}</DialogDescription>
                    <div className="grid gap-3">
                      <div><Label className="text-xs">{t("settings.username")}</Label><Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} className="h-8 text-xs" /></div>
                      <div><Label className="text-xs">{t("settings.displayName")}</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} className="h-8 text-xs" /></div>
                      <div><Label className="text-xs">{t("settings.role")}</Label><Select value={newRole} onValueChange={(v) => setNewRole(v as UserRole)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{ROLE_VALUES.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}</SelectContent></Select></div>
                    </div>
                    <DialogFooter>
                      <Button size="sm" variant="outline" onClick={() => setAddUserOpen(false)}>{t("common.cancel")}</Button>
                      <Button size="sm" onClick={() => {
                        if (!newUsername.trim() || !newName.trim()) { toast.error(t("settings.usernameNameRequired")); return }
                        const defaultPerms: UserPermissions = {
                          canImportExcel: newRole === "Admin" || newRole === "Manager",
                          canExportData: newRole === "Admin" || newRole === "Manager" || newRole === "Accountant",
                          canViewReports: newRole === "Admin" || newRole === "Manager" || newRole === "Accountant",
                          canManageUsers: newRole === "Admin",
                          canRegisterPayments: newRole === "Admin" || newRole === "Manager" || newRole === "Accountant",
                          canVoidInvoices: newRole === "Admin" || newRole === "Manager",
                          canExtendDueDates: newRole === "Admin" || newRole === "Manager",
                          canDeleteRecords: newRole === "Admin",
                        }
                        addUser({ username: newUsername.trim(), name: newName.trim(), role: newRole, permissions: defaultPerms })
                        toast.success(t("settings.userAdded"))
                        setAddUserOpen(false); setNewUsername(""); setNewName("")
                      }}>{t("settings.addUser")}</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader><TableRow className="bg-muted/50">
                    <TableHead className="h-8 text-[10px]">{t("settings.username")}</TableHead>
                    <TableHead className="h-8 text-[10px]">{t("settings.displayName")}</TableHead>
                    <TableHead className="h-8 text-[10px]">{t("settings.role")}</TableHead>
                    <TableHead className="h-8 text-[10px]">{t("settings.password")}</TableHead>
                    <TableHead className="h-8 text-[10px]"></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {users.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="py-1.5 text-[11px] font-medium">{u.username}</TableCell>
                        <TableCell className="py-1.5 text-[11px]">{u.name}</TableCell>
                        <TableCell className="py-1.5">
                          <Select value={u.role} onValueChange={(v) => updateUser(u.id, { role: v as UserRole })}>
                            <SelectTrigger size="sm" className="h-6 w-28 text-[10px]"><SelectValue /></SelectTrigger>
                            <SelectContent>{ROLE_VALUES.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}</SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="py-1.5"><Badge variant={u.passwordSet ? "secondary" : "outline"} className="text-[9px]">{u.passwordSet ? t("settings.passwordSet") : t("settings.passwordPending")}</Badge></TableCell>
                        <TableCell className="py-1.5">
                          {u.id !== store.currentUserId && <Button size="icon-xs" variant="ghost" onClick={() => { deleteUser(u.id); toast.success(t("settings.userDeleted")) }}><RotateCcw className="size-3" /></Button>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <Separator className="my-3" />

              {/* Permission switches for current user */}
              <div>
                <h4 className="mb-2 text-xs font-medium">{t("settings.permissions")} — {store.getCurrentUser().name}</h4>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(Object.keys(PERMISSION_LABELS) as (keyof UserPermissions)[]).map((perm) => (
                    <div key={perm} className="flex items-center justify-between rounded-md border p-2">
                      <span className="text-[11px]">{PERMISSION_LABELS[perm]}</span>
                      <Switch
                        checked={store.getCurrentUser().permissions[perm]}
                        onCheckedChange={(v) => {
                          if (store.getCurrentUser().role === "Admin") {
                            updateUser(store.getCurrentUser().id, {
                              permissions: { ...store.getCurrentUser().permissions, [perm]: v },
                            })
                          } else {
                            toast.error(t("settings.onlyAdminPerms"))
                          }
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data">
          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Database className="size-4" /> {t("settings.snapshotEngine")}</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-[11px] text-muted-foreground">{t("settings.snapshotDesc")}</p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSnapshotDownload}><Download className="size-3.5" /> {t("settings.createBackup")}</Button>
                  <input ref={fileInputRef} type="file" accept=".json" onChange={handleSnapshotImport} className="hidden" />
                  <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}><Upload className="size-3.5" /> {t("settings.restoreBackup")}</Button>
                </div>
                <Separator className="my-2" />
                <div className="grid gap-1 text-[11px]">
                  <div className="flex justify-between"><span className="text-muted-foreground">{t("settings.weapons")}</span><span className="tabular-nums">{store.weapons.length}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t("settings.invoices")}</span><span className="tabular-nums">{store.invoices.length}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t("settings.customers")}</span><span className="tabular-nums">{store.customers.length}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t("settings.shipments")}</span><span className="tabular-nums">{store.shipments.length}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t("settings.auditLogs")}</span><span className="tabular-nums">{store.auditLogs.length}</span></div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><RotateCcw className="size-4" /> {t("settings.dataReset")}</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-[11px] text-muted-foreground">{t("settings.resetDesc")}</p>
                <Dialog open={resetOpen} onOpenChange={setResetOpen}>
                  <DialogTrigger asChild><Button size="sm" variant="destructive"><RotateCcw className="size-3.5" /> {t("settings.resetToMock")}</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle className="text-sm">{t("settings.resetDatabase")}</DialogTitle><DialogDescription>{t("settings.resetWarning")}</DialogDescription></DialogHeader>
                    <DialogFooter>
                      <Button size="sm" variant="outline" onClick={() => setResetOpen(false)}>{t("common.cancel")}</Button>
                      <Button size="sm" variant="destructive" onClick={async () => { await refreshFromDb(); setResetOpen(false); toast.success(t("settings.databaseReset")) }}>{t("settings.yesReset")}</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SettingSwitch({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border p-2">
      <div className="flex flex-col">
        <span className="text-xs font-medium">{label}</span>
        <span className="text-[10px] text-muted-foreground">{description}</span>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
