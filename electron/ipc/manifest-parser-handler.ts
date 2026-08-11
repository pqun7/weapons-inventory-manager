import { ipcMain } from "electron"
import { extractShipmentManifest } from "../services/manifest-extraction-service.js"
import type { ManifestUploadInput } from "../../src/lib/shipment-manifest.js"

export function registerManifestParserHandler(): void {
  ipcMain.handle("manifest:parse", async (event, input: ManifestUploadInput) => {
    try {
      const data = await extractShipmentManifest(input, (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send("manifest:progress", progress)
      })
      return { success: true, data, error: null }
    } catch (error) {
      return { success: false, data: null, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
