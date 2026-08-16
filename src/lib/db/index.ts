import { getDatabaseProvider } from "../database-runtime.js"
import { invokeSqliteOperation } from "./sqlite-provider.js"
import type { DatabaseOperationName } from "../database-provider.js"

export const AUTHENTICATED_USER_NOT_LINKED = "AUTHENTICATED_USER_NOT_LINKED"

export type {
  DbResult, AllData, MasterDataAll, CurrencyRow, ExchangeRateOverrideRow, AuditLogEntry,
} from "./types.js"

export interface BackupRecord {
  id: string
  scope: "system" | "personal"
  owner_user_id: string | null
  created_by_name: string
  label: string
  created_at: string
  restored_at: string | null
  item_count: number
  size_bytes: number
  status: "creating" | "completed" | "restoring" | "failed"
  completed_at: string | null
  error_message: string | null
}

type SupabaseDatabaseModule = typeof import("./supabase-provider.js")
let ready = false

async function routeOperation(name: DatabaseOperationName, args: readonly unknown[]): Promise<unknown> {
  if (getDatabaseProvider() === "sqlite") return invokeSqliteOperation(name, args)
  const provider = await import("./supabase-provider.js")
  const operation = provider[name] as unknown as ((...values: unknown[]) => Promise<unknown>)
  return operation(...args)
}

export async function initDb(): Promise<void> {
  if (getDatabaseProvider() === "supabase") {
    const provider = await import("./supabase-provider.js")
    await provider.initDb()
  }
  ready = true
}

export function isDbReady(): boolean {
  return ready
}

