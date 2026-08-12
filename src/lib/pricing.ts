import Decimal from "decimal.js"
import type { PricingMode } from "@/lib/types"

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

export type PricingTier = "retail" | "wholesale"

export interface PricingRules {
  retailMarginPercent: number
  wholesaleMarginPercent: number
  minimumMarginPercent: number
  maximumMarkupPercent: number
  decimalPrecision: number
  psychologicalPricing?: boolean
}

export interface RecommendedPrices {
  retail: number
  wholesale: number
  retailMarginPercent: number
  wholesaleMarginPercent: number
}

export interface PricingFieldState {
  value: number
  mode: PricingMode
}

function finiteNonNegative(value: number, field: string): Decimal {
  const amount = new Decimal(value)
  if (!amount.isFinite() || amount.isNegative()) throw new Error(`${field} must be a finite non-negative amount`)
  return amount
}

function validPercent(value: number, field: string, upperExclusive = 100): Decimal {
  const percent = new Decimal(value)
  if (!percent.isFinite() || percent.isNegative() || percent.greaterThanOrEqualTo(upperExclusive)) {
    throw new Error(`${field} must be between 0 and ${upperExclusive}`)
  }
  return percent
}

function commercialRound(value: Decimal, precision: number, psychological: boolean): Decimal {
  if (!Number.isInteger(precision) || precision < 0 || precision > 4) throw new Error("Currency precision is invalid")
  const rounded = value.toDecimalPlaces(precision, Decimal.ROUND_CEIL)
  if (!psychological || !rounded.greaterThan(0)) return rounded
  const unit = new Decimal(10).pow(-precision)
  const ending = unit
  const ceiling = rounded.toDecimalPlaces(0, Decimal.ROUND_CEIL)
  const candidate = Decimal.max(rounded, ceiling.minus(ending))
  return candidate.toDecimalPlaces(precision, Decimal.ROUND_HALF_UP)
}

export function calculateMargin(finalCost: number, sellingPrice: number): number {
  const cost = finiteNonNegative(finalCost, "Final cost")
  const price = finiteNonNegative(sellingPrice, "Selling price")
  if (!price.greaterThan(0)) return 0
  return price.minus(cost).dividedBy(price).times(100).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber()
}

export function calculateMarkup(finalCost: number, sellingPrice: number): number {
  const cost = finiteNonNegative(finalCost, "Final cost")
  const price = finiteNonNegative(sellingPrice, "Selling price")
  if (!cost.greaterThan(0)) return price.greaterThan(0) ? Number.POSITIVE_INFINITY : 0
  return price.minus(cost).dividedBy(cost).times(100).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber()
}

export function calculateRecommendedPrice(
  finalCost: number,
  targetMarginPercent: number,
  maximumMarkupPercent: number,
  decimalPrecision: number,
  psychologicalPricing = false,
): number {
  const cost = finiteNonNegative(finalCost, "Final cost")
  if (!cost.greaterThan(0)) return 0
  const margin = validPercent(targetMarginPercent, "Target margin")
  const maximumMarkup = finiteNonNegative(maximumMarkupPercent, "Maximum markup")
  const marginPrice = cost.dividedBy(new Decimal(1).minus(margin.dividedBy(100)))
  const maximumPrice = cost.times(new Decimal(1).plus(maximumMarkup.dividedBy(100)))
  const safePrice = Decimal.min(marginPrice, maximumPrice)
  return commercialRound(Decimal.max(cost, safePrice), decimalPrecision, psychologicalPricing).toNumber()
}

export function calculateRecommendedPrices(finalCost: number, rules: PricingRules): RecommendedPrices {
  const retail = calculateRecommendedPrice(finalCost, rules.retailMarginPercent, rules.maximumMarkupPercent, rules.decimalPrecision, rules.psychologicalPricing)
  const wholesale = calculateRecommendedPrice(finalCost, rules.wholesaleMarginPercent, rules.maximumMarkupPercent, rules.decimalPrecision, rules.psychologicalPricing)
  return {
    retail,
    wholesale: Math.min(wholesale, retail),
    retailMarginPercent: calculateMargin(finalCost, retail),
    wholesaleMarginPercent: calculateMargin(finalCost, Math.min(wholesale, retail)),
  }
}

export function validateSellingPrice(finalCost: number, sellingPrice: number, minimumMarginPercent: number): string | null {
  if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) return "Selling price must be greater than zero"
  if (!Number.isFinite(finalCost) || finalCost < 0) return "Final cost is invalid"
  if (sellingPrice < finalCost) return "Selling price cannot be below final cost"
  const minimum = validPercent(minimumMarginPercent, "Minimum margin")
  if (new Decimal(calculateMargin(finalCost, sellingPrice)).lessThan(minimum)) return "Selling price is below the minimum margin"
  return null
}

export function applyCostChange(
  current: PricingFieldState,
  recommendedValue: number,
): PricingFieldState {
  return current.mode === "auto" ? { value: recommendedValue, mode: "auto" } : current
}
