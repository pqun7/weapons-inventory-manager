import { createHash, randomUUID } from "node:crypto"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  closeDatabase,
  createDatabaseBackup,
  databaseHealthCheck,
  getDb,
  initDatabase,
  restoreDatabaseBackup,
} from "../database.js"
import {
  closeLocalAuth,
  configureLocalAdministrator,
  requireLocalSession,
} from "./local-auth-service.js"
import {
  createStorageConfig,
  readStorageConfig,
  writeStorageConfig,
} from "./storage-config-service.js"
import {
  parseStoreConnectionCode,
  type StoreConnectionConfiguration,
} from "../../src/lib/store-connection.js"
import {
  readStoredConnection,
  saveStoredConnection,
  verifyStoreConnection,
} from "./store-installation-service.js"
import type {
  MigrateSqliteToSupabaseInput,
  MigrateSupabaseToSqliteInput,
  ProviderMigrationProgressStage,
  ProviderMigrationResult,
} from "../../src/lib/database-provider.js"

const PORTABLE_TABLES = [
  "weapon_types", "weapon_subtypes", "calibers", "subtype_calibers", "brands", "models",
  "warehouses", "storage_locations", "currencies", "exchange_rate_history",
  "exchange_rate_overrides", "exchange_rate_audit_log", "users", "suppliers", "customers",
  "shipments", "shipment_imports", "shipment_items", "shipment_documents",
  "shipment_import_items", "shipment_validation_issues", "shipment_item_changes",
  "shipment_status_history", "weapons", "invoices", "payment_records", "accessories",
  "ammunition", "ammunition_weapon_compatibility", "accessory_weapon_compatibility",
  "audit_logs", "system_settings", "saved_filters", "user_preferences", "app_notifications",
  "financial_data_issues", "inventory_transactions", "product_costs", "shipment_costs",
  "shipment_cost_scope_items", "shipment_cost_allocations", "inventory_cost_snapshots",
  "inventory_product_types",
] as const

type PortableTableName = typeof PORTABLE_TABLES[number]
type PortableRow = Record<string, unknown>

interface PortableSnapshot {
  sourceProvider: "sqlite" | "supabase"
  sourceSchema: string
  digest: string
  manifest: Partial<Record<PortableTableName, number>>
  tables: Partial<Record<PortableTableName, PortableRow[]>>
}

interface CloudExportStart {
  backupId: string
  schemaVersion: string
  manifest: Partial<Record<PortableTableName, number>>
}

interface CloudApplyResult {
  migrationId: string
  safetyBackupId: string
  sourcePrimaryUserId: string
}

let providerMigrationInProgress = false

function exclusiveMigration<T>(operation: () => Promise<T>): Promise<T> {
  if (providerMigrationInProgress) return Promise.reject(new Error("A provider migration is already running"))
  providerMigrationInProgress = true
  return operation().finally(() => { providerMigrationInProgress = false })
}

function requireConfiguredProvider(expected: "sqlite" | "supabase") {
  const stored = readStorageConfig()
  if (!stored.config || stored.config.databaseProvider !== expected) {
    throw new Error(`${expected} is not the active source provider`)
  }
  return stored.config
}

function normalizePortableValue(value: unknown): unknown {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "bigint") return value.toString()
  if (Buffer.isBuffer(value)) return `\\x${value.toString("hex")}`
  if (ArrayBuffer.isView(value)) return `\\x${Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("hex")}`
  if (Array.isArray(value)) return value.map(normalizePortableValue)
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalizePortableValue(item)]))
  }
  return String(value)
}

function normalizePortableRows(rows: PortableRow[]): PortableRow[] {
  return rows.map((row) => normalizePortableValue(row) as PortableRow)
}

function snapshotDigest(sourceProvider: "sqlite" | "supabase", sourceSchema: string, tables: PortableSnapshot["tables"]): string {
  const ordered = PORTABLE_TABLES.map((table) => [table, tables[table] ?? null])
  return createHash("sha256").update(JSON.stringify({ sourceProvider, sourceSchema, tables: ordered }), "utf8").digest("hex")
}

function finalizeSnapshot(
  sourceProvider: "sqlite" | "supabase",
  sourceSchema: string,
  tables: PortableSnapshot["tables"],
): PortableSnapshot {
  const manifest: PortableSnapshot["manifest"] = {}
  for (const table of PORTABLE_TABLES) {
    if (tables[table]) manifest[table] = tables[table]?.length ?? 0
  }
  if (manifest.users == null) throw new Error("The provider snapshot does not contain the users table")
  return {
    sourceProvider,
    sourceSchema,
    tables,
    manifest,
    digest: snapshotDigest(sourceProvider, sourceSchema, tables),
  }
}

