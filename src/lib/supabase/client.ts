import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "./database.types.js"

let client: SupabaseClient<Database> | null = null

function requiredEnvironmentValue(value: string | undefined, name: "VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY"): string {
  value = value?.trim()
  if (!value) throw new Error(`${name} is required. Copy .env.example to .env.local and configure Supabase.`)
  return value
}

export function getSupabaseClient(): SupabaseClient<Database> {
  if (client) return client
  client = createClient<Database>(
    requiredEnvironmentValue(import.meta.env.VITE_SUPABASE_URL, "VITE_SUPABASE_URL"),
    requiredEnvironmentValue(import.meta.env.VITE_SUPABASE_ANON_KEY, "VITE_SUPABASE_ANON_KEY"),
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "weapon-store-auth",
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
}
