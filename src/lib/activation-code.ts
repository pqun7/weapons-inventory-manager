const SUPABASE_DATABASE_CODE = /^[A-F0-9]{12}$/
const LEGACY_SUPABASE_CODE = /^[A-HJ-NP-Z2-9]{12}$/
const SQLITE_CODE = /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/

export function normalizeActivationCode(value: string): string {
  return value.trim().toUpperCase()
}

/**
 * Accepts every activation-code format issued by supported providers:
 * - current PostgreSQL RPCs: 12 hexadecimal characters (including 0 and 1)
 * - legacy Supabase function: 12 ambiguity-free base32 characters
 * - SQLite: the same base32 alphabet grouped as XXXX-XXXX-XXXX
 */
export function isSupportedActivationCode(value: string): boolean {
  const normalized = normalizeActivationCode(value)
  return SUPABASE_DATABASE_CODE.test(normalized)
    || LEGACY_SUPABASE_CODE.test(normalized)
    || SQLITE_CODE.test(normalized)
}
