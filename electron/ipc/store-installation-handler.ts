import { ipcMain } from "electron"
import type { InitializeStoreInput, StoreSetupProgressStage } from "../../src/lib/store-connection.js"
import {
  connectionCodeFor,
  initializeStore,
  joinStore,
  readStoredConnection,
  supabaseEnvironmentStatus,
} from "../services/store-installation-service.js"
import { activateSupabaseProvider, disconnectSupabaseProvider } from "../services/database-provider-manager.js"

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
      const result = await initializeStore({
        storeName: String(record.storeName ?? ""),
        supabaseUrl: String(record.supabaseUrl ?? ""),
        publishableKey: String(record.publishableKey ?? ""),
        serverKey: String(record.serverKey ?? ""),
        databaseUrl: String(record.databaseUrl ?? ""),
        ownerName: String(record.ownerName ?? ""),
        ownerEmail: String(record.ownerEmail ?? ""),
        ownerPassword: String(record.ownerPassword ?? ""),
        replaceExistingAccounts: record.replaceExistingAccounts === true,
      } satisfies InitializeStoreInput, (stage: StoreSetupProgressStage) => {
        if (!event.sender.isDestroyed()) event.sender.send("store-connection:setup-progress", stage)
      })
      await activateSupabaseProvider()
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle("store-connection:clear", () => {
    try {
      disconnectSupabaseProvider()
      return { success: true, data: undefined }
    } catch (error) {
      return { success: false, error: errorMessage(error) }
    }
  })
}
