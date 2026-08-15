import electron from "electron"
import fs from "node:fs"
import path from "node:path"
import {
  AppStorageConfigSchema,
  type AppStorageConfig,
  type DatabaseProvider,
} from "../../src/lib/database-provider.js"

const CONFIG_FILENAME = "storage-config.json"
const BACKUP_SUFFIX = ".bak"
const electronApp = electron.app

export interface StorageConfigReadResult {
  config: AppStorageConfig | null
  error: string | null
}

export function storageConfigPath(): string {
  return path.join(electronApp.getPath("userData"), CONFIG_FILENAME)
}

function readValidated(filename: string): AppStorageConfig {
  const parsed: unknown = JSON.parse(fs.readFileSync(filename, "utf8"))
  return AppStorageConfigSchema.parse(parsed)
}

export function readStorageConfig(): StorageConfigReadResult {
  const filename = storageConfigPath()
  const backup = `${filename}${BACKUP_SUFFIX}`
  if (!fs.existsSync(filename) && !fs.existsSync(backup)) return { config: null, error: null }

  try {
    if (fs.existsSync(filename)) return { config: readValidated(filename), error: null }
    const recovered = readValidated(backup)
    fs.renameSync(backup, filename)
    return { config: recovered, error: null }
  } catch {
    return {
      config: null,
      error: "The saved storage configuration is damaged. No database provider was started.",
    }
  }
}

export function createStorageConfig(
  databaseProvider: DatabaseProvider,
  previous?: Pick<AppStorageConfig, "databaseProvider" | "configuredAt"> & { migrationId: string },
): AppStorageConfig {
  return AppStorageConfigSchema.parse({
    version: 1,
    databaseProvider,
    setupCompleted: true,
    configuredAt: new Date().toISOString(),
    previousDatabaseProvider: previous?.databaseProvider,
    previousConfiguredAt: previous?.configuredAt,
    lastProviderMigrationId: previous?.migrationId,
    lastProviderMigrationAt: previous ? new Date().toISOString() : undefined,
  })
}

export function writeStorageConfig(config: AppStorageConfig): void {
  const validated = AppStorageConfigSchema.parse(config)
  const filename = storageConfigPath()
  const directory = path.dirname(filename)
  const temporary = path.join(directory, `${CONFIG_FILENAME}.${process.pid}.${Date.now()}.tmp`)
  const backup = `${filename}${BACKUP_SUFFIX}`
  fs.mkdirSync(directory, { recursive: true })

  let temporaryExists = false
  try {
    const descriptor = fs.openSync(temporary, "wx", 0o600)
    temporaryExists = true
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(validated, null, 2)}\n`, "utf8")
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
