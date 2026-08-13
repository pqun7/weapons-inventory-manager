import { describe, expect, it } from "vitest"
import {
  LOCAL_MANIFEST_FILE_ACCEPT,
  MANIFEST_FILE_ACCEPT,
  isLocallySupportedManifestFileName,
} from "./manifest-file-types"

describe("shipment manifest file visibility", () => {
  it("exposes legacy and modern Word files in both AI and local file pickers", () => {
    for (const token of [
      ".doc",
      ".docx",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]) {
      expect(MANIFEST_FILE_ACCEPT.split(",")).toContain(token)
      expect(LOCAL_MANIFEST_FILE_ACCEPT.split(",")).toContain(token)
    }
  })

  it("accepts Word extensions case-insensitively in local mode", () => {
    expect(isLocallySupportedManifestFileName("طلبية.DOC")).toBe(true)
    expect(isLocallySupportedManifestFileName("shipment.DoCx")).toBe(true)
    expect(isLocallySupportedManifestFileName("scan.pdf")).toBe(false)
  })
})
