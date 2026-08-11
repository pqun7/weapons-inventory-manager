import { useEffect } from "react"
import { getSupabaseClient } from "@/lib/supabase/client"
import { useStore } from "@/lib/store"

const SYNC_TABLES = ["weapons", "accessories", "ammunition", "shipments", "invoices", "payment_records"] as const

export function useSupabaseSync(enabled: boolean): void {
  const refreshFromDb = useStore((state) => state.refreshFromDb)

  useEffect(() => {
    if (!enabled) return
    const client = getSupabaseClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void refreshFromDb().catch((error) => console.error("Supabase synchronization failed:", error))
      }, 300)
    }
    let channel = client.channel("weapon-store-data-sync")
    for (const table of SYNC_TABLES) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, scheduleRefresh)
    }
    channel.subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      void client.removeChannel(channel)
    }
  }, [enabled, refreshFromDb])
}
