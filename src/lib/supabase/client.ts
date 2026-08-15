import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "./database.types.js"
import { normalizeSupabaseUrl, validatePublishableKey, type StoreConnectionConfiguration } from "../store-connection.js"

let client: SupabaseClient<Database> | null = null
let runtimeConfiguration: StoreConnectionConfiguration | null = null

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
