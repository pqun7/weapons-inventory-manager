import { useState, type FormEvent } from "react"
import { ArrowLeft, LockKeyhole, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/ui/password-input"
import type { AccountResolution } from "@/hooks/use-supabase-auth"
import { translations, type Language } from "@/lib/i18n/translations"

type AuthScreenProps = {
  lang: Language
  error: string | null
  onResolve: (identifier: string) => Promise<AccountResolution>
  onSignIn: (identifier: string, password: string) => Promise<void>
  onCompleteFirstLogin: (identifier: string, activationCode: string, password: string) => Promise<void>
}

type Step = "identify" | "sign-in" | "setup"

export function AuthScreen({ lang, error, onResolve, onSignIn, onCompleteFirstLogin }: AuthScreenProps) {
  const t = (key: string, params?: Record<string, string>) => {
    let value = translations[lang][key] ?? translations.en[key] ?? key
    for (const [name, replacement] of Object.entries(params ?? {})) value = value.replaceAll(`{${name}}`, replacement)
    return value
  }
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [activationCode, setActivationCode] = useState("")
  const [step, setStep] = useState<Step>("identify")
  const [displayName, setDisplayName] = useState("")
  const [localError, setLocalError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLocalError(null)
    setSubmitting(true)
    try {
      if (step === "identify") {
        const account = await onResolve(identifier)
        setDisplayName(account.displayName)
        setStep(account.passwordSet ? "sign-in" : "setup")
      } else if (step === "sign-in") {
        await onSignIn(identifier, password)
      } else {
        if (password !== confirmation) throw new Error(t("auth.passwordsDoNotMatch"))
        if (password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
          throw new Error(t("auth.passwordRequirements"))
        }
        await onCompleteFirstLogin(identifier, activationCode, password)
      }
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : t("auth.failed"))
    } finally {
      setSubmitting(false)
    }
  }

  const shownError = localError ?? error
  const networkError = shownError ? /fetch|network|offline|connection|send a request/i.test(shownError) : false
  const reset = () => {
    setStep("identify")
    setPassword("")
    setConfirmation("")
    setActivationCode("")
    setLocalError(null)
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-muted/30 p-4"
      lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
    >
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LockKeyhole className="size-5" />
          </div>
          <CardTitle>{step === "setup" ? t("auth.setPassword") : t("app.name")}</CardTitle>
          <CardDescription>
            {step === "identify" && t("auth.enterIdentifier")}
            {step === "sign-in" && t("auth.welcomeBack", { name: displayName || identifier })}
            {step === "setup" && t("auth.completeSetup")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            {step === "identify" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="auth-identifier">{t("auth.nameOrEmail")}</Label>
                <Input id="auth-identifier" autoComplete="username" required value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-xs">
                <span className="truncate font-medium">{displayName || identifier}</span>
                <Button type="button" variant="ghost" size="sm" className="h-6 px-2" onClick={reset}><ArrowLeft className="size-3" /> {t("auth.change")}</Button>
              </div>
            )}

            {step === "setup" && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-center text-sm font-medium" dir="rtl">
                {t("auth.passwordSavedHelp")}
              </div>
            )}

            {step === "setup" && (
              <div className="grid gap-1.5">
                <Label htmlFor="auth-activation-code">{t("auth.activationCode")}</Label>
                <Input id="auth-activation-code" required autoComplete="one-time-code" value={activationCode} onChange={(event) => setActivationCode(event.target.value.toUpperCase())} />
                <p className="text-xs text-muted-foreground">{t("auth.activationCodeHelp")}</p>
              </div>
            )}

            {step !== "identify" && (
              <div className="grid gap-1.5">
                <Label htmlFor="auth-password">{step === "setup" ? t("auth.newPassword") : t("settings.password")}</Label>
                <PasswordInput id="auth-password" autoComplete={step === "setup" ? "new-password" : "current-password"} required value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
            )}
            {step === "setup" && (
              <div className="grid gap-1.5">
                <Label htmlFor="auth-password-confirmation">{t("auth.confirmPassword")}</Label>
                <PasswordInput id="auth-password-confirmation" autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
              </div>
            )}
            {shownError && (
              <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                {networkError && <WifiOff className="mt-0.5 size-3.5 shrink-0" />}
                <span>{networkError ? t("auth.networkError") : shownError}</span>
              </div>
            )}
            <Button type="submit" disabled={submitting}>
              {submitting ? t("auth.pleaseWait") : step === "identify" ? t("auth.continue") : step === "setup" ? t("auth.savePasswordSignIn") : t("auth.signIn")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