function exportSqliteSnapshot(): PortableSnapshot {
  const database = getDb()
  const existing = new Set((database.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  ).all() as Array<{ name: string }>).map((row) => row.name))
  const tables: PortableSnapshot["tables"] = {}
  for (const table of PORTABLE_TABLES) {
    if (!existing.has(table)) continue
    tables[table] = normalizePortableRows(database.prepare(`SELECT * FROM ${table}`).all() as PortableRow[])
  }
  const schemaVersion = String(database.pragma("user_version", { simple: true }) ?? "0")
  return finalizeSnapshot("sqlite", schemaVersion, tables)
}

async function temporaryCloudClient(
  connection: Pick<StoreConnectionConfiguration, "supabaseUrl" | "publishableKey">,
  email: string,
  password: string,
): Promise<SupabaseClient> {
  const client = createClient(connection.supabaseUrl, connection.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "x-application-name": "armory-provider-migration" } },
  })
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
  if (error || !data.user) throw new Error("The destination administrator email or password is incorrect")
  return client
}

async function cloudRpc<T>(client: SupabaseClient, name: string, parameters: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(name, parameters)
  if (error) throw new Error(error.message)
  return data as T
}

function chunksFor(rows: PortableRow[]): PortableRow[][] {
  const result: PortableRow[][] = []
  let current: PortableRow[] = []
  let currentBytes = 2
  for (const row of rows) {
    const rowBytes = Buffer.byteLength(JSON.stringify(row), "utf8") + 1
    if (rowBytes > 3_500_000) throw new Error("A provider migration row exceeds the supported transfer size")
    if (current.length >= 400 || (current.length > 0 && currentBytes + rowBytes > 3_500_000)) {
      result.push(current)
      current = []
      currentBytes = 2
    }
    current.push(row)
    currentBytes += rowBytes
  }
  if (current.length) result.push(current)
  return result
}

async function uploadSqliteSnapshot(client: SupabaseClient, snapshot: PortableSnapshot): Promise<CloudApplyResult> {
  const migrationId = await cloudRpc<string>(client, "begin_provider_migration", {
    p_source_provider: "sqlite",
    p_source_schema: snapshot.sourceSchema,
    p_source_digest: snapshot.digest,
    p_manifest: snapshot.manifest,
  })
  for (const table of PORTABLE_TABLES) {
    const rows = snapshot.tables[table]
    if (!rows?.length) continue
    const chunks = chunksFor(rows)
    for (let index = 0; index < chunks.length; index++) {
      await cloudRpc<void>(client, "append_provider_migration_chunk", {
        p_migration_id: migrationId,
        p_table_name: table,
        p_chunk_index: index,
        p_rows: chunks[index],
      })
    }
  }
  return cloudRpc<CloudApplyResult>(client, "apply_provider_migration", { p_migration_id: migrationId })
}

function totalSnapshotRows(snapshot: PortableSnapshot): number {
  return Object.values(snapshot.manifest).reduce((total, count) => total + (count ?? 0), 0)
}

function migratedUserCount(snapshot: PortableSnapshot): number {
  return Math.max(0, (snapshot.manifest.users ?? 0) - 1)
}

function validateConfirmation(value: string): void {
  if (value.trim().toUpperCase() !== "MIGRATE") throw new Error("Type MIGRATE to confirm the provider migration")
}

export function migrateSqliteToSupabase(
  input: MigrateSqliteToSupabaseInput,
  onProgress: (stage: ProviderMigrationProgressStage) => void,
): Promise<ProviderMigrationResult> {
  return exclusiveMigration(async () => {
    const previous = requireConfiguredProvider("sqlite")
    if (requireLocalSession().role !== "Admin") throw new Error("Administrator authentication is required")
    validateConfirmation(input.confirmation)
    onProgress("validating-destination")
    const decoded = parseStoreConnectionCode(input.connectionCode)
    const connection = await verifyStoreConnection(decoded.supabaseUrl, decoded.publishableKey)
    const client = await temporaryCloudClient(connection, input.administratorEmail, input.administratorPassword)
    try {
      onProgress("creating-source-snapshot")
      const snapshot = exportSqliteSnapshot()
      onProgress("creating-destination-backup")
      onProgress("transferring-data")
      const applied = await uploadSqliteSnapshot(client, snapshot)
      onProgress("applying-data")
      if (!applied.migrationId || !applied.safetyBackupId || !applied.sourcePrimaryUserId) {
        throw new Error("Supabase returned an invalid provider migration result")
      }
      onProgress("verifying-data")
      const verified = await verifyStoreConnection(connection.supabaseUrl, connection.publishableKey)
      onProgress("saving-provider")
      try {
        saveStoredConnection(verified)
        const config = createStorageConfig("supabase", {
          databaseProvider: previous.databaseProvider,
          configuredAt: previous.configuredAt,
          migrationId: applied.migrationId,
        })
        writeStorageConfig(config)
      } catch (error) {
        await cloudRpc(client, "restore_system_backup", { p_backup_id: applied.safetyBackupId }).catch(() => undefined)
        throw error
      }
      closeLocalAuth()
      closeDatabase()
      await client.auth.signOut().catch(() => undefined)
      return {
        migrationId: applied.migrationId,
        from: "sqlite",
        to: "supabase",
        rowsTransferred: totalSnapshotRows(snapshot),
        sourcePreserved: true,
        destinationBackupCreated: true,
        reactivationRequiredUserCount: migratedUserCount(snapshot),
      }
    } finally {
      await client.auth.signOut().catch(() => undefined)
    }
  })
}

