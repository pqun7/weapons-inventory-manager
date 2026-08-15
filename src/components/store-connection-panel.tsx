import { useEffect, useState, type FormEvent } from "react"
import { ArrowRightLeft, Cloud, Copy, Database, HardDrive, LogOut, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/ui/password-input"
import { Textarea } from "@/components/ui/textarea"
import { useI18n } from "@/lib/i18n"
import { getDatabaseProvider } from "@/lib/database-runtime"
import { signOutActiveDatabase } from "@/hooks/use-database-auth"
import type { ProviderMigrationProgressStage } from "@/lib/database-provider"
import type { StoreConnectionConfiguration } from "@/lib/store-connection"

interface ConnectionView {
  connection: StoreConnectionConfiguration
  connectionCode: string
}

const PROGRESS_LABELS: Record<"ar" | "en", Record<ProviderMigrationProgressStage, string>> = {
  ar: {
    "validating-destination": "التحقق من الوجهة وحساب المدير",
    "creating-source-snapshot": "إنشاء لقطة متسقة من بيانات المصدر",
    "creating-destination-backup": "إنشاء نسخة أمان كاملة للوجهة",
    "transferring-data": "نقل البيانات على دفعات موثقة",
    "applying-data": "تطبيق البيانات داخل معاملة واحدة",
    "verifying-data": "فحص أعداد الصفوف والعلاقات وسلامة القاعدة",
    "saving-provider": "حفظ المزود الجديد بعد نجاح التحقق",
  },
  en: {
    "validating-destination": "Validating the destination and administrator",
    "creating-source-snapshot": "Creating a consistent source snapshot",
    "creating-destination-backup": "Creating a complete destination safety backup",
    "transferring-data": "Transferring data in validated chunks",
    "applying-data": "Applying data in one transaction",
    "verifying-data": "Checking row counts, relationships, and integrity",
    "saving-provider": "Saving the new provider after verification",
  },
}

export function StoreConnectionPanel() {
  const { lang } = useI18n()
  const rtl = lang === "ar"
  const provider = getDatabaseProvider()
  const [view, setView] = useState<ConnectionView | null>(null)
  const [working, setWorking] = useState(false)
  const [migrationOpen, setMigrationOpen] = useState(false)
  const [progress, setProgress] = useState<ProviderMigrationProgressStage | null>(null)

  useEffect(() => {
    const removeProgress = window.electronAPI?.storage.onMigrationProgress(setProgress)
    if (provider === "supabase") {
      void window.electronAPI?.storeConnection.get().then((response) => {
        if (response.success && response.data) setView(response.data)
      })
    }
    return () => removeProgress?.()
  }, [provider])

  const signOut = async () => {
    setWorking(true)
    try {
      await signOutActiveDatabase()
      window.location.reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign-out failed")
      setWorking(false)
    }
  }

  return <>
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Database className="size-4" />{rtl ? "مزود قاعدة البيانات" : "Database provider"}</CardTitle>
        <CardDescription>{rtl ? "تسجيل الخروج لا يغيّر المزود ولا يحذف إعداداته أو بياناته." : "Signing out does not change the provider or delete its settings or data."}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Alert className="border-primary/20 bg-primary/5">
          {provider === "sqlite" ? <HardDrive /> : <Cloud />}
          <AlertTitle>{provider === "sqlite" ? (rtl ? "SQLite محلية" : "Local SQLite") : "Supabase"}</AlertTitle>
          <AlertDescription>{provider === "sqlite" ? (rtl ? "البيانات محفوظة داخل مجلد بيانات التطبيق على هذا الجهاز. لا يوجد اتصال Supabase نشط." : "Data is stored in this device's application data directory. No Supabase connection is active.") : (rtl ? "البيانات تستخدم مشروع Supabase المشترك. لم يتم فتح SQLite." : "Data uses the shared Supabase project. SQLite was not opened.")}</AlertDescription>
        </Alert>

        {provider === "supabase" && view && <>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-1.5"><Label>{rtl ? "المتجر" : "Store"}</Label><Input readOnly value={view.connection.storeName} className="bg-muted" /></div>
            <div className="grid gap-1.5"><Label>{rtl ? "المشروع" : "Project"}</Label><Input readOnly dir="ltr" value={new URL(view.connection.supabaseUrl).hostname.split(".")[0]} className="bg-muted" /></div>
            <div className="grid gap-1.5"><Label>{rtl ? "إصدار المخطط" : "Schema version"}</Label><Input readOnly dir="ltr" value={view.connection.schemaVersion} className="bg-muted" /></div>
          </div>
          <div className="grid gap-1.5"><Label>{rtl ? "كود المتجر" : "Store connection code"}</Label><Textarea readOnly dir="ltr" value={view.connectionCode} className="min-h-28 break-all bg-muted font-mono text-xs" /></div>
          <Button variant="outline" className="w-fit" onClick={() => { void navigator.clipboard.writeText(view.connectionCode).then(() => toast.success(rtl ? "تم نسخ الكود" : "Code copied")) }}><Copy className="size-4" />{rtl ? "نسخ الكود" : "Copy code"}</Button>
        </>}

        <Alert className="border-amber-500/30 bg-amber-500/5">
          <ShieldCheck className="text-amber-600" />
          <AlertTitle>{rtl ? "تغيير المزود بترحيل آمن" : "Safe provider migration"}</AlertTitle>
          <AlertDescription>{rtl ? "يحفظ التطبيق المصدر، وينشئ نسخة أمان للوجهة، وينقل كل جداول العمل، ثم يغيّر المزود فقط بعد نجاح التحقق. يحتاج المستخدمون الآخرون إلى أكواد تفعيل جديدة لأن كلمات المرور لا تُنقل بين نظامَي المصادقة." : "The source is preserved, the destination is backed up, every business table is transferred, and the provider changes only after verification. Other users need new activation codes because passwords cannot be moved between authentication systems."}</AlertDescription>
        </Alert>

        <div className="flex flex-wrap gap-2">
          <Button variant="default" disabled={working} onClick={() => setMigrationOpen(true)}><ArrowRightLeft className="size-4" />{provider === "sqlite" ? (rtl ? "ترحيل SQLite إلى Supabase" : "Migrate SQLite to Supabase") : (rtl ? "ترحيل Supabase إلى SQLite" : "Migrate Supabase to SQLite")}</Button>
          <Button variant="outline" disabled={working} onClick={signOut}><LogOut className="size-4" />{rtl ? "تسجيل الخروج" : "Sign out"}</Button>
        </div>
      </CardContent>
    </Card>

    <ProviderMigrationDialog
      open={migrationOpen}
      onOpenChange={setMigrationOpen}
      provider={provider}
      language={lang === "ar" ? "ar" : "en"}
      working={working}
      progress={progress}
      onWorkingChange={setWorking}
    />
  </>
}

function ProviderMigrationDialog({ open, onOpenChange, provider, language, working, progress, onWorkingChange }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: "sqlite" | "supabase"
  language: "ar" | "en"
  working: boolean
  progress: ProviderMigrationProgressStage | null
  onWorkingChange: (working: boolean) => void
}) {
  const rtl = language === "ar"
  const [connectionCode, setConnectionCode] = useState("")
  const [cloudEmail, setCloudEmail] = useState("")
  const [cloudPassword, setCloudPassword] = useState("")
  const [localStoreName, setLocalStoreName] = useState("")
  const [localAdminName, setLocalAdminName] = useState("")
  const [localAdminUsername, setLocalAdminUsername] = useState("admin")
  const [localPassword, setLocalPassword] = useState("")
  const [localPasswordConfirmation, setLocalPasswordConfirmation] = useState("")
  const [confirmation, setConfirmation] = useState("")

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (working) return
    if (confirmation.trim().toUpperCase() !== "MIGRATE") {
      toast.error(rtl ? "اكتب MIGRATE لتأكيد الترحيل" : "Type MIGRATE to confirm the migration")
      return
    }
    if (provider === "supabase" && localPassword !== localPasswordConfirmation) {
      toast.error(rtl ? "كلمتا مرور المدير المحلي غير متطابقتين" : "The local administrator passwords do not match")
      return
    }
    onWorkingChange(true)
    try {
      const response = provider === "sqlite"
        ? await window.electronAPI?.storage.migrateToSupabase({
          connectionCode,
          administratorEmail: cloudEmail,
          administratorPassword: cloudPassword,
          confirmation,
        })
        : await window.electronAPI?.storage.migrateToSqlite({
          administratorEmail: cloudEmail,
          administratorPassword: cloudPassword,
          localStoreName,
          localAdministratorName: localAdminName,
          localAdministratorUsername: localAdminUsername,
          localAdministratorPassword: localPassword,
          confirmation,
        })
      if (!response?.success || !response.data) throw new Error(response?.error ?? "Provider migration failed")
      toast.success(rtl
        ? `اكتمل نقل ${response.data.rowsTransferred} صفًا. أُبقي المصدر وأنشئت نسخة أمان للوجهة.`
        : `Transferred ${response.data.rowsTransferred} rows. The source was preserved and the destination was backed up.`)
      if (provider === "supabase") await signOutActiveDatabase().catch(() => undefined)
      window.location.reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (rtl ? "فشل ترحيل المزود" : "Provider migration failed"))
      onWorkingChange(false)
    }
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!working) onOpenChange(next) }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" dir={rtl ? "rtl" : "ltr"}>
      <form className="grid gap-4" onSubmit={(event) => { void submit(event) }}>
        <DialogHeader>
          <DialogTitle>{provider === "sqlite" ? (rtl ? "ترحيل البيانات إلى Supabase" : "Migrate data to Supabase") : (rtl ? "ترحيل البيانات إلى SQLite" : "Migrate data to SQLite")}</DialogTitle>
          <DialogDescription>{rtl ? "لا تغلق التطبيق أثناء التنفيذ. لن يتغير المزود المحفوظ إذا فشلت أي خطوة." : "Do not close the application during this operation. The saved provider will not change if any step fails."}</DialogDescription>
        </DialogHeader>

        <Alert className="border-destructive/30 bg-destructive/5"><ShieldCheck /><AlertTitle>{rtl ? "عملية إدارية حساسة" : "Sensitive administrator operation"}</AlertTitle><AlertDescription>{rtl ? "ستُستبدل بيانات الوجهة بعد إنشاء نسخة أمان كاملة. يبقى المصدر في مكانه ولا يُحذف." : "Destination data is replaced only after a complete safety backup. The source remains in place and is not deleted."}</AlertDescription></Alert>

        {provider === "sqlite" && <div className="grid gap-1.5"><Label>{rtl ? "كود متجر Supabase الوجهة" : "Destination Supabase store code"}</Label><Textarea required dir="ltr" className="min-h-28 font-mono text-xs" value={connectionCode} onChange={(event) => setConnectionCode(event.target.value)} /></div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label>{rtl ? "بريد مدير Supabase" : "Supabase administrator email"}</Label><Input required type="email" dir="ltr" autoComplete="username" value={cloudEmail} onChange={(event) => setCloudEmail(event.target.value)} /></div>
          <div className="grid gap-1.5"><Label>{rtl ? "كلمة مرور مدير Supabase" : "Supabase administrator password"}</Label><PasswordInput required autoComplete="current-password" value={cloudPassword} onChange={(event) => setCloudPassword(event.target.value)} /></div>
        </div>

        {provider === "supabase" && <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label>{rtl ? "اسم المتجر المحلي" : "Local store name"}</Label><Input required maxLength={120} value={localStoreName} onChange={(event) => setLocalStoreName(event.target.value)} /></div>
            <div className="grid gap-1.5"><Label>{rtl ? "اسم المدير المحلي" : "Local administrator name"}</Label><Input required maxLength={120} value={localAdminName} onChange={(event) => setLocalAdminName(event.target.value)} /></div>
            <div className="grid gap-1.5"><Label>{rtl ? "حساب المدير المحلي" : "Local administrator account"}</Label><Input required dir="ltr" maxLength={80} value={localAdminUsername} onChange={(event) => setLocalAdminUsername(event.target.value)} /></div>
            <div className="grid gap-1.5"><Label>{rtl ? "كلمة مرور المدير المحلي" : "Local administrator password"}</Label><PasswordInput required autoComplete="new-password" value={localPassword} onChange={(event) => setLocalPassword(event.target.value)} /></div>
            <div className="grid gap-1.5 sm:col-span-2"><Label>{rtl ? "تأكيد كلمة المرور المحلية" : "Confirm local password"}</Label><PasswordInput required autoComplete="new-password" value={localPasswordConfirmation} onChange={(event) => setLocalPasswordConfirmation(event.target.value)} /></div>
          </div>
        </>}

        <div className="grid gap-1.5">
          <Label>{rtl ? "اكتب MIGRATE للتأكيد" : "Type MIGRATE to confirm"}</Label>
          <Input required dir="ltr" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        </div>
        {working && progress && <Alert><ArrowRightLeft /><AlertTitle>{PROGRESS_LABELS[language][progress]}</AlertTitle><AlertDescription>{rtl ? "العملية مستمرة، وسيُعتمد المزود الجديد بعد نجاح التحقق فقط." : "The operation is still running. The new provider is activated only after verification succeeds."}</AlertDescription></Alert>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={working} onClick={() => onOpenChange(false)}>{rtl ? "إلغاء" : "Cancel"}</Button>
          <Button type="submit" disabled={working}>{working ? (rtl ? "جارٍ الترحيل…" : "Migrating…") : (rtl ? "إنشاء نسخة أمان وبدء الترحيل" : "Back up and start migration")}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
