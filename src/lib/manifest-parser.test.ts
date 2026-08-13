import { describe, expect, it } from "vitest"
import { strToU8, zipSync } from "fflate"
import * as XLSX from "xlsx"
import { canonicalizeExtractedProductFields, extractLegacyWordImages, extractSerials, heuristicSpreadsheetItems, inferCaliber, inferManufacturerAndModel, inferProductType, inferWeaponMechanisms, inferWeaponSubtype, inferWeaponType, nativeWordExtractionFromText, parseSpreadsheetBuffer, parseWordDocumentBuffer, type NativeExtraction } from "../../electron/services/manifest-parser"

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

  it("recognizes common Count, البيان, S/N, and السيريال header variants", () => {
    const english = heuristicSpreadsheetItems(sheet([
      ["Item", "Count", "S/N"],
      ["Retay blank pistol 9mm", 1, "RETAY-000123"],
    ]))
    const arabic = heuristicSpreadsheetItems(sheet([
      ["البيان", "العدد", "السيريال"],
      ["مسدس صوت عيار 9 ملم", 1, "BLANK-000123"],
    ]))
    expect(english[0]).toMatchObject({ quantity: 1, serialNumbers: ["RETAY-000123"] })
    expect(arabic[0]).toMatchObject({ quantity: 1, serialNumbers: ["BLANK-000123"], weaponType: "Blank-Firing Pistol" })
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
    expect(inferProductType(".22 Caliber Air Rifle Pellet")).toBe("ammunition")
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

  it("separates a Hatsan air-rifle description into the correct business fields", () => {
    const description = "HATSAN AIR RIFLE FLASH 5,5"
    const identity = inferManufacturerAndModel(description)
    expect(inferProductType(description)).toBe("weapon")
    expect(inferWeaponType(description)).toBe("Air Rifle")
    expect(identity.manufacturer).toBe("Hatsan")
    expect(identity.model).toBe("FLASH")
    expect(inferCaliber(description)).toBe("5.5mm")

    const [item] = heuristicSpreadsheetItems(sheet([
      ["Product", "Qty", "Serial Numbers"],
      [description, 1, "HATSAN-2026-0001"],
    ]))
    expect(item).toMatchObject({
      productName: description,
      productType: "weapon",
      weaponType: "Air Rifle",
      manufacturer: "Hatsan",
      model: "FLASH",
      caliber: "5.5mm",
    })
  })

  it("separates shotgun type, subtype, manufacturer, and optional model", () => {
    expect(inferWeaponType("SEMI AUTO SHOTGUN")).toBe("Shotgun")
    expect(inferWeaponSubtype("SEMI AUTO SHOTGUN")).toBe("Semi-Automatic")
    expect(inferWeaponMechanisms("SEMI MAGAZINE SHOTGUN")).toEqual({ subtype: null, actionType: "Semi-Automatic", feedingType: "Magazine-Fed" })
    expect(inferManufacturerAndModel("RADELLİ SEMI MAGAZİNE SHOTGUN")).toMatchObject({ manufacturer: "Radelli", model: null })
    expect(inferWeaponSubtype("RADELLİ SEMI MAGAZİNE SHOTGUN")).toBe("Semi-Automatic")
    expect(inferManufacturerAndModel("HATSAN AIR RIFLE MOD 55 5,5").model).toBe("MOD 55")
    expect(inferManufacturerAndModel("HAT SAN AIR RIFLE FLASH 5,5")).toMatchObject({ manufacturer: "Hatsan", model: "FLASH" })
    expect(inferManufacturerAndModel("Castello MP-6-R 12 Ga Magazine feed shotgun 2-5-10 Round Magazine").model).toBe("MP-6-R")
    expect(inferWeaponType("Tokarev Arms 12 ga Pumpshotgun")).toBe("Shotgun")
    expect(inferManufacturerAndModel("GORDION SEMI AUTO SHOTGUN SYN 12/76")).toMatchObject({ manufacturer: "Gordion", model: null })
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

  it("preserves spreadsheet hidden-state and merged ranges in the normalized model", () => {
    const workbook = { SheetNames: ["Items"], Sheets: { Items: { A1: { t: "s", v: "Product" }, B1: { t: "s", v: "Qty" }, "!ref": "A1:B1", "!merges": [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }] } }, Workbook: { Sheets: [{ Hidden: 1 }] } }
    const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }))
    const extraction = parseSpreadsheetBuffer(bytes)
    expect(extraction.sheets[0]).toMatchObject({ hidden: true, mergedRanges: ["A1:B1"] })
    expect(extraction.document?.tables[0]).toMatchObject({ hidden: true, mergedRanges: ["A1:B1"] })
  })
})

