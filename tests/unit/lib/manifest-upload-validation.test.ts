import { describe, expect, it } from "vitest"
import { strToU8, zipSync } from "fflate"
import { ensureAppDocumentIdentifiers } from "@electron/services/manifest-document-identifiers"
import { validateManifestUpload } from "@electron/services/manifest-upload-validation"

function wordPackage(): Uint8Array {
  return zipSync({
    "word/document.xml": strToU8("<w:document><w:body><w:p>Manifest</w:p></w:body></w:document>"),
    "[Content_Types].xml": strToU8("<Types/>")
  })
}

describe("shared manifest upload validation", () => {
  it("accepts a DOC-named file whose content is a valid modern Word package", () => {
    const result = validateManifestUpload({ fileName: "shipment.doc", mimeType: "application/msword", bytes: wordPackage() })

    expect(result.extension).toBe(".docx")
    expect(result.mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
  })

  it("accepts a legacy Word signature and selects the legacy parser format", () => {
    const bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2, 3])
    const result = validateManifestUpload({ fileName: "shipment.docx", mimeType: "", bytes })

    expect(result.extension).toBe(".doc")
    expect(result.mimeType).toBe("application/msword")
  })

  it("still rejects a ZIP archive that is not a Word document", () => {
    const bytes = zipSync({ "notes.txt": strToU8("not a Word package") })

    expect(() => validateManifestUpload({ fileName: "shipment.doc", mimeType: "application/msword", bytes }))
      .toThrow("The file content does not match its extension")
  })
})

describe("app-only document identifiers", () => {
  const hash = "0123456789abcdef".repeat(4)

  it("generates stable invoice and manifest references when extraction finds neither", () => {
    const result = ensureAppDocumentIdentifiers({ invoiceNumber: null, manifestNumber: "  " }, hash)

    expect(result.metadata).toEqual({
      invoiceNumber: "APP-INV-0123456789ABCDEF",
      manifestNumber: "APP-MNF-0123456789ABCDEF",
    })
    expect(result.generated).toEqual(result.metadata)
  })

  it("preserves identifiers obtained from the source document", () => {
    const result = ensureAppDocumentIdentifiers({ invoiceNumber: "INV-77", manifestNumber: "MNF-88" }, hash)

    expect(result.metadata).toEqual({ invoiceNumber: "INV-77", manifestNumber: "MNF-88" })
    expect(result.generated).toEqual({})
  })
})
