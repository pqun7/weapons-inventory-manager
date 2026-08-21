import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto"
import { getDb } from "../database.js"
import { ensureDemoData } from "./demo-data-service.js"
import type {
  InitializeSqliteInput,
  LocalAccountResolution,
  LocalSession,
} from "../../src/lib/database-provider.js"
import type { UserPermissions } from "../../src/lib/types.js"
import {
  readSecureAuthValue,
  removeSecureAuthValue,
  writeSecureAuthValue,
} from "./secure-auth-storage-service.js"

const PASSWORD_N = 32_768
const PASSWORD_R = 8
const PASSWORD_P = 1
const PASSWORD_KEY_LENGTH = 64
const MAX_FAILED_ATTEMPTS = 5
const LOCK_DURATION_MS = 15 * 60 * 1_000
const ACTIVATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000
const LOCAL_SESSION_STORAGE_KEY = "sqlite-local-session"

const ADMIN_PERMISSIONS: UserPermissions = {
  canImportExcel: true,
  canExportData: true,
  canViewReports: true,
  canManageUsers: true,
  canRegisterPayments: true,
  canVoidInvoices: true,
  canExtendDueDates: true,
  canDeleteRecords: true,
  "inventory.view": true,
  "inventory.edit": true,
  "sales.create": true,
  "customers.manage": true,
  "suppliers.manage": true,
  "currencies.view": true,
  "currencies.edit": true,
  "currencies.add": true,
  "currencies.delete": true,
  "backups.view": true,
  "backups.personal.create": true,
  "backups.personal.restore": true,
  "backups.system.create": true,
  "shipment.import": true,
  "shipment.review": true,
  "shipment.edit": true,
  "shipment.receive": true,
  "shipment.cancel": true,
  "shipment.reschedule": true,
}

interface LocalUserRow {
  id: string
  username: string
  name: string
  role: "Admin" | "Employee"
  password_set: number
  password_hash: string | null
  activation_token_hash: string | null
  activation_expires_at: string | null
  is_active: number
  failed_login_attempts: number
  locked_until: string | null
}

let session: LocalSession | null = null

function sessionTokenHash(token: string): string {
  return createHash("sha256").update(`local-session-v1:${token}`, "utf8").digest("hex")
}

function readStoredSessionToken(): string | null {
  let token: string | null
  try {
    token = readSecureAuthValue(LOCAL_SESSION_STORAGE_KEY)
  } catch {
    return null
  }
  if (!token) return null
  if (/^[A-Za-z0-9_-]{43}$/.test(token)) return token
  try { removeSecureAuthValue(LOCAL_SESSION_STORAGE_KEY) } catch { /* corrupt sessions remain unusable */ }
  return null
}

function normalizedIdentifier(value: string): string {
  const identifier = value.trim().toLocaleLowerCase("en")
  if (!identifier || identifier.length > 160) throw new Error("Enter a valid account identifier")
  return identifier
}

function validatePassword(password: string): void {
  if (password.length < 8 || password.length > 256 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    throw new Error("Use 8 to 256 characters with upper-case, lower-case, and a number")
  }
}

function hashPassword(password: string): string {
  validatePassword(password)
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, PASSWORD_KEY_LENGTH, {
    N: PASSWORD_N,
    r: PASSWORD_R,
    p: PASSWORD_P,
    maxmem: 64 * 1024 * 1024,
  })
  return `scrypt-v1$${PASSWORD_N}$${PASSWORD_R}$${PASSWORD_P}$${salt.toString("base64url")}$${derived.toString("base64url")}`
}

