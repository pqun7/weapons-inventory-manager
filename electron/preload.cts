import { contextBridge, ipcRenderer } from "electron"

const electronAPI = {
  storeConnection: {
    get: () => ipcRenderer.invoke("store-connection:get"),
    join: (input: unknown) => ipcRenderer.invoke("store-connection:join", input),
    initialize: (input: unknown) => ipcRenderer.invoke("store-connection:initialize", input),
    clear: () => ipcRenderer.invoke("store-connection:clear"),
    onSetupProgress: (callback: (stage: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, stage: unknown) => callback(stage)
      ipcRenderer.on("store-connection:setup-progress", listener)
      return () => ipcRenderer.removeListener("store-connection:setup-progress", listener)
    },
  },
  manifest: {
    parse: (input: unknown) => ipcRenderer.invoke("manifest:parse", input),
    onProgress: (callback: (progress: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
      ipcRenderer.on("manifest:progress", listener)
      return () => ipcRenderer.removeListener("manifest:progress", listener)
    },
  },
} as const

contextBridge.exposeInMainWorld("electronAPI", electronAPI)
