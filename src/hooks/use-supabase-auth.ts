import { useEffect, useState } from "react"
import type { Session } from "@supabase/supabase-js"
import { getSupabaseClient } from "@/lib/supabase/client"

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

  const signIn = async (email: string, password: string): Promise<void> => {
    setError(null)
    const { error: signInError } = await getSupabaseClient().auth.signInWithPassword({ email: email.trim(), password })
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

  return { session, loading, error, signIn, signOut }
}
