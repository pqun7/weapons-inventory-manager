import {
  closeDatabase,
  databaseExists,
  databaseHealthCheck,
  getDbPath,
  initDatabase,
} from "../database.js"
import {
  createStorageConfig,
  readStorageConfig,
  writeStorageConfig,
} from "./storage-config-service.js"
import {
  closeLocalAuth,
  configureLocalAdministrator,
} from "./local-auth-service.js"
import {
  readStoredConnection,
  verifyStoreConnection,
} from "./store-installation-service.js"
import type {
  ActivateSupabaseResult,
  AppStorageConfig,
  DatabaseHealthResult,
  InitializeSqliteInput,
  InitializeSqliteResult,
  StorageBootstrapState,
  StorageSetupProgressStage,
} from "../../src/lib/database-provider.js"

let setupInProgress = false

function exclusiveSetup<T>(operation: () => Promise<T>): Promise<T> {
  if (setupInProgress) return Promise.reject(new Error("Storage setup is already running"))
  setupInProgress = true
  return operation().finally(() => { setupInProgress = false })
}

export function getStorageBootstrapState(): StorageBootstrapState {
  const stored = readStorageConfig()
  const supabaseConnection = readStoredConnection()
  return {
    config: stored.config,
    configError: stored.error,
    legacySqliteDatabaseFound: databaseExists(),
    supabaseConnectionFound: supabaseConnection !== null,
  }
}

export async function initializeSelectedProvider(): Promise<{
  config: AppStorageConfig
  health: DatabaseHealthResult
}> {
  const stored = readStorageConfig()
  if (!stored.config) throw new Error(stored.error ?? "Storage setup has not been completed")
  if (stored.config.databaseProvider === "sqlite") {
    await initDatabase()
    return { config: stored.config, health: databaseHealthCheck(false) }
  }

  const connection = readStoredConnection()
  if (!connection) throw new Error("The selected Supabase connection is missing or damaged")
  const verified = await verifyStoreConnection(connection.supabaseUrl, connection.publishableKey)
  return {
    config: stored.config,
    health: {
      provider: "supabase",
      healthy: true,
      schemaVersion: verified.schemaVersion,
      details: { connection: "ok", readWrite: "ok" },
    },
  }
}

export function setupSqliteProvider(
  input: InitializeSqliteInput,
  onProgress: (stage: StorageSetupProgressStage) => void,
): Promise<InitializeSqliteResult> {
  return exclusiveSetup(async () => {
    try {
      onProgress("validating")
      onProgress("creating-directory")
      onProgress("opening-database")
      onProgress("backing-up")
      onProgress("migrating")
      await initDatabase()
      onProgress("creating-admin")
      const administrator = configureLocalAdministrator(input)
      onProgress("checking-integrity")
      onProgress("testing-read-write")
      const health = databaseHealthCheck(true)
      onProgress("saving")
      const config = createStorageConfig("sqlite")
      writeStorageConfig(config)
      return {
        config,
        health,
        databasePath: getDbPath(),
        adminIdentifier: administrator.identifier,
      }
    } catch (error) {
      closeLocalAuth()
      closeDatabase()
      throw error
    }
  })
}

export function activateSupabaseProvider(): Promise<ActivateSupabaseResult> {
  return exclusiveSetup(async () => {
    const connection = readStoredConnection()
    if (!connection) throw new Error("Complete or join a Supabase store before selecting cloud storage")
    const verified = await verifyStoreConnection(connection.supabaseUrl, connection.publishableKey)
    const config = createStorageConfig("supabase")
    writeStorageConfig(config)
    return {
      config,
      health: {
        provider: "supabase",
        healthy: true,
        schemaVersion: verified.schemaVersion,
        details: { connection: "ok", readWrite: "ok" },
      },
    }
  })
}

export function closeSelectedProvider(): void {
  closeLocalAuth()
  closeDatabase()
}
