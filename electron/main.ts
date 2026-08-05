import { app, BrowserWindow, shell } from "electron"
import path from "path"
import fs from "fs";
import { performance } from "node:perf_hooks"
import { initDatabase, closeDatabase, databaseExists } from "./database.js"
import { registerIpcHandlers } from "./ipc/handlers.js"
import { seedDemoDataIfNeeded } from "./services/demo-seed-service.js"
import { fileURLToPath } from "node:url";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = !!process.env.VITE_DEV_SERVER_URL
const bootStart = performance.now()

function logBoot(stage: string): void {
  const elapsed = performance.now() - bootStart
  console.log(`[boot][main] +${elapsed.toFixed(1)}ms ${stage}`)
}

let mainWindow: BrowserWindow | null = null

const preloadPath = path.join(__dirname, "preload.cjs");

console.log("preload =", preloadPath);
console.log("exists =", fs.existsSync(preloadPath));

function createWindow(): BrowserWindow {
  logBoot("createWindow:start")
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: "Armory Store Management System",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.on("ready-to-show", () => {
    logBoot("window:ready-to-show")
    mainWindow?.show()
    logBoot("window:show-called")
  })

  mainWindow.webContents.on("did-start-loading", () => {
    logBoot("webContents:did-start-loading")
  })

  mainWindow.webContents.on("dom-ready", () => {
    logBoot("webContents:dom-ready")
  })

  mainWindow.webContents.on("did-finish-load", () => {
    logBoot("webContents:did-finish-load")
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: "deny" }
  })

  if (isDev) {
    mainWindow.webContents.on("did-fail-load", (_, code, desc) => {
      console.error("did-fail-load:", code, desc);
    });

    mainWindow.webContents.on("render-process-gone", (_, details) => {
      console.error("render-process-gone:", details);
    });

    mainWindow.webContents.on("console-message", (_, level, message) => {
      console.log("Renderer:", message);
    });
    logBoot("window:loadURL")
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!)
    mainWindow.webContents.openDevTools({ mode: "detach" })
  } else {
    logBoot("window:loadFile")
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"))
  }

  logBoot("createWindow:end")
  return mainWindow!
}

app.whenReady().then(async () => {
  logBoot("app.whenReady")
  try {
    console.log('main: initializing database')
    logBoot("initDatabase:await")
    await initDatabase()
    logBoot("initDatabase:completed")

    console.log('main: seeding demo data if needed')
    const seedResult = seedDemoDataIfNeeded()
    console.log('main: demo seed result', seedResult)

    console.log('main: registering IPC handlers')
    registerIpcHandlers()
    logBoot("ipc:registered")
    console.log('main: IPC handlers registered')

    console.log('main: creating BrowserWindow')
    createWindow()
    logBoot("window:created")
    console.log('main: BrowserWindow created')
  } catch (err) {
    console.error('main: startup failed', err)
    throw err
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  console.log('main: window-all-closed')
  try { closeDatabase() } catch (e) { console.error('main: closeDatabase error', e) }
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  console.log('main: before-quit')
  try { closeDatabase() } catch (e) { console.error('main: closeDatabase error', e) }
})

process.on('uncaughtException', (err) => {
  console.error('main: uncaughtException', err)
})

process.on('unhandledRejection', (reason) => {
  console.error('main: unhandledRejection', reason)
})

export { databaseExists }
