import { useCallback, useEffect, useRef, useState } from "react"
import { fetchDashboardAnalytics } from "@/lib/dashboard/service"
import type { DashboardAnalytics, DashboardDateRange } from "@/lib/dashboard/types"

const CACHE_TTL_MS = 60_000
const cache = new Map<string, { data: DashboardAnalytics; fetchedAt: number }>()

export function useDashboardAnalytics(range: DashboardDateRange, enabled = true) {
  const key = `${range.start}:${range.end}`
  const requestId = useRef(0)
  const [data, setData] = useState<DashboardAnalytics | null>(() => cache.get(key)?.data ?? null)
  const [loading, setLoading] = useState(() => !cache.has(key))
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (force = false) => {
    if (!enabled) {
      requestId.current += 1
      setLoading(false)
      setRefreshing(false)
      setError(null)
      return
    }
    const cached = cache.get(key)
    if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setData(cached.data)
      setLoading(false)
      setRefreshing(false)
      setError(null)
      return
    }

    const id = ++requestId.current
    if (cached) {
      setData(cached.data)
      setRefreshing(true)
    } else {
      setData(null)
      setLoading(true)
    }
    setError(null)
    try {
      const result = await fetchDashboardAnalytics(range)
      if (id !== requestId.current) return
      cache.set(key, { data: result, fetchedAt: Date.now() })
      setData(result)
    } catch (cause) {
      if (id !== requestId.current) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (id === requestId.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [enabled, key, range])

  useEffect(() => {
    void load()
    return () => { requestId.current += 1 }
  }, [load])

  const refresh = useCallback(() => void load(true), [load])
  return { data, loading, refreshing, error, refresh }
}
