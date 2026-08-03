import { useEffect, useState } from "react"
import { useStore } from "@/lib/store"

export function useAppBootstrap() {
  const ready = useStore((s) => s.ready)
  const bootstrap = useStore((s) => s.bootstrap)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ready) {
      bootstrap().catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to initialize database")
      })
    }
  }, [ready, bootstrap])

  return { ready, error }
}
