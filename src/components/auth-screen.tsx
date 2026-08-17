import { useState, type FormEvent } from "react"
import { ArrowLeft, Database, LockKeyhole, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/ui/password-input"
import type { AccountResolution } from "@/hooks/use-database-auth"
import { translations, type Language } from "@/lib/i18n/translations"
import type { PasswordRecoveryCompleteInput, PasswordRecoveryRequestResult } from "@/lib/database-provider"

type AuthScreenProps = {
  lang: Language
  error: string | null
  onResolve: (identifier: string) => Promise<AccountResolution>
  onSignIn: (identifier: string, password: string) => Promise<void>
  onCompleteFirstLogin: (identifier: string, activationCode: string, password: string) => Promise<void>
  onRequestPasswordRecovery: (identifier: string) => Promise<PasswordRecoveryRequestResult>
  onCompletePasswordRecovery: (input: PasswordRecoveryCompleteInput) => Promise<void>
  onReturnToDatabaseSetup: () => Promise<void>
}

type Step = "identify" | "sign-in" | "setup" | "recovery-request" | "recovery-code"

export function AuthScreen({ lang, error, onResolve, onSignIn, onCompleteFirstLogin, onRequestPasswordRecovery, onCompletePasswordRecovery, onReturnToDatabaseSetup }: AuthScreenProps) {
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
  const [recovery, setRecovery] = useState<PasswordRecoveryRequestResult | null>(null)

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
      } else if (step === "setup") {
        if (password !== confirmation) throw new Error(t("auth.passwordsDoNotMatch"))
        if (password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
          throw new Error(t("auth.passwordRequirements"))
        }
        await onCompleteFirstLogin(identifier, activationCode, password)
      } else if (step === "recovery-request") {
        const request = await onRequestPasswordRecovery(identifier)
        setRecovery(request)
        setStep("recovery-code")
      } else if (step === "recovery-code") {
        if (!recovery) throw new Error(t("auth.recoveryRequestMissing"))
        if (password !== confirmation) throw new Error(t("auth.passwordsDoNotMatch"))
        if (password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
          throw new Error(t("auth.passwordRequirements"))
        }
        await onCompletePasswordRecovery({
          requestId: recovery.requestId,
          identifier,
          code: activationCode,
          password,
          channel: recovery.channel,
          recoveryEmail: recovery.recoveryEmail,
        })
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
    setRecovery(null)
    setLocalError(null)
  }
  const returnToDatabaseSetup = async () => {
    if (submitting) return
    setLocalError(null)
    setSubmitting(true)
    try {
      await onReturnToDatabaseSetup()
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : t("auth.failed"))
      setSubmitting(false)
    }
  }

  return (
    <main
      className="relative flex min-h-screen items-center justify-center bg-muted/30 p-4"
      lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
    >
      <Button
        type="button"
        variant="outline"
        className="absolute start-4 top-4 bg-background/90 shadow-sm backdrop-blur"
        disabled={submitting}
        onClick={() => { void returnToDatabaseSetup() }}
      >
        <Database className="size-4" />
        {t("auth.backToDatabaseSetup")}
      </Button>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LockKeyhole className="size-5" />
          </div>
          <CardTitle>{step === "setup" ? t("auth.setPassword") : step.startsWith("recovery") ? t("auth.recoverPassword") : t("app.name")}</CardTitle>
          <CardDescription>
            {step === "identify" && t("auth.enterIdentifier")}
            {step === "sign-in" && t("auth.welcomeBack", { name: displayName || identifier })}
            {step === "setup" && t("auth.completeSetup")}
            {step === "recovery-request" && t("auth.recoveryIdentifierHelp")}
            {step === "recovery-code" && (recovery?.channel === "email"
              ? t("auth.recoveryEmailSent", { destination: recovery.destinationHint ?? t("auth.yourEmail") })
              : t("auth.recoveryAdminApproval"))}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            {(step === "identify" || step === "recovery-request") ? (
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

            {step === "recovery-code" && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                {recovery?.channel === "email" ? t("auth.recoveryEmailCodeHelp") : t("auth.recoveryEmployeeCodeHelp")}
              </div>
            )}

            {(step === "setup" || step === "recovery-code") && (
              <div className="grid gap-1.5">
                <Label htmlFor="auth-activation-code">{step === "setup" ? t("auth.activationCode") : t("auth.recoveryCode")}</Label>
                <Input id="auth-activation-code" required autoComplete="one-time-code" value={activationCode} onChange={(event) => setActivationCode(event.target.value.toUpperCase())} />
                {step === "setup" && <p className="text-xs text-muted-foreground">{t("auth.activationCodeHelp")}</p>}
              </div>
            )}

            {(step === "sign-in" || step === "setup" || step === "recovery-code") && (
              <div className="grid gap-1.5">
                <Label htmlFor="auth-password">{step === "setup" || step === "recovery-code" ? t("auth.newPassword") : t("settings.password")}</Label>
                <PasswordInput id="auth-password" autoComplete={step === "setup" || step === "recovery-code" ? "new-password" : "current-password"} required value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
            )}
            {(step === "setup" || step === "recovery-code") && (
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
              {submitting ? t("auth.pleaseWait") : step === "identify" ? t("auth.continue") : step === "setup" ? t("auth.savePasswordSignIn") : step === "recovery-request" ? t("auth.sendRecoveryRequest") : step === "recovery-code" ? t("auth.resetPasswordSignIn") : t("auth.signIn")}
            </Button>
            {step === "identify" && <Button type="button" variant="link" disabled={submitting} onClick={() => { setLocalError(null); setStep("recovery-request") }}>{t("auth.forgotPassword")}</Button>}
            {(step === "recovery-request" || step === "recovery-code") && <Button type="button" variant="ghost" disabled={submitting} onClick={reset}><ArrowLeft className="size-4" />{t("auth.backToSignIn")}</Button>}
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
