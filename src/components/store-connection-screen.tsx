import { useEffect, useState, type FormEvent } from "react"
import { Building2, CheckCircle2, Database, ExternalLink, KeyRound, Link2, ShieldCheck, Users } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/ui/password-input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import type { InitializeStoreInput, StoreSetupProgressStage, StoreSetupResult } from "@/lib/store-connection"

type Language = "ar" | "en"

const COPY = {
  ar: {
    title: "ربط Armory Store",
    subtitle: "كل متجر يستخدم مشروع Supabase مستقلًا يملكه، ولا يستهلك قاعدة بيانات مطوّر التطبيق.",
    ownerTab: "أنا مالك متجر جديد",
    employeeTab: "الانضمام إلى متجر",
    ownerTitle: "إعداد Supabase مرة واحدة",
    ownerHelp: "أنشئ مشروع Supabase فارغًا، ثم أدخل بياناته هنا. تُستخدم بيانات الإدارة خلال الإعداد فقط ولا تُحفظ على هذا الجهاز.",
    dashboard: "فتح Supabase Dashboard",
    storeName: "اسم المتجر",
    projectUrl: "Project URL",
    publishableKey: "Publishable key (أو anon القديم)",
    serverKey: "Secret key (أو service_role القديم)",
    databaseUrl: "PostgreSQL connection string",
    ownerName: "اسم المالك",
    ownerEmail: "بريد المالك لتسجيل الدخول",
    ownerPassword: "كلمة مرور المالك",
    confirmPassword: "تأكيد كلمة المرور",
    acknowledgement: "أؤكد أن المشروع جديد ومخصص لهذا المتجر، وأنني لن أشارك مفتاح Secret أو رابط قاعدة البيانات مع الموظفين.",
    initialize: "تهيئة المتجر",
    initializing: "جارٍ إعداد المتجر…",
    joinTitle: "ربط هذا الجهاز بمتجر قائم",
    joinHelp: "اطلب من مدير المتجر رمز ربط المتجر. بعد الربط ستستخدم اسم حسابك ورمز التفعيل لمرة واحدة.",
    connectionCode: "رمز ربط المتجر",
    join: "ربط الجهاز",
    joining: "جارٍ التحقق…",
    successTitle: "تم إعداد المتجر بنجاح",
    successHelp: "احفظ رمز الربط وشاركه مع موظفي هذا المتجر فقط. لا يحتوي الرمز على Secret key، لكنه يحدد مشروع المتجر.",
    ownerLogin: "حساب المالك",
    continue: "المتابعة إلى تسجيل الدخول",
    desktopOnly: "تهيئة مشروع جديد متاحة في تطبيق سطح المكتب فقط.",
    passwordMismatch: "كلمتا المرور غير متطابقتين",
    required: "أكمل جميع الحقول المطلوبة ووافق على التنبيه الأمني",
    stages: {
      validating: "التحقق من البيانات",
      migrating: "إنشاء مخطط قاعدة البيانات",
      configuring: "حفظ بيانات الخادم داخل Supabase Vault",
      "creating-owner": "إنشاء حساب المالك الرئيسي",
      verifying: "التحقق من التثبيت",
      saving: "حفظ اتصال هذا الجهاز",
    },
  },
  en: {
    title: "Connect Armory Store",
    subtitle: "Each store uses its own Supabase project and never consumes the application developer's database.",
    ownerTab: "Create a new store",
    employeeTab: "Join an existing store",
    ownerTitle: "One-time Supabase setup",
    ownerHelp: "Create an empty Supabase project, then enter its details here. Administrative credentials are used only during setup and are not stored on this device.",
    dashboard: "Open Supabase Dashboard",
    storeName: "Store name",
    projectUrl: "Project URL",
    publishableKey: "Publishable key (or legacy anon key)",
    serverKey: "Secret key (or legacy service_role key)",
    databaseUrl: "PostgreSQL connection string",
    ownerName: "Owner name",
    ownerEmail: "Owner sign-in email",
    ownerPassword: "Owner password",
    confirmPassword: "Confirm password",
    acknowledgement: "I confirm this is a new project dedicated to this store and I will not share the Secret key or database connection string with employees.",
    initialize: "Initialize store",
    initializing: "Setting up the store…",
    joinTitle: "Connect this device to an existing store",
    joinHelp: "Ask the store administrator for the store connection code. You will then use your account name and one-time activation code.",
    connectionCode: "Store connection code",
    join: "Connect device",
    joining: "Verifying…",
    successTitle: "Store setup completed",
    successHelp: "Save this connection code and share it only with this store's staff. It contains no Secret key, but it identifies the store project.",
    ownerLogin: "Owner account",
    continue: "Continue to sign in",
    desktopOnly: "New-project setup is available only in the desktop application.",
    passwordMismatch: "Passwords do not match",
    required: "Complete all required fields and accept the security acknowledgement",
    stages: {
      validating: "Validating configuration",
      migrating: "Creating the database schema",
      configuring: "Storing server credentials in Supabase Vault",
      "creating-owner": "Creating the primary owner",
      verifying: "Verifying the installation",
      saving: "Saving this device connection",
    },
  },
} as const

