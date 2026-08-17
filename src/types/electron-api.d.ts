import type {
  ManifestExtractionResult,
  ManifestProgress,
  ManifestUploadInput,
  SqliteManifestOperation,
} from "../lib/shipment-manifest"
import type {
  InitializeStoreInput,
  StoreConnectionConfiguration,
  StoreSetupProgressStage,
  StoreSetupResult,
} from "../lib/store-connection"
import type {
  ActivateSupabaseResult,
  AppStorageConfig,
  DatabaseHealthResult,
  DatabaseOperationName,
  ExportLoginGuideInput,
  ExportLoginGuideResult,
  InitializeSqliteInput,
  InitializeSqliteResult,
  LocalAccountResolution,
  LocalSession,
  MigrateSqliteToSupabaseInput,
  MigrateSupabaseToSqliteInput,
  ProviderMigrationProgressStage,
  ProviderMigrationResult,
  PasswordRecoveryCompleteInput,
  PasswordRecoveryRequestResult,
  PendingPasswordRecoveryRequest,
  ApprovedPasswordRecoveryRequest,
  StorageBootstrapState,
  StorageSetupProgressStage,
} from "../lib/database-provider"
import type { SupabaseEnvironmentStatus } from "../lib/store-connection"

export interface IpcResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface ElectronAPI {
  storeConnection: {
    get: () => Promise<IpcResult<{ connection: StoreConnectionConfiguration; connectionCode: string } | null>>
    join: (input: { connectionCode: string }) => Promise<IpcResult<{ connection: StoreConnectionConfiguration; connectionCode: string }>>
    initialize: (input: InitializeStoreInput) => Promise<IpcResult<StoreSetupResult>>
    clear: () => Promise<IpcResult<void>>
    environmentStatus: () => Promise<IpcResult<SupabaseEnvironmentStatus>>
    onSetupProgress: (callback: (stage: StoreSetupProgressStage) => void) => () => void
  }
  storage: {
    getBootstrap: () => Promise<IpcResult<StorageBootstrapState>>
    initializeSelected: () => Promise<IpcResult<{ config: AppStorageConfig; health: DatabaseHealthResult }>>
    returnToSetup: () => Promise<IpcResult<void>>
    setupSqlite: (input: InitializeSqliteInput) => Promise<IpcResult<InitializeSqliteResult>>
    activateSupabase: () => Promise<IpcResult<ActivateSupabaseResult>>
    migrateToSupabase: (input: MigrateSqliteToSupabaseInput) => Promise<IpcResult<ProviderMigrationResult>>
    migrateToSqlite: (input: MigrateSupabaseToSqliteInput) => Promise<IpcResult<ProviderMigrationResult>>
    onSetupProgress: (callback: (stage: StorageSetupProgressStage) => void) => () => void
    onMigrationProgress: (callback: (stage: ProviderMigrationProgressStage) => void) => () => void
  }
  localAuth: {
    getSession: () => Promise<IpcResult<LocalSession | null>>
    resolve: (input: { identifier: string }) => Promise<IpcResult<LocalAccountResolution>>
    signIn: (input: { identifier: string; password: string }) => Promise<IpcResult<LocalSession>>
    claim: (input: { identifier: string; activationCode: string; password: string }) => Promise<IpcResult<LocalSession>>
    signOut: () => Promise<IpcResult<void>>
    updatePassword: (input: { currentPassword: string; newPassword: string }) => Promise<IpcResult<void>>
  }
  passwordRecovery: {
    request: (input: { identifier: string }) => Promise<IpcResult<PasswordRecoveryRequestResult>>
    complete: (input: PasswordRecoveryCompleteInput) => Promise<IpcResult<LocalSession>>
    listPending: () => Promise<IpcResult<PendingPasswordRecoveryRequest[]>>
    approve: (input: { requestId: string }) => Promise<IpcResult<ApprovedPasswordRecoveryRequest>>
  }
  accounts: {
    exportLoginGuide: (input: ExportLoginGuideInput) => Promise<IpcResult<ExportLoginGuideResult>>
  }
  database: {
    invoke: (input: { operation: DatabaseOperationName; args: unknown[] }) => Promise<IpcResult<unknown>>
  }
  manifest: {
    parse: (input: ManifestUploadInput) => Promise<IpcResult<ManifestExtractionResult>>
    onProgress: (callback: (progress: ManifestProgress) => void) => () => void
  }
  sqliteManifest: {
    invoke: (input: { operation: SqliteManifestOperation; args: unknown[] }) => Promise<IpcResult<unknown>>
  }
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