function validateCloudManifest(value: unknown): CloudExportStart {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Supabase returned invalid export metadata")
  const record = value as Record<string, unknown>
  if (typeof record.backupId !== "string" || typeof record.schemaVersion !== "string"
    || !record.manifest || typeof record.manifest !== "object" || Array.isArray(record.manifest)) {
    throw new Error("Supabase returned invalid export metadata")
  }
  const manifest: CloudExportStart["manifest"] = {}
  for (const [table, count] of Object.entries(record.manifest as Record<string, unknown>)) {
    if (!(PORTABLE_TABLES as readonly string[]).includes(table) || !Number.isSafeInteger(count) || Number(count) < 0) {
      throw new Error("Supabase returned an invalid export manifest")
    }
    manifest[table as PortableTableName] = Number(count)
  }
  if (manifest.users == null) throw new Error("The Supabase export does not contain users")
  return { backupId: record.backupId, schemaVersion: record.schemaVersion, manifest }
}

async function exportSupabaseSnapshot(client: SupabaseClient): Promise<PortableSnapshot> {
  const start = validateCloudManifest(await cloudRpc<unknown>(client, "begin_provider_migration_export"))
  const tables: PortableSnapshot["tables"] = {}
  for (const table of PORTABLE_TABLES) {
    const expected = start.manifest[table]
    if (expected == null) continue
    const rows: PortableRow[] = []
    while (rows.length < expected) {
      const page = await cloudRpc<unknown>(client, "read_provider_migration_export", {
        p_backup_id: start.backupId,
        p_table_name: table,
        p_offset: rows.length,
        p_limit: Math.min(500, expected - rows.length),
      })
      if (!Array.isArray(page) || page.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
        throw new Error(`Supabase returned invalid rows for ${table}`)
      }
      if (page.length === 0 && rows.length < expected) throw new Error(`Supabase export ended early for ${table}`)
      rows.push(...page as PortableRow[])
    }
    if (rows.length !== expected) throw new Error(`Supabase export count does not match for ${table}`)
    tables[table] = normalizePortableRows(rows)
  }
  return finalizeSnapshot("supabase", start.schemaVersion, tables)
}

function sqliteTables(): Set<string> {
  return new Set((getDb().prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  ).all() as Array<{ name: string }>).map((row) => row.name))
}

function sqliteColumnTypes(table: PortableTableName): Map<string, string> {
  const rows = getDb().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; type: string }>
  return new Map(rows.map((row) => [row.name, row.type.toUpperCase()]))
}

function sqliteValue(value: unknown, declaredType: string): unknown {
  if (value == null) return null
  if (declaredType.includes("BLOB") && typeof value === "string" && /^\\x[0-9a-f]*$/i.test(value)) {
    return Buffer.from(value.slice(2), "hex")
  }
  if (typeof value === "boolean") return value ? 1 : 0
  if (typeof value === "object") return JSON.stringify(value)
  return value
}

function localUserRows(rows: PortableRow[]): PortableRow[] {
  const primaryRows = rows.filter((row) => row.is_primary_admin === true || row.is_primary_admin === 1 || row.is_primary_admin === "1")
  if (primaryRows.length !== 1) throw new Error("The Supabase snapshot must contain exactly one primary administrator")
  const primaryId = String(primaryRows[0].id ?? "")
  return rows.map((row) => ({
    ...row,
    role: row.id === primaryId ? "Admin" : row.role === "Admin" ? "Admin" : "Employee",
    is_primary_admin: row.id === primaryId ? 1 : 0,
    password_set: 0,
    password_hash: "",
    activation_token_hash: null,
    activation_expires_at: null,
    failed_login_attempts: 0,
    locked_until: null,
  }))
}

