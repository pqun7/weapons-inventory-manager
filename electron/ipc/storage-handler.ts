import { BrowserWindow, ipcMain } from "electron"
import { z } from "zod"
import {
  activateSupabaseProvider,
  getStorageBootstrapState,
  initializeSelectedProvider,
  returnToStorageSetup,
  setupSqliteProvider,
} from "../services/database-provider-manager.js"
import { readStorageConfig } from "../services/storage-config-service.js"
import {
  claimLocalAccount,
  getLocalSession,
  resolveLocalAccount,
  signInLocal,
  signOutLocal,
  updateLocalPassword,
} from "../services/local-auth-service.js"
import {
  executeSqliteDatabaseOperation,
  SQLITE_DATABASE_OPERATIONS,
} from "../services/sqlite-command-service.js"
import type { StorageSetupProgressStage } from "../../src/lib/database-provider.js"
import { exportLoginGuide } from "../services/login-guide-service.js"
import {
  migrateSqliteToSupabase,
  migrateSupabaseToSqlite,
} from "../services/provider-migration-service.js"
import type { ProviderMigrationProgressStage } from "../../src/lib/database-provider.js"

const sqliteSetupSchema = z.object({
  storeName: z.string().trim().min(1).max(120),
  adminName: z.string().trim().min(1).max(120),
  adminUsername: z.string().trim().min(3).max(80),
  adminPassword: z.string().min(8).max(256),
}).strict()

const identifierSchema = z.string().trim().min(1).max(160)
const authPasswordSchema = z.string().min(1).max(256)
const databaseCommandSchema = z.object({
  operation: z.enum(SQLITE_DATABASE_OPERATIONS),
  args: z.array(z.unknown()).max(10),
}).strict()
const loginGuideSchema = z.object({
  userId: z.string().trim().min(1).max(160),
  accountName: z.string().trim().min(1).max(120),
  loginIdentifier: z.string().trim().min(1).max(160),
  activationCode: z.string().trim().min(8).max(64),
  language: z.enum(["ar", "en"]),
}).strict()
const migrationConfirmationSchema = z.string().trim().max(32)
const migrateToSupabaseSchema = z.object({
  connectionCode: z.string().trim().min(20).max(4096),
  administratorEmail: z.email().max(254),
  administratorPassword: authPasswordSchema,
  confirmation: migrationConfirmationSchema,
}).strict()
const migrateToSqliteSchema = z.object({
  administratorEmail: z.email().max(254),
  administratorPassword: authPasswordSchema,
  localStoreName: z.string().trim().min(1).max(120),
  localAdministratorName: z.string().trim().min(1).max(120),
  localAdministratorUsername: z.string().trim().min(3).max(80),
  localAdministratorPassword: z.string().min(8).max(256),
  confirmation: migrationConfirmationSchema,
}).strict()

function safeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "The operation failed"
  return raw
    .replace(/[A-Z]:\\[^\r\n]+/gi, "[local path hidden]")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[database connection hidden]")
    .replace(/(?:sb_(?:secret|publishable)_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]{40,})/g, "[credential hidden]")
    .slice(0, 500)
}

function result<T>(operation: () => T): { success: true; data: T } | { success: false; error: string } {
  try { return { success: true, data: operation() } }
  catch (error) { return { success: false, error: safeError(error) } }
}

async function asyncResult<T>(operation: () => Promise<T>): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try { return { success: true, data: await operation() } }
  catch (error) { return { success: false, error: safeError(error) } }
}

function requireSqliteSelected(): void {
  const config = readStorageConfig().config
  if (config?.databaseProvider !== "sqlite") throw new Error("SQLite is not the selected database provider")
}

