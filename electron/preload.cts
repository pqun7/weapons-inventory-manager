import { contextBridge, ipcRenderer } from "electron"


export const electronAPI = {
  db: {
    getAll: () => ipcRenderer.invoke("db:getAll"),
    getMasterData: () => ipcRenderer.invoke("db:getMasterData"),
    getSettings: () => ipcRenderer.invoke("db:getSettings"),
    getUserPreferences: (userId: string) => ipcRenderer.invoke("db:getUserPreferences", userId),
    getCurrencies: () => ipcRenderer.invoke("db:getCurrencies"),
    getOverrides: () => ipcRenderer.invoke("db:getOverrides"),
    getRateAuditLog: (limit: number) => ipcRenderer.invoke("db:getRateAuditLog", limit),
    listBackups: () => ipcRenderer.invoke("db:listBackups"),
    createBackup: () => ipcRenderer.invoke("db:createBackup"),
    restoreBackup: (fileName: string) => ipcRenderer.invoke("db:restoreBackup", fileName),
    deleteBackup: (fileName: string) => ipcRenderer.invoke("db:deleteBackup", fileName),
  },
  masterData: {
    insertWeaponType: (label: string, sortOrder: number) => ipcRenderer.invoke("masterData:insertWeaponType", label, sortOrder),
    insertWeaponSubtype: (weaponTypeId: string, label: string, sortOrder: number) => ipcRenderer.invoke("masterData:insertWeaponSubtype", weaponTypeId, label, sortOrder),
    insertCaliber: (label: string) => ipcRenderer.invoke("masterData:insertCaliber", label),
    linkSubtypeCaliber: (subtypeId: string, caliberId: string) => ipcRenderer.invoke("masterData:linkSubtypeCaliber", subtypeId, caliberId),
    insertBrand: (label: string) => ipcRenderer.invoke("masterData:insertBrand", label),
    insertModel: (label: string, brandId: string | null) => ipcRenderer.invoke("masterData:insertModel", label, brandId),
    insertWarehouse: (label: string) => ipcRenderer.invoke("masterData:insertWarehouse", label),
    insertStorageLocation: (warehouseId: string, shelf: string, bin: string) => ipcRenderer.invoke("masterData:insertStorageLocation", warehouseId, shelf, bin),
    deleteRow: (table: string, id: string) => ipcRenderer.invoke("masterData:deleteRow", table, id),
  },
  settings: {
    update: (updates: Record<string, unknown>) => ipcRenderer.invoke("settings:update", updates),
  },
  userPreferences: {
    upsert: (prefs: Record<string, unknown>) => ipcRenderer.invoke("userPreferences:upsert", prefs),
  },
  weapon: {
    bulkInsert: (input: unknown, currentUser: { id: string; name: string }) => ipcRenderer.invoke("weapon:bulkInsert", input, currentUser),
    update: (weapon: unknown) => ipcRenderer.invoke("weapon:update", weapon),
    updateStatus: (weaponId: string, status: string, reason: string, currentUser: { id: string; name: string }) => ipcRenderer.invoke("weapon:updateStatus", weaponId, status, reason, currentUser),
  },
  sale: {
    complete: (input: unknown, currentUser: { id: string; name: string }) => ipcRenderer.invoke("sale:complete", input, currentUser),
  },
  shipment: {
    create: (input: unknown, currentUser: { id: string; name: string }) => ipcRenderer.invoke("shipment:create", input, currentUser),
    bulkCreate: (input: unknown, currentUser: { id: string; name: string }) => ipcRenderer.invoke("shipment:bulkCreate", input, currentUser),
    update: (shipment: unknown) => ipcRenderer.invoke("shipment:update", shipment),
  },
  invoice: {
    update: (invoice: unknown) => ipcRenderer.invoke("invoice:update", invoice),
    void: (invoiceId: string, currentUser: { id: string; name: string }) => ipcRenderer.invoke("invoice:void", invoiceId, currentUser),
    extendDueDate: (input: unknown, currentUser: { id: string; name: string }) => ipcRenderer.invoke("invoice:extendDueDate", input, currentUser),
  },
  payment: {
    register: (input: unknown, currentUser: { id: string; name: string }) => ipcRenderer.invoke("payment:register", input, currentUser),
  },
  customer: {
    insert: (customer: unknown) => ipcRenderer.invoke("customer:insert", customer),
    delete: (customerId: string) => ipcRenderer.invoke("customer:delete", customerId),
  },
  supplier: {
    insert: (supplier: unknown) => ipcRenderer.invoke("supplier:insert", supplier),
  },
  accessory: {
    insert: (accessory: unknown) => ipcRenderer.invoke("accessory:insert", accessory),
    update: (accessory: unknown) => ipcRenderer.invoke("accessory:update", accessory),
  },
  ammunition: {
    insert: (ammo: unknown) => ipcRenderer.invoke("ammunition:insert", ammo),
    update: (ammo: unknown) => ipcRenderer.invoke("ammunition:update", ammo),
  },
  inventory: {
    addStock: (input: unknown, currentUser: { id: string; name: string }) => ipcRenderer.invoke("inventory:addStock", input, currentUser),
    receiveAmmoByPackages: (input: unknown, currentUser: { id: string; name: string }) => ipcRenderer.invoke("inventory:receiveAmmoByPackages", input, currentUser),
    receiveAmmoByRounds: (input: unknown, currentUser: { id: string; name: string }) => ipcRenderer.invoke("inventory:receiveAmmoByRounds", input, currentUser),
    sellAmmo: (input: unknown) => ipcRenderer.invoke("inventory:sellAmmo", input),
    updateAmmoPackage: (input: unknown, currentUser: { id: string; name: string }) => ipcRenderer.invoke("inventory:updateAmmoPackage", input, currentUser),
  },
  user: {
    insert: (user: unknown) => ipcRenderer.invoke("user:insert", user),
    update: (user: unknown) => ipcRenderer.invoke("user:update", user),
    delete: (id: string) => ipcRenderer.invoke("user:delete", id),
  },
  notification: {
    update: (n: unknown) => ipcRenderer.invoke("notification:update", n),
    delete: (id: string) => ipcRenderer.invoke("notification:delete", id),
  },
  auditLog: {
    insert: (a: unknown) => ipcRenderer.invoke("auditLog:insert", a),
  },
  savedFilter: {
    insert: (f: unknown) => ipcRenderer.invoke("savedFilter:insert", f),
    delete: (id: string) => ipcRenderer.invoke("savedFilter:delete", id),
  },
  currency: {
    updateRate: (code: string, rate: number, updatedAt: string) => ipcRenderer.invoke("currency:updateRate", code, rate, updatedAt),
    recordRateHistory: (code: string, rate: number, source: string) => ipcRenderer.invoke("currency:recordRateHistory", code, rate, source),
    setManualOverride: (code: string, rate: number, changedBy: string, reason: string, updatedAt: string) => ipcRenderer.invoke("currency:setManualOverride", code, rate, changedBy, reason, updatedAt),
    setAutomatic: (code: string, changedBy: string, updatedAt: string) => ipcRenderer.invoke("currency:setAutomatic", code, changedBy, updatedAt),
    add: (isoCode: string, name: string, symbol: string, decimalPrecision: number, initialRate: number) => ipcRenderer.invoke("currency:add", isoCode, name, symbol, decimalPrecision, initialRate),
    toggleActive: (code: string, isActive: boolean) => ipcRenderer.invoke("currency:toggleActive", code, isActive),
    recordRateAuditLog: (code: string, oldRate: number | null, newRate: number | null, changedBy: string, reason: string, changedAt: string) => ipcRenderer.invoke("currency:recordRateAuditLog", code, oldRate, newRate, changedBy, reason, changedAt),
  },
}

contextBridge.exposeInMainWorld("electronAPI", electronAPI)
