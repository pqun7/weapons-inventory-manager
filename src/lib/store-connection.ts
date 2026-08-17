export const STORE_CONNECTION_CODE_PREFIX = "ARMORY1."
export const REQUIRED_SCHEMA_VERSION = "20260817000200"

export interface StoreConnectionConfiguration {
  supabaseUrl: string
  publishableKey: string
  storeName: string
  installationId: string
  schemaVersion: string
}

export interface StoreInstallationInfo {
  storeName: string
  installationId: string
  schemaVersion: string
  initialized: boolean
}

export interface InitializeStoreInput {
  storeName: string
  supabaseUrl: string
  publishableKey: string
  serverKey: string
  databaseUrl: string
  ownerName: string
  ownerEmail: string
  ownerPassword: string
  /**
   * Explicit authorization to revoke every Supabase Auth identity in the
   * selected project and replace the Armory Store profiles with one owner.
   * This is intentionally opt-in because it is destructive.
   */
  replaceExistingAccounts?: boolean
}

export interface InitializeStoreFromEnvironmentInput {
  storeName: string
  ownerName: string
  ownerEmail: string
  ownerPassword: string
}

export interface SupabaseEnvironmentStatus {
  available: boolean
  missing: string[]
}

const POSTGRES_SSL_QUERY_PARAMETERS = ["sslmode", "sslcert", "sslkey", "sslrootcert"] as const

/**
 * node-postgres lets TLS query parameters replace an explicitly supplied `ssl`
 * object. Remove those parameters before the main process supplies its pinned
 * Supabase CA so a copied connection string cannot weaken or discard the pin.
 */
export function stripPostgresSslQueryOptions(value: string): string {
  const parsed = new URL(value)
  for (const parameter of POSTGRES_SSL_QUERY_PARAMETERS) parsed.searchParams.delete(parameter)
  return parsed.toString()
}

export interface StoreSetupResult {
  connection: StoreConnectionConfiguration
  connectionCode: string
  ownerIdentifier: string
}

export type StoreSetupProgressStage =
  | "validating"
  | "migrating"
  | "configuring"
  | "replacing-accounts"
  | "creating-owner"
  | "verifying"
  | "saving"

interface ConnectionCodePayload {
  v: 1
  u: string
  k: string
}

function utf8ToBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function base64UrlToUtf8(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid store connection code")
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function jwtRole(value: string): string | null {
  const segments = value.split(".")
  if (segments.length !== 3) return null
  try {
    const payload = JSON.parse(base64UrlToUtf8(segments[1])) as Record<string, unknown>
    return typeof payload.role === "string" ? payload.role : null
  } catch {
    return null
  }
}
export function normalizeSupabaseUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new Error("Enter a valid Supabase project URL")
  }
  if (parsed.protocol !== "https:"
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
    || !/^[a-z0-9]{15,40}\.supabase\.co$/i.test(parsed.hostname)) {
    throw new Error("Use the HTTPS project URL shown by Supabase, without a path or query")
  }
  return `https://${parsed.hostname.toLowerCase()}`
}

export function validatePublishableKey(value: string): string {
  const key = value.trim()
  if (key.startsWith("sb_publishable_") && key.length >= 24) return key
  if (jwtRole(key) === "anon") return key
  if (key.startsWith("sb_secret_") || jwtRole(key) === "service_role") {
    throw new Error("A secret/service-role key cannot be used as the public application key")
  }
  throw new Error("Enter a valid Supabase publishable key (or legacy anon key)")
}

export function createStoreConnectionCode(configuration: Pick<StoreConnectionConfiguration, "supabaseUrl" | "publishableKey">): string {
  const payload: ConnectionCodePayload = {
    v: 1,
    u: normalizeSupabaseUrl(configuration.supabaseUrl),
    k: validatePublishableKey(configuration.publishableKey),
  }
  return `${STORE_CONNECTION_CODE_PREFIX}${utf8ToBase64Url(JSON.stringify(payload))}`
}

export function parseStoreConnectionCode(value: string): Pick<StoreConnectionConfiguration, "supabaseUrl" | "publishableKey"> {
  const compact = value.trim().replace(/\s+/g, "")
  if (!compact.startsWith(STORE_CONNECTION_CODE_PREFIX)) throw new Error("Invalid store connection code")
  try {
    const payload = JSON.parse(base64UrlToUtf8(compact.slice(STORE_CONNECTION_CODE_PREFIX.length))) as Partial<ConnectionCodePayload>
    if (payload.v !== 1 || typeof payload.u !== "string" || typeof payload.k !== "string") {
      throw new Error("Invalid store connection code")
    }
    return {
      supabaseUrl: normalizeSupabaseUrl(payload.u),
      publishableKey: validatePublishableKey(payload.k),
    }
  } catch (error) {
    if (error instanceof Error && /Supabase|secret|publishable/.test(error.message)) throw error
    throw new Error("Invalid or damaged store connection code")
  }
}
