import { useEffect, useState } from "react"
import { useStore } from "@/lib/store"
import { AUTHENTICATED_USER_NOT_LINKED } from "@/lib/db"
import { signOutActiveDatabase } from "@/hooks/use-database-auth"

export function useAppBootstrap(enabled = true) {
  const ready = useStore((s: { ready: boolean }) => s.ready)
  const bootstrap = useStore((s: { bootstrap: () => Promise<void> }) => s.bootstrap)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (enabled && !ready) {
      const perf = typeof performance !== "undefined" ? performance : null
      perf?.mark("boot:hook-bootstrap:request")
      bootstrap().catch(async (e) => {
        if (e instanceof Error && e.message === AUTHENTICATED_USER_NOT_LINKED) {
          await signOutActiveDatabase()
          setError(null)
          return
        }
        setError(e instanceof Error ? e.message : "Failed to initialize database")
      })
    }
  }, [enabled, ready, bootstrap])

  useEffect(() => {
    if (!ready) return
    const perf = typeof performance !== "undefined" ? performance : null
    perf?.mark("boot:ready")
    const navEntry = perf?.getEntriesByType("navigation")?.[0]
    if (navEntry) {
      const toReadyMs = navEntry.duration
      console.info(`[perf] boot:ready navigationDuration=${toReadyMs.toFixed(1)}ms`)
    }
  }, [ready])

  return { ready, error }
}