function verifyPassword(password: string, encoded: string | null): boolean {
  if (!encoded?.startsWith("scrypt-v1$")) return false
  const segments = encoded.split("$")
  if (segments.length !== 6) return false
  const n = Number(segments[1])
  const r = Number(segments[2])
  const p = Number(segments[3])
  if (n !== PASSWORD_N || r !== PASSWORD_R || p !== PASSWORD_P) return false
  try {
    const salt = Buffer.from(segments[4], "base64url")
    const expected = Buffer.from(segments[5], "base64url")
    const actual = scryptSync(password, salt, expected.length, { N: n, r, p, maxmem: 64 * 1024 * 1024 })
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

function tokenHash(value: string): string {
  return createHash("sha256").update(value.trim().toUpperCase(), "utf8").digest("hex")
}

function account(identifier: string): LocalUserRow | undefined {
  return getDb().prepare(`
    SELECT id, username, name, role, password_set, password_hash, activation_token_hash,
           activation_expires_at, is_active, failed_login_attempts, locked_until
    FROM users
    WHERE is_active = 1 AND (
      username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE OR login_email = ? COLLATE NOCASE
    )
    LIMIT 1
  `).get(identifier, identifier, identifier) as unknown as LocalUserRow | undefined
}

function toSession(row: LocalUserRow): LocalSession {
  return { userId: row.id, username: row.username, name: row.name, role: row.role }
}

function activeUserById(userId: string): LocalUserRow | undefined {
  return getDb().prepare(`
    SELECT id, username, name, role, password_set, password_hash, activation_token_hash,
           activation_expires_at, is_active, failed_login_attempts, locked_until
    FROM users WHERE id = ? AND is_active = 1 AND password_set = 1
  `).get(userId) as unknown as LocalUserRow | undefined
}

function rememberSession(row: LocalUserRow): LocalSession {
  const database = getDb()
  const previousToken = readStoredSessionToken()
  if (previousToken) database.prepare("DELETE FROM local_auth_sessions WHERE token_hash = ?").run(sessionTokenHash(previousToken))

  const token = randomBytes(32).toString("base64url")
  const tokenHash = sessionTokenHash(token)
  database.prepare("INSERT INTO local_auth_sessions(id, user_id, token_hash) VALUES (?, ?, ?)")
    .run(randomUUID(), row.id, tokenHash)
  try {
    writeSecureAuthValue(LOCAL_SESSION_STORAGE_KEY, token)
  } catch (error) {
    database.prepare("DELETE FROM local_auth_sessions WHERE token_hash = ?").run(tokenHash)
    throw error
  }
  session = toSession(row)
  return session
}

function auditAttempt(identifier: string, succeeded: boolean): void {
  getDb().prepare("INSERT INTO account_auth_attempts(identifier_hash, succeeded) VALUES (?, ?)")
    .run(createHash("sha256").update(identifier).digest("hex"), succeeded ? 1 : 0)
}

export function configureLocalAdministrator(input: InitializeSqliteInput): { userId: string; identifier: string } {
  const storeName = input.storeName.trim().replace(/\s+/g, " ")
  const adminName = input.adminName.trim().replace(/\s+/g, " ")
  const adminUsername = normalizedIdentifier(input.adminUsername)
  if (!storeName || storeName.length > 120) throw new Error("Store name is required and must be at most 120 characters")
  if (!adminName || adminName.length > 120) throw new Error("Administrator name is required and must be at most 120 characters")
  if (!/^[\p{L}\p{N}_.@-]{3,80}$/u.test(adminUsername)) throw new Error("Use 3 to 80 letters, numbers, dots, underscores, @, or hyphens for the account name")
  const passwordHash = hashPassword(input.adminPassword)
  const database = getDb()

  const configured = database.transaction(() => {
    const conflicting = database.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE LIMIT 1").get(adminUsername) as { id: string } | undefined
    const primary = database.prepare("SELECT id FROM users WHERE is_primary_admin = 1 ORDER BY id LIMIT 1").get() as { id: string } | undefined
      ?? database.prepare("SELECT id FROM users WHERE role = 'Admin' ORDER BY id LIMIT 1").get() as { id: string } | undefined
    if (conflicting && primary && conflicting.id !== primary.id) throw new Error("That administrator account name already belongs to another user")

    const userId = primary?.id ?? conflicting?.id ?? `U-${randomUUID()}`
    if (primary || conflicting) {
      database.prepare(`
        UPDATE users SET username = ?, name = ?, role = 'Admin', permissions = ?, password_set = 1,
          password_hash = ?, activation_token_hash = NULL, activation_expires_at = NULL,
          is_active = 1, is_primary_admin = 1, failed_login_attempts = 0, locked_until = NULL,
          updated_at = datetime('now') WHERE id = ?
      `).run(adminUsername, adminName, JSON.stringify(ADMIN_PERMISSIONS), passwordHash, userId)
    } else {
      database.prepare(`
        INSERT INTO users(id, username, name, role, permissions, password_set, password_hash,
          is_active, is_primary_admin, created_at, updated_at)
        VALUES (?, ?, ?, 'Admin', ?, 1, ?, 1, 1, datetime('now'), datetime('now'))
      `).run(userId, adminUsername, adminName, JSON.stringify(ADMIN_PERMISSIONS), passwordHash)
    }
    database.prepare("INSERT OR IGNORE INTO user_preferences(user_id, display_currency, report_view_mode) VALUES (?, 'USD', 'accounting')").run(userId)
    database.prepare("UPDATE app_installation SET store_name = ?, setup_completed_at = datetime('now'), updated_at = datetime('now') WHERE singleton = 1").run(storeName)
    database.prepare("UPDATE system_settings SET company_name = ? WHERE id = 1").run(storeName)
    return { userId, identifier: adminUsername }
  })()
  ensureDemoData(configured.userId)
  return configured
}

export function resolveLocalAccount(rawIdentifier: string): LocalAccountResolution {
  const identifier = normalizedIdentifier(rawIdentifier)
  const row = account(identifier)
  if (!row || row.is_active !== 1) throw new Error("Account not found or inactive")
  return {
    identifier: row.username,
    displayName: row.name,
    requiresActivation: row.password_set !== 1 || !row.password_hash?.startsWith("scrypt-v1$"),
  }
}

export function signInLocal(rawIdentifier: string, password: string): LocalSession {
  const identifier = normalizedIdentifier(rawIdentifier)
  const row = account(identifier)
  if (!row || row.is_active !== 1) {
    auditAttempt(identifier, false)
    throw new Error("Invalid account or password")
  }
  if (row.locked_until && Date.parse(row.locked_until) > Date.now()) throw new Error("Account is temporarily locked after repeated failed attempts")
  if (!verifyPassword(password, row.password_hash)) {
    const attempts = row.failed_login_attempts + 1
    const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_DURATION_MS).toISOString() : null
    getDb().prepare("UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?").run(attempts, lockedUntil, row.id)
    auditAttempt(identifier, false)
    throw new Error("Invalid account or password")
  }
  getDb().prepare("UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?").run(row.id)
  auditAttempt(identifier, true)
  return rememberSession(row)
}

export function claimLocalAccount(rawIdentifier: string, activationCode: string, password: string): LocalSession {
  const identifier = normalizedIdentifier(rawIdentifier)
  validatePassword(password)
  const row = account(identifier)
  if (!row || row.is_active !== 1 || !row.activation_token_hash || !row.activation_expires_at) throw new Error("Activation information is invalid")
  const actual = Buffer.from(tokenHash(activationCode), "hex")
  const expected = Buffer.from(row.activation_token_hash, "hex")
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual) || Date.parse(row.activation_expires_at) <= Date.now()) {
    throw new Error("Activation code is invalid or expired")
  }
  const passwordHash = hashPassword(password)
  getDb().prepare(`
    UPDATE users SET password_hash = ?, password_set = 1, activation_token_hash = NULL,
      activation_expires_at = NULL, failed_login_attempts = 0, locked_until = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(passwordHash, row.id)
  return rememberSession(row)
}

export function createLocalActivationCode(userId: string): string {
  const target = getDb().prepare("SELECT password_set, is_active FROM users WHERE id = ?").get(userId) as { password_set: number; is_active: number } | undefined
  if (!target || target.is_active !== 1) throw new Error("User not found or inactive")
  if (target.password_set === 1) throw new Error("This account already completed password setup")
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const bytes = randomBytes(12)
  const characters = Array.from(bytes, (byte) => alphabet[byte % alphabet.length])
  const code = `${characters.slice(0, 4).join("")}-${characters.slice(4, 8).join("")}-${characters.slice(8, 12).join("")}`
  const result = getDb().prepare(`
    UPDATE users SET activation_token_hash = ?, activation_expires_at = ?, password_set = 0,
      password_hash = '', updated_at = datetime('now') WHERE id = ? AND is_active = 1
  `).run(tokenHash(code), new Date(Date.now() + ACTIVATION_LIFETIME_MS).toISOString(), userId)
  if (Number(result.changes) !== 1) throw new Error("User not found or inactive")
  return code
}

export function getLocalSession(): LocalSession | null {
  if (session) {
    const current = activeUserById(session.userId)
    if (current) {
      session = toSession(current)
      return session
    }
    signOutLocal()
    return null
  }

  const token = readStoredSessionToken()
  if (!token) return null
  const row = getDb().prepare(`
    SELECT u.id, u.username, u.name, u.role, u.password_set, u.password_hash,
           u.activation_token_hash, u.activation_expires_at, u.is_active,
           u.failed_login_attempts, u.locked_until
    FROM local_auth_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND u.is_active = 1 AND u.password_set = 1
    LIMIT 1
  `).get(sessionTokenHash(token)) as unknown as LocalUserRow | undefined
  if (!row) {
    try { removeSecureAuthValue(LOCAL_SESSION_STORAGE_KEY) } catch { /* invalid sessions remain signed out */ }
    return null
  }
  getDb().prepare("UPDATE local_auth_sessions SET last_used_at = datetime('now') WHERE token_hash = ?")
    .run(sessionTokenHash(token))
  session = toSession(row)
  return session
}

export function requireLocalSession(): LocalSession {
  const current = getLocalSession()
  if (!current) throw new Error("Authentication is required")
  return current
}

export function signOutLocal(): void {
  const token = readStoredSessionToken()
  let databaseError: unknown = null
  if (token) {
    try { getDb().prepare("DELETE FROM local_auth_sessions WHERE token_hash = ?").run(sessionTokenHash(token)) }
    catch (error) { databaseError = error }
  }
  try { removeSecureAuthValue(LOCAL_SESSION_STORAGE_KEY) }
  finally { session = null }
  if (databaseError) throw databaseError
}

export function closeLocalAuth(): void {
  session = null
}

export function updateLocalPassword(currentPassword: string, newPassword: string): void {
  const current = requireLocalSession()
  const row = account(current.username)
  if (!row || !verifyPassword(currentPassword, row.password_hash)) throw new Error("Current password is incorrect")
  getDb().prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(hashPassword(newPassword), current.userId)
}

export function resetLocalPasswordWithRecovery(userId: string, newPassword: string): LocalSession {
  const passwordHash = hashPassword(newPassword)
  const row = getDb().prepare(`
    SELECT id, username, name, role, password_set, password_hash, activation_token_hash,
           activation_expires_at, is_active, failed_login_attempts, locked_until
    FROM users WHERE id = ? AND is_active = 1
  `).get(userId) as unknown as LocalUserRow | undefined
  if (!row) throw new Error("Account not found or inactive")
  getDb().prepare(`
    UPDATE users SET password_hash = ?, password_set = 1, failed_login_attempts = 0,
      locked_until = NULL, updated_at = datetime('now') WHERE id = ?
  `).run(passwordHash, userId)
  return rememberSession(row)
}
