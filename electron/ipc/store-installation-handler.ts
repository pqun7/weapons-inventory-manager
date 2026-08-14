import { ipcMain } from "electron"
import type { InitializeStoreInput, StoreSetupProgressStage } from "../../src/lib/store-connection.js"
import {
  clearStoredConnection,
  connectionCodeFor,
  initializeStore,
  joinStore,
  readStoredConnection,
} from "../services/store-installation-service.js"

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The store connection operation failed"
}

export function registerStoreInstallationHandlers(): void {
  ipcMain.handle("store-connection:get", () => {
    const connection = readStoredConnection()
    return {
      success: true,
      data: connection ? { connection, connectionCode: connectionCodeFor(connection) } : null,
    }
  })

  ipcMain.handle("store-connection:join", async (_event, input: unknown) => {
    try {
      if (!input || typeof input !== "object" || typeof (input as { connectionCode?: unknown }).connectionCode !== "string") {
        throw new Error("A store connection code is required")
      }
      const connection = await joinStore((input as { connectionCode: string }).connectionCode)
      return { success: true, data: { connection, connectionCode: connectionCodeFor(connection) } }
    } catch (error) {
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle("store-connection:initialize", async (event, input: unknown) => {
    try {
      if (!input || typeof input !== "object") throw new Error("Store setup information is required")
      const result = await initializeStore(input as InitializeStoreInput, (stage: StoreSetupProgressStage) => {
        if (!event.sender.isDestroyed()) event.sender.send("store-connection:setup-progress", stage)
      })
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle("store-connection:clear", () => {
    try {
      clearStoredConnection()
      return { success: true }
    } catch (error) {
      return { success: false, error: errorMessage(error) }
    }
  })
}