describe("structured DOCX extraction", () => {
  it("preserves table geometry, supplemental text, textboxes, and embedded images", async () => {
    const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="urn:w" xmlns:r="urn:r" xmlns:a="urn:a"><w:body>
        <w:p><w:r><w:t>Shipment reference</w:t></w:r><w:drawing><a:blip r:embed="rId7"/></w:drawing></w:p>
        <w:tbl>
          <w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Product</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Qty</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Serial No</w:t></w:r></w:p></w:tc></w:tr>
          <w:tr><w:tc><w:p><w:r><w:t>HATSAN AIR RIFLE FLASH 5,5</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t></w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>HAT-000001</w:t></w:r></w:p></w:tc></w:tr>
        </w:tbl>
        <w:p><w:r><w:txbxContent><w:p><w:r><w:t>Textbox note</w:t></w:r></w:p></w:txbxContent></w:r></w:p>
      </w:body></w:document>`
    const relsXml = `<?xml version="1.0"?><Relationships><Relationship Id="rId7" Target="media/image1.png"/></Relationships>`
    const headerXml = `<?xml version="1.0"?><w:hdr xmlns:w="urn:w"><w:p><w:r><w:t>Header text</w:t></w:r></w:p></w:hdr>`
    const footerXml = `<?xml version="1.0"?><w:ftr xmlns:w="urn:w"><w:p><w:r><w:t>Footer text</w:t></w:r></w:p></w:ftr>`
    const bytes = zipSync({
      "word/document.xml": strToU8(documentXml),
      "word/_rels/document.xml.rels": strToU8(relsXml),
      "word/header1.xml": strToU8(headerXml),
      "word/footer1.xml": strToU8(footerXml),
      "word/media/image1.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
    })
    const extraction = await parseWordDocumentBuffer(bytes)
    expect(extraction.document).toMatchObject({ format: "docx", structureQuality: "structured", requiresVisualAnalysis: true })
    expect(extraction.document?.tables[0].rows[0].cells[0]).toMatchObject({ column: "A", columnSpan: 2 })
    expect(extraction.document?.headers[0].text).toBe("Header text")
    expect(extraction.document?.footers[0].text).toBe("Footer text")
    expect(extraction.document?.textboxes[0].text).toBe("Textbox note")
    expect(extraction.document?.images[0]).toMatchObject({ fileName: "image1.png", mimeType: "image/png", relationshipIds: ["rId7"] })
    expect(JSON.stringify(extraction.raw)).not.toContain("dataBase64")
    const [item] = heuristicSpreadsheetItems(extraction)
    expect(item).toMatchObject({ weaponType: "Air Rifle", manufacturer: "Hatsan", model: "FLASH", caliber: "5.5mm", quantity: 1 })
    expect(item.serialNumbers).toEqual(["HAT-000001"])
  })
})

describe("legacy Word manifest extraction", () => {
  const serialRows = (prefix: string, count: number): string => Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(6, "0")}`)
    .reduce<string[]>((rows, serial, index) => {
      const row = Math.floor(index / 5)
      rows[row] = [rows[row], serial].filter(Boolean).join("\t")
      return rows
    }, [])
    .join("\n")

  it("groups Arabic Word headings, serial tables, and declared totals like the supplied order", () => {
    const extraction = nativeWordExtractionFromText([
      "بنادق خرطوش عيار 12",
      serialRows("550-H26YD", 203),
      "Total: 203 Pcs.",
      "",
      "بنادق هواء عيار 22",
      serialRows("633-G26HT", 105),
      "Total: 105.",
      "",
      "مسدسات صوت 9 ملي",
      serialRows("K4YKYG5YS01", 170),
      "Total: 170 Pcs.",
    ].join("\n"))

    const result = heuristicSpreadsheetItems(extraction)
    expect(result).toHaveLength(3)
    expect(result.map((item) => item.quantity)).toEqual([203, 105, 170])
    expect(result.map((item) => item.serialNumbers.length)).toEqual([203, 105, 170])
    expect(result.map((item) => item.productType)).toEqual(["weapon", "weapon", "weapon"])
    expect(result.map((item) => item.weaponType)).toEqual(["Shotgun", "Air Rifle", "Blank-Firing Pistol"])
    expect(result.map((item) => item.caliber)).toEqual(["12 GA", ".22", "9mm blank"])
    expect(result.map((item) => (item.rawData._extraction as { totalValidation: { matches: boolean } }).totalValidation.matches)).toEqual([true, true, true])
  })

  it("keeps a mismatched declared total visible so validation can block an incorrect receipt", () => {
    const [item] = heuristicSpreadsheetItems(nativeWordExtractionFromText([
      "بنادق خرطوش عيار 12",
      "550-H26YD-000001\t550-H26YD-000002",
      "Total: 3 Pcs.",
    ].join("\n")))

    expect(item.quantity).toBe(3)
    expect(item.serialNumbers).toHaveLength(2)
    expect((item.rawData._extraction as { totalValidation: { matches: boolean } }).totalValidation.matches).toBe(false)
  })

  it("conservatively detects raw PNG and JPEG payloads embedded in legacy DOC streams", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 1, 2, 3, 4])
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 0xff, 0xd9])
    const bytes = new Uint8Array(4 + png.length + 3 + jpeg.length)
    bytes.set(png, 4)
    bytes.set(jpeg, 4 + png.length + 3)
    expect(extractLegacyWordImages(bytes).map((image) => image.mimeType)).toEqual(["image/png", "image/jpeg"])
  })
})

