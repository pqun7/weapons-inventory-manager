import { useEffect, useState } from "react"
import type { Session } from "@supabase/supabase-js"
import { getDatabaseProvider } from "@/lib/database-runtime"
import { getSupabaseClient } from "@/lib/supabase/client"
import type { LocalSession, PasswordRecoveryCompleteInput, PasswordRecoveryRequestResult } from "@/lib/database-provider"

export interface AccountResolution {
  passwordSet: boolean
  loginEmail: string
  displayName: string
}

type DatabaseSession = Session | LocalSession

function parseSupabaseResolution(value: unknown): AccountResolution {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Account lookup returned an invalid response")
  const account = value as Record<string, unknown>
  if (typeof account.passwordSet !== "boolean" || typeof account.loginEmail !== "string" || typeof account.displayName !== "string") {
    throw new Error("Account lookup returned an invalid response")
  }
  return { passwordSet: account.passwordSet, loginEmail: account.loginEmail, displayName: account.displayName }
}

function readLoginEmail(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as Record<string, unknown>).loginEmail !== "string") {
    throw new Error("Password setup returned an invalid response")
  }
  return String((value as Record<string, unknown>).loginEmail)
}

function parseRecoveryRequest(value: unknown): PasswordRecoveryRequestResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Password recovery returned an invalid response")
  const record = value as Record<string, unknown>
  if (typeof record.requestId !== "string" || (record.channel !== "admin_approval" && record.channel !== "email")) {
    throw new Error("Password recovery returned an invalid response")
  }
  return {
    requestId: record.requestId,
    channel: record.channel,
    destinationHint: typeof record.destinationHint === "string" ? record.destinationHint : undefined,
    recoveryEmail: typeof record.recoveryEmail === "string" ? record.recoveryEmail : undefined,
  }
}

export async function signOutActiveDatabase(options?: { localOnly?: boolean }): Promise<void> {
  if (getDatabaseProvider() === "sqlite") {
    const response = await window.electronAPI?.localAuth.signOut()
    if (!response?.success) throw new Error(response?.error ?? "Local sign-out failed")
    return
  }
  const { error } = await getSupabaseClient().auth.signOut(options?.localOnly ? { scope: "local" } : undefined)
  if (error) throw new Error(error.message)
}

