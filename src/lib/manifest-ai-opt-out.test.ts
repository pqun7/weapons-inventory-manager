import { afterEach, describe, expect, it, vi } from "vitest"
import { extractShipmentManifest } from "../../electron/services/manifest-extraction-service"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("shipment manifest AI opt-out", () => {
  it("does not contact an AI provider when AI analysis is disabled", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const pdfBytes = new TextEncoder().encode("%PDF-1.4\n%%EOF")
    await expect(extractShipmentManifest({
      fileName: "manifest.pdf",
      mimeType: "application/pdf",
      bytes: pdfBytes,
      aiEnabled: false,
    })).rejects.toThrow("Local-only analysis supports XLSX, XLS, and CSV")

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
