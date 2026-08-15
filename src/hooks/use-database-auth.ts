import { useEffect, useState } from "react"
import type { Session } from "@supabase/supabase-js"
import { getDatabaseProvider } from "@/lib/database-runtime"
import { getSupabaseClient } from "@/lib/supabase/client"
import type { LocalSession } from "@/lib/database-provider"

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

export async function signOutActiveDatabase(): Promise<void> {
  if (getDatabaseProvider() === "sqlite") {
    const response = await window.electronAPI?.localAuth.signOut()
    if (!response?.success) throw new Error(response?.error ?? "Local sign-out failed")
    return
  }
  const { error } = await getSupabaseClient().auth.signOut()
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

  const signOut = async (): Promise<void> => {
    await signOutActiveDatabase()
    setSession(null)
  }

  return { session, loading, error, resolveAccount, signIn, completeFirstLogin, signOut }
}
