import { useState, useEffect, useCallback, useMemo } from "react"
import { toast } from "sonner"

function labelsEqual(left: string, right: string): boolean {
  return left.trim().localeCompare(right.trim(), undefined, { sensitivity: "accent" }) === 0
}

export interface MasterWeaponType {
  id: string
  label: string
  sort_order: number
}

export interface MasterWeaponSubtype {
  id: string
  weapon_type_id: string
  label: string
  sort_order: number
}

export interface MasterCaliber {
  id: string
  label: string
}

export interface MasterSubtypeCaliber {
  subtype_id: string
  caliber_id: string
}

export interface MasterBrand {
  id: string
  label: string
}

export interface MasterModel {
  id: string
  label: string
  brand_id: string | null
}

export interface MasterWarehouse {
  id: string
  label: string
}

export interface MasterStorageLocation {
  id: string
  warehouse_id: string
  shelf: string
  bin: string
}

export interface DynamicMasterData {
  loading: boolean
  error: string | null
  weaponTypes: MasterWeaponType[]
  weaponSubtypes: MasterWeaponSubtype[]
  calibers: MasterCaliber[]
  subtypeCalibers: MasterSubtypeCaliber[]
  brands: MasterBrand[]
  models: MasterModel[]
  warehouses: MasterWarehouse[]
  storageLocations: MasterStorageLocation[]
  weaponTypeLabels: string[]
  brandLabels: string[]
  modelLabels: string[]
  warehouseLabels: string[]
  caliberLabels: string[]
  getSubtypesFor: (weaponTypeLabel: string) => string[]
  getCalibersFor: (weaponTypeLabel: string, subtypeLabel: string) => string[]
  getShelvesFor: (warehouseLabel: string) => string[]
  getBinsFor: (warehouseLabel: string, shelf: string) => string[]
  // New label → ID lookups
  getWeaponTypeIdByLabel: (label: string) => string | undefined
  getWeaponSubtypeIdByLabel: (label: string, typeId?: string) => string | undefined
  getCaliberIdByLabel: (label: string) => string | undefined
  getBrandIdByLabel: (label: string) => string | undefined
  getModelIdByLabel: (label: string, brandId?: string) => string | undefined
  getWarehouseIdByLabel: (label: string) => string | undefined
  getStorageLocationId: (warehouseLabel: string, shelf: string, bin: string) => string | undefined
  // CRUD
  createWeaponType: (label: string) => Promise<string>
  createWeaponSubtype: (weaponTypeLabel: string, label: string) => Promise<string>
  createCaliber: (label: string) => Promise<string>
  linkSubtypeCaliber: (subtypeId: string, caliberId: string) => Promise<void>
  createBrand: (label: string) => Promise<string>
  createModel: (label: string, brandLabel?: string) => Promise<string>
  createWarehouse: (label: string) => Promise<void>
  createStorageLocation: (warehouseLabel: string, shelf: string, bin: string) => Promise<void>
  deleteWeaponType: (id: string) => Promise<void>
  deleteWeaponSubtype: (id: string) => Promise<void>
  deleteCaliber: (id: string) => Promise<void>
  deleteBrand: (id: string) => Promise<void>
  deleteModel: (id: string) => Promise<void>
  deleteWarehouse: (id: string) => Promise<void>
  deleteStorageLocation: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

export function useDynamicMasterData(): DynamicMasterData {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [weaponTypes, setWeaponTypes] = useState<MasterWeaponType[]>([])
  const [weaponSubtypes, setWeaponSubtypes] = useState<MasterWeaponSubtype[]>([])
  const [calibers, setCalibers] = useState<MasterCaliber[]>([])
  const [subtypeCalibers, setSubtypeCalibers] = useState<MasterSubtypeCaliber[]>([])
  const [brands, setBrands] = useState<MasterBrand[]>([])
  const [models, setModels] = useState<MasterModel[]>([])
  const [warehouses, setWarehouses] = useState<MasterWarehouse[]>([])
  const [storageLocations, setStorageLocations] = useState<MasterStorageLocation[]>([])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { dbGetMasterData } = await import("@/lib/db")
      const data = await dbGetMasterData()
      setWeaponTypes(data.weaponTypes)
      setWeaponSubtypes(data.weaponSubtypes)
      setCalibers(data.calibers)
      setSubtypeCalibers(data.subtypeCalibers)
      setBrands(data.brands)
      setModels(data.models)
      setWarehouses(data.warehouses)
      setStorageLocations(data.storageLocations)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load master data"
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const weaponTypeLabels = useMemo(() => weaponTypes.map(t => t.label), [weaponTypes])
  const brandLabels = useMemo(() => brands.map(b => b.label), [brands])
  const modelLabels = useMemo(() => models.map(m => m.label), [models])
  const warehouseLabels = useMemo(() => warehouses.map(w => w.label), [warehouses])
  const caliberLabels = useMemo(() => calibers.map(c => c.label), [calibers])

  const getSubtypesFor = useCallback((weaponTypeLabel: string): string[] => {
    const wt = weaponTypes.find(t => labelsEqual(t.label, weaponTypeLabel))
    if (!wt) return []
    return weaponSubtypes.filter(s => s.weapon_type_id === wt.id).map(s => s.label)
  }, [weaponTypes, weaponSubtypes])

  const getCalibersFor = useCallback((weaponTypeLabel: string, subtypeLabel: string): string[] => {
    const wt = weaponTypes.find(t => labelsEqual(t.label, weaponTypeLabel))
    if (!wt) return []
    const st = weaponSubtypes.find(s => s.weapon_type_id === wt.id && labelsEqual(s.label, subtypeLabel))
    if (!st) return []
    const linkedIds = new Set(subtypeCalibers.filter(sc => sc.subtype_id === st.id).map(sc => sc.caliber_id))
    return calibers.filter(c => linkedIds.has(c.id)).map(c => c.label)
  }, [weaponTypes, weaponSubtypes, subtypeCalibers, calibers])

  const getShelvesFor = useCallback((warehouseLabel: string): string[] => {
    const wh = warehouses.find(w => w.label === warehouseLabel)
    if (!wh) return []
    return Array.from(new Set(storageLocations.filter(sl => sl.warehouse_id === wh.id).map(sl => sl.shelf))).sort()
  }, [warehouses, storageLocations])

  const getBinsFor = useCallback((warehouseLabel: string, shelf: string): string[] => {
    const wh = warehouses.find(w => w.label === warehouseLabel)
    if (!wh) return []
    return Array.from(new Set(
      storageLocations.filter(sl => sl.warehouse_id === wh.id && sl.shelf === shelf).map(sl => sl.bin).filter(Boolean)
    )).sort()
  }, [warehouses, storageLocations])

  // ---------- Label → ID lookups ----------
  const getWeaponTypeIdByLabel = useCallback((label: string) => {
    return weaponTypes.find(t => labelsEqual(t.label, label))?.id
  }, [weaponTypes])

  const getWeaponSubtypeIdByLabel = useCallback((label: string, typeId?: string) => {
    const candidates = weaponSubtypes.filter(s => labelsEqual(s.label, label))
    if (typeId) return candidates.find(s => s.weapon_type_id === typeId)?.id
    return candidates[0]?.id
  }, [weaponSubtypes])

  const getCaliberIdByLabel = useCallback((label: string) => {
    return calibers.find(c => labelsEqual(c.label, label))?.id
  }, [calibers])

  const getBrandIdByLabel = useCallback((label: string) => {
    return brands.find(b => labelsEqual(b.label, label))?.id
  }, [brands])

  const getModelIdByLabel = useCallback((label: string, brandId?: string) => {
    const candidates = models.filter(m => labelsEqual(m.label, label))
    if (brandId) return candidates.find(m => m.brand_id === brandId)?.id
    return candidates[0]?.id
  }, [models])

  const getWarehouseIdByLabel = useCallback((label: string) => {
    return warehouses.find(w => w.label === label)?.id
  }, [warehouses])

  const getStorageLocationId = useCallback((warehouseLabel: string, shelf: string, bin: string) => {
    const wh = warehouses.find(w => w.label === warehouseLabel)
    if (!wh) return undefined
    return storageLocations.find(sl => sl.warehouse_id === wh.id && sl.shelf === shelf && sl.bin === bin)?.id
  }, [warehouses, storageLocations])

  // ---------- CRUD ----------
  const wrap = useCallback(<T,>(fn: () => Promise<T>) => async (): Promise<T> => {
    try {
      const result = await fn()
      await refresh()
      return result
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed")
      throw e
    }
  }, [refresh])

  const createWeaponType = useCallback((label: string) => wrap(async () => {
    const { dbInsertMasterWeaponType } = await import("@/lib/db")
    const maxSort = weaponTypes.reduce((m, t) => Math.max(m, t.sort_order), 0)
    return dbInsertMasterWeaponType(label.trim(), maxSort + 1)
  })(), [weaponTypes, wrap])

  const createWeaponSubtype = useCallback((weaponTypeLabel: string, label: string) => wrap(async () => {
    const { dbInsertMasterWeaponSubtype, dbInsertMasterWeaponType } = await import("@/lib/db")
    const existingType = weaponTypes.find(t => labelsEqual(t.label, weaponTypeLabel))
    const maxSort = weaponTypes.reduce((maximum, type) => Math.max(maximum, type.sort_order), 0)
    const weaponTypeId = existingType?.id ?? await dbInsertMasterWeaponType(weaponTypeLabel.trim(), maxSort + 1)
    return dbInsertMasterWeaponSubtype(weaponTypeId, label.trim(), 99)
  })(), [weaponTypes, wrap])

  const createCaliber = useCallback((label: string) => wrap(async () => {
    const { dbInsertMasterCaliber } = await import("@/lib/db")
    return dbInsertMasterCaliber(label.trim())
  })(), [wrap])

  const linkSubtypeCaliber = useCallback((subtypeId: string, caliberId: string) => wrap(async () => {
    const { dbLinkSubtypeCaliber } = await import("@/lib/db")
    await dbLinkSubtypeCaliber(subtypeId, caliberId)
  })(), [wrap])

  const createBrand = useCallback((label: string) => wrap(async () => {
    const { dbInsertMasterBrand } = await import("@/lib/db")
    return dbInsertMasterBrand(label.trim())
  })(), [wrap])

  const createModel = useCallback((label: string, brandLabel?: string) => wrap(async () => {
    const { dbInsertMasterBrand, dbInsertMasterModel } = await import("@/lib/db")
    let brandId: string | null = null
    if (brandLabel) {
      const b = brands.find(b => labelsEqual(b.label, brandLabel))
      brandId = b?.id ?? await dbInsertMasterBrand(brandLabel.trim())
    }
    return dbInsertMasterModel(label.trim(), brandId)
  })(), [brands, wrap])

  const createWarehouse = useCallback((label: string) => wrap(async () => {
    const { dbInsertMasterWarehouse } = await import("@/lib/db")
    await dbInsertMasterWarehouse(label.trim())
  })(), [wrap])

  const createStorageLocation = useCallback((warehouseLabel: string, shelf: string, bin: string) => wrap(async () => {
    const { dbInsertMasterStorageLocation } = await import("@/lib/db")
    const wh = warehouses.find(w => w.label === warehouseLabel)
    if (!wh) throw new Error(`Warehouse "${warehouseLabel}" not found`)
    await dbInsertMasterStorageLocation(wh.id, shelf.trim(), bin.trim())
  })(), [warehouses, wrap])

  const makeDeleter = useCallback((table: string) => (id: string) => wrap(async () => {
    const { dbDeleteMasterRow } = await import("@/lib/db")
    await dbDeleteMasterRow(table, id)
  })(), [wrap])

  return {
    loading, error,
    weaponTypes, weaponSubtypes, calibers, subtypeCalibers,
    brands, models, warehouses, storageLocations,
    weaponTypeLabels, brandLabels, modelLabels, warehouseLabels, caliberLabels,
    getSubtypesFor, getCalibersFor, getShelvesFor, getBinsFor,
    // Lookups
    getWeaponTypeIdByLabel,
    getWeaponSubtypeIdByLabel,
    getCaliberIdByLabel,
    getBrandIdByLabel,
    getModelIdByLabel,
    getWarehouseIdByLabel,
    getStorageLocationId,
    // CRUD
    createWeaponType, createWeaponSubtype, createCaliber, linkSubtypeCaliber,
    createBrand, createModel, createWarehouse, createStorageLocation,
    deleteWeaponType: makeDeleter("weapon_types"),
    deleteWeaponSubtype: makeDeleter("weapon_subtypes"),
    deleteCaliber: makeDeleter("calibers"),
    deleteBrand: makeDeleter("brands"),
    deleteModel: makeDeleter("models"),
    deleteWarehouse: makeDeleter("warehouses"),
    deleteStorageLocation: makeDeleter("storage_locations"),
    refresh,
  }
}
