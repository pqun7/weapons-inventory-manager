import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../../..")
const source = (path: string) => readFileSync(resolve(root, path), "utf8")

describe("Electron storage IPC boundary", () => {
  it("keeps the renderer sandboxed and exposes no raw SQL channel", () => {
    const main = source("electron/main.ts")
    const preload = source("electron/preload.cts")
    const storage = source("electron/ipc/storage-handler.ts")
    expect(main).toContain("contextIsolation: true")
    expect(main).toContain("nodeIntegration: false")
    expect(main).toContain("sandbox: true")
    expect(`${preload}\n${storage}`).not.toMatch(/db:query|rawSql|["']sql["']\s*:|query\s*:\s*\([^)]*sql/i)
    expect(preload).toContain('ipcRenderer.invoke("database:invoke", input)')
    expect(storage).toContain("z.enum(SQLITE_DATABASE_OPERATIONS)")
    expect(storage).toContain("requireSqliteSelected()")
  })

  it("removes previous handlers and renderer listeners before re-registration", () => {
    const preload = source("electron/preload.cts")
    const storage = source("electron/ipc/storage-handler.ts")
    expect(storage).toContain("ipcMain.removeHandler(channel)")
    expect(preload).toContain('ipcRenderer.removeListener("storage:setup-progress", listener)')
    expect(preload).toContain('ipcRenderer.removeListener("storage:migration-progress", listener)')
    expect(storage).toContain('"storage:migrate-to-supabase"')
    expect(storage).toContain('"storage:migrate-to-sqlite"')
  })

  it("keeps administrative credentials out of the persisted provider config", () => {
    const config = source("src/lib/database-provider.ts")
    const storage = source("electron/services/storage-config-service.ts")
    expect(config).toContain("AppStorageConfigSchema")
    expect(storage).not.toMatch(/password|publishableKey|serviceRole|secret/i)
    expect(storage).toContain("fs.fsyncSync(descriptor)")
    expect(storage).toContain("fs.renameSync(temporary, filename)")
  })

  it("disconnects only the local Supabase store selection and removes recoverable config backups", () => {
    const handler = source("electron/ipc/store-installation-handler.ts")
    const manager = source("electron/services/database-provider-manager.ts")
    const storage = source("electron/services/storage-config-service.ts")
    const store = source("electron/services/store-installation-service.ts")
    const panel = source("src/components/store-connection-panel.tsx")

    expect(handler).toContain("disconnectSupabaseProvider()")
    expect(manager).toContain('stored.config?.databaseProvider !== "supabase"')
    expect(manager).toContain("clearStoredConnection()")
    expect(manager).toContain("clearStorageConfig()")
    expect(manager).toContain("saveStoredConnection(connection)")
    expect(manager).toContain("writeStorageConfig(stored.config)")
    expect(storage).toContain('`${filename}${BACKUP_SUFFIX}`')
    expect(store).toContain('`${filename}.bak`')
    expect(panel).toContain('signOutActiveDatabase({ localOnly: true })')
    expect(panel).toContain('sessionStorage.setItem("armory-store:disconnect-notice"')
  })
})
