export interface IpcResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface ElectronAPI {
  db: {
    getAll: () => Promise<IpcResult>
    getMasterData: () => Promise<IpcResult>
    getSettings: () => Promise<IpcResult>
    getUserPreferences: (userId: string) => Promise<IpcResult>
    getCurrencies: () => Promise<IpcResult>
    getOverrides: () => Promise<IpcResult>
    getRateAuditLog: (limit: number) => Promise<IpcResult>
    seedDemoData: () => Promise<IpcResult>
    resetBusinessData: () => Promise<IpcResult>
  }
  masterData: {
    insertWeaponType: (label: string, sortOrder: number) => Promise<IpcResult>
    insertWeaponSubtype: (weaponTypeId: string, label: string, sortOrder: number) => Promise<IpcResult>
    insertCaliber: (label: string) => Promise<IpcResult>
    linkSubtypeCaliber: (subtypeId: string, caliberId: string) => Promise<IpcResult>
    insertBrand: (label: string) => Promise<IpcResult>
    insertModel: (label: string, brandId: string | null) => Promise<IpcResult>
    insertWarehouse: (label: string) => Promise<IpcResult>
    insertStorageLocation: (warehouseId: string, shelf: string, bin: string) => Promise<IpcResult>
    deleteRow: (table: string, id: string) => Promise<IpcResult>
  }
  settings: {
    update: (updates: Record<string, unknown>) => Promise<IpcResult>
  }
  userPreferences: {
    upsert: (prefs: Record<string, unknown>) => Promise<IpcResult>
  }
  weapon: {
    bulkInsert: (input: unknown, currentUser: { id: string; name: string }) => Promise<IpcResult>
    update: (weapon: unknown) => Promise<IpcResult>
    updateStatus: (weaponId: string, status: string, reason: string, currentUser: { id: string; name: string }) => Promise<IpcResult>
  }
  sale: {
    complete: (input: unknown, currentUser: { id: string; name: string }) => Promise<IpcResult>
  }
  shipment: {
    create: (input: unknown, currentUser: { id: string; name: string }) => Promise<IpcResult>
    bulkCreate: (input: unknown, currentUser: { id: string; name: string }) => Promise<IpcResult>
    update: (shipment: unknown) => Promise<IpcResult>
  }
  invoice: {
    update: (invoice: unknown) => Promise<IpcResult>
    void: (invoiceId: string, currentUser: { id: string; name: string }) => Promise<IpcResult>
    extendDueDate: (input: unknown, currentUser: { id: string; name: string }) => Promise<IpcResult>
  }
  payment: {
    register: (input: unknown, currentUser: { id: string; name: string }) => Promise<IpcResult>
  }
  customer: {
    insert: (customer: unknown) => Promise<IpcResult>
    delete: (customerId: string) => Promise<IpcResult>
  }
  supplier: {
    insert: (supplier: unknown) => Promise<IpcResult>
  }
  accessory: {
    insert: (accessory: unknown) => Promise<IpcResult>
    update: (accessory: unknown) => Promise<IpcResult>
  }
  ammunition: {
    insert: (ammo: unknown) => Promise<IpcResult>
    update: (ammo: unknown) => Promise<IpcResult>
  }
  inventory: {
    addStock: (input: unknown, currentUser: { id: string; name: string }) => Promise<IpcResult>
    receiveAmmoByPackages: (input: unknown, currentUser: { id: string; name: string }) => Promise<IpcResult>
    receiveAmmoByRounds: (input: unknown, currentUser: { id: string; name: string }) => Promise<IpcResult>
    sellAmmo: (input: unknown, currentUser: { id: string; name: string }) => Promise<IpcResult>
    updateAmmoPackage: (input: unknown, currentUser: { id: string; name: string }) => Promise<IpcResult>
  }
  user: {
    insert: (user: unknown) => Promise<IpcResult>
    update: (user: unknown) => Promise<IpcResult>
    delete: (id: string) => Promise<IpcResult>
  }
  notification: {
    update: (n: unknown) => Promise<IpcResult>
    delete: (id: string) => Promise<IpcResult>
  }
  auditLog: {
    insert: (a: unknown) => Promise<IpcResult>
  }
  savedFilter: {
    insert: (f: unknown) => Promise<IpcResult>
    delete: (id: string) => Promise<IpcResult>
  }
  currency: {
    updateRate: (code: string, rate: number, updatedAt: string) => Promise<IpcResult>
    recordRateHistory: (code: string, rate: number, source: string) => Promise<IpcResult>
    setManualOverride: (code: string, rate: number, changedBy: string, reason: string, updatedAt: string) => Promise<IpcResult>
    setAutomatic: (code: string, changedBy: string, updatedAt: string) => Promise<IpcResult>
    add: (isoCode: string, name: string, symbol: string, decimalPrecision: number, initialRate: number) => Promise<IpcResult>
    toggleActive: (code: string, isActive: boolean) => Promise<IpcResult>
    recordRateAuditLog: (code: string, oldRate: number | null, newRate: number | null, changedBy: string, reason: string, changedAt: string) => Promise<IpcResult>
  }
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
