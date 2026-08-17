// electron/main.ts
import { app, BrowserWindow, shell } from "electron"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import fs from "node:fs";
import { registerManifestParserHandler } from "./ipc/manifest-parser-handler.js"
import { registerStoreInstallationHandlers } from "./ipc/store-installation-handler.js"
import { registerStorageHandlers } from "./ipc/storage-handler.js"
import { registerSqliteManifestHandler } from "./ipc/sqlite-manifest-handler.js"
import { closeSelectedProvider } from "./services/database-provider-manager.js"
import { initializeAutoUpdater } from "./updater.js"
import { isAllowedExternalUrl } from "../src/lib/external-url.js"

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

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

app.on("second-instance", () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

const runtimeEnvironmentKeys = new Set([
  "CHATGPT_API_KEY",
  "CHATGPT_MODEL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_MODEL",
  "DEEPSEEK_FALLBACK_ENABLED",
  "DEEPSEEK_MAX_RETRIES",
  "DEEPSEEK_FALLBACK_ON",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_DB_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_APP_PASSWORD",
  "SMTP_FROM_EMAIL",
  "SMTP_FROM_NAME",
])

function loadRuntimeEnvironment(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), ".env.local"),
    path.join(app.getAppPath(), ".env"),
    path.join(path.dirname(process.execPath), ".env"),
    path.join(app.getPath("userData"), ".env"),
  ]
  for (const candidate of [...new Set(candidates)]) {
    if (!fs.existsSync(candidate)) continue
    for (const rawLine of fs.readFileSync(candidate, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith("#")) continue
      const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!match || !runtimeEnvironmentKeys.has(match[1]) || process.env[match[1]] != null) continue
      let value = match[2].trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
      process.env[match[1]] = value
    }
  }
}
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
      sandbox: true,
    },
  })

  // Show window when ready
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show()
    logBoot("window:shown")
  })

  const openExternalUrl = (url: string): void => {
    if (!isAllowedExternalUrl(url)) {
      console.warn(`[security] Blocked external URL protocol: ${url.slice(0, 120)}`)
      return
    }
    void shell.openExternal(url).catch((error: unknown) => {
      console.error("Failed to open external URL", error)
    })
  }

  // Keep remote content outside the privileged desktop window.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    openExternalUrl(details.url)
    return { action: "deny" }
  })
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL()
    if (url === currentUrl) return
    event.preventDefault()
    openExternalUrl(url)
  })

  // Dev-only error/log forwarding (cleaned up on window close)
  if (isDev) {

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
    // mainWindow.webContents.openDevTools({ mode: "detach" })
    logBoot("window:loadURL")
  } else {
    // Production: load built index.html
    const indexPath = path.join(app.getAppPath(), "dist", "index.html")

    mainWindow.loadFile(indexPath)
    // mainWindow.webContents.openDevTools({ mode: "detach" })
    logBoot("window:loadFile")
  }

  logBoot("createWindow:end")
  return mainWindow
}

// App lifecycle
if (hasSingleInstanceLock) app.whenReady().then(async () => {
  logBoot("app.whenReady")
  try {
    loadRuntimeEnvironment()
    registerStorageHandlers()
    logBoot("storage:registered")
    registerStoreInstallationHandlers()
    logBoot("store-installation:registered")
    registerManifestParserHandler()
    logBoot("manifest-parser:registered")
    registerSqliteManifestHandler()
    logBoot("sqlite-manifest:registered")

    createWindow()
    logBoot("window:created")

    initializeAutoUpdater(() => mainWindow)
    logBoot("auto-updater:initialized")
  } catch (err) {
    console.error("main: startup failed", err)
    app.quit()
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  closeSelectedProvider()
})

app.on("will-quit", () => {
  closeSelectedProvider()
})
