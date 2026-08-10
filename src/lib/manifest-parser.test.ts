import { describe, expect, it } from "vitest"
import { extractSerials, heuristicSpreadsheetItems, inferCaliber, inferProductType, parseSpreadsheetBuffer, type NativeExtraction } from "../../electron/services/manifest-parser"

function sheet(rows: Array<Array<string | number | null>>, name = "Manifest"): NativeExtraction {
  return {
    kind: "spreadsheet",
    sheets: [{
      name,
      rows: rows.map((values, index) => ({
        row: index + 1,
        cells: values.map((value, column) => ({ column: String.fromCharCode(65 + column), value: value! })).filter((cell) => cell.value != null && cell.value !== ""),
      })),
    }],
    text: "",
    raw: {},
  }
}

describe("schema-flexible spreadsheet extraction", () => {
  it("maps a conventional English table without relying on one fixed header", () => {
    const result = heuristicSpreadsheetItems(sheet([
      ["Company information"],
      ["Item", "QTY", "Serial No", "Model"],
      ["Glock pistol 9mm", 2, "ABC12345, ABC12346", "G17"],
    ]))
    expect(result).toHaveLength(1)
    expect(result[0].quantity).toBe(2)
    expect(result[0].serialNumbers).toEqual(["ABC12345", "ABC12346"])
    expect(result[0].productType).toBe("weapon")
  })

  it("recognizes Arabic semantic headers", () => {
    const result = heuristicSpreadsheetItems(sheet([
      ["بيانات الشحنة"],
      ["الصنف", "الكمية", "الرقم التسلسلي", "العيار"],
      ["بندقية صيد", 1, "SDN-2026-0001", "12 GA"],
    ], "قائمة التعبئة"))
    expect(result).toHaveLength(1)
    expect(result[0].source.sheet).toBe("قائمة التعبئة")
    expect(result[0].serialNumbers).toEqual(["SDN-2026-0001"])
    expect(result[0].caliber).toBe("12 GA")
  })

  it("joins continuation serial rows under the preceding product", () => {
    const result = heuristicSpreadsheetItems(sheet([
      ["PACKING LIST"],
      ["NO", "DESCRIPTION OF GOODS", "CARTON"],
      [1, "RETAY MOD92 BLANK PISTOL BLACK", 1],
      [null, "RMDIB1907103501 RMDIB1907103502"],
      [null, "RMDIB1907103503 RMDIB1907103504"],
      [2, "CLEANING SET (10 PCS)", 1],
    ]))
    expect(result[0].serialNumbers).toHaveLength(4)
    expect(result[0].quantity).toBe(4)
    expect(result[1].productType).toBe("accessory")
  })

  it("extracts multiple serial formats and removes duplicates", () => {
    expect(extractSerials("550-H26YD-186 550-H26YD-187 550-H26YD-186")).toEqual(["550-H26YD-186", "550-H26YD-187"])
  })

  it("does not confuse round-magazine shotguns with ammunition", () => {
    expect(inferProductType("Castello MP-6 12 Ga Magazine feed shotgun 10 Round Magazine")).toBe("weapon")
    expect(inferProductType("PISTOL CASE (300 PCS)")).toBe("accessory")
    expect(inferProductType("Air Rifle Pump")).toBe("accessory")
    expect(inferProductType("HATSAN AIR PELLETS (60 PCS)")).toBe("ammunition")
  })

  it("derives explicit PCS quantities, rejects footer rows, and recognizes decimal calibers", () => {
    const result = heuristicSpreadsheetItems(sheet([
      ["NO", "DESCRIPTION OF GOODS"],
      [1, "CLEANING SET (10 PCS)"],
      [2, "HATSAN AIR PELLETS (60 PCS)"],
      [null, "NET WEIGHTS:"],
      [null, "GROSS WEIGHTS:"],
    ]))
    expect(result).toHaveLength(2)
    expect(result.map((item) => item.quantity)).toEqual([10, 60])
    expect(inferCaliber("HATSAN AIR RIFLE FLASH 5,5")).toBe("5.5mm")
  })

  it("preserves an explicit quantity when serial count differs", () => {
    const result = heuristicSpreadsheetItems(sheet([
      ["Product", "Qty", "Serial Numbers"],
      ["Glock pistol 9mm", 2, "ABC12345 ABC12346 ABC12347"],
    ]))
    expect(result[0].quantity).toBe(2)
    expect(result[0].serialNumbers).toHaveLength(3)
    expect((result[0].rawData._extraction as { quantityOrigin: string }).quantityOrigin).toBe("explicit")
  })

  it("does not treat carton, weights, dimensions, or model tokens as quantity or serials", () => {
    const result = heuristicSpreadsheetItems(sheet([
      ["NO", "DESCRIPTION OF GOODS", "CARTON", "NET WEIGHT", "DIMENSION"],
      [1, "Castello 101-PKA-S 12 GA Pump Action shotgun", 4, 28, "107*40*28"],
      [null, "550-H26PT-117 550-H26PT-118"],
    ]))
    expect(result).toHaveLength(1)
    expect(result[0].quantity).toBe(2)
    expect(result[0].serialNumbers).toEqual(["550-H26PT-117", "550-H26PT-118"])
    expect(result[0].serialNumbers).not.toContain("101-PKA-S")
  })

  it("detects two table regions in one sheet", () => {
    const result = heuristicSpreadsheetItems(sheet([
      ["Product", "Qty", "Serial"],
      ["Retay blank pistol", 1, "RETAY-000001"],
      ["Notes", "first table ends"],
      ["الصنف", "العدد", "الرقم التسلسلي"],
      ["بندقية صيد", 1, "SDN-2026-0002"],
    ]))
    expect(result).toHaveLength(2)
    expect(result.map((item) => item.serialNumbers[0])).toEqual(["RETAY-000001", "SDN-2026-0002"])
  })

  it("parses semicolon-delimited CSV with a non-fixed schema", () => {
    const extraction = parseSpreadsheetBuffer(new TextEncoder().encode("Description;Units;Serial No\nRetay blank pistol;1;RMDIB1907103501"))
    const result = heuristicSpreadsheetItems(extraction)
    expect(result).toHaveLength(1)
    expect(result[0].quantity).toBe(1)
    expect(result[0].serialNumbers).toEqual(["RMDIB1907103501"])
  })
})