const EMPTY_SETUP: InitializeStoreInput = {
  storeName: "",
  supabaseUrl: "",
  publishableKey: "",
  serverKey: "",
  databaseUrl: "",
  ownerName: "",
  ownerEmail: "",
  ownerPassword: "",
}

const PROJECT_URL_EXAMPLE = "https://project-ref.supabase.co"
const DATABASE_URL_EXAMPLE = "postgresql://...:5432/postgres?sslmode=require"

export function StoreConnectionScreen() {
  const [language, setLanguage] = useState<Language>(() => navigator.language.toLowerCase().startsWith("ar") ? "ar" : "en")
  const [setup, setSetup] = useState(EMPTY_SETUP)
  const [confirmation, setConfirmation] = useState("")
  const [acknowledged, setAcknowledged] = useState(false)
  const [connectionCode, setConnectionCode] = useState("")
  const [working, setWorking] = useState(false)
  const [progress, setProgress] = useState<StoreSetupProgressStage | null>(null)
  const [error, setError] = useState("")
  const [result, setResult] = useState<StoreSetupResult | null>(null)
  const t = COPY[language]
  const rtl = language === "ar"
  const desktop = Boolean(window.electronAPI?.storeConnection)

  useEffect(() => window.electronAPI?.storeConnection.onSetupProgress(setProgress), [])

  const update = (field: keyof InitializeStoreInput, value: string) => {
    setSetup((current) => ({ ...current, [field]: value }))
  }

  const initialize = async (event: FormEvent) => {
    event.preventDefault()
    setError("")
    if (!desktop || Object.values(setup).some((value) => !value.trim()) || !acknowledged) {
      setError(t.required)
      return
    }
    if (setup.ownerPassword !== confirmation) {
      setError(t.passwordMismatch)
      return
    }
    setWorking(true)
    setProgress("validating")
    try {
      const response = await window.electronAPI!.storeConnection.initialize(setup)
      if (!response.success || !response.data) throw new Error(response.error ?? "Store setup failed")
      setResult(response.data)
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Store setup failed")
    } finally {
      setWorking(false)
      setProgress(null)
    }
  }

  const join = async (event: FormEvent) => {
    event.preventDefault()
    setError("")
    if (!desktop) return setError(t.desktopOnly)
    setWorking(true)
    try {
      const response = await window.electronAPI!.storeConnection.join({ connectionCode })
      if (!response.success || !response.data) throw new Error(response.error ?? "Could not connect to the store")
      window.location.reload()
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Could not connect to the store")
    } finally {
      setWorking(false)
    }
  }

  if (result) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4" dir={rtl ? "rtl" : "ltr"} lang={language}>
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CheckCircle2 className="size-5 text-emerald-600" />{t.successTitle}</CardTitle>
            <CardDescription>{t.successHelp}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5"><Label>{t.ownerLogin}</Label><Input readOnly value={result.ownerIdentifier} className="bg-muted" /></div>
            <div className="grid gap-1.5"><Label>{t.connectionCode}</Label><Textarea readOnly value={result.connectionCode} className="min-h-28 break-all font-mono text-xs" dir="ltr" /></div>
            <Button onClick={() => window.location.reload()}>{t.continue}</Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-8" dir={rtl ? "rtl" : "ltr"} lang={language}>
      <div className="mx-auto grid max-w-3xl gap-5">
        <div className="flex items-start justify-between gap-4">
          <div><h1 className="flex items-center gap-2 text-2xl font-bold"><Database className="size-6" />{t.title}</h1><p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p></div>
          <Button variant="outline" size="sm" onClick={() => setLanguage((current) => current === "ar" ? "en" : "ar")}>{language === "ar" ? "English" : "العربية"}</Button>
        </div>

        {error && <Alert variant="destructive"><ShieldCheck /><AlertTitle>{rtl ? "تعذر إكمال العملية" : "Operation could not be completed"}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

        <Tabs defaultValue="owner">
          <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="owner"><Building2 />{t.ownerTab}</TabsTrigger><TabsTrigger value="join"><Users />{t.employeeTab}</TabsTrigger></TabsList>
          <TabsContent value="owner">
            <Card>
              <CardHeader><CardTitle>{t.ownerTitle}</CardTitle><CardDescription>{t.ownerHelp}</CardDescription></CardHeader>
              <CardContent>
                <form className="grid gap-4" onSubmit={initialize}>
                  <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline">{t.dashboard}<ExternalLink className="size-3.5" /></a>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t.storeName}><Input required maxLength={120} value={setup.storeName} onChange={(e) => update("storeName", e.target.value)} /></Field>
                    <Field label={t.projectUrl}><Input required dir="ltr" placeholder={PROJECT_URL_EXAMPLE} value={setup.supabaseUrl} onChange={(e) => update("supabaseUrl", e.target.value)} /></Field>
                  </div>
                  <Field label={t.publishableKey}><PasswordInput required dir="ltr" autoComplete="off" value={setup.publishableKey} onChange={(e) => update("publishableKey", e.target.value)} /></Field>
                  <Field label={t.serverKey}><PasswordInput required dir="ltr" autoComplete="off" value={setup.serverKey} onChange={(e) => update("serverKey", e.target.value)} /></Field>
                  <Field label={t.databaseUrl}><PasswordInput required dir="ltr" autoComplete="off" placeholder={DATABASE_URL_EXAMPLE} value={setup.databaseUrl} onChange={(e) => update("databaseUrl", e.target.value)} /></Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t.ownerName}><Input required maxLength={120} value={setup.ownerName} onChange={(e) => update("ownerName", e.target.value)} /></Field>
                    <Field label={t.ownerEmail}><Input required type="email" dir="ltr" autoComplete="username" value={setup.ownerEmail} onChange={(e) => update("ownerEmail", e.target.value)} /></Field>
                    <Field label={t.ownerPassword}><PasswordInput required autoComplete="new-password" value={setup.ownerPassword} onChange={(e) => update("ownerPassword", e.target.value)} /></Field>
                    <Field label={t.confirmPassword}><PasswordInput required autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></Field>
                  </div>
                  <label className="flex items-start gap-2 rounded-md border p-3 text-sm"><Checkbox checked={acknowledged} onCheckedChange={(checked) => setAcknowledged(checked === true)} /><span>{t.acknowledgement}</span></label>
                  {!desktop && <Alert><Database /><AlertTitle>{t.desktopOnly}</AlertTitle></Alert>}
                  {working && progress && <div className="flex items-center gap-2 rounded-md bg-muted p-3 text-sm"><span className="size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />{t.stages[progress]}</div>}
                  <Button disabled={working || !desktop}>{working ? t.initializing : t.initialize}</Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="join">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Link2 className="size-5" />{t.joinTitle}</CardTitle><CardDescription>{t.joinHelp}</CardDescription></CardHeader>
              <CardContent>
                <form className="grid gap-4" onSubmit={join}>
                  <Field label={t.connectionCode}><Textarea required dir="ltr" className="min-h-32 font-mono text-xs" value={connectionCode} onChange={(event) => setConnectionCode(event.target.value)} /></Field>
                  <Button disabled={working || !connectionCode.trim()}><KeyRound className="size-4" />{working ? t.joining : t.join}</Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-1.5"><Label>{label}</Label>{children}</div>
}
