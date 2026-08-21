import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "./database.types.js"
import { normalizeSupabaseUrl, validatePublishableKey, type StoreConnectionConfiguration } from "../store-connection.js"

let client: SupabaseClient<Database> | null = null
let runtimeConfiguration: StoreConnectionConfiguration | null = null

type AuthStorage = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

function legacyStorageValue(key: string): string | null {
  try { return globalThis.localStorage?.getItem(key) ?? null }
  catch { return null }
}

function removeLegacyStorageValue(key: string): void {
  try { globalThis.localStorage?.removeItem(key) }
  catch { /* localStorage may be disabled */ }
}

/** Uses OS-encrypted Electron storage and migrates any pre-upgrade browser session once. */
export function createSupabaseAuthStorage(): AuthStorage {
  return {
    async getItem(key) {
      const secureStorage = globalThis.window?.electronAPI?.authStorage
      if (!secureStorage) return legacyStorageValue(key)
      const response = await secureStorage.get(key)
      if (!response.success) throw new Error(response.error ?? "Could not restore the encrypted session")
      if (response.data != null) return response.data

      const legacy = legacyStorageValue(key)
      if (legacy == null) return null
      const migrated = await secureStorage.set(key, legacy)
      if (!migrated.success) throw new Error(migrated.error ?? "Could not protect the saved session")
      removeLegacyStorageValue(key)
      return legacy
    },
    async setItem(key, value) {
      const secureStorage = globalThis.window?.electronAPI?.authStorage
      if (!secureStorage) {
        globalThis.localStorage?.setItem(key, value)
        return
      }
      const response = await secureStorage.set(key, value)
      if (!response.success) throw new Error(response.error ?? "Could not save the encrypted session")
      removeLegacyStorageValue(key)
    },
    async removeItem(key) {
      const secureStorage = globalThis.window?.electronAPI?.authStorage
      if (secureStorage) {
        const response = await secureStorage.remove(key)
        if (!response.success) throw new Error(response.error ?? "Could not remove the encrypted session")
      }
      removeLegacyStorageValue(key)
    },
  }
}

export function bundledSupabaseConfiguration(): StoreConnectionConfiguration | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim()
  if (!url || !key) return null
  const normalizedUrl = normalizeSupabaseUrl(url)
  return {
    supabaseUrl: normalizedUrl,
    publishableKey: validatePublishableKey(key),
    storeName: "Development store",
    installationId: new URL(normalizedUrl).hostname.split(".")[0],
    schemaVersion: "legacy-bundled",
  }
}

export function configureSupabaseClient(configuration: StoreConnectionConfiguration): void {
  const normalized: StoreConnectionConfiguration = {
    ...configuration,
    supabaseUrl: normalizeSupabaseUrl(configuration.supabaseUrl),
    publishableKey: validatePublishableKey(configuration.publishableKey),
  }
  if (runtimeConfiguration
    && (runtimeConfiguration.supabaseUrl !== normalized.supabaseUrl
      || runtimeConfiguration.publishableKey !== normalized.publishableKey)) {
    throw new Error("The Supabase client is already connected to another store")
  }
  runtimeConfiguration = normalized
}

export function configuredSupabaseConnection(): StoreConnectionConfiguration | null {
  return runtimeConfiguration ? { ...runtimeConfiguration } : null
}

export function getSupabaseClient(): SupabaseClient<Database> {
  if (client) return client
  if (!runtimeConfiguration) throw new Error("Connect this device to a store before using Supabase")
  client = createClient<Database>(
    runtimeConfiguration.supabaseUrl,
    runtimeConfiguration.publishableKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: `weapon-store-auth-${runtimeConfiguration.installationId}`,
        storage: createSupabaseAuthStorage(),
      },
      global: {
        headers: { "x-application-name": "weapon-store-desktop" },
      },
    },
  )
  return client
}

export function resetSupabaseClientForTests(): void {
  client = null
  runtimeConfiguration = null
}
