// electron/main.ts
import { app, BrowserWindow, shell } from "electron"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import { initDatabase, closeDatabase } from "./database.js"
import { registerIpcHandlers } from "./ipc/handlers.js"
import { seedDemoDataIfNeeded } from "./services/demo-seed-service.js"
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Determine dev mode more robustly than VITE_DEV_SERVER_URL
const devServerUrl = process.env.RSBUILD_DEV_SERVER_URL;
const isDev = !!devServerUrl;

const bootStart = performance.now()
function logBoot(stage: string): void {
  const elapsed = performance.now() - bootStart
  console.log(`[boot][main] +${elapsed.toFixed(1)}ms ${stage}`)
}

let mainWindow: BrowserWindow | null = null
function createWindow(): BrowserWindow {
  logBoot("createWindow:start")

  // Preload path: compiled preload.cts → preload.cjs next to main.js
  const preloadPath = path.join(__dirname, "preload.cjs")
  // Safety check (logs in dev, but won't block startup)
  if (!fs.existsSync(preloadPath)) {
    console.error(`Preload script not found: ${preloadPath}`)
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: "Armory Store Management System",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Show window when ready
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show()
    logBoot("window:shown")
  })

  // Prevent new windows (open in external browser)
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: "deny" }
  })

  // Dev-only error/log forwarding (cleaned up on window close)
  if (isDev) {
    // 1. حساب الرابط مع القيمة الافتراضية
    const DEV_SERVER_URL =
      process.env.RSBUILD_DEV_SERVER_URL ||
      process.env.DEV_SERVER_URL ||
      "http://localhost:3000";

    const onFailLoad = (_: Electron.Event, code: number, desc: string) =>
      console.error("did-fail-load:", code, desc)
    const onRenderGone = (_: Electron.Event, details: Electron.RenderProcessGoneDetails) =>
      console.error("render-process-gone:", details)
    const onConsole = (_: Electron.Event, level: number, message: string) =>
      console.log(`[Renderer L${level}]:`, message)
    const onFinishLoad = () => console.log("Renderer loaded")

    mainWindow.webContents.on("did-fail-load", onFailLoad)
    mainWindow.webContents.on("render-process-gone", onRenderGone)
    mainWindow.webContents.on("console-message", onConsole)
    mainWindow.webContents.on("did-finish-load", onFinishLoad)

    // Remove listeners when window is closed to avoid memory leaks
    mainWindow.once("closed", () => {
      mainWindow?.webContents.removeListener("did-fail-load", onFailLoad)
      mainWindow?.webContents.removeListener("render-process-gone", onRenderGone)
      mainWindow?.webContents.removeListener("console-message", onConsole)
      mainWindow?.webContents.removeListener("did-finish-load", onFinishLoad)
    })

    // 2. ✅ استخدام المتغير DEV_SERVER_URL المحسوب
    mainWindow.loadURL(devServerUrl!)
    mainWindow.webContents.openDevTools({ mode: "detach" })
    logBoot("window:loadURL")
  } else {
    // Production: load built index.html
    const indexPath = path.resolve(process.cwd(), "dist/index.html")

    mainWindow.loadFile(indexPath)
    // mainWindow.webContents.openDevTools({ mode: "detach" })
    logBoot("window:loadFile")
  }

  logBoot("createWindow:end")
  return mainWindow
}

// App lifecycle
app.whenReady().then(async () => {
  logBoot("app.whenReady")
  try {
    await initDatabase()
    logBoot("initDatabase:completed")

    seedDemoDataIfNeeded()
    registerIpcHandlers()
    logBoot("ipc:registered")

    createWindow()
    logBoot("window:created")
  } catch (err) {
    console.error("main: startup failed", err)
    app.quit()
  }

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