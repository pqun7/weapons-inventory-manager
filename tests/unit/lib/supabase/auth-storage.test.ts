import { afterEach, describe, expect, it, vi } from "vitest"
import { createSupabaseAuthStorage } from "@/lib/supabase/client"
import type { ElectronAPI } from "@/types/electron-api"

const originalElectronApi = window.electronAPI

function installSecureStorage() {
  const values = new Map<string, string>()
  const authStorage = {
    get: vi.fn(async (key: string) => ({ success: true, data: values.get(key) ?? null })),
    set: vi.fn(async (key: string, value: string) => { values.set(key, value); return { success: true } }),
    remove: vi.fn(async (key: string) => { values.delete(key); return { success: true } }),
  }
  window.electronAPI = { authStorage } as unknown as ElectronAPI
  return { values, authStorage }
}

afterEach(() => {
  window.electronAPI = originalElectronApi
})

describe("Supabase encrypted session storage", () => {
  it("migrates a legacy browser session into OS-protected storage once", async () => {
    const { values, authStorage } = installSecureStorage()
    localStorage.setItem("weapon-store-auth-demo", "legacy-refresh-session")

    const storage = createSupabaseAuthStorage()
    await expect(storage.getItem("weapon-store-auth-demo")).resolves.toBe("legacy-refresh-session")
    expect(values.get("weapon-store-auth-demo")).toBe("legacy-refresh-session")
    expect(localStorage.getItem("weapon-store-auth-demo")).toBeNull()
    expect(authStorage.set).toHaveBeenCalledOnce()
  })

  it("persists refreshes securely and removes the session only on sign-out", async () => {
    const { values, authStorage } = installSecureStorage()
    const storage = createSupabaseAuthStorage()

    await storage.setItem("weapon-store-auth-demo", "refreshed-session")
    await expect(storage.getItem("weapon-store-auth-demo")).resolves.toBe("refreshed-session")
    expect(localStorage.getItem("weapon-store-auth-demo")).toBeNull()

    await storage.removeItem("weapon-store-auth-demo")
    expect(values.has("weapon-store-auth-demo")).toBe(false)
    expect(authStorage.remove).toHaveBeenCalledWith("weapon-store-auth-demo")
  })
})
