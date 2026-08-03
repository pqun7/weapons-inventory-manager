import { app, BrowserWindow, shell } from "electron"
import path from "path"
import { fileURLToPath } from "url"
import { initDatabase, closeDatabase, databaseExists } from "./database"
import { registerIpcHandlers } from "./ipc/handlers"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const isDev = !!process.env.VITE_DEV_SERVER_URL

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: "Armory Store Management System",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: "deny" }
  })

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!)
    mainWindow.webContents.openDevTools({ mode: "detach" })
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"))
  }
}

app.whenReady().then(() => {
  initDatabase()
  registerIpcHandlers(mainWindow ?? createWindow())
  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  closeDatabase()
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  closeDatabase()
})

export { databaseExists }