function replaceSqliteData(snapshot: PortableSnapshot, input: MigrateSupabaseToSqliteInput): void {
  const database = getDb()
  const existing = sqliteTables()
  database.transaction(() => {
    // Idempotency receipts are local execution metadata rather than business
    // records. Clear them first so their restrictive invoice references cannot
    // block an otherwise valid provider replacement.
    if (existing.has("sale_operations")) database.prepare("DELETE FROM sale_operations").run()
    if (existing.has("stock_operations")) database.prepare("DELETE FROM stock_operations").run()
    for (const table of [...PORTABLE_TABLES].reverse()) {
      if (snapshot.tables[table] && existing.has(table)) database.prepare(`DELETE FROM ${table}`).run()
    }
    for (const table of PORTABLE_TABLES) {
      const sourceRows = snapshot.tables[table]
      if (!sourceRows || !existing.has(table)) continue
      const rows = table === "users" ? localUserRows(sourceRows) : sourceRows
      const columnTypes = sqliteColumnTypes(table)
      const columns = Object.keys(rows[0] ?? {}).filter((column) => columnTypes.has(column))
      if (rows.length && !columns.length) throw new Error(`No compatible SQLite columns were found for ${table}`)
      const placeholders = columns.map(() => "?").join(", ")
      const quotedColumns = columns.map((column) => `"${column}"`).join(", ")
      const insert = rows.length
        ? database.prepare(`INSERT INTO ${table} (${quotedColumns}) VALUES (${placeholders})`)
        : null
      for (const row of rows) {
        const values = columns.map((column) => sqliteValue(row[column], columnTypes.get(column) ?? ""))
        insert?.run(...values)
      }
      const actual = Number((database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count)
      if (actual !== sourceRows.length) throw new Error(`SQLite migration verification failed for ${table}`)
    }
    configureLocalAdministrator({
      storeName: input.localStoreName,
      adminName: input.localAdministratorName,
      adminUsername: input.localAdministratorUsername,
      adminPassword: input.localAdministratorPassword,
    })
    databaseHealthCheck(true)
  })()
}

export function migrateSupabaseToSqlite(
  input: MigrateSupabaseToSqliteInput,
  onProgress: (stage: ProviderMigrationProgressStage) => void,
): Promise<ProviderMigrationResult> {
  return exclusiveMigration(async () => {
    const previous = requireConfiguredProvider("supabase")
    validateConfirmation(input.confirmation)
    const connection = readStoredConnection()
    if (!connection) throw new Error("The active Supabase connection is missing")
    onProgress("validating-destination")
    await verifyStoreConnection(connection.supabaseUrl, connection.publishableKey)
    const client = await temporaryCloudClient(connection, input.administratorEmail, input.administratorPassword)
    let destinationBackupFile: string | null = null
    try {
      onProgress("creating-source-snapshot")
      const snapshot = await exportSupabaseSnapshot(client)
      onProgress("creating-destination-backup")
      await initDatabase()
      destinationBackupFile = createDatabaseBackup().fileName
      onProgress("transferring-data")
      onProgress("applying-data")
      replaceSqliteData(snapshot, input)
      onProgress("verifying-data")
      databaseHealthCheck(true)
      const migrationId = randomUUID()
      onProgress("saving-provider")
      const config = createStorageConfig("sqlite", {
        databaseProvider: previous.databaseProvider,
        configuredAt: previous.configuredAt,
        migrationId,
      })
      writeStorageConfig(config)
      await client.auth.signOut().catch(() => undefined)
      closeLocalAuth()
      return {
        migrationId,
        from: "supabase",
        to: "sqlite",
        rowsTransferred: totalSnapshotRows(snapshot),
        sourcePreserved: true,
        destinationBackupCreated: true,
        reactivationRequiredUserCount: migratedUserCount(snapshot),
      }
    } catch (error) {
      closeLocalAuth()
      if (destinationBackupFile) {
        try { restoreDatabaseBackup(destinationBackupFile) }
        catch { closeDatabase() }
      } else {
        closeDatabase()
      }
      throw error
    } finally {
      await client.auth.signOut().catch(() => undefined)
    }
  })
}

export function exportSqliteProviderSnapshotForTests(): PortableSnapshot {
  if (process.env.NODE_ENV !== "test") throw new Error("Provider snapshot test helpers are restricted to tests")
  return exportSqliteSnapshot()
}

export function importSupabaseProviderSnapshotForTests(
  snapshot: PortableSnapshot,
  input: MigrateSupabaseToSqliteInput,
): void {
  if (process.env.NODE_ENV !== "test") throw new Error("Provider snapshot test helpers are restricted to tests")
  if (snapshot.sourceProvider !== "supabase") throw new Error("A Supabase test snapshot is required")
  replaceSqliteData(snapshot, input)
}
