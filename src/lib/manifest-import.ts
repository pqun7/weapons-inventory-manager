// import * as XLSX from "xlsx"
import type { WorkBook, } from "xlsx"
import type { ShipmentLineItemInput } from "./store"
import type { StorageLocation } from "./types"

export interface ParsedManifestRow {
  productType: string
  weaponType: string
  subType: string
  brand: string
  model: string
  caliber: string
  quantity: number
  purchasePrice: number
  retailPrice: number
  wholesalePrice: number
  warehouse: string
  shelf: string
  bin: string
  serialNumbers: string
}

export interface ManifestImportResult {
  lineItems: ShipmentLineItemInput[]
  errors: string[]
  warnings: string[]
  totalRows: number
  validRows: number
}

function normalizeProductType(raw: string): "weapon" | "ammunition" | "accessory" {
  const lower = raw.toLowerCase().trim()
  if (lower.includes("weapon") || lower.includes("pistol") || lower.includes("rifle") || lower.includes("shotgun") || lower.includes("gun")) return "weapon"
  if (lower.includes("ammo") || lower.includes("ammunition") || lower.includes("round")) return "ammunition"
  return "accessory"
}

function parseNumber(val: unknown, fallback: number = 0): number {
  if (typeof val === "number") return val
  if (typeof val === "string") {
    const cleaned = val.replace(/[^0-9.-]/g, "")
    const num = parseFloat(cleaned)
    return isNaN(num) ? fallback : num
  }
  return fallback
}

function parseSerialList(raw: string): string[] {
  if (!raw) return []
  return raw
    .split(/[\n\r,\t;|]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export async function parseManifestFile(file: File): Promise<ManifestImportResult> {
  const errors: string[] = []
  const warnings: string[] = []
  const lineItems: ShipmentLineItemInput[] = []
  const XLSX = await import("xlsx")


  let wb: WorkBook
  try {
    const arrayBuffer = await file.arrayBuffer()
    wb = XLSX.read(arrayBuffer, { type: "array" })
  } catch {
    return { lineItems: [], errors: ["Failed to read file. Ensure it is a valid Excel or CSV file."], warnings, totalRows: 0, validRows: 0 }
  }

  const sheetName = wb.SheetNames[0]
  if (!sheetName) {
    return { lineItems: [], errors: ["File contains no sheets."], warnings, totalRows: 0, validRows: 0 }
  }

  const ws = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" })

  if (rows.length === 0) {
    return { lineItems: [], errors: ["Sheet is empty."], warnings, totalRows: 0, validRows: 0 }
  }

  const headerKeys = Object.keys(rows[0]).map((k) => k.toLowerCase().replace(/[^a-z0-9]/g, ""))

  const findCol = (patterns: string[]): string | null => {
    for (const key of Object.keys(rows[0])) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "")
      if (patterns.some((p) => normalized.includes(p))) return key
    }
    return null
  }

  const colMap = {
    productType: findCol(["producttype", "type", "category"]),
    weaponType: findCol(["weapontype", "wtype", "classification"]),
    subType: findCol(["subtype", "modeltype", "variant"]),
    brand: findCol(["brand", "manufacturer", "make"]),
    model: findCol(["model", "name"]),
    caliber: findCol(["caliber", "cal", "gauge"]),
    quantity: findCol(["quantity", "qty", "count"]),
    purchasePrice: findCol(["purchaseprice", "cost", "costprice", "unitcost"]),
    retailPrice: findCol(["retailprice", "saleprice", "sellingprice", "price"]),
    wholesalePrice: findCol(["wholesaleprice", "wholesale", "bulkprice"]),
    warehouse: findCol(["warehouse", "location", "store"]),
    shelf: findCol(["shelf", "rack", "aisle"]),
    bin: findCol(["bin", "slot", "position"]),
    serialNumbers: findCol(["serialnumber", "serial", "serials", "serialno"]),
  }

  if (!colMap.brand && !colMap.model) {
    errors.push("Could not find 'Brand' or 'Model' columns. Check your file headers.")
  }
  if (!colMap.quantity) {
    errors.push("Could not find a 'Quantity' column.")
  }

  if (errors.length > 0) {
    return { lineItems: [], errors, warnings, totalRows: rows.length, validRows: 0 }
  }

  let validRows = 0
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const getVal = (key: string | null): string => {
      if (!key) return ""
      const v = row[key]
      return v == null ? "" : String(v).trim()
    }

    const brand = getVal(colMap.brand)
    const model = getVal(colMap.model)
    const quantity = parseNumber(colMap.quantity ? row[colMap.quantity] : 0, 0)

    if (!brand && !model) {
      warnings.push(`Row ${i + 2}: Skipped — no brand or model.`)
      continue
    }
    if (quantity <= 0) {
      warnings.push(`Row ${i + 2}: Skipped — invalid quantity.`)
      continue
    }

    const productType = normalizeProductType(getVal(colMap.productType) || "weapon")
    const serialsRaw = getVal(colMap.serialNumbers)
    const serials = parseSerialList(serialsRaw)

    if (productType === "weapon" && serials.length > 0 && serials.length !== quantity) {
      warnings.push(`Row ${i + 2}: Serial count (${serials.length}) does not match quantity (${quantity}). Adjusting quantity to ${serials.length}.`)
    }

    const location: StorageLocation = {
      warehouse: getVal(colMap.warehouse) || "Main",
      shelf: getVal(colMap.shelf),
      bin: getVal(colMap.bin),
    }

    const finalQty = productType === "weapon" && serials.length > 0 ? serials.length : quantity

    lineItems.push({
      productType,
      weaponType: getVal(colMap.weaponType) || "Pistol",
      subType: getVal(colMap.subType),
      brand,
      model,
      caliber: getVal(colMap.caliber),
      quantity: finalQty,
      purchasePrice: parseNumber(colMap.purchasePrice ? row[colMap.purchasePrice] : 0, 0),
      retailPrice: parseNumber(colMap.retailPrice ? row[colMap.retailPrice] : 0, 0),
      wholesalePrice: parseNumber(colMap.wholesalePrice ? row[colMap.wholesalePrice] : 0, 0),
      location,
      serialNumbers: productType === "weapon" ? serials : [],
    })
    validRows++
  }

  void headerKeys
  return { lineItems, errors, warnings, totalRows: rows.length, validRows }
}
