import { describe, expect, it } from "vitest"
import { ar, en } from "@/lib/i18n/translations"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(file)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [file] : []
  })
}

describe("translation catalog integrity", () => {
  it("keeps English and Arabic catalogs in exact parity", () => {
    const englishOnly = Object.keys(en).filter((key) => !(key in ar))
    const arabicOnly = Object.keys(ar).filter((key) => !(key in en))
    expect(englishOnly).toEqual([])
    expect(arabicOnly).toEqual([])
  })

  it("contains localized labels for critical daily workflows", () => {
    const criticalKeys = [
      "page.audit", "audit.detailDescription", "audit.summary.sale", "audit.summary.payment",
      "settings.preferredDisplayCurrency", "bulk.serialHint", "cust.invoiceHistory",
      "weaponDetail.changeStatus", "shipmentDoc.billOfLading", "excel.noConflicts",
    ]
    for (const key of criticalKeys) {
      expect(en[key], `${key} is missing from English`).toBeTruthy()
      expect(ar[key], `${key} is missing from Arabic`).toBeTruthy()
      expect(ar[key], `${key} is not translated`).not.toBe(en[key])
    }
  })

  it("does not contain broken currency placeholder symbols", () => {
    for (const catalog of [en, ar]) {
      expect(Object.values(catalog).some((value) => value.includes("[?]"))).toBe(false)
    }
  })

  it("defines every literal translation key used by the frontend", () => {
    const usedKeys = new Set<string>()
    for (const root of ["src/pages", "src/components", "src/lib"]) {
      for (const file of sourceFiles(root)) {
        const source = readFileSync(file, "utf8")
        for (const match of source.matchAll(/\bt\(\s*["']([^"'{}$]+)["']/g)) usedKeys.add(match[1])
      }
    }
    const missing = [...usedKeys].filter((key) => !(key in en) || !(key in ar)).sort()
    expect(missing).toEqual([])
  })
})
