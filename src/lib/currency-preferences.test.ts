import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useStore } from "@/lib/store"

describe("display currency user preference", () => {
  const originalState = useStore.getState()

  beforeEach(() => {
    useStore.setState({
      currentUserId: "U001",
      userPreferences: null,
      settings: {
        ...originalState.settings,
        currencyCode: "USD",
        preferredDisplayCurrency: "SDG",
      },
    })
  })

  afterEach(() => {
    useStore.setState(originalState, true)
    delete (window as typeof window & { electronAPI?: unknown }).electronAPI
    vi.restoreAllMocks()
  })

  it("persists the header selection as the current user's display preference", async () => {
    const upsert = vi.fn().mockResolvedValue({ success: true, data: {} })
    ;(window as typeof window & { electronAPI?: unknown }).electronAPI = {
      userPreferences: { upsert },
    }

    const result = await useStore.getState().updateUserPreferences({ displayCurrency: "SAR" })

    expect(result).toEqual({ success: true })
    expect(useStore.getState().userPreferences).toMatchObject({
      userId: "U001",
      displayCurrency: "SAR",
      reportViewMode: "display",
    })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ displayCurrency: "SAR" }))
  })

  it("rolls back the visible preference when persistence fails", async () => {
    const previous = { userId: "U001", displayCurrency: "SDG", reportViewMode: "display" as const }
    useStore.setState({ userPreferences: previous })
    ;(window as typeof window & { electronAPI?: unknown }).electronAPI = {
      userPreferences: { upsert: vi.fn().mockResolvedValue({ success: false, error: "write failed" }) },
    }

    const result = await useStore.getState().updateUserPreferences({ displayCurrency: "USD" })

    expect(result.success).toBe(false)
    expect(useStore.getState().userPreferences).toEqual(previous)
  })
})
