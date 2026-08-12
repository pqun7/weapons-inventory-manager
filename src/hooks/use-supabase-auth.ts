import { useEffect, useState } from "react"
import type { Session } from "@supabase/supabase-js"
import { getSupabaseClient } from "@/lib/supabase/client"

export interface AccountResolution {
  passwordSet: boolean
  loginEmail: string
  displayName: string
}

function parseAccountResolution(value: unknown): AccountResolution {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Account lookup returned an invalid response")
  }
  const account = value as Record<string, unknown>
  if (typeof account.passwordSet !== "boolean"
    || typeof account.loginEmail !== "string"
    || typeof account.displayName !== "string") {
    throw new Error("Account lookup returned an invalid response")
  }
  return {
    passwordSet: account.passwordSet,
    loginEmail: account.loginEmail,
    displayName: account.displayName,
  }
}

function readLoginEmail(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Password setup returned an invalid response")
  }
  const loginEmail = (value as Record<string, unknown>).loginEmail
  if (typeof loginEmail !== "string" || !loginEmail) {
    throw new Error("Password setup returned an invalid response")
  }
  return loginEmail
}

export function useSupabaseAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
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
  }, [])

  const resolveAccount = async (identifier: string): Promise<AccountResolution> => {
    setError(null)
    const { data, error: invokeError } = await getSupabaseClient().rpc("resolve_account", {
      p_identifier: identifier.trim(),
    })
    if (invokeError) {
      const message = invokeError.message
      setError(message)
      throw new Error(message)
    }
    return parseAccountResolution(data)
  }

  const signIn = async (identifier: string, password: string): Promise<void> => {
    setError(null)
    const account = await resolveAccount(identifier)
    if (!account.passwordSet) throw new Error("Complete first-login password setup before signing in")
    const { error: signInError } = await getSupabaseClient().auth.signInWithPassword({ email: account.loginEmail, password })
    if (signInError) {
      setError(signInError.message)
      throw new Error(signInError.message)
    }
  }

  const completeFirstLogin = async (identifier: string, activationCode: string, password: string): Promise<void> => {
    setError(null)
    const { data, error: invokeError } = await getSupabaseClient().rpc("claim_account", {
      p_identifier: identifier.trim(),
      p_activation_code: activationCode.trim(),
      p_password: password,
    })
    if (invokeError) {
      const message = invokeError.message
      setError(message)
      throw new Error(message)
    }
    const loginEmail = readLoginEmail(data)
    const { error: signInError } = await getSupabaseClient().auth.signInWithPassword({ email: loginEmail, password })
    if (signInError) {
      setError(signInError.message)
      throw new Error(signInError.message)
    }
  }

  const signOut = async (): Promise<void> => {
    const { error: signOutError } = await getSupabaseClient().auth.signOut()
    if (signOutError) throw new Error(signOutError.message)
    window.location.reload()
  }

  return { session, loading, error, resolveAccount, signIn, completeFirstLogin, signOut }
}