export function registerStorageHandlers(): void {
  for (const channel of [
    "storage:get-bootstrap", "storage:initialize-selected", "storage:return-to-setup", "storage:setup-sqlite", "storage:activate-supabase",
    "local-auth:get-session", "local-auth:resolve", "local-auth:sign-in", "local-auth:claim", "local-auth:sign-out",
    "local-auth:update-password", "database:invoke", "account:export-login-guide",
    "storage:migrate-to-supabase", "storage:migrate-to-sqlite",
  ]) ipcMain.removeHandler(channel)

  ipcMain.handle("storage:get-bootstrap", () => result(getStorageBootstrapState))
  ipcMain.handle("storage:initialize-selected", () => asyncResult(initializeSelectedProvider))
  ipcMain.handle("storage:return-to-setup", () => result(returnToStorageSetup))
  ipcMain.handle("storage:setup-sqlite", (event, input: unknown) => asyncResult(async () => {
    const validated = sqliteSetupSchema.parse(input)
    return setupSqliteProvider(validated, (stage: StorageSetupProgressStage) => {
      if (!event.sender.isDestroyed()) event.sender.send("storage:setup-progress", stage)
    })
  }))
  ipcMain.handle("storage:activate-supabase", () => asyncResult(activateSupabaseProvider))
  ipcMain.handle("storage:migrate-to-supabase", (event, input: unknown) => asyncResult(() => {
    const parsed = migrateToSupabaseSchema.parse(input)
    return migrateSqliteToSupabase(parsed, (stage: ProviderMigrationProgressStage) => {
      if (!event.sender.isDestroyed()) event.sender.send("storage:migration-progress", stage)
    })
  }))
  ipcMain.handle("storage:migrate-to-sqlite", (event, input: unknown) => asyncResult(() => {
    const parsed = migrateToSqliteSchema.parse(input)
    return migrateSupabaseToSqlite(parsed, (stage: ProviderMigrationProgressStage) => {
      if (!event.sender.isDestroyed()) event.sender.send("storage:migration-progress", stage)
    })
  }))

  ipcMain.handle("local-auth:get-session", () => result(() => { requireSqliteSelected(); return getLocalSession() }))
  ipcMain.handle("local-auth:resolve", (_event, input: unknown) => result(() => {
    requireSqliteSelected()
    const parsed = z.object({ identifier: identifierSchema }).strict().parse(input)
    return resolveLocalAccount(parsed.identifier)
  }))
  ipcMain.handle("local-auth:sign-in", (_event, input: unknown) => result(() => {
    requireSqliteSelected()
    const parsed = z.object({ identifier: identifierSchema, password: authPasswordSchema }).strict().parse(input)
    return signInLocal(parsed.identifier, parsed.password)
  }))
  ipcMain.handle("local-auth:claim", (_event, input: unknown) => result(() => {
    requireSqliteSelected()
    const parsed = z.object({ identifier: identifierSchema, activationCode: z.string().trim().min(8).max(64), password: authPasswordSchema }).strict().parse(input)
    return claimLocalAccount(parsed.identifier, parsed.activationCode, parsed.password)
  }))
  ipcMain.handle("local-auth:sign-out", () => result(() => { requireSqliteSelected(); signOutLocal() }))
  ipcMain.handle("local-auth:update-password", (_event, input: unknown) => result(() => {
    requireSqliteSelected()
    const parsed = z.object({ currentPassword: authPasswordSchema, newPassword: authPasswordSchema }).strict().parse(input)
    updateLocalPassword(parsed.currentPassword, parsed.newPassword)
  }))

  ipcMain.handle("database:invoke", (_event, input: unknown) => result(() => {
    requireSqliteSelected()
    const serializedSize = Buffer.byteLength(JSON.stringify(input ?? null), "utf8")
    if (serializedSize > 25 * 1024 * 1024) throw new Error("Database command payload is too large")
    const parsed = databaseCommandSchema.parse(input)
    return executeSqliteDatabaseOperation(parsed.operation, parsed.args)
  }))

  ipcMain.handle("account:export-login-guide", (event, input: unknown) => asyncResult(() => {
    const parsed = loginGuideSchema.parse(input)
    return exportLoginGuide(parsed, BrowserWindow.fromWebContents(event.sender))
  }))
}
