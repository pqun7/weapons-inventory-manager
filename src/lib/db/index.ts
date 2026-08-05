import type { DbResult, AllData, MasterDataAll, CurrencyRow, ExchangeRateOverrideRow, AuditLogEntry, DatabaseBackupInfo } from "./types.js"
import type {
  Weapon, Accessory, Ammunition, Shipment, Invoice, PaymentRecord,
  Customer, Supplier, AuditLog, AppNotification, User, SystemSettings, SavedFilter,
} from "../types.js"
import type { UserPreferences } from "../types.js"

declare const window: any

function isElectron(): boolean {
  return typeof window !== "undefined" && typeof (window as any).electronAPI?.db?.getAll === "function"
}

function getElectronAPI(): any {
  if (!isElectron()) throw new Error("Database access requires the Electron environment. The renderer must not access the database directly.")
  return (window as any).electronAPI
}

export async function initDb(): Promise<void> {
  if (!isElectron()) throw new Error("initDb: Electron environment required")
}

export function isDbReady(): boolean {
  return isElectron()
}

export type { DbResult, AllData, MasterDataAll, CurrencyRow, ExchangeRateOverrideRow, AuditLogEntry, DatabaseBackupInfo }

function unwrap<T>(result: { success: boolean; data?: T; error?: string }): T {
  if (!result.success) throw new Error(result.error)
  return result.data as T
}

export async function dbGetAll(): Promise<AllData> {
  return unwrap<AllData>(await getElectronAPI().db.getAll())
}

export async function dbGetMasterData(): Promise<MasterDataAll> {
  const api = getElectronAPI()
  if (typeof api.db.getMasterData === "function") {
    return unwrap<MasterDataAll>(await api.db.getMasterData())
  }
  return { weaponTypes: [], weaponSubtypes: [], calibers: [], subtypeCalibers: [], brands: [], models: [], warehouses: [], storageLocations: [] }
}

export async function dbGetSettings(): Promise<SystemSettings> {
  return unwrap<SystemSettings>(await getElectronAPI().db.getSettings())
}

export async function dbUpdateSettings(s: SystemSettings): Promise<void> {
  await getElectronAPI().settings.update(s)
}

export async function dbGetUserPreferences(userId: string): Promise<UserPreferences | null> {
  return unwrap<UserPreferences | null>(await getElectronAPI().db.getUserPreferences(userId))
}

export async function dbUpsertUserPreferences(p: UserPreferences): Promise<void> {
  await getElectronAPI().userPreferences.upsert(p)
}

export async function dbInsertWeapon(w: Weapon): Promise<void> {
  await getElectronAPI().weapon.update(w)
}

export async function dbBulkInsertWeapons(_weapons: Weapon[]): Promise<void> {
  // In Electron, bulk inserts go through the weapon:bulkInsert IPC channel
  // which is called directly from the store. This function is a no-op fallback
  // for any code that still calls it — the actual bulk insert is handled
  // by the store's addBulkWeapons method via IPC.
}

export async function dbUpdateWeapon(w: Weapon): Promise<void> {
  await getElectronAPI().weapon.update(w)
}

export async function dbInsertShipment(s: Shipment): Promise<void> {
  await getElectronAPI().shipment.update(s)
}

export async function dbUpdateShipment(s: Shipment): Promise<void> {
  await getElectronAPI().shipment.update(s)
}

export async function dbInsertInvoice(inv: Invoice): Promise<void> {
  await getElectronAPI().invoice.update(inv)
}

export async function dbUpdateInvoice(inv: Invoice): Promise<void> {
  await getElectronAPI().invoice.update(inv)
}

export async function dbInsertPayment(_p: PaymentRecord): Promise<void> {
  // Payments are registered through the payment:register IPC channel
  // which is called from the store. This function is kept for compatibility
  // but the actual payment registration goes through IPC.
}

export async function dbInsertAccessory(a: Accessory): Promise<void> {
  await getElectronAPI().accessory.insert(a)
}

export async function dbUpdateAccessory(a: Accessory): Promise<void> {
  await getElectronAPI().accessory.update(a)
}

export async function dbInsertAmmunition(a: Ammunition): Promise<void> {
  await getElectronAPI().ammunition.insert(a)
}

export async function dbUpdateAmmunition(a: Ammunition): Promise<void> {
  await getElectronAPI().ammunition.update(a)
}

export async function dbInsertCustomer(c: Customer): Promise<void> {
  await getElectronAPI().customer.insert(c)
}

export async function dbDeleteCustomer(id: string): Promise<void> {
  await getElectronAPI().customer.delete(id)
}

export async function dbInsertSupplier(s: Supplier): Promise<void> {
  await getElectronAPI().supplier.insert(s)
}

export async function dbInsertAuditLog(a: AuditLog): Promise<void> {
  await getElectronAPI().auditLog.insert(a)
}

export async function dbInsertNotification(_n: AppNotification): Promise<void> {
  // Notifications are inserted via IPC handlers during mutations
  // This function is kept for compatibility but is a no-op in Electron mode
}

export async function dbUpdateNotification(n: AppNotification): Promise<void> {
  await getElectronAPI().notification.update(n)
}

