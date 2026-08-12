import { useEffect, useState } from "react"
import {
  Settings as SettingsIcon,
  Database,
  Download,
  RotateCcw,
  Shield,
  Users,
  Info,
  Crosshair,
  Coins,
  Layers,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useStore } from "@/lib/store"
import { useI18n } from "@/lib/i18n"
import { useCurrency } from "@/lib/currency-context"
import type { UserRole, UserPermissions } from "@/lib/types"
import { CurrencyManagementPanel } from "@/components/currency-management-panel"
import { MasterDataPanel } from "@/components/master-data-panel"
import { downloadSnapshot } from "@/lib/excel"
import { toast } from "sonner"

const ROLE_VALUES: UserRole[] = ["Admin", "Employee", "Manager", "Sales", "Inventory", "Accountant", "Read-Only"]

export function SettingsPage() {
  const { t } = useI18n()
  const { currencies, accountingCurrency, transactionCurrency, displayCurrency, setDisplayCurrency, currencyPresentation } = useCurrency()
  const store = useStore()
  const settings = store.settings
  const users = store.users
  const updateSettings = store.updateSettings
  const addUser = store.addUser
  const updateUser = store.updateUser
  const deleteUser = store.deleteUser
  const refreshFromDb = store.refreshFromDb
  const [resetOpen, setResetOpen] = useState(false)
  const [addUserOpen, setAddUserOpen] = useState(false)
  const [newUsername, setNewUsername] = useState("")
  const [newName, setNewName] = useState("")
  const [newRole, setNewRole] = useState<UserRole>("Manager")
  const [backupLoading, setBackupLoading] = useState(false)
  const [companyName, setCompanyName] = useState(settings.companyName ?? "")
  const [companyAddress, setCompanyAddress] = useState(settings.companyAddress ?? "")
  const [pricingDraft, setPricingDraft] = useState(() => ({
    retail: String(settings.targetRetailMarginPercent),
    wholesale: String(settings.targetWholesaleMarginPercent),
    minimum: String(settings.minProfitMarginPercent),
    maximumMarkup: String(settings.maximumMarkupPercent),
  }))

  useEffect(() => {
    setCompanyName(settings.companyName ?? "")
    setCompanyAddress(settings.companyAddress ?? "")
  }, [settings.companyName, settings.companyAddress])

  useEffect(() => {
    setPricingDraft({
      retail: String(settings.targetRetailMarginPercent),
      wholesale: String(settings.targetWholesaleMarginPercent),
      minimum: String(settings.minProfitMarginPercent),
      maximumMarkup: String(settings.maximumMarkupPercent),
    })
  }, [settings.maximumMarkupPercent, settings.minProfitMarginPercent, settings.targetRetailMarginPercent, settings.targetWholesaleMarginPercent])

  const savePricingRules = async () => {
    const retail = Number(pricingDraft.retail)
    const wholesale = Number(pricingDraft.wholesale)
    const minimum = Number(pricingDraft.minimum)
    const maximumMarkup = Number(pricingDraft.maximumMarkup)
    if (![retail, wholesale, minimum, maximumMarkup].every(Number.isFinite)
      || retail <= 0 || retail >= 100 || wholesale <= 0 || wholesale >= retail
      || minimum < 0 || minimum >= wholesale || maximumMarkup < 0) {
      toast.error(t("pricing.invalidPrice"))
      return
    }
    const result = await updateSettings({
      targetRetailMarginPercent: retail,
      targetWholesaleMarginPercent: wholesale,
      minProfitMarginPercent: minimum,
      maximumMarkupPercent: maximumMarkup,
    })
    if (!result.success) toast.error(result.error ?? t("settings.saveFailed"))
  }

  useEffect(() => {
    void refreshFromDb()
  }, [refreshFromDb])

  const roleLabel = (role: UserRole): string => {
    const map: Partial<Record<UserRole, string>> = {
      Admin: t("role.Admin"),
      Manager: t("role.Manager"),
    }
    return map[role] ?? role
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
    "shipment.import": "Import shipment manifests",
    "shipment.review": "Review shipment manifests",
    "shipment.edit": "Edit shipment manifests",
    "shipment.receive": "Receive shipments into inventory",
    "shipment.cancel": "Cancel shipments",
    "shipment.reschedule": "Reschedule shipments",
  }

  const handleSnapshotDownload = () => {
    setBackupLoading(true)
    try {
      downloadSnapshot()
      toast.success(t("settings.backupCreated"))
    } catch (error) {
      console.error("Failed to export portable snapshot:", error)
      toast.error(t("settings.backupCreateFailed"))
    } finally {
      setBackupLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3 lg:p-4">
      <Tabs defaultValue="general">
        <TabsList className="h-8">
          <TabsTrigger value="general" className="text-xs">
            <SettingsIcon className="size-3" /> {t("settings.general")}
          </TabsTrigger>
          <TabsTrigger value="currency" className="text-xs">
            <Coins className="size-3" /> {t("settings.currency")}
          </TabsTrigger>
          <TabsTrigger value="masterdata" className="text-xs">
            <Layers className="size-3" /> {t("settings.masterData")}
          </TabsTrigger>
          <TabsTrigger value="users" className="text-xs">
            <Users className="size-3" /> {t("settings.users")}
          </TabsTrigger>
          <TabsTrigger value="data" className="text-xs">
            <Database className="size-3" /> {t("settings.data")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Info className="size-4" /> {t("settings.systemInfo")}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Crosshair className="size-6" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">Weapon Store ERP</div>
                    <div className="text-[10px] text-muted-foreground">
                      {t("settings.versionInfo")}
                    </div>
                  </div>
                </div>
                <Separator />
                <div className="grid gap-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t("settings.currentUser")}
                    </span>
                    <span>{store.getCurrentUser().name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t("settings.role")}
                    </span>
                    <Badge variant="secondary">
                      {roleLabel(store.getCurrentUser().role)}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t("report.accountingCurrency")}
                    </span>
                    <span>{accountingCurrency}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("settings.currency")}</span>
                    <span>{transactionCurrency}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("report.displayCurrency")}</span>
                    <span>{displayCurrency}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t("settings.language")}
                    </span>
                    <span>{settings.appLanguage ?? "en"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t("settings.theme")}
                    </span>
                    <span>{settings.theme ?? "system"}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t("settings.general")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="grid gap-3">
                  <div>
                    <Label className="text-xs">{t("settings.language")}</Label>
                    <Select
                      value={settings.appLanguage ?? "en"}
                      onValueChange={(value) => updateSettings({ appLanguage: value })}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="ar">العربية</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">{t("settings.preferredDisplayCurrency")}</Label>
                    <Select
                      value={displayCurrency}
                      onValueChange={setDisplayCurrency}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {currencies.map((currency) => (
                          <SelectItem key={currency.isoCode} value={currency.isoCode}>
                            {currency.isoCode} — {currencyPresentation(currency.isoCode).name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">{t("settings.companyName")}</Label>
                    <Input
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      onBlur={() => updateSettings({ companyName }).catch(() => { })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{t("settings.companyAddress")}</Label>
                    <Input
                      value={companyAddress}
                      onChange={(e) => setCompanyAddress(e.target.value)}
                      onBlur={() => updateSettings({ companyAddress }).catch(() => { })}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm"><Coins className="size-4" />{t("settings.pricingRules")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {([
                  ["retail", "settings.targetRetailMargin"],
                  ["wholesale", "settings.targetWholesaleMargin"],
                  ["minimum", "settings.minProfitMargin"],
                  ["maximumMarkup", "settings.maximumMarkup"],
                ] as const).map(([field, label]) => (
                  <div key={field}>
                    <Label className="text-xs">{t(label)}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={field === "maximumMarkup" ? 10000 : 99.99}
                      step="0.1"
                      value={pricingDraft[field]}
                      onChange={(event) => setPricingDraft((current) => ({ ...current, [field]: event.target.value }))}
                      onBlur={() => void savePricingRules()}
                      className="h-8 text-xs"
                    />
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 rounded-md border p-3 sm:col-span-2">
                  <div>
                    <Label className="text-xs">{t("settings.psychologicalPricing")}</Label>
                    <p className="text-[10px] text-muted-foreground">{t("settings.psychologicalPricingHelp")}</p>
                  </div>
                  <Switch checked={settings.psychologicalPricing} onCheckedChange={(checked) => void updateSettings({ psychologicalPricing: checked })} />
                </div>
              </CardContent>
            </Card>
          </div>
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
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Shield className="size-4" /> {t("settings.userMgmt")}
                </CardTitle>
                <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="h-7">
                      <Users className="size-3.5" /> {t("settings.addUser")}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="text-sm">
                        {t("settings.addNewUser")}
                      </DialogTitle>
                    </DialogHeader>
                    <DialogDescription className="text-xs">
                      {t("settings.userFirstLogin")}
                    </DialogDescription>
                    <div className="grid gap-3">
                      <div>
                        <Label className="text-xs">
                          {t("settings.username")}
                        </Label>
                        <Input
                          type="email"
                          autoComplete="email"
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">
                          {t("settings.displayName")}
                        </Label>
                        <Input
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">{t("settings.role")}</Label>
                        <Select
                          value={newRole}
                          onValueChange={(v) => setNewRole(v as UserRole)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_VALUES.map((r) => (
                              <SelectItem key={r} value={r}>
                                {roleLabel(r)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAddUserOpen(false)}
                      >
                        {t("common.cancel")}
                      </Button>
                      <Button
                        size="sm"
                        onClick={async () => {
                          if (!newUsername.trim() || !newName.trim()) {
                            toast.error(t("settings.usernameNameRequired"))
                            return
                          }
                          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newUsername.trim())) {
                            toast.error(t("settings.validEmailRequired"))
                            return
                          }
                          const defaultPerms: UserPermissions = {
                            canImportExcel: newRole === "Admin" || newRole === "Manager",
                            canExportData:
                              newRole === "Admin" || newRole === "Manager" || newRole === "Accountant",
                            canViewReports:
                              newRole === "Admin" || newRole === "Manager" || newRole === "Accountant",
                            canManageUsers: newRole === "Admin",
                            canRegisterPayments:
                              newRole === "Admin" || newRole === "Manager" || newRole === "Accountant",
                            canVoidInvoices: newRole === "Admin" || newRole === "Manager",
                            canExtendDueDates: newRole === "Admin" || newRole === "Manager",
                            canDeleteRecords: newRole === "Admin",
                          }
                          const result = await addUser({
                            username: newUsername.trim(),
                            name: newName.trim(),
                            role: newRole,
                            permissions: defaultPerms,
                          })
                          if (!result.success) {
                            toast.error(result.error ?? "Failed to add user")
                            return
                          }
                          await refreshFromDb()
                          toast.success(t("settings.userAdded"))
                          setAddUserOpen(false)
                          setNewUsername("")
                          setNewName("")
                        }}
                      >
                        {t("settings.addUser")}
                      </Button>
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
                      <TableHead className="h-8 text-[10px]">
                        {t("settings.username")}
                      </TableHead>
                      <TableHead className="h-8 text-[10px]">
                        {t("settings.displayName")}
                      </TableHead>
                      <TableHead className="h-8 text-[10px]">
                        {t("settings.role")}
                      </TableHead>
                      <TableHead className="h-8 text-[10px]">
                        {t("settings.password")}
                      </TableHead>
                      <TableHead className="h-8 text-[10px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="py-1.5 text-[11px] font-medium">
                          {u.username}
                        </TableCell>
                        <TableCell className="py-1.5 text-[11px]">
                          {u.name}
                        </TableCell>
                        <TableCell className="py-1.5">
                          <Select
                            value={u.role}
                            onValueChange={async (v) => {
                              const result = await updateUser(u.id, { role: v as UserRole })
                              if (!result.success) toast.error(result.error ?? "Failed to update user")
                              else await refreshFromDb()
                            }}
                          >
                            <SelectTrigger
                              size="sm"
                              className="h-6 w-28 text-[10px]"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLE_VALUES.map((r) => (
                                <SelectItem key={r} value={r}>
                                  {roleLabel(r)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="py-1.5">
                          <Badge
                            variant={
                              u.passwordSet ? "secondary" : "outline"
                            }
                            className="text-[9px]"
                          >
                            {u.passwordSet
                              ? t("settings.passwordSet")
                              : t("settings.passwordPending")}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-1.5">
                          {u.id !== store.currentUserId && (
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              onClick={() => {
                                deleteUser(u.id)
                                toast.success(t("settings.userDeleted"))
                              }}
                            >
                              <RotateCcw className="size-3" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <Separator className="my-3" />

              {/* Permission switches for current user */}
              <div>
                <h4 className="mb-2 text-xs font-medium">
                  {t("settings.permissions")} — {store.getCurrentUser().name}
                </h4>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    Object.keys(PERMISSION_LABELS) as (keyof UserPermissions)[]
                  ).map((perm) => (
                    <div
                      key={perm}
                      className="flex items-center justify-between rounded-md border p-2"
                    >
                      <span className="text-[11px]">
                        {PERMISSION_LABELS[perm]}
                      </span>
                      <Switch
                        checked={store.getCurrentUser().permissions[perm]}
                        onCheckedChange={(v) => {
                          if (store.getCurrentUser().role === "Admin") {
                            updateUser(store.getCurrentUser().id, {
                              permissions: {
                                ...store.getCurrentUser().permissions,
                                [perm]: v,
                              },
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
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Database className="size-4" />{" "}
                  {t("settings.backupEngine")}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-[11px] text-muted-foreground">
                  {t("settings.backupDesc")}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSnapshotDownload} disabled={backupLoading}>
                    <Download className="size-3.5" />{" "}
                    {backupLoading ? t("settings.backupCreating") : t("settings.createBackup")}
                  </Button>
                </div>
                <Separator className="my-2" />
                <div className="grid gap-1 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("settings.backupCount")}</span>
                    <span>Supabase</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("settings.weapons")}</span>
                    <span className="tabular-nums">{store.weapons.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("settings.invoices")}</span>
                    <span className="tabular-nums">{store.invoices.length}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Database className="size-4" /> {t("settings.backupHistory")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-[11px] text-muted-foreground">
                <p>{t("settings.noBackups")}</p>
                <p>{t("settings.restoreBackupConfirm")}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <RotateCcw className="size-4" /> {t("settings.dataReset")}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-[11px] text-muted-foreground">
                  {t("settings.resetDesc")}
                </p>
                <Dialog open={resetOpen} onOpenChange={setResetOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline">
                      <RotateCcw className="size-3.5" />{" "}
                      {t("settings.resetToMock")}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="text-sm">
                        {t("settings.resetDatabase")}
                      </DialogTitle>
                      <DialogDescription>
                        {t("settings.resetWarning")}
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setResetOpen(false)}
                      >
                        {t("common.cancel")}
                      </Button>
                      <Button
                        size="sm"
                        variant="default"
                        onClick={async () => {
                          await refreshFromDb()
                          setResetOpen(false)
                          toast.success(t("settings.databaseReset"))
                        }}
                      >
                        {t("settings.yesReset")}
                      </Button>
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
