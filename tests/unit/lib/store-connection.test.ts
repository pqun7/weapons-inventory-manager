import { describe, expect, it } from "vitest"
import {
  REQUIRED_SCHEMA_VERSION,
  createStoreConnectionCode,
  normalizeSupabaseUrl,
  parseStoreConnectionCode,
  stripPostgresSslQueryOptions,
  validatePublishableKey,
} from "@/lib/store-connection"

function jwt(role: string): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role })}.signature`
}

describe("store connection codes", () => {
  it("round-trips only the public Supabase connection values", () => {
    const input = {
      supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
      publishableKey: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
    }
    const code = createStoreConnectionCode(input)
    expect(code).toMatch(/^ARMORY1\./)
    expect(code).not.toContain("service_role")
    expect(parseStoreConnectionCode(code)).toEqual(input)
  })

  it("accepts a legacy anon JWT and rejects privileged keys", () => {
    expect(validatePublishableKey(jwt("anon"))).toBe(jwt("anon"))
    expect(() => validatePublishableKey(jwt("service_role"))).toThrow(/cannot be used/)
    expect(() => validatePublishableKey("sb_secret_do-not-share-this-value")).toThrow(/cannot be used/)
  })

  it("rejects non-Supabase and path-bearing URLs", () => {
    expect(normalizeSupabaseUrl("https://abcdefghijklmnopqrst.supabase.co")).toBe("https://abcdefghijklmnopqrst.supabase.co")
    expect(() => normalizeSupabaseUrl("https://example.com")).toThrow(/Supabase/)
    expect(() => normalizeSupabaseUrl("https://abcdefghijklmnopqrst.supabase.co/auth/v1")).toThrow(/without a path/)
  })

  it("keeps the runtime compatibility version aligned with the latest migration", () => {
    expect(REQUIRED_SCHEMA_VERSION).toBe("20260817000100")
  })

  it("prevents PostgreSQL URL options from replacing the pinned TLS configuration", () => {
    const value = stripPostgresSslQueryOptions(
      "postgresql://postgres:password@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=other.crt&application_name=armory",
    )
    const parsed = new URL(value)
    expect(parsed.searchParams.get("sslmode")).toBeNull()
    expect(parsed.searchParams.get("sslrootcert")).toBeNull()
    expect(parsed.searchParams.get("application_name")).toBe("armory")
  })
})