export async function dbInsertUser(u: User): Promise<void> {
  await getElectronAPI().user.insert(u)
}

export async function dbUpdateUser(u: User): Promise<void> {
  await getElectronAPI().user.update(u)
}

export async function dbDeleteUser(id: string): Promise<void> {
  await getElectronAPI().user.delete(id)
}

export async function dbInsertSavedFilter(f: SavedFilter): Promise<void> {
  await getElectronAPI().savedFilter.insert(f)
}

export async function dbDeleteSavedFilter(id: string): Promise<void> {
  await getElectronAPI().savedFilter.delete(id)
}

export async function dbInsertMasterWeaponType(label: string, sortOrder: number): Promise<string> {
  return unwrap<string>(await getElectronAPI().masterData.insertWeaponType(label, sortOrder))
}

export async function dbInsertMasterWeaponSubtype(weaponTypeId: string, label: string, sortOrder: number): Promise<string> {
  return unwrap<string>(await getElectronAPI().masterData.insertWeaponSubtype(weaponTypeId, label, sortOrder))
}

export async function dbInsertMasterCaliber(label: string): Promise<string> {
  return unwrap<string>(await getElectronAPI().masterData.insertCaliber(label))
}

export async function dbLinkSubtypeCaliber(subtypeId: string, caliberId: string): Promise<void> {
  await getElectronAPI().masterData.linkSubtypeCaliber(subtypeId, caliberId)
}

export async function dbInsertMasterBrand(label: string): Promise<string> {
  return unwrap<string>(await getElectronAPI().masterData.insertBrand(label))
}

export async function dbInsertMasterModel(label: string, brandId: string | null): Promise<string> {
  return unwrap<string>(await getElectronAPI().masterData.insertModel(label, brandId))
}

export async function dbInsertMasterWarehouse(label: string): Promise<string> {
  return unwrap<string>(await getElectronAPI().masterData.insertWarehouse(label))
}

export async function dbInsertMasterStorageLocation(warehouseId: string, shelf: string, bin: string): Promise<string> {
  return unwrap<string>(await getElectronAPI().masterData.insertStorageLocation(warehouseId, shelf, bin))
}

export async function dbDeleteMasterRow(table: string, id: string): Promise<void> {
  await getElectronAPI().masterData.deleteRow(table, id)
}

export async function dbGetCurrencies(): Promise<CurrencyRow[]> {
  return unwrap<CurrencyRow[]>(await getElectronAPI().db.getCurrencies())
}

export async function dbGetOverrides(): Promise<ExchangeRateOverrideRow[]> {
  return unwrap<ExchangeRateOverrideRow[]>(await getElectronAPI().db.getOverrides())
}

export async function dbUpdateCurrencyRate(code: string, rate: number, updatedAt: string): Promise<void> {
  await getElectronAPI().currency.updateRate(code, rate, updatedAt)
}

export async function dbRecordRateHistory(code: string, rate: number, source: string): Promise<void> {
  await getElectronAPI().currency.recordRateHistory(code, rate, source)
}

export async function dbSetManualOverride(code: string, rate: number, changedBy: string, reason: string, updatedAt: string): Promise<void> {
  await getElectronAPI().currency.setManualOverride(code, rate, changedBy, reason, updatedAt)
}

export async function dbSetAutomaticMode(code: string, changedBy: string, updatedAt: string): Promise<void> {
  await getElectronAPI().currency.setAutomatic(code, changedBy, updatedAt)
}

export async function dbGetRateAuditLog(limit: number = 50): Promise<AuditLogEntry[]> {
  return unwrap<AuditLogEntry[]>(await getElectronAPI().db.getRateAuditLog(limit))
}

export async function dbListBackups(): Promise<DatabaseBackupInfo[]> {
  return unwrap<DatabaseBackupInfo[]>(await getElectronAPI().db.listBackups())
}

export async function dbCreateBackup(): Promise<DatabaseBackupInfo> {
  return unwrap<DatabaseBackupInfo>(await getElectronAPI().db.createBackup())
}

export async function dbRestoreBackup(fileName: string): Promise<void> {
  await getElectronAPI().db.restoreBackup(fileName)
}

export async function dbDeleteBackup(fileName: string): Promise<void> {
  await getElectronAPI().db.deleteBackup(fileName)
}

export async function dbAddCurrency(isoCode: string, name: string, symbol: string, decimalPrecision: number, initialRate: number): Promise<void> {
  await getElectronAPI().currency.add(isoCode, name, symbol, decimalPrecision, initialRate)
}

export async function dbToggleCurrencyActive(code: string, isActive: boolean): Promise<void> {
  await getElectronAPI().currency.toggleActive(code, isActive)
}

export async function dbRecordRateAuditLog(code: string, oldRate: number | null, newRate: number | null, changedBy: string, reason: string, changedAt: string): Promise<void> {
  await getElectronAPI().currency.recordRateAuditLog(code, oldRate, newRate, changedBy, reason, changedAt)
}

export async function seedDemoDataIfNeeded(): Promise<void> {
  const api = getElectronAPI()
  if (typeof api.db.seedDemoData !== "function") return
  const result = await api.db.seedDemoData()
  return unwrap<void>(result)
}
