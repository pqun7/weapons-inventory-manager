import { contextBridge, ipcRenderer } from "electron"

const electronAPI = {
  storeConnection: {
    get: () => ipcRenderer.invoke("store-connection:get"),
    join: (input: unknown) => ipcRenderer.invoke("store-connection:join", input),
    initialize: (input: unknown) => ipcRenderer.invoke("store-connection:initialize", input),
    clear: () => ipcRenderer.invoke("store-connection:clear"),
    environmentStatus: () => ipcRenderer.invoke("store-connection:environment-status"),
    onSetupProgress: (callback: (stage: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, stage: unknown) => callback(stage)
      ipcRenderer.on("store-connection:setup-progress", listener)
      return () => ipcRenderer.removeListener("store-connection:setup-progress", listener)
    },
  },
  storage: {
    getBootstrap: () => ipcRenderer.invoke("storage:get-bootstrap"),
    initializeSelected: () => ipcRenderer.invoke("storage:initialize-selected"),
    returnToSetup: () => ipcRenderer.invoke("storage:return-to-setup"),
    setupSqlite: (input: unknown) => ipcRenderer.invoke("storage:setup-sqlite", input),
    activateSupabase: () => ipcRenderer.invoke("storage:activate-supabase"),
    migrateToSupabase: (input: unknown) => ipcRenderer.invoke("storage:migrate-to-supabase", input),
    migrateToSqlite: (input: unknown) => ipcRenderer.invoke("storage:migrate-to-sqlite", input),
    onSetupProgress: (callback: (stage: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, stage: unknown) => callback(stage)
      ipcRenderer.on("storage:setup-progress", listener)
      return () => ipcRenderer.removeListener("storage:setup-progress", listener)
    },
    onMigrationProgress: (callback: (stage: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, stage: unknown) => callback(stage)
      ipcRenderer.on("storage:migration-progress", listener)
      return () => ipcRenderer.removeListener("storage:migration-progress", listener)
    },
  },
  localAuth: {
    getSession: () => ipcRenderer.invoke("local-auth:get-session"),
    resolve: (input: unknown) => ipcRenderer.invoke("local-auth:resolve", input),
    signIn: (input: unknown) => ipcRenderer.invoke("local-auth:sign-in", input),
    claim: (input: unknown) => ipcRenderer.invoke("local-auth:claim", input),
    signOut: () => ipcRenderer.invoke("local-auth:sign-out"),
    updatePassword: (input: unknown) => ipcRenderer.invoke("local-auth:update-password", input),
  },
  accounts: {
    exportLoginGuide: (input: unknown) => ipcRenderer.invoke("account:export-login-guide", input),
  },
  database: {
    invoke: (input: unknown) => ipcRenderer.invoke("database:invoke", input),
  },
  manifest: {
    parse: (input: unknown) => ipcRenderer.invoke("manifest:parse", input),
    onProgress: (callback: (progress: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
      ipcRenderer.on("manifest:progress", listener)
      return () => ipcRenderer.removeListener("manifest:progress", listener)
    },
  },
  sqliteManifest: {
    invoke: (input: unknown) => ipcRenderer.invoke("sqlite-manifest:invoke", input),
  },
} as const

contextBridge.exposeInMainWorld("electronAPI", electronAPI)