export const dbGetCurrentUserId: SupabaseDatabaseModule["dbGetCurrentUserId"] = (...args) => routeOperation("dbGetCurrentUserId", args) as ReturnType<SupabaseDatabaseModule["dbGetCurrentUserId"]>
export const dbGetAll: SupabaseDatabaseModule["dbGetAll"] = (...args) => routeOperation("dbGetAll", args) as ReturnType<SupabaseDatabaseModule["dbGetAll"]>
export const dbGetMasterData: SupabaseDatabaseModule["dbGetMasterData"] = (...args) => routeOperation("dbGetMasterData", args) as ReturnType<SupabaseDatabaseModule["dbGetMasterData"]>
export const dbGetSettings: SupabaseDatabaseModule["dbGetSettings"] = (...args) => routeOperation("dbGetSettings", args) as ReturnType<SupabaseDatabaseModule["dbGetSettings"]>
export const dbUpdateSettings: SupabaseDatabaseModule["dbUpdateSettings"] = (...args) => routeOperation("dbUpdateSettings", args) as ReturnType<SupabaseDatabaseModule["dbUpdateSettings"]>
export const dbGetUserPreferences: SupabaseDatabaseModule["dbGetUserPreferences"] = (...args) => routeOperation("dbGetUserPreferences", args) as ReturnType<SupabaseDatabaseModule["dbGetUserPreferences"]>
export const dbUpsertUserPreferences: SupabaseDatabaseModule["dbUpsertUserPreferences"] = (...args) => routeOperation("dbUpsertUserPreferences", args) as ReturnType<SupabaseDatabaseModule["dbUpsertUserPreferences"]>
export const dbInsertWeapon: SupabaseDatabaseModule["dbInsertWeapon"] = (...args) => routeOperation("dbInsertWeapon", args) as ReturnType<SupabaseDatabaseModule["dbInsertWeapon"]>
export const dbBulkInsertWeapons: SupabaseDatabaseModule["dbBulkInsertWeapons"] = (...args) => routeOperation("dbBulkInsertWeapons", args) as ReturnType<SupabaseDatabaseModule["dbBulkInsertWeapons"]>
export const dbUpdateWeapon: SupabaseDatabaseModule["dbUpdateWeapon"] = (...args) => routeOperation("dbUpdateWeapon", args) as ReturnType<SupabaseDatabaseModule["dbUpdateWeapon"]>
export const dbUpdateWeaponDetails: SupabaseDatabaseModule["dbUpdateWeaponDetails"] = (...args) => routeOperation("dbUpdateWeaponDetails", args) as ReturnType<SupabaseDatabaseModule["dbUpdateWeaponDetails"]>
export const dbInsertShipment: SupabaseDatabaseModule["dbInsertShipment"] = (...args) => routeOperation("dbInsertShipment", args) as ReturnType<SupabaseDatabaseModule["dbInsertShipment"]>
export const dbUpdateShipment: SupabaseDatabaseModule["dbUpdateShipment"] = (...args) => routeOperation("dbUpdateShipment", args) as ReturnType<SupabaseDatabaseModule["dbUpdateShipment"]>
export const dbInsertInvoice: SupabaseDatabaseModule["dbInsertInvoice"] = (...args) => routeOperation("dbInsertInvoice", args) as ReturnType<SupabaseDatabaseModule["dbInsertInvoice"]>
export const dbUpdateInvoice: SupabaseDatabaseModule["dbUpdateInvoice"] = (...args) => routeOperation("dbUpdateInvoice", args) as ReturnType<SupabaseDatabaseModule["dbUpdateInvoice"]>
export const dbInsertPayment: SupabaseDatabaseModule["dbInsertPayment"] = (...args) => routeOperation("dbInsertPayment", args) as ReturnType<SupabaseDatabaseModule["dbInsertPayment"]>
export const dbInsertAccessory: SupabaseDatabaseModule["dbInsertAccessory"] = (...args) => routeOperation("dbInsertAccessory", args) as ReturnType<SupabaseDatabaseModule["dbInsertAccessory"]>
export const dbUpdateAccessory: SupabaseDatabaseModule["dbUpdateAccessory"] = (...args) => routeOperation("dbUpdateAccessory", args) as ReturnType<SupabaseDatabaseModule["dbUpdateAccessory"]>
export const dbInsertAmmunition: SupabaseDatabaseModule["dbInsertAmmunition"] = (...args) => routeOperation("dbInsertAmmunition", args) as ReturnType<SupabaseDatabaseModule["dbInsertAmmunition"]>
export const dbUpdateAmmunition: SupabaseDatabaseModule["dbUpdateAmmunition"] = (...args) => routeOperation("dbUpdateAmmunition", args) as ReturnType<SupabaseDatabaseModule["dbUpdateAmmunition"]>
export const dbInsertCustomer: SupabaseDatabaseModule["dbInsertCustomer"] = (...args) => routeOperation("dbInsertCustomer", args) as ReturnType<SupabaseDatabaseModule["dbInsertCustomer"]>
export const dbUpdateCustomer: SupabaseDatabaseModule["dbUpdateCustomer"] = (...args) => routeOperation("dbUpdateCustomer", args) as ReturnType<SupabaseDatabaseModule["dbUpdateCustomer"]>
export const dbDeleteCustomer: SupabaseDatabaseModule["dbDeleteCustomer"] = (...args) => routeOperation("dbDeleteCustomer", args) as ReturnType<SupabaseDatabaseModule["dbDeleteCustomer"]>
export const dbInsertSupplier: SupabaseDatabaseModule["dbInsertSupplier"] = (...args) => routeOperation("dbInsertSupplier", args) as ReturnType<SupabaseDatabaseModule["dbInsertSupplier"]>
export const dbInsertAuditLog: SupabaseDatabaseModule["dbInsertAuditLog"] = (...args) => routeOperation("dbInsertAuditLog", args) as ReturnType<SupabaseDatabaseModule["dbInsertAuditLog"]>
export const dbInsertNotification: SupabaseDatabaseModule["dbInsertNotification"] = (...args) => routeOperation("dbInsertNotification", args) as ReturnType<SupabaseDatabaseModule["dbInsertNotification"]>
export const dbUpdateNotification: SupabaseDatabaseModule["dbUpdateNotification"] = (...args) => routeOperation("dbUpdateNotification", args) as ReturnType<SupabaseDatabaseModule["dbUpdateNotification"]>
export const dbMarkAllNotificationsRead: SupabaseDatabaseModule["dbMarkAllNotificationsRead"] = (...args) => routeOperation("dbMarkAllNotificationsRead", args) as ReturnType<SupabaseDatabaseModule["dbMarkAllNotificationsRead"]>
export const dbDeleteNotification: SupabaseDatabaseModule["dbDeleteNotification"] = (...args) => routeOperation("dbDeleteNotification", args) as ReturnType<SupabaseDatabaseModule["dbDeleteNotification"]>
export const dbCreateNotification: SupabaseDatabaseModule["dbCreateNotification"] = (...args) => routeOperation("dbCreateNotification", args) as ReturnType<SupabaseDatabaseModule["dbCreateNotification"]>
export const dbFlagOverdueShipments: SupabaseDatabaseModule["dbFlagOverdueShipments"] = (...args) => routeOperation("dbFlagOverdueShipments", args) as ReturnType<SupabaseDatabaseModule["dbFlagOverdueShipments"]>
export const dbWriteAuditEvent: SupabaseDatabaseModule["dbWriteAuditEvent"] = (...args) => routeOperation("dbWriteAuditEvent", args) as ReturnType<SupabaseDatabaseModule["dbWriteAuditEvent"]>
export const dbInsertUser: SupabaseDatabaseModule["dbInsertUser"] = (...args) => routeOperation("dbInsertUser", args) as ReturnType<SupabaseDatabaseModule["dbInsertUser"]>
export const dbUpdateUser: SupabaseDatabaseModule["dbUpdateUser"] = (...args) => routeOperation("dbUpdateUser", args) as ReturnType<SupabaseDatabaseModule["dbUpdateUser"]>
export const dbDeleteUser: SupabaseDatabaseModule["dbDeleteUser"] = (...args) => routeOperation("dbDeleteUser", args) as ReturnType<SupabaseDatabaseModule["dbDeleteUser"]>
export const dbResetUserActivation: SupabaseDatabaseModule["dbResetUserActivation"] = (...args) => routeOperation("dbResetUserActivation", args) as ReturnType<SupabaseDatabaseModule["dbResetUserActivation"]>
export const dbUpdateOwnEmail: SupabaseDatabaseModule["dbUpdateOwnEmail"] = (...args) => routeOperation("dbUpdateOwnEmail", args) as ReturnType<SupabaseDatabaseModule["dbUpdateOwnEmail"]>
export const dbListBackups: SupabaseDatabaseModule["dbListBackups"] = (...args) => routeOperation("dbListBackups", args) as ReturnType<SupabaseDatabaseModule["dbListBackups"]>
export const dbCreateSystemBackup: SupabaseDatabaseModule["dbCreateSystemBackup"] = (...args) => routeOperation("dbCreateSystemBackup", args) as ReturnType<SupabaseDatabaseModule["dbCreateSystemBackup"]>
export const dbRestoreSystemBackup: SupabaseDatabaseModule["dbRestoreSystemBackup"] = (...args) => routeOperation("dbRestoreSystemBackup", args) as ReturnType<SupabaseDatabaseModule["dbRestoreSystemBackup"]>
export const dbDeleteBackup: SupabaseDatabaseModule["dbDeleteBackup"] = (...args) => routeOperation("dbDeleteBackup", args) as ReturnType<SupabaseDatabaseModule["dbDeleteBackup"]>
export const dbInsertSavedFilter: SupabaseDatabaseModule["dbInsertSavedFilter"] = (...args) => routeOperation("dbInsertSavedFilter", args) as ReturnType<SupabaseDatabaseModule["dbInsertSavedFilter"]>
export const dbDeleteSavedFilter: SupabaseDatabaseModule["dbDeleteSavedFilter"] = (...args) => routeOperation("dbDeleteSavedFilter", args) as ReturnType<SupabaseDatabaseModule["dbDeleteSavedFilter"]>
export const dbInsertMasterWeaponType: SupabaseDatabaseModule["dbInsertMasterWeaponType"] = (...args) => routeOperation("dbInsertMasterWeaponType", args) as ReturnType<SupabaseDatabaseModule["dbInsertMasterWeaponType"]>
export const dbInsertMasterWeaponSubtype: SupabaseDatabaseModule["dbInsertMasterWeaponSubtype"] = (...args) => routeOperation("dbInsertMasterWeaponSubtype", args) as ReturnType<SupabaseDatabaseModule["dbInsertMasterWeaponSubtype"]>
export const dbInsertMasterCaliber: SupabaseDatabaseModule["dbInsertMasterCaliber"] = (...args) => routeOperation("dbInsertMasterCaliber", args) as ReturnType<SupabaseDatabaseModule["dbInsertMasterCaliber"]>
export const dbLinkSubtypeCaliber: SupabaseDatabaseModule["dbLinkSubtypeCaliber"] = (...args) => routeOperation("dbLinkSubtypeCaliber", args) as ReturnType<SupabaseDatabaseModule["dbLinkSubtypeCaliber"]>
export const dbInsertMasterBrand: SupabaseDatabaseModule["dbInsertMasterBrand"] = (...args) => routeOperation("dbInsertMasterBrand", args) as ReturnType<SupabaseDatabaseModule["dbInsertMasterBrand"]>
export const dbInsertMasterModel: SupabaseDatabaseModule["dbInsertMasterModel"] = (...args) => routeOperation("dbInsertMasterModel", args) as ReturnType<SupabaseDatabaseModule["dbInsertMasterModel"]>
export const dbInsertMasterWarehouse: SupabaseDatabaseModule["dbInsertMasterWarehouse"] = (...args) => routeOperation("dbInsertMasterWarehouse", args) as ReturnType<SupabaseDatabaseModule["dbInsertMasterWarehouse"]>
export const dbInsertMasterStorageLocation: SupabaseDatabaseModule["dbInsertMasterStorageLocation"] = (...args) => routeOperation("dbInsertMasterStorageLocation", args) as ReturnType<SupabaseDatabaseModule["dbInsertMasterStorageLocation"]>
export const dbDeleteMasterRow: SupabaseDatabaseModule["dbDeleteMasterRow"] = (...args) => routeOperation("dbDeleteMasterRow", args) as ReturnType<SupabaseDatabaseModule["dbDeleteMasterRow"]>
export const dbGetCurrencies: SupabaseDatabaseModule["dbGetCurrencies"] = (...args) => routeOperation("dbGetCurrencies", args) as ReturnType<SupabaseDatabaseModule["dbGetCurrencies"]>
export const dbGetOverrides: SupabaseDatabaseModule["dbGetOverrides"] = (...args) => routeOperation("dbGetOverrides", args) as ReturnType<SupabaseDatabaseModule["dbGetOverrides"]>
export const dbUpdateCurrencyRate: SupabaseDatabaseModule["dbUpdateCurrencyRate"] = (...args) => routeOperation("dbUpdateCurrencyRate", args) as ReturnType<SupabaseDatabaseModule["dbUpdateCurrencyRate"]>
export const dbRecordRateHistory: SupabaseDatabaseModule["dbRecordRateHistory"] = (...args) => routeOperation("dbRecordRateHistory", args) as ReturnType<SupabaseDatabaseModule["dbRecordRateHistory"]>
export const dbSetManualOverride: SupabaseDatabaseModule["dbSetManualOverride"] = (...args) => routeOperation("dbSetManualOverride", args) as ReturnType<SupabaseDatabaseModule["dbSetManualOverride"]>
export const dbSetAutomaticMode: SupabaseDatabaseModule["dbSetAutomaticMode"] = (...args) => routeOperation("dbSetAutomaticMode", args) as ReturnType<SupabaseDatabaseModule["dbSetAutomaticMode"]>
export const dbGetRateAuditLog: SupabaseDatabaseModule["dbGetRateAuditLog"] = (...args) => routeOperation("dbGetRateAuditLog", args) as ReturnType<SupabaseDatabaseModule["dbGetRateAuditLog"]>
export const dbAddCurrency: SupabaseDatabaseModule["dbAddCurrency"] = (...args) => routeOperation("dbAddCurrency", args) as ReturnType<SupabaseDatabaseModule["dbAddCurrency"]>
export const dbToggleCurrencyActive: SupabaseDatabaseModule["dbToggleCurrencyActive"] = (...args) => routeOperation("dbToggleCurrencyActive", args) as ReturnType<SupabaseDatabaseModule["dbToggleCurrencyActive"]>
export const dbRecordRateAuditLog: SupabaseDatabaseModule["dbRecordRateAuditLog"] = (...args) => routeOperation("dbRecordRateAuditLog", args) as ReturnType<SupabaseDatabaseModule["dbRecordRateAuditLog"]>
export const dbDeleteCurrency: SupabaseDatabaseModule["dbDeleteCurrency"] = (...args) => routeOperation("dbDeleteCurrency", args) as ReturnType<SupabaseDatabaseModule["dbDeleteCurrency"]>
export const dbCompleteSale: SupabaseDatabaseModule["dbCompleteSale"] = (...args) => routeOperation("dbCompleteSale", args) as ReturnType<SupabaseDatabaseModule["dbCompleteSale"]>
export const dbRegisterPayment: SupabaseDatabaseModule["dbRegisterPayment"] = (...args) => routeOperation("dbRegisterPayment", args) as ReturnType<SupabaseDatabaseModule["dbRegisterPayment"]>
export const dbUpdateWeaponStatus: SupabaseDatabaseModule["dbUpdateWeaponStatus"] = (...args) => routeOperation("dbUpdateWeaponStatus", args) as ReturnType<SupabaseDatabaseModule["dbUpdateWeaponStatus"]>
export const dbUpdateWeaponNotes: SupabaseDatabaseModule["dbUpdateWeaponNotes"] = (...args) => routeOperation("dbUpdateWeaponNotes", args) as ReturnType<SupabaseDatabaseModule["dbUpdateWeaponNotes"]>
export const dbUpdateWeaponLocation: SupabaseDatabaseModule["dbUpdateWeaponLocation"] = (...args) => routeOperation("dbUpdateWeaponLocation", args) as ReturnType<SupabaseDatabaseModule["dbUpdateWeaponLocation"]>
export const dbAppendWeaponImage: SupabaseDatabaseModule["dbAppendWeaponImage"] = (...args) => routeOperation("dbAppendWeaponImage", args) as ReturnType<SupabaseDatabaseModule["dbAppendWeaponImage"]>
export const dbBindWeaponToShipment: SupabaseDatabaseModule["dbBindWeaponToShipment"] = (...args) => routeOperation("dbBindWeaponToShipment", args) as ReturnType<SupabaseDatabaseModule["dbBindWeaponToShipment"]>
export const dbSetShipmentStatus: SupabaseDatabaseModule["dbSetShipmentStatus"] = (...args) => routeOperation("dbSetShipmentStatus", args) as ReturnType<SupabaseDatabaseModule["dbSetShipmentStatus"]>
export const dbUpdateShipmentDetails: SupabaseDatabaseModule["dbUpdateShipmentDetails"] = (...args) => routeOperation("dbUpdateShipmentDetails", args) as ReturnType<SupabaseDatabaseModule["dbUpdateShipmentDetails"]>
export const dbDeleteShipment: SupabaseDatabaseModule["dbDeleteShipment"] = (...args) => routeOperation("dbDeleteShipment", args) as ReturnType<SupabaseDatabaseModule["dbDeleteShipment"]>
export const dbAddShipmentDocument: SupabaseDatabaseModule["dbAddShipmentDocument"] = (...args) => routeOperation("dbAddShipmentDocument", args) as ReturnType<SupabaseDatabaseModule["dbAddShipmentDocument"]>
export const dbDeleteShipmentDocument: SupabaseDatabaseModule["dbDeleteShipmentDocument"] = (...args) => routeOperation("dbDeleteShipmentDocument", args) as ReturnType<SupabaseDatabaseModule["dbDeleteShipmentDocument"]>
export const dbAddShipmentTimelineEvent: SupabaseDatabaseModule["dbAddShipmentTimelineEvent"] = (...args) => routeOperation("dbAddShipmentTimelineEvent", args) as ReturnType<SupabaseDatabaseModule["dbAddShipmentTimelineEvent"]>
export const dbUpdateInvoiceNotes: SupabaseDatabaseModule["dbUpdateInvoiceNotes"] = (...args) => routeOperation("dbUpdateInvoiceNotes", args) as ReturnType<SupabaseDatabaseModule["dbUpdateInvoiceNotes"]>
export const dbUpdateInventoryProduct: SupabaseDatabaseModule["dbUpdateInventoryProduct"] = (...args) => routeOperation("dbUpdateInventoryProduct", args) as ReturnType<SupabaseDatabaseModule["dbUpdateInventoryProduct"]>
export const dbBulkIntakeWeapons: SupabaseDatabaseModule["dbBulkIntakeWeapons"] = (...args) => routeOperation("dbBulkIntakeWeapons", args) as ReturnType<SupabaseDatabaseModule["dbBulkIntakeWeapons"]>
export const dbCreateShipmentRpc: SupabaseDatabaseModule["dbCreateShipmentRpc"] = (...args) => routeOperation("dbCreateShipmentRpc", args) as ReturnType<SupabaseDatabaseModule["dbCreateShipmentRpc"]>
export const dbBulkCreateShipment: SupabaseDatabaseModule["dbBulkCreateShipment"] = (...args) => routeOperation("dbBulkCreateShipment", args) as ReturnType<SupabaseDatabaseModule["dbBulkCreateShipment"]>
export const dbReceiveScheduledShipment: SupabaseDatabaseModule["dbReceiveScheduledShipment"] = (...args) => routeOperation("dbReceiveScheduledShipment", args) as ReturnType<SupabaseDatabaseModule["dbReceiveScheduledShipment"]>
export const dbRescheduleShipment: SupabaseDatabaseModule["dbRescheduleShipment"] = (...args) => routeOperation("dbRescheduleShipment", args) as ReturnType<SupabaseDatabaseModule["dbRescheduleShipment"]>
export const dbUpdateScheduledShipment: SupabaseDatabaseModule["dbUpdateScheduledShipment"] = (...args) => routeOperation("dbUpdateScheduledShipment", args) as ReturnType<SupabaseDatabaseModule["dbUpdateScheduledShipment"]>
export const dbAdjustInventoryStock: SupabaseDatabaseModule["dbAdjustInventoryStock"] = (...args) => routeOperation("dbAdjustInventoryStock", args) as ReturnType<SupabaseDatabaseModule["dbAdjustInventoryStock"]>
export const dbReceiveAmmoByPackages: SupabaseDatabaseModule["dbReceiveAmmoByPackages"] = (...args) => routeOperation("dbReceiveAmmoByPackages", args) as ReturnType<SupabaseDatabaseModule["dbReceiveAmmoByPackages"]>
export const dbReceiveAmmoByRounds: SupabaseDatabaseModule["dbReceiveAmmoByRounds"] = (...args) => routeOperation("dbReceiveAmmoByRounds", args) as ReturnType<SupabaseDatabaseModule["dbReceiveAmmoByRounds"]>
export const dbUpdateAmmoPackage: SupabaseDatabaseModule["dbUpdateAmmoPackage"] = (...args) => routeOperation("dbUpdateAmmoPackage", args) as ReturnType<SupabaseDatabaseModule["dbUpdateAmmoPackage"]>
export const dbExtendInvoiceDueDate: SupabaseDatabaseModule["dbExtendInvoiceDueDate"] = (...args) => routeOperation("dbExtendInvoiceDueDate", args) as ReturnType<SupabaseDatabaseModule["dbExtendInvoiceDueDate"]>
export const dbVoidInvoice: SupabaseDatabaseModule["dbVoidInvoice"] = (...args) => routeOperation("dbVoidInvoice", args) as ReturnType<SupabaseDatabaseModule["dbVoidInvoice"]>
export const dbCreateAccessory: SupabaseDatabaseModule["dbCreateAccessory"] = (...args) => routeOperation("dbCreateAccessory", args) as ReturnType<SupabaseDatabaseModule["dbCreateAccessory"]>
export const dbCreateAmmunition: SupabaseDatabaseModule["dbCreateAmmunition"] = (...args) => routeOperation("dbCreateAmmunition", args) as ReturnType<SupabaseDatabaseModule["dbCreateAmmunition"]>
export const dbCreateInventoryProductType: SupabaseDatabaseModule["dbCreateInventoryProductType"] = (...args) => routeOperation("dbCreateInventoryProductType", args) as ReturnType<SupabaseDatabaseModule["dbCreateInventoryProductType"]>
export const dbUpdateProductPricing: SupabaseDatabaseModule["dbUpdateProductPricing"] = (...args) => routeOperation("dbUpdateProductPricing", args) as ReturnType<SupabaseDatabaseModule["dbUpdateProductPricing"]>
export const dbReplaceProductCosts: SupabaseDatabaseModule["dbReplaceProductCosts"] = (...args) => routeOperation("dbReplaceProductCosts", args) as ReturnType<SupabaseDatabaseModule["dbReplaceProductCosts"]>
export const dbResetDemoData: SupabaseDatabaseModule["dbResetDemoData"] = (...args) => routeOperation("dbResetDemoData", args) as ReturnType<SupabaseDatabaseModule["dbResetDemoData"]>
export const dbDeleteDemoData: SupabaseDatabaseModule["dbDeleteDemoData"] = (...args) => routeOperation("dbDeleteDemoData", args) as ReturnType<SupabaseDatabaseModule["dbDeleteDemoData"]>