export function useDatabaseAuth() {
  const provider = getDatabaseProvider()
  const [session, setSession] = useState<DatabaseSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (provider === "sqlite") {
      void window.electronAPI?.localAuth.getSession().then((response) => {
        if (!active) return
        if (!response?.success) setError(response?.error ?? "Could not restore the local session")
        setSession(response?.data ?? null)
        setLoading(false)
      })
      return () => { active = false }
    }

    const client = getSupabaseClient()
    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) setError(sessionError.message)
      setSession(data.session)
      setLoading(false)
    })
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      setError(null)
      setLoading(false)
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [provider])

  const resolveAccount = async (identifier: string): Promise<AccountResolution> => {
    setError(null)
    if (provider === "sqlite") {
      const response = await window.electronAPI?.localAuth.resolve({ identifier })
      if (!response?.success || !response.data) throw new Error(response?.error ?? "Account lookup failed")
      return { passwordSet: !response.data.requiresActivation, loginEmail: response.data.identifier, displayName: response.data.displayName }
    }
    const { data, error: invokeError } = await getSupabaseClient().rpc("resolve_account", { p_identifier: identifier.trim() })
    if (invokeError) throw new Error(invokeError.message)
    return parseSupabaseResolution(data)
  }

  const signIn = async (identifier: string, password: string): Promise<void> => {
    setError(null)
    try {
      if (provider === "sqlite") {
        const response = await window.electronAPI?.localAuth.signIn({ identifier, password })
        if (!response?.success || !response.data) throw new Error(response?.error ?? "Sign-in failed")
        setSession(response.data)
        return
      }
      const account = await resolveAccount(identifier)
      if (!account.passwordSet) throw new Error("Complete first-login password setup before signing in")
      const { data, error: signInError } = await getSupabaseClient().auth.signInWithPassword({ email: account.loginEmail, password })
      if (signInError || !data.session) throw new Error(signInError?.message ?? "Sign-in failed")
      setSession(data.session)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Sign-in failed"
      setError(message)
      throw caught
    }
  }

  const completeFirstLogin = async (identifier: string, activationCode: string, password: string): Promise<void> => {
    setError(null)
    try {
      if (provider === "sqlite") {
        const response = await window.electronAPI?.localAuth.claim({ identifier, activationCode, password })
        if (!response?.success || !response.data) throw new Error(response?.error ?? "Password setup failed")
        setSession(response.data)
        return
      }
      const { data, error: invokeError } = await getSupabaseClient().rpc("claim_account", {
        p_identifier: identifier.trim(), p_activation_code: activationCode.trim(), p_password: password,
      })
      if (invokeError) throw new Error(invokeError.message)
      const loginEmail = readLoginEmail(data)
      const { data: signInData, error: signInError } = await getSupabaseClient().auth.signInWithPassword({ email: loginEmail, password })
      if (signInError || !signInData.session) throw new Error(signInError?.message ?? "Sign-in failed")
      setSession(signInData.session)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Password setup failed"
      setError(message)
      throw caught
    }
  }

  const requestPasswordRecovery = async (identifier: string): Promise<PasswordRecoveryRequestResult> => {
    setError(null)
    if (provider === "sqlite") {
      const response = await window.electronAPI?.passwordRecovery.request({ identifier })
      if (!response?.success || !response.data) throw new Error(response?.error ?? "Password recovery request failed")
      return response.data
    }
    const client = getSupabaseClient()
    const { data, error: requestError } = await client.rpc("request_password_recovery", { p_identifier: identifier.trim() })
    if (requestError) throw new Error(requestError.message)
    const recovery = parseRecoveryRequest(data)
    if (recovery.channel === "email") {
      if (!recovery.recoveryEmail) throw new Error("The administrator recovery email is not configured")
      const { error: emailError } = await client.auth.resetPasswordForEmail(recovery.recoveryEmail)
      if (emailError) throw new Error(emailError.message)
    }
    return recovery
  }

  const completePasswordRecovery = async (input: PasswordRecoveryCompleteInput): Promise<void> => {
    setError(null)
    if (provider === "sqlite") {
      const response = await window.electronAPI?.passwordRecovery.complete(input)
      if (!response?.success || !response.data) throw new Error(response?.error ?? "Password recovery failed")
      setSession(response.data)
      return
    }
    const client = getSupabaseClient()
    if (input.channel === "email") {
      if (!input.recoveryEmail) throw new Error("The administrator recovery email is missing")
      const { data: verified, error: verifyError } = await client.auth.verifyOtp({
        email: input.recoveryEmail,
        token: input.code.trim(),
        type: "recovery",
      })
      if (verifyError || !verified.session) throw new Error(verifyError?.message ?? "Recovery code is invalid or expired")
      const { error: updateError } = await client.auth.updateUser({ password: input.password })
      if (updateError) throw new Error(updateError.message)
      setSession(verified.session)
      return
    }
    const { data, error: completeError } = await client.rpc("complete_employee_password_recovery", {
      p_request_id: input.requestId,
      p_identifier: input.identifier.trim(),
      p_code: input.code.trim(),
      p_password: input.password,
    })
    if (completeError) throw new Error(completeError.message)
    if (data && typeof data === "object" && !Array.isArray(data) && "success" in data && data.success === false) {
      throw new Error(typeof data.error === "string" ? data.error : "Recovery code is invalid or expired")
    }
    const loginEmail = readLoginEmail(data)
    const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({ email: loginEmail, password: input.password })
    if (signInError || !signedIn.session) throw new Error(signInError?.message ?? "Sign-in failed")
    setSession(signedIn.session)
  }

  const signOut = async (): Promise<void> => {
    await signOutActiveDatabase()
    setSession(null)
  }

  return { session, loading, error, resolveAccount, signIn, completeFirstLogin, requestPasswordRecovery, completePasswordRecovery, signOut }
}
