import electron from "electron"
import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"
import { Client } from "pg"
import {
  REQUIRED_SCHEMA_VERSION,
  createStoreConnectionCode,
  normalizeSupabaseUrl,
  parseStoreConnectionCode,
  stripPostgresSslQueryOptions,
  validatePublishableKey,
  type InitializeStoreInput,
  type InitializeStoreFromEnvironmentInput,
  type SupabaseEnvironmentStatus,
  type StoreConnectionConfiguration,
  type StoreInstallationInfo,
  type StoreSetupProgressStage,
  type StoreSetupResult,
} from "../../src/lib/store-connection.js"

const CONFIG_FILENAME = "store-connection.json"
const electronApp = electron.app
const electronSafeStorage = electron.safeStorage
const MIGRATION_LOCK_ID = "armory-store-schema-migrations"
const SETUP_LOCK_ID = "armory-store-initial-setup"
const REAPPLY_SAFE_MIGRATION_VERSIONS = new Set(["20260813000700"])
const DATABASE_CONNECTION_TIMEOUT_MS = 90_000
const DATABASE_QUERY_TIMEOUT_MS = 300_000
const STORE_VERIFICATION_TIMEOUT_MS = 45_000

// Supabase Postgres endpoints are signed by this private CA, which is not part
// of the operating-system trust store. Pinning the provider CA keeps hostname
// and certificate verification enabled instead of falling back to insecure TLS.
// Source: Supabase Database Settings -> SSL Configuration (prod-ca-2021.crt).
export const SUPABASE_DATABASE_CA_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`

interface StoredConfigurationEnvelope {
  format: "encrypted-v1" | "plain-v1"
  data: string
}

function decodeJwtRole(value: string): string | null {
  const segments = value.split(".")
  if (segments.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8")) as Record<string, unknown>
    return typeof payload.role === "string" ? payload.role : null
  } catch {
    return null
  }
}

function validateServerKey(value: string): string {
  const key = value.trim()
  if (key.startsWith("sb_secret_") && key.length >= 20) return key
  if (decodeJwtRole(key) === "service_role") return key
  if (key.startsWith("sb_publishable_") || decodeJwtRole(key) === "anon") {
    throw new Error("Use the Supabase secret key or legacy service_role key for one-time setup")
  }
  throw new Error("The Supabase server key is invalid")
}

function validateDatabaseUrl(value: string, projectRef: string): string {
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new Error("The PostgreSQL connection string is invalid")
  }
  const sslMode = parsed.searchParams.get("sslmode")
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || parsed.port !== "5432"
    || parsed.pathname !== "/postgres"
    || !parsed.username
    || !parsed.password
    || (sslMode !== null && sslMode !== "require" && sslMode !== "verify-full")) {
    throw new Error("Use a Supabase direct or session-pooler connection string on port 5432")
  }
  const directHost = `db.${projectRef}.supabase.co`
  const sessionPooler = parsed.hostname.endsWith(".pooler.supabase.com")
    && decodeURIComponent(parsed.username).toLowerCase() === `postgres.${projectRef}`
  if (parsed.hostname.toLowerCase() !== directHost || decodeURIComponent(parsed.username) !== "postgres") {
    if (!sessionPooler) throw new Error("The database connection string does not belong to the selected Supabase project")
  }
  // TLS is configured explicitly in connectDatabase. node-postgres replaces an
  // explicit CA object when SSL query parameters remain in the connection URL.
  return stripPostgresSslQueryOptions(parsed.toString())
}

function normalizeSetupInput(input: InitializeStoreInput): InitializeStoreInput {
  const supabaseUrl = normalizeSupabaseUrl(input.supabaseUrl)
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0]
  const storeName = input.storeName.trim().replace(/\s+/g, " ")
  const ownerName = input.ownerName.trim().replace(/\s+/g, " ")
  const ownerEmail = input.ownerEmail.trim().toLowerCase()
  if (!storeName || storeName.length > 120) throw new Error("Store name is required and must be at most 120 characters")
  if (!ownerName || ownerName.length > 120) throw new Error("Owner name is required and must be at most 120 characters")
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new Error("Enter a valid owner email address")
  if (input.ownerPassword.length < 8
    || !/[a-z]/.test(input.ownerPassword)
    || !/[A-Z]/.test(input.ownerPassword)
    || !/\d/.test(input.ownerPassword)) {
    throw new Error("Use at least 8 characters with upper-case, lower-case, and a number")
  }
  return {
    storeName,
    ownerName,
    ownerEmail,
    ownerPassword: input.ownerPassword,
    supabaseUrl,
    publishableKey: validatePublishableKey(input.publishableKey),
    serverKey: validateServerKey(input.serverKey),
    databaseUrl: validateDatabaseUrl(input.databaseUrl, projectRef),
  }
}

function sanitizedError(error: unknown): Error {
  let message = error instanceof Error ? error.message : "Store setup failed"
  message = message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[database connection hidden]")
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[Supabase key hidden]")
    .replace(/eyJ[A-Za-z0-9._-]{40,}/g, "[JWT hidden]")
  return new Error(message.slice(0, 500))
}

function migrationBody(sql: string): string {
  return sql
    .replace(/^\s*begin\s*;/i, "")
    .replace(/commit\s*;\s*$/i, "")
}

function resolveMigrationsDirectory(): string {
  const candidates = [
    path.join(electronApp.getAppPath(), "supabase", "migrations"),
    path.resolve(process.cwd(), "supabase", "migrations"),
  ]
  const match = candidates.find((candidate) => fs.existsSync(candidate))
  if (!match) throw new Error("The packaged Supabase migration bundle is missing")
  return match
}

async function connectDatabase(databaseUrl: string): Promise<Client> {
  const client = new Client({
    connectionString: stripPostgresSslQueryOptions(databaseUrl),
    ssl: {
      ca: SUPABASE_DATABASE_CA_CERTIFICATE,
      rejectUnauthorized: true,
    },
    connectionTimeoutMillis: DATABASE_CONNECTION_TIMEOUT_MS,
    query_timeout: DATABASE_QUERY_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    application_name: "armory-store-setup",
  })
  await client.connect()
  return client
}

async function applyMigrations(databaseUrl: string): Promise<void> {
  const migrationsDirectory = resolveMigrationsDirectory()
  const files = fs.readdirSync(migrationsDirectory)
    .filter((filename) => /^\d+_.+\.sql$/.test(filename))
    .sort()
  if (!files.length) throw new Error("No Supabase migrations were packaged with the application")

  const client = await connectDatabase(databaseUrl)
  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [MIGRATION_LOCK_ID])
    await client.query("create schema if not exists supabase_migrations")
    await client.query(
      "create table if not exists supabase_migrations.schema_migrations ("
      + "version text primary key, statements text[] not null default '{}', name text)",
    )
    for (const filename of files) {
      const version = filename.split("_", 1)[0]
      const sql = fs.readFileSync(path.join(migrationsDirectory, filename), "utf8")
      const digest = createHash("sha256").update(sql).digest("hex")
      const expectedName = `${filename}:${digest}`
      const existing = await client.query<{ name: string | null }>(
        "select name from supabase_migrations.schema_migrations where version = $1",
        [version],
      )
      if (existing.rowCount) {
        if (existing.rows[0].name !== expectedName) {
          if (!REAPPLY_SAFE_MIGRATION_VERSIONS.has(version)) throw new Error(`Applied migration checksum changed: ${filename}`)
          await client.query("begin")
          try {
            await client.query(migrationBody(sql))
            await client.query("update supabase_migrations.schema_migrations set name = $2 where version = $1", [version, expectedName])
            await client.query("commit")
          } catch (error) {
            await client.query("rollback")
            throw error
          }
        }
        continue
      }
      await client.query("begin")
      try {
        await client.query(migrationBody(sql))
        await client.query(
          "insert into supabase_migrations.schema_migrations(version, statements, name) values ($1, $2, $3)",
          [version, [], expectedName],
        )
        await client.query("commit")
      } catch (error) {
        await client.query("rollback")
        throw error
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock(hashtext($1))", [MIGRATION_LOCK_ID]).catch(() => undefined)
    await client.end().catch(() => undefined)
  }
}

interface ExistingStoreOwner {
  authUserId: string
  loginEmail: string
}

async function existingStoreOwner(input: InitializeStoreInput): Promise<ExistingStoreOwner | null> {
  const client = await connectDatabase(input.databaseUrl)
  try {
    const count = await client.query<{ count: string }>("select count(*)::text as count from public.users")
    if (Number(count.rows[0].count) === 0) return null
    const owners = await client.query<{ auth_user_id: string | null; login_email: string | null; email: string | null }>(
      "select auth_user_id::text, login_email, email from public.users where is_primary_admin and is_active",
    )
    if (owners.rowCount !== 1 || !owners.rows[0].auth_user_id) {
      throw new Error("The existing Supabase store must have exactly one active primary administrator before it can be adopted")
    }
    const loginEmail = (owners.rows[0].login_email || owners.rows[0].email || "").trim().toLowerCase()
    if (!loginEmail || loginEmail !== input.ownerEmail) {
      throw new Error("Use the existing primary administrator email to adopt this Supabase store")
    }
    return { authUserId: owners.rows[0].auth_user_id, loginEmail }
  } finally {
    await client.end().catch(() => undefined)
  }
}

async function verifyExistingOwnerPassword(input: InitializeStoreInput, owner: ExistingStoreOwner): Promise<void> {
  const publicClient = createClient(input.supabaseUrl, input.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const { data, error } = await publicClient.auth.signInWithPassword({ email: owner.loginEmail, password: input.ownerPassword })
  if (error || !data.user || data.user.id !== owner.authUserId) {
    throw new Error("The existing primary administrator email or password is incorrect")
  }
  await publicClient.auth.signOut().catch(() => undefined)
}

async function configureServerCredentials(input: InitializeStoreInput): Promise<void> {
  const client = await connectDatabase(input.databaseUrl)
  try {
    await client.query("begin")
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [SETUP_LOCK_ID])
    for (const [name, secret, description] of [
      ["weapon_store_project_url", input.supabaseUrl, "Armory Store project URL"],
      ["weapon_store_service_role", input.serverKey, "Armory Store Auth administration key"],
    ] as const) {
      await client.query("delete from vault.secrets where name = $1", [name])
      await client.query("select vault.create_secret($1, $2, $3)", [secret, name, description])
    }
    await client.query(
      "update public.app_installation set store_name = $1, schema_version = $2 where singleton",
      [input.storeName, REQUIRED_SCHEMA_VERSION],
    )
    await client.query("update public.system_settings set company_name = $1 where id = 1", [input.storeName])
    await client.query("commit")
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    await client.end().catch(() => undefined)
  }
}

async function completeExistingStoreInstallation(input: InitializeStoreInput): Promise<void> {
  const client = await connectDatabase(input.databaseUrl)
  try {
    await client.query("begin")
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [SETUP_LOCK_ID])
    await client.query(
      "update public.app_installation set store_name = $1, schema_version = $2, setup_completed_at = now() where singleton",
      [input.storeName, REQUIRED_SCHEMA_VERSION],
    )
    await client.query("commit")
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    await client.end().catch(() => undefined)
  }
}

async function createPrimaryOwner(input: InitializeStoreInput): Promise<void> {
  const adminClient = createClient(input.supabaseUrl, input.serverKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "x-application-name": "armory-store-one-time-setup" } },
  })
  const appUserId = `U-${randomUUID()}`
  const { data, error } = await adminClient.auth.admin.createUser({
    email: input.ownerEmail,
    password: input.ownerPassword,
    email_confirm: true,
    user_metadata: {
      app_user_id: appUserId,
      display_name: input.ownerName,
      requires_password_setup: false,
    },
  })
  if (error || !data.user) throw new Error(error?.message ?? "Supabase could not create the owner account")

  const client = await connectDatabase(input.databaseUrl)
  try {
    await client.query("begin")
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [SETUP_LOCK_ID])
    const users = await client.query<{ count: string }>("select count(*)::text as count from public.users")
    if (Number(users.rows[0].count) > 0) throw new Error("This Supabase project was initialized by another setup process")
    await client.query(
      `insert into public.users(
        id, auth_user_id, username, email, login_email, name, role, permissions,
        password_set, activation_token_hash, activation_expires_at, is_active, is_primary_admin
      ) values ($1, $2, $3, $3, $3, $4, 'Admin'::public.app_role, '{}'::jsonb,
        true, null, null, true, true)`,
      [appUserId, data.user.id, input.ownerEmail, input.ownerName],
    )
    await client.query(
      "update public.app_installation set store_name = $1, schema_version = $2, setup_completed_at = now() where singleton",
      [input.storeName, REQUIRED_SCHEMA_VERSION],
    )
    await client.query("commit")
  } catch (profileError) {
    await client.query("rollback").catch(() => undefined)
    const { error: cleanupError } = await adminClient.auth.admin.deleteUser(data.user.id)
    if (cleanupError) {
      throw new Error("Owner profile creation failed; remove the partially created Auth user in Supabase before retrying")
    }
    throw profileError
  } finally {
    await client.end().catch(() => undefined)
  }
}

export async function verifyStoreConnection(
  supabaseUrlValue: string,
  publishableKeyValue: string,
): Promise<StoreConnectionConfiguration> {
  const supabaseUrl = normalizeSupabaseUrl(supabaseUrlValue)
  const publishableKey = validatePublishableKey(publishableKeyValue)
  const headers: Record<string, string> = { apikey: publishableKey, "content-type": "application/json" }
  if (decodeJwtRole(publishableKey) === "anon") headers.Authorization = `Bearer ${publishableKey}`
  let response: Response
  try {
    response = await fetch(`${supabaseUrl}/rest/v1/rpc/armory_installation_info`, {
      method: "POST",
      headers,
      body: "{}",
      signal: AbortSignal.timeout(STORE_VERIFICATION_TIMEOUT_MS),
    })
  } catch {
    throw new Error("Could not reach the Supabase project. Check the URL and internet connection")
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("The publishable key was rejected by this Supabase project")
    throw new Error("This Supabase project does not contain a compatible Armory Store schema")
  }
  const info = await response.json() as Partial<StoreInstallationInfo>
  if (typeof info.storeName !== "string"
    || typeof info.installationId !== "string"
    || typeof info.schemaVersion !== "string"
    || typeof info.initialized !== "boolean") {
    throw new Error("The Supabase project returned invalid installation information")
  }
  if (!info.initialized) throw new Error("The store owner has not completed Supabase setup")
  if (info.schemaVersion !== REQUIRED_SCHEMA_VERSION) {
    throw new Error(`Store schema ${info.schemaVersion} is incompatible with application schema ${REQUIRED_SCHEMA_VERSION}`)
  }
  return {
    supabaseUrl,
    publishableKey,
    storeName: info.storeName,
    installationId: info.installationId,
    schemaVersion: info.schemaVersion,
  }
}

export async function initializeStore(
  rawInput: InitializeStoreInput,
  onProgress: (stage: StoreSetupProgressStage) => void,
): Promise<StoreSetupResult> {
  let currentStage: StoreSetupProgressStage = "validating"
  const reportProgress = (stage: StoreSetupProgressStage) => {
    currentStage = stage
    onProgress(stage)
  }
  try {
    reportProgress("validating")
    const input = normalizeSetupInput(rawInput)
    reportProgress("migrating")
    await applyMigrations(input.databaseUrl)
    const existingOwner = await existingStoreOwner(input)
    if (existingOwner) await verifyExistingOwnerPassword(input, existingOwner)
    reportProgress("configuring")
    await configureServerCredentials(input)
    reportProgress("creating-owner")
    if (existingOwner) await completeExistingStoreInstallation(input)
    else await createPrimaryOwner(input)
    reportProgress("verifying")
    const connection = await verifyStoreConnection(input.supabaseUrl, input.publishableKey)
    reportProgress("saving")
    saveStoredConnection(connection)
    return {
      connection,
      connectionCode: createStoreConnectionCode(connection),
      ownerIdentifier: input.ownerEmail,
    }
  } catch (error) {
    const safeError = sanitizedError(error)
    if (/timeout|timed out/i.test(safeError.message)) {
      throw new Error(`Supabase setup timed out during ${currentStage}. Check the internet connection and try again.`)
    }
    throw safeError
  }
}

function environmentValue(...names: string[]): string {
  for (const name of names) {
    const candidate = process.env[name]?.trim()
    if (candidate) return candidate
  }
  return ""
}

export function supabaseEnvironmentStatus(): SupabaseEnvironmentStatus {
  const values = {
    supabaseUrl: environmentValue("SUPABASE_URL", "VITE_SUPABASE_URL"),
    publishableKey: environmentValue("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY"),
    serverKey: environmentValue("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
    databaseUrl: environmentValue("SUPABASE_DB_URL"),
  }
  return { available: Object.values(values).every(Boolean), missing: Object.entries(values).filter(([, item]) => !item).map(([name]) => name) }
}

export function initializeStoreFromEnvironment(
  input: InitializeStoreFromEnvironmentInput,
  onProgress: (stage: StoreSetupProgressStage) => void,
): Promise<StoreSetupResult> {
  const status = supabaseEnvironmentStatus()
  if (!status.available) throw new Error(`Supabase provisioning environment is incomplete: ${status.missing.join(", ")}`)
  return initializeStore({
    ...input,
    supabaseUrl: environmentValue("SUPABASE_URL", "VITE_SUPABASE_URL"),
    publishableKey: environmentValue("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY"),
    serverKey: environmentValue("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
    databaseUrl: environmentValue("SUPABASE_DB_URL"),
  }, onProgress)
}

export async function joinStore(connectionCode: string): Promise<StoreConnectionConfiguration> {
  try {
    const decoded = parseStoreConnectionCode(connectionCode)
    const connection = await verifyStoreConnection(decoded.supabaseUrl, decoded.publishableKey)
    saveStoredConnection(connection)
    return connection
  } catch (error) {
    throw sanitizedError(error)
  }
}

function configurationPath(): string {
  return path.join(electronApp.getPath("userData"), CONFIG_FILENAME)
}

function validatedStoredConnection(value: unknown): StoreConnectionConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid stored connection")
  const record = value as Record<string, unknown>
  if (typeof record.storeName !== "string"
    || typeof record.installationId !== "string"
    || typeof record.schemaVersion !== "string"
    || record.schemaVersion !== REQUIRED_SCHEMA_VERSION) {
    throw new Error("Invalid stored connection")
  }
  return {
    supabaseUrl: normalizeSupabaseUrl(String(record.supabaseUrl ?? "")),
    publishableKey: validatePublishableKey(String(record.publishableKey ?? "")),
    storeName: record.storeName,
    installationId: record.installationId,
    schemaVersion: record.schemaVersion,
  }
}

export function readStoredConnection(): StoreConnectionConfiguration | null {
  const filename = configurationPath()
  const backup = `${filename}.bak`
  if (!fs.existsSync(filename) && fs.existsSync(backup)) {
    try { fs.renameSync(backup, filename) } catch { return null }
  }
  if (!fs.existsSync(filename)) return null
  try {
    const envelope = JSON.parse(fs.readFileSync(filename, "utf8")) as StoredConfigurationEnvelope
    let serialized: string
    if (envelope.format === "encrypted-v1") {
      if (!electronSafeStorage.isEncryptionAvailable()) throw new Error("OS encryption is unavailable")
      serialized = electronSafeStorage.decryptString(Buffer.from(envelope.data, "base64"))
    } else if (envelope.format === "plain-v1") {
      serialized = Buffer.from(envelope.data, "base64").toString("utf8")
    } else {
      throw new Error("Unknown connection storage format")
    }
    return validatedStoredConnection(JSON.parse(serialized))
  } catch {
    return null
  }
}

export function saveStoredConnection(connection: StoreConnectionConfiguration): void {
  const validated = validatedStoredConnection(connection)
  const serialized = JSON.stringify(validated)
  const envelope: StoredConfigurationEnvelope = electronSafeStorage.isEncryptionAvailable()
    ? { format: "encrypted-v1", data: electronSafeStorage.encryptString(serialized).toString("base64") }
    : { format: "plain-v1", data: Buffer.from(serialized).toString("base64") }
  const filename = configurationPath()
  const directory = path.dirname(filename)
  const temporary = path.join(directory, `${CONFIG_FILENAME}.${process.pid}.${Date.now()}.tmp`)
  const backup = `${filename}.bak`
  fs.mkdirSync(directory, { recursive: true })
  let temporaryExists = false
  try {
    const descriptor = fs.openSync(temporary, "wx", 0o600)
    temporaryExists = true
    try {
      fs.writeFileSync(descriptor, JSON.stringify(envelope), "utf8")
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
    if (fs.existsSync(backup)) fs.unlinkSync(backup)
    if (fs.existsSync(filename)) fs.renameSync(filename, backup)
    try {
      fs.renameSync(temporary, filename)
      temporaryExists = false
      if (fs.existsSync(backup)) fs.unlinkSync(backup)
    } catch (error) {
      if (!fs.existsSync(filename) && fs.existsSync(backup)) fs.renameSync(backup, filename)
      throw error
    }
  } finally {
    if (temporaryExists && fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

export function clearStoredConnection(): void {
  const filename = configurationPath()
  if (fs.existsSync(filename)) fs.unlinkSync(filename)
}

export function connectionCodeFor(connection: StoreConnectionConfiguration): string {
  return createStoreConnectionCode(connection)
}
