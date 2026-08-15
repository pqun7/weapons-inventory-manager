import { useEffect, useState, type FormEvent } from "react"
import { CheckCircle2, Cloud, Database, HardDrive, ShieldCheck, Wifi, WifiOff } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/ui/password-input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import type { StorageBootstrapState, StorageSetupProgressStage } from "@/lib/database-provider"
import type { StoreSetupProgressStage, SupabaseEnvironmentStatus } from "@/lib/store-connection"

type Language = "ar" | "en"
type Choice = "sqlite" | "supabase" | null

const STAGE_LABELS: Record<Language, Partial<Record<StorageSetupProgressStage | StoreSetupProgressStage, string>>> = {
  ar: {
    validating: "التحقق من البيانات", "creating-directory": "إنشاء مجلد البيانات", "opening-database": "فتح قاعدة SQLite",
    "backing-up": "حماية القاعدة القديمة", migrating: "تنفيذ الترحيلات", "creating-admin": "إنشاء المدير المحلي",
    "checking-integrity": "فحص سلامة البيانات", "testing-read-write": "اختبار القراءة والكتابة", configuring: "تهيئة Supabase",
    "creating-owner": "إنشاء حساب المالك", verifying: "التحقق من المخطط والصلاحيات", saving: "حفظ الاختيار بأمان",
  },
  en: {
    validating: "Validating information", "creating-directory": "Creating the data directory", "opening-database": "Opening SQLite",
    "backing-up": "Protecting the existing database", migrating: "Applying migrations", "creating-admin": "Creating the local administrator",
    "checking-integrity": "Checking data integrity", "testing-read-write": "Testing read and write", configuring: "Configuring Supabase",
    "creating-owner": "Creating the owner account", verifying: "Verifying schema and permissions", saving: "Saving the selection safely",
  },
}

