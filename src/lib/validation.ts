import { INVALID_BRAND_TYPE_PAIRS, INVALID_TYPE_CALIBER_PAIRS } from "./types"

export interface ValidationResult {
  valid: boolean
  error?: string
}

function legacyWeaponTypeKey(weaponType: string): string {
  const key = weaponType.normalize("NFKD").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]/gu, "")
  if (key === "airrifle") return "Air rifle"
  if (key === "blankpistol" || key === "blankfiringpistol") return "Blank pistol"
  return weaponType
}

export function validateBrandTypePair(brand: string, weaponType: string): ValidationResult {
  if (!brand || !weaponType) return { valid: true }
  const forbiddenTypes = INVALID_BRAND_TYPE_PAIRS[brand]
  if (forbiddenTypes && forbiddenTypes.includes(legacyWeaponTypeKey(weaponType))) {
    return { valid: false, error: `Invalid combination: ${brand} does not make ${weaponType} weapons` }
  }
  return { valid: true }
}

export function validateTypeCaliberPair(weaponType: string, caliber: string): ValidationResult {
  if (!weaponType || !caliber) return { valid: true }
  const forbiddenCalibers = INVALID_TYPE_CALIBER_PAIRS[legacyWeaponTypeKey(weaponType)]
  if (forbiddenCalibers && forbiddenCalibers.includes(caliber)) {
    return { valid: false, error: `Invalid combination: ${weaponType} cannot use ${caliber} caliber` }
  }
  return { valid: true }
}

export function validateFullCombination(
  brand: string,
  weaponType: string,
  _subType: string,
  caliber: string
): ValidationResult[] {
  const results: ValidationResult[] = []
  const bt = validateBrandTypePair(brand, weaponType)
  if (!bt.valid) results.push(bt)
  const tc = validateTypeCaliberPair(weaponType, caliber)
  if (!tc.valid) results.push(tc)
  return results
}

export function hasAnyValidationErrors(
  brand: string,
  weaponType: string,
  subType: string,
  caliber: string
): boolean {
  return validateFullCombination(brand, weaponType, subType, caliber).some((r) => !r.valid)
}