describe("Arabic-to-English local weapon normalization", () => {
  it.each([
    ["بنادق خرطوش عيار 12", "Shotgun", "12-Gauge Shotgun", "12 GA", "12-Gauge Shotgun"],
    ["بندقية صيد عيار 12", "Shotgun", "12-Gauge Shotgun", "12 GA", "12-Gauge Shotgun"],
    ["بنادق هواء عيار 22", "Air Rifle", ".22-Caliber Air Rifle", ".22", ".22-Caliber Air Rifle"],
    ["مسدسات صوت عيار 9 ملم", "Blank-Firing Pistol", "9mm Blank-Firing Pistol", "9mm blank", "9mm Blank-Firing Pistol"],
    ["مسدس ريفولفر عيار 357", "Revolver", null, ".357", "Revolver .357"],
    ["بندقية قناصة عيار 308", "Sniper Rifle", null, ".308", "Sniper Rifle .308"],
    ["بندقية نصف آلية عيار 7.62 ملم", "Automatic Rifle", null, "7.62mm", "Automatic Rifle 7.62mm"],
    ["بندقية رصاص عيار 308", "Rifle", null, ".308", "Rifle .308"],
    ["مسدس رشاش عيار 9 ملم", "Submachine Gun", null, "9mm", "Submachine Gun 9mm"],
  ])("normalizes %s", (description, weaponType, category, caliber, productName) => {
    expect(canonicalizeExtractedProductFields({ productName: description })).toMatchObject({
      productType: "weapon",
      weaponType,
      category,
      caliber,
      productName,
      translated: true,
    })
  })

  it("normalizes Arabic manufacturer aliases but preserves alphanumeric models", () => {
    expect(canonicalizeExtractedProductFields({ productName: "هاتسان بندقية هواء موديل 55 عيار 5.5 ملم" })).toMatchObject({
      manufacturer: "Hatsan",
      weaponType: "Air Rifle",
      caliber: "5.5mm",
    })
  })

  it("translates Arabic ammunition into the required canonical English names", () => {
    expect(canonicalizeExtractedProductFields({ productName: "خراطيش صيد عيار 12" })).toMatchObject({ productType: "ammunition", productName: "12-Gauge Shotshell", caliber: "12 GA" })
    expect(canonicalizeExtractedProductFields({ productName: "ساچمة بندقية هواء عيار 22" })).toMatchObject({ productType: "ammunition", productName: ".22 Caliber Air Rifle Pellet", caliber: ".22" })
    expect(canonicalizeExtractedProductFields({ productName: "طلقات صوت عيار 9 ملم" })).toMatchObject({ productType: "ammunition", productName: "9mm Blank Cartridge", caliber: "9mm blank" })
  })

  it("translates Arabic accessories without misclassifying their weapon reference", () => {
    expect(canonicalizeExtractedProductFields({ productName: "عدة تنظيف بندقية" })).toMatchObject({ productType: "accessory", productName: "Cleaning kit" })
  })

  it("reads Arabic-Indic serial digits without changing Latin prefixes", () => {
    expect(extractSerials("رقم السلاح: ABC-١٢٣٤٥٦٧٨")).toEqual(["ABC-12345678"])
  })
})