export function FirstRunSetupScreen({ state }: { state: StorageBootstrapState }) {
  const [language, setLanguage] = useState<Language>(() => navigator.language.toLowerCase().startsWith("ar") ? "ar" : "en")
  const [choice, setChoice] = useState<Choice>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState(state.configError ?? "")
  const [stage, setStage] = useState<StorageSetupProgressStage | StoreSetupProgressStage | null>(null)
  const rtl = language === "ar"

  useEffect(() => {
    const removeStorage = window.electronAPI?.storage.onSetupProgress(setStage)
    const removeCloud = window.electronAPI?.storeConnection.onSetupProgress(setStage)
    return () => { removeStorage?.(); removeCloud?.() }
  }, [])

  const run = async (operation: () => Promise<void>) => {
    if (working) return
    setWorking(true)
    setError("")
    try { await operation() }
    catch (caught) { setError(caught instanceof Error ? caught.message : rtl ? "تعذر إكمال الإعداد" : "Setup could not be completed") }
    finally { setWorking(false); setStage(null) }
  }

  return (
    <main className="min-h-screen bg-muted/30 p-4 sm:p-8" dir={rtl ? "rtl" : "ltr"} lang={language}>
      <div className="mx-auto grid max-w-5xl gap-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{rtl ? "إعداد التخزين لأول مرة" : "First-run storage setup"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{rtl ? "اختر مكان حفظ بيانات المتجر. لن يبدأ أي مزود قبل نجاح الإعداد." : "Choose where store data is kept. No provider starts until setup succeeds."}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setLanguage((current) => current === "ar" ? "en" : "ar")}>{rtl ? "English" : "العربية"}</Button>
        </div>

        {error && <Alert variant="destructive"><ShieldCheck /><AlertTitle>{rtl ? "لم يكتمل الإعداد" : "Setup was not completed"}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {working && stage && <Alert><Database /><AlertTitle>{STAGE_LABELS[language][stage] ?? stage}</AlertTitle><AlertDescription>{rtl ? "لا تغلق التطبيق أثناء هذه الخطوة." : "Do not close the application during this step."}</AlertDescription></Alert>}

        {!choice && (
          <div className="grid gap-4 md:grid-cols-2">
            <ProviderCard
              icon={<HardDrive className="size-7" />}
              title={rtl ? "التخزين المحلي — SQLite" : "Local storage — SQLite"}
              description={rtl ? "يعمل على هذا الجهاز دون إنترنت، ومناسب لجهاز واحد." : "Works on this device without internet and is suitable for one computer."}
              items={rtl ? ["لا يحتاج اتصالًا بالإنترنت", "لا يتزامن تلقائيًا مع الأجهزة الأخرى", "يجب الاحتفاظ بنسخ احتياطية"] : ["No internet connection required", "Does not automatically sync to other devices", "Regular backups are required"]}
              badge={state.legacySqliteDatabaseFound ? (rtl ? "تم العثور على بيانات SQLite سابقة وستُحفظ" : "Existing SQLite data found and will be preserved") : undefined}
              action={rtl ? "استخدام SQLite" : "Use SQLite"}
              onClick={() => setChoice("sqlite")}
            />
            <ProviderCard
              icon={<Cloud className="size-7" />}
              title={rtl ? "التخزين السحابي — Supabase" : "Cloud storage — Supabase"}
              description={rtl ? "قاعدة مركزية مشتركة مناسبة للوصول من أكثر من جهاز." : "A central shared database suitable for access from multiple devices."}
              items={rtl ? ["يحتاج إلى اتصال بالإنترنت", "يدعم المشاركة والمزامنة", "يحتاج إلى متجر Supabase مجهز أو كود متجر"] : ["Requires an internet connection", "Supports sharing and synchronization", "Requires a prepared Supabase store or store code"]}
              badge={state.supabaseConnectionFound ? (rtl ? "يوجد اتصال Supabase محفوظ يمكن التحقق منه" : "A saved Supabase connection can be verified") : undefined}
              action={rtl ? "استخدام Supabase" : "Use Supabase"}
              onClick={() => setChoice("supabase")}
            />
          </div>
        )}

        {choice === "sqlite" && <SqliteSetup language={language} working={working} legacyFound={state.legacySqliteDatabaseFound} onBack={() => setChoice(null)} onRun={run} />}
        {choice === "supabase" && <SupabaseSetup language={language} working={working} connectionFound={state.supabaseConnectionFound} onBack={() => setChoice(null)} onRun={run} />}
      </div>
    </main>
  )
}

function ProviderCard({ icon, title, description, items, badge, action, onClick }: { icon: React.ReactNode; title: string; description: string; items: string[]; badge?: string; action: string; onClick: () => void }) {
  return <Card className="flex h-full flex-col"><CardHeader><div className="mb-2 text-primary">{icon}</div><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="flex flex-1 flex-col gap-4"><ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">{items.map((item) => <li key={item}>{item}</li>)}</ul>{badge && <Alert className="border-emerald-600/30 bg-emerald-500/5"><CheckCircle2 className="text-emerald-600" /><AlertDescription>{badge}</AlertDescription></Alert>}<Button className="mt-auto" onClick={onClick}>{action}</Button></CardContent></Card>
}

function SqliteSetup({ language, working, legacyFound, onBack, onRun }: { language: Language; working: boolean; legacyFound: boolean; onBack: () => void; onRun: (operation: () => Promise<void>) => void }) {
  const rtl = language === "ar"
  const [storeName, setStoreName] = useState("")
  const [adminName, setAdminName] = useState("")
  const [adminUsername, setAdminUsername] = useState("admin")
  const [adminPassword, setAdminPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onRun(async () => {
      if (adminPassword !== confirmation) throw new Error(rtl ? "كلمتا المرور غير متطابقتين" : "Passwords do not match")
      const response = await window.electronAPI?.storage.setupSqlite({ storeName, adminName, adminUsername, adminPassword })
      if (!response?.success) throw new Error(response?.error ?? "SQLite setup failed")
      window.location.reload()
    })
  }
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><HardDrive className="size-5" />{rtl ? "تهيئة SQLite المحلية" : "Configure local SQLite"}</CardTitle><CardDescription>{legacyFound ? (rtl ? "ستُفتح القاعدة السابقة في مكانها، وستُنشأ نسخة احتياطية قبل أي ترحيل مطلوب." : "The existing database will be opened in place and backed up before required migrations.") : (rtl ? "ستُنشأ القاعدة داخل مجلد بيانات التطبيق، وليس داخل مجلد التثبيت." : "The database will be created in the application data directory, not the installation folder.")}</CardDescription></CardHeader><CardContent><form className="grid gap-4" onSubmit={submit}><Field label={rtl ? "اسم المتجر" : "Store name"}><Input required maxLength={120} value={storeName} onChange={(event) => setStoreName(event.target.value)} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label={rtl ? "اسم المدير" : "Administrator name"}><Input required maxLength={120} placeholder={rtl ? "احمد" : "Ahmed"} value={adminName} onChange={(event) => setAdminName(event.target.value)} /></Field><Field label={rtl ? "اسم حساب المدير" : "Administrator account"}><Input required dir="ltr" maxLength={80} value={adminUsername} onChange={(event) => setAdminUsername(event.target.value)} /></Field><Field label={rtl ? "كلمة المرور" : "Password"}><PasswordInput required autoComplete="new-password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} /></Field><Field label={rtl ? "تأكيد كلمة المرور" : "Confirm password"}><PasswordInput required autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></Field></div><p className="text-xs text-muted-foreground">{rtl ? "8 أحرف على الأقل، مع حرف كبير وصغير ورقم. تُحفظ مشتقة مشفرة ولا تُحفظ كلمة المرور نفسها." : "Use at least 8 characters with upper-case, lower-case, and a number. Only a hardened hash is stored."}</p><div className="flex gap-2"><Button type="button" variant="outline" disabled={working} onClick={onBack}>{rtl ? "رجوع" : "Back"}</Button><Button disabled={working}>{rtl ? "تهيئة واختبار SQLite" : "Initialize and test SQLite"}</Button></div></form></CardContent></Card>
}

function SupabaseSetup({ language, working, connectionFound, onBack, onRun }: { language: Language; working: boolean; connectionFound: boolean; onBack: () => void; onRun: (operation: () => Promise<void>) => void }) {
  const rtl = language === "ar"
  const [status, setStatus] = useState<SupabaseEnvironmentStatus | null>(null)
  const [connectionCode, setConnectionCode] = useState("")
  const [storeName, setStoreName] = useState("")
  const [ownerName, setOwnerName] = useState("")
  const [ownerEmail, setOwnerEmail] = useState("")
  const [ownerPassword, setOwnerPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  useEffect(() => { void window.electronAPI?.storeConnection.environmentStatus().then((response) => setStatus(response.data ?? { available: false, missing: [] })) }, [])
  const activateExisting = () => onRun(async () => { const response = await window.electronAPI?.storage.activateSupabase(); if (!response?.success) throw new Error(response?.error ?? "Supabase verification failed"); window.location.reload() })
  const join = (event: FormEvent) => { event.preventDefault(); onRun(async () => { const response = await window.electronAPI?.storeConnection.join({ connectionCode }); if (!response?.success) throw new Error(response?.error ?? "Could not join the store"); window.location.reload() }) }
  const create = (event: FormEvent) => { event.preventDefault(); onRun(async () => { if (ownerPassword !== confirmation) throw new Error(rtl ? "كلمتا المرور غير متطابقتين" : "Passwords do not match"); const response = await window.electronAPI?.storeConnection.initialize({ storeName, ownerName, ownerEmail, ownerPassword }); if (!response?.success) throw new Error(response?.error ?? "Supabase setup failed"); window.location.reload() }) }
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Cloud className="size-5" />{rtl ? "إعداد Supabase" : "Configure Supabase"}</CardTitle><CardDescription>{rtl ? "لن تُرسل مفاتيح إدارية إلى Renderer. إنشاء مشروع جديد يستخدم إعدادات الخادم غير العامة من بيئة Main Process فقط." : "Administrative keys are never sent to the renderer. New-project provisioning uses non-public Main Process environment values only."}</CardDescription></CardHeader><CardContent className="grid gap-4"><Button type="button" variant="outline" className="w-fit" onClick={onBack} disabled={working}>{rtl ? "رجوع لاختيار المزود" : "Back to provider selection"}</Button>{connectionFound && <Alert className="border-emerald-600/30 bg-emerald-500/5"><Wifi className="text-emerald-600" /><AlertTitle>{rtl ? "اتصال محفوظ" : "Saved connection"}</AlertTitle><AlertDescription className="space-y-2"><p>{rtl ? "يمكن التحقق من اتصال Supabase المحفوظ واعتماده دون حذف أي بيانات محلية." : "Verify and activate the saved Supabase connection without deleting local data."}</p><Button size="sm" disabled={working} onClick={activateExisting}>{rtl ? "تحقق واستخدم الاتصال المحفوظ" : "Verify and use saved connection"}</Button></AlertDescription></Alert>}<Tabs defaultValue="join"><TabsList className="grid w-full grid-cols-2"><TabsTrigger value="join">{rtl ? "الانضمام بكود متجر" : "Join with store code"}</TabsTrigger><TabsTrigger value="create">{rtl ? "إنشاء متجر جديد" : "Create new store"}</TabsTrigger></TabsList><TabsContent value="join"><form className="grid gap-3 pt-3" onSubmit={join}><Field label={rtl ? "كود المتجر" : "Store connection code"}><Textarea required dir="ltr" className="min-h-32 font-mono text-xs" value={connectionCode} onChange={(event) => setConnectionCode(event.target.value)} /></Field><Button disabled={working || !connectionCode.trim()}>{rtl ? "اختبار الاتصال والانضمام" : "Test connection and join"}</Button></form></TabsContent><TabsContent value="create"><form className="grid gap-3 pt-3" onSubmit={create}>{status && !status.available && <Alert variant="destructive"><WifiOff /><AlertTitle>{rtl ? "إعدادات Main Process ناقصة" : "Main Process configuration is incomplete"}</AlertTitle><AlertDescription>{rtl ? `المتغيرات الناقصة: ${status.missing.join("، ")}. يمكن بدلًا من ذلك الانضمام بكود متجر مجهز.` : `Missing values: ${status.missing.join(", ")}. You can instead join a provisioned store.`}</AlertDescription></Alert>}<Field label={rtl ? "اسم المتجر" : "Store name"}><Input required maxLength={120} value={storeName} onChange={(event) => setStoreName(event.target.value)} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label={rtl ? "اسم المالك" : "Owner name"}><Input required placeholder={rtl ? "احمد" : "Ahmed"} value={ownerName} onChange={(event) => setOwnerName(event.target.value)} /></Field><Field label={rtl ? "بريد المالك" : "Owner email"}><Input required type="email" dir="ltr" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} /></Field><Field label={rtl ? "كلمة مرور المالك" : "Owner password"}><PasswordInput required autoComplete="new-password" value={ownerPassword} onChange={(event) => setOwnerPassword(event.target.value)} /></Field><Field label={rtl ? "تأكيد كلمة المرور" : "Confirm password"}><PasswordInput required autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></Field></div><Button disabled={working || status?.available !== true}>{rtl ? "تهيئة Supabase والتحقق" : "Initialize and verify Supabase"}</Button></form></TabsContent></Tabs></CardContent></Card>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-1.5"><Label>{label}</Label>{children}</div>
}
