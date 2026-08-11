import { contextBridge, ipcRenderer } from "electron"

const electronAPI = {
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
