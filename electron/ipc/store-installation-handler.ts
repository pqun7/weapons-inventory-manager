import { ipcMain } from "electron"
import type { InitializeStoreFromEnvironmentInput, StoreSetupProgressStage } from "../../src/lib/store-connection.js"
import {
  connectionCodeFor,
  initializeStoreFromEnvironment,
  joinStore,
  readStoredConnection,
  supabaseEnvironmentStatus,
} from "../services/store-installation-service.js"
import { activateSupabaseProvider } from "../services/database-provider-manager.js"

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The store connection operation failed"
}

export function registerStoreInstallationHandlers(): void {
  for (const channel of ["store-connection:get", "store-connection:environment-status", "store-connection:join", "store-connection:initialize", "store-connection:clear"]) {
    ipcMain.removeHandler(channel)
  }
  ipcMain.handle("store-connection:get", () => {
    const connection = readStoredConnection()
    return {
      success: true,
      data: connection ? { connection, connectionCode: connectionCodeFor(connection) } : null,
    }
  })

  ipcMain.handle("store-connection:environment-status", () => ({ success: true, data: supabaseEnvironmentStatus() }))

  ipcMain.handle("store-connection:join", async (_event, input: unknown) => {
    try {
      if (!input || typeof input !== "object" || typeof (input as { connectionCode?: unknown }).connectionCode !== "string") {
        throw new Error("A store connection code is required")
      }
      const connection = await joinStore((input as { connectionCode: string }).connectionCode)
      await activateSupabaseProvider()
      return { success: true, data: { connection, connectionCode: connectionCodeFor(connection) } }
    } catch (error) {
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle("store-connection:initialize", async (event, input: unknown) => {
    try {
      if (!input || typeof input !== "object") throw new Error("Store setup information is required")
      const record = input as Record<string, unknown>
      const result = await initializeStoreFromEnvironment({
        storeName: String(record.storeName ?? ""),
        ownerName: String(record.ownerName ?? ""),
        ownerEmail: String(record.ownerEmail ?? ""),
        ownerPassword: String(record.ownerPassword ?? ""),
      } satisfies InitializeStoreFromEnvironmentInput, (stage: StoreSetupProgressStage) => {
        if (!event.sender.isDestroyed()) event.sender.send("store-connection:setup-progress", stage)
      })
      await activateSupabaseProvider()
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle("store-connection:clear", () => {
    return { success: false, error: "Disconnecting a configured provider requires the administrator storage migration workflow" }
  })
}
