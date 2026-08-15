import { z } from "zod"

export const DATABASE_PROVIDERS = ["sqlite", "supabase"] as const
export const DatabaseProviderSchema = z.enum(DATABASE_PROVIDERS)
export type DatabaseProvider = z.infer<typeof DatabaseProviderSchema>

export const AppStorageConfigSchema = z.object({
  version: z.literal(1),
  databaseProvider: DatabaseProviderSchema,
  setupCompleted: z.literal(true),
  configuredAt: z.iso.datetime(),
  previousDatabaseProvider: DatabaseProviderSchema.optional(),
  previousConfiguredAt: z.iso.datetime().optional(),
  lastProviderMigrationId: z.string().uuid().optional(),
  lastProviderMigrationAt: z.iso.datetime().optional(),
})

export type AppStorageConfig = z.infer<typeof AppStorageConfigSchema>

export interface DatabaseHealthResult {
  provider: DatabaseProvider
  healthy: boolean
  schemaVersion: string
  details: {
    connection: "ok"
    readWrite: "ok"
    integrity?: "ok"
    foreignKeys?: "ok"
  }
}

export interface StorageBootstrapState {
  config: AppStorageConfig | null
  configError: string | null
  legacySqliteDatabaseFound: boolean
  supabaseConnectionFound: boolean
}

export interface InitializeSqliteInput {
  storeName: string
  adminName: string
  adminUsername: string
  adminPassword: string
}

export interface InitializeSqliteResult {
  config: AppStorageConfig
  health: DatabaseHealthResult
  databasePath: string
  adminIdentifier: string
}

export interface ActivateSupabaseResult {
  config: AppStorageConfig
  health: DatabaseHealthResult
}

export type ProviderMigrationProgressStage =
  | "validating-destination"
  | "creating-source-snapshot"
  | "creating-destination-backup"
  | "transferring-data"
  | "applying-data"
  | "verifying-data"
  | "saving-provider"

export interface MigrateSqliteToSupabaseInput {
  connectionCode: string
  administratorEmail: string
  administratorPassword: string
  confirmation: string
}

export interface MigrateSupabaseToSqliteInput {
  administratorEmail: string
  administratorPassword: string
  localStoreName: string
  localAdministratorName: string
  localAdministratorUsername: string
  localAdministratorPassword: string
  confirmation: string
}

export interface ProviderMigrationResult {
  migrationId: string
  from: DatabaseProvider
  to: DatabaseProvider
  rowsTransferred: number
  sourcePreserved: true
  destinationBackupCreated: true
  reactivationRequiredUserCount: number
}

export type StorageSetupProgressStage =
  | "validating"
  | "creating-directory"
  | "opening-database"
  | "backing-up"
  | "migrating"
  | "creating-admin"
  | "checking-integrity"
  | "testing-read-write"
  | "saving"

export interface LocalAccountResolution {
  identifier: string
  displayName: string
  requiresActivation: boolean
}

export interface LocalSession {
  userId: string
  username: string
  name: string
  role: "Admin" | "Employee"
}

export interface ExportLoginGuideInput {
  userId: string
  accountName: string
  loginIdentifier: string
  activationCode: string
  language: "ar" | "en"
}

export interface ExportLoginGuideResult {
  canceled: boolean
}

export const DATABASE_OPERATION_NAMES = [
  "dbGetCurrentUserId", "dbGetAll", "dbGetMasterData", "dbGetSettings", "dbUpdateSettings",
  "dbGetUserPreferences", "dbUpsertUserPreferences", "dbInsertWeapon", "dbBulkInsertWeapons", "dbUpdateWeapon",
  "dbInsertShipment", "dbUpdateShipment", "dbInsertInvoice", "dbUpdateInvoice", "dbInsertPayment",
  "dbInsertAccessory", "dbUpdateAccessory", "dbInsertAmmunition", "dbUpdateAmmunition", "dbInsertCustomer",
  "dbUpdateCustomer", "dbDeleteCustomer", "dbInsertSupplier", "dbInsertAuditLog", "dbInsertNotification",
  "dbUpdateNotification", "dbMarkAllNotificationsRead", "dbDeleteNotification", "dbCreateNotification", "dbFlagOverdueShipments",
  "dbWriteAuditEvent", "dbInsertUser", "dbUpdateUser", "dbDeleteUser", "dbResetUserActivation", "dbUpdateOwnEmail",
  "dbListBackups", "dbCreateSystemBackup", "dbRestoreSystemBackup", "dbDeleteBackup", "dbInsertSavedFilter", "dbDeleteSavedFilter",
  "dbInsertMasterWeaponType", "dbInsertMasterWeaponSubtype", "dbInsertMasterCaliber", "dbLinkSubtypeCaliber",
  "dbInsertMasterBrand", "dbInsertMasterModel", "dbInsertMasterWarehouse", "dbInsertMasterStorageLocation", "dbDeleteMasterRow",
  "dbGetCurrencies", "dbGetOverrides", "dbUpdateCurrencyRate", "dbRecordRateHistory", "dbSetManualOverride",
  "dbSetAutomaticMode", "dbGetRateAuditLog", "dbAddCurrency", "dbToggleCurrencyActive", "dbRecordRateAuditLog", "dbDeleteCurrency",
  "dbCompleteSale", "dbRegisterPayment", "dbUpdateWeaponStatus", "dbUpdateWeaponNotes", "dbUpdateWeaponLocation",
  "dbAppendWeaponImage", "dbBindWeaponToShipment", "dbSetShipmentStatus", "dbUpdateShipmentDetails", "dbDeleteShipment",
  "dbAddShipmentDocument", "dbDeleteShipmentDocument", "dbAddShipmentTimelineEvent", "dbUpdateInvoiceNotes",
  "dbUpdateInventoryProduct", "dbBulkIntakeWeapons", "dbCreateShipmentRpc", "dbBulkCreateShipment",
  "dbReceiveScheduledShipment", "dbRescheduleShipment", "dbUpdateScheduledShipment", "dbAdjustInventoryStock",
  "dbReceiveAmmoByPackages", "dbReceiveAmmoByRounds", "dbUpdateAmmoPackage", "dbExtendInvoiceDueDate", "dbVoidInvoice",
  "dbCreateAccessory", "dbCreateAmmunition", "dbCreateInventoryProductType", "dbUpdateProductPricing", "dbReplaceProductCosts",
] as const

export type DatabaseOperationName = typeof DATABASE_OPERATION_NAMES[number]
