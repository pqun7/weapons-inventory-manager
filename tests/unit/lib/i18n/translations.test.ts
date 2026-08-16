import { describe, expect, it } from "vitest"
import { ar, en } from "@/lib/i18n/translations"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import * as ts from "typescript"

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
        for (const match of source.matchAll(/\b(?:titleKey|descriptionKey|actionKey)\s*:\s*["']([^"']+)["']/g)) usedKeys.add(match[1])
      }
    }
    const missing = [...usedKeys].filter((key) => !(key in en) || !(key in ar)).sort()
    expect(missing).toEqual([])
  })

  it("defines the translated dimensions used by the dashboard", () => {
    const keys = [
      ...["today", "week", "month", "quarter", "year", "custom"].map((value) => `dash.period.${value}`),
      ...["weapon", "accessory", "ammunition"].map((value) => `dash.category.${value}`),
      ...["active", "low", "out", "slow", "dead"].map((value) => `dash.inventory.status.${value}`),
      ...["pending", "inTransit", "delayed"].map((value) => `dash.shipments.${value}`),
      ...["high", "attention", "opportunity", "info"].map((value) => `dash.priority.${value}`),
      "dash.compare.increase", "dash.compare.decrease",
    ]
    expect(keys.filter((key) => !(key in en) || !(key in ar))).toEqual([])
  })

  it("keeps visible feature UI copy behind the translation catalog", () => {
    const visibleAttributes = new Set(["placeholder", "title", "aria-label", "alt", "heading", "description"])
    const technicalCopy = new Set(["EUR", "Euro", "KB", "SHP-YYYY0001", "SHA-256:", "&nbsp;"])
    const untranslated: string[] = []

    for (const root of ["src/pages", "src/components"]) {
      for (const file of sourceFiles(root)) {
        if (file.replaceAll("\\", "/").includes("/components/ui/")) continue
        const sourceText = readFileSync(file, "utf8")
        const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

        const record = (node: ts.Node, value: string) => {
          const copy = value.replace(/\s+/g, " ").trim()
          if (!/[A-Za-z]{2}/.test(copy) || technicalCopy.has(copy)) return
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
          untranslated.push(`${file}:${line}: ${copy}`)
        }
        const visit = (node: ts.Node) => {
          if (ts.isJsxText(node)) record(node, node.text)
          if (ts.isJsxAttribute(node) && visibleAttributes.has(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer)) {
            record(node, node.initializer.text)
          }
          if (ts.isJsxExpression(node) && node.expression && ts.isStringLiteral(node.expression)) record(node, node.expression.text)
          if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === "toast") {
            const message = node.arguments[0]
            if (message && ts.isStringLiteral(message)) record(message, message.text)
          }
          ts.forEachChild(node, visit)
        }
        visit(source)
      }
    }

    expect(untranslated).toEqual([])
  })
})
